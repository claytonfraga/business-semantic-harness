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
O CLI SHALL disponibilizar `oracle code base` e o alias `oracle codex` para iniciar uma sessão interativa no projeto selecionado, exibindo mensagens, pedidos de decisão e resultado final ao usuário.

#### Scenario: Sessão válida
- **WHEN** o projeto passa na pré-validação e o Codex está disponível
- **THEN** o Oracle inicia o Codex com o contexto ontológico e apresenta os eventos da sessão

#### Scenario: Codex indisponível
- **WHEN** o executável ou protocolo exigido do Codex não está disponível
- **THEN** o Oracle falha com diagnóstico acionável antes de iniciar uma sessão parcial

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
