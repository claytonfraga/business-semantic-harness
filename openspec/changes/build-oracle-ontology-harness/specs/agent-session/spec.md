## Purpose

Oferece sessões interativas de agente guiadas pelo Oracle, começando com Codex e incluindo o Google Antigravity CLI como segundo adaptador.

## ADDED Requirements

### Requirement: Executável Linux por pacote npm
O Oracle SHALL ser empacotado para Linux como executável `oracle` com shebang e permissão de execução, instalável globalmente por npm e executável por `npx` após publicação. O CLI SHALL usar a pasta atual como projeto por padrão e aceitar `--project` para selecionar outro codebase, sem depender do checkout do Oracle.

#### Scenario: Instalação externa
- **WHEN** o pacote é instalado em prefixo global temporário e `oracle` é chamado de outro codebase
- **THEN** ele lê ou cria `.oracle/` nesse codebase e não busca arquivos no repositório de desenvolvimento do Oracle

#### Scenario: Execução por npx
- **WHEN** o pacote está publicado ou disponível como tarball npm local
- **THEN** `npx --package=<pacote> oracle` executa o mesmo CLI sem instalação global persistente

### Requirement: Comando Codex
O CLI SHALL disponibilizar `oracle code base` e o alias `oracle codex` para iniciar uma sessão governada no projeto selecionado. O Oracle SHALL abrir a interface de terminal interativa nativa do Codex, conectada por `codex --remote` a um servidor `codex app-server` iniciado pelo Oracle no próprio projeto, e SHALL operar como cliente de instrumentação simultâneo no mesmo servidor, sem substituir a interface nativa por um terminal próprio do Oracle e sem impor sandbox adicional ao processo Codex.

#### Scenario: TUI nativa do Codex aberta
- **WHEN** o projeto passa na pré-validação e o Codex suportado está disponível
- **THEN** o Oracle inicia o `codex app-server` no projeto, abre a TUI nativa do Codex apontando para esse servidor e mantém um cliente de instrumentação conectado ao mesmo servidor

#### Scenario: Codex indisponível
- **WHEN** o executável, a versão ou o modo remote exigido do Codex não está disponível
- **THEN** o Oracle falha com diagnóstico acionável antes de iniciar uma sessão parcial

### Requirement: Instrumentação da TUI do Codex
O Oracle SHALL governar a sessão conduzida pela TUI nativa do Codex por meio de um segundo cliente `codex app-server` no mesmo servidor. Esse cliente SHALL injetar as instruções de governança no `CODEX_HOME` privado sem alterar a instalação global do Codex, SHALL verificar a configuração efetiva (somente o MCP Oracle, recursos externos desabilitados e busca web desabilitada) e o inventário de ferramentas Oracle antes de liberar a TUI, SHALL medir os tokens da sessão, SHALL observar sem responder às solicitações nativas de aprovação destinadas à TUI e SHALL registrar a sessão e os alertas de violação de ontologia para auditoria sem impedir a interação do usuário.

#### Scenario: Configuração externa herdada
- **WHEN** a configuração efetiva do servidor traz qualquer MCP externo ao Oracle, recurso externo habilitado ou busca web ativa
- **THEN** o Oracle recusa iniciar a TUI e informa a capacidade incompatível

#### Scenario: Aprovação nativa destinada à TUI
- **WHEN** a TUI recebe uma solicitação nativa de aprovação durante um turno
- **THEN** o cliente de instrumentação não responde em nome da TUI e mantém o fluxo de decisão do usuário na interface nativa

#### Scenario: Instalação global do Codex preservada
- **WHEN** o Oracle inicia uma sessão governada
- **THEN** as instruções de governança, a configuração e as credenciais usadas ficam em cópia privada e a instalação global do Codex permanece inalterada

#### Scenario: Medição de tokens e verificação ontológica
- **WHEN** a sessão termina
- **THEN** o Oracle reporta tokens de entrada, saída e total, quantidade de consultas à ontologia e conflitos, e persiste o resumo e a trilha de auditoria no projeto

#### Scenario: Violação de ontologia registrada
- **WHEN** o agente relata conflito com a ontologia durante a sessão
- **THEN** o Oracle grava um alerta no log de auditoria local e identifica o conflito ao apresentar a decisão humana

### Requirement: Contrato de adaptador
O Oracle SHALL tratar eventos, ações propostas, decisões e cancelamento por meio de um contrato de adaptador independente do agente; adaptadores sem capacidade de interceptar ações mutáveis SHALL ser rejeitados para sessões governadas.

#### Scenario: Adaptador sem interceptação
- **WHEN** um adaptador não consegue apresentar uma ação mutável antes de executá-la
- **THEN** o Oracle não o habilita para `oracle <agente>`

