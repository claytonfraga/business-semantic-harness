import { randomUUID } from 'node:crypto';
import { git } from '../agents/codex/worktree.js';
import type { OperacaoSemantica } from './operacaoSemantica.js';
import type { RegraGovernanca } from './governanca.js';

export interface DiffArquivo {
  caminho: string;
  adicionadas: string[];
  removidas: string[];
  removido: boolean;
}

export function paraRegex(glob: string): RegExp {
  const escapado = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const corpo = escapado.split('**').map((parte) => parte.replace(/\*/g, '[^/]*')).join('.*');
  return new RegExp(`^${corpo}`);
}

export function aplicarRegras(regras: RegraGovernanca[], diffs: DiffArquivo[]): OperacaoSemantica[] {
  const operacoes: OperacaoSemantica[] = [];
  for (const regra of regras) {
    const regex = paraRegex(regra.quando.caminho);
    const candidatos = diffs.filter((diff) => regex.test(diff.caminho));
    for (const diff of candidatos) {
      const correspondeArquivoRemovido = regra.quando.arquivoRemovido === true && diff.removido;
      const correspondeRemocao = typeof regra.quando.removeu === 'string'
        && diff.removidas.some((linha) => linha.includes(regra.quando.removeu as string));
      const correspondeAdicao = typeof regra.quando.adicionou === 'string'
        && diff.adicionadas.some((linha) => linha.includes(regra.quando.adicionou as string));
      if (!correspondeArquivoRemovido && !correspondeRemocao && !correspondeAdicao) continue;
      operacoes.push({
        id: randomUUID(),
        dominio: regra.dominio,
        operacao: regra.operacao,
        fatos: regra.fatos.map((fato) => ({ ...fato })),
        proveniencia: { origem: 'diff', descricao: `Regra ${regra.id} aplicada a ${diff.caminho}` },
        alteracoesRelacionadas: [diff.caminho],
      });
    }
  }
  return operacoes;
}

export async function lerDiff(worktree: string, commitBase: string): Promise<DiffArquivo[]> {
  const saida = await git(worktree, ['diff', commitBase, '--unified=0', '--no-color']);
  const arquivos: DiffArquivo[] = [];
  let atual: DiffArquivo | undefined;
  for (const linha of saida.split('\n')) {
    if (linha.startsWith('diff --git ')) {
      atual = undefined;
      continue;
    }
    if (linha.startsWith('+++ ')) {
      const caminho = linha.slice(4).trim().replace(/^b\//, '');
      if (caminho === '/dev/null') continue;
      atual = arquivos.find((item) => item.caminho === caminho) ?? { caminho, adicionadas: [], removidas: [], removido: false };
      if (!arquivos.includes(atual)) arquivos.push(atual);
      continue;
    }
    if (linha.startsWith('deleted file mode')) {
      if (atual) atual.removido = true;
      continue;
    }
    if (!atual) continue;
    if (linha.startsWith('+') && !linha.startsWith('+++')) atual.adicionadas.push(linha.slice(1));
    else if (linha.startsWith('-') && !linha.startsWith('---')) atual.removidas.push(linha.slice(1));
  }
  return arquivos;
}
