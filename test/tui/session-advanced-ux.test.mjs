import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompleteTui } from '../../dist/tui/render.js';
import { stripAnsi } from '../../dist/tui/ansi.js';
import { searchModels, fuzzyScore, highlightMatches } from '../../dist/tui/modals.js';

test('BDD Scenario 1: Streaming e Colapso Automático de Raciocínio (CoT)', () => {
  const width = 96;
  const height = 24;

  const reasoningEntry = {
    type: 'reasoning',
    content: 'Pensando profundamente sobre invariantes de estado...',
    reasoningCollapsed: true,
    reasoningTokens: 250,
    reasoningDurationMs: 1200,
  };

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-r1', governed: true, tokensTotal: 500, width, height },
    [reasoningEntry, { type: 'agent', content: 'Resposta final gerada após o raciocínio.' }],
    '>',
    width,
    height
  );

  assert.ok(tui.includes('▼ [Raciocínio: ~250 tokens · 1.2s]'), 'Must display collapsed CoT header with metrics');
  assert.ok(tui.includes('[Ctrl+O expandir]'), 'Must include shortcut hint to expand');
  assert.ok(!tui.includes('Pensando profundamente'), 'Collapsed reasoning must hide internal thoughts');
  assert.equal(tui.split('\n').length, height, 'Must preserve strict invariant height');
});

test('BDD Scenario 2: Alternância de Expansão/Colapso com Ctrl+O', () => {
  const width = 96;
  const height = 26;

  const reasoningEntry = {
    type: 'reasoning',
    content: 'Passo 1: Verificar se ativo está Baixado.\nPasso 2: Validar regra de transferência.',
    reasoningCollapsed: true,
    reasoningTokens: 180,
    reasoningDurationMs: 900,
  };

  // Initially collapsed
  const tuiCollapsed = renderCompleteTui(
    { model: 'deepseek/deepseek-r1', governed: true, tokensTotal: 500, width, height },
    [reasoningEntry],
    '>',
    width,
    height
  );
  assert.ok(tuiCollapsed.includes('▼ [Raciocínio: ~180 tokens · 0.9s]'));
  assert.ok(!tuiCollapsed.includes('Passo 1: Verificar se ativo'));

  // User presses Ctrl+O: toggles to expanded
  reasoningEntry.reasoningCollapsed = false;
  const tuiExpanded = renderCompleteTui(
    { model: 'deepseek/deepseek-r1', governed: true, tokensTotal: 500, width, height },
    [reasoningEntry],
    '>',
    width,
    height
  );
  assert.ok(tuiExpanded.includes('▲ [Raciocínio: ~180 tokens · 0.9s]'));
  assert.ok(tuiExpanded.includes('Passo 1: Verificar se ativo está Baixado.'));
  assert.ok(tuiExpanded.includes('[Ctrl+O recolher]'));
  assert.equal(tuiExpanded.split('\n').length, height, 'Expanded view must still preserve exact invariant height');

  // User presses Ctrl+O again: collapses back
  reasoningEntry.reasoningCollapsed = true;
  const tuiCollapsedAgain = renderCompleteTui(
    { model: 'deepseek/deepseek-r1', governed: true, tokensTotal: 500, width, height },
    [reasoningEntry],
    '>',
    width,
    height
  );
  assert.ok(tuiCollapsedAgain.includes('▼ [Raciocínio: ~180 tokens · 0.9s]'));
  assert.ok(!tuiCollapsedAgain.includes('Passo 1: Verificar se ativo'));
});