### Requirement: Compatibilidade com Agy
O Oracle SHALL oferecer um adaptador para o executável `agy` do Google Antigravity CLI, que pode usar modelos Gemini, reutilizando o mesmo manifesto, ontologias JSON-LD, shapes SHACL, broker de aprovação, propostas e auditoria do adaptador Codex. O comando SHALL ser `oracle agy`. O adaptador SHALL provar isolamento ou mediação de toda superfície mutável disponível na versão suportada; sem essa prova, SHALL recusar a sessão governada com diagnóstico acionável.

#### Scenario: Projeto válido no Agy
- **WHEN** um projeto validado é aberto com `oracle agy` e a versão suportada do Agy possui mediação comprovada
- **THEN** o agente recebe o contexto dos domínios e suas ações são avaliadas pelo mesmo núcleo Oracle antes de efeitos

#### Scenario: Agy indisponível ou sem cobertura
- **WHEN** o executável `agy` falta, seu protocolo é incompatível ou há ferramenta mutável sem mediação comprovada
- **THEN** o Oracle não inicia uma sessão governada e identifica a capacidade ausente

### Requirement: Sem bypass implícito
O Oracle SHALL preservar as políticas de autenticação, sandbox e aprovação do agente e SHALL rejeitar opções que desabilitem os controles necessários à ontologia.

#### Scenario: Controles desativados
- **WHEN** a sessão solicita desativar hooks ou contornar o sandbox necessário à fiscalização
- **THEN** o Oracle recusa a inicialização e explica o controle incompatível

### Requirement: Isolamento por Git worktree
Toda sessão iniciada por `oracle codex` ou `oracle code base` SHALL trabalhar em uma Git worktree paralela e isolada, criada para aquela sessão a partir de uma branch própria. O Codex SHALL ler, editar, compilar, testar e executar comandos somente nessa worktree; o checkout principal SHALL permanecer intacto durante o trabalho do agente. O Oracle SHALL diferenciar o repositório de origem do workspace da sessão e SHALL usar `git worktree` real, sem cópia comum do diretório. Cada sessão SHALL ter branch e worktree próprias, com estado próprio, permitindo sessões paralelas sem colisão.

#### Scenario: Sessão em worktree
- **GIVEN** um repositório Git na branch `main`
- **WHEN** `oracle codex` inicia uma sessão
- **THEN** uma branch `oracle/session/<id>` e uma worktree exclusiva são criadas a partir do HEAD de `main`

#### Scenario: Checkout principal intacto
- **WHEN** o agente modifica, cria ou remove arquivos
- **THEN** as mudanças ocorrem apenas na worktree e o checkout principal permanece byte a byte inalterado

#### Scenario: Sessões paralelas
- **WHEN** duas sessões são iniciadas sobre o mesmo projeto
- **THEN** cada uma usa branch e worktree próprias e não escreve na worktree da outra

#### Scenario: Estado local preservado
- **GIVEN** que o checkout principal tem alterações não commitadas
- **WHEN** uma sessão é criada
- **THEN** o Oracle não executa stash, reset, restore nem clean sobre elas

### Requirement: Promoção por Git após validação
Ao final da sessão, o Oracle SHALL executar os gates do projeto na worktree e SHALL promover as alterações à branch de origem por operações Git, somente após validação e decisão humana aplicável. A promoção SHALL usar fast-forward quando a branch de origem não avançou e SHALL reconciliar por rebase dentro da worktree quando tiver avançado. Conflitos SHALL permanecer somente na worktree. O Oracle SHALL NOT sobrescrever commits, resetar, limpar ou forçar a branch principal, e SHALL remover a worktree temporária após a promoção.

#### Scenario: Promoção sem concorrência
- **GIVEN** que a branch original não avançou e as validações passaram
- **WHEN** a sessão é promovida
- **THEN** as alterações aparecem na branch original por operação Git

#### Scenario: Branch original avançou
- **GIVEN** que a branch original avançou
- **WHEN** a promoção é iniciada
- **THEN** o Oracle reconcilia a branch da sessão com a base atual dentro da worktree, revalida os gates e promove sem perder os commits da origem

#### Scenario: Conflito
- **WHEN** a reconciliação produz conflito
- **THEN** a branch principal permanece inalterada e o conflito permanece somente na worktree da sessão

#### Scenario: Falha nos gates
- **WHEN** os gates falham
- **THEN** nenhuma alteração é promovida e a branch original permanece intacta

#### Scenario: Rejeição
- **WHEN** o usuário nega a exceção de ontologia
- **THEN** a worktree e a branch da sessão são descartadas sem que o checkout principal precise de rollback

#### Scenario: Limpeza
- **WHEN** a promoção termina com sucesso
- **THEN** a worktree temporária é removida sem perder nenhum commit promovido
