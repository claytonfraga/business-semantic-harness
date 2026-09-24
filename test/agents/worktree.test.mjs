import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  alteracoesNaWorktree, branchAtual, commitAtual, criarSessaoWorktree, estaLimpo,
  listarWorktrees, removerSessaoWorktree,
} from '../../dist/agents/codex/worktree.js';
import { promoverSessao } from '../../dist/agents/codex/promotion.js';

const raiz = mkdtempSync(join(tmpdir(), 'oracle-worktree-test-'));
const worktrees = join(raiz, 'worktrees');

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function novoRepositorio(nome, conteudo = 'base\n') {
  const repo = join(raiz, nome);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  git(repo, ['config', 'user.name', 'Teste']);
  git(repo, ['config', 'user.email', 'teste@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'arquivo.txt'), conteudo);
  git(repo, ['add', 'arquivo.txt']);
  git(repo, ['commit', '-q', '-m', 'A']);
  return repo;
}

async function novaSessao(repo, incluirEstadoLocal = false) {
  return criarSessaoWorktree({
    repositorioOrigem: repo,
    branchOrigem: await branchAtual(repo),
    commitBase: await commitAtual(repo),
    incluirEstadoLocal,
    diretorioBase: worktrees,
  });
}

const gatesOk = async () => ({ ok: true, saida: 'ok' });
const gatesFalha = async () => ({ ok: false, saida: 'testes falharam' });

after(() => rmSync(raiz, { recursive: true, force: true }));

test('Given a repository on main, when a session starts, then a dedicated branch and worktree are created from HEAD', async () => {
  const repo = novoRepositorio('criacao');
  const base = await commitAtual(repo);
  const sessao = await novaSessao(repo);
  assert.equal(sessao.commitBase, base);
  assert.ok(sessao.branchSessao.startsWith('oracle/session/'));
  assert.ok(existsSync(sessao.caminhoWorktree));
  const worktreesListadas = await listarWorktrees(repo);
  assert.ok(worktreesListadas.some((item) => item.branch === sessao.branchSessao));
});

test('Given a session worktree, when the agent edits a file, then only the worktree changes', async () => {
  const repo = novoRepositorio('isolamento');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'alterado\n');
  assert.equal(readFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'utf8'), 'alterado\n');
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'base\n');
});

test('Given a session worktree, when the agent creates a file, then it does not exist in the main checkout before promotion', async () => {
  const repo = novoRepositorio('arquivo-novo');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'novo.txt'), 'novo\n');
  assert.ok(existsSync(join(sessao.caminhoWorktree, 'novo.txt')));
  assert.equal(existsSync(join(repo, 'novo.txt')), false);
});

test('Given a session worktree, when the agent removes a file, then the removal happens only in the worktree until promotion', async () => {
  const repo = novoRepositorio('remocao');
  const sessao = await novaSessao(repo);
  rmSync(join(sessao.caminhoWorktree, 'arquivo.txt'));
  assert.equal(existsSync(join(sessao.caminhoWorktree, 'arquivo.txt')), false);
  assert.ok(existsSync(join(repo, 'arquivo.txt')));
});

test('Given the origin branch did not move, when the session is promoted, then changes reach the origin branch by Git', async () => {
  const repo = novoRepositorio('promocao-ff');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'promovido\n');
  const resultado = await promoverSessao(sessao, { validarGates: gatesOk });
  assert.equal(resultado.status, 'promovido');
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'promovido\n');
  assert.equal(await estaLimpo(repo), true);
});

test('Given the origin branch advanced, when promoting, then the session is rebased without losing the origin commits', async () => {
  const repo = novoRepositorio('rebase');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'sessao.txt'), 'X\n');
  writeFileSync(join(repo, 'origem.txt'), 'B\n');
  git(repo, ['add', 'origem.txt']);
  git(repo, ['commit', '-q', '-m', 'B']);
  const resultado = await promoverSessao(sessao, { validarGates: gatesOk });
  assert.equal(resultado.status, 'promovido');
  assert.ok(existsSync(join(repo, 'origem.txt')));
  assert.ok(existsSync(join(repo, 'sessao.txt')));
});

