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
    try {
      resultados.push(await validarOperacao(root, snapshot, operacao));
    } catch (error) {
      resultados.push({ status: 'indeterminado', dominio: operacao.dominio,
        operacao: operacao.operacao, governado: true, requerRevisaoHumana: false,
        evidencia: [error instanceof Error ? error.message : String(error)],
        shapesAvaliados: [], selectedShapes: [], executedShapes: [],
        validationExecuted: false, validationComplete: false, politicas: [],
        proveniencia: operacao.proveniencia });
    }
  }
  let status: ResultadoEnforcementLote['status'] = resultados.length === 0 ||
    resultados.some((resultado) => !PRECEDENCIA.includes(resultado.status)) ? 'indeterminado' : 'conforme';
  for (const candidato of PRECEDENCIA) {
    if (resultados.some((resultado) => resultado.status === candidato)) {
      status = candidato;
      break;
    }
  }
  return { status, bloquear: status !== 'conforme', resultados };
}

export function operacaoBloqueante(resultado: ResultadoEnforcement): boolean {
  return resultado.status !== 'conforme';
}
