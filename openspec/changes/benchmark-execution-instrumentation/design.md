## Context

Consultados: `openspec/config.yaml`, `openspec/changes/benchmark-governance-evidence/specs/governance-evidence-reporting/spec.md`, `benchmark/orchestrator.py`, `benchmark/strategies/base.py`, `benchmark/core/models.py`, `benchmark/core/experimental_execution.py` e `benchmark/core/technical_execution_report.py`.

## Decisões

1. Os horários são capturados ao redor da execução do adapter, sem substituir a duração medida por ele.
2. O avaliador do workspace registra se testes foram realmente executados. `testsPassed` permanece `null` quando `testsExecuted=false`.
3. O hash do diff é derivado do conteúdo observado no workspace após a run, inclusive arquivos novos não rastreados. Um conjunto vazio não é uma mudança.
4. Os commits e hashes da árvore do repositório fonte são observados antes e depois do plano. Por run, o commit do origin isolado é observado antes e depois do adapter; avanço sem promoção declarada é anomalia.
5. Artefatos `.bsh/local` não entram na cópia de cada run. A preparação da condição é congelada no commit base da run antes do agente.
6. O gate técnico exige resultado de teste somente quando testes foram executados, sem converter ausência em aprovação ou reprovação.

## Limites

Esta mudança não executa agentes nem benchmark. Os campos de governança dependem da evidência real produzida por cada sessão.
