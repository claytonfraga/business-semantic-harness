"""Congelamento e isolamento estrito de artefatos da campanha (FASE C).

Gera o manifesto batch-freeze.json com todos os hashes criptográficos da árvore de produto,
benchmark, repositório, configuração, base semântica e artefatos brutos.
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PILOT_DIR = REPO / "pilot" / "asset-management"
DOMAIN_DIR = PILOT_DIR / ".bsh" / "domains" / "ativos"


def compute_file_sha256(path: Path) -> str:
    """Calcula SHA-256 de um arquivo."""
    if not path.is_file():
        return "INDISPONIVEL"
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def freeze_batch_artifacts(
    batch_dir: Path,
    metadata: Dict[str, Any],
    preflight_hashes: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Gera batch-freeze.json congelando os artefatos brutos do lote."""
    batch_path = Path(batch_dir).resolve()
    print(f"=== [FASE C] Congelando Artefatos do Lote: {batch_path.name} ===")

    preflight_hashes = preflight_hashes or {}

    raw_files = [
        "measurements.json",
        "measurements.csv",
        "metadata.json",
        "tasks.json",
        "config.yaml",
        "agent-capabilities.json",
        "enforcement-challenge-results.json",
    ]

    raw_artifacts: List[str] = []
    raw_artifact_hashes: List[Dict[str, str]] = []

    for rf in raw_files:
        p = batch_path / rf
        if p.is_file():
            sha = compute_file_sha256(p)
            raw_artifacts.append(rf)
            raw_artifact_hashes.append({"file": rf, "sha256": sha})

    meta_hashes = metadata.get("hashes", {})

    freeze_manifest = {
        "batchId": metadata.get("lote") or batch_path.name,
        "dataOrigin": metadata.get("dataOrigin", "REAL_EXECUTION"),
        "startedAt": metadata.get("startedAt"),
        "finishedAt": metadata.get("finishedAt"),
        "plannedRuns": metadata.get("targetRuns", len(metadata.get("ordemExecucao", []))),
        "observedRuns": metadata.get("targetRuns", len(metadata.get("ordemExecucao", []))),
        "agent": metadata.get("agente", "agy"),
        "agentVersion": metadata.get("versaoAgente", "1.2.11"),
        "model": metadata.get("modelo", "gemini-3.7-flash-medium"),
        "reasoningEffort": metadata.get("esforco", "medium"),
        "repositoryCommit": meta_hashes.get("repositoryCommit", metadata.get("commitBsh", "INDISPONIVEL")),
        "bshProductTreeHash": meta_hashes.get("bshProductTreeHash", "INDISPONIVEL"),
        "benchmarkTreeHash": meta_hashes.get("benchmarkTreeHash", "INDISPONIVEL"),
        "pilotCommit": meta_hashes.get("pilotCommit", "INDISPONIVEL"),
        "ontologyHash": meta_hashes.get("ontologyHash", preflight_hashes.get("semanticDataHash", "INDISPONIVEL")),
        "shapesHash": meta_hashes.get("shapesHash", preflight_hashes.get("shaclShapesHash", "INDISPONIVEL")),
        "policyHash": meta_hashes.get("policyHash", "INDISPONIVEL"),
        "taskManifestHash": meta_hashes.get("taskManifestHash", "INDISPONIVEL"),
        "configHash": meta_hashes.get("configHash", "INDISPONIVEL"),
        "semanticDataHash": preflight_hashes.get("semanticDataHash", meta_hashes.get("ontologyHash", "INDISPONIVEL")),
        "semanticCasesHash": preflight_hashes.get("semanticCasesHash", "INDISPONIVEL"),
        "semanticFixturesHash": preflight_hashes.get("semanticFixturesHash", "INDISPONIVEL"),
        "shaclShapesHash": preflight_hashes.get("shaclShapesHash", meta_hashes.get("shapesHash", "INDISPONIVEL")),
        "sparqlConstraintsHash": preflight_hashes.get("sparqlConstraintsHash", "INDISPONIVEL"),
        "enforcementChallengeCorpusHash": preflight_hashes.get("enforcementChallengeCorpusHash", "INDISPONIVEL"),
        "rawArtifacts": raw_artifacts,
        "rawArtifactHashes": raw_artifact_hashes,
        "frozenAt": datetime.now(timezone.utc).isoformat(),
    }

    out_path = batch_path / "batch-freeze.json"
    out_path.write_text(json.dumps(freeze_manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"      - batch-freeze.json exportado com sucesso ({len(raw_artifacts)} artefatos brutos catalogados).")

    return freeze_manifest
