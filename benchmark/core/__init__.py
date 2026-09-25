"""Núcleo experimental independente de agente do BSH Benchmark."""

from .capabilities import AgentCapabilityProfile
from .models import CanonicalBenchmarkRun, compute_experiment_hashes
from .classification import classify_run, determine_governance_mechanism
from .pairing import compute_paired_dataset, export_paired_csvs
from .statistics import compute_statistics, export_statistics_json_and_md
from .validation import validate_batch_data_quality
from .figures import generate_all_figures
from .tables import generate_all_latex_tables
from .report import generate_and_compile_report, validate_report_content, copy_pdf_to_downloads

__all__ = [
    "AgentCapabilityProfile",
    "CanonicalBenchmarkRun",
    "compute_experiment_hashes",
    "classify_run",
    "determine_governance_mechanism",
    "compute_paired_dataset",
    "export_paired_csvs",
    "compute_statistics",
    "export_statistics_json_and_md",
    "validate_batch_data_quality",
    "generate_all_figures",
    "generate_all_latex_tables",
    "generate_and_compile_report",
    "validate_report_content",
    "copy_pdf_to_downloads",
]
