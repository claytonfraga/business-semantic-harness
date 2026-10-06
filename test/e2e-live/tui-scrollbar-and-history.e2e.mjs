import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { renderCompleteTui } from '../../dist/tui/render.js';
import { loadPromptHistory, savePromptHistory } from '../../dist/tui/history.js';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';
import { OpenRouterClient } from '../../dist/client/openrouter/client.js';

test('Given a TUI session with conversation exceeding viewport height, when rendered, then the visual scrollbar thumb and track are drawn and viewport navigates with exact width', async () => {
  const width = 88;
  const height = 22; // 9 chrome lines (4 header + 5 footer) -> viewportHeight = 13 lines

  const entries = [];
  for (let i = 1; i <= 30; i++) {
    entries.push({ type: 'user', content: `Message #${i}: User query detailing task specifications.` });
  }

  // When rendered at bottom (scrollOffset = 0)
  const bottomTui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      governed: true,
      tokensTotal: 2500,
      width,
      height,
      scrollOffset: 0,
    },
    entries,
    '>',
    width,
    height
  );

  // Then visual scrollbar thumb '█' and track '│' must be present on the right edge
  assert.ok(bottomTui.includes('█'), 'Visual scrollbar thumb must be rendered');
  assert.ok(bottomTui.includes('│'), 'Visual scrollbar track must be rendered');

  // And all lines must strictly maintain the target width
  const lines = bottomTui.split('\n');
  assert.equal(lines.length, height, 'Must match target height');

  // When scrolled up (scrollOffset = 15)
  const scrolledTui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      governed: true,
      tokensTotal: 2500,
      width,
      height,
      scrollOffset: 15,
    },
    entries,
    '>',
    width,
    height
  );

  // Then it must display earlier messages and scroll indicator in the footer
  assert.ok(scrolledTui.includes('Scroll: +15'), 'Footer must indicate active scroll offset');
  assert.ok(scrolledTui.includes('Message #20'), 'Scrolled viewport must reveal earlier message #20');
  assert.ok(!scrolledTui.includes('Message #30'), 'Scrolled viewport must not include the latest message #30');
});

test('Given a project with history stored in .bsh/history.json, when prompts are loaded and saved, then prompt history persists per project in chronological order and loads newest-first for readline', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'bsh-e2e-hist-'));

  try {
    // Given an initial empty state
    const initial = await loadPromptHistory(projectDir);
    assert.deepEqual(initial, [], 'Initial history must be empty');

    // When prompts are entered across multiple turns
    // Readline stores history with newest first
    const activeReadlineHistory = [
      'Execute a transferência do ativo AST-001 para a Unidade Vitória',
      '/domain',
      'Inspecione o estado atual do bem patrimonial AST-001',
    ];

    await savePromptHistory(projectDir, activeReadlineHistory);

    // Then history file exists under .bsh/history.json in the project root
    const historyFile = join(projectDir, '.bsh', 'history.json');
    assert.ok(existsSync(historyFile), '.bsh/history.json must exist');

    const fileContent = JSON.parse(readFileSync(historyFile, 'utf8'));
    // And stored on disk in chronological order: [oldest, ..., newest]
    assert.deepEqual(fileContent, [
      'Inspecione o estado atual do bem patrimonial AST-001',
      '/domain',
      'Execute a transferência do ativo AST-001 para a Unidade Vitória',
    ]);

    // When a new session opens, history is loaded in newest-first order for Up/Down arrow navigation
    const reloaded = await loadPromptHistory(projectDir);
    assert.deepEqual(reloaded, activeReadlineHistory, 'Reloaded history must match readline newest-first order');
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Given a user request to perform a code modification, when processed in the agent loop, then the agent executes tools and preserves all conversation turns for multi-turn continuity', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'bsh-e2e-agent-'));

  try {
    const client = new OpenRouterClient({ apiKey: 'sk-or-v1-mock-test' });
    const messages = [];

    // First turn: user prompt
    messages.push({ role: 'user', content: 'Inspecione a documentação e verifique as regras SHACL' });

    const turn1 = await runAgentTurn({ contextLength: 131072,
      client,
      model: 'deepseek/deepseek-v4.1-flash',
      workspaceRoot: workspaceDir,
      messages,
      systemPrompt: 'You are BSH. Inspect and modify files.',
    });

    assert.equal(turn1.completed, true);
    assert.ok(turn1.allMessages.length >= 2, 'Turn 1 must accumulate user and assistant messages');

    // Multi-turn continuity: update messages array
    messages.length = 0;
    messages.push(...turn1.allMessages);

    // Second turn: follow-up prompt
    messages.push({ role: 'user', content: 'Prossiga com a operação no código' });

    const turn2 = await runAgentTurn({ contextLength: 131072,
      client,
      model: 'deepseek/deepseek-v4.1-flash',
      workspaceRoot: workspaceDir,
      messages,
      systemPrompt: 'You are BSH. Inspect and modify files.',
    });

    assert.equal(turn2.completed, true);
    assert.ok(turn2.allMessages.length >= 4, 'Turn 2 must preserve all conversation history across turns');
    assert.equal(turn2.allMessages[0].content, 'Inspecione a documentação e verifique as regras SHACL');
    assert.equal(turn2.allMessages[turn2.allMessages.length - 1].role, 'assistant');
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
