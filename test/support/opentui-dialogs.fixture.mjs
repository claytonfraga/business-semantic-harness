import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { createTuiView } from '../../dist/tui/view.js';
import { selectSlashCommandModal, diffReviewModal, settingsModal, selectModelModal } from '../../dist/tui/modals.js';

async function setup(width = 80) {
  const test = await createTestRenderer({ width, height: 30 });
  const view = await createTuiView({ renderer: test.renderer });
  return { ...test, view };
}
test('Given BSH-MENU-005/007/008/009/010 When palette query and navigation change Then matches, cyclic Tab and focus restore', async () => {
  const ui = await setup();
  try {
    let pending = selectSlashCommandModal(undefined, '', ui.view);
    await ui.renderOnce(); ui.mockInput.pressArrow('up'); ui.mockInput.pressEnter();
    assert.equal(await pending, '/exit'); assert.ok(ui.view.input.focused);
    pending = selectSlashCommandModal(undefined, '', ui.view); await ui.renderOnce();
    ui.mockInput.pressTab(); ui.mockInput.pressEnter(); assert.equal(await pending, '/domain');
    pending = selectSlashCommandModal(undefined, '', ui.view); await ui.renderOnce();
    await ui.mockInput.typeText('zzzz'); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /No match/);
    ui.mockInput.pressBackspace(); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Filter: zzz|No match/);
    ui.mockInput.pressEscape(); assert.equal(await pending,null); assert.ok(ui.view.input.focused);
    pending = selectSlashCommandModal(undefined, '', ui.view); await ui.renderOnce(); await ui.mockInput.typeText('2'); assert.equal(await pending, '/domain');
    pending = selectSlashCommandModal(undefined, 'ex', ui.view); await ui.renderOnce(); await ui.mockInput.typeText('2'); await ui.renderOnce(); assert.ok(ui.view.dialogActive); assert.match(ui.captureCharFrame(), /ex2/); ui.mockInput.pressEscape(); await pending;
    pending = selectSlashCommandModal(undefined, '', ui.view); await ui.renderOnce(); ui.mockInput.pressBackspace(); assert.equal(await pending,null);
  } finally { ui.view.destroy(); }
});
test('Given dialogs resize across 20/35/60/80/140 columns Then query and selected value persist with actions visible', async () => {
  const ui = await setup(140);
  try {
    const pending = selectSlashCommandModal(undefined, '', ui.view); await ui.renderOnce();
    await ui.mockInput.typeText('ex');
    for (const width of [20,35,60,80,140]) {
      ui.resize(width,30); await ui.renderOnce(); const frame = ui.captureCharFrame();
      assert.match(frame,/\/exit/); assert.match(frame,/Esc: close/); assert.match(frame,/Enter:/);
      assert.ok(frame.split('\n').every(row => Array.from(row).length <= width));
    }
    ui.mockInput.pressEnter(); assert.equal(await pending,'/exit');
  } finally { ui.view.destroy(); }
});
test('Given BSH-AUTH-006/010 When a key is typed, edited and pasted Then native normal and selected captures contain masks only', async () => {
  const ui = await setup();
  try {
    const pending = ui.view.question({ title: 'Authentication', message: 'Paste a key', secret: true }); await ui.renderOnce();
    await ui.mockInput.typeText('synthetic-secret'); await ui.renderOnce();
    assert.doesNotMatch(ui.captureCharFrame(), /synthetic|secret/); assert.match(ui.captureCharFrame(), /\*{5}/);
    ui.mockInput.pressBackspace(); await ui.mockInput.pasteBracketedText('X\nY'); await ui.renderOnce();
    assert.doesNotMatch(JSON.stringify(ui.captureSpans()), /synthetic|secre|XY/);
    ui.mockInput.pressEnter(); assert.equal(await pending, 'synthetic-secreXY');
    const cancelled = ui.view.question({ title: 'Authentication', message: 'Paste a key', secret: true }); await ui.renderOnce();
    await ui.mockInput.typeText('discard-me'); ui.mockInput.pressEscape(); assert.equal(await cancelled,null); assert.ok(ui.view.input.focused);
  } finally { ui.view.destroy(); }
});
test('Given promotion is blocked or settings toggle Then blocked diff never promotes and settings preserve model/domain', async () => {
  const ui = await setup();
  try {
    const blocked = diffReviewModal('+ changed', false, ['Rule violated'],ui.view); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /BLOCKED/); await ui.mockInput.typeText('y'); ui.mockInput.pressEnter(); assert.equal(await blocked,false);
    const emptySettings = settingsModal({ confirmPromptViolations: true, model: 'model', domain: 'assets' }, ui.view); await ui.renderOnce(); ui.mockInput.pressEnter(); assert.deepEqual(await emptySettings, { confirmPromptViolations: true, model: 'model', domain: 'assets' });
    const settings = settingsModal({ confirmPromptViolations: true,model:'model',domain:'assets' },ui.view); await ui.renderOnce(); await ui.mockInput.typeText('1'); ui.mockInput.pressEnter(); assert.deepEqual(await settings,{ confirmPromptViolations:false,model:'model',domain:'assets' });
    const review = diffReviewModal('+ valid',true,[],ui.view); await ui.renderOnce(); ui.mockInput.pressEnter(); assert.equal(await review,false);
  } finally { ui.view.destroy(); }
});

