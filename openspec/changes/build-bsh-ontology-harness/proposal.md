## Why

Agentes de programação recebem contexto fragmentado e podem executar mudanças incompatíveis com o domínio de um projeto. O BSH dará a cada projeto uma ontologia explícita e verificável, exigida antes de iniciar o agente, e manterá o usuário no controle quando uma ação contrariar ou não puder ser conciliada com as regras.

## What Changes

- Criar um CLI `bsh` em TypeScript, com `bsh code base` (`bsh codex`) como primeira integração interativa e `bsh agy` como segunda integração planejada.
- Distribuir o CLI como pacote npm executável no Linux, utilizável globalmente ou via `npx` de dentro de qualquer codebase com `.bsh/` próprio.
- Representar conceitos e relações em JSON-LD e restrições verificáveis em SHACL, com vocabulário BSH versionado para regras de ação e revisão humana.
- Exigir um manifesto do projeto e uma ontologia válida para cada domínio declarado antes de iniciar sessões.
- Disponibilizar comandos para criar, inspecionar e validar ontologias de domínio.
- Projetar conceitos e regras relevantes no contexto do agente, com identificação de versão e origem.
- Avaliar ações antes da execução; consultar o usuário quando houver conflito ou incerteza; registrar sua decisão.
- Capturar descobertas do agente como propostas com evidência, sujeitas a revisão humana antes de entrar na ontologia.
- Registrar eventos e decisões da sessão para auditoria e recuperação.
- Definir uma interface de adaptador independente do agente; entregar Codex primeiro e depois Agy (Google Antigravity CLI, executável `agy`), sujeitos aos mesmos gates de segurança.
- Incluir um projeto piloto isolado de gestão de ativos, com ontologia própria, cenários de referência e avaliação comparativa mensurável.

## Capabilities

### New Capabilities

- `project-onboarding`: descoberta do projeto, domínios declarados e pré-condições para sessões.
- `domain-ontology`: criação, leitura, evolução e validação de ontologias por domínio.
- `context-delivery`: seleção e entrega rastreável do contexto ontológico ao agente.
- `agent-session`: execução interativa pelo CLI e contrato de adaptadores de agente.
- `policy-approval`: avaliação prévia de ações, consulta humana e decisões de regra.
- `knowledge-capture`: extração de descobertas, propostas com evidência e promoção revisada.
- `session-audit`: trilha local de eventos, retomada e tratamento de falhas.
- `pilot-evaluation`: projeto consumidor de referência, cenários e relatório de resultados do BSH.

### Modified Capabilities

Nenhuma. O projeto ainda não possui capacidades implementadas.

## Impact

- Novo pacote CLI para Node.js/TypeScript e arquivos JSON-LD/SHACL versionáveis em cada projeto consumidor.
- Dependência operacional do Codex CLI e de sua interface de sessão e hooks na primeira versão.
- Agy é o segundo adaptador exigido; Claude permanece fora do escopo desta mudança.
- Dados locais de sessão e propostas permanecem separados da ontologia aprovada.
- Projeto piloto em `pilot/asset-management/`, independente das ontologias e do estado do próprio BSH.
