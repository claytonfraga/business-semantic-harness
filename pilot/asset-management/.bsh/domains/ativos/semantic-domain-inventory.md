# Inventário Semântico do Domínio de Gestão Patrimonial (ativos)

**Domínio:** `ativos`  
**Base IRI:** `urn:bsh:pilot:ativos:`  
**Versão:** `1.0.0`  
**Arquivo Ontológico:** `.bsh/domains/ativos/ontology.jsonld`  
**Arquivo de Shapes:** `.bsh/domains/ativos/shapes.ttl`  

---

## 1. Classes Existentes

### 1.1. Hierarquia de Ativos
- `ex:Ativo`: Bem físico identificado e administrado pelo projeto.
  - `ex:AtivoTI`: Ativo de tecnologia da informação (notebooks, desktops, servidores).
  - `ex:AtivoVeiculo`: Veículos automotores e utilitários da frota corporativa.
  - `ex:AtivoMobiliario`: Bens mobiliários de escritório e ergonomia (mesas, cadeiras, armários).
  - `ex:AtivoEquipamento`: Máquinas e equipamentos eletromecânicos operacionais.
  - `ex:AtivoInstrumentacao`: Instrumentos técnicos de medição, precisão e calibração.

### 1.2. Pessoas e Funções
- `ex:Pessoa`: Indivíduo cadastrado na organização.
  - `ex:Responsavel`: Custodiante direto ou responsável pelo ativo.
  - `ex:Usuario`: Colaborador que utiliza o bem em sua rotina laboral.
  - `ex:Gestor`: Gestor de área ou departamento patrimonial.
  - `ex:Aprovador`: Agente com autoridade formal para autorização de movimentações.

### 1.3. Estrutura Organizacional e Espacial
- `ex:Organizacao`: Entidade jurídica mantenedora do patrimônio.
- `ex:UnidadeOrganizacional`: Divisão administrativa de primeiro nível.
- `ex:Departamento`: Setor funcional interno (ex: TI, Operações, Contabilidade).
- `ex:CentroDeCusto`: Unidade orçamentária e contábil vinculada.
- `ex:Filial`: Estabelecimento físico regional.
- `ex:Localizacao`: Espaço físico específico (sala, prédio, armazém, cidade).
- `ex:AlcadaAprovacao`: Instância deliberativa superior.
  - `ex:Diretoria`: Diretoria estatutária.
  - `ex:Controladoria`: Controladoria e auditoria interna.

### 1.4. Ciclo de Vida e Manutenção
- `ex:Manutencao`: Ordem ou execução de serviço técnico.
  - `ex:ManutencaoPreventiva`: Revisões programadas e preventivas.
  - `ex:ManutencaoCorretiva`: Reparo de falhas e defeitos operacionais.
- `ex:PlanoManutencao`: Planejamento periódico de intervenções.
- `ex:MovimentacaoAtivo`: Registro de trânsito ou circulação de bens.
- `ex:DocumentoMovimentacao`: Termo ou guia de trânsito formal.
- `ex:RegistroAuditoria`: Rastro de auditoria e conformidade.

### 1.5. Eventos Patrimoniais (Mutações Governadas)
- `ex:EventoPatrimonial`: Ação que altera o estado ou os vínculos de um ativo.
  - `ex:TransferenciaAtivo`: Transferência de custódia entre responsáveis e locais.
  - `ex:BaixaAtivo`: Descarte, sucateamento, venda ou baixa patrimonial.
  - `ex:AlteracaoResponsavel`: Atualização de custodiante individual.
  - `ex:AtualizacaoLocalizacao`: Remanejamento físico de sala/prédio.
  - `ex:AlocacaoUsuario`: Entrega de equipamento a colaborador com termo de uso.
  - `ex:ReservaAtivo`: Reserva preventiva para uso futuro.
  - `ex:InicioManutencao`: Envio do ativo para oficina/bancada.
  - `ex:ConclusaoManutencao`: Retorno do ativo após intervenção com laudo.
  - `ex:EnvioAtivo`: Despacho de ativo para trânsito logístico.
  - `ex:RecebimentoAtivo`: Recebimento no destino e conferência.
  - `ex:RegistroExtravio`: Comunicação formal de furto, perda ou sinistro.
  - `ex:RecuperacaoAtivo`: Reintegração de bem extraviado após vistoria.

