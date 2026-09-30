@bsh @pilot @governance @ontology @shacl @e2e
Feature: Governança Semântica e Execução Autônoma no BSH

  Como um engenheiro de software e gestor de regras de negócio
  Eu quero que o BSH governe as ações do modelo de linguagem através de ontologias e regras SHACL
  Para garantir que alterações de código respeitem os invariantes de domínio antes da promoção para o branch principal

  # Regra de aplicação de regras de negócio com o Harness Ativo
  Rule: Com o harness ativo, o gate semântico intercepta alterações e bloqueia violações de SHACL

    Background:
      Given que o projeto piloto "asset-management" possui o domínio "ativos" configurado
      And o arquivo de ontologia "ontology.jsonld" e as regras "shapes.ttl" estão válidos
      And o BSH é iniciado com governança ativa no domínio "ativos" através do OpenRouter

    Scenario: Alteração conforme aprovada pelo gate semântico
      Given uma solicitação para transferir um ativo em estado "EmOperacao" com novo responsável e nova localização
      When o modelo gera as alterações de código no worktree isolado
      Then o gate semântico avalia os fatos RDF contra as regras SHACL do domínio
      And o status retornado é "CONFORMING" com 0 violações
      And a promoção para o branch principal é liberada para confirmação do desenvolvedor

    Scenario: Bloqueio de alteração violadora (Transferência de ativo Baixado)
      Given uma solicitação para permitir transferência de ativo que já esteja no estado "Baixado"
      When o modelo tenta remover a validação ou registrar a transferência de ativo baixado
      Then o gate semântico detecta a violação da regra "TransferShape"
      And o BSH bloqueia a promoção com status "VIOLATION"
      And exibe a mensagem de violação em inglês: "A retired asset cannot be transferred."

    Scenario: Bloqueio de alteração violadora (Baixa sem motivo obrigatório)
      Given uma solicitação para baixar um ativo sem informar o "motivoBaixa"
      When o modelo tenta registrar a baixa do ativo sem o campo obrigatório
      Then o gate semântico detecta a violação da restrição de cardinalidade "minCount 1"
      And o status é marcado como "VIOLATION" impedindo a mesclagem no branch principal

  # Regra de operação no modo Desativado (Ungoverned)
  Rule: Com o harness desativado, o modelo opera como cliente direto sem restrições semânticas

    Background:
      Given que o BSH é iniciado no modo "UNGOVERNED" (sem domínio selecionado)

    Scenario: Aplicação direta de código sem interceptação de regras de negócio
      Given uma solicitação que altera regras de negócio no projeto piloto
      When o modelo realiza alterações no código que contrariam as regras do domínio
      Then o gate semântico permanece inativo
      And nenhuma validação SHACL é disparada
      And o diff é apresentado diretamente ao usuário sem verificação ontológica

  # Regra de autenticação web efêmera (OAuth/PKCE) sem persistência
  Rule: O usuário pode se autenticar via navegador web sem fornecer chave manual nem persistir credenciais em disco

    Scenario: Autenticação bem-sucedida via Web OAuth PKCE em memória
      Given que o BSH é iniciado sem chave de API em variáveis de ambiente ou arquivo
      When o usuário escolhe a opção de autenticação via navegador web
      Then o sistema gera os parâmetros PKCE (code_verifier e code_challenge)
      And inicializa um servidor local efêmero de callback
      And exibe o link de autorização do OpenRouter para o usuário
      When o navegador completa a autorização e redireciona com o código
      Then o BSH troca o código pela chave temporária de API via POST no endpoint "/auth/keys"
      And a chave de API é mantida estritamente em memória
      And nenhum arquivo ".env" ou dado persistente é gravado em disco
      And a sessão é inicializada com sucesso no modelo selecionado

    Scenario: Falha ou cancelamento na autenticação web
      Given que o servidor local de callback está aguardando autorização
      When a requisição de callback é recebida com erro ou timeout
      Then o BSH encerra o servidor local efêmero
      And notifica o usuário sobre a falha na autenticação
      And garante que nenhum dado sensível foi gravado
