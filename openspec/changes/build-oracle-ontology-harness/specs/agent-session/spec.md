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

### Requirement: Desenvolvimento normal no projeto real
O Oracle SHALL permitir que o Codex use suas ferramentas nativas para ler, editar arquivos e executar verificações no próprio projeto, sem sandbox adicional imposto pelo Oracle. Antes da implementação, o Oracle SHALL injetar o contexto de governança e a ontologia para orientar o agente. Ao final da sessão, se a ontologia tiver sido respeitada, as alterações SHALL permanecer no projeto; se houver violação ou incerteza relatada, o Oracle SHALL exigir decisão humana de exceção e, em caso de negativa, SHALL reverter os arquivos alterados na sessão. Ontologia e SHACL do projeto SHALL ser a base da decisão.

#### Scenario: Alteração aderente mantida
- **GIVEN** um projeto com ontologia válida
- **WHEN** o Codex altera código no projeto sem relatar conflito de ontologia
- **THEN** as alterações permanecem no projeto e a decisão é auditada

#### Scenario: Alteração contrária negociada
- **GIVEN** um projeto com ontologia válida
- **WHEN** o Codex relata conflito de ontologia e o usuário nega a exceção
- **THEN** o Oracle grava o alerta e reverte os arquivos alterados na sessão, e a decisão é auditada

#### Scenario: Exceção aprovada
- **GIVEN** um projeto com ontologia válida
- **WHEN** o Codex relata conflito de ontologia e o usuário aprova a exceção
- **THEN** as alterações permanecem no projeto e a aprovação é auditada
