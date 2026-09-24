# Benchmark: Codex com e sem BSH harness

Mede, em tokens, o custo e o efeito de governança do BSH harness frente ao Codex direto, executando o **mesmo pedido** em cópias limpas do projeto.

## Como rodar

```bash
python3 -m venv --system-site-packages benchmark/.venv
BENCH_RUNS=10 BENCH_PROMPT=benchmark/prompts/bloqueado.txt \
  benchmark/.venv/bin/python benchmark/run_benchmark.py
benchmark/.venv/bin/python benchmark/analyze.py
```

Variáveis:

- `BENCH_RUNS` — número de execuções por condição (você indica).
- `BENCH_PROMPT` — `prompts/aderente.txt` ou `prompts/bloqueado.txt`.
- `BENCH_CONCURRENCY` — execuções em paralelo (padrão 3).
- `BENCH_MODEL` / `BENCH_EFFORT` — padrão `gpt-6-sol` / `low`.

## Estrutura

```text
benchmark/
  prompts/                prompts (aderente e bloqueados pela ontologia)
  lib/                    tmux, tokens, condicoes, estatistica
  run_benchmark.py        orquestrador (execucoes em paralelo)
  analyze.py              estatisticas e graficos, por lote
  results/
    <data-hora-segundos>/       um benchmark (lote)
      1/ ... n/                 execucoes individuais (prompt.txt, metadata.json,
                                result.json, sem-harness/ e com-harness/)
      aquecimento/              execucoes descartadas
      charts/                   graficos 300 dpi
      stats.md / stats.json     analise agregada do lote
      measurements.csv          tabela agregada do lote
      relatorio-benchmark-<pasta>.tex / .pdf   relatorio do lote (PDF copiado para Downloads)
```

Cada lote em `results/<data-hora-segundos>/` é **um benchmark completo**: contém as execuções numeradas, o aquecimento e os próprios artefatos de análise (`stats.md`, `stats.json`, `measurements.csv`, `charts/` e o relatório `relatorio-benchmark-<pasta>.tex/.pdf`).

## Condições

- **A — Codex direto** (`sem-harness`): `codex exec`, sem contexto ontológico e sem enforcement.
- **B — Codex com contexto ontológico, sem enforcement independente** (`com-contexto-sem-enforcement`): `bsh codex` com `BSH_ENFORCEMENT=off`.
- **C — Codex com BSH e enforcement independente** (`com-harness`): `bsh codex` padrão; a operação governada só é aceita após passar pela ontologia e SHACL, mesmo sem `bsh_report_conflict`.
- **D — Codex com regras equivalentes em `AGENTS.md`** (opcional): contexto textual, sem enforcement — documentado para comparação.

## Métricas

Violaçoes efetivamente bloqueadas, violações não detectadas, falsos bloqueios, estados indeterminados,
intervenções humanas, exceções aprovadas, tokens, tempo, alterações realizadas e testes aprovados.
**Redução de tokens não é sinônimo de correção.**

## Boas práticas adotadas

- Mesmo prompt, modelo e esforço nas condições.
- Cópia limpa e isolada por execução.
- Ordem das condições randomizada por execução.
- Execuções independentes em paralelo, com sessões tmux próprias.
- Estatística: média, mediana, desvio padrão, coeficiente de variação, IC 95% (t de Student) e tamanho de efeito de Cohen.
- Falhas registradas com `erro: true` e excluídas das estatísticas.

## Relatório por execução

Ao final de cada lote, `analyze.py` gera `relatorio-benchmark-<pasta>.tex` e o compila para
`relatorio-benchmark-<pasta>.pdf` com o `pdflatex` do sistema (a compilação é feita pelo gerador,
nunca manualmente), na própria pasta do lote; em seguida copia o PDF para a pasta Downloads com o
mesmo nome. O PDF inclui as condições, a comparação pareada e a figura principal.
