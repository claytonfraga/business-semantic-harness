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
                                result.json, sem-bsh/ e com-bsh/)
      aquecimento/              execucoes descartadas
      charts/                   graficos 300 dpi
      stats.md / stats.json     analise agregada do lote
      measurements.csv          tabela agregada do lote
```

Cada lote em `results/<data-hora-segundos>/` é **um benchmark completo**: contém as execuções numeradas, o aquecimento e os próprios artefatos de análise (`stats.md`, `stats.json`, `measurements.csv` e `charts/`).

## Boas práticas adotadas

- Mesmo prompt, modelo e esforço nas duas condições.
- Cópia limpa e isolada por execução.
- Ordem das condições alternada entre execuções.
- Execuções independentes em paralelo, com sessões tmux próprias.
- Estatística: média, mediana, desvio padrão, coeficiente de variação, IC 95% (t de Student) e tamanho de efeito de Cohen.
- Falhas registradas com `erro: true` e excluídas das estatísticas.

## Interpretação

- **Aderente**: as duas condições concluem; compara-se o custo em tokens.
- **Bloqueado**: o harness bloqueia o pedido contrário à ontologia (`bloqueado`), enquanto o Codex direto não aplica esse controle — mede-se custo e governança.
