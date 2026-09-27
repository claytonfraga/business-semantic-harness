## Purpose

Definir a coleta auditável de decisões de governança do BSH e seu uso distinto nos relatórios técnico e científico.

## ADDED Requirements

### Requirement: Coleta vinculada à sessão

O benchmark SHALL associar o relatório da sessão e a decisão de governança pelo mesmo identificador de sessão, dentro do workspace da run.

#### Scenario: Uma sessão com decisão correspondente
- **WHEN** uma run contém um relatório de sessão e uma decisão com o mesmo identificador
- **THEN** o benchmark registra a decisão, seu caminho, SHA-256 e campos observados na run

#### Scenario: Evidência ambígua ou ausente
- **WHEN** há múltiplas sessões, uma decisão de outra sessão ou uma decisão ausente
- **THEN** o benchmark registra `INVALID` ou `MISSING`, preserva valores não observados como `null` e não escolhe o arquivo mais recente

#### Scenario: Evidência alterada após a coleta
- **WHEN** o arquivo da decisão no batch diverge do SHA-256 ou do objeto registrado na run
- **THEN** a integridade técnica falha e a execução não recebe prontidão para análise

### Requirement: Diagnóstico técnico factual

O Relatório Técnico da Execução Experimental SHALL registrar por run reconhecimento, shapes selecionados e executados, completude da validação, estado semântico, decisões de política e promoção, identidade do candidato, etapa de falha e estado do origin com proveniência.

#### Scenario: Decisão completa
- **WHEN** os dados estruturados de uma run contêm a decisão de governança
- **THEN** o modelo técnico apresenta os campos observados e a origem da decisão sem responder RQs ou emitir vereditos científicos

#### Scenario: Evidência de enforcement ausente
- **WHEN** falta uma decisão da condição governada
- **THEN** a cobertura registra ausência e a prontidão técnica não afirma evidência completa de enforcement

### Requirement: Elegibilidade de enforcement independente

A Análise Experimental SHALL contar enforcement independente somente com validação completa do candidato incompatível, decisão explícita de bloqueio, evidência de acionamento do gate, ausência observada de relato voluntário e origin preservado.

#### Scenario: Violação bloqueada com evidência completa
- **WHEN** uma decisão `VIOLATION` completa e rastreável bloqueia a promoção sem relato voluntário
- **THEN** a análise pode contar uma ativação observada de enforcement independente

#### Scenario: Erro, indeterminação ou rótulo legado
- **WHEN** a validação é `INDETERMINATE` ou `VALIDATION_ERROR`, ou existe apenas o rótulo legado `violacao`
- **THEN** a análise não contabiliza ativação independente e registra a evidência faltante

### Requirement: Fluxo LaTeX dos dois relatórios

Os dois relatórios SHALL ser renderizados primeiro em arquivos `.tex`. A conversão para `.pdf` SHALL ser feita por uma ferramenta LaTeX do sistema operacional, seguida da validação do PDF resultante. O benchmark não SHALL construir diretamente um PDF em memória como fonte do relatório.

#### Scenario: Relatório técnico de um batch
- **WHEN** o modelo técnico é renderizado
- **THEN** `execution-report-<batchId>-<timestamp>.tex` é criado antes da invocação de `pdflatex`, e o PDF convertido é submetido ao gate de layout

#### Scenario: Relatório científico elegível
- **WHEN** a Análise Experimental produz um relatório elegível
- **THEN** o renderer produz `report.tex` e uma ferramenta LaTeX do sistema operacional o converte em `report.pdf` antes da validação de publicação