---

## 2. Estados de Negócio

### 2.1. Estados Operacionais do Ativo (`AssetStatus`)
- `ex:Disponivel`: Bem pronto para uso, estocado ou sem alocação ativa.
- `ex:EmUso`: Bem sob custódia e em operação produtiva por usuário ou setor.
- `ex:Baixado`: **Estado terminal**. O bem não existe mais contabilmente no acervo ativo. Não aceita novas mutações operacionais.
- `ex:EmManutencao`: Bem em reparo técnico ou preventivo; indisponível para alocação.
- `ex:EmTransito`: Bem em transporte entre localidades ou filiais.
- `ex:Reservado`: Bem retido para atendimento a projeto ou colaborador agendado.
- `ex:Extraviado`: Bem com parada operacional decorrente de perda ou sinistro reportado.

### 2.2. Estados de Manutenção e Calibração
- Manutenção: `ex:EmDia`, `ex:Vencida`, `ex:Isento`.
- Calibração: `ex:CalibracaoEmDia`, `ex:CalibracaoVencida`, `ex:CalibracaoIsenta`.

---

## 3. Propriedades e Relações

### 3.1. Cadastrais e Contábeis do Ativo
- `ex:codigoPatrimonio`: Identificador patrimonial obrigatório (`^PAT-[0-9]{6}$`).
- `ex:descricao`: Descrição detalhada do bem.
- `ex:valorAquisicao`, `ex:valorResidual`, `ex:percentualDepreciacao`, `ex:totalmenteDepreciado`.
- `ex:dataAquisicao`, `ex:fabricante`, `ex:modelo`, `ex:numeroSerie`.
- Especializadas TI: `ex:termoResponsabilidadeAssinado`, `ex:enderecoMac`, `ex:nomeEquipamento`.
- Especializadas Veículos: `ex:placa`, `ex:renavam`, `ex:chassi`, `ex:quilometragem`, `ex:validadeLicenciamento`.
- Especializadas Mobiliário: `ex:materialPredominante`, `ex:ambienteDestino`.
- Especializadas Equipamentos: `ex:statusManutencao`, `ex:dataUltimaManutencao`, `ex:dataProximaManutencao`, `ex:laudoManutencao`.
- Especializadas Instrumentação: `ex:statusCalibracao`, `ex:dataUltimaCalibracao`, `ex:dataProximaCalibracao`, `ex:certificadoCalibracao`.

### 3.2. Vínculos Organizacionais
- `ex:temResponsavel`: Relação do Ativo com `ex:Responsavel`.
- `ex:temLocalizacao`: Relação do Ativo com `ex:Localizacao`.
- `ex:pertenceDepartamento`: Relação do Ativo com `ex:Departamento`.
- `ex:pertenceCentroDeCusto`: Relação do Ativo com `ex:CentroDeCusto`.
- `ex:lotadoEmDepartamento`: Relação de `ex:Responsavel` com `ex:Departamento`.
- `ex:vinculadoAUnidade`: Relação com `ex:UnidadeOrganizacional`.

