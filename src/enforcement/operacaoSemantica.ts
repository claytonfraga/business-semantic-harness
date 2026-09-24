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
  politicas: string[];
  proveniencia: ProvenienciaOperacao;
}

export interface ResultadoEnforcementLote {
  status: EstadoValidacao;
  bloquear: boolean;
  resultados: ResultadoEnforcement[];
}
