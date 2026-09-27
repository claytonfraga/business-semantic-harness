#!/usr/bin/env python3
"""Compatibility entry point for the single Experimental Analysis pipeline.

This command analyzes an existing, frozen Experimental Execution. It does not
start an agent, repair raw evidence, or borrow files from the active benchmark.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmark.core.scientific_pipeline import analyze_experimental_execution


def reprocess_batch(batch_id_or_path: str | Path) -> dict:
    return analyze_experimental_execution(batch_id_or_path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Uso: python -m benchmark.reprocess_batch ANALYSIS_BATCH_ID")
    print(json.dumps(reprocess_batch(sys.argv[1]), ensure_ascii=False, indent=2))
