## Purpose

Define o contrato portátil da ontologia de cada domínio para que conceitos, relações e restrições possam ser inspecionados, validados e evoluídos.

## ADDED Requirements

### Requirement: Grafo de domínio em JSON-LD
Cada domínio SHALL possuir um documento JSON-LD com contexto explícito, identificador estável, versão, conceitos e relações identificados por IRI; o BSH SHALL rejeitar identificadores duplicados ou referências sem resolução.

#### Scenario: Grafo válido
- **WHEN** o domínio define `Ativo` e `Responsavel` com uma relação identificada
- **THEN** o BSH os apresenta com seus identificadores e descrições ao consultar a ontologia

#### Scenario: Identificador duplicado
- **WHEN** dois elementos do mesmo projeto usam o mesmo IRI com definições incompatíveis
- **THEN** a validação falha com a origem das duas definições

### Requirement: Restrições SHACL
Cada domínio SHALL possuir um grafo de shapes SHACL que declare restrições aplicáveis aos dados e ações representáveis do domínio; o BSH SHALL produzir relatório com shape, foco, mensagem e severidade para toda violação encontrada.

#### Scenario: Instância inválida
- **WHEN** uma instância de `Ativo` viola uma cardinalidade declarada
- **THEN** o relatório identifica a instância e a restrição violada

### Requirement: Regras que exigem interpretação
O vocabulário BSH SHALL permitir associar a um conceito ou ação uma regra textual com identificador, justificativa e escopo; o BSH SHALL classificá-la como sujeita a revisão humana, sem apresentá-la como validação SHACL automática.

#### Scenario: Regra textual
- **WHEN** uma regra diz que uma transferência requer justificativa adequada, sem critério verificável
- **THEN** o BSH a inclui no contexto e solicita revisão humana quando a ação correspondente ocorrer

### Requirement: Ferramentas de autoria e validação
O CLI SHALL oferecer criação de projeto e domínio, consulta de ontologias e validação explícita, sem substituir arquivos existentes sem consentimento do usuário.

#### Scenario: Novo domínio
- **WHEN** o usuário cria o domínio `ativos`
- **THEN** o BSH gera arquivos JSON-LD e SHACL estruturalmente válidos, vinculados ao manifesto, e informa que o domínio precisa de conceitos e regras antes de iniciar sessões

#### Scenario: Ontologia inválida
- **WHEN** o usuário executa a validação e encontra JSON-LD malformado ou shape SHACL inválido
- **THEN** o comando termina com falha e aponta o arquivo e a causa

### Requirement: Evolução rastreável
O BSH SHALL registrar a versão do formato e da ontologia carregada e SHALL rejeitar versões incompatíveis com instrução de migração, preservando o conteúdo existente.

#### Scenario: Versão futura
- **WHEN** a ontologia declara uma versão de formato não suportada
- **THEN** o BSH interrompe o uso dela sem reescrever os arquivos

### Requirement: Ontologia vive no projeto de origem
Cada ontologia de domínio SHALL residir dentro do projeto a que se refere, em `<projeto>/.bsh/domains/<dominio>/`. A ontologia SHALL NOT ser copiada para o pacote BSH, para outro projeto ou para um diretório global. Fixtures sintéticas do pacote BSH para testes unitários SHALL NOT ser tratadas como ontologias de projeto. Uma sessão SHALL exigir a ontologia própria do projeto selecionado, inclusive quando ele for uma cópia de trabalho de teste.

#### Scenario: Projeto sem ontologia própria
- **WHEN** uma sessão é aberta para um projeto cuja ontologia de domínio não está em seu próprio `.bsh/`
- **THEN** o BSH recusa a sessão e aponta o domínio ausente

#### Scenario: Cópia de trabalho
- **WHEN** o projeto é uma cópia limpa usada em teste E2E
- **THEN** a cópia carrega a ontologia do próprio projeto copiado, sem depender do pacote BSH nem de outro projeto
