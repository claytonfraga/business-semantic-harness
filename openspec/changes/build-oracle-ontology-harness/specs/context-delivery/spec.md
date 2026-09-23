## Purpose

Entrega ao agente os conceitos e regras relevantes de cada domínio com origem verificável e tamanho controlado.

## ADDED Requirements

### Requirement: Contexto inicial obrigatório
O Oracle SHALL fornecer ao agente, antes da primeira ação, o identificador do projeto, a lista de domínios, os identificadores e versões das ontologias, e instruções para consultar os conceitos e regras completos.

#### Scenario: Início de sessão
- **WHEN** `oracle codex` inicia em um projeto válido
- **THEN** o primeiro turno do agente recebe o contexto do projeto e os domínios declarados

### Requirement: Consulta dirigida da ontologia
O Oracle SHALL permitir que o agente obtenha conceitos, relações, shapes e regras por domínio e identificador, com indicação da fonte; conteúdo não encontrado SHALL gerar resposta explícita de ausência.

#### Scenario: Consulta de conceito
- **WHEN** o agente consulta `Ativo` no domínio `ativos`
- **THEN** recebe a definição, relações e regras associadas com identificadores de origem

### Requirement: Versão fixa por sessão
O Oracle SHALL associar cada avaliação ao retrato da ontologia carregado na sessão; se os arquivos mudarem, SHALL avisar e exigir recarga antes de novas ações sujeitas a regra.

#### Scenario: Ontologia alterada durante a sessão
- **WHEN** um arquivo de ontologia muda após a abertura da sessão
- **THEN** o Oracle suspende novas decisões baseadas nele até recarregar e validar o novo retrato
