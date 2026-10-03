# language: pt
# Fontes: pilot/asset-management/.bsh/domains/ativos/shapes.ttl; pilot/asset-management/.bsh/domains/ativos/ontology.jsonld; openspec/specs/asset-management-pilot.feature
@bsh @governance @lifecycle @valuation @disposal
Funcionalidade: Governança Semântica — Ciclo de Vida de Baixa, Alçadas de Valor e Laudos Técnicos

  Como um auditor de patrimônio e controladoria
  Eu quero que o harness imponha alçadas formais de aprovação e laudos periciais para baixas
  Para impedir perdas financeiras, descarte indevido e baixas duplicadas fraudulentas

  @BSH-ONT-015 @shacl @high_value
  Cenário: Exigir alçada formal de aprovação para baixa de ativo de alto valor
    Dado um ativo de TI com valor de aquisição de R$ 45.000
    Quando o usuário tenta solicitar a baixa definitiva sem indicar alçada formal de aprovação
    Então a regra SPARQL de "BaixaAltoValorAprovacaoShape" deve ser acionada
    E a mensagem "Baixa de ativo com valor de aquisição superior a R$ 10.000 exige alçada formal de aprovação" deve ser exibida
    E a baixa não deve ser homologada

  @BSH-ONT-016 @shacl @residual_value
  Cenário: Exigir laudo técnico pericial para ativo com valor residual positivo
    Dado um ativo com valor residual contábil de R$ 3.500
    Quando uma baixa é proposta sem fornecimento de laudo técnico de descarte
    Então a regra SPARQL de "BaixaValorResidualShape" deve identificar a ausência do laudo
    E a mensagem "Baixa de ativo com valor residual positivo exige laudo técnico de descarte" deve bloquear a operação
    E nenhum registro contábil de baixa deve ser gerado

  @BSH-ONT-017 @shacl @idempotence
  Cenário: Bloquear categoricamente tentativa de baixa duplicada em ativo já baixado
    Dado um ativo no estado "Baixado" (AST-002)
    Quando uma nova baixa patrimonial é solicitada
    Então a regra de estado de "BaixaShape" deve invalidar a requisição
    E a mensagem "Ativo baixado não pode sofrer nova baixa" deve ser apresentada
    E a tentativa deve ser arquivada como violação de integridade no log de auditoria