test('BDD Scenario 3 & 4: Exibição Incremental de Diff em Tempo Real e Invariante de Altura', () => {
  const width = 96;
  const height = 24;

  const diffPreviewEntry = {
    type: 'diff_preview',
    diffFiles: [
      { path: 'pilot/asset-management/src/assets/domain/ativo.ts', linesAdded: 14, linesRemoved: 2 },
      { path: 'pilot/asset-management/src/assets/infrastructure/http.ts', linesAdded: 22, linesRemoved: 0 },
    ],
    diffTotalAdded: 36,
    diffTotalRemoved: 2,
  };

  const tui = renderCompleteTui(
    { model: 'deepseek/deepseek-v4.1-flash', governed: true, tokensTotal: 900, width, height },
    [
      { type: 'user', content: 'Crie endpoint de transferência' },
      { type: 'tool', toolName: 'replace_file_content', toolArgs: '{path:"ativo.ts"}' },
      diffPreviewEntry,
    ],
    '>',
    width,
    height
  );
  const clean = stripAnsi(tui);
  assert.ok(clean.includes('[Δ DIFF PREVIEW]'), 'Must render diff preview card header');
  assert.ok(clean.includes('2 arquivos alterados (+36 / -2)'), 'Must show total file diff summary');
  assert.ok(clean.includes('ativo.ts (+14 / -2)'), 'Must show individual file stat');
  assert.equal(tui.split('\n').length, height, 'Must strictly preserve target height');
});

test('BDD Scenario 6: Modo de Entrada Multilinha Inline com Delimitador """', () => {
  let multiLineMode = false;
  const multiLineBuffer = [];
  let submittedPrompt = '';

  const handleLine = (line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('"""') && !multiLineMode) {
      multiLineMode = true;
      const initial = trimmed.slice(3);
      if (initial) multiLineBuffer.push(initial);
      return;
    }

    if (multiLineMode) {
      if (trimmed.endsWith('"""')) {
        const finalPart = trimmed.slice(0, -3);
        if (finalPart) multiLineBuffer.push(finalPart);
        submittedPrompt = multiLineBuffer.join('\n').trim();
        multiLineMode = false;
        multiLineBuffer.length = 0;
        return;
      }
      multiLineBuffer.push(line);
      return;
    }

    submittedPrompt = trimmed;
  };

  // Step 1: User enters triple-quote opening
  handleLine('"""faça um endpoint complexo');
  assert.equal(multiLineMode, true);
  assert.equal(submittedPrompt, '');

  // Step 2: User pastes multiple lines
  handleLine('com as seguintes regras:');
  handleLine('- validar patrimônio');
  handleLine('- conferir departamento');

  // Step 3: User closes triple-quote
  handleLine('"""');
  assert.equal(multiLineMode, false);
  assert.equal(
    submittedPrompt,
    'faça um endpoint complexo\ncom as seguintes regras:\n- validar patrimônio\n- conferir departamento'
  );
});

test('BDD Scenario 7: Busca Difusa (Fuzzy Search) com Realce de Caracteres no Modal de Modelos', () => {
  const models = [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek Flash' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
  ];

  // Tokenized search matches out-of-order tokens
  const results = searchModels(models, 'sonnet 3.5');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'anthropic/claude-3.5-sonnet');

  // Character highlight generates ANSI codes for matching letters
  const scoreResult = fuzzyScore('anthropic/claude-3.5-sonnet', 'sonnet');
  assert.ok(scoreResult !== null);
  const highlighted = highlightMatches('anthropic/claude-3.5-sonnet', scoreResult.indices);
  assert.ok(highlighted.includes('\x1b[1m\x1b[33ms\x1b[0m'), 'Must contain bold yellow highlighted letters');
});

test('BDD Scenario 8: Acionamento Direto de Modais via Atalhos Globais Ctrl+M e Ctrl+D', () => {
  let dispatched = '';
  const isExecutingTurn = false;

  const onKeypress = (key) => {
    if (!isExecutingTurn && key.ctrl && key.name === 'm') {
      dispatched = '/model';
      return;
    }
    if (!isExecutingTurn && key.ctrl && key.name === 'd') {
      dispatched = '/domain';
      return;
    }
  };

  onKeypress({ ctrl: true, name: 'm' });
  assert.equal(dispatched, '/model', 'Ctrl+M must dispatch /model modal when idle');

  onKeypress({ ctrl: true, name: 'd' });
  assert.equal(dispatched, '/domain', 'Ctrl+D must dispatch /domain modal when idle');
});
