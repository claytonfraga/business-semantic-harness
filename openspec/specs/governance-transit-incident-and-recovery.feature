# language: pt
# Fontes: pilot/asset-management/.bsh/domains/ativos/shapes.ttl; pilot/asset-management/.bsh/domains/ativos/ontology.jsonld; openspec/specs/asset-management-pilot.feature
@bsh @governance @transit @incident @recovery
Funcionalidade: Governança Semântica — Logística de Trânsito, Registro de Sinistros e Alocação Segura

  Como um gestor de logística patrimonial e conformidade
  Eu quero que o harness impeça logística circular, alocações irregulares e sinistros sem padrão
  Para garantir rastreabilidade física e legal em toda a cadeia de suprimentos

  @BSH-ONT-018 @shacl @transit
  Cenário: Proibir envio logístico com origem e destino idênticos
    Dado um equipamento disponível na sede corporativa
    Quando o usuário solicita uma ordem de envio indicando a sede corporativa como destino
    Então o motor SHACL deve disparar a regra de disjunção de "EnvioAtivoShape"
    E a mensagem "O envio de ativo exige localização de origem distinta da localização de destino" deve ser apresentada
    E a ordem de transporte não deve ser emitida

  @BSH-ONT-019 @shacl @allocation @incident
  Cenário: Bloquear alocação a usuário final de ativo extraviado e sem termo assinado
    Dado um ativo no estado "Extraviado"
    Quando uma tentativa de alocação direta a um novo colaborador é submetida sem termo de responsabilidade
    Então "AlocacaoUsuarioShape" deve barrar a alocação por estado inválido
    E deve exigir termo de responsabilidade assinado
    E a custódia não deve ser alterada

  @BSH-ONT-020 @shacl @incident_format
  Cenário: Exigir padrão regulatório de protocolo de sinistro para registro de extravio
    Dado um equipamento em trânsito com suspeita de perda
    Quando o registro de extravio é solicitado com protocolo fora do formato "SIN-AAAA/NNNNNN"
    Então "RegistroExtravioShape" deve invalidar a propriedade "protocoloSinistro"
    E a mensagem "Registro de extravio exige protocolo de sinistro no formato SIN-AAAA/NNNNNN" deve ser exibida
    E o ativo deve permanecer em seu estado anterior até a regularização
