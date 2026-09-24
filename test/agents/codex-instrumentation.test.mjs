import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodexRpcClient } from '../../dist/agents/codex/rpc.js';

function createFakeWire() {
  const messageListeners = [];
  const closeListeners = [];
  const sentListeners = [];
  const sent = [];
  return {
    ready: Promise.resolve(),
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      for (const listener of sentListeners) listener(message);
    },
    close() { for (const listener of closeListeners) listener(new Error('fechado')); },
    onMessage(listener) { messageListeners.push(listener); },
    onClose(listener) { closeListeners.push(listener); },
    onStderr() {},
    deliver(message) { for (const listener of messageListeners) listener(JSON.stringify(message)); },
    onSent(listener) { sentListeners.push(listener); },
    sent,
  };
}

const featuresDisabled = {
  apps: false, browser_use: false, browser_use_external: false, computer_use: false,
  plugins: false, remote_plugin: false, multi_agent: false,
};

function respondToHandshake(wire, config) {
  wire.onSent((message) => {
    if (message.method === 'initialize') wire.deliver({ id: message.id, result: { userAgent: 'fake' } });
    if (message.method === 'config/read') wire.deliver({ id: message.id, result: { config } });
    if (message.method === 'thread/resume' || message.method === 'thread/unsubscribe') wire.deliver({ id: message.id, result: {} });
    if (message.method === 'thread/list') wire.deliver({ id: message.id, result: { data: [{ id: 'thr_1' }] } });
  });
}

test('Given only the Oracle MCP in the effective config, when the instrumentation client verifies it, then the session configuration is accepted', async () => {
  const wire = createFakeWire();
  respondToHandshake(wire, { mcp_servers: { oracle: {} }, features: featuresDisabled, web_search: 'disabled' });
  const client = new CodexRpcClient(wire);
  await client.initialize();
  await client.verifyCleanConfiguration('/tmp/copia');
  assert.ok(wire.sent.some((message) => message.method === 'config/read'));
  client.close();
});

test('Given an external MCP in the effective config, when the instrumentation client verifies it, then the governed session is refused', async () => {
  const wire = createFakeWire();
  respondToHandshake(wire, { mcp_servers: { oracle: {}, notion: {} }, features: featuresDisabled, web_search: 'disabled' });
  const client = new CodexRpcClient(wire);
  await client.initialize();
  await assert.rejects(() => client.verifyCleanConfiguration('/tmp/copia'), /MCP externo herdado: notion/);
  client.close();
});

test('Given an enabled external feature in the effective config, when the instrumentation client verifies it, then the governed session is refused', async () => {
  const wire = createFakeWire();
  respondToHandshake(wire, { mcp_servers: { oracle: {} }, features: { ...featuresDisabled, apps: true }, web_search: 'disabled' });
  const client = new CodexRpcClient(wire);
  await client.initialize();
  await assert.rejects(() => client.verifyCleanConfiguration('/tmp/copia'), /Recurso externo não desabilitado: apps/);
  client.close();
});

test('Given a native approval request destined for the TUI, when the instrumentation client observes it, then it does not answer on the TUI behalf', async () => {
  const wire = createFakeWire();
  const client = new CodexRpcClient(wire);
  client.nativeApprovalMode = 'ignore';
  const observed = [];
  client.on('ignoredServerRequest', (message) => observed.push(message));
  wire.deliver({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'echo oi' } });
  assert.equal(observed.length, 1);
  assert.equal(wire.sent.some((message) => message.id === 'approval-1'), false);
});

test('Given an adapter default, when a native approval arrives without an instrumented listener, then it is declined explicitly', async () => {
  const wire = createFakeWire();
  const client = new CodexRpcClient(wire);
  wire.deliver({ id: 'approval-1', method: 'item/fileChange/requestApproval', params: {} });
  const response = wire.sent.find((message) => message.id === 'approval-1');
  assert.deepEqual(response.result, { decision: 'decline' });
});

test('Given a running app-server, when the instrumentation client resumes, unsubscribes and lists threads, then it emits the matching RPC methods', async () => {
  const wire = createFakeWire();
  respondToHandshake(wire, { mcp_servers: { oracle: {} }, features: featuresDisabled, web_search: 'disabled' });
  const client = new CodexRpcClient(wire);
  await client.initialize();
  await client.resumeThread('thr_1');
  await client.unsubscribeThread('thr_1');
  const threads = await client.listThreads({ cwd: '/tmp/copia' });
  assert.deepEqual(threads, [{ id: 'thr_1' }]);
  assert.deepEqual(wire.sent.filter((message) => message.method.startsWith('thread/')).map((message) => message.method), ['thread/resume', 'thread/unsubscribe', 'thread/list']);
  client.close();
});