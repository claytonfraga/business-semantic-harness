import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../git/worktree.js';
import type { OperacaoSemantica } from './operacaoSemantica.js';
import type { RegraGovernanca, CondicaoQuando, CondicaoItem } from './governanca.js';

export interface DiffArquivo {
  caminho: string;
  caminhoOrigem?: string;
  tipo: 'adicionado' | 'modificado' | 'removido' | 'renomeado';
  adicionadas: string[];
  removidas: string[];
  removido: boolean;
  conteudoAtual?: string;
  conteudoAnterior?: string;
}

export function paraRegex(glob: string): RegExp {
  let normalized = glob.replace(/\\/g, '/');
  const DOUBLE_STAR = '___DOUBLE_STAR___';
  const SINGLE_STAR = '___SINGLE_STAR___';
  const QUESTION = '___QUESTION___';

  normalized = normalized.replace(/\*\*/g, DOUBLE_STAR);
  normalized = normalized.replace(/\*/g, SINGLE_STAR);
  normalized = normalized.replace(/\?/g, QUESTION);

  let escaped = normalized.replace(/[.+^$(){}|[\]\\]/g, '\\$&');

  escaped = escaped.replace(new RegExp(`/${DOUBLE_STAR}/`, 'g'), '(?:/|/.+/)');
  escaped = escaped.replace(new RegExp(`^${DOUBLE_STAR}/`, 'g'), '(?:^|.+/)');
  escaped = escaped.replace(new RegExp(`/${DOUBLE_STAR}$`, 'g'), '(?:/.*)?');
  escaped = escaped.replace(new RegExp(DOUBLE_STAR, 'g'), '.*');
  escaped = escaped.replace(new RegExp(SINGLE_STAR, 'g'), '[^/]*');
  escaped = escaped.replace(new RegExp(QUESTION, 'g'), '[^/]');

  return new RegExp(`^${escaped}$`);
}

export function limparComentarios(linha: string): string {
  let limpa = linha.replace(/\/\/.*$/, '').replace(/#.*$/, '').replace(/--.*$/, '');
  limpa = limpa
    .replace(/\/\*.*?\*\//g, '')
    .replace(/^\s*\*.*$/, '')
    .replace(/\/\*.*$/, '')
    .replace(/^.*?\*\//, '');
  return limpa.trim();
}

export function isLinhaApenasMensagemOuLog(linha: string): boolean {
  const limpa = linha.trim();
  return (
    limpa.startsWith('console.') ||
    limpa.startsWith('logger.') ||
    limpa.startsWith('log.') ||
    limpa.startsWith('throw new Error(') ||
    limpa.startsWith('throw new ') ||
    limpa.startsWith('alert(')
  );
}

export function normalizarTexto(texto: string): string {
  return texto
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;{}[\]:=<>+*/-])\s*/g, '$1')
    .trim();
}

export function linhaContemPadrao(
  linha: string,
  padrao: string,
  opcoes: { ignorarComentarios?: boolean; ignorarMensagens?: boolean } = {}
): boolean {
  const ignorarComentarios = opcoes.ignorarComentarios ?? false;
  const ignorarMensagens = opcoes.ignorarMensagens ?? false;

  let textoAvaliar = linha;
  if (ignorarComentarios) {
    textoAvaliar = limparComentarios(textoAvaliar);
  }
  if (!textoAvaliar) return false;

  if (ignorarMensagens && isLinhaApenasMensagemOuLog(textoAvaliar)) {
    return false;
  }

  const normLinha = normalizarTexto(textoAvaliar);
  const normPadrao = normalizarTexto(padrao);
  return normLinha.includes(normPadrao);
}

export function conteudoContemPadrao(
  conteudo: string | undefined,
  padrao: string,
  opcoes: { ignorarComentarios?: boolean; ignorarMensagens?: boolean } = {}
): boolean {
  if (!conteudo) return false;
  const linhas = conteudo.split('\n');
  return linhas.some((l) => linhaContemPadrao(l, padrao, opcoes));
}

export function avaliarCondicaoItem(cond: CondicaoItem, diff: DiffArquivo): boolean {
  const opts = {
    ignorarComentarios: cond.ignorarComentarios ?? false,
    ignorarMensagens: cond.ignorarMensagens ?? false,
  };

  const checks: boolean[] = [];

  if (cond.caminho) {
    const regex = paraRegex(cond.caminho);
    const matchesPath = regex.test(diff.caminho) || (diff.caminhoOrigem && regex.test(diff.caminhoOrigem));
    checks.push(Boolean(matchesPath));
  }

  if (cond.arquivoRemovido !== undefined) {
    checks.push(diff.removido === cond.arquivoRemovido);
  }

  if (cond.arquivoAdicionado !== undefined) {
    checks.push((diff.tipo === 'adicionado') === cond.arquivoAdicionado);
  }

  if (cond.arquivoRenomeado !== undefined) {
    checks.push((diff.tipo === 'renomeado') === cond.arquivoRenomeado);
  }

  if (typeof cond.adicionou === 'string') {
    const matched =
      diff.adicionadas.some((l) => linhaContemPadrao(l, cond.adicionou as string, opts)) ||
      conteudoContemPadrao(diff.conteudoAtual, cond.adicionou as string, opts);
    checks.push(matched);
  }

  if (typeof cond.removeu === 'string') {
    const matched =
      diff.removidas.some((l) => linhaContemPadrao(l, cond.removeu as string, opts)) ||
      conteudoContemPadrao(diff.conteudoAnterior, cond.removeu as string, opts);
    checks.push(matched);
  }

  if (checks.length === 0) return true;
  return checks.every(Boolean);
}

