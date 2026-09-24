import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { criarEstadoAgy, diagnoseAgy, diagnoseAgyRuntime, extrairTokens } from '../../dist/agents/agy/launcher.js';

test('agy: Given the agy JSON output, when extracting tokens, then input/output/thinking/cache/total are parsed', () => {
  const saida = JSON.stringify({
    conversation_id: 'x', status: 'SUCCESS', response: 'ok',
    usage: { input_tokens: 120, output_tokens: 30, thinking_tokens: 7, cache_read_tokens: 12, total_tokens: 150 },
  });
  const tokens = extrairTokens(saida);
  assert.deepEqual(tokens, { entrada: 120, saida: 30, cache: 12, raciocinio: 7, totais: 150 });
});

test('agy: Given an interrupted output with zero usage, when extracting tokens, then it returns undefined instead of zero', () => {
  const saida = JSON.stringify({ status: 'ERROR', error: 'interrupted', usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 } });
  assert.equal(extrairTokens(saida), undefined);
});

test('agy: Given output without usage, when extracting tokens, then it returns undefined', () => {
  assert.equal(extrairTokens('linha qualquer\n{"status":"SUCCESS"}'), undefined);
});

test('agy: Given output that is not JSON, when extracting tokens, then it returns undefined', () => {
  assert.equal(extrairTokens('nao e json'), undefined);
});

test('agy: Given an isolated agy environment, when created, then it sets up private HOME, pre-trusted workspace, and BSH MCP config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-test-agy-root-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  try {
    const estado = await criarEstadoAgy(root, workspace, ['ativos'], 'gemini-3.7-flash-low');
    try {
      const trusted = JSON.parse(await readFile(join(estado.diretorio, '.gemini', 'trustedFolders.json'), 'utf8'));
      assert.equal(trusted[workspace], 'TRUST_FOLDER');

      const settings = JSON.parse(await readFile(join(estado.diretorio, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'));
      assert.ok(settings.trustedWorkspaces.includes(workspace));

      const geminiSettings = JSON.parse(await readFile(join(estado.diretorio, '.gemini', 'settings.json'), 'utf8'));
      assert.ok(geminiSettings.ui?.theme);
      assert.equal(geminiSettings.model?.name, 'gemini-3.7-flash-low');

      const onboarding = JSON.parse(await readFile(join(estado.diretorio, '.gemini', 'antigravity-cli', 'cache', 'onboarding.json'), 'utf8'));
      assert.equal(onboarding.consumerOnboardingComplete, true);

      const mcpConfig = JSON.parse(await readFile(join(estado.diretorio, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
      assert.ok(mcpConfig.mcpServers.bsh);
      assert.equal(mcpConfig.mcpServers.bsh.disabled, false);

      const instructions = await readFile(join(estado.diretorio, '.gemini', 'GEMINI.md'), 'utf8');
      assert.match(instructions, /Sessão governada pelo BSH/);
      assert.match(instructions, /ativos/);
    } finally {
      await estado.dispose();
    }
    await assert.rejects(access(estado.diretorio));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agy: Given a custom model, when creating agy environment, then it configures the specified model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-test-agy-custom-model-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  try {
    const estado = await criarEstadoAgy(root, workspace, ['ativos'], 'gemini-3.8-flash-high');
    try {
      const geminiSettings = JSON.parse(await readFile(join(estado.diretorio, '.gemini', 'settings.json'), 'utf8'));
      assert.equal(geminiSettings.model?.name, 'gemini-3.8-flash-high');
    } finally {
      await estado.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agy: smoke Given a valid pilot project, when diagnoseAgy runs, then agy readiness is diagnosed', async () => {
  const pilotRoot = resolve('pilot/asset-management');
  const report = await diagnoseAgy(pilotRoot);
  assert.equal(report.ontologyReady, true);
  assert.equal(report.mcpEntrypointReady, true);
  assert.equal(typeof report.ready, 'boolean');
});

test('agy: Given a project without ontology, when diagnoseAgyRuntime runs, then it reports not ready', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-test-no-ont-'));
  try {
    const report = await diagnoseAgyRuntime(root);
    assert.equal(report.ready, false);
    assert.ok(report.reasons.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
