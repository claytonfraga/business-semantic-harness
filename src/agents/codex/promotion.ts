import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { commitSeNecessario, estaLimpo, git, type SessaoWorktree } from './worktree.js';

const execFileAsync = promisify(execFile);

export interface ResultadoGates {
  ok: boolean;
  saida: string;
}

export type StatusPromocao = 'promovido' | 'bloqueado' | 'conflitado' | 'falha-validacao';

export interface ResultadoPromocao {
  status: StatusPromocao;
  detalhes: string;
  arquivosConflito?: string[];
}

export type ValidadorGates = (workspace: string) => Promise<ResultadoGates>;

export async function executarGates(workspace: string): Promise<ResultadoGates> {
  let pacote: { scripts?: Record<string, string> };
  try {
    pacote = JSON.parse(await readFile(join(workspace, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
  } catch {
    return { ok: true, saida: 'Sem package.json; nenhum gate definido.' };
  }
  const scripts = pacote.scripts ?? {};
  const comandos: string[][] = [];
  if (scripts.quality) comandos.push(['run', 'quality']);
  if (scripts.test) comandos.push(['test']);
  if (comandos.length === 0) return { ok: true, saida: 'Sem gates definidos no projeto.' };
  let saida = '';
  for (const argumentos of comandos) {
    try {
      const resultado = await execFileAsync('npm', argumentos, { cwd: workspace, maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60_000 });
      saida += `$ npm ${argumentos.join(' ')}\n${resultado.stdout}\n`;
    } catch (error) {
      const falha = error as { stdout?: string; stderr?: string; message?: string };
      saida += `$ npm ${argumentos.join(' ')}\n${falha.stdout ?? ''}\n${falha.stderr ?? falha.message ?? ''}\n`;
      return { ok: false, saida };
    }
  }
  return { ok: true, saida };
}

export interface OpcoesPromocao {
  validarGates?: ValidadorGates;
}

export async function promoverSessao(sessao: SessaoWorktree, opcoes: OpcoesPromocao = {}): Promise<ResultadoPromocao> {
  const validarGates = opcoes.validarGates ?? executarGates;
  if (!(await estaLimpo(sessao.repositorioOrigem))) {
    return { status: 'bloqueado', detalhes: 'O checkout principal tem alteracoes locais; a promocao nao foi iniciada.' };
  }
  await commitSeNecessario(sessao);
  const referenciaOrigem = (await git(sessao.repositorioOrigem, ['rev-parse', sessao.branchOrigem])).trim();
  if (referenciaOrigem !== sessao.commitBase) {
    try {
      await git(sessao.caminhoWorktree, ['rebase', sessao.branchOrigem]);
    } catch {
      const conflitos = (await git(sessao.caminhoWorktree, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
        .split('\n').filter(Boolean);
      return { status: 'conflitado', detalhes: `A branch ${sessao.branchOrigem} avancou e o rebase gerou conflito na worktree.`, arquivosConflito: conflitos };
    }
  }
  const gates = await validarGates(sessao.caminhoWorktree);
  if (!gates.ok) return { status: 'falha-validacao', detalhes: gates.saida };
  try {
    await git(sessao.repositorioOrigem, ['merge', '--ff-only', sessao.branchSessao]);
  } catch (error) {
    return { status: 'bloqueado', detalhes: `Nao foi possivel integrar por fast-forward: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { status: 'promovido', detalhes: `Alteracoes integradas em ${sessao.branchOrigem}.` };
}
