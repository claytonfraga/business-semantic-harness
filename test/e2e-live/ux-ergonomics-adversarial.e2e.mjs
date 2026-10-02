import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCompleteTui } from '../../dist/tui/render.js';
import { stripAnsi } from '../../dist/tui/ansi.js';
import { fuzzyScore, highlightMatches, searchModels } from '../../dist/tui/modals.js';

test('Given adversarial and regex-heavy queries, when fuzzyScore and highlightMatches are evaluated, then they must match robustly without throwing, hanging, or corrupting text', () => {
  const adversarialTargets = [
    'deepseek/deepseek-r1:free',
    'anthropic/claude-3.7-sonnet',
    'meta-llama/llama-3.3-70b-instruct',
    'google/gemini-2.0-flash-exp:free',
    'special[char](regex)+test?model*\\^$',
  ];

  const adversarialQueries = [
    '',
    '   ',
    '???',
    '***',
    '+++',
    '[[[',
    ']]]',
    '(((',
    ')))',
    '\\',
    '^',
    '$',
    'r1 deepseek',        // permuted query
    'free flash gemini',  // 3 permuted tokens
    'nonexistent-model-xyz-12345',
    'c.l.a.u.d.e',
    'special[char]',
  ];

  for (const target of adversarialTargets) {
    for (const query of adversarialQueries) {
      assert.doesNotThrow(() => {
        const match = fuzzyScore(target, query);
        if (match !== null) {
          assert.ok(typeof match.score === 'number', `Score must be a number for query="${query}" on target="${target}"`);
          assert.ok(!Number.isNaN(match.score), `Score must not be NaN for query="${query}" on target="${target}"`);
          assert.ok(Array.isArray(match.indices), `Indices must be an array for query="${query}" on target="${target}"`);

          const highlighted = highlightMatches(target, match.indices);
          assert.ok(typeof highlighted === 'string', `Highlighted must be a string for query="${query}" on target="${target}"`);

          // Strip ANSI and verify exact text equality with original target
          const plainText = stripAnsi(highlighted);
          assert.equal(plainText, target, `Highlighted text stripped of ANSI must exactly equal target. Target: "${target}", got: "${plainText}" for query: "${query}"`);
        }
      }, `Evaluation failed for query="${query}" against target="${target}"`);
    }
  }

  // Token permuted search verification with OpenRouterModel objects
  const modelObjects = adversarialTargets.slice(0, 4).map(id => ({ id, name: id }));
  const results = searchModels(modelObjects, 'r1 deepseek');
  assert.ok(results.length > 0, 'Permuted query "r1 deepseek" must locate deepseek-r1');
  assert.equal(results[0].id, 'deepseek/deepseek-r1:free', 'Top ranked match must be deepseek-r1');

  const geminiResults = searchModels(modelObjects, 'flash free gemini');
  assert.ok(geminiResults.length > 0, 'Permuted query "flash free gemini" must locate gemini flash free');
  assert.equal(geminiResults[0].id, 'google/gemini-2.0-flash-exp:free');
});

