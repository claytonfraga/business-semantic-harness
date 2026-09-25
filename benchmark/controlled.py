#!/usr/bin/env python3
"""CLI principal e orquestrador do BSH Benchmark.

Suporta os subcomandos:
- run: executa o experimento conforme benchmark/config.yaml (ou parâmetros informados)
- smoke: executa o smoke test experimental conforme benchmark/config.yaml
- validate: valida a configuração declarativa e/ou a integridade dos dados de um lote
- analyze: recalcula pareamento e estatísticas a partir dos dados gravados
- plot: regenera as figuras científicas (PDF + PNG) a partir dos dados existentes
- report: gera o relatório completo em LaTeX (report/benchmark-report.tex)
- compile: compila o PDF a partir de report.tex existente e sincroniza com Downloads
"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any, Dict, Optional

from .orchestrator import BenchmarkExperimentOrchestrator
from .core.config import load_and_validate_config
from .core.pairing import compute_paired_dataset, export_paired_csvs
from .core.statistics import compute_statistics, export_statistics_json
from .core.validation import validate_batch_data_quality
from .core.figures import generate_all_figures
from .core.report import generate_and_compile_report, copy_pdf_to_downloads


def get_batch_dir(arg_dir: Optional[str]) -> Path:
    if arg_dir:
        p = Path(arg_dir).resolve()
        if p.is_dir():
            return p
        alt_p = Path(__file__).resolve().parent / "results" / arg_dir
        if alt_p.is_dir():
            return alt_p
        raise ValueError(f"Diretório de lote experimental não encontrado: {arg_dir}")

    results_dir = Path(__file__).resolve().parent / "results"
    if not results_dir.is_dir():
        raise ValueError("Diretório benchmark/results não existe.")
    subdirs = sorted([d for d in results_dir.iterdir() if d.is_dir()], key=lambda d: d.name)
    if not subdirs:
        raise ValueError("Nenhum lote experimental encontrado em benchmark/results.")
    return subdirs[-1]


def resolve_config_path(arg_config: Optional[str]) -> Optional[Path]:
    if arg_config:
        p = Path(arg_config).resolve()
        if not p.is_file():
            raise FileNotFoundError(f"Arquivo de configuração não encontrado: {arg_config}")
        return p
    default_p = Path(__file__).resolve().parent / "config.yaml"
    if default_p.is_file():
        return default_p
    return None


def cmd_run(args):
    cfg_p = resolve_config_path(args.config)
    orchestrator = BenchmarkExperimentOrchestrator(
        agent_id=args.agent if getattr(args, "agent", None) else None,
        model=args.model if getattr(args, "model", None) else None,
        reasoning_effort=args.effort if getattr(args, "effort", None) else None,
        config_path=cfg_p,
    )
    smoke = getattr(args, "smoke", False) or bool(os.environ.get("BENCH_SMOKE"))
    max_runs = getattr(args, "runs", None)
    orchestrator.execute_plan(smoke_only=smoke, max_runs=max_runs)


def cmd_smoke(args):
    cfg_p = resolve_config_path(args.config)
    orchestrator = BenchmarkExperimentOrchestrator(
        agent_id=args.agent if getattr(args, "agent", None) else None,
        model=args.model if getattr(args, "model", None) else None,
        reasoning_effort=args.effort if getattr(args, "effort", None) else None,
        config_path=cfg_p,
    )
    orchestrator.execute_plan(smoke_only=True)


def cmd_validate(args):
    cfg_p = resolve_config_path(args.config) if getattr(args, "config", None) else None
    if cfg_p and cfg_p.is_file():
        repo_root = Path(__file__).resolve().parent.parent
        cfg = load_and_validate_config(cfg_p, repo_root=repo_root)
        print(f"[config] Configuração '{cfg_p.name}' validada com sucesso:")
        print(f"  - Agente: {cfg['agent']['id']} ({cfg['agent']['model']})")
        print(f"  - Condições: {', '.join(cfg['experiment']['conditions'])}; Tarefas: {len(cfg['experiment']['tasks'])}")
        print(f"  - Máximo de execuções: {cfg['benchmark'].get('maximumExecutions', 50)}")
        print(f"  - Domínio da ontologia: {cfg['project'].get('ontologyDomain')}")

    target_batch = getattr(args, "result", None) or getattr(args, "batch_dir", None)
    if target_batch or not cfg_p:
        bdir = get_batch_dir(target_batch)
        measurements = json.loads((bdir / "measurements.json").read_text(encoding="utf-8"))
        meta = json.loads((bdir / "metadata.json").read_text(encoding="utf-8")) if (bdir / "metadata.json").is_file() else {}
        paired = compute_paired_dataset(measurements)
        q = validate_batch_data_quality(measurements, paired, meta, bdir)
        print(f"[{bdir.name}] Status da qualidade do lote: {q['status']}")
        print(f"  - {q['summary']}")


def cmd_analyze(args):
    target = getattr(args, "result", None) or getattr(args, "batch_dir", None)
    bdir = get_batch_dir(target)
    measurements = json.loads((bdir / "measurements.json").read_text(encoding="utf-8"))
    meta = json.loads((bdir / "metadata.json").read_text(encoding="utf-8")) if (bdir / "metadata.json").is_file() else {}
    tasks_file = bdir / "tasks.json"
    tasks = json.loads(tasks_file.read_text(encoding="utf-8")).get("tarefas", []) if tasks_file.is_file() else None
    sem_file = bdir / "semantic-recognition.json"
    sem_rec = json.loads(sem_file.read_text(encoding="utf-8")) if sem_file.is_file() else None

    paired = compute_paired_dataset(measurements, tasks)
    export_paired_csvs(paired, bdir)
    stats = compute_statistics(measurements, paired, sem_rec, meta)
    export_statistics_json(stats, bdir)
    print(f"[{bdir.name}] Análise estatística e pareamento recalculados com sucesso.")


def cmd_plot(args):
    target = getattr(args, "result", None) or getattr(args, "batch_dir", None)
    bdir = get_batch_dir(target)
    measurements = json.loads((bdir / "measurements.json").read_text(encoding="utf-8"))
    meta = json.loads((bdir / "metadata.json").read_text(encoding="utf-8")) if (bdir / "metadata.json").is_file() else {}
    tasks_file = bdir / "tasks.json"
    tasks = json.loads(tasks_file.read_text(encoding="utf-8")).get("tarefas", []) if tasks_file.is_file() else None
    sem_file = bdir / "semantic-recognition.json"
    sem_rec = json.loads(sem_file.read_text(encoding="utf-8")) if sem_file.is_file() else None

    paired = compute_paired_dataset(measurements, tasks)
    stats = compute_statistics(measurements, paired, sem_rec, meta)
    figs = generate_all_figures(paired, stats, bdir)
    print(f"[{bdir.name}] {len(figs)} figuras científicas geradas em {bdir / 'figures'}.")


def cmd_report(args):
    target = getattr(args, "result", None) or getattr(args, "batch_dir", None)
    bdir = get_batch_dir(target)
    measurements = json.loads((bdir / "measurements.json").read_text(encoding="utf-8"))
    meta = json.loads((bdir / "metadata.json").read_text(encoding="utf-8")) if (bdir / "metadata.json").is_file() else {}
    tasks_file = bdir / "tasks.json"
    tasks = json.loads(tasks_file.read_text(encoding="utf-8")).get("tarefas", []) if tasks_file.is_file() else None
    sem_file = bdir / "semantic-recognition.json"
    sem_rec = json.loads(sem_file.read_text(encoding="utf-8")) if sem_file.is_file() else None
    cap_file = bdir / "agent-capabilities.json"
    caps = json.loads(cap_file.read_text(encoding="utf-8")) if cap_file.is_file() else {}

    paired = compute_paired_dataset(measurements, tasks)
    stats = compute_statistics(measurements, paired, sem_rec, meta)
    quality = validate_batch_data_quality(measurements, paired, meta, bdir)
    figs = generate_all_figures(paired, stats, bdir)

    pdf = generate_and_compile_report(
        batch_dir=bdir,
        metadata=meta,
        stats=stats,
        quality=quality,
        measurements=measurements,
        paired=paired,
        capabilities=caps,
        generated_figures=figs,
        tasks=tasks,
    )
    print(f"[{bdir.name}] Relatório gerado em {pdf}.")


def cmd_compile(args):
    target = getattr(args, "result", None) or getattr(args, "batch_dir", None)
    bdir = get_batch_dir(target)
    report_dir = bdir / "report"
    tex_file = report_dir / "benchmark-report.tex"
    if not tex_file.is_file():
        tex_file = bdir / "report.tex"
    if not tex_file.is_file():
        raise FileNotFoundError(f"Arquivo LaTeX não encontrado em {bdir}.")

    subprocess.run(["pdflatex", "-interaction=nonstopmode", tex_file.name], cwd=tex_file.parent, check=True)
    subprocess.run(["pdflatex", "-interaction=nonstopmode", tex_file.name], cwd=tex_file.parent, check=True)
    pdf = tex_file.with_suffix(".pdf")
    dest_pdf = bdir / "report.pdf"
    if pdf != dest_pdf:
        shutil.copy2(pdf, dest_pdf)
    meta = json.loads((bdir / "metadata.json").read_text(encoding="utf-8")) if (bdir / "metadata.json").is_file() else {}
    copy_pdf_to_downloads(dest_pdf, meta.get("lote", bdir.name))
    print(f"[{bdir.name}] PDF compilado e sincronizado: {dest_pdf}")


def main():
    parser = argparse.ArgumentParser(description="BSH Benchmark Control CLI")
    subparsers = parser.add_subparsers(dest="subcommand")

    # run
    p_run = subparsers.add_parser("run", help="Executa o experimento conforme config.yaml")
    p_run.add_argument("--config", "-c", help="Caminho do arquivo de configuração (YAML)")
    p_run.add_argument("--agent", "-a", help="Sobrescrever agente (agy, codex)")
    p_run.add_argument("--model", "-m", help="Sobrescrever modelo LLM")
    p_run.add_argument("--effort", "-e", help="Sobrescrever nível de raciocínio")
    p_run.add_argument("--runs", "-n", type=int, help="Sobrescrever quantidade de execuções")
    p_run.add_argument("--smoke", action="store_true", help="Executa apenas o smoke test")

    # smoke
    p_smoke = subparsers.add_parser("smoke", help="Executa o smoke test experimental")
    p_smoke.add_argument("--config", "-c", help="Caminho do arquivo de configuração (YAML)")
    p_smoke.add_argument("--agent", "-a", help="Sobrescrever agente (agy, codex)")
    p_smoke.add_argument("--model", "-m", help="Sobrescrever modelo LLM")
    p_smoke.add_argument("--effort", "-e", help="Sobrescrever nível de raciocínio")

    # validate
    p_val = subparsers.add_parser("validate", help="Valida integridade da configuração e dos dados")
    p_val.add_argument("--config", "-c", help="Caminho do arquivo de configuração (YAML)")
    p_val.add_argument("--result", "-r", help="Diretório do lote a validar")
    p_val.add_argument("batch_dir", nargs="?", help="Diretório do lote a validar (posicional)")

    # analyze
    p_ana = subparsers.add_parser("analyze", help="Recalcula pareamento e estatística")
    p_ana.add_argument("--result", "-r", help="Diretório do lote")
    p_ana.add_argument("batch_dir", nargs="?", help="Diretório do lote (posicional)")

    # plot
    p_plot = subparsers.add_parser("plot", help="Gera figuras científicas")
    p_plot.add_argument("--result", "-r", help="Diretório do lote")
    p_plot.add_argument("batch_dir", nargs="?", help="Diretório do lote (posicional)")

    # report
    p_rep = subparsers.add_parser("report", help="Gera relatório LaTeX e compila PDF")
    p_rep.add_argument("--result", "-r", help="Diretório do lote")
    p_rep.add_argument("batch_dir", nargs="?", help="Diretório do lote (posicional)")

    # compile
    p_comp = subparsers.add_parser("compile", help="Compila PDF do relatório a partir do LaTeX")
    p_comp.add_argument("--result", "-r", help="Diretório do lote")
    p_comp.add_argument("batch_dir", nargs="?", help="Diretório do lote (posicional)")

    # Suporte a chamada sem subcomando (ex: --config benchmark/config.yaml)
    known_cmds = ("run", "smoke", "validate", "analyze", "plot", "report", "compile", "-h", "--help")
    if len(sys.argv) > 1 and sys.argv[1] not in known_cmds:
        sys.argv.insert(1, "run")

    args = parser.parse_args()

    if args.subcommand == "run" or args.subcommand is None:
        cmd_run(args)
    elif args.subcommand == "smoke":
        cmd_smoke(args)
    elif args.subcommand == "validate":
        cmd_validate(args)
    elif args.subcommand == "analyze":
        cmd_analyze(args)
    elif args.subcommand == "plot":
        cmd_plot(args)
    elif args.subcommand == "report":
        cmd_report(args)
    elif args.subcommand == "compile":
        cmd_compile(args)


if __name__ == "__main__":
    main()
