import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { branchAtual, commitAtual, criarSessaoWorktree } from '../../dist/agents/codex/worktree.js';
import { gravarSessao } from '../../dist/agents/codex/sessionState.js';
import { limparSessao, listarSessoesDoProjeto } from '../../dist/agents/codex/sessions.js';

const raiz = mkdtempSync(join(tmpdir(), 'oracle-sessions-test-'));
process.env.ORACLE_WORKTREES_DIR = join(raiz, 'worktrees');

function novoRepositorio(nome) {
  const repo = join(raiz, nome);
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Teste'], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'teste@example.com'], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'config', 'commit.gpgsign', 'false'], { encoding: 'utf8' });
  writeFileSync(join(repo, 'arquivo.txt'), 'base\n');
  execFileSync('git', ['-C', repo, 'add', 'arquivo.txt'], { encoding: 'utf8' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'A'], { encoding: 'utf8' });
  return repo;
}

after(() => rmSync(raiz, { recursive: true, force: true }));

test('Given a registered session, when listing, then it reports state, branch and worktree', async () => {
  const repo = novoRepositorio('listar');
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: await branchAtual(repo), commitBase: await commitAtual(repo) });
  await gravarSessao(repo, sessao, 'WORKTREE_READY');
  const sessoes = await listarSessoesDoProjeto(repo);
  const encontrada = sessoes.find((item) => item.id === sessao.id);
  assert.ok(encontrada);
  assert.equal(encontrada.estado, 'WORKTREE_READY');
  assert.equal(encontrada.branch, sessao.branchSessao);
  assert.equal(encontrada.orfa, false);
});

test('Given a registered session, when cleaned, then the worktree and branch are removed', async () => {
  const repo = novoRepositorio('limpar');
  const sessao = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: await branchAtual(repo), commitBase: await commitAtual(repo) });
  await gravarSessao(repo, sessao, 'CONFLICTED');
  const resultado = await limparSessao(repo, sessao.id);
  assert.equal(resultado.removida, true);
  assert.equal(existsSync(sessao.caminhoWorktree), false);
  const branches = execFileSync('git', ['-C', repo, 'branch', '--list', sessao.branchSessao], { encoding: 'utf8' }).trim();
  assert.equal(branches, '');
});

test('Given a session id that does not exist, when cleaning, then it reports not found', async () => {
  const repo = novoRepositorio('inexistente');
  const resultado = await limparSessao(repo, 'nao-existe');
  assert.equal(resultado.removida, false);
});
