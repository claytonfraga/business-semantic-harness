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
