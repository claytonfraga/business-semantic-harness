## Purpose

Define o contrato portátil da ontologia de cada domínio para que conceitos, relações e restrições possam ser inspecionados, validados e evoluídos.

## ADDED Requirements

### Requirement: Grafo de domínio em JSON-LD
Cada domínio SHALL possuir um documento JSON-LD com contexto explícito, identificador estável, versão, conceitos e relações identificados por IRI; o Oracle SHALL rejeitar identificadores duplicados ou referências sem resolução.

#### Scenario: Grafo válido
- **WHEN** o domínio define `Ativo` e `Responsavel` com uma relação identificada
- **THEN** o Oracle os apresenta com seus identificadores e descrições ao consultar a ontologia

#### Scenario: Identificador duplicado
- **WHEN** dois elementos do mesmo projeto usam o mesmo IRI com definições incompatíveis
- **THEN** a validação falha com a origem das duas definições

### Requirement: Restrições SHACL
Cada domínio SHALL possuir um grafo de shapes SHACL que declare restrições aplicáveis aos dados e ações representáveis do domínio; o Oracle SHALL produzir relatório com shape, foco, mensagem e severidade para toda violação encontrada.

#### Scenario: Instância inválida
- **WHEN** uma instância de `Ativo` viola uma cardinalidade declarada
- **THEN** o relatório identifica a instância e a restrição violada

### Requirement: Regras que exigem interpretação
O vocabulário Oracle SHALL permitir associar a um conceito ou ação uma regra textual com identificador, justificativa e escopo; o Oracle SHALL classificá-la como sujeita a revisão humana, sem apresentá-la como validação SHACL automática.

#### Scenario: Regra textual
- **WHEN** uma regra diz que uma transferência requer justificativa adequada, sem critério verificável
- **THEN** o Oracle a inclui no contexto e solicita revisão humana quando a ação correspondente ocorrer

### Requirement: Ferramentas de autoria e validação
O CLI SHALL oferecer criação de projeto e domínio, consulta de ontologias e validação explícita, sem substituir arquivos existentes sem consentimento do usuário.

#### Scenario: Novo domínio
- **WHEN** o usuário cria o domínio `ativos`
- **THEN** o Oracle gera arquivos JSON-LD e SHACL estruturalmente válidos, vinculados ao manifesto, e informa que o domínio precisa de conceitos e regras antes de iniciar sessões

#### Scenario: Ontologia inválida
- **WHEN** o usuário executa a validação e encontra JSON-LD malformado ou shape SHACL inválido
- **THEN** o comando termina com falha e aponta o arquivo e a causa

### Requirement: Evolução rastreável
O Oracle SHALL registrar a versão do formato e da ontologia carregada e SHALL rejeitar versões incompatíveis com instrução de migração, preservando o conteúdo existente.

#### Scenario: Versão futura
- **WHEN** a ontologia declara uma versão de formato não suportada
- **THEN** o Oracle interrompe o uso dela sem reescrever os arquivos