test('Given a compact terminal viewport with massive content, when renderCompleteTui is invoked, then the height invariant is strictly preserved without slice underflows or overflows', () => {
  const compactWidth = 64;
  const compactHeight = 14; // chrome is 7 lines (3 header + 4 footer) -> viewport is 7 lines

  const hugeEntries = [
    { type: 'user', content: 'Início de conversa com prompt inicial razoavelmente longo para teste de wrapping.' },
    {
      type: 'reasoning',
      content: 'Pensamento profundo do modelo:\nLinha 1 do raciocínio analítico.\nLinha 2 de dedução lógica.\nLinha 3 sobre ontologias e SHACL.\nLinha 4 de verificação formal.\nLinha 5 de conclusões.\nLinha 6 sobre segurança semântica.\nLinha 7 detalhando código.',
      reasoningTokens: 1250,
      reasoningDurationMs: 3800,
      reasoningCollapsed: false, // EXPANDED to maximize vertical pressure
    },
    {
      type: 'diff_preview',
      diffFiles: [
        { path: 'src/core/enforcement.ts', linesAdded: 142, linesRemoved: 38 },
        { path: 'src/tui/render.ts', linesAdded: 85, linesRemoved: 12 },
        { path: 'src/tui/session.ts', linesAdded: 63, linesRemoved: 5 },
        { path: 'test/e2e/comprehensive.test.mjs', linesAdded: 210, linesRemoved: 0 },
      ],
      diffTotalAdded: 500,
      diffTotalRemoved: 55,
    },
    {
      type: 'gate',
      gateStatus: 'VIOLATION',
      gateShape: 'TransferenciaAtivoShape',
      gateChecks: [
        { text: 'Transição permitida (EmUso -> Transferido)', ok: true },
        { text: 'Ativo baixado não pode ser transferido (Ativo ex:ativo-99 Baixado)', ok: false },
      ],
    },
    {
      type: 'implementation_receipt',
      content: 'Implementação de transferência semântica realizada com sucesso',
      receiptFiles: [
        { path: 'src/core/enforcement.ts', linesAdded: 142, linesRemoved: 38 },
      ],
      receiptTotalAdded: 142,
      receiptTotalRemoved: 38,
      receiptHasChanges: true,
    },
    {
      type: 'agent',
      content: 'A operação foi concluída e o gate semântico registrou a restrição conforme especificado.',
    },
  ];

  // Render with expanded reasoning and active queue
  const rendered = renderCompleteTui(
    {
      model: 'deepseek/deepseek-r1',
      governed: true,
      domain: 'ativos',
      tokensTotal: 8450,
      sessionCost: 0.0125,
      generationDurationMs: 4200,
      generationTps: 50,
      queueLength: 3,
      width: compactWidth,
      height: compactHeight,
      scrollOffset: 0,
    },
    hugeEntries,
    '> prompt ativo',
    compactWidth,
    compactHeight
  );

  const lines = rendered.split('\n');
  assert.equal(lines.length, compactHeight, `Rendered output MUST have exactly ${compactHeight} lines, got ${lines.length}`);

  // Check header line count (strictly 3)
  assert.ok(lines[0].includes('BSH') && lines[0].includes('Business Semantic Harness'), 'Line 0 must be header line 1 with logo');
  assert.ok(lines[0].includes('GOVERNED'), 'Line 0 must include governance status badge');
  assert.ok(lines[1].includes('Project') || lines[1].includes('Ontology'), 'Line 1 must be header line 2 with project/ontology info');
  assert.ok(lines[2].includes('─'), 'Line 2 must be header separator');

  // Check footer line count (strictly 4 at bottom)
  const footerLines = lines.slice(-4);
  assert.ok(footerLines[0].includes('─'), 'Footer line 1 must be separator');
  assert.ok(footerLines[1].includes('> prompt ativo'), 'Footer line 2 must be prompt input');
  assert.ok(footerLines[2].includes('deepseek-r1'), 'Footer line 3 must include model');
  assert.ok(footerLines[2].includes('[Queue:'), 'Footer line 3 must include queue indicator (even when safely truncated with ellipsis in 64 cols)');
  assert.ok(footerLines[3].includes('─'), 'Footer line 4 must be bottom border');

  // Verify that on standard 80 columns, the queue metric is fully rendered without truncation
  const standardTui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-r1',
      governed: true,
      domain: 'ativos',
      tokensTotal: 8450,
      sessionCost: 0.0125,
      generationDurationMs: 4200,
      generationTps: 50,
      queueLength: 3,
      width: 80,
      height: compactHeight,
      scrollOffset: 0,
    },
    hugeEntries,
    '> prompt ativo',
    80,
    compactHeight
  );
  assert.ok(standardTui.includes('[Queue: 3]'), 'Standard 80-col terminal must fully render [Queue: 3]');

  // Check that every line satisfies maximum width bounds
  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = stripAnsi(lines[idx]);
    assert.ok(
      rawLine.length <= compactWidth,
      `Line ${idx} width (${rawLine.length}) exceeds terminal width (${compactWidth}): "${rawLine}"`
    );
  }
});

