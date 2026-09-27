export type EstadoValidacao = 'conforme' | 'violacao' | 'revisao_humana' | 'indeterminado';

export type DeterminacaoFato = 'observado' | 'inferido' | 'indeterminado';

export interface FatoSemantico {
  propriedade: string;
  valor: string | null;
  determinacao: DeterminacaoFato;
  origem: string;
}

export interface ProvenienciaOperacao {
  origem: string;
  descricao: string;
}

export interface OperacaoSemantica {
  id: string;
  dominio: string;
  operacao: string;
  fatos: FatoSemantico[];
  proveniencia: ProvenienciaOperacao;
  alteracoesRelacionadas: string[];
  /** RDF do estado candidato completo, produzido por extrator independente do agente. */
  candidateGraphTurtle?: string;
}

export interface ResultadoEnforcement {
  status: EstadoValidacao;
  dominio: string;
  operacao: string;
  governado: boolean;
  shape?: string;
  regra?: string;
  requerRevisaoHumana: boolean;
  evidencia: string[];
  shapesAvaliados: string[];
  selectedShapes?: string[];
  executedShapes?: string[];
  validationExecuted?: boolean;
  validationComplete?: boolean;
  missingFacts?: string[];
  candidateGraphHash?: string;
  validationResults?: Array<{ shape: string; focusNode: string; message: string; severity: string; mechanism: 'SHACL_CORE' | 'SHACL_SPARQL' | 'UNKNOWN' }>;
  politicas: string[];
  proveniencia: ProvenienciaOperacao;
}

export interface ResultadoEnforcementLote {
  status: EstadoValidacao;
  bloquear: boolean;
  resultados: ResultadoEnforcement[];
}
