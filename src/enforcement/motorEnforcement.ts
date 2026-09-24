import type { OntologySnapshot } from '../ontology/query.js';
import type { OperacaoSemantica, ResultadoEnforcement, ResultadoEnforcementLote } from './operacaoSemantica.js';
import { validarOperacao } from './validadorSemantico.js';

const PRECEDENCIA = ['violacao', 'indeterminado', 'revisao_humana', 'conforme'] as const;

export async function avaliarOperacoes(
  root: string,
  snapshot: OntologySnapshot,
  operacoes: OperacaoSemantica[],
): Promise<ResultadoEnforcementLote> {
  const resultados: ResultadoEnforcement[] = [];
  for (const operacao of operacoes) {
    resultados.push(await validarOperacao(root, snapshot, operacao));
  }
  let status: ResultadoEnforcementLote['status'] = 'conforme';
  for (const candidato of PRECEDENCIA) {
    if (resultados.some((resultado) => resultado.status === candidato)) {
      status = candidato;
      break;
    }
  }
  return { status, bloquear: status === 'violacao' || status === 'indeterminado', resultados };
}

export function operacaoBloqueante(resultado: ResultadoEnforcement): boolean {
  return resultado.status === 'violacao' || resultado.status === 'indeterminado';
}
