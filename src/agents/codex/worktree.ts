import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { FileChange } from './snapshot.js';

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs });
  return result.stdout;
}

export async function gitDisponivel(): Promise<boolean> {
  try { await execFileAsync('git', ['--version']); return true; }
  catch { return false; }
}

export async function resolverRepositorio(path: string): Promise<string> {
  try {
    return (await git(path, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    throw new Error(`O projeto nao e um repositorio Git: ${path}. O isolamento por worktree exige Git.`);
  }
}

export async function branchAtual(repositorio: string): Promise<string> {
  try {
    return (await git(repositorio, ['symbolic-ref', '--short', 'HEAD'])).trim();
  } catch {
    return (await git(repositorio, ['rev-parse', '--short', 'HEAD'])).trim();
  }
}

export async function commitAtual(repositorio: string): Promise<string> {
  return (await git(repositorio, ['rev-parse', 'HEAD'])).trim();
}

export async function estaLimpo(repositorio: string): Promise<boolean> {
  return (await git(repositorio, ['status', '--porcelain'])).trim().length === 0;
}

export function diretorioWorktrees(): string {
  if (process.env.ORACLE_WORKTREES_DIR) return process.env.ORACLE_WORKTREES_DIR;
  return join(homedir(), '.local', 'state', 'oracle', 'worktrees');
}

export async function identificadorRepositorio(repositorio: string): Promise<string> {
  const canonico = await realpath(repositorio);
  return createHash('sha256').update(canonico).digest('hex').slice(0, 12);
}

export interface SessaoWorktree {
  id: string;
  repositorioOrigem: string;
  branchOrigem: string;
  commitBase: string;
  branchSessao: string;
  caminhoWorktree: string;
  criadaEm: string;
}

function identificadorSessao(): string {
  const agora = new Date();
  const dois = (valor: number) => String(valor).padStart(2, '0');
  return `${agora.getFullYear()}${dois(agora.getMonth() + 1)}${dois(agora.getDate())}`
    + `-${dois(agora.getHours())}${dois(agora.getMinutes())}${dois(agora.getSeconds())}`;
}

export interface OpcoesCriarSessao {
  repositorioOrigem: string;
  branchOrigem: string;
  commitBase: string;
  incluirEstadoLocal?: boolean;
}

export async function criarSessaoWorktree(opcoes: OpcoesCriarSessao): Promise<SessaoWorktree> {
  const { repositorioOrigem, branchOrigem, commitBase, incluirEstadoLocal = false } = opcoes;
  const repoId = await identificadorRepositorio(repositorioOrigem);
  const diretorioRepo = join(diretorioWorktrees(), repoId);
  await mkdir(diretorioRepo, { recursive: true });
  let id = identificadorSessao();
  let caminhoWorktree = join(diretorioRepo, id);
  let branchSessao = `oracle/session/${id}`;
  const existentes = await git(repositorioOrigem, ['worktree', 'list', '--porcelain']).catch(() => '');
  if (existentes.includes(caminhoWorktree) || existentes.includes(`branch refs/heads/${branchSessao}\n`)) {
    id = `${id}-1`;
    caminhoWorktree = join(diretorioRepo, id);
    branchSessao = `oracle/session/${id}`;
  }
  await git(repositorioOrigem, ['worktree', 'add', '-b', branchSessao, caminhoWorktree, commitBase]);
  const sessao: SessaoWorktree = {
    id, repositorioOrigem, branchOrigem, commitBase, branchSessao, caminhoWorktree, criadaEm: new Date().toISOString(),
  };
  if (incluirEstadoLocal) await transferirEstadoLocal(sessao);
  return sessao;
}

async function transferirEstadoLocal(sessao: SessaoWorktree): Promise<void> {
  const diff = await git(sessao.repositorioOrigem, ['diff', 'HEAD']).catch(() => '');
  if (diff.trim()) {
    const patch = join(tmpdir(), `oracle-session-${sessao.id}.patch`);
    await writeFile(patch, diff, { mode: 0o600 });
    try {
      await git(sessao.caminhoWorktree, ['apply', patch]);
    } catch (error) {
      throw new Error(`Nao foi possivel transferir o estado local para a worktree: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(patch, { force: true });
    }
  }
  const naoRastreados = await git(sessao.repositorioOrigem, ['ls-files', '--others', '--exclude-standard']);
  for (const relativo of naoRastreados.split('\n').filter(Boolean)) {
    const origem = join(sessao.repositorioOrigem, relativo);
    const destino = join(sessao.caminhoWorktree, relativo);
    await mkdir(dirname(destino), { recursive: true });
    await cp(origem, destino);
  }
}

export async function removerSessaoWorktree(sessao: SessaoWorktree, removerBranch = true): Promise<void> {
  await git(sessao.repositorioOrigem, ['worktree', 'remove', '--force', sessao.caminhoWorktree]).catch(() => undefined);
  await git(sessao.repositorioOrigem, ['worktree', 'prune']).catch(() => undefined);
  if (removerBranch) await git(sessao.repositorioOrigem, ['branch', '-D', sessao.branchSessao]).catch(() => undefined);
}

export async function listarWorktrees(repositorio: string): Promise<{ caminho: string; branch: string }[]> {
  const saida = await git(repositorio, ['worktree', 'list', '--porcelain']);
  const resultado: { caminho: string; branch: string }[] = [];
  let caminho = '';
  for (const linha of saida.split('\n')) {
    if (linha.startsWith('worktree ')) caminho = linha.slice('worktree '.length).trim();
    if (linha.startsWith('branch ')) resultado.push({ caminho, branch: linha.slice('branch '.length).trim().replace('refs/heads/', '') });
  }
  return resultado;
}

export async function alteracoesNaWorktree(sessao: SessaoWorktree): Promise<FileChange[]> {
  const saida = await git(sessao.caminhoWorktree, ['status', '--porcelain']);
  const alteracoes: FileChange[] = [];
  for (const linha of saida.split('\n')) {
    if (!linha.trim()) continue;
    const codigo = linha.slice(0, 2);
    const resto = linha.slice(3).trim();
    const partes = resto.split(' -> ');
    const caminho = (partes.length > 1 ? partes[partes.length - 1] : partes[0]).trim();
    if (!caminho) continue;
    if (caminho.startsWith('.oracle/local') || codigo === '!!') continue;
    const ehNovo = codigo.includes('?') || codigo.includes('A');
    alteracoes.push({ path: caminho, existedBefore: !ehNovo });
  }
  return alteracoes;
}

export async function commitSeNecessario(sessao: SessaoWorktree): Promise<boolean> {
  const estado = (await git(sessao.caminhoWorktree, ['status', '--porcelain'])).trim();
  if (!estado) return false;
  await git(sessao.caminhoWorktree, ['add', '-A']);
  await git(sessao.caminhoWorktree, [
    '-c', 'user.name=Oracle harness', '-c', 'user.email=oracle@localhost',
    'commit', '-m', `oracle: sessao ${sessao.id}`,
  ]);
  return true;
}
