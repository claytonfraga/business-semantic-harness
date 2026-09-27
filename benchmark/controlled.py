#!/usr/bin/env python3
"""BSH benchmark CLI. Every analysis command uses one scientific pipeline."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from .orchestrator import BenchmarkExperimentOrchestrator
from .core.config import load_and_validate_config
from .core.experimental_execution import read_json
from .core.experimental_report import render_figures
from .core.scientific_pipeline import analyze_experimental_execution


def get_batch_dir(argument: str | None) -> Path:
    results = Path(__file__).resolve().parent / "results"
    if argument:
        path = Path(argument).resolve()
        if path.is_dir():
            return path
        path = results / argument
        if path.is_dir():
            return path
        raise ValueError(f"Execução Experimental não encontrada: {argument}")
    candidates = sorted(path for path in results.iterdir() if path.is_dir()) if results.is_dir() else []
    if not candidates:
        raise ValueError("Nenhuma Execução Experimental encontrada em benchmark/results")
    return candidates[-1]


def resolve_config_path(argument: str | None) -> Path | None:
    path = Path(argument).resolve() if argument else Path(__file__).resolve().parent / "config.yaml"
    if path.is_file():
        return path
    if argument:
        raise FileNotFoundError(f"Configuração não encontrada: {argument}")
    return None


def _run(args: argparse.Namespace, smoke: bool) -> None:
    orchestrator = BenchmarkExperimentOrchestrator(
        agent_id=args.agent, model=args.model, reasoning_effort=args.effort,
        config_path=resolve_config_path(args.config),
    )
    orchestrator.execute_plan(smoke_only=smoke or bool(getattr(args, "smoke", False)) or bool(os.environ.get("BENCH_SMOKE")),
                              max_runs=getattr(args, "runs", None))


def _analyze(args: argparse.Namespace, *, publish: bool, figures_only: bool = False) -> None:
    batch = get_batch_dir(args.result or args.batch_dir)
    result = analyze_experimental_execution(batch, publish=publish)
    if figures_only and result["status"] == "ANALYSIS_READY":
        render_figures(read_json(batch / "report-model.json"), batch)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] in {"SCIENTIFIC_REPORT_GENERATION_BLOCKED", "PUBLICATION_BLOCK"}:
        raise SystemExit(2)


def main() -> None:
    parser = argparse.ArgumentParser(description="BSH benchmark")
    commands = parser.add_subparsers(dest="subcommand")
    for name in ("run", "smoke"):
        command = commands.add_parser(name)
        command.add_argument("--config", "-c")
        command.add_argument("--agent", "-a")
        command.add_argument("--model", "-m")
        command.add_argument("--effort", "-e")
        if name == "run":
            command.add_argument("--runs", "-n", type=int)
            command.add_argument("--smoke", action="store_true")
    for name in ("validate", "analyze", "plot", "report", "compile"):
        command = commands.add_parser(name)
        command.add_argument("--result", "-r")
        command.add_argument("batch_dir", nargs="?")
        if name == "validate":
            command.add_argument("--config", "-c")
    known = {"run", "smoke", "validate", "analyze", "plot", "report", "compile", "-h", "--help"}
    if len(sys.argv) > 1 and sys.argv[1] not in known:
        sys.argv.insert(1, "run")
    args = parser.parse_args()
    if args.subcommand in {None, "run", "smoke"}:
        _run(args, args.subcommand == "smoke")
        return
    if args.subcommand == "validate" and args.config:
        config_path = resolve_config_path(args.config)
        load_and_validate_config(config_path, repo_root=Path(__file__).resolve().parent.parent)
        if not args.result and not args.batch_dir:
            print(f"Configuração válida: {config_path}")
            return
    _analyze(args, publish=args.subcommand in {"report", "compile"}, figures_only=args.subcommand == "plot")


if __name__ == "__main__":
    main()
