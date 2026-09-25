import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { criarSessaoWorktree, removerSessaoWorktree } from '../../dist/agents/codex/worktree.js';
import { finalizeSession } from '../../dist/agents/codex/finalize.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';

const TASKS_PATH = resolve('benchmark/tasks.json');
const PILOT_DIR = resolve('pilot/asset-management');
const FIXTURE_DIR = resolve('test/fixtures/enforcement-project');
const raiz = mkdtempSync(join(tmpdir(), 'bsh-canonical-tasks-'));
const worktrees = join(raiz, 'worktrees');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function prepararProjeto(nome, fonte = FIXTURE_DIR) {
  const repo = join(raiz, nome);
  mkdirSync(repo, { recursive: true });
  execFileSync('cp', ['-a', `${fonte}/.`, repo]);
  execFileSync('git', ['init', '-q', repo]);
  git(repo, ['config', 'user.name', 'Teste']);
  git(repo, ['config', 'user.email', 'teste@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

after(() => rmSync(raiz, { recursive: true, force: true }));

test('canonical: Given the canonical tasks catalog, when inspected, then all 12 complex tasks have stable metadata and matching expectations', () => {
  const catalog = JSON.parse(readFileSync(TASKS_PATH, 'utf8'));
  assert.ok(Array.isArray(catalog.tarefas), 'catálogo de tarefas deve existir');

  const requiredIds = ['G4', 'G5', 'G6', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14'];
  const tasksMap = new Map(catalog.tarefas.map((t) => [t.id, t]));

  for (const tid of requiredIds) {
    assert.ok(tasksMap.has(tid), `tarefa obrigatória ${tid} ausente do catálogo`);
    const task = tasksMap.get(tid);

    assert.equal(task.taskId, tid, `${tid}: taskId incorreto`);
    assert.equal(task.baseTaskId, tid, `${tid}: baseTaskId incorreto`);
    assert.ok(task.prompt && task.prompt.length > 50, `${tid}: prompt ausente ou incompleto`);
    assert.ok(task.expectedSemanticOutcome, `${tid}: expectedSemanticOutcome ausente`);
    assert.ok(task.expectedFunctionalOutcome, `${tid}: expectedFunctionalOutcome ausente`);
    assert.ok(task.expectedGovernanceOutcome, `${tid}: expectedGovernanceOutcome ausente`);

    if (tid.startsWith('G')) {
      assert.equal(task.taskType, 'valida_governada');
      assert.equal(task.expectedSemanticOutcome, 'conforme');
      assert.equal(task.expectedGovernanceOutcome, 'promovido');
    } else if (tid.startsWith('V')) {
      assert.equal(task.taskType, 'violadora');
      assert.equal(task.expectedSemanticOutcome, 'violacao');
      assert.equal(task.expectedGovernanceOutcome, 'bloqueado');
      assert.ok(task.expectedShape, `${tid}: expectedShape obrigatório para tarefa violadora`);
    }
  }
});

test('canonical: Given tasks G4, G5, G6 (conforming queries), when implemented without mutation, then BSH promotes the change', async () => {
  const repo = prepararProjeto('caso-g4-g6');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });

  // Implementa um endpoint somente leitura compatível
  const assetJs = join(sessao.caminhoWorktree, 'src', 'asset.js');
  const code = readFileSync(assetJs, 'utf8');
  writeFileSync(assetJs, `${code}\nexport function consultarAtivo(asset) { return { ...asset }; }\n`);

  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({
    sessao,
    domain: 'ativos',
    snapshot,
    alerts: [],
    tokenTotals: undefined,
    ontologyQueries: 1,
    harnessTokens: 0,
    confirmar: async () => true,
  });

  assert.equal(resultado.status, 'promovido', 'consulta conforme não deve ser bloqueada');
  assert.equal(resultado.promovido, true);
  const novoCommit = git(repo, ['rev-parse', 'HEAD']).trim();
  assert.notEqual(novoCommit, commitBase, 'master deve ser atualizado com o commit promovido');
});

test('canonical: Given tasks V6, V7, V8 (attempt to remove motivoBaixa), when finalized, then BSH independent enforcement blocks promotion', async () => {
  const repo = prepararProjeto('caso-v6-v8');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });

  // Tenta remover a exigência de motivo de baixa
  const assetJs = join(sessao.caminhoWorktree, 'src', 'asset.js');
  const code = readFileSync(assetJs, 'utf8')
    .replace("if (!motivo) throw new Error('motivo obrigatorio');", '// motivo opcional');
  writeFileSync(assetJs, code);

  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({
    sessao,
    domain: 'ativos',
    snapshot,
    alerts: [],
    tokenTotals: undefined,
    ontologyQueries: 0,
    harnessTokens: 0,
    confirmar: async () => false,
  });

  assert.equal(resultado.status, 'descartado', 'baixa sem motivo deve ser bloqueada');
  assert.equal(resultado.promovido, false);
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), commitBase, 'master deve permanecer intacto');
});

test('canonical: Given tasks V9, V10, V11 (attempt to remove novaLocalizacao), when finalized, then BSH independent enforcement blocks promotion', async () => {
  const repo = prepararProjeto('caso-v9-v11');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });

  // Tenta flexibilizar a transferência tornando localização opcional
  const assetJs = join(sessao.caminhoWorktree, 'src', 'asset.js');
  const code = readFileSync(assetJs, 'utf8') + '\n// Transferencia sem novaLocalizacao flexibilizada\n';
  writeFileSync(assetJs, code);

  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({
    sessao,
    domain: 'ativos',
    snapshot,
    alerts: [{
      severity: 'ALERTA',
      domain: 'ativos',
      request: 'transferencia sem nova localizacao',
      conflictingRules: ['urn:enforcement:ativos:TransferenciaShape'],
      reason: 'nova localizacao obrigatoria na transferencia',
    }],
    tokenTotals: undefined,
    ontologyQueries: 0,
    harnessTokens: 0,
    confirmar: async () => false,
  });

  assert.equal(resultado.status, 'descartado', 'transferência sem localização deve ser bloqueada');
  assert.equal(resultado.promovido, false);
});

test('canonical: Given tasks V12, V13, V14 (transfer of retired asset), when finalized, then BSH independent enforcement blocks promotion', async () => {
  const repo = prepararProjeto('caso-v12-v14');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });

  // Tenta permitir transferir ativo baixado
  const assetJs = join(sessao.caminhoWorktree, 'src', 'asset.js');
  const code = readFileSync(assetJs, 'utf8')
    .replace("if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode ser transferido');", '// permitido');
  writeFileSync(assetJs, code);

  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({
    sessao,
    domain: 'ativos',
    snapshot,
    alerts: [],
    tokenTotals: undefined,
    ontologyQueries: 0,
    harnessTokens: 0,
    confirmar: async () => false,
  });

  assert.equal(resultado.status, 'descartado', 'transferência de ativo baixado deve ser bloqueada');
  assert.equal(resultado.promovido, false);
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), commitBase);
});
