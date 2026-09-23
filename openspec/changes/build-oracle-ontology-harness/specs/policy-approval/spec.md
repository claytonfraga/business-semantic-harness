## Purpose

Faz as regras da ontologia participarem da decisão sobre ações do agente, com consulta ao usuário diante de conflito ou incerteza.

## ADDED Requirements

### Requirement: Avaliação antes de efeitos
O Oracle SHALL avaliar toda ação mutável interceptada antes de sua execução, usando o retrato ontológico da sessão e os dados observáveis da ação; SHALL registrar regras avaliadas, resultado e confiança da representação.

#### Scenario: Ação conforme
- **WHEN** a ação é representável e satisfaz as restrições aplicáveis
- **THEN** o Oracle permite sua execução e registra a avaliação

#### Scenario: Violação SHACL
- **WHEN** o grafo da ação viola um shape aplicável
- **THEN** o Oracle suspende a ação e apresenta a violação ao usuário antes de qualquer efeito

### Requirement: Consulta humana em conflito ou incerteza
O Oracle SHALL perguntar ao usuário quando houver violação, regra textual aplicável, dados insuficientes ou ação mutável não representável; a pergunta SHALL mostrar ação, domínio, regras relevantes, consequências conhecidas e opções permitir uma vez ou negar.

#### Scenario: Usuário permite uma vez
- **WHEN** o usuário permite a ação após ler a justificativa
- **THEN** o Oracle libera somente aquela ação identificada e registra quem decidiu, quando e por quê

#### Scenario: Usuário nega
- **WHEN** o usuário nega a ação
- **THEN** ela não é executada e o agente recebe a razão de forma utilizável

#### Scenario: Sem resposta
- **WHEN** não há resposta, o canal de pergunta falha ou o tempo limite termina
- **THEN** o Oracle nega a ação e registra a causa

### Requirement: Aprovação vinculada à ação
Uma decisão SHALL valer apenas para a ação, argumentos e retrato ontológico exibidos; alteração de qualquer um deles SHALL exigir nova avaliação.

#### Scenario: Argumentos alterados
- **WHEN** o agente tenta executar uma ação semelhante com argumentos diferentes
- **THEN** uma aprovação anterior não a libera

### Requirement: Fronteira de cobertura
O Oracle SHALL informar ao usuário quando uma ação ou superfície do agente não puder ser inspecionada preventivamente e SHALL impedir ações mutáveis nessa condição.

#### Scenario: Ferramenta mutável desconhecida
- **WHEN** o agente apresenta uma ferramenta mutável sem interceptação confiável
- **THEN** o Oracle não permite sua execução silenciosa
