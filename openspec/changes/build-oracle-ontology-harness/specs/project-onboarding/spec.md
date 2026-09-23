## Purpose

Garante que cada sessão do Oracle tenha um projeto identificável e uma ontologia completa para todos os seus domínios declarados.

## ADDED Requirements

### Requirement: Manifesto de projeto
O Oracle SHALL localizar um manifesto versionável no diretório do projeto, com identificador do projeto, versão do formato e lista não vazia de domínios com identificadores únicos.

#### Scenario: Projeto com dois domínios
- **WHEN** o manifesto declara `ativos` e `contratos`
- **THEN** o Oracle reconhece ambos como parte obrigatória do projeto

#### Scenario: Manifesto ausente
- **WHEN** o usuário executa `oracle codex` sem manifesto no projeto selecionado
- **THEN** o Oracle não inicia o agente e informa como preparar o projeto

### Requirement: Ontologia obrigatória por domínio
O Oracle SHALL iniciar uma sessão apenas quando cada domínio declarado tiver grafo JSON-LD e shapes SHACL legíveis e válidos, com todas as referências locais resolvidas, ao menos um conceito de negócio e ao menos uma restrição SHACL ou regra de revisão humana ativa.

#### Scenario: Domínio sem ontologia
- **WHEN** um dos domínios declarados não possui seus arquivos obrigatórios
- **THEN** o Oracle não inicia o agente e identifica o domínio e os arquivos faltantes

#### Scenario: Ontologias completas
- **WHEN** todos os domínios declarados passam na validação
- **THEN** o Oracle permite a preparação da sessão e registra as versões carregadas

#### Scenario: Esqueleto sem conteúdo de domínio
- **WHEN** um domínio contém apenas os arquivos gerados pelo comando de criação
- **THEN** o Oracle informa que faltam conceito e regra de negócio e não inicia o agente

### Requirement: Fronteira do projeto
O Oracle SHALL associar ontologias, propostas e sessões ao diretório canônico do projeto selecionado e SHALL rejeitar referências que escapem dessa fronteira.

#### Scenario: Referência fora do projeto
- **WHEN** o manifesto aponta para um arquivo fora do diretório do projeto
- **THEN** o Oracle recusa a configuração e informa a referência inválida
