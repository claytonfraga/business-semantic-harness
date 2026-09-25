"""Validação de qualidade dos dados experimentais do lote do BSH Benchmark.

Contratos estritos:
- Classificação categórica do lote: VALID, PARTIALLY_VALID, INVALID com justificativa detalhada.
- Geração formal do artefato data-quality.json.
"""

import json
from pathlib import Path
from typing import Any, Dict, List


def validate_batch_data_quality(
    measurements: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    batch_metadata: Dict[str, Any],
    batch_dir: Path,
) -> Dict[str, Any]:
    """Avalia e exporta a integridade e qualidade experimental do lote (Requirement 45)."""
    planned = int(batch_metadata.get("targetRuns") or len(batch_metadata.get("ordemExecucao", [])) or 40)
    observed = len(measurements)

    complete_tok_pairs = sum(1 for p in paired if p.get("eligibleForTokenAnalysis"))
    complete_dur_pairs = sum(1 for p in paired if p.get("durationA") is not None and p.get("durationD") is not None)
    equiv_pairs = sum(1 for p in paired if p.get("behavioralEquivalence") == "EQUIVALENTE")
    gov_pairs = sum(1 for p in paired if p.get("eligibleForGovernanceAnalysis"))

    tech_failures = sum(1 for m in measurements if (m.get("classification") or m.get("classificacao")) == "FALHA_TECNICA")
    inst_failures = sum(1 for m in measurements if (m.get("classification") or m.get("classificacao")) == "FALHA_INSTRUMENTACAO")
    missing_telemetry = sum(1 for m in measurements if (m.get("totalTokens") is None and m.get("totais") is None) and (m.get("classification") != "FALHA_TECNICA"))

    conds_observed = {str(m.get("condicao") or m.get("condition") or "") for m in measurements}
    planned_conds = set(batch_metadata.get("condicoes", ["A", "B", "C", "D"]))
    unavail_conds = sorted(list(planned_conds - conds_observed))

    # Determinação de status
    reasons: List[str] = []
    if observed < planned:
        reasons.append(f"Amostra incompleta: {observed} execuções observadas de {planned} planejadas.")
    if tech_failures > 0:
        reasons.append(f"{tech_failures} falha(s) técnica(s) detectada(s).")
    if inst_failures > 0:
        reasons.append(f"{inst_failures} falha(s) de instrumentação detectada(s).")
    if missing_telemetry > 0:
        reasons.append(f"{missing_telemetry} execução(ões) com telemetria de tokens ausente.")
    if unavail_conds:
        reasons.append(f"Condições não observadas: {', '.join(unavail_conds)}.")

    if not reasons:
        batch_status = "VALID"
        summary_msg = "Lote experimental íntegro e em total conformidade metodológica."
    elif complete_tok_pairs >= 2 and observed >= (planned * 0.5):
        batch_status = "PARTIALLY_VALID"
        summary_msg = f"Lote parcialmente válido: {'; '.join(reasons)}"
    else:
        batch_status = "INVALID"
        summary_msg = f"Lote inválido para inferência científica: {'; '.join(reasons)}"

    quality_report = {
        "status": batch_status,
        "summary": summary_msg,
        "runsPlanned": planned,
        "runsObserved": observed,
        "completeTokenPairs": complete_tok_pairs,
        "completeDurationPairs": complete_dur_pairs,
        "behaviorallyEquivalentPairs": equiv_pairs,
        "governanceEligiblePairs": gov_pairs,
        "technicalFailures": tech_failures,
        "instrumentationFailures": inst_failures,
        "missingTelemetry": missing_telemetry,
        "unavailableConditions": unavail_conds,
        "reasons": reasons,
    }

    batch_dir = Path(batch_dir)
    (batch_dir / "data-quality.json").write_text(json.dumps(quality_report, indent=2, ensure_ascii=False), encoding="utf-8")
    return quality_report
