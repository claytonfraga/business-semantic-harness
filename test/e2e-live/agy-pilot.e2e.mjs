import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { contarConsultasOntologia, criarEstadoAgy, diagnoseAgy, lerAlertasAgy } from '../../dist/agents/agy/launcher.js';
import { finalizeSession } from '../../dist/agents/codex/finalize.js';
import { criarSessaoWorktree, removerSessaoWorktree } from '../../dist/agents/codex/worktree.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';

const PILOT_ORIGINAL = resolve('pilot/asset-management');
const raiz = mkdtempSync(join(tmpdir(), 'bsh-e2e-agy-pilot-'));
const worktreesDir = join(raiz, 'worktrees');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function prepararCopiaPiloto(nome) {
  const repo = join(raiz, nome);
  mkdirSync(repo, { recursive: true });
  execFileSync('cp', ['-a', `${PILOT_ORIGINAL}/.`, repo]);
  execFileSync('git', ['init', '-q', repo]);
  git(repo, ['config', 'user.name', 'Teste Agy']);
  git(repo, ['config', 'user.email', 'teste-agy@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'initial pilot base']);
  return repo;
}

after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

test('agy: smoke Given the pilot project and local Agy runtime, when diagnosing agy readiness, then ontology, MCP, and credentials are valid', async () => {
  const report = await diagnoseAgy(PILOT_ORIGINAL);
  assert.equal(report.ontologyReady, true);
  assert.equal(report.mcpEntrypointReady, true);
  assert.equal(report.ready, true, report.reasons.join('; '));
  assert.ok(typeof report.agyVersion === 'string' && report.agyVersion.length > 0);
});

test('agy: Given a clean copy of the pilot project, when creating an isolated agy session environment with gemini-3.7-flash-low, then worktree, private home, pre-trusted workspace, and BSH MCP server are configured without touching the main checkout or global ~/.gemini', async () => {
  const repo = prepararCopiaPiloto('caso-isolamento');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({
    repositorioOrigem: repo,
    branchOrigem: 'master',
    commitBase,
    diretorioBase: worktreesDir,
  });

  const estado = await criarEstadoAgy(repo, sessao.caminhoWorktree, ['ativos'], 'gemini-3.7-flash-low');
  try {
    // 1. Worktree isolada criada e checkout principal intacto
    assert.ok(existsSync(sessao.caminhoWorktree));
    assert.equal(git(repo, ['status', '--porcelain']).trim(), '', 'checkout principal permanece intacto');

    // 2. Pasta temporária privada 0700
    const st = statSync(estado.diretorio);
    assert.equal(st.mode & 0o777, 0o700);

    // 3. Workspace pré-autorizado na configuração do Agy
    const trusted = JSON.parse(readFileSync(join(estado.diretorio, '.gemini', 'trustedFolders.json'), 'utf8'));
    assert.equal(trusted[sessao.caminhoWorktree], 'TRUST_FOLDER');

    const agySettings = JSON.parse(readFileSync(join(estado.diretorio, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'));
    assert.ok(agySettings.trustedWorkspaces.includes(sessao.caminhoWorktree));

    // 4. Modelo configurado como gemini-3.7-flash-low para testes
    const settings = JSON.parse(readFileSync(join(estado.diretorio, '.gemini', 'settings.json'), 'utf8'));
    assert.equal(settings.model?.name, 'gemini-3.7-flash-low');

    // 5. Onboarding concluído para evitar assistente interativo de boas-vindas
    const onboarding = JSON.parse(readFileSync(join(estado.diretorio, '.gemini', 'antigravity-cli', 'cache', 'onboarding.json'), 'utf8'));
    assert.equal(onboarding.consumerOnboardingComplete, true);

    // 6. Servidor MCP do BSH configurado no ambiente isolado apontando para o piloto
    const mcpConfig = JSON.parse(readFileSync(join(estado.diretorio, '.gemini', 'config', 'mcp_config.json'), 'utf8'));
    assert.ok(mcpConfig.mcpServers.bsh);
    assert.equal(mcpConfig.mcpServers.bsh.disabled, false);
    assert.ok(mcpConfig.mcpServers.bsh.args.includes(repo));

    // 7. Instalação real do usuário permanece limpa
    const globalMcpPath = join(homedir(), '.gemini', 'config', 'mcp_config.json');
    if (existsSync(globalMcpPath)) {
      const globalMcp = JSON.parse(readFileSync(globalMcpPath, 'utf8'));
      assert.equal(globalMcp.mcpServers?.bsh, undefined, 'global mcp_config.json não deve conter o bsh');
    }
  } finally {
    await estado.dispose();
    await removerSessaoWorktree(sessao);
  }

  assert.equal(existsSync(estado.diretorio), false);
  assert.equal(existsSync(sessao.caminhoWorktree), false);
});

test('agy: Given a compliant change in the pilot project under agy governance with gemini-3.7-flash-low, when finalizeSession completes with recorded ontology queries, then the change is promoted and origin master is updated', async () => {
  const repo = prepararCopiaPiloto('caso-conforme');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({
    repositorioOrigem: repo,
    branchOrigem: 'master',
    commitBase,
    diretorioBase: worktreesDir,
  });

  const estado = await criarEstadoAgy(repo, sessao.caminhoWorktree, ['ativos'], 'gemini-3.7-flash-low');
  try {
    // Altera um arquivo na worktree de forma conforme
    const serverFile = join(sessao.caminhoWorktree, 'src', 'server.ts');
    const conteudoAntes = readFileSync(serverFile, 'utf8');
    writeFileSync(serverFile, `${conteudoAntes}\n// BSH Agy Governed Change: compliant audit trail helper\n`);

    // Registra consulta ontológica feita pelo agente
    writeFileSync(join(estado.sessaoDir, 'ontology-queries.jsonl'), JSON.stringify({
      domain: 'ativos',
      query: 'classes',
      timestamp: new Date().toISOString(),
    }) + '\n');

    const snapshot = await createOntologySnapshot(repo);
    const alerts = await lerAlertasAgy(estado);
    const ontologyQueries = await contarConsultasOntologia(estado);
    assert.equal(ontologyQueries, 1);
    assert.equal(alerts.length, 0);

    const resultado = await finalizeSession({
      sessao,
      domain: 'ativos',
      snapshot,
      alerts,
      tokenTotals: undefined,
      ontologyQueries,
      harnessTokens: 0,
    });

    assert.equal(resultado.promovido, true);
    assert.equal(resultado.status, 'promovido');

    // Verifica que a branch principal foi atualizada com o commit promovido
    const novoCommit = git(repo, ['rev-parse', 'HEAD']).trim();
    assert.notEqual(novoCommit, commitBase);
    assert.ok(readFileSync(join(repo, 'src', 'server.ts'), 'utf8').includes('BSH Agy Governed Change'));
    assert.equal(git(repo, ['status', '--porcelain']).trim(), '', 'checkout principal limpo após promoção');
  } finally {
    await estado.dispose();
  }
});

test('agy: Given a conflict reported by agy on the pilot project with gemini-3.7-flash-low, when finalizeSession runs without exception approval, then promotion is blocked and origin master remains intact', async () => {
  const repo = prepararCopiaPiloto('caso-conflito');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({
    repositorioOrigem: repo,
    branchOrigem: 'master',
    commitBase,
    diretorioBase: worktreesDir,
  });

  const estado = await criarEstadoAgy(repo, sessao.caminhoWorktree, ['ativos'], 'gemini-3.7-flash-low');
  try {
    // Altera arquivo na worktree
    const serverFile = join(sessao.caminhoWorktree, 'src', 'server.ts');
    writeFileSync(serverFile, `${readFileSync(serverFile, 'utf8')}\n// Operacao contraria\n`);

    // Agente relata alerta de conflito com a ontologia
    writeFileSync(join(estado.sessaoDir, 'alerts.jsonl'), JSON.stringify({
      severity: 'ALERTA',
      domain: 'ativos',
      request: 'transferir ativo baixado',
      conflictingRules: ['urn:enforcement:ativos:TransferenciaShape'],
      reason: 'ativo baixado nao pode ser transferido',
    }) + '\n');

    const snapshot = await createOntologySnapshot(repo);
    const alerts = await lerAlertasAgy(estado);
    const ontologyQueries = await contarConsultasOntologia(estado);
    assert.equal(alerts.length, 1);

    const resultado = await finalizeSession({
      sessao,
      domain: 'ativos',
      snapshot,
      alerts,
      tokenTotals: undefined,
      ontologyQueries,
      harnessTokens: 0,
      confirmar: async () => false, // Humano recusa exceção
    });

    assert.equal(resultado.promovido, false);
    assert.equal(resultado.status, 'descartado');

    // Verifica que o master original permaneceu intacto no commit inicial
    assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), commitBase);
    assert.equal(git(repo, ['status', '--porcelain']).trim(), '');
    assert.ok(!readFileSync(join(repo, 'src', 'server.ts'), 'utf8').includes('Operacao contraria'));
  } finally {
    await estado.dispose();
  }
});
