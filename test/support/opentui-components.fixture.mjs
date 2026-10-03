import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RGBA } from "@opentui/core";
import { createTestRenderer } from '@opentui/core/testing';
import { createTuiView } from '../../dist/tui/view.js';
import { githubDarkDimmedTheme as theme } from '../../dist/tui/theme.js';

const state = { model: 'test-model', governed: true, tokensTotal: 100, domain: 'Synthetic', projectFolder: 'fixture', gitBranch: 'main' };

test('Given BSH-TUI-002 When telemetry renders at ordinary width Then duration TPS queue and model usage remain visible', async () => {
  const fixture = await createTestRenderer({ width: 80, height: 24 });
  const view = await createTuiView({ renderer: fixture.renderer });
  try {
    view.update({ ...state, generationDurationMs: 2000, generationTps: 50, queueLength: 2 }, []);
    await fixture.renderOnce();
    const frame = fixture.captureCharFrame();
    for (const metric of ['Queue:2', '2.0s', '50.0 TPS', 'Model: test-model', '100/128k ctx', '(0.1%)', '$0.0000', 'Ctrl+D']) assert.ok(frame.includes(metric), metric + '\n' + frame);
    fixture.resize(35, 12);
    await fixture.renderOnce();
    const narrow = fixture.captureCharFrame();
    for (const metric of ['Queue:2', '2.0s', '50.0 TPS']) assert.ok(narrow.includes(metric), metric + '\n' + narrow);
  } finally { view.destroy(); }
});

test('Given BSH-MENU-004 When shared theme is read Then exact roles and unique accents are available', () => {
  assert.deepEqual(Object.values(theme).filter(value => typeof value === 'string'), ['#22272e', '#2d333b', '#1c2128', '#adbac7', '#768390', '#cdd9e5', '#444c56', '#373e47', '#539bf5', '#316dca', '#57ab5a', '#c69026', '#e5534b', '#986ee2']);
  assert.equal(new Set(Object.values(theme.commands)).size, 15);
  assert.ok(Object.isFrozen(theme));
  assert.ok(Object.isFrozen(theme.commands));
});

test('Given BSH-TUI-005 When all entry payloads render Then English labels and semantic states are visible', async () => {
  const fixture = await createTestRenderer({ width: 120, height: 65 });
  const view = await createTuiView({ renderer: fixture.renderer });
  try {
    view.update(state, [
      { type: 'user', content: 'queued request', isQueued: true },
      { type: 'agent', content: 'progressive answer' },
      { type: 'tool', toolName: 'read_file', toolArgs: { path: 'src/example.ts' } },
      { type: 'tool', toolName: 'read_file', toolArgs: { path: 'src/example.ts' }, verbose: true },
      { type: 'tool_result', content: 'file contents', verbose: true },
      { type: 'gate', gateStatus: 'VIOLATION', gateShape: 'SyntheticShape', gateChecks: [{ ok: false, text: 'invalid synthetic property' }, { ok: true, text: 'valid synthetic property' }] },
      { type: 'alert', content: 'Domain mismatch warning' },
      { type: 'prompt_violation', violationShape: 'SyntheticShape', violationRule: 'Synthetic rule', waitingConfirmation: true },
      { type: 'implementation_receipt', receiptHasChanges: true, receiptFiles: [{ path: 'example.ts', linesAdded: 2, linesRemoved: 1 }], receiptTotalAdded: 2, receiptTotalRemoved: 1 },
      { type: 'implementation_receipt', receiptHasChanges: false },
      { type: 'reasoning', content: 'hidden reasoning body', reasoningTokens: 30 },
      { type: 'reasoning', content: 'visible reasoning body', reasoningCollapsed: false },
      { type: 'diff_preview', diffFiles: [{ path: 'example.ts', linesAdded: 3, linesRemoved: 2 }], diffTotalAdded: 3, diffTotalRemoved: 2 },
      { type: 'blank' },
    ]);
    await fixture.renderOnce();
    view.scrollTo("top");
    await fixture.renderOnce();
    const frame = fixture.captureCharFrame();
    for (const label of ['[QUEUED]', '[BSH Agent]', 'Reading src/example.ts', 'read_file("src/example.ts")', 'Tool result:', 'VIOLATION', 'Promotion blocked', '[+] valid', '[X] invalid', 'Semantic Domain Alert', 'Violated shape:', 'SHACL rule:', 'Press [Enter]', 'IMPLEMENTATION COMPLETED', 'promotion is separate', 'READ / DIAGNOSTIC', 'No file changes', 'Ctrl+O expand', 'visible reasoning body', 'DIFF PREVIEW']) assert.ok(frame.includes(label), label + "\n" + frame);
    assert.ok(!frame.includes('hidden reasoning body'));
    const spans = fixture.captureSpans().lines.flatMap(line => line.spans);
    assert.ok(spans.some(span => span.text.includes('VIOLATION') && span.fg.equals(RGBA.fromHex(theme.error))));
    assert.ok(spans.some(span => span.text.includes('+2') && span.fg.equals(RGBA.fromHex(theme.success))));
  } finally { view.destroy(); }
});

