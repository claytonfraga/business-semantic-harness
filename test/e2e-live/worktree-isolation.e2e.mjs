import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  alteracoesNaWorktree, branchAtual, commitAtual, criarSessaoWorktree, estaLimpo,
  listarWorktrees, removerSessaoWorktree,
} from '../../dist/agents/codex/worktree.js';
import { promoverSessao } from '../../dist/agents/codex/promotion.js';
import { gravarSessao } from '../../dist/agents/codex/sessionState.js';
import { limparSessao, listarSessoesDoProjeto } from '../../dist/agents/codex/sessions.js';

const raiz = mkdtempSync(join(tmpdir(), 'bsh-e2e-worktree-'));

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function novoProjeto(nome) {
  const repo = join(raiz, nome);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  git(repo, ['config', 'user.name', 'Teste']);
  git(repo, ['config', 'user.email', 'teste@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'server.ts'), '// base\n');
  writeFileSync(join(repo, 'delete-me.ts'), '// base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'A']);
  return repo;
}

async function sessao(repo, incluirEstadoLocal = false) {
  const criada = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: await branchAtual(repo), commitBase: await commitAtual(repo), incluirEstadoLocal, diretorioBase: join(raiz, 'worktrees') });
  await gravarSessao(repo, criada, 'WORKTREE_READY');
  return criada;
}

const gatesOk = async () => ({ ok: true, saida: 'ok' });
const gatesFalha = async () => ({ ok: false, saida: 'gate falhou' });

after(() => rmSync(raiz, { recursive: true, force: true }));

test('E2E Isolamento: Given a session, when the agent edits, creates and removes files, then the main checkout is byte-for-byte intact', async () => {
  const repo = novoProjeto('isolamento');
  const antes = readFileSync(join(repo, 'server.ts'), 'utf8');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// alterado\n');
  writeFileSync(join(s.caminhoWorktree, 'novo.ts'), '// novo\n');
  rmSync(join(s.caminhoWorktree, 'delete-me.ts'));
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), antes);
  assert.equal(existsSync(join(repo, 'novo.ts')), false);
  assert.ok(existsSync(join(repo, 'delete-me.ts')));
});

test('E2E Promocao: Given the origin branch did not move, when promoted, then the change reaches the origin branch', async () => {
  const repo = novoProjeto('ff');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// promovido\n');
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// promovido\n');
  assert.ok(await estaLimpo(repo));
});

test('E2E Adversarial: Given the origin branch advanced, when promoting, then no origin commit is lost', async () => {
  const repo = novoProjeto('rebase');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'sessao.ts'), '// X\n');
  writeFileSync(join(repo, 'origem.ts'), '// B\n');
  git(repo, ['add', 'origem.ts']);
  git(repo, ['commit', '-q', '-m', 'B']);
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  assert.ok(existsSync(join(repo, 'origem.ts')));
  assert.ok(existsSync(join(repo, 'sessao.ts')));
});

test('E2E Adversarial: Given a rebase conflict, then the main branch is not touched and the conflict stays in the worktree', async () => {
  const repo = novoProjeto('conflito');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// sessao\n');
  writeFileSync(join(repo, 'server.ts'), '// origem\n');
  git(repo, ['add', 'server.ts']);
  git(repo, ['commit', '-q', '-m', 'B']);
  const referencia = git(repo, ['rev-parse', 'HEAD']).trim();
  const resultado = await promoverSessao(s, { validarGates: gatesOk });
  assert.equal(resultado.status, 'conflitado');
  assert.ok(resultado.arquivosConflito.includes('server.ts'));
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referencia);
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// origem\n');
  git(s.caminhoWorktree, ['rebase', '--abort']);
  await removerSessaoWorktree(s);
});

test('E2E Adversarial: Given failing gates, when promoting, then nothing is promoted', async () => {
  const repo = novoProjeto('gates');
  const referencia = git(repo, ['rev-parse', 'HEAD']).trim();
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// nao promover\n');
  assert.equal((await promoverSessao(s, { validarGates: gatesFalha })).status, 'falha-validacao');
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referencia);
});

test('E2E Adversarial: Given a dirty main checkout, when promoting, then promotion is blocked and nothing is overwritten', async () => {
  const repo = novoProjeto('principal-sujo');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// sessao\n');
  writeFileSync(join(repo, 'pendencias.ts'), '// nao commitado\n');
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'bloqueado');
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// base\n');
  assert.equal(readFileSync(join(repo, 'pendencias.ts'), 'utf8'), '// nao commitado\n');
});

test('E2E Adversarial: Given uncommitted local changes, then no stash/reset/restore/clean touches them', async () => {
  const repo = novoProjeto('local');
  writeFileSync(join(repo, 'server.ts'), '// local\n');
  const s = await sessao(repo, false);
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// local\n');
  assert.equal(readFileSync(join(s.caminhoWorktree, 'server.ts'), 'utf8'), '// base\n');
});

test('E2E Paralelismo: Given two sessions, then each has its own branch and worktree', async () => {
  const repo = novoProjeto('paralelo');
  const a = await sessao(repo);
  const b = await sessao(repo);
  assert.notEqual(a.branchSessao, b.branchSessao);
  assert.notEqual(a.caminhoWorktree, b.caminhoWorktree);
  writeFileSync(join(a.caminhoWorktree, 'so-a.ts'), '// A\n');
  assert.equal(existsSync(join(b.caminhoWorktree, 'so-a.ts')), false);
});

test('E2E Recuperacao: Given a registered session, when listed and cleaned, then it is removed without touching the main checkout', async () => {
  const repo = novoProjeto('recuperacao');
  const s = await sessao(repo);
  const listadas = await listarSessoesDoProjeto(repo);
  assert.ok(listadas.some((item) => item.id === s.id));
  assert.equal((await limparSessao(repo, s.id)).removida, true);
  assert.equal(existsSync(s.caminhoWorktree), false);
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// base\n');
});

test('E2E Limpeza: Given a successful promotion, then the worktree is removed without losing the promoted commit', async () => {
  const repo = novoProjeto('limpeza');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// promovido\n');
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  await removerSessaoWorktree(s);
  assert.equal(existsSync(s.caminhoWorktree), false);
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// promovido\n');
});

test('E2E Base congelada: Given the origin branch moves while the session runs, then the worktree base does not change silently', async () => {
  const repo = novoProjeto('base-congelada');
  const s = await sessao(repo);
  const baseNaWorktree = git(s.caminhoWorktree, ['rev-parse', 'HEAD']).trim();
  writeFileSync(join(repo, 'origem.ts'), '// B\n');
  git(repo, ['add', 'origem.ts']);
  git(repo, ['commit', '-q', '-m', 'B']);
  assert.equal(git(s.caminhoWorktree, ['rev-parse', 'HEAD']).trim(), baseNaWorktree);
});
