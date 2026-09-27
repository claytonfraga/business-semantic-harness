import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  buildOpencodeConfig, criarEstadoOpencode, diagnoseOpencode, diagnoseOpencodeRuntime,
  extrairTokensDaSaida,
} from '../../dist/agents/opencode/launcher.js';

test('opencode: Given the opencode JSON events, when extracting tokens, then the last block is used', () => {
  const saida = [
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } } } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 54009, output: 123, reasoning: 87, total: 56011, cache: { read: 1792, write: 0 } } } }),
  ].join('\n');
  assert.deepEqual(extrairTokensDaSaida(saida), { entrada: 54009, saida: 123, cache: 1792, raciocinio: 87, totais: 56011 });
});

test('opencode: Given no token usage, when extracting tokens, then it returns undefined instead of zero', () => {
  assert.equal(extrairTokensDaSaida('linha qualquer\n{"type":"text","part":{"text":"ok"}}'), undefined);
});

test('opencode: Given a governed config, when built, then the BSH MCP is local, governed and the model and denials are set', () => {
  const config = buildOpencodeConfig({
    mcpEntrypoint: '/repo/dist/mcp/server.js',
    repositorioOrigem: '/repo/pilot',
    sessaoDir: '/tmp/sess',
    instructionsPath: '/tmp/AGENTS.md',
    model: 'openrouter/deepseek/deepseek-v4.1-flash',
    governed: true,
  });
  assert.equal(config.model, 'openrouter/deepseek/deepseek-v4.1-flash');
  assert.equal(config.share, 'disabled');
  const mcp = config.mcp;
  assert.equal(mcp.bsh.type, 'local');
  assert.deepEqual(mcp.bsh.command.slice(-2), ['/repo/pilot', 'governed']);
  assert.equal(mcp.bsh.environment.BSH_SESSION_DIR, '/tmp/sess');
  assert.equal(config.permission.webfetch, 'deny');
  assert.equal(config.permission.websearch, 'deny');
});

test('opencode: Given a non-governed config, when built, then no BSH MCP is injected', () => {
  const config = buildOpencodeConfig({
    mcpEntrypoint: '/repo/dist/mcp/server.js', repositorioOrigem: '/repo/pilot',
    sessaoDir: '/tmp/sess', instructionsPath: '/tmp/AGENTS.md', governed: false,
  });
  assert.equal(config.mcp, undefined);
});

test('opencode: Given an isolated environment, when created, then config, instructions and session dir are private and disposed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-test-opencode-root-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  try {
    const estado = await criarEstadoOpencode(root, workspace, ['ativos'], 'openrouter/deepseek/deepseek-v4.1-flash', true);
    try {
      const config = JSON.parse(await readFile(join(estado.diretorio, '.config', 'opencode', 'opencode.json'), 'utf8'));
      assert.equal(config.model, 'openrouter/deepseek/deepseek-v4.1-flash');
      assert.ok(config.mcp.bsh);
      const instructions = await readFile(join(estado.diretorio, 'AGENTS.md'), 'utf8');
      assert.match(instructions, /Sessão governada pelo BSH/);
      assert.match(instructions, /ativos/);
      await access(estado.sessaoDir);
    } finally {
      await estado.dispose();
    }
    await assert.rejects(access(estado.diretorio));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opencode: Given a project without ontology, when diagnoseOpencodeRuntime runs, then it reports not ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-test-opencode-no-ont-'));
  try {
    const report = await diagnoseOpencodeRuntime(root);
    assert.equal(report.ready, false);
    assert.ok(report.reasons.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('opencode: smoke Given a valid pilot project, when diagnoseOpencode runs, then opencode readiness is diagnosed', async () => {
  const report = await diagnoseOpencode(resolve('pilot/asset-management'));
  assert.equal(report.ontologyReady, true);
  assert.equal(report.mcpEntrypointReady, true);
  assert.equal(typeof report.ready, 'boolean');
});
