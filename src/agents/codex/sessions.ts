import { existsSync } from 'node:fs';
import { gravarSessao, listarSessoes, type RegistroSessao } from './sessionState.js';
import { listarWorktrees, removerSessaoWorktree, type SessaoWorktree } from './worktree.js';

export interface SessaoListada {
  id: string;
  estado: string;
  branch: string;
  worktree: string;
  orfa: boolean;
}

export async function listarSessoesDoProjeto(repositorioOrigem: string): Promise<SessaoListada[]> {
  const registros = await listarSessoes(repositorioOrigem);
  const worktrees = await listarWorktrees(repositorioOrigem);
  const listadas: SessaoListada[] = registros.map((registro) => ({
    id: registro.id,
    estado: registro.estado,
    branch: registro.branchSessao,
    worktree: registro.caminhoWorktree,
    orfa: !existsSync(registro.caminhoWorktree),
  }));
  const branchesRegistradas = new Set(registros.map((registro) => registro.branchSessao));
  for (const worktree of worktrees) {
    if (worktree.branch.startsWith('oracle/session/') && !branchesRegistradas.has(worktree.branch)) {
      listadas.push({
        id: worktree.branch.slice('oracle/session/'.length),
        estado: 'ABORTED',
        branch: worktree.branch,
        worktree: worktree.caminho,
        orfa: true,
      });
    }
  }
  return listadas.sort((a, b) => a.id.localeCompare(b.id));
}

export async function limparSessao(repositorioOrigem: string, id: string): Promise<{ removida: boolean; detalhes: string }> {
  const registros = await listarSessoes(repositorioOrigem);
  const registro = registros.find((item) => item.id === id);
  if (registro) {
    await removerSessaoWorktree(registro, true);
    await gravarSessao(repositorioOrigem, registro, 'DISCARDED');
    return { removida: true, detalhes: `Sessao ${id} removida (worktree e branch).` };
  }
  const worktrees = await listarWorktrees(repositorioOrigem);
  const worktree = worktrees.find((item) => item.branch === `oracle/session/${id}`);
  if (worktree) {
    const sessao: SessaoWorktree = {
      id, repositorioOrigem, branchOrigem: '', commitBase: '', branchSessao: worktree.branch,
      caminhoWorktree: worktree.caminho, criadaEm: new Date().toISOString(),
    };
    await removerSessaoWorktree(sessao, true);
    return { removida: true, detalhes: `Worktree orfa ${id} removida.` };
  }
  return { removida: false, detalhes: `Sessao ${id} nao encontrada.` };
}

export type { RegistroSessao };