### 3.3. Propriedades de Eventos e Transições
- `ex:estadoAtual`, `ex:estadoDestino`, `ex:dataOperacao`, `ex:justificativa`.
- `ex:motivoBaixa`, `ex:novoResponsavel`, `ex:novaLocalizacao`.
- `ex:origem`, `ex:destino`, `ex:departamentoOrigem`, `ex:departamentoDestino`.
- `ex:solicitante`, `ex:aprovador`.
- `ex:solicitanteReserva`, `ex:dataInicioReserva`, `ex:dataFimReserva`, `ex:motivoReserva`.
- `ex:transportador`, `ex:numeroDocumentoMovimentacao`, `ex:movimentacaoReferenciada`.
- `ex:protocoloSinistro`, `ex:laudoRecuperacao`, `ex:laudoTecnicoDescarte`.
- `ex:registradoPor`, `ex:dataHoraRegistro`, `ex:correlationId`.

---

## 4. Regras SHACL Core e SHACL-SPARQL

### 4.1. Shapes SHACL Core
1. `ex:TransferenciaShape`: Exige `estadoAtual` em (`Disponivel`, `EmUso`), `novoResponsavel`, `novaLocalizacao`, e `solicitante` disjunto de `aprovador` (segregação de funções).
2. `ex:BaixaShape`: Exige `estadoAtual` em (`Disponivel`, `EmUso`) e `motivoBaixa`.
3. `ex:ResponsavelShape`: Bloqueia alteração de responsável se `Baixado`.
4. `ex:LocalizacaoShape`: Bloqueia atualização de localização se `Baixado`.
5. `ex:IdentificacaoPatrimonialShape`: Exige `codigoPatrimonio` no formato `^PAT-[0-9]{6}$`.
6. `ex:AtivoTIShape`: Exige `numeroSerie`.
7. `ex:AtivoVeiculoShape`: Exige `placa`, `renavam` e `chassi` conforme expressões regulares oficiais.
8. `ex:AlocacaoUsuarioShape`: Exige `Disponivel` ou `Reservado` e `termoResponsabilidadeAssinado = true`.
9. `ex:ReservaAtivoShape`: Apenas `Disponivel` pode ser reservado; exige datas e motivo.
10. `ex:InicioManutencaoShape`: Apenas `Disponivel` ou `EmUso`.
11. `ex:ConclusaoManutencaoShape`: Apenas ativo em `EmManutencao`; exige `laudoManutencao`.
12. `ex:EnvioAtivoShape`: Origem distinta de destino; exige transportador.
13. `ex:RecebimentoAtivoShape`: Apenas ativo em `EmTransito`.
14. `ex:RegistroExtravioShape`: Exige protocolo `^SIN-[0-9]{4}/[0-9]{6}$`.
15. `ex:RecuperacaoAtivoShape`: Apenas ativo `Extraviado`; exige `laudoRecuperacao`.
16. `ex:ConformidadeManutencaoShape`: Bloqueia operação de ativo com manutenção vencida.
17. `ex:ConformidadeCalibracaoShape`: Bloqueia operação de instrumento com calibração vencida.
18. `ex:AuditoriaShape`: Exige identificação de quem registrou e data/hora.

### 4.2. Shapes SHACL-SPARQL
1. `ex:TransferenciaCompatibilidadeOrganizacionalShape`: Garante que o novo responsável esteja lotado no departamento de destino da transferência.
2. `ex:BaixaValorResidualShape`: Se `valorResidual > 0`, exige presença de `laudoTecnicoDescarte`.

---

## 5. Políticas BSH de Revisão Humana
- `ex:justificativa-adequada`: Transferências exigem julgamento humano de adequação da justificativa.
- `ex:motivo-baixa-adequado`: Baixas exigem avaliação contextual do motivo.
- `ex:baixa-alto-valor`: Bens com valor de aquisição > R$ 10.000 exigem alçada de Diretoria/Controladoria.
- `ex:baixa-valor-residual`: Bens com valor residual positivo exigem laudo técnico e parecer contábil.
- `ex:recuperacao-extraviado`: Reintegração de bem extraviado exige validação física humana.
- `ex:transferencia-inter-unidades`: Transferências inter-departamentais exigem concordância gerencial.
- `ex:aprovacao-diretoria-controladoria`: Baixas e alienações estratégicas requerem alçada executiva.
