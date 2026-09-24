import { createInterface } from 'node:readline';

function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fake' } });
  if (message.method === 'thread/start') {
    if (message.params?.sandbox !== 'read-only' || message.params?.config?.mcp_servers?.oracle?.required !== true) {
      send({ id: message.id, error: { code: -1, message: 'unsafe thread config' } });
    } else send({ id: message.id, result: { thread: { id: 'thread-1' } } });
    send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'echo unsafe' } });
  }
  if (message.id === 'approval-1') send({ method: 'fixture/approvalDecision', params: message.result });
  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  }
  if (message.method === 'turn/interrupt') send({ id: message.id, result: {} });
});
