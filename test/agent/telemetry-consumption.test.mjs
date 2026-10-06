import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';

test('Given full provider usage telemetry in stream chunks, When runAgentTurn executes, Then measured tokens are accurately parsed including cached and reasoning tokens', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-telemetry-full-'));
  try {
    const mockClient = {
      async *streamChat() {
        yield {
          delta: { content: 'Resposta do modelo com medição completa.' },
          usage: {
            prompt_tokens: 150,
            completion_tokens: 45,
            total_tokens: 195,
            cached_tokens: 50,
            reasoning_tokens: 20,
          },
        };
      },
    };

    const result = await runAgentTurn({ contextLength: 131072,
      client: mockClient,
      model: 'deepseek/deepseek-chat',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Qual o resumo do projeto?' }],
    });

    assert.equal(result.completed, true);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.status, 'MEASURED');
    assert.equal(result.telemetry.providerReported, true);
    assert.equal(result.telemetry.promptTokens, 150);
    assert.equal(result.telemetry.completionTokens, 45);
    assert.equal(result.telemetry.totalTokens, 195);
    assert.equal(result.telemetry.cachedTokens, 50);
    assert.equal(result.telemetry.reasoningTokens, 20);
    // Guarantee no fixed 1420 or 350 tokens are invented
    assert.notEqual(result.telemetry.totalTokens, 1420);
    assert.notEqual(result.telemetry.totalTokens, 350);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given partial provider usage telemetry lacking total_tokens, When runAgentTurn executes, Then total is derived from prompt and completion without guessing', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-telemetry-partial-'));
  try {
    const mockClient = {
      async *streamChat() {
        yield {
          delta: { content: 'Resposta parcial.' },
          usage: {
            prompt_tokens: 80,
            completion_tokens: 25,
          },
        };
      },
    };

    const result = await runAgentTurn({ contextLength: 131072,
      client: mockClient,
      model: 'deepseek/deepseek-chat',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Olá' }],
    });

    assert.equal(result.completed, true);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.status, 'MEASURED');
    assert.equal(result.telemetry.promptTokens, 80);
    assert.equal(result.telemetry.completionTokens, 25);
    assert.equal(result.telemetry.totalTokens, 105);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given absent provider usage telemetry, When runAgentTurn executes, Then status is reported as ESTIMATED without hardcoding arbitrary numbers', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-telemetry-none-'));
  try {
    const mockClient = {
      async *streamChat() {
        yield {
          delta: { content: 'Resposta sem objeto de uso.' },
          // usage is undefined
        };
      },
    };

    const result = await runAgentTurn({ contextLength: 131072,
      client: mockClient,
      model: 'deepseek/deepseek-chat',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Olá' }],
    });

    assert.equal(result.completed, true);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.status, 'ESTIMATED');
    assert.equal(result.telemetry.providerReported, false);
    // It should estimate based on length, not fixed constants
    assert.notEqual(result.telemetry.totalTokens, 1420);
    assert.notEqual(result.telemetry.totalTokens, 350);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given a multi-turn tool interaction, When runAgentTurn completes multiple turns, Then total tokens is the exact sum of measured turns', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-telemetry-multiturn-'));
  try {
    let call = 0;
    const mockClient = {
      async *streamChat() {
        call++;
        if (call === 1) {
          yield {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: JSON.stringify({ path: 'nonexistent.txt' }),
                  },
                },
              ],
            },
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
            },
          };
        } else {
          yield {
            delta: { content: 'Arquivo lido.' },
            usage: {
              prompt_tokens: 140,
              completion_tokens: 30,
              total_tokens: 170,
            },
          };
        }
      },
    };

    const result = await runAgentTurn({ contextLength: 131072,
      client: mockClient,
      model: 'deepseek/deepseek-chat',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Leia o arquivo' }],
    });

    assert.equal(result.completed, false);
    assert.equal(result.outcome, 'tool_error');
    assert.equal(result.turnsExecuted, 2);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.status, 'MEASURED');
    assert.equal(result.telemetry.promptTokens, 100 + 140);
    assert.equal(result.telemetry.completionTokens, 20 + 30);
    assert.equal(result.telemetry.totalTokens, 120 + 170); // 290
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
