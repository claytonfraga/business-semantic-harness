import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderCompleteTui,
  wrapText,
  formatToolInvocation,
  formatContextLength,
  boxedLine,
  tuiLine,
} from '../../dist/tui/render.js';
import { formatActionStep } from '../../dist/tui/entries.js';
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

test('TUI render: tuiLine and boxedLine match exact width without lateral pipe borders', () => {
  const line = tuiLine('Hello World', 80);
  assert.equal(stripAnsi(line).length, 80);
  assert.ok(!line.startsWith('│'));
  assert.ok(!line.endsWith('│'));

  const bLine = boxedLine('Hello World', 80);
  assert.equal(stripAnsi(bLine).length, 80);
  assert.ok(!bLine.startsWith('│'));
  assert.ok(!bLine.endsWith('│'));
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
  assert.equal(lines0[height - 4], linesMany[height - 4], 'Footer separator must be identical');
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

test('TUI render: renders DOMAIN MISMATCH badge and alert entry correctly', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      ontologySummary: 'ativos v1.0.0 (4 classes, 2 shapes)',
      projectFolder: 'pilot/calculator',
      gitBranch: 'main',
      governed: true,
      alignmentStatus: 'MISMATCH',
      tokensTotal: 1420,
      width,
      height,
    },
    [
      {
        type: 'alert',
        content: 'Baixa afinidade semântica: conceitos do domínio ativos não foram encontrados no projeto.\nPressione [Ctrl+D] para trocar ontologia ou [Ctrl+G] para desabilitar o harness.',
      },
      { type: 'user', content: 'Calcular raiz quadrada de 144' },
    ],
    '[Type your prompt here...]',
    width,
    height
  );

  assert.ok(tui.includes('[!] DOMAIN MISMATCH'), 'Must render DOMAIN MISMATCH badge');
  assert.ok(tui.includes('[!] mismatch'), 'Must render mismatch indicator in ontology line');
  assert.ok(tui.includes('[!] [Semantic Domain Alert]'), 'Must render alert chat entry header');
  assert.ok(tui.includes('Baixa afinidade semântica'), 'Must render alert chat content');
  assert.equal(tui.split('\n').length, height, 'Must maintain exact fixed height');
});

test('TUI render: renders prompt violation badge and warning entry with Enter prompt', () => {
  const width = 96;
  const height = 26;

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 1420,
      width,
      height,
    },
    [
      {
        type: 'user',
        content: 'Transfer retired asset AST-002 to Maintenance department without justification',
        isViolating: true,
      },
      {
        type: 'prompt_violation',
        violationShape: 'TransferShape (ex:TransferenciaShape)',
        violationRule: 'Invariante de Ciclo de Vida: Ativo baixado não pode ser transferido.',
        content: 'O prompt solicita a transferência de um ativo em estado Baixado/Retired.',
        waitingConfirmation: true,
      },
    ],
    '[Enter para prosseguir /cancel para abortar] >',
    width,
    height
  );

  assert.ok(tui.includes('[!] VIOLATION DETECTED'), 'Must highlight violating user prompt');
  assert.ok(tui.includes('[!] [PROMPT VIOLATION DETECTED]'), 'Must render prompt violation header');
  assert.ok(tui.includes('TransferShape'), 'Must show violated shape');
  assert.ok(tui.includes('Pressione [Enter] para prosseguir'), 'Must prompt user for confirmation');
  assert.ok(tui.includes('[ESC] / /cancel'), 'Must show [ESC] as alternative to cancel confirmation');
  assert.equal(tui.split('\n').length, height, 'Must maintain exact fixed height');
});

test('TUI render: renders visual scrollbar track and thumb when content exceeds viewport', () => {
  const width = 80;
  const height = 20; // 4 header lines + 5 footer lines = 9 chrome lines => viewportHeight = 11

  const entries = [];
  for (let i = 1; i <= 25; i++) {
    entries.push({ type: 'user', content: `Message #${i}` });
  }

  // Render bottom (scrollOffset = 0)
  const bottomTui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 100, width, height, scrollOffset: 0 },
    entries,
    '>',
    width,
    height
  );

  // Must contain thumb block '█' and track '│'
  assert.ok(bottomTui.includes('█'), 'Must render scrollbar thumb block');
  assert.ok(bottomTui.includes('│'), 'Must render scrollbar track');

  // Verify all lines preserve width
  const lines = bottomTui.split('\n');
  assert.equal(lines.length, height);
  for (const l of lines) {
    assert.equal(stripAnsi(l).length, width);
  }

  // When scrolled to top (scrollOffset = 99999 clamped to maxScroll)
  const topTui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 100, width, height, scrollOffset: 99999 },
    entries,
    '>',
    width,
    height
  );
  const topLines = topTui.split('\n');
  // First viewport line is line 3 (0-indexed: lines 0..2 are header)
  assert.ok(topLines[3].includes('█'), 'Top of viewport must contain thumb when scrolled to top');
});

