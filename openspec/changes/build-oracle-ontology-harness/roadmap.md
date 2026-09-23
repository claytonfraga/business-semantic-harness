# Roteiro de implementação do Oracle

**Fonte de verdade:** `proposal.md`, `specs/*/spec.md`, `design.md` e `tasks.md` desta mudança OpenSpec. Este roteiro organiza a execução; mudanças de comportamento começam pelos specs e só então atualizam design, tarefas e planos.

| Etapa | Tarefas OpenSpec | Entrega testável | Gate de saída |
| --- | --- | --- | --- |
| 1. Ontologias | 1.1–2.3 | CLI cria, carrega, valida e consulta projetos JSON-LD/SHACL sem agente | Projeto com dois domínios válidos passa; domínio faltante, vazio ou com caminho externo falha |
| 2. Governança | 3.1–3.3 | Avaliador de ações, aprovação pontual e trilha local | Casos de conformidade, violação, incerteza, timeout e falha de escrita passam sem efeitos indevidos |
| 3. Codex | 4.1–4.4 | `oracle codex` interativo com app-server, MCP e hooks | Testes de contrato e sessão local comprovam interceptação antes de mutação |
| 4. Conhecimento | 5.1–5.3 | Propostas com evidência, revisão e recuperação | Ontologia aprovada só muda após aceitação explícita e revalidação |
| 5. Piloto | 6.1–6.5 | Aplicação de ativos com ontologia/SHACL próprios e avaliador | Quatro casos P1–P4 rodam em modo determinístico sem alterar o original |
| 6. Avaliação | 7.1–7.4 | Relatório comparativo A/B/C e guia de uso | OpenSpec valida; testes completos passam; relatório lista dados observados e indisponíveis |

## Ordem e revisão

Cada etapa tem um plano técnico próprio antes da implementação. O primeiro está em `plans/01-ontology-foundation.md`. Os demais serão detalhados a partir dos mesmos specs quando a etapa anterior produzir suas interfaces reais; isso evita planejar assinaturas de APIs que ainda não existem. Uma etapa só começa após o gate da anterior. Atualizações de escopo usam deltas OpenSpec e `openspec validate --strict` antes de código.

## Matriz de cobertura planejada

O repositório ainda não possui código, testes ou comandos de build. A etapa 1 criará os comandos `npm run check`, `npm test` e `npm run build`; os gates abaixo passam a usar esses scripts após o scaffold.

| Camada | Tipo de teste | Cobertura exigida | Gate |
| --- | --- | --- | --- |
| Manifesto e caminhos | Unitário e integração com diretórios temporários | Todos os cenários de `project-onboarding`, incluindo ausência, duplicidade e escape | `npm test` |
| RDF e SHACL | Unitário e integração com fixtures | Todos os cenários de `domain-ontology`, grafo válido/inválido e regra textual | `npm test` |
| Motor de decisão e auditoria | Unitário e integração com armazenamento temporário | Todos os cenários de `policy-approval` e `session-audit` | `npm test` |
| CLI, MCP, hooks e Codex | Contrato de protocolo e ponta a ponta | Sucesso, negativa, timeout, perda de IPC e superfície sem cobertura | `npm test` e piloto determinístico |
| Piloto web | API e domínio | Fluxos permitidos, conflitos e falhas dos quatro casos | Testes do próprio piloto e `oracle eval run --mode contract` |
| Avaliação real | Execução controlada | Três condições e três repetições por caso, salvo redução explícita | Relatório JSON/Markdown com hashes, denominadores e limites |

## Riscos a verificar antes do adaptador Codex

- Hooks `PreToolUse` precisam estar ativos e confiáveis na versão suportada do Codex; o comando de diagnóstico deve comprovar isso antes do primeiro turno.
- Aprovação do Oracle vale para uma única ação e não substitui aprovação nativa de sandbox/rede.
- Uma alteração de código pode ter efeito semântico não representável em RDF; nesse caso o motor pede revisão humana.
- Resultados do piloto não devem misturar execução em árvore já alterada com execução em cópia limpa.
