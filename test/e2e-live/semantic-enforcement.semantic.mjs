import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { after, test } from 'node:test';
import { criarSessaoWorktree, removerSessaoWorktree } from '../../dist/agents/codex/worktree.js';
import { finalizeSession } from '../../dist/agents/codex/finalize.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';

const FIXTURE = resolve('test/fixtures/enforcement-project');
const raiz = mkdtempSync(join(tmpdir(), 'bsh-semantic-'));
const worktrees = join(raiz, 'worktrees');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function prepararProjeto(nome) {
  const repo = join(raiz, nome);
  mkdirSync(repo, { recursive: true });
  execFileSync('cp', ['-a', `${FIXTURE}/.`, repo]);
  execFileSync('git', ['init', '-q', repo]);
  git(repo, ['config', 'user.name', 'Teste']);
  git(repo, ['config', 'user.email', 'teste@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

async function executar(nome, aplicar, responder) {
  const repo = prepararProjeto(nome);
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });
  const antes = readFileSync(join(repo, 'src', 'asset.js'), 'utf8');
  aplicar(sessao.caminhoWorktree);
  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({
    sessao, domain: 'ativos', snapshot, alerts: [], tokenTotals: undefined,
    ontologyQueries: 0, harnessTokens: 0,
    confirmar: async () => responder,
  });
  const depois = readFileSync(join(repo, 'src', 'asset.js'), 'utf8');
  return { resultado, antes, depois, repo, sessao, statusOrigem: git(repo, ['status', '--porcelain']).trim() };
}

after(() => rmSync(raiz, { recursive: true, force: true }));

test('E2E semantico: Given a valid change, when finalized, then it is promoted and the main branch is updated', async () => {
  const r = await executar('valido', (wt) => {
    writeFileSync(join(wt, 'src', 'asset.js'), readFileSync(join(wt, 'src', 'asset.js'), 'utf8') + '\n// melhoria valida\n');
  }, true);
  assert.equal(r.resultado.status, 'promovido');
  assert.match(r.depois, /melhoria valida/);
  assert.equal(r.statusOrigem, '');
});

test('E2E semantico: Given a governed violation with zero bsh_report_conflict, when finalized, then promotion is blocked and the origin is untouched', async () => {
  const r = await executar('violacao-sem-report', (wt) => {
    const conteudo = readFileSync(join(wt, 'src', 'asset.js'), 'utf8')
      .replace("  if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode ser transferido');\n", '');
    writeFileSync(join(wt, 'src', 'asset.js'), conteudo);
  }, false);
  assert.equal(r.resultado.status, 'descartado');
  assert.equal(r.depois, r.antes);
  assert.equal(r.statusOrigem, '');
  const evidencia = join(r.repo, '.bsh', 'local', 'enforcement', `${r.sessao.id}.json`);
  assert.ok(existsSync(evidencia), 'registro de enforcement ausente');
  const registro = JSON.parse(readFileSync(evidencia, 'utf8'));
  assert.equal(registro.status, 'violacao');
  assert.ok(registro.resultados.some((item) => item.status === 'violacao' && item.shape));
});

test('E2E semantico: Given an operation under a human-review policy, when refused, then nothing is promoted', async () => {
  const r = await executar('politica', (wt) => {
    writeFileSync(join(wt, 'src', 'asset.js'), readFileSync(join(wt, 'src', 'asset.js'), 'utf8') + '\n// GOV-JUSTIFICATIVA\n');
  }, false);
  assert.equal(r.resultado.status, 'descartado');
  assert.equal(r.depois, r.antes);
});

test('E2E semantico: Given a governed operation with an undetermined fact, when finalized, then it is not treated as conforming', async () => {
  const r = await executar('indeterminado', (wt) => {
    writeFileSync(join(wt, 'src', 'asset.js'), readFileSync(join(wt, 'src', 'asset.js'), 'utf8') + '\n// GOV-PENDENTE\n');
  }, false);
  assert.equal(r.resultado.status, 'descartado');
  assert.equal(r.depois, r.antes);
});

test('E2E semantico: Given a change outside governed knowledge, when finalized, then there is no false block', async () => {
  const r = await executar('fora-conhecimento', (wt) => {
    writeFileSync(join(wt, 'src', 'asset.js'), readFileSync(join(wt, 'src', 'asset.js'), 'utf8') + '\n// mudanca neutra\n');
  }, true);
  assert.equal(r.resultado.status, 'promovido');
  assert.match(r.depois, /mudanca neutra/);
});

test('E2E semantico: Given a violation that passes the technical gates, when finalized, then the semantic layer still blocks it', async () => {
  const r = await executar('violacao-gates-ok', (wt) => {
    const asset = readFileSync(join(wt, 'src', 'asset.js'), 'utf8')
      .replace("  if (asset.status === 'Baixado') throw new Error('Ativo baixado nao pode ser transferido');\n", '');
    writeFileSync(join(wt, 'src', 'asset.js'), asset);
    const teste = readFileSync(join(wt, 'test', 'asset.test.mjs'), 'utf8')
      .replace("test('Given a retired asset, when transferred, then it fails', () => {\n  assert.throws(() => transferir({ status: 'Baixado' }, 'Ana'));\n});", "test('retired allowed', () => { assert.equal(transferir({ status: 'Baixado' }, 'Ana').responsible, 'Ana'); });");
    writeFileSync(join(wt, 'test', 'asset.test.mjs'), teste);
  }, false);
  assert.equal(r.resultado.status, 'descartado');
  assert.equal(r.depois, r.antes);
});

test('E2E semantico: Given a semantically valid change that fails a technical gate, when finalized, then it is not promoted', async () => {
  const r = await executar('valido-gate-falha', (wt) => {
    writeFileSync(join(wt, 'src', 'asset.js'), readFileSync(join(wt, 'src', 'asset.js'), 'utf8') + '\n// mudanca neutra\n');
    writeFileSync(join(wt, 'test', 'asset.test.mjs'), readFileSync(join(wt, 'test', 'asset.test.mjs'), 'utf8') + "\ntest('falha proposital', () => { assert.equal(1, 2); });\n");
  }, true);
  assert.equal(r.resultado.status, 'falha-validacao');
  assert.equal(r.depois, r.antes);
});
test('E2E semantico 9: Given the origin branch advances during the session, when finalized, then enforcement is valid on the reconciled state and no origin commit is lost', async () => {
  const repo = prepararProjeto('origem-avanca');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });
  writeFileSync(join(sessao.caminhoWorktree, 'src', 'asset.js'), readFileSync(join(sessao.caminhoWorktree, 'src', 'asset.js'), 'utf8') + '\n// melhoria valida\n');
  writeFileSync(join(repo, 'origem.txt'), 'B\n');
  git(repo, ['add', 'origem.txt']); git(repo, ['commit', '-q', '-m', 'B']);
  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({ sessao, domain: 'ativos', snapshot, alerts: [], tokenTotals: undefined, ontologyQueries: 0, harnessTokens: 0, confirmar: async () => true });
  assert.equal(resultado.status, 'promovido');
  assert.ok(existsSync(join(repo, 'origem.txt')), 'commit da origem perdido');
  assert.match(readFileSync(join(repo, 'src', 'asset.js'), 'utf8'), /melhoria valida/);
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '');
});

