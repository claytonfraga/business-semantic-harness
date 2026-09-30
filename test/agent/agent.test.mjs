import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceToolExecutor } from '../../dist/agent/tools.js';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';

test('Given WorkspaceToolExecutor, when write_file, read_file and replace_file_content are called, then operations succeed inside workspace', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-tools-test-'));
  try {
    const executor = new WorkspaceToolExecutor(tempDir);

    const writeRes = await executor.executeTool('write_file', {
      path: 'test.txt',
      content: 'Hello World from BSH!',
    });
    assert.match(writeRes, /Successfully wrote/);

    const readRes = await executor.executeTool('read_file', { path: 'test.txt' });
    assert.equal(readRes, 'Hello World from BSH!');

    const patchRes = await executor.executeTool('replace_file_content', {
      path: 'test.txt',
      target_content: 'World',
      replacement_content: 'OpenRouter',
    });
    assert.match(patchRes, /Successfully replaced/);

    const updatedRes = await executor.executeTool('read_file', { path: 'test.txt' });
    assert.equal(updatedRes, 'Hello OpenRouter from BSH!');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given WorkspaceToolExecutor, when path traversal is attempted, then it is blocked', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-escape-test-'));
  try {
    const executor = new WorkspaceToolExecutor(tempDir);
    await assert.rejects(
      async () => {
        await executor.executeTool('read_file', { path: '../secret.txt' });
      },
      /Path escapes workspace/
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given runAgentTurn, when model emits a tool call, then tool is executed and turn finishes', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-agent-test-'));
  try {
    let callIndex = 0;
    const mockClient = {
      async *streamChat() {
        callIndex++;
        if (callIndex === 1) {
          // First turn: model requests write_file
          yield {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({ path: 'auto.txt', content: 'Agent generated file' }),
                  },
                },
              ],
            },
          };
        } else {
          // Second turn: model answers after tool result
          yield {
            delta: {
              content: 'I created the requested file.',
            },
          };
        }
      },
    };

    const toolEvents = [];
    const result = await runAgentTurn({
      client: mockClient,
      model: 'deepseek/deepseek-chat',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Create auto.txt' }],
      onToolCallDone: (e) => toolEvents.push(e),
    });

    assert.equal(result.completed, true);
    assert.equal(result.turnsExecuted, 2);
    assert.equal(toolEvents.length, 1);
    assert.equal(toolEvents[0].name, 'write_file');
    assert.equal(result.finalAssistantMessage.content, 'I created the requested file.');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
