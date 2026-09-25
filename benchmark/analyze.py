#!/usr/bin/env python3
"""Ponto de entrada de análise do benchmark BSH.

Suporta execução completa ou etapas independentes (Requirement 44):
- benchmark/analyze.py [lote]                 (executa fluxo completo)
- benchmark/analyze.py validate [lote]        (validação do lote e data-quality.json)
- benchmark/analyze.py stats [lote]           (estatísticas, pares e statistics.md)
- benchmark/analyze.py plot [lote]            (geração de figuras científicas)
- benchmark/analyze.py report [lote]          (relatório TeX/PDF e cópia para Downloads)
"""

import argparse
import os
import sys
from pathlib import Path
from typing import List

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from analysis import (
    load_dataset,
    validate_benchmark_batch,
    compute_paired_dataset,
    export_paired_csv,
    compute_statistics,
    generate_all_figures,
    generate_latex_tables,
    build_and_compile_report,
    run_analysis,
)

run_full_analysis = run_analysis


def _resolve_lote(lote_arg: str = None) -> List[Path]:
    lote_filtro = lote_arg or os.environ.get("BENCH_LOTE")
    if lote_filtro:
        alvo = Path(lote_filtro)
        if not alvo.is_dir():
            alvo = RESULTS / lote_filtro
        return [alvo] if alvo.is_dir() else []
    if not RESULTS.is_dir():
        return []
    return [d for d in sorted(RESULTS.iterdir()) if d.is_dir() and d.name not in ("charts", "figures", "report")]


def main():
    parser = argparse.ArgumentParser(description="Análise científica e relatório experimental do BSH")
    parser.add_argument("comando_ou_lote", nargs="?", default="all",
                        help="Comando ('validate', 'stats', 'plot', 'report', 'all') ou caminho do lote")
    parser.add_argument("lote", nargs="?", default=None, help="Caminho ou nome do lote experimental")

    args = parser.parse_args()

    # Normalização de argumentos
    cmd = "all"
    lote_target = None

    if args.comando_ou_lote in ("validate", "stats", "plot", "report", "all"):
        cmd = args.comando_ou_lote
        lote_target = args.lote
    else:
        # Primeiro argumento é o lote
        lote_target = args.comando_ou_lote

    lotes = _resolve_lote(lote_target)
    if not lotes:
        raise SystemExit(f"Nenhum lote válido encontrado para o alvo: {lote_target or 'results/'}")

    for lote_dir in lotes:
        print(f"=== Operação '{cmd}' no lote: {lote_dir.name} ===")

        if cmd == "validate":
            data = load_dataset(lote_dir)
            q = validate_benchmark_batch(lote_dir, data)
            print(f"Status do lote: {q.get('status')}")
            print(f"Tarefas planejadas: {q.get('plannedTasksCount')}; Observadas: {q.get('observedTasksCount')}")
            print(f"Pares completos de tokens: {q.get('completeTokenPairsCount')}")
            if q.get("issues"):
                print("Problemas identificados:")
                for iss in q["issues"]:
                    print(f"  [{iss.get('level')}] {iss.get('code')}: {iss.get('message')}")
            print(f"Artefato: {lote_dir / 'data-quality.json'}")

        elif cmd == "stats":
            data = load_dataset(lote_dir)
            validate_benchmark_batch(lote_dir, data)
            paired = compute_paired_dataset(data)
            export_paired_csv(paired, lote_dir / "paired-results.csv")
            stats = compute_statistics(data, paired)
            print(f"Pares computados: {len(paired)}")
            print(f"RQ1 Status: {stats.get('rq1', {}).get('status')}")
            print(f"RQ2 Status: {stats.get('rq2', {}).get('status')}")
            print(f"Artefatos: paired-results.csv, statistics.json, statistics.md")

        elif cmd == "plot":
            data = load_dataset(lote_dir)
            paired = compute_paired_dataset(data)
            stats = compute_statistics(data, paired)
            figs = generate_all_figures(data, paired, stats)
            print(f"Figuras geradas ({len(figs)}): {', '.join(figs) if figs else 'Nenhuma (dados elegíveis insuficientes)'}")

        elif cmd == "report":
            data = load_dataset(lote_dir)
            quality = validate_benchmark_batch(lote_dir, data)
            paired = compute_paired_dataset(data)
            stats = compute_statistics(data, paired)
            figs = generate_all_figures(data, paired, stats)
            tables = generate_latex_tables(data, paired, stats, quality)
            pdf = build_and_compile_report(data, paired, stats, quality, figs, tables)
            print(f"Relatório gerado: {pdf}")

        else:  # all
            res = run_analysis(lote_dir)
            print(f"Status do Lote: {res.get('status')}")
            print(f"Tarefas: {res.get('observed_tasks')}/{res.get('planned_tasks')}; Pares de Tokens Elegíveis: {res.get('eligible_token_pairs')}")
            print(f"Figuras geradas: {len(res.get('figures', []))}")
            print(f"Relatório PDF: {res.get('pdf')}")


if __name__ == "__main__":
    main()