export function avaliarQuando(quando: CondicaoQuando, diff: DiffArquivo): boolean {
  // First, verify path matching against the anchored glob
  const regex = paraRegex(quando.caminho);
  const pathMatches = regex.test(diff.caminho) || (diff.caminhoOrigem && regex.test(diff.caminhoOrigem));
  if (!pathMatches) return false;

  const isOr = quando.operador === 'OR' || quando.operador === 'OU';

  // Evaluate compound 'todas' (conjunction)
  if (Array.isArray(quando.todas) && quando.todas.length > 0) {
    const allMatch = quando.todas.every((cond) => avaliarCondicaoItem(cond, diff));
    if (!allMatch) return false;
  }

  // Evaluate compound 'qualquer' (disjunction)
  if (Array.isArray(quando.qualquer) && quando.qualquer.length > 0) {
    const anyMatch = quando.qualquer.some((cond) => avaliarCondicaoItem(cond, diff));
    if (!anyMatch) return false;
  }

  // Evaluate top-level matchers
  const itemChecks: boolean[] = [];

  if (quando.arquivoRemovido !== undefined) {
    itemChecks.push(diff.removido === quando.arquivoRemovido);
  }
  if (quando.arquivoAdicionado !== undefined) {
    itemChecks.push((diff.tipo === 'adicionado') === quando.arquivoAdicionado);
  }
  if (quando.arquivoRenomeado !== undefined) {
    itemChecks.push((diff.tipo === 'renomeado') === quando.arquivoRenomeado);
  }

  const opts = {
    ignorarComentarios: quando.ignorarComentarios ?? false,
    ignorarMensagens: quando.ignorarMensagens ?? false,
  };

  if (typeof quando.adicionou === 'string') {
    const matched =
      diff.adicionadas.some((l) => linhaContemPadrao(l, quando.adicionou as string, opts)) ||
      conteudoContemPadrao(diff.conteudoAtual, quando.adicionou as string, opts);
    itemChecks.push(matched);
  }

  if (typeof quando.removeu === 'string') {
    const matched =
      diff.removidas.some((l) => linhaContemPadrao(l, quando.removeu as string, opts)) ||
      conteudoContemPadrao(diff.conteudoAnterior, quando.removeu as string, opts);
    itemChecks.push(matched);
  }

  if (itemChecks.length === 0) {
    return true;
  }

  return isOr ? itemChecks.some(Boolean) : itemChecks.every(Boolean);
}

export function aplicarRegras(regras: RegraGovernanca[], diffs: DiffArquivo[]): OperacaoSemantica[] {
  const operacoes: OperacaoSemantica[] = [];
  for (const regra of regras) {
    for (const diff of diffs) {
      if (!avaliarQuando(regra.quando, diff)) continue;

      // Distinguish heuristic textual match from proven structural evidence
      const hasStructuralEvidence = (regra.evidenciasRequeridas ?? []).some(
        (e) => e.tipo === 'estrutural' && e.obrigatoria
      );

      const fatosMapeados = regra.fatos.map((fato) => ({
        ...fato,
        // Textual recognition cannot claim 'observado' certainty on behavior without independent structural extraction
        determinacao: fato.determinacao === 'observado' && !hasStructuralEvidence ? 'inferido' : fato.determinacao,
        origem: fato.origem === 'code' ? 'diff_textual_heuristico' : fato.origem,
      }));

      operacoes.push({
        id: randomUUID(),
        regraId: regra.id,
        dominio: regra.dominio,
        operacao: regra.operacao,
        fatos: fatosMapeados,
        proveniencia: {
          origem: 'diff_textual_heuristico',
          descricao: `Reconhecimento heurístico via regra ${regra.id} em ${diff.caminho}${diff.caminhoOrigem ? ` (origem: ${diff.caminhoOrigem})` : ''}`,
        },
        alteracoesRelacionadas: diff.caminhoOrigem ? [diff.caminhoOrigem, diff.caminho] : [diff.caminho],
        evidenciasRequeridas: regra.evidenciasRequeridas,
        dependenciasDominio: regra.dependenciasDominio,
      });
    }
  }
  return operacoes;
}

