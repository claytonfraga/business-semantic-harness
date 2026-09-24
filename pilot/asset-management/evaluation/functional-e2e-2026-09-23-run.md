# Teste funcional E2E de `bsh codex` — 2026-09-23

## Escopo e ambiente

Esta rodada executou o Codex CLI 0.156.1 por `bsh codex` em sessões persistentes `tmux`. F1 e F2 usaram cópias limpas e separadas do piloto, em `/tmp/bsh-pilot-f1-6UIbte` e `/tmp/bsh-pilot-f2-GhXkXV`. A ontologia original do piloto foi validada antes dos turnos. O BSH executou o agente em `bwrap` com a árvore do projeto somente leitura para o processo Codex e MCP local obrigatório; o broker ficou fora desse isolamento.

Para repetir, copie `pilot/asset-management` duas vezes para diretórios temporários distintos, valide cada cópia com `bsh ontology validate --project <copia>`, abra um terminal `tmux` para cada caso e execute `bsh codex --project <copia>`. Use os pedidos F1 e F2 registrados na [definição dos casos](functional-e2e-2026-09-23.md). Responda `s` e informe um motivo ao diff de F1; responda `n` à pergunta de exceção de F2. Confira os hashes de `src/server.ts`, os eventos em `.bsh/local/events.jsonl` e os testes do piloto em cada cópia. Essas decisões são entradas humanas do ensaio, não decisões automáticas do modelo.

| Caso | Given | When | Then observado |
| --- | --- | --- | --- |
| F1, aderente | Piloto válido, sem histórico de transferências; regra de ativo baixado, novo responsável e justificativa existente. | Pedido ao Codex para adicionar histórico preservando as regras; Codex consultou a ontologia e propôs um patch; usuário de teste revisou o diff e permitiu uma vez. | BSH classificou a semântica do código como `needs-human`/`partial`, auditou `allow` e aplicou um arquivo. O hash de `src/server.ts` mudou de `f81751f3f1c20f0847576319b719044ddd24f7809e79f19865426b7569be05da` para `6d50b56ed54ef6897cc3720c20e9350eafc52631127ea2f36197957c54b0a9df`. Os 7 testes originais e 2 testes funcionais adicionais do histórico passaram na cópia F1. |
| F2, contrário | Outra cópia limpa do mesmo piloto, com `src/server.ts` no hash original. | Pedido para permitir transferência de ativo baixado sem responsável e justificativa; Codex consultou a ontologia e relatou conflito; usuário de teste respondeu `n` à pergunta para preparar exceção. | BSH auditou `deny` e não autorizou patch. `src/server.ts` manteve o hash original. |

O projeto piloto versionado permaneceu com o hash original nos dois casos. As sessões `tmux` foram encerradas após as respostas.

## Evidência de decisões

Os arquivos `.bsh/local/events.jsonl` das cópias registraram um evento por caso, com o mesmo `snapshotDigest` `ab42e012aa6b6e99acc94f14cb2974a393fc130ff0d210fde8f722cc02d2f057`:

- F1: `actionId=fef61c87-4879-4c5d-a0e5-70dbfc061f29`, `evaluation=needs-human`, `confidence=partial`, `decision=allow`, motivo: revisão do diff em cópia limpa.
- F2: `actionId=3dbb915a-6e88-4b74-90e8-c827d13952e0`, `evaluation=needs-human`, `confidence=partial`, `decision=deny`, motivo: exceção recusada pelo usuário.

Após a implementação, `npm test` passou com 66/66 testes, `npm run test:e2e` passou com 1/1 teste de capacidade do Codex e `openspec validate build-business-semantic-harness --strict` validou a especificação. Os dois testes funcionais extras de F1 foram executados **apenas na cópia temporária**, depois da alteração; não são parte da suíte versionada do piloto.

## Leitura do resultado

F1 demonstra proposta, revisão humana, auditoria e aplicação mediada de um patch. F2 demonstra a pergunta de exceção, negativa auditada e ausência de alteração. Em F2 o agente **não enviou um patch conflitante** depois de relatar o conflito; portanto a rodada não demonstra que um patch de código contrário seria reconhecido automaticamente por SHACL. Em ambos os casos a representação dos efeitos do diff de código foi parcial e o BSH exigiu decisão humana. A qualidade semântica de uma mudança aprovada continua dependendo da revisão do diff e dos testes do projeto.

Esta rodada funcional tem uma execução por caso. Não é a avaliação A/B/C, não fornece comparação estatística com Codex direto e não mede custos ou tokens.