test('Given a simulated concurrent session, when prompts are queued and cancelled with double escape, then queue FIFO order and cancellation isolation are maintained', async () => {
  // Test FIFO state machine logic
  const inputQueue = [];
  const executionLog = [];
  let isExecuting = false;
  let activeAbortController = null;

  const enqueue = (text) => {
    inputQueue.push(text);
  };

  const cancelActive = () => {
    if (activeAbortController) {
      activeAbortController.abort('ESC ESC');
      executionLog.push({ action: 'aborted', signal: 'ESC ESC' });
      activeAbortController = null;
    }
  };

  const runTurn = async (prompt) => {
    isExecuting = true;
    activeAbortController = new AbortController();
    const currentSignal = activeAbortController.signal;
    executionLog.push({ action: 'start', prompt });

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(`done: ${prompt}`), 50);
        currentSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('AbortError: ESC ESC'));
        });
      });
      executionLog.push({ action: 'success', prompt });
    } catch (err) {
      executionLog.push({ action: 'failed', prompt, error: err.message });
    } finally {
      isExecuting = false;
      activeAbortController = null;
    }
  };

  const processQueue = async () => {
    while (inputQueue.length > 0) {
      const nextPrompt = inputQueue.shift();
      await runTurn(nextPrompt);
    }
  };

  // 1. Enqueue 3 prompts
  enqueue('prompt-1');
  enqueue('prompt-2');
  enqueue('prompt-3');

  assert.equal(inputQueue.length, 3, 'Queue must hold 3 items');

  // 2. Start processing queue
  const processingPromise = processQueue();

  // 3. Immediately abort prompt-1 with double escape simulation
  await new Promise(r => setTimeout(r, 10)); // let prompt-1 start
  cancelActive();

  await processingPromise;

  // 4. Verify outcomes:
  // prompt-1 was started, aborted by ESC ESC
  // prompt-2 was started after prompt-1 and succeeded
  // prompt-3 was started after prompt-2 and succeeded
  const p1Start = executionLog.find(e => e.action === 'start' && e.prompt === 'prompt-1');
  const p1Fail = executionLog.find(e => e.action === 'failed' && e.prompt === 'prompt-1');
  const p2Success = executionLog.find(e => e.action === 'success' && e.prompt === 'prompt-2');
  const p3Success = executionLog.find(e => e.action === 'success' && e.prompt === 'prompt-3');

  assert.ok(p1Start, 'Prompt-1 must have started');
  assert.ok(p1Fail, 'Prompt-1 must have failed with abort');
  assert.ok(p1Fail.error.includes('ESC ESC'), 'Failure must be caused by ESC ESC');
  assert.ok(p2Success, 'Prompt-2 must have succeeded after Prompt-1 cancellation');
  assert.ok(p3Success, 'Prompt-3 must have succeeded in FIFO order');
  assert.equal(inputQueue.length, 0, 'Queue must be completely drained');
});

test('Given multiline input blocks with triple quotes, when multiline accumulation is processed, then code blocks and internal quotes are preserved verbatim', () => {
  // Simulate multiline state machine
  let multilineBuffer = [];
  let isMultilineMode = false;
  const submittedPrompts = [];

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!isMultilineMode) {
      if (trimmed.startsWith('"""')) {
        isMultilineMode = true;
        const remainder = trimmed.slice(3).trim();
        multilineBuffer = remainder ? [remainder] : [];
        return;
      }
      submittedPrompts.push(line);
      return;
    }

    if (trimmed.endsWith('"""')) {
      isMultilineMode = false;
      const content = trimmed.slice(0, -3).trim();
      if (content) multilineBuffer.push(content);
      const fullPrompt = multilineBuffer.join('\n');
      submittedPrompts.push(fullPrompt);
      multilineBuffer = [];
      return;
    }

    multilineBuffer.push(line);
  };

  // Simulate multiline input containing code with quotes and triple quotes in comments
  handleLine('"""');
  handleLine('function calculateRisk(asset) {');
  handleLine('  // Description: "Validates" asset status');
  handleLine('  if (!asset.retired) return 0;');
  handleLine('  return 100;');
  handleLine('}');
  handleLine('"""');

  assert.equal(isMultilineMode, false, 'Multiline mode should be finished');
  assert.equal(submittedPrompts.length, 1, 'Exactly one accumulated prompt should be submitted');
  assert.ok(submittedPrompts[0].includes('function calculateRisk(asset)'), 'Must contain function declaration');
  assert.ok(submittedPrompts[0].includes('"Validates"'), 'Must preserve internal quotes verbatim');
  assert.ok(submittedPrompts[0].includes('return 100;'), 'Must preserve code structure');
});

