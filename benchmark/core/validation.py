"""Validação de qualidade dos dados experimentais do lote do BSH Benchmark.

Contratos estritos:
- Classificação categórica do lote: VALID, PARTIALLY_VALID, INVALID com justificativa detalhada.
- Decomposição em 5 subdimensões: executionCompleteness, telemetryCompleteness, classificationCompleteness, metadataCompleteness, reproducibilityCompleteness.
- Invariante estrita: sum(classificacoesDaCondicao) == execucoesDaCondicao.
- Proibição absoluta de placeholders (unknown, a1b2c3d4e5, ?, placeholder, example, dummy) em execuções reais.
- Geração dos artefatos data-quality.json, data-origin.json e telemetry-quality.json.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List

FORBIDDEN_PLACEHOLDERS = {"unknown", "a1b2c3d4e5", "?", "placeholder", "example", "dummy"}

CANONICAL_CLASSES = {
    "ALTERACAO_CORRETA", "ALTERACAO_INCORRETA", "BLOQUEIO_CORRETO", "FALSO_BLOQUEIO",
    "VIOLACAO_NAO_DETECTADA", "SEM_ALTERACAO_CORRETA", "SEM_ALTERACAO_INCORRETA",
    "SEM_ALTERACAO_INDETERMINADA", "REVISAO_HUMANA", "INDETERMINADO",
    "FALHA_TECNICA", "FALHA_INSTRUMENTACAO"
}


def _check_placeholders(obj: Any) -> List[str]:
    """Varre recursivamente uma estrutura em busca de placeholders proibidos."""
    found = []
    if isinstance(obj, str):
        val = obj.strip().lower()
        if val in FORBIDDEN_PLACEHOLDERS or any(fp in val for fp in ("a1b2c3d4e5", "placeholder", "dummy")):
            found.append(obj)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("failureMessage", "rawTelemetry", "diff"):
                continue
            found.extend(_check_placeholders(v))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_check_placeholders(item))
    return found


def validate_batch_data_quality(
    measurements: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    batch_metadata: Dict[str, Any],
    batch_dir: Path,
) -> Dict[str, Any]:
    """Avalia e exporta a integridade e qualidade experimental do lote (Seções 2, 5, 22, 24 e 25)."""
    batch_dir = Path(batch_dir)
    planned = int(batch_metadata.get("targetRuns") or len(batch_metadata.get("ordemExecucao", [])) or 40)
    observed = len(measurements)

    data_origin = str(batch_metadata.get("dataOrigin") or "REAL_EXECUTION")
    if (batch_dir / "data-origin.json").is_file():
        try:
            do_data = json.loads((batch_dir / "data-origin.json").read_text(encoding="utf-8"))
            data_origin = do_data.get("dataOrigin", data_origin)
        except Exception:
            pass

    complete_tok_pairs = sum(1 for p in paired if p.get("eligibleForTokenAnalysis"))
    complete_dur_pairs = sum(1 for p in paired if p.get("durationA") is not None and p.get("durationD") is not None)
    equiv_pairs = sum(1 for p in paired if p.get("behavioralEquivalence") == "EQUIVALENTE")
    gov_pairs = sum(1 for p in paired if p.get("eligibleForGovernanceAnalysis"))

    tech_failures = sum(1 for m in measurements if (m.get("classification") or m.get("classificacao")) == "FALHA_TECNICA")
    inst_failures = sum(1 for m in measurements if (m.get("classification") or m.get("classificacao")) == "FALHA_INSTRUMENTACAO")
    missing_telemetry = sum(1 for m in measurements if (m.get("totalTokens") is None and m.get("totais") is None) and (m.get("classification") != "FALHA_TECNICA"))

    conds_observed = {str(m.get("condicao") or m.get("condition") or "") for m in measurements if (m.get("condicao") or m.get("condition"))}
    planned_conds = set(batch_metadata.get("condicoes", ["A", "B", "C", "D"]))
    unavail_conds = sorted(list(planned_conds - conds_observed))

    reasons: List[str] = []

    # 1. executionCompleteness
    if observed == planned and observed > 0:
        exec_comp = "VALID"
    elif observed >= (planned * 0.5):
        exec_comp = "PARTIALLY_VALID"
        reasons.append(f"Amostra incompleta: {observed} execuções observadas de {planned} planejadas.")
    else:
        exec_comp = "INVALID"
        reasons.append(f"Amostra insuficiente: {observed} de {planned} planejadas.")

    # 2. telemetryCompleteness
    if missing_telemetry == 0 and observed > 0:
        tel_comp = "VALID"
    elif missing_telemetry <= (observed * 0.2):
        tel_comp = "PARTIALLY_VALID"
        reasons.append(f"{missing_telemetry} execução(ões) com telemetria ausente.")
    else:
        tel_comp = "INVALID"
        reasons.append(f"Alta taxa de telemetria ausente ({missing_telemetry}/{observed}).")

    # 3. classificationCompleteness e Invariante sum(classificacoesDaCondicao) == execucoesDaCondicao (Seção 4)
    class_comp = "VALID"
    total_classified = 0
    for c in sorted(conds_observed):
        c_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        valid_classified = sum(1 for m in c_runs if (m.get("classification") or m.get("classificacao")) in CANONICAL_CLASSES)
        total_classified += valid_classified
        if valid_classified != len(c_runs):
            class_comp = "INVALID"
            reasons.append(f"Invariante violada na Condição {c}: soma das classificações ({valid_classified}) != execuções ({len(c_runs)}).")

    classified_diff = observed - total_classified
    if classified_diff != 0:
        class_comp = "INVALID"
        reasons.append(f"Diferença entre execuções observadas ({observed}) e classificadas ({total_classified}) é {classified_diff} (deve ser zero).")

    # 4. metadataCompleteness (Seção 2)
    meta_comp = "VALID"
    if data_origin == "REAL_EXECUTION":
        found_placeholders = _check_placeholders(batch_metadata.get("hashes", {})) + _check_placeholders({
            k: v for k, v in batch_metadata.items() if k not in ("ordemExecucao", "executions")
        })
        if found_placeholders:
            meta_comp = "INVALID"
            reasons.append(f"Placeholders ou valores de exemplo proibidos em execução real: {', '.join(set(found_placeholders))}.")

    # 5. reproducibilityCompleteness (Seção 2)
    hashes = batch_metadata.get("hashes", {})
    required_hashes = ["repositoryCommit", "bshProductTreeHash", "benchmarkTreeHash", "pilotHash", "ontologyHash", "shapesHash", "taskManifestHash"]
    missing_hashes = [h for h in required_hashes if not hashes.get(h)]
    if not missing_hashes:
        repro_comp = "VALID"
    else:
        repro_comp = "PARTIALLY_VALID" if len(missing_hashes) <= 2 else "INVALID"
        reasons.append(f"Metadados de reprodutibilidade ausentes: {', '.join(missing_hashes)}.")

    # 6. pairingCompleteness (Seção 3)
    if len(paired) >= 2 and complete_tok_pairs >= 2:
        pair_comp = "VALID"
    elif len(paired) > 0:
        pair_comp = "PARTIALLY_VALID"
        reasons.append("Pares de execução incompletos para comparação causal A x D.")
    else:
        pair_comp = "INVALID"
        reasons.append("Nenhum par A x D formado no lote.")

    # 7. semanticEvidenceCompleteness (Seção 3)
    sem_ops_checked = any(m.get("taskType") in ("valida_governada", "violadora") for m in measurements)
    if sem_ops_checked and gov_pairs >= 2:
        sem_comp = "VALID"
    elif sem_ops_checked:
        sem_comp = "PARTIALLY_VALID"
    else:
        sem_comp = "INVALID"
        reasons.append("Evidências semânticas e shapes não observáveis no lote.")

    if tech_failures > 0:
        reasons.append(f"{tech_failures} falha(s) técnica(s) detectada(s).")
    if inst_failures > 0:
        reasons.append(f"{inst_failures} falha(s) de instrumentação detectada(s).")
    if unavail_conds:
        reasons.append(f"Condições não observadas: {', '.join(unavail_conds)}.")

    # Status Global (Seção 3)
    if (exec_comp == "VALID" and tel_comp == "VALID" and class_comp == "VALID"
            and meta_comp == "VALID" and repro_comp == "VALID" and pair_comp == "VALID"
            and sem_comp == "VALID" and tech_failures == 0 and inst_failures == 0 and classified_diff == 0):
        batch_status = "VALID"
        summary_msg = "Lote experimental íntegro e em total conformidade metodológica multidimensional."
    elif class_comp != "INVALID" and meta_comp != "INVALID" and complete_tok_pairs >= 2 and observed >= (planned * 0.5):
        batch_status = "PARTIALLY_VALID"
        summary_msg = f"Lote parcialmente válido: {'; '.join(reasons)}"
    else:
        batch_status = "INVALID"
        summary_msg = f"Lote inválido para inferência científica: {'; '.join(reasons)}"

    quality_report = {
        "status": batch_status,
        "overallBatchStatus": batch_status,
        "summary": summary_msg,
        "executionCompleteness": exec_comp,
        "telemetryCompleteness": tel_comp,
        "classificationCompleteness": class_comp,
        "metadataCompleteness": meta_comp,
        "reproducibilityCompleteness": repro_comp,
        "pairingCompleteness": pair_comp,
        "semanticEvidenceCompleteness": sem_comp,
        "runsPlanned": planned,
        "runsObserved": observed,
        "runsClassified": total_classified,
        "runsDifference": classified_diff,
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

    # Salva data-quality.json
    (batch_dir / "data-quality.json").write_text(json.dumps(quality_report, indent=2, ensure_ascii=False), encoding="utf-8")

    # Salva data-origin.json (Seção 2 e 49)
    origin_report = {
        "dataOrigin": data_origin,
        "batchId": batch_metadata.get("lote", batch_dir.name),
        "description": "Execução real da campanha experimental no piloto" if data_origin == "REAL_EXECUTION" else "Fixture sintética para validação da infraestrutura do benchmark",
        "isSynthetic": (data_origin == "SYNTHETIC_FIXTURE"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    (batch_dir / "data-origin.json").write_text(json.dumps(origin_report, indent=2, ensure_ascii=False), encoding="utf-8")

    # Salva telemetry-quality.json (Seção 22 e 49)
    by_cond_tel: Dict[str, Any] = {}
    for c in sorted(conds_observed):
        c_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        valid_tot = sum(1 for m in c_runs if (m.get("totalTokens") is not None or m.get("totais") is not None))
        valid_nc = sum(1 for m in c_runs if (m.get("nonCachedTokens") is not None or m.get("tokensNaoCache") is not None))
        by_cond_tel[c] = {
            "totalRuns": len(c_runs),
            "validTotalTokensRuns": valid_tot,
            "validNonCachedTokensRuns": valid_nc,
            "missingTotalTokensRuns": len(c_runs) - valid_tot,
            "totalTokensCompletenessRate": (valid_tot / len(c_runs)) if len(c_runs) > 0 else 0.0,
            "nonCachedTokensCompletenessRate": (valid_nc / len(c_runs)) if len(c_runs) > 0 else 0.0,
        }

    telemetry_report = {
        "overallStatus": tel_comp,
        "totalRunsObserved": observed,
        "runsWithValidTokens": sum(1 for m in measurements if (m.get("totalTokens") is not None or m.get("totais") is not None)),
        "runsWithValidNonCachedTokens": sum(1 for m in measurements if (m.get("nonCachedTokens") is not None or m.get("tokensNaoCache") is not None)),
        "byCondition": by_cond_tel,
    }
    (batch_dir / "telemetry-quality.json").write_text(json.dumps(telemetry_report, indent=2, ensure_ascii=False), encoding="utf-8")

    return quality_report
