@bsh @pilot @governance @ontology @shacl @e2e
Feature: Governança Semântica e Execução Autônoma no BSH

  Como um engenheiro de software e gestor de regras de negócio
  Eu quero que o BSH governe as ações do modelo de linguagem através de ontologias e regras SHACL
  Para garantir que alterações de código respeitem os invariantes de domínio antes da promoção para o branch principal

  # Regra de aplicação de regras de negócio com o Harness Ativo (Governed)
  Rule: Com o harness ativo, o gate semântico intercepta alterações e bloqueia violações de SHACL

    Background:
      Given que o projeto piloto "asset-management" possui o domínio "ativos" configurado
      And o cabeçalho da TUI exibe a ontologia ativa "ativos v1.0.0 (4 classes, 2 shapes)", pasta "pilot/asset-management" e branch "git(master)"
      And o BSH é iniciado com governança ativa no domínio "ativos" através do OpenRouter

    Scenario: Jornada 1 - Bloqueio de alteração violadora com detecção e confirmação de prompt
      Given que a TUI do BSH está aberta no espaço de entrada de prompt
      When o usuário digita no espaço de prompt: "Transfer retired asset AST-002 to Maintenance department without justification"
      And confirma a entrada com Enter
      Then o BSH detecta a violação do prompt contra a forma "TransferShape"
      And exibe o destaque "[!] VIOLATION DETECTED" e o alerta "[!] [PROMPT VIOLATION DETECTED]"
      And solicita ao usuário confirmação via Enter para prosseguir
      When o usuário pressiona Enter para prosseguir
      Then o modelo inspeciona a base de código no worktree isolado
      And o gate semântico detecta a violação da regra "TransferShape"
      And o BSH bloqueia a promoção exibindo o status "[X] VIOLATION"
      And o branch principal permanece 100% íntegro e protegido

    Scenario: Jornada 3 - Alteração conforme cooperativa com aprovação do gate
      Given que a TUI do BSH está aberta no espaço de entrada de prompt
      When o usuário digita no espaço de prompt: "Add an endpoint to transfer assets in 'In Operation' state with new owner and location"
      And confirma a execução com Enter
      Then o modelo gera alterações de código aderentes aos invariantes de domínio
      And o gate semântico avalia os fatos RDF contra as restrições em shapes.ttl
      And o status emitido é "[● CONFORMING]" liberando a promoção de forma segura

  # Regra de operação no modo Desativado (Ungoverned)
  Rule: Com o harness desativado, o modelo opera como cliente direto sem restrições semânticas

    Background:
      Given que o BSH é iniciado no modo "UNGOVERNED" (sem domínio selecionado)
      And o cabeçalho da TUI exibe a ontologia "none (inactive)", pasta do projeto e branch Git

    Scenario: Jornada 2 - Execução direta de código sem interceptação de regras de negócio
      Given que a TUI do BSH está aberta no espaço de entrada de prompt
      When o usuário digita no espaço de prompt: "Transfer retired asset AST-002 to Maintenance department without justification"
      And confirma a execução com Enter
      Then o modelo realiza alterações sem validação de regras de domínio
      And o gate semântico permanece inativo sem disparar restrições SHACL
      And o desenvolvedor visualiza o risco da operação sem o harness ontológico

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

  # Regra de verificação proativa de afinidade semântica e alinhamento de conceitos
  Rule: O BSH verifica se a ontologia ativa tem relação com os conceitos do projeto e alerta o usuário em caso de incompatibilidade

    Scenario: Jornada 4 - Alerta de baixa afinidade semântica em projeto não aderente (Domain Mismatch)
      Given um projeto sem entidades de ativos (ex: serviço utilitário ou calculadora)
      And a ontologia ativa selecionada é "ativos"
      When o usuário inicia a TUI do produto "bsh" no projeto
      Then o mecanismo ontológico analisa a correspondência entre os conceitos da ontologia e o código-fonte
      And o BSH detecta que os conceitos chave de "ativos" não foram encontrados no projeto
      And o cabeçalho da TUI exibe o indicador de alerta "[⚠ DOMAIN MISMATCH]" e o status "(⚠ mismatch)"
      And o feed inicial exibe uma mensagem proativa "⚠ [Semantic Domain Alert]" explicando a baixa afinidade
      And o usuário é alertado para trocar o domínio com "/domain" ([Ctrl+D]) ou desabilitar o harness com "/ungoverned" ([Ctrl+G])

    Scenario: Jornada 5 - Desativação voluntária do mecanismo ontológico após alerta de incompatibilidade
      Given que uma sessão BSH foi aberta com alerta de incompatibilidade "[⚠ DOMAIN MISMATCH]"
      When o usuário digita no espaço de prompt: "/ungoverned"
      And confirma com Enter
      Then o BSH desativa o harness ontológico e suspende a validação SHACL
      And o cabeçalho da TUI transiciona para "[○ UNGOVERNED]"
      And o agente informa que a sessão agora opera sem restrições semânticas de domínio

    Scenario: Jornada 6 - Confirmação de alta afinidade e governança ativa em projeto aderente
      Given o projeto piloto "asset-management" contendo código e entidades de gestão patrimonial
      And a ontologia ativa "ativos"
      When o usuário inicia a TUI do produto "bsh" no projeto
      Then o BSH identifica a presença de conceitos como "Asset", "Transfer", "Status" e "Location"
      And a pontuação de afinidade conceitual é confirmada como alta
      And o cabeçalho da TUI exibe o selo de governança ativa "[● GOVERNED]" sem alertas de incompatibilidade

  # Regra de configurações da TUI e confirmação de prompts violadores
  Rule: O usuário pode configurar na TUI se prompts violadores devem exigir confirmação explícita

    Scenario: Configuração de confirmação de prompts violadores via /settings
      Given que a TUI do BSH está aberta no espaço de entrada de prompt
      When o usuário digita "/settings"
      Then o modal de configurações exibe a opção "Confirmar Prompts Violadores"
      When o usuário escolhe alternar a opção
      Then a preferência é atualizada e salva na configuração do projeto