test('Given BSH-MENU-003/006 When query exit is typed Then slash palette resolves /exit instead of null', async () => {
  const ui = await setup();
  try {
    const pending = selectSlashCommandModal(undefined, '', ui.view);
    await ui.renderOnce();
    await ui.mockInput.typeText('exit');
    await ui.renderOnce();
    ui.mockInput.pressEnter();
    assert.equal(await pending, '/exit');
  } finally { ui.view.destroy(); }
});

test('Given dialogs render at 35x24 Then list rows, pointer, and scrollable details do not overlap', async () => {
  const ui = await setup(35);
  ui.resize(35, 24);
  try {
    const pendingSlash = selectSlashCommandModal(undefined, '', ui.view);
    await ui.renderOnce();
    const slashFrame = ui.captureCharFrame();
    assert.match(slashFrame, /❯ 1\. \/model/);
    assert.match(slashFrame, /5\. \/rules/);
    assert.match(slashFrame, /Enter: select · Esc: close/);
    ui.mockInput.pressEscape();
    await pendingSlash;

    const longModels = [
      { id: 'openai/gpt-4o', name: 'OpenAI GPT-4o multimodal' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
    ];
    const pendingModel = selectModelModal(longModels, longModels[0].id, '', ui.view);
    await ui.renderOnce();
    const modelFrame = ui.captureCharFrame();
    assert.match(modelFrame, /❯ 1\./);
    assert.match(modelFrame, /2\. google\/gemini-2\.0/);
    ui.mockInput.pressEscape();
    await pendingModel;
  } finally { ui.view.destroy(); }
});

test('Given BSH-MENU-001/004 When slash palette opens at 80 columns Then shortcuts, descriptions, and pointer are rendered', async () => {
  const ui = await setup(80);
  try {
    const pending = selectSlashCommandModal(undefined, '', ui.view);
    await ui.renderOnce();
    const frame = ui.captureCharFrame();
    assert.match(frame, /❯ 1\. \/model\s+\[Ctrl\+M\]/);
    assert.match(frame, /2\. \/domain\s+\[Ctrl\+D\]/);
    assert.match(frame, /\(1-5 of 15\) • ↑\/↓ scroll/);
    ui.mockInput.pressEscape();
    await pending;
  } finally { ui.view.destroy(); }
});

test('Given BSH-SELECT-002 twelve filtered models When index 12 is entered Then the twelfth model is selected without changing the query', async () => {
  const ui = await setup();
  try {
    const models = Array.from({length:12},(_,i) => ({ id: `vendor/model-${String(i+1).padStart(2,'0')}`, name: 'Shared model' }));
    const pending = selectModelModal(models,models[0].id,'Shared',ui.view); await ui.renderOnce();
    await ui.mockInput.typeText('12'); await ui.renderOnce(); assert.match(ui.captureCharFrame(), /Choice: 12/);
    ui.mockInput.pressEnter(); assert.equal(await pending,models[11].id);
  } finally { ui.view.destroy(); }
});

test('Given a pending secret dialog When the owning view is destroyed Then its promise settles and input is cleared', async () => {
  const ui = await setup();
  const pending = ui.view.question({ title: 'Authentication',message:'Key',secret:true });
  await ui.renderOnce(); await ui.mockInput.typeText('discard-on-destroy');
  ui.view.destroy(); assert.equal(await pending,null);
});