test('Given streaming and resizing Then prompt cards scroll and chrome are preserved', async () => {
  const fixture = await createTestRenderer({ width: 80, height: 24 });
  const view = await createTuiView({ renderer: fixture.renderer });
  try {
    view.update(state, []);
    await fixture.renderOnce();
    assert.ok(fixture.captureCharFrame().includes('BSH [Business Semantic Harness]'));
    view.setPrompt('draft\nsecond line');
    const entries = Array.from({ length: 30 }, (_, index) => ({ type: 'agent', content: `message ${index}` }));
    view.update(state, entries);
    await fixture.renderOnce();
    assert.ok(fixture.captureCharFrame().includes('message 29'));
    view.scrollTo('top');
    await fixture.renderOnce();
    const top = view.scroll.scrollTop;
    const card = view.scroll.getChildren()[0];
    entries[29].content += ' streamed';
    view.update(state, entries);
    await fixture.renderOnce();
    assert.equal(view.scroll.scrollTop, top);
    assert.equal(view.scroll.getChildren()[0], card);
    assert.equal(view.getPrompt(), 'draft\nsecond line');
    fixture.resize(35, 12);
    await fixture.renderOnce();
    assert.equal(view.getPrompt(), 'draft\nsecond line');
    assert.equal(view.scroll.scrollTop, top);
    assert.equal(fixture.captureSpans().cols, 35);
    assert.equal(fixture.captureSpans().rows, 12);
    assert.ok(fixture.captureCharFrame().includes('BSH'));
    assert.ok(fixture.captureCharFrame().includes('Model:'));
    fixture.resize(140, 40);
    view.scrollTo('bottom');
    await fixture.renderOnce();
    assert.ok(fixture.captureCharFrame().includes('message 29 streamed'));
    view.update(state, []);
    await fixture.renderOnce();
    assert.equal(view.scroll.scrollTop, 0);
    assert.equal(view.getPrompt(), 'draft\nsecond line');
  } finally { view.destroy(); }
});

test('Given native input submits and global routing consumes a key Then subscriptions receive prompt and consumed text is excluded', async () => {
  const fixture = await createTestRenderer({ width: 80, height: 20 });
  const view = await createTuiView({ renderer: fixture.renderer });
  try {
    let submitted;
    const remove = view.onSubmit(prompt => { submitted = prompt; });
    const unroute = view.onKeypress(event => { if (event.name === 'x') event.preventDefault(); });
    await fixture.mockInput.typeText('abcx');
    fixture.mockInput.pressEnter();
    await fixture.renderOnce();
    assert.equal(view.getPrompt(), 'abc');
    assert.equal(submitted, 'abc');
    view.input.selectAll();
    await fixture.renderOnce();
    const selected = fixture.captureSpans().lines.flatMap(line => line.spans).find(span => span.text.includes('abc'));
    assert.ok(selected.fg.equals(RGBA.fromHex(theme.emphasis)));
    assert.ok(selected.bg.equals(RGBA.fromHex(theme.selection)));
    remove(); unroute();
  } finally { view.destroy(); }
});
