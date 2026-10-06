import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WorkspaceToolExecutor } from '../../dist/agent/tools.js';
import { runAgentTurn, isActionPrompt } from '../../dist/agent/agentLoop.js';

test('Given WorkspaceToolExecutor When write_file, read_file and replace_file_content are called Then operations succeed inside workspace', async () => {
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

test('Given WorkspaceToolExecutor When path traversal is attempted Then it is blocked', async () => {
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

test('Given runAgentTurn When model emits a tool call Then tool is executed and turn finishes', async () => {
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
    const result = await runAgentTurn({ contextLength: 131072,
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

test('Given isActionPrompt When evaluating imperative coding requests vs informational questions Then classifies correctly', () => {
  // Imperative action requests
  assert.equal(isActionPrompt('faça um endpoint pra transferir um ativo não baixado'), true);
  assert.equal(isActionPrompt('crie uma rota de exclusão no servidor HTTP'), true);
  assert.equal(isActionPrompt('implemente a regra de compatibilidade no código'), true);
  assert.equal(isActionPrompt('adicione a função transferAsset em asset-service.ts'), true);
  assert.equal(isActionPrompt('make an endpoint to transfer assets'), true);
  assert.equal(isActionPrompt('create a delete route for retired assets'), true);

  // Informational or pure questions
  assert.equal(isActionPrompt('como funciona a regra de transferência de ativos?'), false);
  assert.equal(isActionPrompt('onde fica o arquivo ontology.jsonld?'), false);
  assert.equal(isActionPrompt('quantos shapes existem no domínio ativos?'), false);
  assert.equal(isActionPrompt(''), false);
});

test('Given an action refused by a business rule When the model ends without tools Then no automatic mutation retry is inserted', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-refusal-test-'));
  try {
    let calls = 0;
    const mockClient = {
      async *streamChat() {
        calls++;
        yield { delta: { content: 'The business rule forbids this operation. No files were changed.' } };
      },
    };
    const result = await runAgentTurn({ contextLength: 131072, client: mockClient, model: 'fixture', workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Implement the forbidden operation' }] });
    assert.equal(calls, 1);
    assert.deepEqual(result.modifiedFiles, []);
    assert.equal(result.toolCallsExecuted, 0);
    assert.equal(result.allMessages.filter((message) => message.role === 'user').length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given runAgentTurn When model generates explanation before tool call Then onAssistantMessage is invoked', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-agent-msg-test-'));
  try {
    let callIndex = 0;
    const mockClient = {
      async *streamChat() {
        callIndex++;
        if (callIndex === 1) {
          // Model explains its intent AND invokes a tool
          yield { delta: { content: 'Vou criar o arquivo de configuração solicitado.' } };
          yield {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({ path: 'config.json', content: '{}' }),
                  },
                },
              ],
            },
          };
        } else {
          yield { delta: { content: 'Configuração criada com sucesso.' } };
        }
      },
    };

    const intermediateMessages = [];
    const result = await runAgentTurn({ contextLength: 131072,
      client: mockClient,
      model: 'deepseek/deepseek-chat',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'crie a configuração' }],
      onAssistantMessage: (msg) => intermediateMessages.push(msg),
    });

    assert.equal(result.completed, true);
    assert.equal(intermediateMessages.length, 1);
    assert.equal(intermediateMessages[0].content, 'Vou criar o arquivo de configuração solicitado.');
    assert.equal(intermediateMessages[0].intermediate, true);
    assert.equal(result.finalAssistantMessage.content, 'Configuração criada com sucesso.');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});


