# language: pt
# Fontes: src/decision; src/ontology/query.ts; test/decision/decision-contract.test.mjs
@bsh @dec
Funcionalidade: Avaliação de ações, autorização humana e auditoria

  Como um operador de governança
  Eu quero autorizar ações com identidade e evidência
  Para limitar aprovações ao conteúdo efetivamente revisado

  @BSH-DEC-001
  Cenário: Negar ações sem identidade ou interceptação
    Dado uma ação sem identificador, ferramenta, domínio ou interceptação confiável
    Quando a avaliação é solicitada
    Então o resultado deve ser "deny-on-failure"
    E nenhuma autorização executável deve ser emitida

  @BSH-DEC-002
  Cenário: Negar avaliação sobre base inválida
    Dado uma base ontológica alterada, indisponível ou não pronta
    Quando uma ação é avaliada
    Então deve ser negada com o diagnóstico da base
    E uma declaração de leitura não deve dispensar a verificação da base

  @BSH-DEC-003
  Cenário: Permitir leitura identificada
    Dado uma ação interceptada, identificada e somente de leitura sobre uma base válida
    Quando a ação é avaliada
    Então o resultado deve ser "allow"
    E deve indicar que a ação foi declarada como leitura

  @BSH-DEC-004
  Cenário: Permitir mutação completamente representada
    Dado uma ação mutável com RDF completo, tipos conhecidos e regras aplicáveis
    E que os fatos satisfazem SHACL sem política humana aplicável
    Quando a ação é avaliada
    Então o resultado deve ser "allow"
    E deve conter os digests da ação e da base e as regras avaliadas

  @BSH-DEC-005
  Cenário: Exigir revisão quando a evidência é insuficiente
    Dado uma ação mutável de domínio desconhecido ou sem RDF completo e confiável
    Quando a ação é avaliada
    Então o resultado deve ser "needs-human"
    E confiança parcial, opaca, fatos ilegíveis ou ausência de regra aplicável não devem ser tratados como conformidade comprovada

  @BSH-DEC-006
  Cenário: Exigir revisão de violação ou política textual
    Dado fatos que violam SHACL ou uma política aplicável com revisão humana obrigatória
    Quando a avaliação é executada
    Então deve retornar "needs-human" com as regras e motivos
    E uma política humana deve exigir revisão mesmo quando SHACL estiver conforme

  @BSH-DEC-007
  Cenário: Vincular aprovação à ação revisada
    Dado uma avaliação associada à ação e ao retrato ontológico
    Quando o broker solicita revisão
    Então deve apresentar uma cópia da ação e da avaliação com opções "allow-once" e "deny"
    E aprovação deve exigir ator e justificativa não vazios
    E o token emitido deve estar vinculado ao digest da ação

  @BSH-DEC-008
  Cenário: Negar falta de resposta e divergência
    Dado uma revisão humana em andamento
    Quando há recusa, tempo limite, exceção, argumentos alterados ou retrato alterado
    Então nenhuma autorização executável deve ser emitida
    E o motivo da negativa deve ser auditado

  @BSH-DEC-009
  Cenário: Consumir autorização uma única vez
    Dado um token emitido para uma ação e um retrato específicos
    Quando o token é consumido
    Então deve funcionar somente para a ação e retrato correspondentes
    E a tentativa deve remover o token do registro
    E reutilização de token ou identificador de ação deve ser rejeitada

  @BSH-DEC-010
  Cenário: Persistir auditoria antes da autorização
    Dado uma decisão de permitir ou negar
    Quando o broker finaliza a decisão
    Então deve sincronizar um evento em ".bsh/local/events.jsonl"
    E deve registrar tempo, ação, domínio, digests, regras, avaliação, confiança, decisão, ator e motivo
    E falha de persistência deve negar a ação sem emitir token

  @BSH-DEC-011
  Cenário: Proteger auditoria local
    Dado uma escrita de auditoria
    Quando o arquivo é aberto
    Então o diretório deve usar permissão 0700 e o arquivo 0600
    E links simbólicos para o arquivo de auditoria devem ser rejeitados
    E segredos conhecidos devem ser substituídos por "[REDACTED]"
    E a leitura deve permitir filtrar eventos por identificador da ação
