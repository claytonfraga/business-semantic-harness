# language: pt
# Fontes: pilot/asset-management/.bsh/domains/ativos/shapes.ttl; pilot/asset-management/.bsh/domains/ativos/ontology.jsonld; openspec/specs/semantic-enforcement-and-promotion-gate.feature
@bsh @governance @segregation @shacl
Funcionalidade: Governança Semântica — Segregação de Funções e Compatibilidade Organizacional

  Como um arquiteto de governança patrimonial
  Eu quero impor a segregação de funções e a compatibilidade de lotação entre setores
  Para impedir fraudes patrimoniais, auto-aprovações e desvios de custódia

  @BSH-ONT-013 @shacl @segregation
  Cenário: Bloquear tentativa de auto-aprovação de transferência patrimonial
    Dado um ativo disponível com custódia ativa no domínio
    Quando o usuário solicita uma transferência onde o solicitante é idêntico ao aprovador
    Então o motor SHACL deve disparar a regra de disjunção de "TransferenciaShape"
    E a mensagem "O solicitante da transferência não pode ser o aprovador da movimentação" deve ser apresentada
    E a proposta de alteração deve ser rejeitada pelo Semantic Gate sem modificar o repositório

  @BSH-ONT-014 @shacl @organizational_compatibility
  Cenário: Rejeitar transferência para responsável sem lotação no departamento de destino
    Dado um ativo em uso no departamento de Engenharia
    Quando uma transferência é solicitada para o departamento "Manutenção" indicando responsável lotado em "Financeiro"
    Então a consulta SPARQL de "TransferenciaCompatibilidadeOrganizacionalShape" deve falhar
    E a mensagem "O novo responsável deve pertencer ativamente ao departamento de destino" deve ser emitida
    E o branch principal deve permanecer intacto
