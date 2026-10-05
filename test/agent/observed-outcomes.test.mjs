// Requirements: BSH-TOOLS-014, BSH-TOOLS-015, BSH-AGENT-004.
// The model stream and MCP transport are identified fixtures; native tools, filesystem and Git are real.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAgentTurn, buildCodingAgentSystemPrompt } from '../../dist/agent/agentLoop.js';
import { captureWorkspaceSnapshot, observedChangedFiles } from '../../dist/agent/workspaceChanges.js';

function scriptedClient(calls) {
  let turn = 0;
  return { async *streamChat() {
    const tools = calls[turn++] ?? [];
    yield { delta: tools.length ? { tool_calls: tools.map(([name, args], index) => ({
      index, id: `call_${turn}_${index}`, function: { name, arguments: JSON.stringify(args) },
    })) } : { content: 'Observed outcome reported.' } };
  } };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-observed-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
function run(root, calls, extra = {}) {
  return runAgentTurn({ client: scriptedClient(calls), model: 'fixture', workspaceRoot: root,
    messages: [{ role: 'user', content: 'Implement the requested change' }], ...extra });
}

test('Given failed and identical writes When the agent finishes Then only actual final differences are reported', async () => fixture(async root => {
  await writeFile(join(root, 'existing.txt'), 'unchanged');
  const result = await run(root, [[
    ['replace_file_content', { path: 'existing.txt', target_content: 'absent', replacement_content: 'changed' }],
    ['write_file', { path: 'existing.txt', content: 'unchanged' }],
    ['write_file', { path: 'created.txt', content: 'created' }],
  ]]);
  assert.deepEqual(result.modifiedFiles, ['created.txt']);
  assert.equal(await readFile(join(root, 'existing.txt'), 'utf8'), 'unchanged');
  assert.equal(result.outcome, 'tool_error');
  assert.equal(result.completed, false);
  assert.equal(result.toolFailures.length, 1);
}));

test('Given preexisting Git dirt and shell creation rename and deletion When the agent runs Then its inventory matches final workspace differences', async () => fixture(async root => {
  const git = (...args) => execFileSync('git', ['-C', root, ...args]);
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(root, 'dirty.txt'), 'baseline');
  await writeFile(join(root, 'removed.txt'), 'delete me');
  await writeFile(join(root, 'renamed.txt'), 'rename me');
  git('add', '.'); git('commit', '-m', 'fixture');
  await writeFile(join(root, 'dirty.txt'), 'preexisting dirt');
  const result = await run(root, [[['run_bash_command', {
    command: 'printf changed > shell.txt; rm removed.txt; mv renamed.txt destination.txt',
  }]]]);
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.modifiedFiles, ['destination.txt', 'removed.txt', 'renamed.txt', 'shell.txt']);
  assert.equal(await readFile(join(root, 'dirty.txt'), 'utf8'), 'preexisting dirt');
  assert.match(git('status', '--porcelain').toString(), /shell.txt/);
}));

test('Given a fixture MCP tool that writes a file When the agent executes it Then observed files include the external tool change', async () => fixture(async root => {
  // Transport double implements the production manager's host broker attachment.
  const mcpManager = { setBroker: () => {}, getToolDefinitions: () => [], hasTool: name => name === 'fixture_mcp_write',
    async callTool() { await writeFile(join(root, 'mcp.txt'), 'external change'); return 'Written'; } };
  const result = await run(root, [[['fixture_mcp_write', {}]]], { mcpManager });
  assert.deepEqual(result.modifiedFiles, ['mcp.txt']);
  assert.equal(result.outcome, 'completed');
}));

test('Given a broker denial When the agent explains it Then the outcome is rule blocked without a forced mutation retry', async () => fixture(async root => {
  const broker = { authorizeToolCall: async () => ({ allowed: false, reason: 'RULE-1 forbids this operation' }) };
  const result = await run(root, [[['write_file', { path: 'forbidden.txt', content: 'forbidden' }]]], { broker });
  assert.equal(result.outcome, 'rule_blocked');
  assert.equal(result.completed, false);
  assert.deepEqual(result.modifiedFiles, []);
  assert.equal(result.turnsExecuted, 2);
  assert.equal(result.toolFailures[0].evidence, 'approval_broker');
}));

test('Given an agent declared business refusal When it reports rule and reason Then the refusal is labeled without implying independent validation', async () => fixture(async root => {
  const result = await run(root, [[['report_task_outcome', { outcome: 'rule_blocked', ruleId: 'RULE-2', reason: 'Transfer is forbidden' }]]]);
  assert.equal(result.outcome, 'rule_blocked');
  assert.equal(result.toolFailures[0].ruleId, 'RULE-2');
  assert.equal(result.toolFailures[0].evidence, 'agent_declared');
  assert.deepEqual(result.modifiedFiles, []);
}));

test('Given a failing shell command When the agent ends Then the outcome exposes tool failure', async () => fixture(async root => {
  const result = await run(root, [[['run_bash_command', { command: 'exit 7' }]]]);
  assert.equal(result.outcome, 'tool_error');
  assert.match(result.toolFailures[0].reason, /Exit code: 7/);
}));

test('Given an unfinished tool turn When the turn limit is reached Then partial changes and the limit are explicit', async () => fixture(async root => {
  const result = await run(root, [[['write_file', { path: 'partial.txt', content: 'partial' }]]], { maxTurns: 1 });
  assert.equal(result.outcome, 'turn_limit');
  assert.equal(result.completed, false);
  assert.deepEqual(result.modifiedFiles, ['partial.txt']);
}));

test('Given snapshots with domain edits and generated session evidence When compared Then only the domain edit is attributed to the task', async () => fixture(async root => {
  await mkdir(join(root, '.bsh/domains/example'), { recursive: true });
  await mkdir(join(root, '.bsh/local'), { recursive: true });
  const before = await captureWorkspaceSnapshot(root);
  await writeFile(join(root, '.bsh/domains/example/shapes.ttl'), 'domain');
  await writeFile(join(root, '.bsh/local/audit.json'), 'generated');
  assert.deepEqual(observedChangedFiles(before, await captureWorkspaceSnapshot(root)), ['.bsh/domains/example/shapes.ttl']);
}));

test('Given action instructions When the system prompt is built Then it honors business refusals without unconditional writes', () => {
  const prompt = buildCodingAgentSystemPrompt({});
  assert.doesNotMatch(prompt, /NEVER STOP WITHOUT WRITING CODE/);
  assert.match(prompt, /report_task_outcome/);
});
