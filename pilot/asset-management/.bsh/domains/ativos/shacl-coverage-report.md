# Relatório de Cobertura de Shapes SHACL do Domínio Patrimonial

| Shape | Regra | Tipo | Operação / Classe | Conformes | Não Conformes | Fronteira | Multirregra | Status |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `ex:TransferenciaShape` | Regra-Transf-RequisitosBasicos | SHACL Core | TransferenciaAtivo | 40 | 30 | 20 | 20 | **TOTAL** |
| `ex:BaixaShape` | Regra-Baixa-RequisitosBasicos | SHACL Core | BaixaAtivo | 40 | 30 | 20 | 20 | **TOTAL** |
| `ex:ResponsavelShape` | Regra-Resp-ImutabilidadeBaixado | SHACL Core | AlteracaoResponsavel | 0 | 10 | 0 | 0 | **ADEQUADA** |
| `ex:LocalizacaoShape` | Regra-Loc-ImutabilidadeBaixado | SHACL Core | AtualizacaoLocalizacao | 0 | 10 | 0 | 0 | **ADEQUADA** |
| `ex:IdentificacaoPatrimonialShape` | Regra-Patrimonio-FormatoCodigo | SHACL Core | Ativo | 250 | 0 | 0 | 0 | **TOTAL** |
| `ex:AtivoTIShape` | Regra-TI-NumeroSerieObrigatorio | SHACL Core | AtivoTI | 90 | 0 | 0 | 0 | **TOTAL** |
| `ex:AtivoVeiculoShape` | Regra-Veiculo-IdentificacaoOficial | SHACL Core | AtivoVeiculo | 35 | 0 | 0 | 0 | **TOTAL** |
| `ex:AlocacaoUsuarioShape` | Regra-Alocacao-TermoResponsabilidade | SHACL Core | AlocacaoUsuario | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:ReservaAtivoShape` | Regra-Reserva-PeriodoMotivo | SHACL Core | ReservaAtivo | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:InicioManutencaoShape` | Regra-Manutencao-Abertura | SHACL Core | InicioManutencao | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:ConclusaoManutencaoShape` | Regra-Manutencao-LaudoConclusao | SHACL Core | ConclusaoManutencao | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:EnvioAtivoShape` | Regra-Transito-EnvioLogistico | SHACL Core | EnvioAtivo | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:RecebimentoAtivoShape` | Regra-Transito-RecebimentoConferencia | SHACL Core | RecebimentoAtivo | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:RegistroExtravioShape` | Regra-Extravio-ProtocoloSinistro | SHACL Core | RegistroExtravio | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:RecuperacaoAtivoShape` | Regra-Extravio-LaudoRecuperacao | SHACL Core | RecuperacaoAtivo | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:ConformidadeManutencaoShape` | Regra-Equipamento-StatusManutencao | SHACL Core | AtivoEquipamento | 45 | 0 | 0 | 0 | **TOTAL** |
| `ex:ConformidadeCalibracaoShape` | Regra-Instrumentacao-CertificadoCalibracao | SHACL Core | AtivoInstrumentacao | 25 | 0 | 0 | 0 | **TOTAL** |
| `ex:AuditoriaShape` | Regra-Auditoria-RastreabilidadeRegistro | SHACL Core | EventoPatrimonial | 200 | 0 | 0 | 0 | **TOTAL** |
| `ex:TransferenciaCompatibilidadeOrganizacionalShape` | Regra-Transf-LotacaoResponsavelDestino | SHACL-SPARQL | TransferenciaAtivo | 40 | 30 | 20 | 20 | **TOTAL** |
| `ex:BaixaValorResidualShape` | Regra-Baixa-LaudoTecnicoValorResidual | SHACL-SPARQL | BaixaAtivo | 40 | 30 | 20 | 20 | **TOTAL** |
| `ex:ReservaConflitoDatasShape` | Regra-Reserva-ConsistenciaDatas | SHACL-SPARQL | ReservaAtivo | 10 | 10 | 0 | 0 | **TOTAL** |
| `ex:BaixaAltoValorAprovacaoShape` | Regra-Baixa-AlcadaExecutivaAltoValor | SHACL-SPARQL | BaixaAtivo | 40 | 30 | 20 | 20 | **TOTAL** |
| `ex:AlocacaoCompatibilidadeDepartamentoShape` | Regra-Alocacao-LotacaoResponsavel | SHACL-SPARQL | AlocacaoUsuario | 10 | 10 | 0 | 0 | **TOTAL** |
