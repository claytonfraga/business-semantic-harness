import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  alteracoesNaWorktree, branchAtual, commitAtual, criarSessaoWorktree, estaLimpo, removerSessaoWorktree,
} from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { gravarSessao } from '../../dist/git/sessionState.js';
import { limparSessao, listarSessoesDoProjeto } from '../../dist/git/sessions.js';

const raiz = mkdtempSync(join(tmpdir(), 'bsh-adversarial-'));
const worktrees = join(raiz, 'worktrees');
const gatesOk = async () => ({ ok: true, saida: 'ok' });

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function novoProjeto(caminho) {
  const repo = join(raiz, caminho);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  git(repo, ['config', 'user.name', 'Teste']);
  git(repo, ['config', 'user.email', 'teste@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(repo, 'server.ts'), '// base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'A']);
  return repo;
}

async function sessao(repo, incluirEstadoLocal = false) {
  const criada = await criarSessaoWorktree({
    repositorioOrigem: repo, branchOrigem: await branchAtual(repo), commitBase: await commitAtual(repo),
    incluirEstadoLocal, diretorioBase: worktrees,
  });
  await gravarSessao(repo, criada, 'WORKTREE_READY');
  return criada;
}

after(() => rmSync(raiz, { recursive: true, force: true }));

test('Adversarial ids: three sessions started in the same second get distinct branches and worktrees', async () => {
  const repo = novoProjeto('colisao-id');
  const s1 = await sessao(repo);
  const s2 = await sessao(repo);
  const s3 = await sessao(repo);
  const ids = new Set([s1.id, s2.id, s3.id]);
  assert.equal(ids.size, 3);
  assert.ok(existsSync(s1.caminhoWorktree) && existsSync(s2.caminhoWorktree) && existsSync(s3.caminhoWorktree));
});

test('Adversarial repositorios homonimos: repositories with the same basename use distinct worktree directories', async () => {
  const a = novoProjeto('a/meu-repo');
  const b = novoProjeto('b/meu-repo');
  const sa = await sessao(a);
  const sb = await sessao(b);
  assert.notEqual(sa.caminhoWorktree, sb.caminhoWorktree);
});

test('Adversarial detached HEAD: promotion on a detached origin does not throw and does not move the branch', async () => {
  const repo = novoProjeto('detached');
  git(repo, ['checkout', '-q', '--detach', 'HEAD']);
  const referencia = git(repo, ['rev-parse', 'HEAD']).trim();
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// detached\n');
  const resultado = await promoverSessao(s, { validarGates: gatesOk });
  assert.equal(resultado.status, 'bloqueado');
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referencia);
});

test('Adversarial delecao: promoting a deletion removes the file from the origin branch', async () => {
  const repo = novoProjeto('delecao');
  const s = await sessao(repo);
  rmSync(join(s.caminhoWorktree, 'server.ts'));
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  assert.equal(existsSync(join(repo, 'server.ts')), false);
});

test('Adversarial rename: promoting a rename propagates the new name and removes the old one', async () => {
  const repo = novoProjeto('rename');
  const s = await sessao(repo);
  git(s.caminhoWorktree, ['mv', 'server.ts', 'servidor.ts']);
  const alteracoes = (await alteracoesNaWorktree(s)).map((item) => item.path);
  assert.ok(alteracoes.includes('servidor.ts'));
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  assert.ok(existsSync(join(repo, 'servidor.ts')));
  assert.equal(existsSync(join(repo, 'server.ts')), false);
});

test('Adversarial nomes: files with spaces and accents are detected and promoted', async () => {
  const repo = novoProjeto('nomes');
  const s = await sessao(repo);
  const nome = 'relatório de transferência.txt';
  writeFileSync(join(s.caminhoWorktree, nome), 'conteudo\n');
  const alteracoes = (await alteracoesNaWorktree(s)).map((item) => item.path);
  assert.ok(alteracoes.includes(nome));
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  assert.ok(existsSync(join(repo, nome)));
});

test('Adversarial symlink: a symlink created in the worktree is promoted', async () => {
  const repo = novoProjeto('symlink');
  const s = await sessao(repo);
  symlinkSync('server.ts', join(s.caminhoWorktree, 'atalho.ts'));
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
  assert.ok(lstatSync(join(repo, 'atalho.ts')).isSymbolicLink());
});

test('Adversarial estado local: including local changes is non-destructive and applies in the worktree', async () => {
  const repo = novoProjeto('estado-local');
  writeFileSync(join(repo, 'server.ts'), '// local\n');
  const s = await sessao(repo, true);
  assert.equal(readFileSync(join(repo, 'server.ts'), 'utf8'), '// local\n');
  assert.equal(readFileSync(join(s.caminhoWorktree, 'server.ts'), 'utf8'), '// local\n');
});

test('Adversarial orfa: a manually created worktree is listed as orphan and can be cleaned', async () => {
  const repo = novoProjeto('orfa');
  const caminhoOrfa = join(worktrees, 'manual', 'orfa');
  mkdirSync(join(worktrees, 'manual'), { recursive: true });
  git(repo, ['worktree', 'add', '-b', 'bsh/session/manual', caminhoOrfa, 'HEAD']);
  const listadas = await listarSessoesDoProjeto(repo);
  const orfa = listadas.find((item) => item.id === 'manual');
  assert.ok(orfa);
  assert.equal(orfa.orfa, true);
  assert.equal((await limparSessao(repo, 'manual')).removida, true);
  assert.equal(existsSync(caminhoOrfa), false);
});

test('Adversarial registro obsoleto: a session whose worktree was deleted manually is marked orphan', async () => {
  const repo = novoProjeto('registro-obsoleto');
  const s = await sessao(repo);
  rmSync(s.caminhoWorktree, { recursive: true, force: true });
  const listadas = await listarSessoesDoProjeto(repo);
  const encontrada = listadas.find((item) => item.id === s.id);
  assert.ok(encontrada);
  assert.equal(encontrada.orfa, true);
});

test('Adversarial duas promocoes: two sessions promoted sequentially keep both changes and no origin commit is lost', async () => {
  const repo = novoProjeto('duas-promocoes');
  const s1 = await sessao(repo);
  const s2 = await sessao(repo);
  writeFileSync(join(s1.caminhoWorktree, 'a.txt'), 'A\n');
  writeFileSync(join(s2.caminhoWorktree, 'b.txt'), 'B\n');
  assert.equal((await promoverSessao(s1, { validarGates: gatesOk })).status, 'promovido');
  assert.equal((await promoverSessao(s2, { validarGates: gatesOk })).status, 'promovido');
  assert.ok(existsSync(join(repo, 'a.txt')));
  assert.ok(existsSync(join(repo, 'b.txt')));
  await removerSessaoWorktree(s1);
  await removerSessaoWorktree(s2);
});

test('Adversarial sem mudancas: promoting a session with no changes is a no-op that does not alter the origin', async () => {
  const repo = novoProjeto('sem-mudancas');
  const referencia = git(repo, ['rev-parse', 'HEAD']).trim();
  const s = await sessao(repo);
  const resultado = await promoverSessao(s, { validarGates: gatesOk });
  assert.equal(resultado.status, 'promovido');
  assert.equal(git(repo, ['rev-parse', 'HEAD']).trim(), referencia);
});

test('Adversarial sem gitignore: BSH local state does not dirty the origin and promotion still works', async () => {
  const repo = novoProjeto('sem-gitignore');
  writeFileSync(join(repo, '.gitignore'), ''); // projeto sem regra para .bsh/local
  git(repo, ['add', '.gitignore']);
  git(repo, ['commit', '-q', '-m', 'gitignore']);
  const s = await sessao(repo);
  assert.equal(await estaLimpo(repo), true);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// ok\n');
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'promovido');
});

test('Adversarial index sujo: staged changes in the origin block promotion', async () => {
  const repo = novoProjeto('index-sujo');
  const s = await sessao(repo);
  writeFileSync(join(s.caminhoWorktree, 'server.ts'), '// sessao\n');
  writeFileSync(join(repo, 'staged.txt'), 'staged\n');
  git(repo, ['add', 'staged.txt']);
  assert.equal((await promoverSessao(s, { validarGates: gatesOk })).status, 'bloqueado');
});

test('Adversarial .bsh/local: BSH local state is not shared into the session worktree', async () => {
  const repo = novoProjeto('local-nao-compartilhado');
  mkdirSync(join(repo, '.bsh', 'local'), { recursive: true });
  writeFileSync(join(repo, '.bsh', 'local', 'segredo.json'), '{}\n');
  const s = await sessao(repo);
  assert.equal(existsSync(join(s.caminhoWorktree, '.bsh', 'local')), false);
});
