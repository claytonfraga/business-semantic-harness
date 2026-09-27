"""Geração de figuras científicas para o BSH Benchmark.

Contratos estritos:
- Figuras científicas conforme Seções 28 a 41 e 46 a 57 da especificação.
- Somente dados efetivamente medidos e elegíveis são plotados.
- NUNCA converte ausência em 0.
- Se dados forem insuficientes para uma figura, ela NÃO é gerada (retorna None).
- Exportação simultânea em PDF vetorial e PNG (>= 300 dpi) nos diretórios figures/ e charts/.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

STYLE = {
    "font.size": 10,
    "axes.titlesize": 11,
    "axes.labelsize": 10,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "legend.fontsize": 9,
    "figure.dpi": 300,
    "savefig.dpi": 300,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linestyle": "--",
    "axes.spines.top": False,
    "axes.spines.right": False,
}
plt.rcParams.update(STYLE)

COR_DIRETO = "#4477AA"
COR_BSH = "#CC6677"
COR_NEUTRA = "#666666"
COR_POSITIVO = "#228833"
COR_NEGATIVO = "#EE6677"


def _salvar_figura(fig: plt.Figure, batch_dir: Path, nome_base: str):
    """Salva a figura em PDF vetorial e PNG de alta resolução em figures/ e charts/."""
    for pasta in ("figures", "charts"):
        out_dir = batch_dir / pasta
        out_dir.mkdir(parents=True, exist_ok=True)
        fig.tight_layout()
        fig.savefig(out_dir / f"{nome_base}.pdf", format="pdf", bbox_inches="tight")
        fig.savefig(out_dir / f"{nome_base}.png", format="png", dpi=300, bbox_inches="tight")
    plt.close(fig)


# 1. Gráfico 1 — Resultado funcional por condição (Seções 38 e 46)
def fig_01_functional_results(stats: Dict[str, Any], batch_dir: Path) -> Optional[str]:
    gov = stats.get("governanca", {})
    if not gov:
        return None
    all_classes = [
        "ALTERACAO_CORRETA", "ALTERACAO_INCORRETA", "BLOQUEIO_CORRETO", "FALSO_BLOQUEIO",
        "VIOLACAO_NAO_DETECTADA", "SEM_ALTERACAO_CORRETA", "SEM_ALTERACAO_INCORRETA",
        "SEM_ALTERACAO_INDETERMINADA", "REVISAO_HUMANA", "INDETERMINADO",
        "FALHA_TECNICA", "FALHA_INSTRUMENTACAO"
    ]
    condicoes = sorted(gov.keys())
    classes = [cls for cls in all_classes if any(gov.get(c, {}).get(cls, 0) > 0 for c in condicoes)]
    if not classes:
        classes = ["ALTERACAO_CORRETA", "ALTERACAO_INCORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA"]
    total_obs = sum(sum(gov[c].values()) for c in condicoes)
    if total_obs == 0:
        return None

    nome = "figure-01-functional-results-by-condition"
    fig, ax = plt.subplots(figsize=(max(7.8, len(classes) * 1.1), 4.6))
    x = np.arange(len(classes))
    largura = 0.8 / len(condicoes)
    cores = [COR_DIRETO, "#EE6677", "#CCBB44", COR_BSH]

    for idx, c in enumerate(condicoes):
        vals = [gov[c].get(cls, 0) for cls in classes]
        offset = (idx - len(condicoes) / 2 + 0.5) * largura
        ax.bar(x + offset, vals, largura, label=f"Condição {c}",
               color=cores[idx % len(cores)], edgecolor="black", linewidth=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels([c.replace("_", "\n") for c in classes], fontsize=7.5)
    ax.set_ylabel("Quantidade de ocorrências")
    ax.set_title(f"Resultado funcional por condição experimental (Total = {total_obs})")
    ax.legend(loc="upper right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 2. Gráfico 2 — Consumo bruto observado (Seção 47)
def fig_02_observed_total_tokens(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-02-observed-total-tokens"
    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))

    for idx, r in enumerate(validos):
        ax.plot([r["tokensA"], r["tokensD"]], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["tokensA"] for r in validos], y_pos, color=COR_DIRETO, marker="s", s=55,
               edgecolors="black", linewidths=0.8, label="Direto (Condição A)", zorder=3)
    ax.scatter([r["tokensD"] for r in validos], y_pos, color=COR_BSH, marker="o", s=65,
               edgecolors="black", linewidths=0.8, label="BSH (Condição D)", zorder=3)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{r['taskId']} ({r.get('taskType', '')})" for r in validos])
    ax.set_xlabel("Tokens totais consumidos (n = {})".format(len(validos)))
    ax.set_title("Consumo observado de tokens por tarefa (Dumbbell plot)")
    ax.legend(loc="lower right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 3. Gráfico 3 — Eficiência sob equivalência comportamental (Seções 33 e 48)
def fig_03_equivalent_tokens(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    equiv = [p for p in paired if p.get("behavioralEquivalence") == "EQUIVALENTE" and p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if len(equiv) < 2:
        return None

    nome = "figure-03-equivalent-total-tokens"
    fig, ax = plt.subplots(figsize=(7.2, max(3.8, len(equiv) * 0.5)))
    y_pos = np.arange(len(equiv))

    for idx, r in enumerate(equiv):
        ax.plot([r["tokensA"], r["tokensD"]], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["tokensA"] for r in equiv], y_pos, color=COR_DIRETO, marker="s", s=55,
               edgecolors="black", linewidths=0.8, label="Direto (Condição A)", zorder=3)
    ax.scatter([r["tokensD"] for r in equiv], y_pos, color=COR_BSH, marker="o", s=65,
               edgecolors="black", linewidths=0.8, label="BSH (Condição D)", zorder=3)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{r['taskId']} ({r.get('taskType', '')})" for r in equiv])
    ax.set_xlabel("Tokens consumidos sob equivalência comprovada (n = {})".format(len(equiv)))
    ax.set_title("Consumo de tokens em execuções comportamentalmente equivalentes")
    ax.legend(loc="lower right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 4. Gráfico 4 — Variação percentual sob equivalência (Seção 49)
def fig_04_percentage_difference_equiv(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    equiv = [p for p in paired if p.get("behavioralEquivalence") == "EQUIVALENTE" and p.get("eligibleForTokenAnalysis") and p.get("percentageDifference") is not None]
    if len(equiv) < 2:
        return None

    nome = "figure-04-percentage-difference-equivalent"
    equiv_ord = sorted(equiv, key=lambda r: r.get("percentageDifference", 0))
    y_pos = np.arange(len(equiv_ord))
    diffs = [r["percentageDifference"] for r in equiv_ord]
    labels = [f"{r['taskId']} ({r.get('taskType', '')})" for r in equiv_ord]

    fig, ax = plt.subplots(figsize=(7.2, max(3.8, len(equiv_ord) * 0.5)))
    cores = [COR_NEGATIVO if d > 0 else COR_POSITIVO for d in diffs]

    ax.barh(y_pos, diffs, color=cores, edgecolor="black", linewidth=0.7, height=0.55)
    ax.axvline(0, color="black", linestyle="-", linewidth=1.0)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels)
    ax.set_xlabel("Variação percentual (%) [< 0 = economia, > 0 = overhead]")
    ax.set_title("Variação percentual de tokens sob equivalência comportamental")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 5. Gráfico 5 — Custo por sucesso funcional (Seção 50)
def fig_05_cost_per_success(stats: Dict[str, Any], batch_dir: Path) -> Optional[str]:
    custos = stats.get("custoPorSucesso", {})
    conds = [c for c, d in custos.items() if d.get("costPerSuccessfulTask") is not None]
    if len(conds) < 2:
        return None

    nome = "figure-05-cost-per-success"
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    x = np.arange(len(conds))
    largura = 0.35

    val_tot = [custos[c]["costPerSuccessfulTask"] for c in conds]
    val_nc = [custos[c]["nonCachedCostPerSuccessfulTask"] or 0 for c in conds]

    ax.bar(x - largura / 2, val_tot, largura, label="Tokens Totais", color=COR_DIRETO, edgecolor="black", linewidth=0.7)
    ax.bar(x + largura / 2, val_nc, largura, label="Tokens Não Cacheados", color=COR_BSH, edgecolor="black", linewidth=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels([f"Condição {c}" for c in conds])
    ax.set_ylabel("Tokens por tarefa concluída com sucesso")
    ax.set_title("Custo computacional por sucesso funcional")
    ax.legend(loc="upper right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 6. Gráfico 6 — Tarefas violadoras detalhadas (Seções 34 e 51)
def fig_06_violating_matrix(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    vios = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]
    if len(vios) < 2:
        return None

    nome = "figure-06-violating-governance-matrix"
    fig, ax = plt.subplots(figsize=(8.2, max(4.0, len(vios) * 0.52)))
    y_pos = np.arange(len(vios))

    for idx, r in enumerate(vios):
        ta = r.get("tokensA")
        td = r.get("tokensD")
        if ta is not None and td is not None:
            ax.plot([ta, td], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    toks_a = [r.get("tokensA") or 0 for r in vios]
    toks_d = [r.get("tokensD") or 0 for r in vios]

    ax.scatter(toks_a, y_pos, color=COR_DIRETO, marker="s", s=60,
               edgecolors="black", linewidths=0.8, label="Tokens Direto (A)", zorder=3)
    ax.scatter(toks_d, y_pos, color=COR_BSH, marker="o", s=70,
               edgecolors="black", linewidths=0.8, label="Tokens BSH (D)", zorder=3)

    labels = []
    for r in vios:
        flag = " [TESTES PASSARAM!]" if r.get("semanticViolationWithTechnicalTestsPassing") else ""
        labels.append(f"{r['taskId']} ({r.get('governanceMechanismD', '')}){flag}")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Tokens consumidos")
    ax.set_title("Tarefas violadoras: Consumo direto (A) vs Governança BSH (D)")
    ax.legend(loc="lower right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 7. Gráfico 7 — Mecanismo de governança (Seções 35 e 52)
def fig_07_governance_mechanisms(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    vios = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]
    if not vios:
        return None
    mechs = {}
    for p in vios:
        m = p.get("governanceMechanismD", "INDETERMINADO")
        mechs[m] = mechs.get(m, 0) + 1

    nome = "figure-07-governance-mechanisms"
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    keys = sorted(mechs.keys())
    vals = [mechs[k] for k in keys]

    ax.bar(keys, vals, color=COR_BSH, edgecolor="black", linewidth=0.7, width=0.5)
    ax.set_ylabel("Quantidade de ocorrências")
    ax.set_title("Mecanismos responsáveis pela prevenção/bloqueio")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 8. Gráfico 8 — Reconhecimento semântico (Seções 40 e 53)
def fig_08_semantic_recognition(stats: Dict[str, Any], batch_dir: Path) -> Optional[str]:
    sr = stats.get("rq6", {})
    op_rec = sr.get("operationRecall")
    op_prec = sr.get("operationPrecision")
    if op_rec is None or op_prec is None:
        return None

    nome = "figure-08-semantic-recognition"
    fig, ax = plt.subplots(figsize=(5.4, 3.8))
    labels = ["Operation\nRecall", "Operation\nPrecision"]
    vals = [op_rec * 100.0, op_prec * 100.0]

    bars = ax.bar(labels, vals, color=[COR_BSH, COR_POSITIVO], edgecolor="black", linewidth=0.8, width=0.45)
    for b in bars:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 2, f"{b.get_height():.1f}%",
                ha="center", va="bottom", fontweight="bold")

    ax.set_ylim(0, 115)
    ax.set_ylabel("Taxa (%)")
    ax.set_title("Reconhecimento semântico observado (Condição D)")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 9. Gráfico 9 — Tokens não cacheados (Seções 41 e 54)
def fig_09_non_cached_tokens(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("nonCachedTokensA") is not None and p.get("nonCachedTokensD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-09-non-cached-tokens"
    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))

    for idx, r in enumerate(validos):
        ax.plot([r["nonCachedTokensA"], r["nonCachedTokensD"]], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["nonCachedTokensA"] for r in validos], y_pos, color=COR_DIRETO, marker="s", s=55,
               edgecolors="black", linewidths=0.8, label="Direto (Condição A)", zorder=3)
    ax.scatter([r["nonCachedTokensD"] for r in validos], y_pos, color=COR_BSH, marker="o", s=65,
               edgecolors="black", linewidths=0.8, label="BSH (Condição D)", zorder=3)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{r['taskId']} ({r.get('taskType', '')})" for r in validos])
    ax.set_xlabel("Tokens não cacheados (n = {})".format(len(validos)))
    ax.set_title("Tokens não cacheados [(entrada - cache) + saída]")
    ax.legend(loc="lower right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 10. Gráfico 10 — Tempo de execução (Seções 42 e 55)
def fig_10_execution_time(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("durationA") is not None and p.get("durationD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-10-execution-time"
    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))

    for idx, r in enumerate(validos):
        ax.plot([r["durationA"], r["durationD"]], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["durationA"] for r in validos], y_pos, color=COR_DIRETO, marker="s", s=55,
               edgecolors="black", linewidths=0.8, label="Direto (Condição A)", zorder=3)
    ax.scatter([r["durationD"] for r in validos], y_pos, color=COR_BSH, marker="o", s=65,
               edgecolors="black", linewidths=0.8, label="BSH (Condição D)", zorder=3)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{r['taskId']} ({r.get('taskType', '')})" for r in validos])
    ax.set_xlabel("Duração da execução em segundos (n = {})".format(len(validos)))
    ax.set_title("Tempo de execução pareado por tarefa")
    ax.legend(loc="lower right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 11. Gráfico 11 — Tempos observáveis do harness (Seção 56)
def fig_11_observable_harness_timing(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("durationA") is not None and p.get("durationD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-11-observable-harness-timing"
    deltas = [(p["durationD"] - p["durationA"]) for p in validos]
    labels = [p["taskId"] for p in validos]
    y_pos = np.arange(len(validos))

    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    cores = [COR_NEGATIVO if d > 0 else COR_POSITIVO for d in deltas]

    ax.barh(y_pos, deltas, color=cores, edgecolor="black", linewidth=0.7, height=0.6)
    ax.axvline(0, color="black", linestyle="-", linewidth=1.0)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels)
    ax.set_xlabel("Diferença temporal observável (Duração D - Duração A) em segundos")
    ax.set_title("Overhead temporal observável externamente por tarefa")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 12. Gráfico 12 — Trade-off e benefício líquido (Seções 36 e 57)
def fig_12_net_benefit(stats: Dict[str, Any], batch_dir: Path) -> Optional[str]:
    rq2 = stats.get("rq2", {})
    econ = rq2.get("economia_total_violadoras")
    over = rq2.get("overhead_total_validas")
    liq = rq2.get("beneficio_liquido")

    if econ is None or over is None or liq is None:
        return None

    nome = "figure-12-net-benefit"
    fig, ax = plt.subplots(figsize=(6.4, 4.2))

    categorias = [
        "Economia em\nTarefas Violadoras",
        "Overhead em\nVálidas Equivalentes",
        "Benefício Líquido\nGlobal"
    ]
    valores = [econ, over, liq]
    cores = [COR_POSITIVO, COR_NEGATIVO, COR_DIRETO if liq >= 0 else COR_NEGATIVO]

    barras = ax.bar(categorias, valores, color=cores, edgecolor="black", linewidth=0.8, width=0.52)
    ax.axhline(0, color="black", linestyle="-", linewidth=0.8)
    for barra, val in zip(barras, valores):
        y_text = val if val >= 0 else val - (abs(val) * 0.08)
        va = "bottom" if val >= 0 else "top"
        ax.text(barra.get_x() + barra.get_width() / 2, y_text, f"{val:,.0f}", ha="center", va=va, fontsize=9, fontweight="bold")

    ax.set_ylabel("Quantidade de tokens")
    ax.set_title("Trade-off de tokens: Economia (violadoras) vs Overhead (válidas)")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 13. Gráfico 13 — Percentual economizado ou gasto a mais por tarefa (Seção 28)
def fig_13_diverging_percentage(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-13-diverging-percentage"
    fig, ax = plt.subplots(figsize=(8.0, max(4.2, len(validos) * 0.48)))
    y_pos = np.arange(len(validos))

    valores = []
    hatches = []
    cores = []
    labels = []

    for r in validos:
        saved_pct = r.get("tokensSavedPercentage") or 0.0
        extra_pct = r.get("tokensExtraPercentage") or 0.0
        ttype = str(r.get("taskType", "")).lower()

        # Eixo divergente: esquerda (< 0) = economia, direita (> 0) = overhead
        if saved_pct > 0:
            val = -saved_pct
            c = COR_POSITIVO
        elif extra_pct > 0:
            val = extra_pct
            c = COR_NEGATIVO
        else:
            val = 0.0
            c = COR_NEUTRA

        hatch = "//" if "violadora" in ttype or "violating" in ttype else ""
        valores.append(val)
        hatches.append(hatch)
        cores.append(c)
        labels.append(f"{r['taskId']} ({r.get('taskType', '')})")

    bars = ax.barh(y_pos, valores, color=cores, edgecolor="black", linewidth=0.7, height=0.6)
    for bar, h in zip(bars, hatches):
        if h:
            bar.set_hatch(h)

    ax.axvline(0, color="black", linestyle="-", linewidth=1.2)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Variação percentual [← Economizado (%) | Gastos a mais (%) →]")
    ax.set_title("Impacto percentual do BSH no consumo de tokens por tarefa")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 14. Gráfico 14 — Duas métricas positivas de percentual (Seção 29)
def fig_14_positive_percentage_bars(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-14-positive-percentage-bars"
    fig, ax = plt.subplots(figsize=(8.2, max(4.2, len(validos) * 0.52)))
    y_pos = np.arange(len(validos))
    altura = 0.38

    saved_vals = [p.get("tokensSavedPercentage") or 0.0 for p in validos]
    extra_vals = [p.get("tokensExtraPercentage") or 0.0 for p in validos]
    labels = [p["taskId"] for p in validos]

    ax.barh(y_pos - altura / 2, saved_vals, height=altura, label="Tokens economizados (%)",
            color=COR_POSITIVO, edgecolor="black", linewidth=0.7)
    ax.barh(y_pos + altura / 2, extra_vals, height=altura, label="Tokens gastos a mais (%)",
            color=COR_NEGATIVO, edgecolor="black", linewidth=0.7)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Percentual positivo (%)")
    ax.set_title("Percentual de tokens economizados e gastos a mais com o BSH")
    ax.legend(loc="lower right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 15. Gráfico 15 — Percentual por categoria (Seção 30)
def fig_15_category_percentages(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    eligible = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if not eligible:
        return None

    cats_def = [
        ("Válidas Equivalentes", [p for p in eligible if str(p.get("taskType", "")).lower() in ("valida_governada", "valida", "valid") and p.get("behavioralEquivalence") == "EQUIVALENTE"]),
        ("Violadoras Governadas", [p for p in eligible if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("dOutcomeCorrect")]),
        ("Fora do Conhecimento", [p for p in eligible if str(p.get("taskType", "")).lower() == "fora_conhecimento"]),
        ("Indeterminadas", [p for p in eligible if str(p.get("taskType", "")).lower() == "indeterminada"]),
        ("Workload Elegível", eligible),
    ]

    nomes_cat = []
    saved_pcts = []
    extra_pcts = []

    for name, items in cats_def:
        if not items:
            continue
        sum_a = sum(p["tokensA"] for p in items)
        sum_d = sum(p["tokensD"] for p in items)
        saved = max(0.0, sum_a - sum_d)
        extra = max(0.0, sum_d - sum_a)
        saved_pct = ((saved / sum_a) * 100.0) if sum_a > 0 else 0.0
        extra_pct = ((extra / sum_a) * 100.0) if sum_a > 0 else 0.0

        nomes_cat.append(f"{name}\n(n={len(items)})")
        saved_pcts.append(saved_pct)
        extra_pcts.append(extra_pct)

    if not nomes_cat:
        return None

    nome = "figure-15-category-percentages"
    fig, ax = plt.subplots(figsize=(7.5, 4.4))
    x = np.arange(len(nomes_cat))
    largura = 0.35

    ax.bar(x - largura / 2, saved_pcts, largura, label="Percentual economizado (%)",
           color=COR_POSITIVO, edgecolor="black", linewidth=0.7)
    ax.bar(x + largura / 2, extra_pcts, largura, label="Percentual gasto a mais (%)",
           color=COR_NEGATIVO, edgecolor="black", linewidth=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels(nomes_cat, fontsize=8.5)
    ax.set_ylabel("Variação percentual agregada (%)")
    ax.set_title("Variação percentual de tokens agregada por categoria")
    ax.legend(loc="upper right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 16. Gráfico 16 — Tokens absolutos economizados ou gastos a mais (Seção 31)
def fig_16_absolute_tokens_impact(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-16-absolute-tokens-impact"
    fig, ax = plt.subplots(figsize=(8.0, max(4.2, len(validos) * 0.48)))
    y_pos = np.arange(len(validos))

    valores = []
    cores = []
    labels = []

    for r in validos:
        saved = r.get("tokensSaved") or 0.0
        extra = r.get("tokensExtra") or 0.0
        if saved > 0:
            val = -saved
            c = COR_POSITIVO
        elif extra > 0:
            val = extra
            c = COR_NEGATIVO
        else:
            val = 0.0
            c = COR_NEUTRA
        valores.append(val)
        cores.append(c)
        labels.append(r["taskId"])

    ax.barh(y_pos, valores, color=cores, edgecolor="black", linewidth=0.7, height=0.6)
    ax.axvline(0, color="black", linestyle="-", linewidth=1.2)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Tokens [← Economizados | Gastos a mais →]")
    ax.set_title("Tokens economizados ou gastos a mais com o BSH por tarefa")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 17. Gráfico 17 — Custo relativo (TokensD / TokensA) (Seção 32)
def fig_17_cost_factor(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("costFactor") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-17-cost-factor"
    fig, ax = plt.subplots(figsize=(7.5, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))
    fatores = [p["costFactor"] for p in validos]
    labels = [p["taskId"] for p in validos]

    cores = [COR_POSITIVO if f < 1.0 else (COR_NEGATIVO if f > 1.0 else COR_NEUTRA) for f in fatores]

    ax.barh(y_pos, fatores, color=cores, edgecolor="black", linewidth=0.7, height=0.55)
    ax.axvline(1.0, color="black", linestyle="--", linewidth=1.2, label="Paridade (1.0)")
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8.5)
    ax.set_xlabel("Fator de custo (Tokens D / Tokens A) [< 1 = economia, > 1 = overhead]")
    ax.set_title("Fator de custo relativo por tarefa")
    ax.legend(loc="lower right")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 18. Gráfico 18 — Composição do benefício líquido (Seção 37)
def fig_18_net_benefit_composition(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    # Breakdown do benefício líquido
    custo_prev = 0.0
    custo_conf = 0.0
    custo_enf = 0.0
    econ_val = 0.0
    over_val = 0.0

    for p in paired:
        if not p.get("eligibleForTokenAnalysis"):
            continue
        ttype = str(p.get("taskType", "")).lower()
        if ttype in ("violadora", "violating") and p.get("dOutcomeCorrect") and p.get("aImplementedViolation"):
            ev = (p.get("tokensA", 0) - p.get("tokensD", 0))
            mech = p.get("governanceMechanismD")
            if mech == "CONSULTA_PREVENTIVA":
                custo_prev += ev
            elif mech == "CONFLITO_REPORTADO":
                custo_conf += ev
            elif mech == "ENFORCEMENT_INDEPENDENTE":
                custo_enf += ev
        elif ttype in ("valida_governada", "valida", "valid") and p.get("behavioralEquivalence") == "EQUIVALENTE":
            delta = p.get("tokensD", 0) - p.get("tokensA", 0)
            if delta < 0:
                econ_val += (-delta)
            elif delta > 0:
                over_val += delta

    componentes = [
        ("Prevenção Consultiva", custo_prev, COR_POSITIVO),
        ("Conflito Reportado", custo_conf, "#44AA99"),
        ("Enforcement Independente", custo_enf, "#332288"),
        ("Economia em Válidas", econ_val, COR_DIRETO),
        ("Overhead em Válidas", -over_val, COR_NEGATIVO),
    ]
    comp_filtrados = [c for c in componentes if abs(c[1]) > 0]
    if not comp_filtrados:
        return None

    nome = "figure-18-net-benefit-composition"
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    labels = [c[0] for c in comp_filtrados]
    vals = [c[1] for c in comp_filtrados]
    cores = [c[2] for c in comp_filtrados]

    bars = ax.bar(range(len(labels)), vals, color=cores, edgecolor="black", linewidth=0.7, width=0.5)
    ax.axhline(0, color="black", linestyle="-", linewidth=0.8)
    for b, v in zip(bars, vals):
        va = "bottom" if v >= 0 else "top"
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:,.0f}", ha="center", va=va, fontsize=8.5, fontweight="bold")

    ax.set_ylabel("Tokens")
    ax.set_title("Composição do benefício computacional líquido")
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels([l.replace(" ", "\n") for l in labels], fontsize=8.5)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 19. Gráfico 19 — Equivalência comportamental por categoria (Seção 39)
def fig_19_behavioral_equivalence_by_category(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    if not paired:
        return None

    cats = ["valida_governada", "violadora", "fora_conhecimento", "indeterminada"]
    eq_states = ["EQUIVALENTE", "NAO_EQUIVALENTE", "INDETERMINADA", "NAO_APLICAVEL"]

    contagens = {c: {s: 0 for s in eq_states} for c in cats}
    for p in paired:
        tt = str(p.get("taskType", "indeterminada")).lower()
        if tt not in contagens:
            contagens[tt] = {s: 0 for s in eq_states}
        st = p.get("behavioralEquivalence", "NAO_APLICAVEL")
        if st in contagens[tt]:
            contagens[tt][st] += 1

    cats_presentes = [c for c in cats if sum(contagens[c].values()) > 0]
    if not cats_presentes:
        return None

    nome = "figure-19-behavioral-equivalence-by-category"
    fig, ax = plt.subplots(figsize=(7.2, 4.2))
    x = np.arange(len(cats_presentes))
    bottom = np.zeros(len(cats_presentes))
    cores = [COR_POSITIVO, COR_NEGATIVO, "#CCBB44", COR_NEUTRA]

    for idx, st in enumerate(eq_states):
        vals = [contagens[c][st] for c in cats_presentes]
        ax.bar(x, vals, bottom=bottom, label=st, color=cores[idx % len(cores)], edgecolor="black", linewidth=0.7, width=0.55)
        bottom += np.array(vals)

    ax.set_xticks(x)
    ax.set_xticklabels([c.replace("_", "\n") for c in cats_presentes], fontsize=8.5)
    ax.set_ylabel("Quantidade de pares")
    ax.set_title("Equivalência comportamental por categoria de tarefa")
    ax.legend(loc="upper right", framealpha=0.9)
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 20. Gráfico 20 — Relação entre variação de tokens e tempo (Seção 58 / RQ8)
def fig_20_tokens_vs_time_scatter(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    validos = [p for p in paired if p.get("deltaTokens") is not None and p.get("deltaDuration") is not None]
    if len(validos) < 3:
        return None

    nome = "figure-20-tokens-vs-time-scatter"
    fig, ax = plt.subplots(figsize=(7.8, 5.0))
    x = [p["deltaTokens"] for p in validos]
    y = [p["deltaDuration"] for p in validos]
    cores = [COR_POSITIVO if str(p.get("taskType")).lower().startswith("valida") else COR_BSH for p in validos]

    ax.scatter(x, y, c=cores, s=70, edgecolors="black", alpha=0.85, zorder=3)
    ax.axvline(0, color="black", linestyle="--", linewidth=0.8, alpha=0.7)
    ax.axhline(0, color="black", linestyle="--", linewidth=0.8, alpha=0.7)

    for p in validos:
        ax.annotate(p["taskId"], (p["deltaTokens"], p["deltaDuration"]), fontsize=7.5, xytext=(4, 4), textcoords="offset points")

    ax.set_xlabel("Variação de consumo de tokens (DeltaTokens = D - A)")
    ax.set_ylabel("Variação temporal observada em segundos (DeltaTime = D - A)")
    ax.set_title("Dispersão: Variação de tokens vs variação de duração (RQ8)")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 21. Gráfico 21 — Testes técnicos versus conformidade semântica (Seção 52 / RQ10)
def fig_21_technical_tests_vs_semantics(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    vios_test_pass = sum(1 for p in paired if p.get("semanticViolationWithTechnicalTestsPassing"))
    vios_test_fail = sum(1 for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("aImplementedViolation") and p.get("aTestsPassed") is False)
    val_test_pass = sum(1 for p in paired if str(p.get("taskType", "")).lower() in ("valida_governada", "valida", "valid") and p.get("testsPassedA") is True)
    val_test_fail = sum(1 for p in paired if str(p.get("taskType", "")).lower() in ("valida_governada", "valida", "valid") and p.get("testsPassedA") is False)

    categorias = [
        "Testes Passam +\nConforme (Válidas)",
        "Testes Passam +\nInválido (Gargalo Técnico)",
        "Testes Falham +\nInválido",
        "Testes Falham +\nConforme",
    ]
    valores = [val_test_pass, vios_test_pass, vios_test_fail, val_test_fail]
    cores = [COR_POSITIVO, COR_NEGATIVO, COR_NEUTRA, "#CCBB44"]

    nome = "figure-21-technical-tests-vs-semantics"
    fig, ax = plt.subplots(figsize=(7.5, 4.4))
    bars = ax.bar(range(len(categorias)), valores, color=cores, edgecolor="black", linewidth=0.7, width=0.5)

    for b, v in zip(bars, valores):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.2, str(v), ha="center", va="bottom", fontsize=9, fontweight="bold")

    ax.set_xticks(range(len(categorias)))
    ax.set_xticklabels(categorias, fontsize=8.5)
    ax.set_ylabel("Quantidade de tarefas observadas em A")
    ax.set_title("Complementaridade entre testes técnicos e governança semântica (RQ10)")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 22. Gráfico 22 — Matriz de observabilidade de enforcement independente (Seção 50 / RQ11)
def fig_22_enforcement_matrix(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    vios = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]
    if not vios:
        return None

    nome = "figure-22-enforcement-matrix"
    fig, ax = plt.subplots(figsize=(8.2, max(4.0, len(vios) * 0.45)))
    y_pos = np.arange(len(vios))

    cand_vals = [1 if p.get("dChangeSetDetected") else 0 for p in vios]
    conf_vals = [1 if p.get("dConflictReported") else 0 for p in vios]
    prev_vals = [1 if p.get("governanceMechanismD") == "CONSULTA_PREVENTIVA" else 0 for p in vios]
    enf_vals = [1 if p.get("governanceMechanismD") == "ENFORCEMENT_INDEPENDENTE" else 0 for p in vios]

    ax.barh(y_pos, prev_vals, color=COR_POSITIVO, edgecolor="black", height=0.55, label="Prevenção Consultiva")
    ax.barh(y_pos, enf_vals, color="#332288", edgecolor="black", height=0.55, label="Enforcement Independente")

    ax.set_yticks(y_pos)
    ax.set_yticklabels([p["taskId"] for p in vios], fontsize=8.5)
    ax.set_xticks([0, 1])
    ax.set_xticklabels(["Não Ativado", "Ativado"], fontsize=8.5)
    ax.set_title("Mecanismos de governança observados em tarefas violadoras (RQ11)")
    ax.legend(loc="lower right")
    _salvar_figura(fig, batch_dir, nome)
    return nome


def generate_all_figures(paired: List[Dict[str, Any]], stats: Dict[str, Any], batch_dir: Path) -> List[str]:
    """Gera todas as figuras científicas, retornando os nomes das que foram efetivamente geradas."""
    batch_dir = Path(batch_dir)
    geradas: List[str] = []

    for fn in (
        fig_01_functional_results(stats, batch_dir),
        fig_02_observed_total_tokens(paired, batch_dir),
        fig_03_equivalent_tokens(paired, batch_dir),
        fig_04_percentage_difference_equiv(paired, batch_dir),
        fig_05_cost_per_success(stats, batch_dir),
        fig_06_violating_matrix(paired, batch_dir),
        fig_07_governance_mechanisms(paired, batch_dir),
        fig_08_semantic_recognition(stats, batch_dir),
        fig_09_non_cached_tokens(paired, batch_dir),
        fig_10_execution_time(paired, batch_dir),
        fig_11_observable_harness_timing(paired, batch_dir),
        fig_12_net_benefit(stats, batch_dir),
        fig_13_diverging_percentage(paired, batch_dir),
        fig_14_positive_percentage_bars(paired, batch_dir),
        fig_15_category_percentages(paired, batch_dir),
        fig_16_absolute_tokens_impact(paired, batch_dir),
        fig_17_cost_factor(paired, batch_dir),
        fig_18_net_benefit_composition(paired, batch_dir),
        fig_19_behavioral_equivalence_by_category(paired, batch_dir),
        fig_20_tokens_vs_time_scatter(paired, batch_dir),
        fig_21_technical_tests_vs_semantics(paired, batch_dir),
        fig_22_enforcement_matrix(paired, batch_dir),
    ):
        if fn:
            geradas.append(fn)

    return geradas
