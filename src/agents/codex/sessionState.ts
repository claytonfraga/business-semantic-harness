import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessaoWorktree } from './worktree.js';

export const ESTADOS_SESSAO = [
  'CREATED', 'WORKTREE_READY', 'AGENT_RUNNING', 'CHANGES_READY', 'VALIDATING',
  'READY_TO_PROMOTE', 'PROMOTING', 'PROMOTED', 'CLEANED',
  'VALIDATION_FAILED', 'CONFLICTED', 'PROMOTION_FAILED', 'ABORTED', 'DISCARDED',
] as const;

export type EstadoSessao = typeof ESTADOS_SESSAO[number];

export interface RegistroSessao extends SessaoWorktree {
  estado: EstadoSessao;
  atualizadaEm: string;
}

function diretorioSessoes(repositorioOrigem: string): string {
  return join(repositorioOrigem, '.oracle', 'local', 'sessions');
}

export async function gravarSessao(repositorioOrigem: string, sessao: SessaoWorktree, estado: EstadoSessao): Promise<string> {
  const diretorio = diretorioSessoes(repositorioOrigem);
  await mkdir(diretorio, { recursive: true });
  const registro: RegistroSessao = { ...sessao, estado, atualizadaEm: new Date().toISOString() };
  const arquivo = join(diretorio, `${sessao.id}.json`);
  await writeFile(arquivo, JSON.stringify(registro, null, 2), { mode: 0o600 });
  return arquivo;
}

export async function listarSessoes(repositorioOrigem: string): Promise<RegistroSessao[]> {
  let nomes: string[];
  try { nomes = await readdir(diretorioSessoes(repositorioOrigem)); }
  catch { return []; }
  const registros: RegistroSessao[] = [];
  for (const nome of nomes.filter((item) => item.endsWith('.json')).sort()) {
    try { registros.push(JSON.parse(await readFile(join(diretorioSessoes(repositorioOrigem), nome), 'utf8')) as RegistroSessao); }
    catch { /* registro invalido e ignorado */ }
  }
  return registros;
}

export async function lerSessao(arquivo: string): Promise<RegistroSessao> {
  return JSON.parse(await readFile(arquivo, 'utf8')) as RegistroSessao;
}
