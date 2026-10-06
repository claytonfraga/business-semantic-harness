import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { WorkspaceToolExecutor, AGENT_TOOLS } from '../../dist/agent/tools.js';
import { inspectWorkspace } from '../../dist/agent/workspaceContext.js';
import { buildCodingAgentSystemPrompt, runAgentTurn } from '../../dist/agent/agentLoop.js';
import { evaluateWorkspaceDiffGate } from '../../dist/enforcement/diffGate.js';

test('Given a BSH session in a project workspace, when discovering context, then technologies and structure are indexed and search_code/find_files locate symbols', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-e2e-context-'));
  try {
    mkdirSync(join(tempDir, 'src', 'services'), { recursive: true });
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'asset-service',
        description: 'Governed asset management service',
        scripts: { test: 'node --test', quality: 'biome lint src' },
      })
    );
    writeFileSync(
      join(tempDir, 'src', 'services', 'transfer.ts'),
      'export function transferAsset(assetId: string, toDept: string) {\n  return { assetId, toDept, status: "TRANSFERRED" };\n}\n'
    );

    // Context discovery
    const summary = await inspectWorkspace(tempDir);
    assert.ok(summary.detectedTechnologies.includes('Node.js / npm'));
    assert.equal(summary.projectName, 'asset-service');
    assert.ok(summary.scripts.test);

    // Tools discovery
    const executor = new WorkspaceToolExecutor(tempDir);
    const searchRes = await executor.executeTool('search_code', { query: 'transferAsset' });
    assert.ok(searchRes.includes('transfer.ts:1: export function transferAsset'));

    const findRes = await executor.executeTool('find_files', { pattern: 'transfer' });
    assert.ok(findRes.includes('src/services/transfer.ts'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given a code modification task, when the agent loop executes tools, then files are modified and modifiedFiles tracking records the change', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-e2e-loop-'));
  try {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'math.ts'), 'export function add(a: number, b: number) { return a - b; }\n');

    const fakeClient = {
      streamChat: async function* () {
        // Turn 1: model calls replace_file_content to fix the bug
        yield {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_replace_1',
                function: {
                  name: 'replace_file_content',
                  arguments: JSON.stringify({
                    path: 'src/math.ts',
                    target_content: 'return a - b;',
                    replacement_content: 'return a + b;',
                  }),
                },
              },
            ],
          },
        };
      },
    };

    const clientWithFinal = {
      _calls: 0,
      streamChat: async function* () {
        clientWithFinal._calls++;
        if (clientWithFinal._calls === 1) {
          yield {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_replace_1',
                  function: {
                    name: 'replace_file_content',
                    arguments: JSON.stringify({
                      path: 'src/math.ts',
                      target_content: 'return a - b;',
                      replacement_content: 'return a + b;',
                    }),
                  },
                },
              ],
            },
          };
        } else {
          yield {
            delta: {
              content: 'Bug corrigido com sucesso via replace_file_content. A função agora retorna a + b.',
            },
          };
        }
      },
    };

    const turnResult = await runAgentTurn({ contextLength: 131072,
      client: clientWithFinal,
      model: 'test-model',
      workspaceRoot: tempDir,
      messages: [{ role: 'user', content: 'Corrija a função add em src/math.ts' }],
      systemPrompt: buildCodingAgentSystemPrompt({}),
    });

    assert.equal(turnResult.completed, true);
    assert.ok(turnResult.modifiedFiles.includes('src/math.ts'), 'Deve registrar src/math.ts como modificado');
    assert.equal(turnResult.toolCallsExecuted, 1);

    const executor = new WorkspaceToolExecutor(tempDir);
    const content = await executor.executeTool('read_file', { path: 'src/math.ts' });
    assert.ok(content.includes('return a + b;'), 'O arquivo real deve ter sido corrigido no workspace');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given git workspace modifications, when evaluated by evaluateWorkspaceDiffGate, then conforming code changes pass the semantic gate', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-e2e-gate-'));
  try {
    spawnSync('git', ['init'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.name', 'BSH Agent'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.email', 'agent@bsh.dev'], { cwd: tempDir });
    writeFileSync(join(tempDir, 'asset.ts'), '// initial\n');
    spawnSync('git', ['add', '.'], { cwd: tempDir });
    spawnSync('git', ['commit', '-m', 'initial commit'], { cwd: tempDir });

    // Modificação concreta de código aderente
    writeFileSync(
      join(tempDir, 'asset.ts'),
      'export function transfer(asset: any, newOwner: string, justification: string) {\n  return { ...asset, owner: newOwner, justification, status: "Transferred" };\n}\n'
    );

    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: tempDir,
      projectRoot: tempDir,
      domainId: 'patrimonio',
    });

    assert.equal(gateResult.hasChanges, true);
    assert.equal(gateResult.conforming, true);
    assert.equal(gateResult.gateStatus, 'CONFORMING');
    assert.ok(gateResult.filesChanged.includes('asset.ts'));
    assert.ok(gateResult.checks.some((c) => c.ok && c.text.includes('Modificações concretas aplicadas')));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
