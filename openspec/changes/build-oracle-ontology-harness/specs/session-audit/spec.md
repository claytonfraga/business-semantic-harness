## Purpose

Mantém uma trilha local suficiente para explicar o contexto entregue ao agente, as ações avaliadas, as decisões humanas e as propostas produzidas.

## ADDED Requirements

### Requirement: Trilha de sessão
O Oracle SHALL registrar, em armazenamento local do projeto, identificador da sessão, agente e versão, versões das ontologias, eventos relevantes, avaliações, decisões e resultados, em ordem reproduzível.

#### Scenario: Consulta de decisão
- **WHEN** o usuário consulta uma sessão encerrada
- **THEN** o Oracle mostra qual ação foi avaliada, quais regras foram consideradas e qual decisão permitiu ou negou a execução

### Requirement: Dados sensíveis
O Oracle SHALL evitar persistir credenciais e conteúdos completos de arquivos quando uma referência e um resumo bastarem; dados de auditoria SHALL permanecer locais por padrão.

#### Scenario: Segredo em argumento
- **WHEN** um evento contém valor identificado como segredo
- **THEN** o registro persistido omite o valor e preserva apenas os metadados necessários à auditoria

### Requirement: Recuperação segura
O Oracle SHALL identificar sessões interrompidas e SHALL NOT reutilizar decisões pendentes ou aprovações anteriores ao retomar; a ontologia SHALL ser revalidada antes de novas ações.

#### Scenario: Processo interrompido durante aprovação
- **WHEN** o Oracle é reiniciado após a interrupção
- **THEN** a ação pendente permanece não autorizada e uma nova avaliação é exigida

### Requirement: Falha de auditoria
O Oracle SHALL negar ações mutáveis quando não conseguir registrar a avaliação e a decisão correspondente.

#### Scenario: Armazenamento indisponível
- **WHEN** o registro local não pode ser gravado
- **THEN** a ação mutável não é liberada e o usuário recebe diagnóstico
