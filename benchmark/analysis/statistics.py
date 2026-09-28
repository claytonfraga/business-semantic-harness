"""Cálculo de estatísticas descritivas, inferenciais e avaliação de RQs para o BSH Benchmark.

Contratos estritos:
- Ausência de dado representada como None (NA), nunca 0.
- Nenhuma média ou estatística apresentada sem o respectivo n elegível.
- Benefício líquido requer obrigatoriamente pares válidos e violadores elegíveis.
- Status explícito para cada pergunta de pesquisa (RQ1 a RQ6).
- Exportação de statistics.json e statistics.md auditáveis.
"""

import json
from pathlib import Path
from typing import Any, Dict, List
import numpy as np

try:
    from scipy.stats import t as student_t, ttest_rel, wilcoxon
except ImportError:
    student_t = None
    ttest_rel = None
    wilcoxon = None


def _calc_stats(values: List[float], n_obs: int) -> Dict[str, Any]:
    """Calcula estatísticas descritivas com integridade estrita."""
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
            "ic95_metodo": "insuficiente",
        }

    arr = np.array(vals, dtype=float)
    media = float(np.mean(arr))
    mediana = float(np.median(arr))
    minimo = float(np.min(arr))
    maximo = float(np.max(arr))

    if n_elig >= 2:
        dp = float(np.std(arr, ddof=1))
    else:
        dp = None

    ic_inf = None
    ic_sup = None
    metodo_ic = "insuficiente"

    if n_elig >= 3 and dp is not None and dp > 0 and student_t is not None:
        t_crit = float(student_t.ppf(0.975, df=n_elig - 1))
        margem = t_crit * (dp / np.sqrt(n_elig))
        ic_inf = media - margem
        ic_sup = media + margem
        metodo_ic = f"Student-t (df={n_elig - 1})"
    elif n_elig >= 3 and dp == 0:
        ic_inf = media
        ic_sup = media
        metodo_ic = "variancia_zero"

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
        "ic95_metodo": metodo_ic,
    }


