# language: pt
# Fontes: pilot/asset-management/src; pilot/asset-management/.bsh/project.json; pilot/asset-management/.bsh/domains/ativos/ontology.jsonld; pilot/asset-management/.bsh/domains/ativos/shapes.ttl; pilot/asset-management/test/server.test.mjs; test/pilot/ontology.test.mjs
@bsh @asset
Funcionalidade: Regras de negócio do piloto de gestão de ativos

  Como um responsável por ativos patrimoniais
  Eu quero executar operações e validar invariantes do domínio local
  Para manter estados e dados patrimoniais consistentes

  @BSH-ASSET-001
  Cenário: Manter vocabulário e estados do piloto
    Dado o domínio local "ativos"
    Quando os estados de um ativo são representados
    Então devem reconhecer "Disponivel", "EmUso", "Baixado", "EmManutencao", "EmTransito", "Reservado" e "Extraviado"
    E esses identificadores devem permanecer vinculados à ontologia do próprio piloto

  @BSH-ASSET-002
  Cenário: Listar e localizar ativos pela API
    Dado o servidor HTTP do piloto
    Quando o usuário consulta "GET /assets"
    Então deve receber os ativos armazenados
    E a página inicial deve explicar as rotas disponíveis
    E rota ou ativo desconhecido deve receber HTTP 404

  @BSH-ASSET-003
  Cenário: Persistir resultado das operações
    Dado um ativo existente e ação cadastrada
    Quando uma operação é executada pelos casos de uso
    Então deve aplicar a regra de domínio antes de salvar
    E deve retornar o ativo persistido com justificativa quando a operação fornecer uma
    E a lista de ações deve corresponder às operações registradas

  @BSH-ASSET-004
  Cenário: Validar entrada HTTP
    Dado uma requisição POST para uma ação de ativo
    Quando o corpo não é objeto JSON, é inválido ou excede o limite permitido
    Então a requisição deve falhar sem aplicar a operação
    E erro comum de entrada deve retornar HTTP 400
    E alteração de ativo baixado deve retornar HTTP 409

  @BSH-ASSET-005
  Cenário: Impedir mutação de ativo baixado
    Dado um ativo em estado "Baixado"
    Quando qualquer operação mutável do piloto é solicitada
    Então a regra de domínio deve rejeitar a operação
    E responsável, localização e demais dados devem permanecer intactos

  @BSH-ASSET-006
  Cenário: Transferir ativo com campos obrigatórios
    Dado um ativo não baixado
    Quando a API executa "transfer"
    Então deve exigir responsável, localização e justificativa não vazios
    E deve atualizar responsável e localização e definir estado "EmUso"

  @BSH-ASSET-007
  Cenário: Validar transferência ontológica
    Dado fatos de "TransferenciaAtivo"
    Quando "TransferenciaShape" valida a operação
    Então "estadoAtual" deve existir e ser "Disponivel" ou "EmUso"
    E "novoResponsavel" e "novaLocalizacao" devem existir
    E solicitante e aprovador não devem compartilhar o mesmo valor

  @BSH-ASSET-008
  Cenário: Validar compatibilidade organizacional
    Dado transferência com novo responsável e departamento de destino
    Quando a shape SPARQL de compatibilidade é executada
    Então o responsável deve possuir relação "lotadoEmDepartamento" com o destino
    E ausência dessa relação deve produzir violação

  @BSH-ASSET-009
  Cenário: Dar baixa com motivo
    Dado um ativo elegível para baixa
    Quando a operação "retire" ou os fatos de "BaixaAtivo" são avaliados
    Então o motivo deve ser obrigatório
    E a API deve definir estado "Baixado" e preservar o motivo
    E a ontologia deve aceitar somente estado anterior "Disponivel" ou "EmUso"

  @BSH-ASSET-010
  Cenário: Exigir laudo para baixa com valor residual
    Dado fatos de baixa com valor residual positivo
    Quando "BaixaValorResidualShape" é executada
    Então deve existir laudo técnico de descarte não vazio

  @BSH-ASSET-011
  Cenário: Exigir alçada para baixa de alto valor
    Dado fatos de baixa com valor de aquisição superior a 10000
    Quando "BaixaAltoValorAprovacaoShape" é executada
    Então deve existir aprovador formal
    E o limite de 10000 deve ser aplicado à condição da shape

  @BSH-ASSET-012
  Cenário: Alterar responsável
    Dado um ativo elegível
    Quando a operação "responsible" ou "AlteracaoResponsavel" é solicitada
    Então o novo responsável deve ser obrigatório
    E a shape deve exigir estado "Disponivel" ou "EmUso"
    E ativo baixado deve ser rejeitado

  @BSH-ASSET-013
  Cenário: Atualizar localização
    Dado um ativo elegível
    Quando a operação "location" ou "AtualizacaoLocalizacao" é solicitada
    Então a nova localização deve ser obrigatória
    E a shape deve exigir estado "Disponivel" ou "EmUso"
    E ativo baixado deve ser rejeitado

  @BSH-ASSET-014
  Cenário: Validar identificação patrimonial
    Dado fatos de um "Ativo"
    Quando "IdentificacaoPatrimonialShape" é executada
    Então deve possuir exatamente um "codigoPatrimonio" do tipo string
    E o código deve corresponder a "^PAT-[0-9]{6}$"

  @BSH-ASSET-015
  Cenário: Validar série de ativo de TI
    Dado fatos de "AtivoTI"
    Quando "AtivoTIShape" é executada
    Então deve existir "numeroSerie" do tipo string

  @BSH-ASSET-016
  Cenário: Validar identificação de veículo
    Dado fatos de "AtivoVeiculo"
    Quando "AtivoVeiculoShape" é executada
    Então a placa deve corresponder a "^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$"
    E o RENAVAM deve ter de 9 a 11 dígitos
    E o chassi deve possuir 17 caracteres válidos conforme "^[A-HJ-NPR-Z0-9]{17}$"

  @BSH-ASSET-017
  Cenário: Alocar ativo ao usuário
    Dado fatos de "AlocacaoUsuario"
    Quando suas shapes são executadas
    Então o estado deve ser "Disponivel" ou "Reservado"
    E deve existir novo responsável e termo de responsabilidade assinado com valor booleano verdadeiro
    E o responsável deve possuir lotação departamental cadastrada

  @BSH-ASSET-018
  Cenário: Preservar comportamento da alocação na API
    Dado uma operação "allocate" na API atual
    Quando o ativo está em manutenção, extraviado ou baixado
    Então a operação deve ser rejeitada
    E para os demais estados atualmente aceitos deve exigir responsável e definir "EmUso"
    E diferenças para a shape de alocação devem permanecer documentadas

  @BSH-ASSET-019
  Cenário: Reservar ativo disponível
    Dado uma operação de reserva
    Quando o ativo não está "Disponivel"
    Então a reserva deve ser rejeitada
    E a API atual deve exigir responsável e definir estado "Reservado"

  @BSH-ASSET-020
  Cenário: Validar dados e datas da reserva
    Dado fatos de "ReservaAtivo"
    Quando as shapes de reserva são executadas
    Então devem existir solicitante, motivo e datas de início e fim do tipo "xsd:date"
    E a data final não deve ser anterior à inicial

  @BSH-ASSET-021
  Cenário: Iniciar manutenção
    Dado fatos de "InicioManutencao"
    Quando a shape de início de manutenção é executada
    Então o estado deve ser "Disponivel" ou "EmUso"
    E o motivo de manutenção deve existir
    E a operação "maintenance" da API deve ser distinguida da validação de fatos

  @BSH-ASSET-022
  Cenário: Concluir manutenção
    Dado fatos de "ConclusaoManutencao"
    Quando a shape é executada
    Então o estado anterior deve ser "EmManutencao"
    E o laudo técnico de manutenção deve existir

  @BSH-ASSET-023
  Cenário: Enviar ativo entre localidades
    Dado fatos de "EnvioAtivo"
    Quando a shape é executada
    Então o estado deve ser "Disponivel" ou "EmUso"
    E origem, destino e transportador devem existir
    E origem e destino devem ser distintos

  @BSH-ASSET-024
  Cenário: Receber ativo em trânsito
    Dado fatos de "RecebimentoAtivo"
    Quando a shape é executada
    Então o estado deve ser "EmTransito"
    E deve existir referência à movimentação anterior

  @BSH-ASSET-025
  Cenário: Registrar extravio
    Dado fatos de "RegistroExtravio"
    Quando a shape é executada
    Então deve rejeitar ativos já baixados ou extraviados
    E deve exigir protocolo no formato "^SIN-[0-9]{4}/[0-9]{6}$"
    E a API "reportLoss" deve exigir protocolo e definir "Extraviado"

  @BSH-ASSET-026
  Cenário: Recuperar ativo extraviado
    Dado uma solicitação de recuperação
    Quando a operação ou shape é executada
    Então somente estado "Extraviado" deve ser aceito
    E a API deve definir "Disponivel"
    E os fatos ontológicos devem incluir laudo de recuperação

  @BSH-ASSET-027
  Cenário: Exigir conformidade de manutenção periódica
    Dado fatos de "AtivoEquipamento"
    Quando "ConformidadeManutencaoShape" é executada
    Então "statusManutencao" deve existir e ser "EmDia" ou "Isento"

  @BSH-ASSET-028
  Cenário: Exigir conformidade de calibração
    Dado fatos de "AtivoInstrumentacao"
    Quando "ConformidadeCalibracaoShape" é executada
    Então deve existir estado de calibração "CalibracaoEmDia" ou "CalibracaoIsenta"
    E deve existir certificado de calibração

  @BSH-ASSET-029
  Cenário: Auditar eventos patrimoniais
    Dado fatos de "EventoPatrimonial"
    Quando "AuditoriaShape" é executada
    Então deve existir identificação de quem registrou a operação
    E a data e hora devem estar presentes como "xsd:dateTime"

  @BSH-ASSET-030
  Cenário: Distinguir domínio formal de implementação HTTP
    Dado regras SHACL para operações ou propriedades não implementadas na API
    Quando a cobertura do piloto é relatada
    Então deve distinguir validação RDF de suporte HTTP ou enforcement automático no código
    E a existência da shape não deve comprovar que o endpoint ou extrator de fatos foi implementado

  @BSH-ASSET-031
  Cenário: Aplicar políticas humanas do piloto
    Dado as políticas textuais declaradas na ontologia local do piloto
    Quando a operação governada é avaliada
    Então as seguintes políticas devem exigir revisão humana contextual mesmo se SHACL passar:
      | Política | Operação | Julgamento exigido |
      | justificativa-adequada | TransferenciaAtivo | Adequação contextual da justificativa |
      | motivo-baixa-adequado | BaixaAtivo | Adequação contextual do motivo |
      | baixa-alto-valor | BaixaAtivo | Alçada de Diretoria ou Controladoria para alto valor |
      | baixa-valor-residual | BaixaAtivo | Parecer contábil e laudo técnico para valor residual positivo |
      | recuperacao-extraviado | RecuperacaoAtivo | Integridade física, laudo, custódia e encerramento de sinistro |
      | transferencia-inter-unidades | TransferenciaAtivo | Concordância gerencial e realocação orçamentária |
      | aprovacao-diretoria-controladoria | BaixaAtivo | Alçada corporativa para decisão patrimonial estratégica |

  @BSH-ASSET-032
  Cenário: Preservar classificação dos conceitos patrimoniais
    Dado a ontologia local de ativos
    Quando seu vocabulário é consultado
    Então deve preservar as seguintes classes e especializações declaradas:
      | Classe | Superclasse declarada |
      | ex:Ativo | - |
      | ex:AtivoTI | ex:Ativo |
      | ex:AtivoVeiculo | ex:Ativo |
      | ex:AtivoMobiliario | ex:Ativo |
      | ex:AtivoEquipamento | ex:Ativo |
      | ex:AtivoInstrumentacao | ex:Ativo |
      | ex:Pessoa | - |
      | ex:Responsavel | ex:Pessoa |
      | ex:Usuario | ex:Pessoa |
      | ex:Gestor | ex:Pessoa |
      | ex:Aprovador | ex:Pessoa |
      | ex:Organizacao | - |
      | ex:UnidadeOrganizacional | - |
      | ex:Departamento | - |
      | ex:CentroDeCusto | - |
      | ex:Filial | - |
      | ex:Localizacao | - |
      | ex:AlcadaAprovacao | - |
      | ex:Diretoria | ex:AlcadaAprovacao |
      | ex:Controladoria | ex:AlcadaAprovacao |
      | ex:Manutencao | - |
      | ex:ManutencaoPreventiva | ex:Manutencao |
      | ex:ManutencaoCorretiva | ex:Manutencao |
      | ex:PlanoManutencao | - |
      | ex:MovimentacaoAtivo | - |
      | ex:DocumentoMovimentacao | - |
      | ex:RegistroAuditoria | - |
      | ex:EventoPatrimonial | - |
      | ex:TransferenciaAtivo | ex:EventoPatrimonial |
      | ex:BaixaAtivo | ex:EventoPatrimonial |
      | ex:AlteracaoResponsavel | ex:EventoPatrimonial |
      | ex:AtualizacaoLocalizacao | ex:EventoPatrimonial |
      | ex:AlocacaoUsuario | ex:EventoPatrimonial |
      | ex:ReservaAtivo | ex:EventoPatrimonial |
      | ex:InicioManutencao | ex:EventoPatrimonial |
      | ex:ConclusaoManutencao | ex:EventoPatrimonial |
      | ex:EnvioAtivo | ex:EventoPatrimonial |
      | ex:RecebimentoAtivo | ex:EventoPatrimonial |
      | ex:RegistroExtravio | ex:EventoPatrimonial |
      | ex:RecuperacaoAtivo | ex:EventoPatrimonial |

  @BSH-ASSET-033
  Cenário: Preservar contratos declarados de propriedades
    Dado as propriedades RDF da ontologia local de ativos
    Quando suas declarações são consultadas
    Então deve preservar domínio e tipo de valor explicitamente declarados na tabela
    E o marcador "-" deve indicar ausência de declaração e não uma restrição adicional:
      | Propriedade | Domínio declarado | Tipo de valor declarado |
      | ex:codigoPatrimonio | ex:Ativo | xsd:string |
      | ex:descricao | ex:Ativo | xsd:string |
      | ex:valorAquisicao | ex:Ativo | xsd:decimal |
      | ex:dataAquisicao | ex:Ativo | xsd:date |
      | ex:valorResidual | ex:Ativo | xsd:decimal |
      | ex:percentualDepreciacao | ex:Ativo | xsd:decimal |
      | ex:totalmenteDepreciado | ex:Ativo | xsd:boolean |
      | ex:fabricante | ex:Ativo | xsd:string |
      | ex:modelo | ex:Ativo | xsd:string |
      | ex:numeroSerie | ex:Ativo | xsd:string |
      | ex:termoResponsabilidadeAssinado | ex:AtivoTI | xsd:boolean |
      | ex:enderecoMac | ex:AtivoTI | xsd:string |
      | ex:nomeEquipamento | ex:AtivoTI | xsd:string |
      | ex:placa | ex:AtivoVeiculo | xsd:string |
      | ex:renavam | ex:AtivoVeiculo | xsd:string |
      | ex:chassi | ex:AtivoVeiculo | xsd:string |
      | ex:quilometragem | ex:AtivoVeiculo | xsd:integer |
      | ex:validadeLicenciamento | ex:AtivoVeiculo | xsd:date |
      | ex:materialPredominante | ex:AtivoMobiliario | xsd:string |
      | ex:ambienteDestino | ex:AtivoMobiliario | xsd:string |
      | ex:statusManutencao | - | - |
      | ex:dataUltimaManutencao | - | xsd:date |
      | ex:dataProximaManutencao | - | xsd:date |
      | ex:periodicidadeManutencao | - | xsd:string |
      | ex:prestadorManutencao | - | xsd:string |
      | ex:laudoManutencao | - | xsd:string |
      | ex:statusCalibracao | - | - |
      | ex:dataUltimaCalibracao | - | xsd:date |
      | ex:dataProximaCalibracao | - | xsd:date |
      | ex:certificadoCalibracao | - | xsd:string |
      | ex:temResponsavel | ex:Ativo | ex:Responsavel |
      | ex:pertenceCentroDeCusto | ex:Ativo | ex:CentroDeCusto |
      | ex:pertenceDepartamento | ex:Ativo | ex:Departamento |
      | ex:temLocalizacao | ex:Ativo | ex:Localizacao |
      | ex:lotadoEmDepartamento | ex:Responsavel | ex:Departamento |
      | ex:vinculadoAUnidade | - | ex:UnidadeOrganizacional |
      | ex:estadoAtual | - | - |
      | ex:estadoDestino | - | - |
      | ex:dataOperacao | - | xsd:date |
      | ex:justificativa | - | xsd:string |
      | ex:motivoBaixa | - | - |
      | ex:responsavelAtual | - | ex:Responsavel |
      | ex:novoResponsavel | - | - |
      | ex:localizacaoAtual | - | - |
      | ex:novaLocalizacao | - | - |
      | ex:origem | - | - |
      | ex:destino | - | - |
      | ex:departamentoOrigem | - | ex:Departamento |
      | ex:departamentoDestino | - | ex:Departamento |
      | ex:centroDeCustoOrigem | - | ex:CentroDeCusto |
      | ex:centroDeCustoDestino | - | ex:CentroDeCusto |
      | ex:solicitante | - | ex:Pessoa |
      | ex:aprovador | - | ex:Pessoa |
      | ex:solicitanteReserva | - | ex:Pessoa |
      | ex:dataInicioReserva | - | xsd:date |
      | ex:dataFimReserva | - | xsd:date |
      | ex:motivoReserva | - | xsd:string |
      | ex:motivoManutencao | - | xsd:string |
      | ex:transportador | - | xsd:string |
      | ex:numeroDocumentoMovimentacao | - | xsd:string |
      | ex:movimentacaoReferenciada | - | xsd:string |
      | ex:dataSaida | - | xsd:dateTime |
      | ex:dataRecebimento | - | xsd:dateTime |
      | ex:protocoloSinistro | - | xsd:string |
      | ex:boletimOcorrencia | - | xsd:string |
      | ex:dataExtravio | - | xsd:date |
      | ex:localUltimaCustodia | - | - |
      | ex:responsavelUltimaCustodia | - | ex:Responsavel |
      | ex:dataRecuperacao | - | xsd:date |
      | ex:localRecuperacao | - | - |
      | ex:responsavelRecuperacao | - | ex:Responsavel |
      | ex:laudoRecuperacao | - | xsd:string |
      | ex:laudoTecnicoDescarte | - | xsd:string |
      | ex:dataBaixa | - | xsd:date |
      | ex:registradoPor | - | xsd:string |
      | ex:dataHoraRegistro | - | xsd:dateTime |
      | ex:correlationId | - | xsd:string |
      | ex:origemOperacao | - | xsd:string |
