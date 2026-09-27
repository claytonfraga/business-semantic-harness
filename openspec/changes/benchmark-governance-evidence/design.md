## Context

Consultados: `openspec/config.yaml`, `benchmark-agy-support/specs/multi-agent-benchmark/spec.md`, `benchmark/core/technical_execution_report.py`, `benchmark/core/experimental_report.py`, `benchmark/orchestrator.py` e `src/enforcement/governanceDecision.ts`.

## Decisões

1. O coletor lê exatamente um relatório de sessão por workspace e busca a decisão com o mesmo identificador. Ambiguidade vira `INVALID`; ausência vira `MISSING`.
2. O registro da run guarda o objeto bruto da decisão, seu caminho e SHA-256. A normalização expõe campos derivados desse objeto observado. O oracle permanece fonte independente dos valores esperados.
3. O relatório técnico apresenta os campos por run e sua cobertura. Ele não executa RQs, estimandos ou vereditos.
4. RQ5 e RQ11 só consideram evidência de enforcement quando a decisão demonstra validação completa e bloqueio do candidato. O estimando e as fórmulas existentes permanecem os mesmos.
5. O arquivo `.tex` é a fonte renderizada dos dois documentos. `pdflatex` e outros programas LaTeX são ferramentas do sistema operacional usadas para conversão; os gates inspecionam o PDF convertido.

## Limites

- Um log de ferramentas incompleto não comprova ausência de relato voluntário; nesse caso o valor permanece `null`.
- Arquivos de batches antigos não recebem campos inventados. A análise deles poderá ficar parcial ou não avaliável em enforcement.
- Nenhum agente ou execução experimental é iniciado por esta mudança.
