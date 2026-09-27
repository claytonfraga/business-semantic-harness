#!/usr/bin/env python3
"""Compatibility CLI for the single Experimental Analysis pipeline."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmark.core.experimental_execution import read_json
from benchmark.core.experimental_report import render_figures
from benchmark.core.scientific_pipeline import analyze_experimental_execution


def main() -> None:
    parser = argparse.ArgumentParser(description="Análise Experimental do BSH")
    parser.add_argument("command_or_batch", nargs="?", default="all")
    parser.add_argument("batch", nargs="?")
    args = parser.parse_args()
    commands = {"validate", "stats", "plot", "report", "all"}
    command = args.command_or_batch if args.command_or_batch in commands else "all"
    target = args.batch if args.command_or_batch in commands else args.command_or_batch
    target = target or os.environ.get("BENCH_LOTE")
    if target is None:
        raise SystemExit("Informe exatamente um ANALYSIS_BATCH_ID")
    result = analyze_experimental_execution(target, publish=command in {"report", "all"})
    if command == "plot" and result["status"] == "ANALYSIS_READY":
        directory = Path(target).resolve()
        if not directory.is_dir():
            directory = Path(__file__).resolve().parent / "results" / target
        render_figures(read_json(directory / "report-model.json"), directory)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] in {"SCIENTIFIC_REPORT_GENERATION_BLOCKED", "PUBLICATION_BLOCK"}:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
