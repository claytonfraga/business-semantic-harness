## Purpose

Transforma descobertas da sessão em propostas auditáveis, sem alterar automaticamente a ontologia aprovada do projeto.

## ADDED Requirements

### Requirement: Propostas com evidência
O BSH SHALL capturar conceitos, relações ou regras descobertos durante a sessão como propostas separadas da ontologia aprovada; cada proposta SHALL conter domínio, tipo, conteúdo, origem verificável, sessão e estado.

#### Scenario: Descoberta em arquivo
- **WHEN** o agente identifica uma relação de domínio sustentada por um arquivo do projeto
- **THEN** o BSH registra uma proposta pendente com referência ao arquivo e ao trecho relevante

#### Scenario: Afirmação sem evidência
- **WHEN** uma afirmação não possui origem verificável
- **THEN** o BSH não a promove e a marca como insuficiente para revisão

### Requirement: Revisão de propostas
O usuário SHALL poder listar, inspecionar, aceitar ou rejeitar propostas; somente a aceitação explícita SHALL modificar o grafo JSON-LD ou os shapes SHACL aprovados.

#### Scenario: Aceitar proposta
- **WHEN** o usuário aceita uma proposta válida
- **THEN** o BSH aplica a mudança, valida novamente a ontologia e registra a decisão

#### Scenario: Proposta contraditória
- **WHEN** uma proposta contradiz a ontologia existente ou falha na validação
- **THEN** o BSH mantém a ontologia anterior e apresenta o conflito para revisão

### Requirement: Separação entre descoberta e norma
O BSH SHALL distinguir observações do código, regras normativas e decisões excepcionais do usuário; uma autorização pontual SHALL NOT virar regra permanente.

#### Scenario: Exceção pontual
- **WHEN** o usuário permite uma ação que viola uma regra
- **THEN** a permissão fica apenas na auditoria da sessão e não modifica a ontologia
