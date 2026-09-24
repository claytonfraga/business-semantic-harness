import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { CodexRpcClient } from '../../dist/agents/codex/rpc.js';

test('Given a compatible app-server, when initialized and a read-only thread starts, then native elevation is declined', async () => {
  const client = new CodexRpcClient(process.execPath, [resolve('fixtures/fake-app-server.mjs')]);
  try {
    const notifications = [];
    client.on('notification', message => notifications.push(message));
    await client.initialize();
    const denied = once(client, 'nativeApprovalDenied');
    assert.equal(await client.startReadOnlyThread(process.cwd()), 'thread-1');
    await denied;
    assert.ok((await client.startTurn('thread-1', 'Consulta de ontologia')));
    assert.ok(await client.interrupt('thread-1', 'turn-1'));
    assert.ok(notifications.some(message => message.method === 'fixture/approvalDecision' && message.params.decision === 'decline'));
    assert.ok(notifications.some(message => message.method === 'turn/completed'));
  } finally { client.close(); }
});