test('TUI render: renders implementation_receipt with modified files and line counts', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 500, width, height },
    [
      {
        type: 'implementation_receipt',
        receiptHasChanges: true,
        receiptFiles: [
          { path: 'src/assets/domain/ativo.ts', linesAdded: 15, linesRemoved: 2 },
          { path: 'src/assets/infrastructure/asset-http-server.ts', linesAdded: 25, linesRemoved: 0 },
        ],
        receiptTotalAdded: 40,
        receiptTotalRemoved: 2,
      },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('[✔ IMPLEMENTAÇÃO REALIZADA]'), 'Must render implementation header');
  assert.ok(clean.includes('[Arquivos Modificados: 2]'), 'Must show file count');
  assert.ok(clean.includes('src/assets/domain/ativo.ts (+15 / -2)'), 'Must list file stats');
  assert.ok(clean.includes('+40 / -2 linhas'), 'Must list total lines added/removed');
  assert.equal(tui.split('\n').length, height, 'Must maintain exact fixed height');
});

test('TUI render: renders implementation_receipt diagnostic when no files were changed', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 500, width, height },
    [
      {
        type: 'implementation_receipt',
        receiptHasChanges: false,
        receiptFiles: [],
        receiptTotalAdded: 0,
        receiptTotalRemoved: 0,
      },
    ],
    '>',
    width,
    height
  );

  assert.ok(tui.includes('[ℹ LEITURA / DIAGNÓSTICO]'), 'Must render diagnostic indicator');
  assert.ok(tui.includes('Nenhuma alteração foi gravada em arquivos nesta resposta'), 'Must explain no files changed');
  assert.equal(tui.split('\n').length, height, 'Must maintain exact fixed height');
});

test('TUI render: renders queued entry indicator and queue count in footer', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      governed: true,
      tokensTotal: 500,
      queueLength: 2,
      generationDurationMs: 3450,
      generationTps: 42,
      width,
      height,
    },
    [
      { type: 'user', content: 'Primeiro prompt' },
      { type: 'user', content: 'Segundo prompt enfileirado', isQueued: true },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('[Na fila]'), 'Must render [Na fila] badge for queued user entry');
  assert.ok(clean.includes('[Queue: 2]'), 'Must render [Queue: 2] badge in footer status');
  assert.ok(clean.includes('3.5s (42 tps)'), 'Must render duration and TPS metrics');
  assert.ok(clean.includes('[ESC ESC]'), 'Must render ESC ESC shortcut hint');
  assert.ok(clean.includes('[^C]'), 'Must render Ctrl+C shortcut hint');
  assert.equal(tui.split('\n').length, height, 'Must maintain exact fixed height');
});

test('TUI render: renders collapsed reasoning entry with tokens and duration summary', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-r1', governed: true, tokensTotal: 800, width, height },
    [
      {
        type: 'reasoning',
        content: 'Pensando profundamente sobre os requisitos ontológicos e classes SHACL...',
        reasoningCollapsed: true,
        reasoningTokens: 320,
        reasoningDurationMs: 1400,
      },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('▼ [Raciocínio: ~320 tokens · 1.4s]'), 'Must render collapsed reasoning header');
  assert.ok(clean.includes('[Ctrl+O expandir]'), 'Must render expand shortcut hint');
  assert.ok(!clean.includes('Pensando profundamente'), 'Collapsed reasoning must hide body content');
  assert.equal(tui.split('\n').length, height, 'Must preserve invariant height');
});

