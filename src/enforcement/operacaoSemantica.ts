import type { ConstraintExecution, ValidationResult } from '../ontology/validate.js';

export type EstadoValidacao = 'conforme' | 'violacao' | 'revisao_humana' | 'indeterminado';

export type DeterminacaoFato = 'observado' | 'inferido' | 'indeterminado';

export type TipoEvidencia = 'estrutural' | 'comportamental';

export interface FatoSemantico {
  propriedade: string;
  valor: string | null;
  determinacao: DeterminacaoFato;
  origem: string;
  tipoEvidencia?: TipoEvidencia;
}

export interface ProvenienciaOperacao {
  origem: string;
  descricao: string;
}

export interface OperacaoSemantica {
  id: string;
  regraId?: string;
  dominio: string;
  operacao: string;
  fatos: FatoSemantico[];
  proveniencia: ProvenienciaOperacao;
  alteracoesRelacionadas: string[];
  evidenciasRequeridas?: Array<{ tipo: TipoEvidencia; propriedade?: string; descricao?: string; obrigatoria?: boolean }>;
  dependenciasDominio?: string[];
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
  validationResults?: ValidationResult[];
  executionEvidence?: ConstraintExecution[];
  politicas: string[];
  politicasHumanas?: string[];
  decisaoHumanaVinculada?: boolean;
  proveniencia: ProvenienciaOperacao;
}

export interface ResultadoEnforcementLote {
  status: EstadoValidacao;
  bloquear: boolean;
  resultados: ResultadoEnforcement[];
}