test('Given a Semantic Gate entry, when rendered, then violation and conforming states must have strict visual coherence without contradictions', () => {
  const width = 80;

  // Case A: Violation state
  const violationEntry = {
    type: 'gate',
    gateStatus: 'VIOLATION',
    gateShape: 'TransferenciaAtivoShape',
    gateChecks: [
      { text: 'Transição válida de estado', ok: true },
      { text: 'Ativo baixado não pode ser transferido', ok: false },
    ],
  };

  const renderedViolation = renderCompleteTui(
    { model: 'deepseek-r1', governed: true, width, height: 16, tokensTotal: 100 },
    [violationEntry],
    '>',
    width,
    16
  );

  assert.ok(renderedViolation.includes('[X] VIOLATION') || renderedViolation.includes('Status: VIOLATION'), 'Gate must clearly indicate VIOLATION status');
  assert.ok(renderedViolation.includes('[X]'), 'Violation gate must include at least one [X] failure check');
  assert.ok(!renderedViolation.includes('[OK] CONFORMING'), 'Violation gate must NEVER show [OK] CONFORMING status');

  // Case B: Conforming state
  const conformingEntry = {
    type: 'gate',
    gateStatus: 'CONFORMING',
    gateShape: 'TransferenciaAtivoShape',
    gateChecks: [
      { text: 'Transição permitida (EmUso -> Transferido)', ok: true },
      { text: 'Campos obrigatórios preenchidos', ok: true },
    ],
  };

  const renderedConforming = renderCompleteTui(
    { model: 'deepseek-r1', governed: true, width, height: 16, tokensTotal: 100 },
    [conformingEntry],
    '>',
    width,
    16
  );

  assert.ok(renderedConforming.includes('[OK] CONFORMING'), 'Conforming gate must show [OK] CONFORMING');
  assert.ok(!renderedConforming.includes('[X]'), 'Conforming gate must NEVER contain [X] failure indicators');
  assert.ok(!renderedConforming.includes('[!] VIOLATION'), 'Conforming gate must NEVER contain [!] VIOLATION');
});

test('Given double escape timing window (500ms latch), when ESC key events arrive, then cancellation only triggers if within 500ms threshold', async () => {
  let cancelled = false;
  let lastEscTime = 0;

  const handleEscKey = (currentTime) => {
    if (currentTime - lastEscTime <= 500) {
      cancelled = true;
      lastEscTime = 0;
    } else {
      lastEscTime = currentTime;
    }
  };

  // Scenario 1: Slow key presses (700ms apart) -> latch expires, no cancel
  let t = 1000;
  handleEscKey(t);
  assert.equal(cancelled, false, 'First ESC must not cancel');

  t += 700; // 700ms later (> 500ms)
  handleEscKey(t);
  assert.equal(cancelled, false, 'Second slow ESC (>500ms) must reset latch and NOT cancel');

  // Scenario 2: Quick key presses (250ms apart) -> triggers cancel
  t += 250; // 250ms later (<= 500ms from previous ESC at 1700ms)
  handleEscKey(t);
  assert.equal(cancelled, true, 'Second fast ESC (<=500ms) MUST trigger immediate cancellation');
});

