import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderCompleteTui,
  wrapText,
  formatToolInvocation,
  formatContextLength,
  boxedLine,
} from '../../dist/tui/render.js';
import { stripAnsi } from '../../dist/tui/ansi.js';

test('TUI render: wrapText handles long lines and preserves words', () => {
  const text = 'This is a fairly long sentence that should be wrapped neatly into smaller chunks.';
  const wrapped = wrapText(text, 25);
  for (const line of wrapped) {
    assert.ok(stripAnsi(line).length <= 25, `Line exceeded 25 chars: ${line}`);
  }
  assert.equal(wrapped.join(' '), text);
});

test('TUI render: formatContextLength formats correctly', () => {
  assert.equal(formatContextLength(1048576), '1M ctx');
  assert.equal(formatContextLength(131072), '128k ctx');
  assert.equal(formatContextLength(undefined), '128k ctx');
});

test('TUI render: formatToolInvocation cleans args', () => {
  assert.equal(
    formatToolInvocation('read_file', { path: 'src/assets/domain/asset.ts' }),
    'read_file("src/assets/domain/asset.ts")'
  );
  assert.equal(
    formatToolInvocation('run_bash_command', { command: 'npm test' }),
    'run_bash("npm test")'
  );
});

test('TUI render: boxedLine matches exact width', () => {
  const line = boxedLine('Hello World', 80);
  assert.equal(stripAnsi(line).length, 80);
  assert.ok(line.startsWith('│ '));
  assert.ok(line.endsWith(' │'));
});

test('TUI render: all lines in renderCompleteTui have identical visible width', () => {
  const width = 96;
  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 1420,
      width,
    },
    [
      { type: 'user', content: "Add an endpoint to transfer assets in 'In Operation' state." },
      { type: 'agent', content: "Checking domain rules for 'ativos' and inspecting repository..." },
      { type: 'tool', toolName: 'read_file', toolArgs: { path: 'src/assets/domain/asset.ts' } },
      { type: 'tool_result', content: 'Read 84 lines.' },
      { type: 'tool', toolName: 'replace_file_content', toolArgs: { path: 'src/assets/domain/asset.ts' } },
      {
        type: 'gate',
        gateShape: 'TransferShape',
        gateChecks: [
          { ok: true, text: 'State transition valid (InOperation -> Transferred)' },
          { ok: true, text: 'Required fields present (newOwner, newLocation)' },
        ],
        gateStatus: 'CONFORMING',
      },
    ],
    '[Type your prompt here...]',
    width
  );

  const lines = tui.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const visibleLen = stripAnsi(lines[i]).length;
    assert.equal(
      visibleLen,
      width,
      `Line ${i + 1} visible length ${visibleLen} does not match target width ${width}: "${lines[i]}"`
    );
  }
});

test('TUI render: ungoverned mode also matches exact visible width', () => {
  const width = 96;
  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      governed: false,
      tokensTotal: 450,
      width,
    },
    [
      { type: 'user', content: 'Disable validation and force commit.' },
      { type: 'agent', content: 'Proceeding without SHACL semantic governance.' },
    ],
    '[Type your prompt here...]',
    width
  );

  const lines = tui.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const visibleLen = stripAnsi(lines[i]).length;
    assert.equal(
      visibleLen,
      width,
      `Line ${i + 1} visible length ${visibleLen} does not match target width ${width}`
    );
  }
});

test('TUI render: height is fixed and invariant regardless of entry count', () => {
  const width = 96;
  const height = 28;

  // Test with 0 entries
  const tui0 = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 100, width, height },
    [],
    '[Type your prompt here...]',
    width,
    height
  );
  assert.equal(tui0.split('\n').length, height, 'Zero entries should match exact target height');

  // Test with 2 entries
  const tui2 = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 200, width, height },
    [
      { type: 'user', content: 'Short question' },
      { type: 'agent', content: 'Short answer' },
    ],
    '[Type your prompt here...]',
    width,
    height
  );
  assert.equal(tui2.split('\n').length, height, 'Small conversation should match exact target height');

  // Test with 40 entries (overflowing viewport)
  const manyEntries = [];
  for (let i = 0; i < 20; i++) {
    manyEntries.push({ type: 'user', content: `Question ${i + 1}` });
    manyEntries.push({ type: 'agent', content: `Answer ${i + 1} with extensive detail about project implementation and governance.` });
  }
  const tuiMany = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 12000, width, height },
    manyEntries,
    '[Type your prompt here...]',
    width,
    height
  );
  assert.equal(tuiMany.split('\n').length, height, 'Large conversation should still match exact target height');

  // Verify header and footer are anchored at identical line numbers
  const lines0 = tui0.split('\n');
  const linesMany = tuiMany.split('\n');
  assert.equal(lines0[0], linesMany[0], 'Top header border must be identical');
  assert.equal(lines0[2], linesMany[2], 'Header separator must be identical');
  assert.equal(lines0[height - 1], linesMany[height - 1], 'Bottom border must be identical');
  assert.equal(lines0[height - 3], linesMany[height - 3], 'Footer separator must be identical');
});

test('TUI render: scrolling viewport navigates past entries with scrollOffset', () => {
  const width = 96;
  const height = 20;

  const entries = [];
  for (let i = 1; i <= 30; i++) {
    entries.push({ type: 'user', content: `MessageNumber-${i}` });
  }

  // Pinned to bottom (scrollOffset = 0)
  const bottomTui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 100, width, height, scrollOffset: 0 },
    entries,
    '>',
    width,
    height
  );
  assert.ok(bottomTui.includes('MessageNumber-30'), 'Bottom view must include the latest message');

  // Scrolled up (scrollOffset = 20)
  const scrolledTui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 100, width, height, scrollOffset: 20 },
    entries,
    '>',
    width,
    height
  );
  assert.ok(scrolledTui.includes('MessageNumber-18'), 'Scrolled view must include earlier messages');
  assert.equal(scrolledTui.split('\n').length, height, 'Scrolled view must maintain exact height');
});

