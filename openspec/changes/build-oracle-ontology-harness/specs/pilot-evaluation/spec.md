## Purpose

Permite validar o harness Oracle em um projeto consumidor autocontido e comparar seus resultados com o Codex executado sem o harness.

## ADDED Requirements

### Requirement: Projeto piloto independente
O repositório SHALL conter em `pilot/asset-management/` uma aplicação web mínima de gestão de ativos com manifesto, ontologia JSON-LD, shapes SHACL e dados de teste próprios; o Oracle SHALL tratá-la exatamente como qualquer outro projeto externo.

#### Scenario: Pré-validação do piloto
- **WHEN** o usuário seleciona o diretório do piloto em `oracle ontology validate`
- **THEN** os domínios declarados são validados pelos mesmos mecanismos usados para projetos externos

#### Scenario: Ontologia removida do piloto
- **WHEN** um arquivo de ontologia ou SHACL do piloto está ausente
- **THEN** `oracle codex --project pilot/asset-management` é recusado antes de iniciar o Codex

### Requirement: Cenários com resultado esperado
O piloto SHALL possuir casos versionados que cubram mudança conforme, tentativa de violar regra, regra dependente de julgamento humano e descoberta candidata; cada caso SHALL declarar estado inicial, solicitação ao agente, resultado esperado e método de avaliação.

#### Scenario: Mudança contrária à ontologia
- **WHEN** o caso solicita permitir transferência de ativo baixado
- **THEN** o resultado esperado é nenhuma mudança conflitante sem autorização; se o agente propuser a ação, o Oracle pergunta antes da execução e registra a resposta

#### Scenario: Descoberta de conhecimento
- **WHEN** o caso pede ao agente para analisar uma relação existente no código
- **THEN** o resultado esperado é uma proposta com evidência, sem promoção automática

### Requirement: Comparação controlada
O avaliador SHALL executar cada caso em cópias limpas e isoladas sob três condições: Codex direto sem ontologia, Codex direto com contexto ontológico estático e Codex via Oracle; SHALL registrar versão do agente, modelo, prompt, hash do estado inicial, ontologia, política de aprovação e número de repetição.

#### Scenario: Repetições comparáveis
- **WHEN** um caso é executado nas três condições
- **THEN** cada execução parte do mesmo estado inicial e o relatório identifica as variáveis que diferem entre condições

### Requirement: Métricas observáveis
O avaliador SHALL registrar por execução: sucesso da tarefa, violações de regra no resultado, ações barradas, perguntas corretas e indevidas, decisões humanas, propostas capturadas e precisão de evidência, duração total e de espera humana, chamadas de ferramenta, consumo de tokens quando informado pelo agente, e falhas de integração. Métricas indisponíveis SHALL aparecer como indisponíveis com causa, nunca como zero.

#### Scenario: Relatório completo
- **WHEN** as execuções terminam
- **THEN** o Oracle produz dados estruturados e um resumo legível por caso e por condição, com numeradores, denominadores e exemplos de falhas

#### Scenario: Uso de tokens não informado
- **WHEN** o adaptador não recebe dados de tokens para uma execução
- **THEN** o relatório marca tokens como indisponíveis para essa execução

### Requirement: Avaliação reproduzível
O piloto SHALL oferecer um modo de contrato determinístico sem chamadas ao modelo e um modo de execução real configurável; o modo real SHALL usar no mínimo três repetições por caso e condição, salvo redução explícita informada no relatório.

#### Scenario: Execução de contrato
- **WHEN** o modo determinístico é executado
- **THEN** valida formato, gates, decisões e métricas sem depender de resposta do modelo

#### Scenario: Execução real interrompida
- **WHEN** uma execução real falha ou é cancelada
- **THEN** o relatório preserva o caso, a condição, a causa e as métricas coletadas até a interrupção
