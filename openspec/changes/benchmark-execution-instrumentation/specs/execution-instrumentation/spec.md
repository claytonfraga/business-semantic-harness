## Purpose

Garantir que a instrumentação da Execução Experimental forneça ao gate técnico os fatos observados, sem inventar resultados ausentes.

## ADDED Requirements

### Requirement: Registro temporal e status por run

O orquestrador SHALL registrar `startedAt`, `finishedAt` e `executionStatus` por run a partir da execução real do adapter.

#### Scenario: Run concluída
- **WHEN** o adapter termina uma run
- **THEN** o registro contém horários UTC ordenados e o status retornado pelo adapter

### Requirement: Evidência de testes e diff

O benchmark SHALL registrar `testsExecuted`, `testsPassed`, arquivos criados/removidos e `diffSha256` a partir do workspace observado. Resultado de teste não executado SHALL permanecer `null`.

#### Scenario: Nenhuma alteração
- **WHEN** a run não produz mudança de código
- **THEN** `testsExecuted=false`, `testsPassed=null`, a disponibilidade do resultado é `NOT_APPLICABLE` e nenhum resultado de teste é inferido

#### Scenario: Arquivo novo
- **WHEN** a run cria arquivo não rastreado
- **THEN** o arquivo entra no conjunto alterado e no fingerprint do diff

### Requirement: Integridade do origin

O orquestrador SHALL registrar os commits e hashes da árvore do repositório fonte antes e depois da Execução Experimental. Alteração do origin isolado sem promoção declarada SHALL ser marcada como inesperada. Falha na observação SHALL permanecer ausente e impedir prontidão integral. Artefatos locais de sessões anteriores SHALL ser excluídos da cópia inicial.

#### Scenario: Origin fonte preservado
- **WHEN** o plano termina sem alterar o repositório fonte
- **THEN** `originInitialCommit` e `originFinalCommit` são observados e iguais

#### Scenario: Origin isolado avança sem promoção
- **WHEN** o HEAD isolado muda e a promoção não é declarada
- **THEN** a run registra `unexpectedOriginChange=true` e a integridade técnica falha
