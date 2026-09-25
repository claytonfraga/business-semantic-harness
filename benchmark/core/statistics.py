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
    from scipy.stats import t as student_t, ttest_rel, wilcoxon
except ImportError:
    student_t = None
    ttest_rel = None
    wilcoxon = None


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

        return {
            "n_observado": n_obs,
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

    # RQ2: Trade-off e Benefício Líquido
    # EconomiaTotalVioladoras = sum(TokensA - TokensD) SOMENTE para violadoras com BLOQUEIO_CORRETO ou SEM_ALTERACAO_CORRETA
    # onde A implementou a violação!
    vio_corretas = [
        p for p in vio_elig
        if p.get("classificationD") in ("BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA")
        and p.get("tokensA") is not None and p.get("tokensD") is not None
    ]
    val_equiv_corretas = [
        p for p in equiv_val_elig
        if p.get("classificationD") == "ALTERACAO_CORRETA"
        and p.get("tokensA") is not None and p.get("tokensD") is not None
    ]

    econ_viol = None
    over_val = None
    beneficio_liq = None
    beneficio_liq_pct = None
    rq2_status = "DADOS_INSUFICIENTES"
    rq2_motivo = ""

    if len(vio_corretas) > 0 and len(val_equiv_corretas) > 0:
        econ_viol = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas)
        over_val = sum((p["tokensD"] - p["tokensA"]) for p in val_equiv_corretas)
        beneficio_liq = econ_viol - over_val
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
        "economia_total_violadoras": econ_viol,
        "overhead_total_validas": over_val,
        "beneficio_liquido": beneficio_liq,
        "beneficio_liquido_percentual": beneficio_liq_pct,
        "motivo_incompletude": rq2_motivo,
    }

    # RQ3 a RQ8
    conds = {str(m.get("condicao") or m.get("condition") or "") for m in measurements}
    tem_b = "B" in conds
    tem_c = "C" in conds
    tem_d = "D" in conds

    rq3 = {"status": "RESPONDIDA" if tem_b else "NAO_AVALIADA", "motivo": "" if tem_b else "Condição B não executada."}
    rq4 = {"status": "RESPONDIDA" if (tem_b and tem_c) else "NAO_AVALIADA", "motivo": "" if (tem_b and tem_c) else "Condição C ou B não executada."}
    rq5 = {"status": "RESPONDIDA" if (tem_c and tem_d) else "NAO_AVALIADA", "motivo": "" if (tem_c and tem_d) else "Condição C não executada."}

    sr = semantic_rec or {}
    op_rec = sr.get("operationRecall", sr.get("recall"))
    op_prec = sr.get("operationPrecision", sr.get("precision"))
    sh_rec = sr.get("shapeRecall")
    sh_prec = sr.get("shapePrecision")
    rq6_status = "RESPONDIDA" if (op_rec is not None and op_prec is not None) else "DADOS_INSUFICIENTES"
    rq6 = {
        "status": rq6_status,
        "operationRecall": op_rec,
        "operationPrecision": op_prec,
        "shapeRecall": sh_rec,
        "shapePrecision": sh_prec,
    }

    # RQ7: Economia por mecanismo
    econ_prev = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas if p.get("governanceMechanismD") == "CONSULTA_PREVENTIVA")
    econ_rep = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas if p.get("governanceMechanismD") == "CONFLITO_REPORTADO")
    econ_enf = sum((p["tokensA"] - p["tokensD"]) for p in vio_corretas if p.get("governanceMechanismD") == "ENFORCEMENT_INDEPENDENTE")
    rq7 = {
        "status": "RESPONDIDA" if len(vio_corretas) > 0 else "DADOS_INSUFICIENTES",
        "economiaConsultaPreventiva": econ_prev if len(vio_corretas) > 0 else None,
        "economiaConflitoReportado": econ_rep if len(vio_corretas) > 0 else None,
        "economiaEnforcementIndependente": econ_enf if len(vio_corretas) > 0 else None,
    }

    # RQ8: Tempo vs Tokens
    rq8 = {
        "status": "RESPONDIDA" if seg_todas["tempo_direto"]["n_elegivel"] >= 2 else "DADOS_INSUFICIENTES",
        "deltaTempoMedio": seg_todas["diferenca_tempo"]["media"],
        "deltaTokensMedio": seg_todas["diferenca_absoluta"]["media"],
    }

    # Custo por sucesso funcional (Requirement 35)
    cost_per_success: Dict[str, Any] = {}
    for c in sorted(conds):
        if not c:
            continue
        c_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        tot_tokens = sum(m.get("totalTokens") or m.get("totais") or 0 for m in c_runs if (m.get("totalTokens") or m.get("totais")) is not None)
        tot_non_cached = sum(m.get("nonCachedTokens") or m.get("tokensNaoCache") or 0 for m in c_runs if (m.get("nonCachedTokens") or m.get("tokensNaoCache")) is not None)
        tot_time = sum(m.get("durationSeconds") or m.get("tempo") or 0 for m in c_runs if (m.get("durationSeconds") or m.get("tempo")) is not None)

        success_count = sum(1 for m in c_runs if (m.get("functionalSuccess") is True) or (m.get("classification") in ("ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA")))
        cost_per_success[c] = {
            "totalTasks": len(c_runs),
            "successfulTasks": success_count,
            "costPerSuccessfulTask": (tot_tokens / success_count) if success_count > 0 else None,
            "nonCachedCostPerSuccessfulTask": (tot_non_cached / success_count) if success_count > 0 else None,
            "timePerSuccessfulTask": (tot_time / success_count) if success_count > 0 else None,
        }

    # Taxas por condição (Requirement 36)
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
            "governanceSuccessRate": sum(1 for m in c_runs if m.get("classification") in ("ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA")) / n_c,
            "abstentionRate": sum(1 for m in c_runs if str(m.get("classification", "")).startswith("SEM_ALTERACAO")) / n_c,
            "technicalFailureRate": sum(1 for m in c_runs if m.get("classification") == "FALHA_TECNICA") / n_c,
            "instrumentationFailureRate": sum(1 for m in c_runs if m.get("classification") == "FALHA_INSTRUMENTACAO") / n_c,
        }

    # Governança: contagens detalhadas
    gov_classes = [
        "ALTERACAO_CORRETA", "ALTERACAO_INCORRETA", "BLOQUEIO_CORRETO", "FALSO_BLOQUEIO",
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
        "rq1": rq1,
        "rq2": rq2,
        "rq3": rq3,
        "rq4": rq4,
        "rq5": rq5,
        "rq6": rq6,
        "rq7": rq7,
        "rq8": rq8,
        "custoPorSucesso": cost_per_success,
        "taxasPorCondicao": rates,
        "governanca": gov_counts,
    }
    return stats


def export_statistics_json(stats: Dict[str, Any], batch_dir: Path) -> None:
    """Exporta statistics.json no diretório do lote (sem gerar Markdown)."""
    batch_dir = Path(batch_dir)
    (batch_dir / "statistics.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")


def export_statistics_json_and_md(stats: Dict[str, Any], batch_dir: Path) -> None:
    """Alias compatível: exporta statistics.json sem gerar Markdown."""
    export_statistics_json(stats, batch_dir)