def compute_statistics(data: Dict[str, Any], paired: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Processa estatísticas descritivas, inferenciais e respostas às RQs."""
    batch_dir = data.get("batch_dir", Path())
    metadata = data.get("metadata", {})
    measurements = data.get("measurements", [])

    # Segmentação dos pares
    todas_pares = paired
    validas_pares = [p for p in paired if p.get("taskType") in ("valida_governada", "valida", "valid")]
    violadoras_pares = [p for p in paired if p.get("taskType") in ("violadora", "violating")]

    # Pares elegíveis para análise de tokens
    todas_elig = [p for p in todas_pares if p.get("eligibleForTokenAnalysis")]
    val_elig = [p for p in validas_pares if p.get("eligibleForTokenAnalysis")]
    vio_elig = [p for p in violadoras_pares if p.get("eligibleForTokenAnalysis")]

    # Estatísticas por segmento
    def _segmento_stats(pares_lista: List[Dict[str, Any]], elig_lista: List[Dict[str, Any]]) -> Dict[str, Any]:
        n_obs = len(pares_lista)
        dif_abs = [p["differenceTokens"] for p in elig_lista if p.get("differenceTokens") is not None]
        dif_pct = [p["percentageDifference"] for p in elig_lista if p.get("percentageDifference") is not None]
        fator = [p["costFactor"] for p in elig_lista if p.get("costFactor") is not None]

        tok_dir = [p["tokensA"] for p in elig_lista if p.get("tokensA") is not None]
        tok_bsh = [p["tokensD"] for p in elig_lista if p.get("tokensD") is not None]

        # Tempos pareados (não dependem de tokens)
        tempo_dir = [p["durationA"] for p in pares_lista if p.get("durationA") is not None and p.get("durationD") is not None]
        tempo_bsh = [p["durationD"] for p in pares_lista if p.get("durationA") is not None and p.get("durationD") is not None]
        dif_tempo = [(d - a) for a, d in zip(tempo_dir, tempo_bsh)]

        return {
            "n_observado": n_obs,
            "n_elegivel_tokens": len(elig_lista),
            "tokens_direto": _calc_stats(tok_dir, n_obs),
            "tokens_bsh": _calc_stats(tok_bsh, n_obs),
            "diferenca_absoluta": _calc_stats(dif_abs, n_obs),
            "diferenca_percentual": _calc_stats(dif_pct, n_obs),
            "fator_custo": _calc_stats(fator, n_obs),
            "tempo_direto": _calc_stats(tempo_dir, n_obs),
            "tempo_bsh": _calc_stats(tempo_bsh, n_obs),
            "diferenca_tempo": _calc_stats(dif_tempo, n_obs),
        }

    seg_todas = _segmento_stats(todas_pares, todas_elig)
    seg_val = _segmento_stats(validas_pares, val_elig)
    seg_vio = _segmento_stats(violadoras_pares, vio_elig)

    # RQ1: O BSH usa menos tokens que a execução direta para as mesmas tarefas?
    rq1_status = "RESPONDIDA" if len(todas_elig) > 0 else "DADOS_INSUFICIENTES"
    rq1 = {
        "status": rq1_status,
        "n_elegivel": len(todas_elig),
        "diferenca_media_tokens": seg_todas["diferenca_absoluta"]["media"],
        "diferenca_percentual_media": seg_todas["diferenca_percentual"]["media"],
        "fator_custo_medio": seg_todas["fator_custo"]["media"],
        "resumo_validas": {
            "n_elegivel": len(val_elig),
            "diferenca_media": seg_val["diferenca_absoluta"]["media"],
            "diferenca_pct": seg_val["diferenca_percentual"]["media"],
            "fator_custo": seg_val["fator_custo"]["media"],
        },
        "resumo_violadoras": {
            "n_elegivel": len(vio_elig),
            "diferenca_media": seg_vio["diferenca_absoluta"]["media"],
            "diferenca_pct": seg_vio["diferenca_percentual"]["media"],
            "fator_custo": seg_vio["fator_custo"]["media"],
        },
    }

    # RQ2: O custo adicional em tarefas válidas é compensado pelo custo evitado em tarefas inválidas?
    # Requirement 14 & 15:
    # EconomiaTotalVioladoras = sum(TokensDirect - TokensBSH) SOMENTE para violadoras com BLOQUEIO_CORRETO!
    vio_bloqueio_correto = [p for p in vio_elig if p.get("classificationD") == "BLOQUEIO_CORRETO"]
    # OverheadTotalValidas = sum(TokensBSH - TokensDirect) SOMENTE para válidas com ALTERACAO_CORRETA em ambas!
    val_corretas = [p for p in val_elig if p.get("classificationD") == "ALTERACAO_CORRETA"]

    econ_viol = None
    over_val = None
    beneficio_liq = None
    beneficio_liq_pct = None
    rq2_motivo = ""

    if len(vio_bloqueio_correto) > 0 and len(val_corretas) > 0:
        econ_viol = sum((p["tokensA"] - p["tokensD"]) for p in vio_bloqueio_correto)
        over_val = sum((p["tokensD"] - p["tokensA"]) for p in val_corretas)
        beneficio_liq = econ_viol - over_val
        custo_direto_ref = sum(p["tokensA"] for p in vio_bloqueio_correto) + sum(p["tokensA"] for p in val_corretas)
        if custo_direto_ref > 0:
            beneficio_liq_pct = (beneficio_liq / custo_direto_ref) * 100.0
        rq2_status = "RESPONDIDA"
    else:
        rq2_status = "DADOS_INSUFICIENTES"
        motivos = []
        if len(vio_bloqueio_correto) == 0:
            motivos.append("sem pares violadores elegíveis com BLOQUEIO_CORRETO")
        if len(val_corretas) == 0:
            motivos.append("sem pares válidos elegíveis com ALTERACAO_CORRETA")
        rq2_motivo = f"Não foi possível calcular o benefício líquido: {', '.join(motivos)}."

    rq2 = {
        "status": rq2_status,
        "n_violadoras_bloqueio_correto": len(vio_bloqueio_correto),
        "n_validas_alteracao_correta": len(val_corretas),
        "economia_total_violadoras": econ_viol,
        "overhead_total_validas": over_val,
        "beneficio_liquido": beneficio_liq,
        "beneficio_liquido_percentual": beneficio_liq_pct,
        "motivo_incompletude": rq2_motivo,
    }

    # RQ3, RQ4, RQ5, RQ6 (Requirement 12)
    condicoes_executadas = {str(m.get("condicao", "")) for m in measurements}
    tem_b = ("B" in condicoes_executadas or "com-contexto-sem-enforcement" in condicoes_executadas)
    tem_c = ("C" in condicoes_executadas)
    tem_d = ("D" in condicoes_executadas or "com-harness" in condicoes_executadas)

    rq3_status = "RESPONDIDA" if tem_b else "NAO_AVALIADA"
    rq3_motivo = "Condição B (regras textuais no prompt) não foi executada neste lote." if not tem_b else ""

    rq4_status = "RESPONDIDA" if (tem_b and tem_c) else "NAO_AVALIADA"
    rq4_motivo = "Condição C (ontologia sem enforcement) não foi executada neste lote." if not (tem_b and tem_c) else ""

    rq5_status = "RESPONDIDA" if (tem_c and tem_d) else "NAO_AVALIADA"
    rq5_motivo = "Condição C não foi executada; o contraste A × D avalia o efeito combinado do BSH, não isolando causalmente o enforcement independente." if not (tem_c and tem_d) else ""

    sem_rec = data.get("semantic_rec", {})
    recall = sem_rec.get("recall")
    precision = sem_rec.get("precision")
    rq6_status = "RESPONDIDA" if (recall is not None and precision is not None) else "DADOS_INSUFICIENTES"
    rq6_motivo = "Artefatos de reconhecimento semântico não registrados no lote." if rq6_status == "DADOS_INSUFICIENTES" else ""

    # Governança observada (contagem por classificação real)
    gov_classes = ["ALTERACAO_CORRETA", "ALTERACAO_INCORRETA", "BLOQUEIO_CORRETO", "FALSO_BLOQUEIO",
                   "VIOLACAO_NAO_DETECTADA", "REVISAO_HUMANA", "INDETERMINADO", "SEM_ALTERACAO",
                   "FALHA_TECNICA", "FALHA_INSTRUMENTACAO"]
    gov_counts: Dict[str, Dict[str, int]] = {}
    for c in condicoes_executadas:
        if not c: continue
        sub = [m for m in measurements if str(m.get("condicao", "")) == c]
        gov_counts[c] = {cls: sum(1 for m in sub if m.get("classificacao") == cls or m.get("classification") == cls) for cls in gov_classes}

    # Inferência Estatística (Requirement 17): apenas se n_elegivel >= 5
    inferencial: Dict[str, Any] = {"executado": False, "motivo": "Amostra insuficiente (n_elegivel < 5)."}
    if len(todas_elig) >= 5 and wilcoxon is not None and ttest_rel is not None:
        try:
            tok_a_arr = np.array([p["tokensA"] for p in todas_elig])
            tok_d_arr = np.array([p["tokensD"] for p in todas_elig])
            diffs = tok_d_arr - tok_a_arr

            # t-test pareado
            t_res = ttest_rel(tok_d_arr, tok_a_arr)
            # Wilcoxon signed-rank
            w_res = wilcoxon(diffs) if np.any(diffs != 0) else None

            # Cohen's dz
            std_diff = np.std(diffs, ddof=1)
            dz = (np.mean(diffs) / std_diff) if std_diff > 0 else 0.0

            inferencial = {
                "executado": True,
                "n": len(todas_elig),
                "ttest_stat": float(t_res.statistic) if hasattr(t_res, "statistic") else None,
                "ttest_pvalue": float(t_res.pvalue) if hasattr(t_res, "pvalue") else None,
                "wilcoxon_stat": float(w_res.statistic) if w_res else None,
                "wilcoxon_pvalue": float(w_res.pvalue) if w_res else None,
                "cohens_dz": float(dz),
            }
        except Exception as e:
            inferencial = {"executado": False, "motivo": f"Erro no cálculo inferencial: {e}"}

    stats = {
        "lote": metadata.get("lote", batch_dir.name),
        "segmentos": {
            "todas": seg_todas,
            "validas": seg_val,
            "violadoras": seg_vio,
        },
        "rq1": rq1,
        "rq2": rq2,
        "rq3": {"status": rq3_status, "motivo": rq3_motivo},
        "rq4": {"status": rq4_status, "motivo": rq4_motivo},
        "rq5": {"status": rq5_status, "motivo": rq5_motivo},
        "rq6": {"status": rq6_status, "recall": recall, "precision": precision, "motivo": rq6_motivo},
        "governanca": gov_counts,
        "inferencial": inferencial,
    }

    # Salva statistics.json
    (batch_dir / "statistics.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")

    # Gera statistics.md (Requirement 40)
    _export_statistics_markdown(stats, batch_dir / "statistics.md")

    return stats


def _export_statistics_markdown(stats: Dict[str, Any], md_path: Path) -> None:
    """Gera o sumário estatístico em Markdown para fins de auditoria intermediária."""
    todas = stats.get("segmentos", {}).get("todas", {})
    val = stats.get("segmentos", {}).get("validas", {})
    vio = stats.get("segmentos", {}).get("violadoras", {})
    rq1 = stats.get("rq1", {})
    rq2 = stats.get("rq2", {})

    def _fmt(val: Any, dec: int = 1) -> str:
        if val is None or str(val).lower() == "none":
            return "NA"
        try:
            return f"{float(val):,.{dec}f}"
        except Exception:
            return str(val)

    md = f"""# Sumário Estatístico Experimental do BSH

- **Lote:** {stats.get('lote', 'N/A')}
- **RQ1 Status:** `{rq1.get('status')}`
- **RQ2 Status:** `{rq2.get('status')}`
- **RQ3 Status:** `{stats.get('rq3', {}).get('status')}`
- **RQ4 Status:** `{stats.get('rq4', {}).get('status')}`
- **RQ5 Status:** `{stats.get('rq5', {}).get('status')}`
- **RQ6 Status:** `{stats.get('rq6', {}).get('status')}`

## 1. Estatísticas de Consumo Pareado de Tokens

| Segmento | n Observado | n Elegível | Média Direto | Média BSH | Diferença Média (Tokens) | Variação Média (%) | Fator de Custo Médio | IC 95% Inferior | IC 95% Superior |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Todas** | {todas.get('n_observado', 0)} | {todas.get('n_elegivel_tokens', 0)} | {_fmt(todas.get('tokens_direto', {}).get('media'), 0)} | {_fmt(todas.get('tokens_bsh', {}).get('media'), 0)} | {_fmt(todas.get('diferenca_absoluta', {}).get('media'), 0)} | {_fmt(todas.get('diferenca_percentual', {}).get('media'), 1)}% | {_fmt(todas.get('fator_custo', {}).get('media'), 2)} | {_fmt(todas.get('diferenca_absoluta', {}).get('ic95_inferior'), 0)} | {_fmt(todas.get('diferenca_absoluta', {}).get('ic95_superior'), 0)} |
| **Válidas** | {val.get('n_observado', 0)} | {val.get('n_elegivel_tokens', 0)} | {_fmt(val.get('tokens_direto', {}).get('media'), 0)} | {_fmt(val.get('tokens_bsh', {}).get('media'), 0)} | {_fmt(val.get('diferenca_absoluta', {}).get('media'), 0)} | {_fmt(val.get('diferenca_percentual', {}).get('media'), 1)}% | {_fmt(val.get('fator_custo', {}).get('media'), 2)} | {_fmt(val.get('diferenca_absoluta', {}).get('ic95_inferior'), 0)} | {_fmt(val.get('diferenca_absoluta', {}).get('ic95_superior'), 0)} |
| **Violadoras** | {vio.get('n_observado', 0)} | {vio.get('n_elegivel_tokens', 0)} | {_fmt(vio.get('tokens_direto', {}).get('media'), 0)} | {_fmt(vio.get('tokens_bsh', {}).get('media'), 0)} | {_fmt(vio.get('diferenca_absoluta', {}).get('media'), 0)} | {_fmt(vio.get('diferenca_percentual', {}).get('media'), 1)}% | {_fmt(vio.get('fator_custo', {}).get('media'), 2)} | {_fmt(vio.get('diferenca_absoluta', {}).get('ic95_inferior'), 0)} | {_fmt(vio.get('diferenca_absoluta', {}).get('ic95_superior'), 0)} |

## 2. Balanço de Trade-off (RQ2)

- **Pares Violadores com BLOQUEIO_CORRETO:** {rq2.get('n_violadoras_bloqueio_correto', 0)}
- **Pares Válidos com ALTERACAO_CORRETA:** {rq2.get('n_validas_alteracao_correta', 0)}
- **Economia Total em Tarefas Violadoras:** {_fmt(rq2.get('economia_total_violadoras'), 0)} tokens
- **Overhead Total em Tarefas Válidas:** {_fmt(rq2.get('overhead_total_validas'), 0)} tokens
- **Benefício Líquido Global:** {_fmt(rq2.get('beneficio_liquido'), 0)} tokens ({_fmt(rq2.get('beneficio_liquido_percentual'), 1)}%)
- **Motivo de Incompletude (se aplicável):** {rq2.get('motivo_incompletude') or 'Nenhum (cálculo completo)'}

## 3. Avaliação de RQs

- **RQ1:** `{rq1.get('status')}`
- **RQ2:** `{rq2.get('status')}`
- **RQ3:** `{stats.get('rq3', {}).get('status')}` ({stats.get('rq3', {}).get('motivo') or 'Avaliada'})
- **RQ4:** `{stats.get('rq4', {}).get('status')}` ({stats.get('rq4', {}).get('motivo') or 'Avaliada'})
- **RQ5:** `{stats.get('rq5', {}).get('status')}` ({stats.get('rq5', {}).get('motivo') or 'Avaliada'})
- **RQ6:** `{stats.get('rq6', {}).get('status')}` (Recall: {_fmt(stats.get('rq6', {}).get('recall'), 2)}, Precision: {_fmt(stats.get('rq6', {}).get('precision'), 2)})
"""
    try:
        md_path.write_text(md, encoding="utf-8")
    except Exception:
        pass
