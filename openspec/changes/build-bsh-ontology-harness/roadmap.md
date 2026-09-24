# Roteiro de implementação do BSH

**Fonte de verdade:** `proposal.md`, `specs/*/spec.md`, `design.md` e `tasks.md` desta mudança OpenSpec. Este roteiro organiza a execução; mudanças de comportamento começam pelos specs e só então atualizam design, tarefas e planos.

| Etapa | Tarefas OpenSpec | Entrega testável | Gate de saída |
| --- | --- | --- | --- |
| 1. Ontologias | 1.1–1.4, 2.1–2.3 | CLI empacotável cria, carrega, valida e consulta projetos JSON-LD/SHACL sem agente | Projeto com dois domínios válidos passa; domínio faltante, vazio ou com caminho externo falha; binário funciona em codebase externo |
| 2. Governança | 3.1–3.3 | Avaliador de ações, aprovação pontual e trilha local | Casos de conformidade, violação, incerteza, timeout e falha de escrita passam sem efeitos indevidos |
| 3. Codex | 4.1–4.4 | `bsh codex` interativo com app-server, MCP e hooks | Testes de contrato e sessão local comprovam interceptação antes de mutação |
| 4. Conhecimento | 5.1–5.3 | Propostas com evidência, revisão e recuperação | Ontologia aprovada só muda após aceitação explícita e revalidação |
| 5. Piloto | 6.1–6.5 | Aplicação de ativos com ontologia/SHACL próprios e avaliador | Quatro casos P1–P4 rodam em modo determinístico sem alterar o original |
| 6. Avaliação | 7.1–7.4 | Relatório comparativo A/B/C e guia de uso | OpenSpec valida; testes completos passam; relatório lista dados observados e indisponíveis |
| 7. Agy | 4.5, 7.5 | Adaptador Google Antigravity CLI sobre a mesma ontologia e avaliação separada | Protocolo e superfícies mutáveis comprovados; sessão governada ou recusa explícita; resultados por agente identificados |

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
| Piloto web | API e domínio | Fluxos permitidos, conflitos e falhas dos quatro casos | Testes do próprio piloto e `bsh eval run --mode contract` |
| Avaliação real | Execução controlada | Três condições e três repetições por caso, salvo redução explícita | Relatório JSON/Markdown com hashes, denominadores e limites |

## Riscos a verificar antes do adaptador Codex

- Hooks não cobrem todas as superfícies do Codex; o comando de diagnóstico deve comprovar isolamento ou mediação antes do primeiro turno.
- O adaptador Agy também precisa de prova de mediação na versão suportada; compartilhar ontologia não implica compartilhar o protocolo ou as garantias de interceptação.
- Aprovação do BSH vale para uma única ação e não substitui aprovação nativa de sandbox/rede.
- Uma alteração de código pode ter efeito semântico não representável em RDF; nesse caso o motor pede revisão humana.
- Resultados do piloto não devem misturar execução em árvore já alterada com execução em cópia limpa.
