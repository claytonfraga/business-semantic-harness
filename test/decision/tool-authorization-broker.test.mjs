import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ApprovalBroker } from '../../dist/decision/broker.js';
import { readAudit } from '../../dist/decision/audit.js';
import { WorkspaceToolExecutor } from '../../dist/agent/tools.js';
import { McpClientManager } from '../../dist/mcp/clientManager.js';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';

test('Given a mutating native tool (write_file) When the broker denies authorization Then the file is not written and the denial is audited', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-broker-test-'));
  try {
    // Broker configured with human reviewer that denies
    const broker = new ApprovalBroker(root, async () => ({
      choice: 'deny',
      actor: 'security-admin',
      reason: 'Mutating operations prohibited in audit mode',
    }));

    const executor = new WorkspaceToolExecutor(root);
    executor.setBroker(broker);

    // Direct execution via executor must not bypass broker
    await assert.rejects(
      async () => {
        await executor.executeTool('write_file', {
          path: 'prohibited.txt',
          content: 'SHOULD_NOT_BE_WRITTEN',
        });
      },
      /denied by approval broker/
    );

    // Verify file was never written
    await assert.rejects(
      async () => {
        await readFile(join(root, 'prohibited.txt'), 'utf8');
      },
      { code: 'ENOENT' }
    );

    // Verify audit event
    const events = await readAudit(root);
    const deniedEvent = events.find((e) => e.tool === 'write_file');
    assert.ok(deniedEvent, 'Audit must record denied tool call');
    assert.equal(deniedEvent.decision, 'deny');
    assert.equal(deniedEvent.tool, 'write_file');
    assert.equal(deniedEvent.result, 'DENIED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a mutating native tool (write_file) When the human approves via broker Then the file is written and audit logs tool, authorized arguments, decision, and result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-broker-test-'));
  try {
    const broker = new ApprovalBroker(root, async () => ({
      choice: 'allow-once',
      actor: 'lead-developer',
      reason: 'Approved for feature implementation',
    }));

    const executor = new WorkspaceToolExecutor(root);
    executor.setBroker(broker);

    const result = await executor.executeTool('write_file', {
      path: 'approved.txt',
      content: 'APPROVED_PAYLOAD',
    });
    assert.ok(result.includes('Successfully wrote'));

    const content = await readFile(join(root, 'approved.txt'), 'utf8');
    assert.equal(content, 'APPROVED_PAYLOAD');

    const events = await readAudit(root);
    const approvedEvent = events.find((e) => e.tool === 'write_file' && e.decision === 'allow');
    assert.ok(approvedEvent, 'Audit must record approved tool call');
    assert.equal(approvedEvent.decision, 'allow');
    assert.equal(approvedEvent.actor, 'lead-developer');
    assert.ok(approvedEvent.authorizedArguments);
    assert.equal(approvedEvent.result, 'AUTHORIZED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a read-only tool (read_file) When dispatched Then it is authorized as read-only and audited without human prompt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-broker-test-'));
  try {
    let askCalled = false;
    const broker = new ApprovalBroker(root, async () => {
      askCalled = true;
      return { choice: 'deny', actor: 'test', reason: 'never' };
    });

    await writeFile(join(root, 'readable.txt'), 'READABLE_DATA', 'utf8');

    const executor = new WorkspaceToolExecutor(root);
    executor.setBroker(broker);

    const content = await executor.executeTool('read_file', { path: 'readable.txt' });
    assert.equal(content, 'READABLE_DATA');
    assert.equal(askCalled, false, 'Read-only tool should not require human interaction');

    const events = await readAudit(root);
    const readEvent = events.find((e) => e.tool === 'read_file');
    assert.ok(readEvent);
    assert.equal(readEvent.decision, 'allow');
    assert.equal(readEvent.result, 'AUTHORIZED_READONLY');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a tool declared readOnly: true When attempting a mutating action Then the broker denies execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-broker-test-'));
  try {
    const broker = new ApprovalBroker(root);

    const auth = await broker.authorizeToolCall({
      tool: 'database_write_record',
      args: { recordId: '123' },
      readOnly: true,
    });

    assert.equal(auth.allowed, false);
    assert.equal(auth.decision, 'deny');
    assert.match(auth.reason, /declared read-only but attempted a mutating action/);

    const events = await readAudit(root);
    const event = events.find((e) => e.tool === 'database_write_record');
    assert.ok(event);
    assert.equal(event.decision, 'deny');
    assert.equal(event.result, 'DENIED_READONLY_VIOLATION');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given runAgentTurn with ApprovalBroker When model proposes a mutating tool call that broker denies Then the call never executes and conversation contains denial', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-agent-broker-'));
  try {
    let executorInvoked = false;
    const broker = new ApprovalBroker(root, async () => ({
      choice: 'deny',
      actor: 'compliance-officer',
      reason: 'Unauthorized file edit',
    }));

    const mockClient = {
      async *streamChat() {
        yield {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_edit_1',
                function: {
                  name: 'write_file',
                  arguments: JSON.stringify({ path: 'secret.txt', content: 'SECRET' }),
                },
              },
            ],
          },
        };
      },
    };

    const result = await runAgentTurn({
      contextLength: 131072,
      client: mockClient,
      model: 'test-model',
      workspaceRoot: root,
      broker,
      messages: [{ role: 'user', content: 'write secret.txt' }],
      maxTurns: 1,
    });

    // Check conversation output
    const toolMsg = result.allMessages.find((m) => m.role === 'tool');
    assert.ok(toolMsg);
    assert.match(String(toolMsg.content), /denied by approval broker/);

    // Verify secret.txt was not created
    await assert.rejects(
      async () => {
        await readFile(join(root, 'secret.txt'), 'utf8');
      },
      { code: 'ENOENT' }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given McpClientManager When an MCP tool call is dispatched with a broker Then the call cannot bypass the broker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-broker-'));
  try {
    const broker = new ApprovalBroker(root, async () => ({
      choice: 'deny',
      actor: 'policy-engine',
      reason: 'External MCP mutation denied',
    }));

    const manager = new McpClientManager();
    manager.setBroker(broker);

    // Directly calling an MCP tool through manager with broker must reject
    // Mock a connected tool
    manager['tools'].set('custom_mutate_item', {
      serverName: 'test-server',
      originalName: 'mutate_item',
      scopedName: 'custom_mutate_item',
      definition: {
        type: 'function',
        function: { name: 'custom_mutate_item', description: 'test', parameters: {} },
      },
      readOnly: false,
    });

    let serverHandlerInvoked = false;
    manager['clients'].set('test-server', {
      client: {
        async callTool() {
          serverHandlerInvoked = true;
          return { content: [{ type: 'text', text: 'SHOULD_NOT_RUN' }] };
        },
      },
      transport: {},
      config: { command: 'node', readOnly: false },
    });

    await assert.rejects(
      async () => {
        await manager.callTool('custom_mutate_item', { id: 'item-1' });
      },
      /denied by approval broker/
    );

    assert.equal(serverHandlerInvoked, false, 'Denied MCP call must never reach server handler');

    const events = await readAudit(root);
    const event = events.find((e) => e.tool === 'custom_mutate_item');
    assert.ok(event);
    assert.equal(event.decision, 'deny');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
