## Purpose

Oferece uma sessão interativa de agente guiada pelo Oracle, começando com Codex e permitindo outros adaptadores no futuro.

## ADDED Requirements

### Requirement: Comando Codex
O CLI SHALL disponibilizar `oracle codex` para iniciar uma sessão interativa no projeto selecionado, exibindo mensagens, pedidos de decisão e resultado final ao usuário.

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

### Requirement: Sem bypass implícito
O Oracle SHALL preservar as políticas de autenticação, sandbox e aprovação do agente e SHALL rejeitar opções que desabilitem os controles necessários à ontologia.

#### Scenario: Controles desativados
- **WHEN** a sessão solicita desativar hooks ou contornar o sandbox necessário à fiscalização
- **THEN** o Oracle recusa a inicialização e explica o controle incompatível