test('TUI render: renders expanded reasoning entry with visible body content', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-r1', governed: true, tokensTotal: 800, width, height },
    [
      {
        type: 'reasoning',
        content: 'Análise detalhada de invariantes ontológicos para o domínio ativos.',
        reasoningCollapsed: false,
        reasoningTokens: 320,
        reasoningDurationMs: 1400,
      },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('▲ [Raciocínio: ~320 tokens · 1.4s]'), 'Must render expanded reasoning header');
  assert.ok(clean.includes('Análise detalhada de invariantes ontológicos'), 'Must render reasoning body when expanded');
  assert.ok(clean.includes('[Ctrl+O recolher]'), 'Must render collapse shortcut hint');
  assert.equal(tui.split('\n').length, height, 'Must preserve invariant height');
});

test('TUI render: renders real-time incremental diff_preview card', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 500, width, height },
    [
      {
        type: 'diff_preview',
        diffFiles: [
          { path: 'src/assets/domain/ativo.ts', linesAdded: 12, linesRemoved: 3 },
          { path: 'src/assets/infrastructure/http.ts', linesAdded: 18, linesRemoved: 0 },
        ],
        diffTotalAdded: 30,
        diffTotalRemoved: 3,
      },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('[Δ DIFF PREVIEW]'), 'Must render diff preview card header');
  assert.ok(clean.includes('2 arquivos alterados (+30 / -3)'), 'Must show diff summary totals');
  assert.ok(clean.includes('src/assets/domain/ativo.ts (+12 / -3)'), 'Must list modified file stats');
  assert.equal(tui.split('\n').length, height, 'Must maintain exact fixed height');
});

test('TUI render: formatActionStep formats semantic action verbs correctly', () => {
  assert.deepEqual(formatActionStep('read_file', { path: 'src/domain/asset.ts' }), {
    action: '○ Reading',
    target: 'src/domain/asset.ts',
    isEdit: false,
    isCommand: false,
    isOntology: false,
  });

  assert.deepEqual(formatActionStep('replace_file_content', '{"path":"src/routes.ts"}'), {
    action: '● Editing',
    target: 'src/routes.ts',
    isEdit: true,
    isCommand: false,
    isOntology: false,
  });

  assert.deepEqual(formatActionStep('run_bash_command', { command: 'npm test' }), {
    action: '$',
    target: 'npm test',
    isEdit: false,
    isCommand: true,
    isOntology: false,
  });

  assert.deepEqual(formatActionStep('search_code', { query: 'TransferShape' }), {
    action: '○ Searching codebase for',
    target: '"TransferShape"',
    isEdit: false,
    isCommand: false,
    isOntology: false,
  });

  assert.deepEqual(formatActionStep('bsh_query_ontology', { domain: 'ativos' }), {
    action: '◈ Querying ontology',
    target: 'ativos',
    isEdit: false,
    isCommand: false,
    isOntology: true,
  });
});

test('TUI render: Given BSH-TUI-005 When in concise mode Then semantic action verbs are rendered without raw Tool prefixes', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 500, width, height },
    [
      { type: 'tool', toolName: 'read_file', toolArgs: { path: 'src/domain/asset.ts' } },
      { type: 'tool', toolName: 'replace_file_content', toolArgs: { path: 'src/routes/transfer.ts' } },
      { type: 'tool', toolName: 'run_bash_command', toolArgs: { command: 'git status' } },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('○ Reading src/domain/asset.ts'), 'Must render action verb Reading');
  assert.ok(clean.includes('● Editing src/routes/transfer.ts'), 'Must render action verb Editing');
  assert.ok(clean.includes('$ git status'), 'Must render action verb $ for bash command');
  assert.ok(!clean.includes('>_ Tool:'), 'Concise mode must NOT render raw >_ Tool: label');
  assert.equal(tui.split('\n').length, height, 'Must maintain fixed height');
});

test('TUI render: Given BSH-TUI-014 When verbose flag is active Then literal Tool invocation and tool_result are rendered', () => {
  const width = 96;
  const height = 24;

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 500, width, height },
    [
      { type: 'tool', toolName: 'read_file', toolArgs: { path: 'src/domain/asset.ts' }, verbose: true },
      { type: 'tool_result', content: 'export async function getAsset() {}', verbose: true },
    ],
    '>',
    width,
    height
  );

  const clean = stripAnsi(tui);
  assert.ok(clean.includes('>_ Tool: read_file("src/domain/asset.ts")'), 'Verbose mode must render literal Tool invocation');
  assert.ok(clean.includes('-> export async function getAsset() {}'), 'Verbose mode must render raw tool result');
  assert.equal(tui.split('\n').length, height, 'Must maintain fixed height');
});

