// Requirements: BSH-PREP-008, BSH-PREP-009.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ApprovalBroker } from '../../dist/decision/broker.js';
import { WorkspaceToolExecutor } from '../../dist/agent/tools.js';
import { McpClientManager } from '../../dist/mcp/clientManager.js';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';
import { writeFile } from 'node:fs/promises';

async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-production-broker-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('Given host-declared read-only MCP effects When authorization runs Then reading is allowed without a human prompt', async () => workspace(async (root) => {
  let questions = 0;
  const broker = new ApprovalBroker(root, async () => {
    questions++;
    return { choice: 'deny', actor: 'reviewer', reason: 'Unexpected question' };
  });
  let guardCalls = 0;
  broker.setRequestGuard(async () => { guardCalls++; });
  const result = await broker.authorizeToolCall({ tool: 'catalog_lookup', args: { id: 1 }, readOnly: true });
  assert.equal(result.allowed, true);
  assert.equal(questions, 0);
  assert.equal(guardCalls, 1);
}));

test('Given an MCP tool with unknown effects and benign name When authorization runs Then review is required and its action cannot be reused', async () => workspace(async (root) => {
  let questions = 0;
  const broker = new ApprovalBroker(root, async () => {
    questions++;
    return { choice: 'allow-once', actor: 'reviewer', reason: 'Inspected bounded call' };
  });
  const call = { tool: 'catalog_lookup', args: { id: 1 }, actionId: 'call-unknown-effects' };
  assert.equal((await broker.authorizeToolCall(call)).allowed, true);
  assert.equal((await broker.authorizeToolCall(call)).allowed, false);
  assert.equal(questions, 1);
}));

test('Given a stale prepared request When a native write reaches the host executor Then the guard prevents all writes and review', async () => workspace(async (root) => {
  let questions = 0;
  const broker = new ApprovalBroker(root, async () => {
    questions++;
    return { choice: 'allow-once', actor: 'reviewer', reason: 'Should not run' };
  });
  broker.setRequestGuard(async () => { throw new Error('Prepared contract snapshot changed'); });
  const executor = new WorkspaceToolExecutor(root);
  executor.setBroker(broker);
  await assert.rejects(executor.executeTool('write_file', { path: 'forbidden.txt', content: 'x' }), /snapshot changed/);
  await assert.rejects(readFile(join(root, 'forbidden.txt')), { code: 'ENOENT' });
  assert.equal(questions, 0);
}));

test('Given review pending When the prepared contract changes or arguments change Then approval cannot authorize the changed action', async () => workspace(async (root) => {
  let unchanged = true;
  const args = { path: 'authorized.txt', content: 'expected' };
  const broker = new ApprovalBroker(root, async () => {
    unchanged = false;
    return { choice: 'allow-once', actor: 'reviewer', reason: 'Approved initial action' };
  });
  broker.setRequestGuard(async () => { if (!unchanged) throw new Error('Prepared contract snapshot changed'); });
  const result = await broker.authorizeToolCall({ tool: 'write_file', args });
  assert.equal(result.allowed, false);
  assert.match(result.reason, /snapshot changed/);
  const argumentBroker = new ApprovalBroker(root, async () => {
    args.path = 'different.txt';
    return { choice: 'allow-once', actor: 'reviewer', reason: 'Approved initial action' };
  });
  const changed = await argumentBroker.authorizeToolCall({ tool: 'write_file', args });
  assert.equal(changed.allowed, false);
  assert.match(changed.reason, /arguments changed/);
}));

for (const dispatch of ['native', 'MCP']) {
  test(`Given host approval for one ${dispatch} action When the agent dispatches it Then the host asks once and executes once`, async () => workspace(async (root) => {
    let questions = 0;
    let effects = 0;
    const broker = new ApprovalBroker(root, async () => {
      questions++;
      return { choice: 'allow-once', actor: 'reviewer', reason: 'Authorized this exact action' };
    });
    const manager = new McpClientManager();
    const tool = dispatch === 'native' ? 'write_file' : 'synthetic_write_file';
    if (dispatch === 'MCP') {
      // The remote transport is controlled; actual host dispatch and broker run.
      manager.tools.set(tool, {
        serverName: 'synthetic', originalName: 'write_file', scopedName: tool, readOnly: false,
        definition: { type: 'function', function: { name: tool, description: 'Synthetic transport', parameters: {} } },
      });
      manager.clients.set('synthetic', {
        client: { async callTool({ arguments: args }) {
          effects++;
          await writeFile(join(root, args.path), args.content);
          return { content: [{ type: 'text', text: 'Written' }] };
        } }, transport: {}, config: { command: 'synthetic-controlled-transport' },
      });
    }
    let calls = 0;
    const client = { async *streamChat() {
      calls++;
      if (calls === 1) {
        yield { delta: { tool_calls: [{ index: 0, id: `exact-${dispatch}-call`, function: {
          name: tool, arguments: JSON.stringify({ path: 'once.txt', content: 'authorized' }),
        } }] } };
      } else yield { delta: { content: 'Finished' } };
    } };
    await runAgentTurn({ client, model: 'controlled-selected-model', workspaceRoot: root,
      broker, mcpManager: manager, domain: 'synthetic', maxTurns: 2,
      messages: [{ role: 'user', content: 'Create once.txt' }],
    });
    assert.equal(questions, 1);
    assert.equal(await readFile(join(root, 'once.txt'), 'utf8'), 'authorized');
    if (dispatch === 'MCP') assert.equal(effects, 1);
  }));
}
