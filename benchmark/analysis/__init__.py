"""Módulo de análise científica, figuras de publicação e relatório LaTeX do BSH benchmark."""

from .load_data import load_dataset, compute_paired_dataset, export_paired_csv
from .validation import validate_benchmark_batch
from .statistics import compute_statistics
from .figures import generate_all_figures
from .tables import generate_latex_tables
from .build_report import build_and_compile_report, run_analysis

__all__ = [
    "load_dataset",
    "validate_benchmark_batch",
    "compute_paired_dataset",
    "export_paired_csv",
    "compute_statistics",
    "generate_all_figures",
    "generate_latex_tables",
    "build_and_compile_report",
    "run_analysis",
]
