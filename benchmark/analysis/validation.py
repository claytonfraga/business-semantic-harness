"""Validação da integridade e qualidade dos dados experimentais do BSH Benchmark.

Contratos estritos:
- Separação explícita entre VALID, PARTIALLY_VALID e INVALID.
- Lista estruturada de problemas e diagnósticos.
- Mapeamento formal da disponibilidade de telemetria por condição.
- Exportação de data-quality.json no diretório do lote.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional


def validate_benchmark_batch(batch_dir: Path, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Valida integralmente o lote experimental e gera o artefato data-quality.json."""
    batch_dir = Path(batch_dir)
    issues: List[Dict[str, str]] = []

    # 1. Carrega ou recebe dados
    if data is None:
        from .load_data import load_dataset
        data = load_dataset(batch_dir)

    metadata = data.get("metadata", {})
    tasks_list = data.get("tasks", [])
    measurements = data.get("measurements", [])

    planned_task_ids = [t["id"] for t in tasks_list if isinstance(t, dict) and "id" in t]
    if not planned_task_ids:
        # Padrão conhecido de 10 tarefas do piloto se tasks.json não listava explicitamente
        planned_task_ids = ["V1", "V2", "V3", "V4", "V5", "G1", "G2", "G3", "I1", "U1"]
        issues.append({
            "level": "WARNING",
            "code": "TASKS_DEFAULTED",
            "message": "Lista de tarefas planejadas não encontrada em tasks.json; adotadas 10 tarefas padrão."
        })

    # 2. Execuções observadas
    observed_runs_count = len(measurements)
    if observed_runs_count == 0:
        issues.append({
            "level": "ERROR",
            "code": "NO_MEASUREMENTS",
            "message": "Nenhuma medição observada no diretório do lote."
        })
        status = "INVALID"
        quality_report = {
            "status": status,
            "batchId": metadata.get("lote", batch_dir.name),
            "plannedTasksCount": len(planned_task_ids),
            "observedRunsCount": 0,
            "completeTokenPairsCount": 0,
            "completeDurationPairsCount": 0,
            "conditionsPlanned": metadata.get("conditionsPlanned", ["A", "D"]),
            "conditionsExecuted": [],
            "issues": issues,
            "telemetryAvailability": {},
            "exclusions": [],
        }
        (batch_dir / "data-quality.json").write_text(json.dumps(quality_report, indent=2, ensure_ascii=False), encoding="utf-8")
        return quality_report

    # 3. Tarefas e condições observadas
    observed_task_ids = sorted({str(m.get("tarefa") or "").split("-")[0] for m in measurements if m.get("tarefa")})
    observed_conditions = sorted({str(m.get("condicao", "")) for m in measurements if m.get("condicao")})

    missing_tasks = [tid for tid in planned_task_ids if tid not in observed_task_ids]
    if missing_tasks:
        issues.append({
            "level": "WARNING",
            "code": "MISSING_TASKS",
            "message": f"{len(missing_tasks)} tarefa(s) planejada(s) não foram observadas: {', '.join(missing_tasks)}."
        })

    # 4. Disponibilidade de telemetria por condição
    telemetry_by_cond: Dict[str, Dict[str, Any]] = {}
    for c in observed_conditions:
        sub = [m for m in measurements if str(m.get("condicao", "")) == c]
        n_c = len(sub)
        tok_ok = sum(1 for m in sub if m.get("totais") is not None)
        cac_ok = sum(1 for m in sub if m.get("cache") is not None or m.get("cachedInputTokens") is not None)
        rac_ok = sum(1 for m in sub if m.get("raciocinio") is not None or m.get("reasoningTokens") is not None)
        dur_ok = sum(1 for m in sub if m.get("tempo") is not None or m.get("durationSeconds") is not None)
        cs_ok = sum(1 for m in sub if m.get("changeSetDetected") or (m.get("arquivos", 0) or 0) > 0)
        enf_ok = sum(1 for m in sub if m.get("statusEnforcement") is not None or m.get("enforcementStatus") is not None)

        telemetry_by_cond[c] = {
            "totalRuns": n_c,
            "tokensAvailable": tok_ok,
            "tokensCoveragePct": (tok_ok / n_c * 100.0) if n_c else 0.0,
            "cacheAvailable": cac_ok,
            "reasoningAvailable": rac_ok,
            "durationAvailable": dur_ok,
            "durationCoveragePct": (dur_ok / n_c * 100.0) if n_c else 0.0,
            "changeSetAvailable": cs_ok,
            "enforcementAvailable": enf_ok,
        }

        if tok_ok == 0:
            issues.append({
                "level": "WARNING",
                "code": f"NO_TOKENS_CONDITION_{c}",
                "message": f"Condição '{c}' não possui telemetria de tokens em nenhuma das {n_c} execuções observadas."
            })

    # 5. Pares completos e exclusões (suporta múltiplas rodadas)
    counts: Dict[str, Dict[str, int]] = {}
    by_task: Dict[str, Dict[str, Any]] = {}
    ordered_pair_keys: List[str] = []

    for m in measurements:
        raw_tid = str(m.get("tarefa") or "").split("-")[0]
        c = str(m.get("condicao", ""))
        counts.setdefault(raw_tid, {})
        curr_rep = counts[raw_tid].get(c, 0) + 1
        counts[raw_tid][c] = curr_rep
        pair_key = f"{raw_tid}#{curr_rep}" if curr_rep > 1 else raw_tid
        if pair_key not in ordered_pair_keys:
            ordered_pair_keys.append(pair_key)
        by_task.setdefault(pair_key, {})[c] = m

    for tid in planned_task_ids:
        if tid not in ordered_pair_keys:
            ordered_pair_keys.append(tid)

    complete_token_pairs = 0
    complete_duration_pairs = 0
    exclusions: List[Dict[str, str]] = []

    for pair_id in ordered_pair_keys:
        c_map = by_task.get(pair_id, {})
        m_a = c_map.get("A") or c_map.get("sem-harness")
        m_d = c_map.get("D") or c_map.get("com-harness")

        if not m_a or not m_d:
            missing_conds = []
            if not m_a: missing_conds.append("A")
            if not m_d: missing_conds.append("D")
            exclusions.append({
                "taskId": pair_id,
                "reason": f"Condição(ões) não executada(s): {', '.join(missing_conds)}."
            })
            continue

        tok_a = m_a.get("totais") if m_a.get("totais") is not None else m_a.get("totalTokens")
        tok_d = m_d.get("totais") if m_d.get("totais") is not None else m_d.get("totalTokens")

        dur_a = m_a.get("tempo") if m_a.get("tempo") is not None else m_a.get("durationSeconds")
        dur_d = m_d.get("tempo") if m_d.get("tempo") is not None else m_d.get("durationSeconds")

        if tok_a is not None and tok_d is not None:
            complete_token_pairs += 1
        else:
            reasons = []
            if tok_a is None: reasons.append("tokens ausentes em A")
            if tok_d is None: reasons.append("tokens ausentes em D")
            exclusions.append({
                "taskId": pair_id,
                "reason": f"Telemetria incompleta para análise de tokens ({', '.join(reasons)})."
            })

        if dur_a is not None and dur_d is not None:
            complete_duration_pairs += 1

    # 6. Avaliação final do status do lote
    total_expected_pairs = len(ordered_pair_keys)
    if len(missing_tasks) == 0 and complete_token_pairs >= len(planned_task_ids) and complete_token_pairs == total_expected_pairs:
        status = "VALID"
    elif observed_runs_count > 0:
        status = "PARTIALLY_VALID"
        issues.append({
            "level": "INFO",
            "code": "PARTIAL_BATCH",
            "message": f"Lote parcialmente válido: {len(observed_task_ids)}/{len(planned_task_ids)} tarefas observadas; {complete_token_pairs} pares de tokens completos."
        })
    else:
        status = "INVALID"

    quality_report = {
        "status": status,
        "batchId": metadata.get("lote", batch_dir.name),
        "plannedTasksCount": len(planned_task_ids),
        "observedTasksCount": len(observed_task_ids),
        "observedRunsCount": observed_runs_count,
        "completeTokenPairsCount": complete_token_pairs,
        "completeDurationPairsCount": complete_duration_pairs,
        "conditionsPlanned": metadata.get("conditionsPlanned", ["A", "D"]),
        "conditionsExecuted": observed_conditions,
        "telemetryAvailability": telemetry_by_cond,
        "exclusions": exclusions,
        "issues": issues,
    }

    (batch_dir / "data-quality.json").write_text(json.dumps(quality_report, indent=2, ensure_ascii=False), encoding="utf-8")
    return quality_report
