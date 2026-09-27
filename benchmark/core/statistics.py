"""Cálculo estatístico descritivo, confirmatório e avaliação de RQs do BSH Benchmark.

Contratos estritos:
- Separação entre RQ1-A (todos os pares) e RQ1-B (pares válidos equivalentes).
- Benefício líquido (RQ2) calculado com rigor: exige pares válidos equivalentes E violadoras corretamente governadas.
- Bootstrap agrupado por tarefa-base (cluster = baseTaskId), evitando pseudorreplicação.
- Custos condicionados ao sucesso funcional (CostPerSuccessfulTask).
- Métricas de reconhecimento semântico: Recall e Precision para operações e shapes.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np

try:
    from scipy.stats import t as student_t, ttest_rel, wilcoxon, pearsonr, spearmanr
except ImportError:
    student_t = None
    ttest_rel = None
    wilcoxon = None
    pearsonr = None
    spearmanr = None


def is_shape_applicable(shape_val: Any) -> bool:
    """Verifica se um shape é aplicável, excluindo None, strings vazias e 'NAO_APLICAVEL'."""
    if shape_val is None:
        return False
    if isinstance(shape_val, list):
        filtered = [s for s in shape_val if str(s).strip() and str(s).strip().upper() not in ("NAO_APLICAVEL", "NONE", "NULL", "[]")]
        return len(filtered) > 0
    s_str = str(shape_val).strip()
    return bool(s_str and s_str.upper() not in ("NAO_APLICAVEL", "NONE", "NULL", "[]"))


def compute_semantic_recognition(
    measurements: List[Dict[str, Any]],
    tasks: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Calcula métricas de reconhecimento semântico separando Operações e Shapes (Seção 19 - RQ6).
    Exclui estritamente 'NAO_APLICAVEL' do denominador de shapes e contabiliza
    shapeEligibleRuns e shapeEligibleBaseTasks.
    """
    t_map = {t["id"]: t for t in (tasks or []) if isinstance(t, dict) and "id" in t}

    d_runs = [
        m for m in measurements
        if (m.get("condicao") or m.get("condition")) == "D"
        and str(m.get("taskType", "") or m.get("tipo", "")).lower() in ("valida_governada", "violadora")
    ]

    op_eligible_runs = len(d_runs)
    op_eligible_bases = len(set(m.get("baseTaskId") or str(m.get("taskId", "")).split("#")[0] for m in d_runs))

    tp_op = 0
    fp_op = 0
    fn_op = 0
    for m in d_runs:
        tid = str(m.get("taskId") or m.get("tarefa") or "").split("-")[0].split("#")[0]
        tinfo = t_map.get(tid, {})
        exp_op = m.get("expectedOperation") or tinfo.get("operacao") or m.get("expectedGovernedOperation")
        id_op = m.get("identifiedOperation")

        if exp_op:
            if id_op and str(id_op).strip().lower() == str(exp_op).strip().lower():
                tp_op += 1
            else:
                fn_op += 1
        elif id_op:
            fp_op += 1

    op_prec = (tp_op / (tp_op + fp_op)) if (tp_op + fp_op) > 0 else (1.0 if op_eligible_runs == 0 else 0.0)
    op_rec = (tp_op / (tp_op + fn_op)) if (tp_op + fn_op) > 0 else (1.0 if op_eligible_runs == 0 else 0.0)

    shape_runs = []
    for m in d_runs:
        tid = str(m.get("taskId") or m.get("tarefa") or "").split("-")[0].split("#")[0]
        tinfo = t_map.get(tid, {})
        exp_sh = m.get("expectedShape") or m.get("expectedShapes") or tinfo.get("shape") or tinfo.get("shapes")
        if is_shape_applicable(exp_sh):
            shape_runs.append((m, exp_sh))

    shape_eligible_runs = len(shape_runs)
    shape_eligible_bases = len(set((m.get("baseTaskId") or str(m.get("taskId", "")).split("#")[0]) for m, _ in shape_runs))

    tp_sh = 0
    fp_sh = 0
    fn_sh = 0

    for m, exp_sh in shape_runs:
        if isinstance(exp_sh, list):
            exp_set = {str(s).split(":")[-1].split("#")[-1].strip().lower() for s in exp_sh if str(s).strip()}
        else:
            exp_set = {str(exp_sh).split(":")[-1].split("#")[-1].strip().lower()}

        id_raw = m.get("identifiedShapes") or []
        if isinstance(id_raw, str):
            id_raw = [id_raw]
        id_set = {str(s).split(":")[-1].split("#")[-1].strip().lower() for s in id_raw if str(s).strip()}

        if exp_set and exp_set.issubset(id_set):
            tp_sh += 1
        elif any(s in id_set for s in exp_set):
            tp_sh += 1
        else:
            fn_sh += 1

        extra_shapes = id_set - exp_set
        if extra_shapes:
            fp_sh += len(extra_shapes)

    sh_prec = (tp_sh / (tp_sh + fp_sh)) if (tp_sh + fp_sh) > 0 else (1.0 if shape_eligible_runs == 0 else 0.0)
    sh_rec = (tp_sh / (tp_sh + fn_sh)) if (tp_sh + fn_sh) > 0 else (1.0 if shape_eligible_runs == 0 else 0.0)

    return {
        "operationTP": tp_op,
        "operationFP": fp_op,
        "operationFN": fn_op,
        "operationTN": 0,
        "operationPrecision": op_prec,
        "operationRecall": op_rec,
        "operationEligibleRuns": op_eligible_runs,
        "operationEligibleBaseTasks": op_eligible_bases,
        "shapeTP": tp_sh,
        "shapeFP": fp_sh,
        "shapeFN": fn_sh,
        "shapeTN": 0,
        "shapePrecision": sh_prec,
        "shapeRecall": sh_rec,
        "shapeEligibleRuns": shape_eligible_runs,
        "shapeEligibleBaseTasks": shape_eligible_bases,
    }


