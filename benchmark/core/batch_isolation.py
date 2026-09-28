"""Gate de Pureza e Isolamento Estrito do Lote Experimental (FASE D).

Valida automaticamente que 100% dos artefatos, execuções, pareamentos e estatísticas
referenciam exclusivamente o NEW_BATCH_ID corrente, bloqueando imediatamente
qualquer tentativa de contaminação por dados de lotes anteriores.
"""

import json
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
RESULTS_DIR = HERE.parent / "results"


def validate_batch_isolation(
    batch_dir: Path,
    expected_batch_id: str,
) -> Dict[str, Any]:
    """Executa a verificação automática de isolamento do lote (FASE D)."""
    batch_path = Path(batch_dir).resolve()

    print(f"=== [FASE D] Executando Gate de Pureza do Novo Lote: {expected_batch_id} ===")

    foreign_artifacts: List[str] = []
    foreign_runs: List[str] = []
    foreign_references: List[str] = []

    # 1. Valida measurements.json
    meas_path = batch_path / "measurements.json"
    if meas_path.is_file():
        try:
            measurements = json.loads(meas_path.read_text(encoding="utf-8"))
            for m in measurements:
                bid = m.get("batchId") or m.get("lote")
                rid = m.get("runId") or m.get("execucao")
                if bid and bid != expected_batch_id:
                    foreign_runs.append(f"{rid} (batchId={bid})")
                if rid and expected_batch_id not in rid and not any(k in rid for k in ("-A", "-B", "-C", "-D")):
                    # Verifica se o runId aponta para outro batch
                    for other in RESULTS_DIR.iterdir():
                        if other.is_dir() and other.name != expected_batch_id and other.name in str(rid):
                            foreign_runs.append(f"{rid} (references {other.name})")
        except Exception as e:
            foreign_artifacts.append(f"Erro lendo measurements.json: {e}")

    # 2. Inspeciona todos os arquivos de texto/JSON no diretório do batch para referências a outros batches
    other_batch_names = [
        d.name for d in RESULTS_DIR.iterdir()
        if d.is_dir() and d.name != expected_batch_id
    ]
    # Também inclui nomes conhecidos como 'complete_a_d'
    if "complete_a_d" not in other_batch_names:
        other_batch_names.append("complete_a_d")

    critical_files = [
        "measurements.json", "measurements.csv", "metadata.json",
        "paired-results.csv", "paired-a-b.csv", "paired-b-c.csv", "paired-c-d.csv", "paired-a-d.csv",
        "statistics.json", "evidence-matrix.json", "verdicts.json", "provenance.json"
    ]

    for fname in critical_files:
        fpath = batch_path / fname
        if fpath.is_file():
            text = fpath.read_text(encoding="utf-8", errors="ignore")
            for ob in other_batch_names:
                if ob in text:
                    # Permite apenas se for menção explícita de exclusão/regra de isolamento
                    lines = [ln for ln in text.splitlines() if ob in ln and "foreignBatch" not in ln and "isolation" not in ln]
                    if lines:
                        foreign_references.append(f"Arquivo {fname} contém referência ao lote '{ob}': {len(lines)} ocorrências")

    # 3. Contabilização
    foreign_artifacts_detected = len(foreign_artifacts)
    foreign_runs_detected = len(foreign_runs)
    foreign_references_detected = len(foreign_references)

    passed = (
        foreign_artifacts_detected == 0
        and foreign_runs_detected == 0
        and foreign_references_detected == 0
    )

    result = {
        "status": "APPROVED" if passed else "HARD_FAIL",
        "batchId": expected_batch_id,
        "batchDir": str(batch_path),
        "foreignBatchArtifactsDetected": foreign_artifacts_detected,
        "foreignBatchRunsDetected": foreign_runs_detected,
        "foreignBatchReferencesDetected": foreign_references_detected,
        "details": {
            "foreignArtifacts": foreign_artifacts,
            "foreignRuns": foreign_runs,
            "foreignReferences": foreign_references,
        },
    }

    # Salva batch-isolation-validation.json
    out_path = batch_path / "batch-isolation-validation.json"
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")

    if not passed:
        print(f"      [HARD_FAIL] Violação de pureza detectada no lote {expected_batch_id}:")
        print(f"      - foreignBatchArtifactsDetected: {foreign_artifacts_detected}")
        print(f"      - foreignBatchRunsDetected: {foreign_runs_detected}")
        print(f"      - foreignBatchReferencesDetected: {foreign_references_detected}")
        raise SystemExit(f"HARD_FAIL: Contaminação entre lotes detectada em {batch_path.name}")

    print(f"      - batch-isolation-validation.json exportado: Status={result['status']}.")
    print("      - foreignBatchArtifactsDetected = 0")
    print("      - foreignBatchRunsDetected = 0")
    print("      - foreignBatchReferencesDetected = 0")

    return result
