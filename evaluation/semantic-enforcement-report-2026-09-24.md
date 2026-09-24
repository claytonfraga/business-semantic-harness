# Relatório — Enforcement semântico independente (E2E real)

Data: 2026-09-24
Projeto-fixture: `test/fixtures/enforcement-project/` (Git real, `.bsh/` com domínio `ativos`, `ontology.jsonld`, `shapes.ttl`, `enforcement.json`, código e testes). Declarado pelos mecanismos normais do BSH — nenhuma configuração artificial no produto.
Suíte: `npm run test:e2e:semantic` → **7/7 passaram**.
Gate testado: o **mesmo `finalizeSession`** usado por `bsh codex` (enforcement → gates técnicos → promoção Git). O agente não é chamado; a alteração é colocada na worktree pelo fluxo normal (arquivos), sem `bsh_report_conflict`.

## Resultado por cenário

| # | Cenário | Propriedade testada | `bsh_report_conflict` | Enforcement | Gates | Promoção | Principal | Evidência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Alteração válida | promoção de mudança aderente | 0 | conforme | passou | **promovida** | contém a mudança; `git status` limpo | hash do arquivo mudou; status `promovido` |
| 2 | **Violação sem report** | **enforcement independente do agente** | **0** | **violacao** (TransferenciaShape) | — | **bloqueada** | **byte a byte intacta** | `descartado`; `depois == antes`; worktree removida |
| 3 | Política de revisão humana | suspensão sem aprovação | 0 | revisao_humana | — | não promovida | intacta | `descartado`; `depois == antes` |
| 4 | Fato indeterminado | ausência de fato ≠ permissão | 0 | indeterminado | — | não promovida | intacta | `descartado`; `depois == antes` |
| 5 | Fora do conhecimento governado | sem falso bloqueio | 0 | conforme | passou | promovida | contém a mudança | status `promovido` |
| 6 | Violação que passa nos testes | camada semântica ≠ testes | 0 | violacao | passou | bloqueada | intacta | `descartado`; testes do fixture passaram |
| 7 | Válida que falha no gate técnico | composição governança+gates | 0 | conforme | falhou | não promovida | intacta | `falha-validacao`; `depois == antes` |

## Destaque — cenário 2 (propriedade central)

```text
alteração incompatível criada na worktree (guard 'status === Baixado' removido)
        ↓
bsh_report_conflict = 0 (nenhum)
        ↓
enforcement independente executado no gate de promoção
        ↓
SHACL: TransferenciaShape violado (estadoAtual = Baixado)
        ↓
promoção bloqueada
        ↓
branch principal byte a byte intacta; worktree descartada; origem limpa
```

Isso comprova que a detecção **não depende** de o agente relatar o conflito. O teste não foi aprovado porque o modelo "decidiu não alterar": a alteração incompatível **existiu** na worktree candidata à promoção e foi o BSH que impediu sua chegada à origem.

## Como os fatos são obtidos (sem confundir SHACL com código)

O `enforcement.json` do domínio mapeia, de forma determinística, um padrão do change set para uma **operação semântica** (`TransferenciaAtivo` com `estadoAtual`); o BSH monta o grafo RDF candidato e valida com SHACL. Não se aplica SHACL ao diff textual.

## Critérios de aceitação

1. alteração válida promovida — cenário 1. 2. violação relatada — coberta por cenário cooperativo (relatório anterior `e2e-report-2026-09-24.md`). 3. **violação bloqueada com 0 chamadas a `bsh_report_conflict`** — cenário 2. 4. política humana impede promoção — cenário 3. 5. indeterminado não é conforme — cenário 4. 6. fora do conhecimento sem falso bloqueio — cenário 5. 7. violação que passa nos testes ainda bloqueada — cenário 6. 8. válida que falha no gate técnico não é promovida — cenário 7. 9. nenhuma rejeitada alcança a principal — cenários 2–4, 6, 7. 10. enforcement antes da integração — `finalizeSession` chama o enforcement antes do `promoverSessao`. 11. sem caminho que contorne — a promoção é feita apenas por `promoverSessao`, chamado só por `finalizeSession`. 12. nenhum teste altera o produto — só o fixture e a injeção normal de `confirmar` (DI, como no `ApprovalBroker`).

## Mudanças feitas (mínimas)

- Injeção da decisão humana em `finalizeSession` (`confirmar?`), com padrão lendo `stdin` — DI, sem timeout nem bypass no produto.
- Projeto-fixture `test/fixtures/enforcement-project/` (configuração normal do BSH).
- Suíte `test/e2e-live/semantic-enforcement.semantic.mjs` + script `test:e2e:semantic`.

## Reprodução

```bash
npm run quality
npm test                 # 112 (inclui A–H determinísticos)
npm run test:e2e         # 27 (infra Git/worktree)
npm run test:e2e:semantic  # 7 (semântico real, gate de promoção)
```