export async function lerDiff(
  worktree: string,
  commitBase: string,
  options: { includeUntracked?: boolean } = {}
): Promise<DiffArquivo[]> {
  const includeUntracked = options.includeUntracked ?? true;
  const arquivos: DiffArquivo[] = [];

  // Run git diff with null separators and rename detection (-M)
  // If git fails, this throws, ensuring git errors are NOT converted into empty diffs
  const nameStatusRaw = await git(worktree, ['diff', '--name-status', '-z', '-M', commitBase]);
  const tokens = nameStatusRaw.split('\0');
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i++];
    if (!status) continue;

    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = tokens[i++];
      const newPath = tokens[i++];
      if (!oldPath || !newPath) continue;

      let conteudoAnterior: string | undefined;
      try {
        conteudoAnterior = await git(worktree, ['show', `${commitBase}:${oldPath}`]);
      } catch {
        conteudoAnterior = undefined;
      }

      let conteudoAtual: string | undefined;
      try {
        conteudoAtual = await readFile(join(worktree, newPath), 'utf8');
      } catch {
        try {
          conteudoAtual = await git(worktree, ['show', `HEAD:${newPath}`]);
        } catch {
          conteudoAtual = undefined;
        }
      }

      const adicionadas: string[] = [];
      const removidas: string[] = [];
      try {
        const patch = await git(worktree, ['diff', '-U0', '--no-color', commitBase, '--', oldPath, newPath]);
        for (const line of patch.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            adicionadas.push(line.slice(1));
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            removidas.push(line.slice(1));
          }
        }
      } catch {
        if (conteudoAtual) adicionadas.push(...conteudoAtual.split('\n'));
        if (conteudoAnterior) removidas.push(...conteudoAnterior.split('\n'));
      }

      arquivos.push({
        caminho: newPath,
        caminhoOrigem: oldPath,
        tipo: status.startsWith('R') ? 'renomeado' : 'adicionado',
        adicionadas,
        removidas,
        removido: false,
        conteudoAtual,
        conteudoAnterior,
      });
    } else {
      const filePath = tokens[i++];
      if (!filePath) continue;

      if (status === 'D') {
        let conteudoAnterior: string | undefined;
        try {
          conteudoAnterior = await git(worktree, ['show', `${commitBase}:${filePath}`]);
        } catch {
          conteudoAnterior = undefined;
        }

        const removidas = conteudoAnterior !== undefined && conteudoAnterior.length > 0
          ? conteudoAnterior.split('\n')
          : [];

        arquivos.push({
          caminho: filePath,
          tipo: 'removido',
          adicionadas: [],
          removidas,
          removido: true,
          conteudoAnterior,
          conteudoAtual: undefined,
        });
      } else if (status === 'A') {
        let conteudoAtual: string | undefined;
        try {
          conteudoAtual = await readFile(join(worktree, filePath), 'utf8');
        } catch {
          try {
            conteudoAtual = await git(worktree, ['show', `HEAD:${filePath}`]);
          } catch {
            conteudoAtual = undefined;
          }
        }

        const adicionadas = conteudoAtual !== undefined && conteudoAtual.length > 0
          ? conteudoAtual.split('\n')
          : [];

        arquivos.push({
          caminho: filePath,
          tipo: 'adicionado',
          adicionadas,
          removidas: [],
          removido: false,
          conteudoAtual,
          conteudoAnterior: undefined,
        });
      } else {
        // 'M', 'T', etc.
        let conteudoAnterior: string | undefined;
        try {
          conteudoAnterior = await git(worktree, ['show', `${commitBase}:${filePath}`]);
        } catch {
          conteudoAnterior = undefined;
        }

        let conteudoAtual: string | undefined;
        try {
          conteudoAtual = await readFile(join(worktree, filePath), 'utf8');
        } catch {
          try {
            conteudoAtual = await git(worktree, ['show', `HEAD:${filePath}`]);
          } catch {
            conteudoAtual = undefined;
          }
        }

        const adicionadas: string[] = [];
        const removidas: string[] = [];
        try {
          const patch = await git(worktree, ['diff', '-U0', '--no-color', commitBase, '--', filePath]);
          for (const line of patch.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
              adicionadas.push(line.slice(1));
            } else if (line.startsWith('-') && !line.startsWith('---')) {
              removidas.push(line.slice(1));
            }
          }
        } catch {
          if (conteudoAtual) adicionadas.push(...conteudoAtual.split('\n'));
          if (conteudoAnterior) removidas.push(...conteudoAnterior.split('\n'));
        }

        arquivos.push({
          caminho: filePath,
          tipo: 'modificado',
          adicionadas,
          removidas,
          removido: false,
          conteudoAtual,
          conteudoAnterior,
        });
      }
    }
  }

  // 2. Untracked files in the workspace
  if (includeUntracked) {
    const untrackedRaw = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z']);
    const untrackedTokens = untrackedRaw.split('\0').filter(Boolean);
    for (const untrackedPath of untrackedTokens) {
      if (arquivos.some((a) => a.caminho === untrackedPath)) continue;

      let conteudoAtual: string | undefined;
      try {
        conteudoAtual = await readFile(join(worktree, untrackedPath), 'utf8');
      } catch {
        conteudoAtual = '';
      }

      const adicionadas = conteudoAtual ? conteudoAtual.split('\n') : [];
      arquivos.push({
        caminho: untrackedPath,
        tipo: 'adicionado',
        adicionadas,
        removidas: [],
        removido: false,
        conteudoAtual,
        conteudoAnterior: undefined,
      });
    }
  }

  return arquivos;
}