test('Given a rebase conflict, when promoting, then the main branch stays unchanged and the conflict stays in the worktree', async () => {
  const repo = novoRepositorio('conflito');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'sessao\n');
  writeFileSync(join(repo, 'arquivo.txt'), 'origem\n');
  git(repo, ['add', 'arquivo.txt']);
  git(repo, ['commit', '-q', '-m', 'B']);
  const referenciaAntes = git(repo, ['rev-parse', 'HEAD']).trim();
  const resultado = await promoverSessao(sessao, { validarGates: gatesOk });
  assert.equal(resultado.status, 'conflitado');
  assert.ok(resultado.arquivosConflito.includes('arquivo.txt'));
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referenciaAntes);
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'origem\n');
  git(sessao.caminhoWorktree, ['rebase', '--abort']);
  await removerSessaoWorktree(sessao);
});

test('Given the gates fail, when promoting, then nothing is promoted and the origin branch is intact', async () => {
  const repo = novoRepositorio('gates');
  const referenciaAntes = git(repo, ['rev-parse', 'HEAD']).trim();
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'nao-promover\n');
  const resultado = await promoverSessao(sessao, { validarGates: gatesFalha });
  assert.equal(resultado.status, 'falha-validacao');
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referenciaAntes);
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'base\n');
});

test('Given a cancelled session, when the worktree is discarded, then the main checkout is unchanged', async () => {
  const repo = novoRepositorio('cancelamento');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'descartar\n');
  await removerSessaoWorktree(sessao);
  assert.equal(existsSync(sessao.caminhoWorktree), false);
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'base\n');
});

test('Given two simultaneous sessions, when both start, then each has its own branch and worktree', async () => {
  const repo = novoRepositorio('paralelo');
  const primeira = await novaSessao(repo);
  const segunda = await novaSessao(repo);
  assert.notEqual(primeira.branchSessao, segunda.branchSessao);
  assert.notEqual(primeira.caminhoWorktree, segunda.caminhoWorktree);
  writeFileSync(join(primeira.caminhoWorktree, 'a.txt'), 'A\n');
  assert.equal(existsSync(join(segunda.caminhoWorktree, 'a.txt')), false);
});

test('Given uncommitted local changes, when a session starts, then no stash/reset/restore/clean touches them', async () => {
  const repo = novoRepositorio('local-ignorado');
  writeFileSync(join(repo, 'arquivo.txt'), 'local\n');
  const sessao = await novaSessao(repo, false);
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'local\n');
  assert.equal(readFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'utf8'), 'base\n');
});

test('Given uncommitted local changes, when a session includes the local state, then it is copied non-destructively', async () => {
  const repo = novoRepositorio('local-incluido');
  writeFileSync(join(repo, 'arquivo.txt'), 'local\n');
  writeFileSync(join(repo, 'novo-local.txt'), 'novo\n');
  const sessao = await novaSessao(repo, true);
  assert.equal(readFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'utf8'), 'local\n');
  assert.ok(existsSync(join(sessao.caminhoWorktree, 'novo-local.txt')));
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'local\n');
});

test('Given the main checkout is dirty, when promotion is attempted, then it is blocked and the main checkout is not overwritten', async () => {
  const repo = novoRepositorio('principal-sujo');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'sessao\n');
  writeFileSync(join(repo, 'pendencias.txt'), 'nao commitado\n');
  const resultado = await promoverSessao(sessao, { validarGates: gatesOk });
  assert.equal(resultado.status, 'bloqueado');
  assert.equal(readFileSync(join(repo, 'pendencias.txt'), 'utf8'), 'nao commitado\n');
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'base\n');
});

test('Given a successful promotion, when the session is cleaned up, then the worktree is removed without losing promoted commits', async () => {
  const repo = novoRepositorio('limpeza');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'promovido\n');
  const resultado = await promoverSessao(sessao, { validarGates: gatesOk });
  assert.equal(resultado.status, 'promovido');
  await removerSessaoWorktree(sessao);
  assert.equal(existsSync(sessao.caminhoWorktree), false);
  assert.equal(readFileSync(join(repo, 'arquivo.txt'), 'utf8'), 'promovido\n');
  const status = git(repo, ['status', '--porcelain']).trim();
  assert.equal(status, '');
});

test('Given a worktree with changes, when listed, then its changes are reported', async () => {
  const repo = novoRepositorio('alteracoes');
  const sessao = await novaSessao(repo);
  writeFileSync(join(sessao.caminhoWorktree, 'arquivo.txt'), 'editado\n');
  writeFileSync(join(sessao.caminhoWorktree, 'novo.txt'), 'novo\n');
  const alteracoes = await alteracoesNaWorktree(sessao);
  const caminhos = alteracoes.map((item) => item.path).sort();
  assert.deepEqual(caminhos, ['arquivo.txt', 'novo.txt']);
  assert.equal(alteracoes.find((item) => item.path === 'novo.txt').existedBefore, false);
});