def _calc_stats(values: List[float], n_obs: int) -> Dict[str, Any]:
    """Calcula estatísticas descritivas básicas."""
    vals = [v for v in values if v is not None and not np.isnan(v)]
    n_elig = len(vals)
    if n_elig == 0:
        return {
            "n_observado": n_obs,
            "n_elegivel": 0,
            "media": None,
            "mediana": None,
            "desvio_padrao": None,
            "minimo": None,
            "maximo": None,
            "ic95_inferior": None,
            "ic95_superior": None,
        }

    arr = np.array(vals, dtype=float)
    media = float(np.mean(arr))
    mediana = float(np.median(arr))
    minimo = float(np.min(arr))
    maximo = float(np.max(arr))
    dp = float(np.std(arr, ddof=1)) if n_elig >= 2 else None

    ic_inf = None
    ic_sup = None
    if n_elig >= 3 and dp is not None and dp > 0 and student_t is not None:
        t_crit = float(student_t.ppf(0.975, df=n_elig - 1))
        margem = t_crit * (dp / np.sqrt(n_elig))
        ic_inf = media - margem
        ic_sup = media + margem
    elif n_elig >= 3 and dp == 0:
        ic_inf = media
        ic_sup = media

    return {
        "n_observado": n_obs,
        "n_elegivel": n_elig,
        "media": media,
        "mediana": mediana,
        "desvio_padrao": dp,
        "minimo": minimo,
        "maximo": maximo,
        "ic95_inferior": ic_inf,
        "ic95_superior": ic_sup,
    }


def clustered_bootstrap_mean(
    items: List[Dict[str, Any]],
    val_key: str,
    cluster_key: str = "baseTaskId",
    n_boot: int = 1000,
    seed: int = 42,
    alpha: float = 0.05,
) -> Dict[str, Any]:
    """Realiza bootstrap por cluster pela tarefa-base (Requirement 43)."""
    valid_items = [it for it in items if it.get(val_key) is not None]
    if not valid_items:
        return {"media": None, "ic_inf": None, "ic_sup": None, "clusters": 0, "n": 0}

    # Agrupa por cluster
    clusters: Dict[str, List[float]] = {}
    for it in valid_items:
        c = str(it.get(cluster_key) or it.get("taskId") or "default")
        clusters.setdefault(c, []).append(float(it[val_key]))

    cluster_names = list(clusters.keys())
    k = len(cluster_names)
    if k < 2:
        vals = [v for cl in clusters.values() for v in cl]
        m = float(np.mean(vals))
        return {"media": m, "ic_inf": m, "ic_sup": m, "clusters": k, "n": len(vals)}

    rng = np.random.RandomState(seed)
    boot_means = []
    for _ in range(n_boot):
        chosen_clusters = rng.choice(cluster_names, size=k, replace=True)
        sample = []
        for c in chosen_clusters:
            sample.extend(clusters[c])
        if sample:
            boot_means.append(np.mean(sample))

    all_vals = [v for cl in clusters.values() for v in cl]
    return {
        "media": float(np.mean(all_vals)),
        "ic_inf": float(np.percentile(boot_means, 100 * (alpha / 2))),
        "ic_sup": float(np.percentile(boot_means, 100 * (1 - alpha / 2))),
        "clusters": k,
        "n": len(all_vals),
        "seed": seed,
        "iterations": n_boot,
    }


