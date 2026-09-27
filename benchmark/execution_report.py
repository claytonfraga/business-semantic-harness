#!/usr/bin/env python3
"""Generate one batch-local Technical Experimental Execution Report."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmark.core.technical_execution_report import generate_execution_report


def main() -> None:
    parser = argparse.ArgumentParser(description="Relatório Técnico da Execução Experimental do BSH")
    parser.add_argument("batchId", help="Identificador ou caminho da Execução Experimental")
    args = parser.parse_args()
    batch = Path(args.batchId).resolve()
    if not batch.is_dir():
        batch = Path(__file__).resolve().parent / "results" / args.batchId
    if not batch.is_dir():
        raise SystemExit(f"Execução Experimental não encontrada: {args.batchId}")
    result = generate_execution_report(batch)
    summary = result.get("summary", {})
    completion = result.get("completion", {})
    layout = result.get("layout", {})
    print(f"Execution Batch ID: {result['batchId']}")
    print(f"Execution Report Path: {result.get('executionReportPath')}")
    identity = result.get("identity", {})
    for label, key in (("Agent", "agent"), ("Model", "model"), ("Reasoning Effort", "reasoningEffort")):
        print(f"{label}: {identity.get(key)}")
    print(f"Execution Status: {summary.get('executionStatus')}")
    for key in ("plannedRuns", "observedRuns", "completedRuns", "missingRuns", "failedRuns", "duplicateRuns"):
        print(f"{key}: {completion.get(key)}")
    print(f"nBaseTasks: {summary.get('nBaseTasks')}")
    print(f"nReplications: {summary.get('nReplications')}")
    for metric in ("tokenCoverage", "durationCoverage"):
        for condition in "ABCD":
            cell = summary.get(metric, {}).get(condition)
            value = cell.get("coveragePercentage") if cell else None
            print(f"{metric} {condition}: {value if value is not None else 'NOT_APPLICABLE'}")
    for key in ("classificationCoverage", "semanticEvidenceCoverage", "enforcementEvidenceCoverage"):
        print(f"{key}: {summary.get(key)}")
    print(f"foreignBatchArtifacts: {result.get('isolation', {}).get('foreignBatchArtifacts')}")
    print(f"EXECUTION_FAIL count: {summary.get('executionFailCount')}")
    print(f"EXECUTION_WARNING count: {summary.get('executionWarningCount')}")
    print(f"Execution report layout valid: {layout.get('status') == 'PASS'}")
    print(f"EXECUTION_REPORT_VALID: {result['EXECUTION_REPORT_VALID']}")
    print(f"READY_FOR_ANALYSIS: {result['READY_FOR_ANALYSIS']}")
    if result["status"] == "EXECUTION_REPORT_GENERATION_BLOCKED":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