test('E2E semantico 10: Given a git conflict during reconciliation, then the origin stays intact and the conflict stays in the worktree', async () => {
  const repo = prepararProjeto('conflito-semantico');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });
  writeFileSync(join(sessao.caminhoWorktree, 'src', 'asset.js'), readFileSync(join(sessao.caminhoWorktree, 'src', 'asset.js'), 'utf8').replace('Baixado', 'BaixadoSessao'));
  writeFileSync(join(repo, 'src', 'asset.js'), readFileSync(join(repo, 'src', 'asset.js'), 'utf8').replace('Baixado', 'BaixadoOrigem'));
  git(repo, ['add', 'src/asset.js']); git(repo, ['commit', '-q', '-m', 'B']);
  const referenciaAntes = git(repo, ['rev-parse', 'HEAD']).trim();
  const snapshot = await createOntologySnapshot(repo);
  const resultado = await finalizeSession({ sessao, domain: 'ativos', snapshot, alerts: [], tokenTotals: undefined, ontologyQueries: 0, harnessTokens: 0, confirmar: async () => true });
  assert.equal(resultado.status, 'conflitado');
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referenciaAntes);
  assert.match(readFileSync(join(repo, 'src', 'asset.js'), 'utf8'), /BaixadoOrigem/);
  git(sessao.caminhoWorktree, ['rebase', '--abort']);
  await removerSessaoWorktree(sessao);
});

test('E2E semantico: no public path promotes without going through the enforcement gate', () => {
  const src = resolve('src');
  const arquivos = [];
  const percorrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) percorrer(caminho);
      else if (nome.endsWith('.ts')) arquivos.push(caminho);
    }
  };
  percorrer(src);
  const comPromocao = arquivos
    .filter((arquivo) => /promoverSessao\(|integrar\(|reconciliar\(/.test(readFileSync(arquivo, 'utf8')))
    .map((arquivo) => relative(src, arquivo).split('\\').join('/'))
    .sort();
  assert.deepEqual(comPromocao, ['agents/codex/finalize.ts', 'agents/codex/promotion.ts']);
});

test('E2E semantico 2: Given the agent reports a conflict, when finalized, then human review is requested and nothing is promoted', async () => {
  const repo = prepararProjeto('relato-agente');
  const commitBase = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase, diretorioBase: worktrees });
  const snapshot = await createOntologySnapshot(repo);
  const alertas = [
    { domain: 'ativos', request: 'permitir transferir ativo baixado', reason: 'ativo baixado nao pode ser transferido', conflictingRules: ['urn:enforcement:ativos:TransferenciaShape'] },
  ];
  const resultado = await finalizeSession({ sessao, domain: 'ativos', snapshot, alerts: alertas, tokenTotals: undefined, ontologyQueries: 0, harnessTokens: 0, confirmar: async () => false });
  assert.equal(resultado.status, 'descartado');
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '');
  await removerSessaoWorktree(sessao);
});