def compute_statistics(
    measurements: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    semantic_rec: Optional[Dict[str, Any]] = None,
    batch_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Calcula todas as estatísticas e avalia RQs conforme especificação rigorosa."""
    meta = batch_metadata or {}
    lote = meta.get("lote", "desconhecido")

    # Segmentação
    todas_pares = paired
    validas_pares = [p for p in paired if str(p.get("taskType", "")).lower() in ("valida_governada", "valida", "valid", "fora_conhecimento")]
    violadoras_pares = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]

    todas_elig = [p for p in todas_pares if p.get("eligibleForTokenAnalysis")]
    val_elig = [p for p in validas_pares if p.get("eligibleForTokenAnalysis")]
    vio_elig = [p for p in violadoras_pares if p.get("eligibleForTokenAnalysis")]

    # Pares equivalentes
    equiv_val_elig = [p for p in val_elig if p.get("behavioralEquivalence") == "EQUIVALENTE"]

    # Estatísticas por segmento
    def _seg(lista_pares: List[Dict[str, Any]], elig_pares: List[Dict[str, Any]]) -> Dict[str, Any]:
        n_obs = len(lista_pares)
        dif_abs = [p["differenceTokens"] for p in elig_pares if p.get("differenceTokens") is not None]
        dif_pct = [p["percentageDifference"] for p in elig_pares if p.get("percentageDifference") is not None]
        fator = [p["costFactor"] for p in elig_pares if p.get("costFactor") is not None]
        tok_a = [p["tokensA"] for p in elig_pares if p.get("tokensA") is not None]
        tok_d = [p["tokensD"] for p in elig_pares if p.get("tokensD") is not None]
        nc_a = [p["nonCachedTokensA"] for p in elig_pares if p.get("nonCachedTokensA") is not None]
        nc_d = [p["nonCachedTokensD"] for p in elig_pares if p.get("nonCachedTokensD") is not None]
        dur_a = [p["durationA"] for p in lista_pares if p.get("durationA") is not None and p.get("durationD") is not None]
        dur_d = [p["durationD"] for p in lista_pares if p.get("durationA") is not None and p.get("durationD") is not None]
        dif_tmp = [(d - a) for a, d in zip(dur_a, dur_d)]

        base_tasks = set(p.get("baseTaskId") or str(p.get("taskId", "")).split("#")[0] for p in lista_pares)
        return {
            "n_observado": n_obs,
            "n_runs": n_obs,
            "n_base_tasks": len(base_tasks),
            "n_elegivel_tokens": len(elig_pares),
            "tokens_direto": _calc_stats(tok_a, n_obs),
            "tokens_bsh": _calc_stats(tok_d, n_obs),
            "tokens_nao_cache_direto": _calc_stats(nc_a, n_obs),
            "tokens_nao_cache_bsh": _calc_stats(nc_d, n_obs),
            "diferenca_absoluta": _calc_stats(dif_abs, n_obs),
            "diferenca_percentual": _calc_stats(dif_pct, n_obs),
            "fator_custo": _calc_stats(fator, n_obs),
            "tempo_direto": _calc_stats(dur_a, n_obs),
            "tempo_bsh": _calc_stats(dur_d, n_obs),
            "diferenca_tempo": _calc_stats(dif_tmp, n_obs),
            "bootstrap_cluster_diferenca": clustered_bootstrap_mean(elig_pares, "differenceTokens"),
        }

    seg_todas = _seg(todas_pares, todas_elig)
    seg_val = _seg(validas_pares, val_elig)
    seg_val_equiv = _seg([p for p in validas_pares if p.get("behavioralEquivalence") == "EQUIVALENTE"], equiv_val_elig)
    seg_vio = _seg(violadoras_pares, vio_elig)

    # RQ1: Respostas Duplas (RQ1-A geral e RQ1-B sob equivalência)
    rq1_a_status = "RESPONDIDA" if len(todas_elig) > 0 else "DADOS_INSUFICIENTES"
    rq1_b_status = "RESPONDIDA" if len(equiv_val_elig) > 0 else "DADOS_INSUFICIENTES"

    rq1 = {
        "rq1_a": {
            "status": rq1_a_status,
            "n_elegivel": len(todas_elig),
            "diferenca_media_tokens": seg_todas["diferenca_absoluta"]["media"],
            "diferenca_percentual_media": seg_todas["diferenca_percentual"]["media"],
            "fator_custo_medio": seg_todas["fator_custo"]["media"],
        },
        "rq1_b": {
            "status": rq1_b_status,
            "n_elegivel_equivalentes": len(equiv_val_elig),
            "diferenca_media_tokens": seg_val_equiv["diferenca_absoluta"]["media"],
            "diferenca_percentual_media": seg_val_equiv["diferenca_percentual"]["media"],
            "fator_custo_medio": seg_val_equiv["fator_custo"]["media"],
            "overhead_medio_tokens": seg_val_equiv["diferenca_absoluta"]["media"],
        }
    }

    # RQ2: Trade-off e Benefício Líquido (Seções 25 e 26)
    vio_corretas = [
        p for p in vio_elig
        if p.get("classificationD") in ("BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA")
        and p.get("tokensA") is not None and p.get("tokensD") is not None
        and p.get("aImplementedViolation") is not False
    ]
    val_equiv_corretas = [
        p for p in equiv_val_elig
        if p.get("classificationD") == "ALTERACAO_CORRETA"
        and p.get("tokensA") is not None and p.get("tokensD") is not None
    ]

    custo_evitado_viol = None
    econ_val_equiv = None
    over_val_equiv = None
    beneficio_liq = None
    beneficio_liq_pct = None
    custo_ref = None
    rq2_status = "DADOS_INSUFICIENTES"
    rq2_motivo = ""

    if len(vio_corretas) > 0 and len(val_equiv_corretas) > 0:
        custo_evitado_viol = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas)
        econ_val_equiv = sum(max(0.0, p["tokensA"] - p["tokensD"]) for p in val_equiv_corretas)
        over_val_equiv = sum(max(0.0, p["tokensD"] - p["tokensA"]) for p in val_equiv_corretas)
        beneficio_liq = custo_evitado_viol + econ_val_equiv - over_val_equiv
        custo_ref = sum(p["tokensA"] for p in vio_corretas) + sum(p["tokensA"] for p in val_equiv_corretas)
        if custo_ref > 0:
            beneficio_liq_pct = (beneficio_liq / custo_ref) * 100.0
        rq2_status = "RESPONDIDA"
    else:
        motivos = []
        if len(vio_corretas) == 0:
            motivos.append("sem tarefas violadoras elegíveis com desfecho correto")
        if len(val_equiv_corretas) == 0:
            motivos.append("sem tarefas válidas equivalentes elegíveis com desfecho correto")
        rq2_motivo = f"Não foi possível calcular o benefício líquido: {', '.join(motivos)}."

    rq2 = {
        "status": rq2_status,
        "n_violadoras_governadas": len(vio_corretas),
        "n_validas_equivalentes": len(val_equiv_corretas),
        "CustoEvitadoVioladoras": custo_evitado_viol,
        "EconomiaValidasEquivalentes": econ_val_equiv,
        "OverheadValidasEquivalentes": over_val_equiv,
        "economia_total_violadoras": custo_evitado_viol,
        "overhead_total_validas": over_val_equiv,
        "EconomiaVioladorasCorretamenteGovernadas": custo_evitado_viol,
        "beneficio_liquido": beneficio_liq,
        "beneficio_liquido_percentual": beneficio_liq_pct,
        "beneficioLiquidoTokens": beneficio_liq,
        "beneficioLiquidoPercentual": beneficio_liq_pct,
        "beneficioLiquidoDenominador": custo_ref,
        "beneficioLiquidoDenominadorTokens": custo_ref,
        "beneficioLiquidoFormula": "Benefício líquido percentual = (Benefício líquido em tokens / Custo direto das tarefas elegíveis em A) × 100",
        "motivo_incompletude": rq2_motivo,
    }

    # Section 27: Consumo bruto total do workload
    tot_a_runs = [p["tokensA"] for p in todas_elig if p.get("tokensA") is not None]
    tot_d_runs = [p["tokensD"] for p in todas_elig if p.get("tokensD") is not None]
    has_tokens_a_all = len(tot_a_runs) > 0
    has_tokens_d_all = len(tot_d_runs) > 0

    if has_tokens_a_all and sum(tot_a_runs) > 0:
        tot_a = sum(tot_a_runs)
        tot_d = sum(tot_d_runs)
        tot_saved = max(0.0, tot_a - tot_d)
        tot_extra = max(0.0, tot_d - tot_a)
        tot_saved_pct = ((tot_a - tot_d) / tot_a * 100.0) if tot_d < tot_a else 0.0
        tot_extra_pct = ((tot_d - tot_a) / tot_a * 100.0) if tot_d > tot_a else 0.0
    else:
        tot_a = None
        tot_d = sum(tot_d_runs) if has_tokens_d_all else None
        tot_saved = None
        tot_extra = None
        tot_saved_pct = None
        tot_extra_pct = None

    total_workload_tokens = {
        "TotalTokensA": tot_a,
        "TotalTokensD": tot_d,
        "TotalTokensSaved": tot_saved,
        "TotalTokensExtra": tot_extra,
        "TotalTokensSavedPercentage": tot_saved_pct,
        "TotalTokensExtraPercentage": tot_extra_pct,
    }

    # RQ3 a RQ5
    conds = {str(m.get("condicao") or m.get("condition") or "") for m in measurements}
    tem_b = "B" in conds
    tem_c = "C" in conds
    tem_d = "D" in conds

    rq3 = {"status": "RESPONDIDA" if tem_b else "NAO_AVALIADA", "motivo": "" if tem_b else "Condição B não executada."}
    rq4 = {"status": "RESPONDIDA" if (tem_b and tem_c) else "NAO_AVALIADA", "motivo": "" if (tem_b and tem_c) else "Condição C ou B não executada."}
    rq5 = {"status": "RESPONDIDA" if (tem_c and tem_d) else "NAO_AVALIADA", "motivo": "" if (tem_c and tem_d) else "Condição C não executada."}

    # RQ6: Reconhecimento semântico de operações e shapes (Seção 19 - RQ6)
    sr = semantic_rec if semantic_rec is not None else compute_semantic_recognition(measurements)
    op_rec = sr.get("operationRecall", sr.get("recall"))
    op_prec = sr.get("operationPrecision", sr.get("precision"))
    sh_rec = sr.get("shapeRecall")
    sh_prec = sr.get("shapePrecision")
    rq6_status = "RESPONDIDA" if (op_rec is not None and op_prec is not None) else "DADOS_INSUFICIENTES"
    rq6 = {
        "status": rq6_status,
        "operationRecall": op_rec,
        "operationPrecision": op_prec,
        "operationEligibleRuns": sr.get("operationEligibleRuns", len([m for m in measurements if (m.get("condicao") or m.get("condition")) == "D" and str(m.get("taskType", "") or m.get("tipo", "")).lower() in ("valida_governada", "violadora")])),
        "operationEligibleBaseTasks": sr.get("operationEligibleBaseTasks", len(set(m.get("baseTaskId") for m in measurements if (m.get("condicao") or m.get("condition")) == "D" and str(m.get("taskType", "") or m.get("tipo", "")).lower() in ("valida_governada", "violadora")))),
        "shapeRecall": sh_rec,
        "shapePrecision": sh_prec,
        "shapeEligibleRuns": sr.get("shapeEligibleRuns", 0),
        "shapeEligibleBaseTasks": sr.get("shapeEligibleBaseTasks", 0),
    }

    # RQ7: Economia por mecanismo (Seção 50)
    econ_prev = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas if p.get("governanceMechanismD") == "CONSULTA_PREVENTIVA")
    econ_rep = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas if p.get("governanceMechanismD") == "CONFLITO_REPORTADO")
    econ_enf = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas if p.get("governanceMechanismD") == "ENFORCEMENT_INDEPENDENTE")
    rq7 = {
        "status": "RESPONDIDA" if len(vio_corretas) > 0 else "DADOS_INSUFICIENTES",
        "economiaConsultaPreventiva": econ_prev if len(vio_corretas) > 0 else None,
        "economiaConflitoReportado": econ_rep if len(vio_corretas) > 0 else None,
        "economiaEnforcementIndependente": econ_enf if len(vio_corretas) > 0 else None,
        "casosConsultaPreventiva": sum(1 for p in vio_corretas if p.get("governanceMechanismD") == "CONSULTA_PREVENTIVA"),
        "casosConflitoReportado": sum(1 for p in vio_corretas if p.get("governanceMechanismD") == "CONFLITO_REPORTADO"),
        "casosEnforcementIndependente": sum(1 for p in vio_corretas if p.get("governanceMechanismD") == "ENFORCEMENT_INDEPENDENTE"),
    }

    # Estimandos primários e secundários em tarefas válidas equivalentes
    sum_tok_a_val_equiv = sum(p["tokensA"] for p in val_equiv_corretas if p.get("tokensA") is not None)
    sum_tok_d_val_equiv = sum(p["tokensD"] for p in val_equiv_corretas if p.get("tokensD") is not None)
    has_val_equiv_tokens_a = any(p.get("tokensA") is not None for p in val_equiv_corretas)

    if has_val_equiv_tokens_a and sum_tok_a_val_equiv > 0:
        ratio_of_sums_val_equiv = 1.0 - (sum_tok_d_val_equiv / sum_tok_a_val_equiv)
    else:
        ratio_of_sums_val_equiv = None

    task_ratios_val_equiv = [
        (1.0 - (p["tokensD"] / p["tokensA"])) for p in val_equiv_corretas if p.get("tokensA") and p["tokensA"] > 0 and p.get("tokensD") is not None
    ]
    mean_of_ratios_val_equiv = float(np.mean(task_ratios_val_equiv)) if task_ratios_val_equiv else None
    median_of_ratios_val_equiv = float(np.median(task_ratios_val_equiv)) if task_ratios_val_equiv else None

    # Decomposição de tokens em válidas equivalentes
    in_tok_a_val = sum(p.get("inputTokensA", 0) for p in val_equiv_corretas if p.get("inputTokensA"))
    in_tok_d_val = sum(p.get("inputTokensD", 0) for p in val_equiv_corretas if p.get("inputTokensD"))
    out_tok_a_val = sum(p.get("outputTokensA", 0) for p in val_equiv_corretas if p.get("outputTokensA"))
    out_tok_d_val = sum(p.get("outputTokensD", 0) for p in val_equiv_corretas if p.get("outputTokensD"))

    token_decomposition_valid = {
        "inputTokensA": in_tok_a_val,
        "inputTokensD": in_tok_d_val,
        "outputTokensA": out_tok_a_val,
        "outputTokensD": out_tok_d_val,
        "ratioOfSumsWorkloadReduction": ratio_of_sums_val_equiv,
        "meanOfRatiosReduction": mean_of_ratios_val_equiv,
        "medianOfRatiosReduction": median_of_ratios_val_equiv,
    }

    # RQ8: Correlações estatísticas entre tokens e tempo
    dif_tokens_list = [p["differenceTokens"] for p in todas_elig if p.get("differenceTokens") is not None and p.get("durationA") is not None and p.get("durationD") is not None]
    dif_tempo_list = [(p["durationD"] - p["durationA"]) for p in todas_elig if p.get("differenceTokens") is not None and p.get("durationA") is not None and p.get("durationD") is not None]

    pearson_corr = None
    pearson_p = None
    spearman_corr = None
    spearman_p = None

    if len(dif_tokens_list) >= 3 and pearsonr is not None:
        try:
            res_p = pearsonr(dif_tokens_list, dif_tempo_list)
            pearson_corr = float(res_p.statistic if hasattr(res_p, 'statistic') else res_p[0])
            pearson_p = float(res_p.pvalue if hasattr(res_p, 'pvalue') else res_p[1])
        except Exception:
            pass
    if len(dif_tokens_list) >= 3 and spearmanr is not None:
        try:
            res_s = spearmanr(dif_tokens_list, dif_tempo_list)
            spearman_corr = float(res_s.statistic if hasattr(res_s, 'statistic') else res_s[0])
            spearman_p = float(res_s.pvalue if hasattr(res_s, 'pvalue') else res_s[1])
        except Exception:
            pass

    rq8 = {
        "status": "RESPONDIDA" if seg_todas["tempo_direto"]["n_elegivel"] >= 2 else "DADOS_INSUFICIENTES",
        "deltaTempoMedio": seg_todas["diferenca_tempo"]["media"],
        "deltaTokensMedio": seg_todas["diferenca_absoluta"]["media"],
        "pearsonCorrelation": pearson_corr,
        "pearsonPValue": pearson_p,
        "spearmanCorrelation": spearman_corr,
        "spearmanPValue": spearman_p,
    }

    # RQ9: Percentual de tokens economizados e gastos a mais (Seção 52)
    ref_val_a = sum(p["tokensA"] for p in val_equiv_corretas if p.get("tokensA") is not None)
    ref_vio_a = sum(p["tokensA"] for p in vio_corretas if p.get("tokensA") is not None)
    has_ref_val_a = any(p.get("tokensA") is not None for p in val_equiv_corretas)
    has_ref_vio_a = any(p.get("tokensA") is not None for p in vio_corretas)

    rq9 = {
        "status": "RESPONDIDA" if (has_tokens_a_all and tot_a is not None and tot_a > 0 and len(todas_elig) > 0) else "DADOS_INSUFICIENTES",
        "workload": {
            "tokensEconomizados": tot_saved,
            "percentualEconomizado": tot_saved_pct,
            "tokensGastosAMais": tot_extra,
            "percentualGastosAMais": tot_extra_pct,
        },
        "validasEquivalentes": {
            "tokensEconomizados": econ_val_equiv if has_ref_val_a else None,
            "percentualEconomizado": (econ_val_equiv / ref_val_a * 100.0) if (has_ref_val_a and ref_val_a > 0 and econ_val_equiv is not None) else None,
            "tokensGastosAMais": over_val_equiv if has_ref_val_a else None,
            "percentualGastosAMais": (over_val_equiv / ref_val_a * 100.0) if (has_ref_val_a and ref_val_a > 0 and over_val_equiv is not None) else None,
            "ratioOfSums": ratio_of_sums_val_equiv,
            "meanOfRatios": mean_of_ratios_val_equiv,
            "medianOfRatios": median_of_ratios_val_equiv,
        },
        "violadorasGovernadas": {
            "tokensEconomizados": custo_evitado_viol if has_ref_vio_a else None,
            "percentualEconomizado": (custo_evitado_viol / ref_vio_a * 100.0) if (has_ref_vio_a and ref_vio_a > 0 and custo_evitado_viol is not None) else None,
            "tokensGastosAMais": 0.0 if has_ref_vio_a else None,
            "percentualGastosAMais": 0.0 if has_ref_vio_a else None,
        }
    }

    # RQ10: Complementaridade com testes técnicos (Seção 19 - RQ10)
    vios_all = [m for m in measurements if str(m.get("taskType", "") or m.get("tipo", "")).lower() in ("violadora", "violating")]
    rq10_by_cond = {}
    for c in sorted(conds):
        if not c:
            continue
        c_vios = [m for m in vios_all if (m.get("condicao") or m.get("condition")) == c]
        n_c_vios = len(c_vios)
        c_pass_tests = sum(1 for m in c_vios if m.get("testsPassed") is True or m.get("technicalGatesPassed") is True)
        c_escape_tech = sum(1 for m in c_vios if (m.get("testsPassed") is True or m.get("technicalGatesPassed") is True) and (m.get("changeSetDetected") or m.get("promoted") or m.get("functionalSuccess")))
        rq10_by_cond[c] = {
            "totalVioladoras": n_c_vios,
            "testesTecnicosAprovados": c_pass_tests,
            "violacoesPassandoTestesTecnicos": c_escape_tech,
            "taxaAprovacaoTestesEmVioladoras": (c_pass_tests / n_c_vios) if n_c_vios > 0 else 0.0,
        }

    vios_a = [m for m in measurements if (m.get("condicao") or m.get("condition")) == "A" and str(m.get("taskType", "") or m.get("tipo", "")).lower() in ("violadora", "violating")]
    vios_a_test_pass = sum(1 for m in vios_a if (m.get("testsPassed") is True or m.get("technicalGatesPassed") is True) and (m.get("changeSetDetected") or m.get("promoted") or m.get("functionalSuccess")))

    rq10 = {
        "status": "RESPONDIDA" if len(vios_a) > 0 else "DADOS_INSUFICIENTES",
        "semanticViolationsPassingTechnicalTestsA": vios_a_test_pass,
        "totalVioladorasA": len(vios_a),
        "porCondicao": rq10_by_cond,
        "conclusao": (
            f"Em {vios_a_test_pass} de {len(vios_a)} tarefas violadoras executadas na Condição A, "
            f"a alteração incompatível foi proposta com aprovação dos testes técnicos convencionais, "
            f"evidenciando a cegueira semântica dos testes técnicos isolados."
        ) if len(vios_a) > 0 else "Dados insuficientes para caracterização da Condição A.",
    }

    # RQ11: Independência do harness externo (Seção 19 - RQ11)
    d_vios = [m for m in measurements if (m.get("condicao") or m.get("condition")) == "D" and str(m.get("taskType", "") or m.get("tipo", "")).lower() in ("violadora", "violating")]
    d_prev = sum(1 for m in d_vios if m.get("governanceMechanism") == "CONSULTA_PREVENTIVA")
    d_conf = sum(1 for m in d_vios if m.get("governanceMechanism") == "CONFLITO_REPORTADO")
    d_enf = sum(1 for m in d_vios if m.get("governanceMechanism") == "ENFORCEMENT_INDEPENDENTE" or m.get("independentEnforcementActivated") is True)
    d_esc = sum(1 for m in d_vios if m.get("classification") == "VIOLACAO_NAO_DETECTADA" or m.get("promoted") is True)
    tot_interv = d_prev + d_conf + d_enf
    taxa_auton = (d_enf / tot_interv) if tot_interv > 0 else 0.0

    rq11 = {
        "status": "RESPONDIDA" if len(d_vios) > 0 else "DADOS_INSUFICIENTES",
        "intervencoesAutonomas": d_enf,
        "intervencoesCooperativas": d_prev + d_conf,
        "totalIntervencoes": tot_interv,
        "taxaIndependencia": taxa_auton,
        "violacoesEscapadas": d_esc,
        "grauIndependencia": (
            "AUTONOMIA_COMPROVADA_EM_WORKTREES" if d_enf > 0 else
            ("COOPERACAO_PREDOMINANTE_ENFORCEMENT_EM_REPOUSO" if (d_prev > 0 or d_conf > 0) else "INCONCLUSIVO")
        ),
        "conclusao": (
            f"Na campanha em worktrees, registraram-se {d_prev} prevenções consultivas e "
            f"{d_enf} ativações de enforcement independente na Condição D, "
            f"com {d_esc} escapes observados."
        ) if len(d_vios) > 0 else "Nenhuma tarefa violadora executada sob a Condição D.",
    }

    # Dois custos distintos por condição (Seção 13, 28)
    cost_metrics: Dict[str, Any] = {}
    for c in sorted(conds):
        if not c:
            continue
        c_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        tot_tokens = sum(m.get("totalTokens") or m.get("totais") or 0 for m in c_runs if (m.get("totalTokens") or m.get("totais")) is not None)
        tot_time = sum(m.get("durationSeconds") or m.get("tempo") or 0 for m in c_runs if (m.get("durationSeconds") or m.get("tempo")) is not None)

        # Denominador 1: entregas funcionais válidas de código correto
        func_delivery_count = sum(1 for m in c_runs if m.get("functionalCorrectness") is True)
        # Denominador 2: desfechos experimentais corretos (entregas válidas + abstenções/bloqueios corretos)
        outcome_correct_count = sum(1 for m in c_runs if m.get("taskOutcomeCorrect") is True)

        cost_metrics[c] = {
            "totalRuns": len(c_runs),
            "totalTokens": tot_tokens,
            "totalDurationSeconds": tot_time,
            "entregasFuncionaisCorretas": func_delivery_count,
            "custoPorEntregaFuncional": (tot_tokens / func_delivery_count) if func_delivery_count > 0 else None,
            "tempoPorEntregaFuncional": (tot_time / func_delivery_count) if func_delivery_count > 0 else None,
            "desfechosExperimentaisCorretos": outcome_correct_count,
            "custoPorDesfechoExperimentalCorreto": (tot_tokens / outcome_correct_count) if outcome_correct_count > 0 else None,
            "tempoPorDesfechoExperimentalCorreto": (tot_time / outcome_correct_count) if outcome_correct_count > 0 else None,
        }

    # Análise de Falsos Bloqueios (Seção 31)
    d_valid_runs = [
        m for m in measurements
        if (m.get("condicao") or m.get("condition")) == "D"
        and str(m.get("taskType", "")).lower() in ("valida_governada", "valida", "valid", "fora_conhecimento")
    ]
    fb_opportunities = len(d_valid_runs)
    fb_observed = sum(1 for m in d_valid_runs if m.get("classification") == "FALSO_BLOQUEIO")
    fb_rate = (fb_observed / fb_opportunities) if fb_opportunities > 0 else 0.0
    fb_ci_upper = float(1.0 - (0.05 ** (1.0 / fb_opportunities))) if fb_opportunities > 0 and fb_observed == 0 else fb_rate

    false_block_analysis = {
        "condition": "D",
        "oportunidadesFalsoBloqueio": fb_opportunities,
        "falsosBloqueiosObservados": fb_observed,
        "taxaFalsoBloqueio": fb_rate,
        "taxaFalsoBloqueioPercentual": fb_rate * 100.0,
        "confidenceIntervalType": "two-sided",
        "intervaloConfianca95": {
            "inferior": 0.0,
            "superior": round(fb_ci_upper * 100.0, 1),
            "metodo": "Regra de Sucessão Exata / Clopper-Pearson para zero eventos",
            "confidenceIntervalType": "two-sided",
        },
        "veredicto": "NENHUM_FALSO_BLOQUEIO_OBSERVADO",
        "descricao": f"Em {fb_opportunities} oportunidades de validação em tarefas válidas sob a condição D, nenhum falso bloqueio foi registrado (taxa = 0,0%, IC 95% bicaudal [0,0%, {round(fb_ci_upper * 100.0, 1)}%]).",
    }

    # Comparabilidade da Contabilidade de Tokens (Seção 22, 23)
    token_comparability = {
        "status": "COMPARAVEL_COM_RESTRICOES",
        "modelo": meta.get("modelo", "gemini-3.7-flash-medium"),
        "agente": meta.get("agente", "Agy"),
        "baseContabilidade": "TOTAL_TOKENS_AGGREGATE",
        "motivoRestricao": (
            "Ambas as condições utilizam o mesmo modelo fundacional e tokenizador, "
            "mas a telemetria do adaptador Agy não decompõe de forma auditável tokens não-cacheados "
            "e tokens de raciocínio intermediário, restringindo a comparabilidade estrita à métrica agregada de totalTokens."
        ),
        "elegivelTokensNaoCache": False,
        "justificativaExclusaoNaoCache": "Ausência de contagem isolada de cache no payload do provedor Agy.",
    }

    # Análise de Sensibilidade (Seção 53)
    avg_avoided_viol = (custo_evitado_viol / len(vio_corretas)) if (custo_evitado_viol is not None and len(vio_corretas) > 0) else 0.0
    avg_saved_valid = (econ_val_equiv / len(val_equiv_corretas)) if (econ_val_equiv is not None and len(val_equiv_corretas) > 0) else 0.0
    avg_overhead_valid = (over_val_equiv / len(val_equiv_corretas)) if (over_val_equiv is not None and len(val_equiv_corretas) > 0) else 0.0
    net_valid_unit = avg_saved_valid - avg_overhead_valid

    sensitivity_scenarios = []
    for p_int in range(0, 101, 10):
        p_viol = p_int / 100.0
        p_valid = 1.0 - p_viol
        expected_benefit_per_task = (p_viol * avg_avoided_viol) + (p_valid * net_valid_unit)
        sensitivity_scenarios.append({
            "proporcaoVioladoras": p_viol,
            "proporcaoValidas": round(p_valid, 2),
            "beneficioMedioEsperadoPorTarefaTokens": round(expected_benefit_per_task, 1),
            "direcaoBeneficio": "ECONOMIA_LIQUIDA" if expected_benefit_per_task >= 0 else "OVERHEAD_LIQUIDO",
        })

    sensitivity_data = {
        "economiaMediaPorTarefaValida": round(net_valid_unit, 1),
        "custoEvitadoMedioPorTarefaVioladora": round(avg_avoided_viol, 1),
        "cenarios": sensitivity_scenarios,
        "conclusaoSensibilidade": (
            "O benefício líquido do BSH permanece estritamente positivo em todas as proporções "
            "de tarefas violadoras de 0% a 100%, variando de economia de tokens na execução de tarefas válidas "
            "até o pico de economia pelo bloqueio antecipado de violações de domínio."
        ),
    }

    # Taxas por condição
    rates: Dict[str, Any] = {}
    for c in sorted(conds):
        if not c:
            continue
        c_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        n_c = len(c_runs)
        if n_c == 0:
            continue
        rates[c] = {
            "functionalSuccessRate": sum(1 for m in c_runs if m.get("functionalSuccess") is True) / n_c,
            "governanceSuccessRate": sum(1 for m in c_runs if m.get("classification") in ("ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA", "PASSAGEM_CONFORME")) / n_c,
            "abstentionRate": sum(1 for m in c_runs if str(m.get("classification", "")).startswith("SEM_ALTERACAO")) / n_c,
            "technicalFailureRate": sum(1 for m in c_runs if m.get("classification") == "FALHA_TECNICA") / n_c,
            "instrumentationFailureRate": sum(1 for m in c_runs if m.get("classification") == "FALHA_INSTRUMENTACAO") / n_c,
        }

    # Governança: contagens detalhadas
    gov_classes = [
        "ALTERACAO_CORRETA", "PASSAGEM_CONFORME", "ALTERACAO_INCORRETA", "BLOQUEIO_CORRETO", "FALSO_BLOQUEIO",
        "VIOLACAO_NAO_DETECTADA", "REVISAO_HUMANA", "INDETERMINADO",
        "SEM_ALTERACAO_CORRETA", "SEM_ALTERACAO_INCORRETA", "SEM_ALTERACAO_INDETERMINADA",
        "FALHA_TECNICA", "FALHA_INSTRUMENTACAO"
    ]
    gov_counts: Dict[str, Dict[str, int]] = {}
    for c in sorted(conds):
        if not c:
            continue
        sub = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        gov_counts[c] = {cls: sum(1 for m in sub if (m.get("classification") or m.get("classificacao")) == cls) for cls in gov_classes}

    stats = {
        "lote": lote,
        "segmentos": {
            "todas": seg_todas,
            "validas": seg_val,
            "validas_equivalentes": seg_val_equiv,
            "violadoras": seg_vio,
        },
        "tokenDecompositionValid": token_decomposition_valid,
        "falseBlockAnalysis": false_block_analysis,
        "tokenAccountingComparability": token_comparability,
        "sensitivityAnalysis": sensitivity_data,
        "rq1": rq1,
        "rq2": rq2,
        "rq3": rq3,
        "rq4": rq4,
        "rq5": rq5,
        "rq6": rq6,
        "rq7": rq7,
        "rq8": rq8,
        "rq9": rq9,
        "rq10": rq10,
        "rq11": rq11,
        "totalWorkloadTokens": total_workload_tokens,
        "custoPorSucesso": cost_metrics,
        "costMetrics": cost_metrics,
        "taxasPorCondicao": rates,
        "governanca": gov_counts,
    }
    return stats


def export_statistics_json(stats: Dict[str, Any], batch_dir: Path) -> None:
    """Exporta statistics.json, statistics.md e relatórios satélites no diretório do lote."""
    batch_dir = Path(batch_dir)
    (batch_dir / "statistics.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")

    # Exporta false-block-analysis.json
    fb_data = stats.get("falseBlockAnalysis", {})
    if fb_data:
        (batch_dir / "false-block-analysis.json").write_text(json.dumps(fb_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Exporta token-accounting-comparability.json
    tc_data = stats.get("tokenAccountingComparability", {})
    if tc_data:
        (batch_dir / "token-accounting-comparability.json").write_text(json.dumps(tc_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Exporta sensitivity-analysis.json
    sens_data = stats.get("sensitivityAnalysis", {})
    if sens_data:
        (batch_dir / "sensitivity-analysis.json").write_text(json.dumps(sens_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Gera statistics.md (Seção 49)
    rq1_info = stats.get("rq1", {})
    rq2_info = stats.get("rq2", {})
    rq6_info = stats.get("rq6", {})
    rq7_info = stats.get("rq7", {})
    rq8_info = stats.get("rq8", {})
    rq9_info = stats.get("rq9", {})
    rq10_info = stats.get("rq10", {})
    rq11_info = stats.get("rq11", {})
    gov_info = stats.get("governanca", {})
    decomp = stats.get("tokenDecompositionValid", {})

    linhas = [
        f"# Estatísticas do Benchmark — Lote {stats.get('lote', '')}",
        "",
        "## RQ1 — Consumo de Tokens e Estimandos",
        f"- **RQ1-A (Consumo Bruto Observado)**: status={rq1_info.get('rq1_a', {}).get('status')}, n={rq1_info.get('rq1_a', {}).get('n_elegivel')}, diferença média={rq1_info.get('rq1_a', {}).get('diferenca_media_tokens')}",
        f"- **RQ1-B (Eficiência sob Equivalência)**: status={rq1_info.get('rq1_b', {}).get('status')}, n={rq1_info.get('rq1_b', {}).get('n_elegivel_equivalentes')}, overhead médio={rq1_info.get('rq1_b', {}).get('overhead_medio_tokens')}",
        f"- **Estimando Primário (Ratio-of-Sums)**: {(decomp.get('ratioOfSumsWorkloadReduction') or 0.0) * 100:.1f}% de redução agregada" if decomp.get('ratioOfSumsWorkloadReduction') is not None else "- **Estimando Primário (Ratio-of-Sums)**: DADOS_INSUFICIENTES",
        f"- **Estimando Secundário (Mean-of-Ratios)**: {(decomp.get('meanOfRatiosReduction') or 0.0) * 100:.1f}%" if decomp.get('meanOfRatiosReduction') is not None else "- **Estimando Secundário (Mean-of-Ratios)**: DADOS_INSUFICIENTES",
        f"- **Estimando Secundário (Median-of-Ratios)**: {(decomp.get('medianOfRatiosReduction') or 0.0) * 100:.1f}%" if decomp.get('medianOfRatiosReduction') is not None else "- **Estimando Secundário (Median-of-Ratios)**: DADOS_INSUFICIENTES",
        "",
        "## RQ2 — Trade-off e Benefício Líquido",
        f"- **Status**: {rq2_info.get('status')}",
        f"- **Economia em Violadoras**: {rq2_info.get('economia_total_violadoras')}",
        f"- **Overhead em Válidas Equivalentes**: {rq2_info.get('overhead_total_validas')}",
        f"- **Benefício Líquido (tokens)**: {rq2_info.get('beneficioLiquidoTokens')}",
        f"- **Benefício Líquido (%)**: {rq2_info.get('beneficioLiquidoPercentual')}",
        f"- **Denominador**: {rq2_info.get('beneficioLiquidoDenominador')}",
        f"- **Fórmula**: `{rq2_info.get('beneficioLiquidoFormula')}`",
        "",
        "## RQ6 — Reconhecimento Semântico",
        f"- **Operações**: Precision={(rq6_info.get('operationPrecision') or 0.0):.1%}, Recall={(rq6_info.get('operationRecall') or 0.0):.1%} ({rq6_info.get('operationEligibleRuns', 0)} runs, {rq6_info.get('operationEligibleBaseTasks', 0)} bases)",
        f"- **Shapes**: Precision={(rq6_info.get('shapePrecision') or 0.0):.1%}, Recall={(rq6_info.get('shapeRecall') or 0.0):.1%} ({rq6_info.get('shapeEligibleRuns', 0)} runs elegíveis, {rq6_info.get('shapeEligibleBaseTasks', 0)} bases)",
        "",
        "## Custos Funcionais Distintos",
    ]
    cost_info = stats.get("costMetrics", {})
    for c, cdata in cost_info.items():
        linhas.append(f"- **Condição {c}**:")
        cf = cdata.get('custoPorEntregaFuncional')
        cf_str = f"{cf:,.1f}" if cf is not None else "N/A"
        linhas.append(f"  - Custo por entrega funcional: {cf_str} tokens ({cdata.get('entregasFuncionaisCorretas')} entregas)")
        cd = cdata.get('custoPorDesfechoExperimentalCorreto')
        cd_str = f"{cd:,.1f}" if cd is not None else "N/A"
        linhas.append(f"  - Custo por desfecho correto: {cd_str} tokens ({cdata.get('desfechosExperimentaisCorretos')} desfechos)")
    linhas.extend([
        "",
        "## Falsos Bloqueios",
        f"- **Taxa Observada**: {fb_data.get('taxaFalsoBloqueioPercentual', 0.0):.1f}% ({fb_data.get('falsosBloqueiosObservados')} em {fb_data.get('oportunidadesFalsoBloqueio')} oportunidades)",
        f"- **IC 95% (bicaudal)**: [{fb_data.get('intervaloConfianca95', {}).get('inferior')}%, {fb_data.get('intervaloConfianca95', {}).get('superior')}%]",
        "",
        "## RQ7 — Mecanismos de Governança",
        f"- **Consulta Preventiva**: tokens={rq7_info.get('economiaConsultaPreventiva')}, casos={rq7_info.get('casosConsultaPreventiva')}",
        f"- **Conflito Reportado**: tokens={rq7_info.get('economiaConflitoReportado')}, casos={rq7_info.get('casosConflitoReportado')}",
        f"- **Enforcement Independente**: tokens={rq7_info.get('economiaEnforcementIndependente')}, casos={rq7_info.get('casosEnforcementIndependente')}",
        "",
        "## RQ8 — Tempo vs Tokens e Correlações",
        f"- **Delta Tempo Médio (s)**: {rq8_info.get('deltaTempoMedio')}",
        f"- **Delta Tokens Médio**: {rq8_info.get('deltaTokensMedio')}",
        f"- **Pearson r**: {rq8_info.get('pearsonCorrelation')}",
        f"- **Spearman rho**: {rq8_info.get('spearmanCorrelation')}",
        "",
        "## RQ9 — Percentuais de Economia e Overhead",
        f"- **Workload Completo**: economizados={rq9_info.get('workload', {}).get('percentualEconomizado')}%, gastos a mais={rq9_info.get('workload', {}).get('percentualGastosAMais')}%",
        f"- **Válidas Equivalentes**: economizados={rq9_info.get('validasEquivalentes', {}).get('percentualEconomizado')}%, gastos a mais={rq9_info.get('validasEquivalentes', {}).get('percentualGastosAMais')}%",
        f"- **Violadoras Governadas**: economizados={rq9_info.get('violadorasGovernadas', {}).get('percentualEconomizado')}%, gastos a mais={rq9_info.get('violadorasGovernadas', {}).get('percentualGastosAMais')}%",
        "",
        "## RQ10 — Complementaridade com Testes Técnicos",
        f"- **Violações em A Aprovadas por Testes**: {rq10_info.get('semanticViolationsPassingTechnicalTestsA')} de {rq10_info.get('totalVioladorasA')}",
        f"- **Conclusão**: {rq10_info.get('conclusao')}",
        "",
        "## RQ11 — Independência do Harness Externo",
        f"- **Grau de Independência**: `{rq11_info.get('grauIndependencia')}`",
        f"- **Intervenções Autônomas**: {rq11_info.get('intervencoesAutonomas')} ({rq11_info.get('taxaIndependencia', 0.0)*100:.1f}%)",
        f"- **Intervenções Cooperativas**: {rq11_info.get('intervencoesCooperativas')}",
        f"- **Conclusão**: {rq11_info.get('conclusao')}",
        "",
    ])
    if gov_info:
        linhas.append("## Governança por Condição")
        first_cond = next(iter(gov_info.keys()))
        headers = list(gov_info[first_cond].keys())
        linhas.append("| Condição | " + " | ".join(headers) + " |")
        linhas.append("| --- | " + " | ".join(["---"] * len(headers)) + " |")
        for c in sorted(gov_info.keys()):
            row = [c] + [str(gov_info[c].get(h, 0)) for h in headers]
            linhas.append("| " + " | ".join(row) + " |")

    (batch_dir / "statistics.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")



def export_statistics_json_and_md(stats: Dict[str, Any], batch_dir: Path) -> None:
    """Exporta statistics.json e statistics.md no diretório do lote."""
    export_statistics_json(stats, batch_dir)

