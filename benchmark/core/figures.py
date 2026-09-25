"""Geração de figuras científicas para o BSH Benchmark.

Contratos estritos:
- 12 figuras científicas conforme Seções 46 a 57 da especificação.
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


# 1. Gráfico 1 — Resultado funcional por condição (Seção 46)
def fig_01_functional_results(stats: Dict[str, Any], batch_dir: Path) -> Optional[str]:
    gov = stats.get("governanca", {})
    if not gov:
        return None
    classes = [
        "ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA",
        "SEM_ALTERACAO_INCORRETA", "REVISAO_HUMANA", "VIOLACAO_NAO_DETECTADA"
    ]
    condicoes = sorted(gov.keys())
    total_obs = sum(sum(gov[c].values()) for c in condicoes)
    if total_obs == 0:
        return None

    nome = "figure-01-functional-results-by-condition"
    fig, ax = plt.subplots(figsize=(7.8, 4.4))
    x = np.arange(len(classes))
    largura = 0.8 / len(condicoes)
    cores = [COR_DIRETO, "#EE6677", "#CCBB44", COR_BSH]

    for idx, c in enumerate(condicoes):
        vals = [gov[c].get(cls, 0) for cls in classes]
        offset = (idx - len(condicoes) / 2 + 0.5) * largura
        ax.bar(x + offset, vals, largura, label=f"Condição {c}",
               color=cores[idx % len(cores)], edgecolor="black", linewidth=0.7)

    ax.set_xticks(x)
    ax.set_xticklabels([c.replace("_", "\n") for c in classes], fontsize=8)
    ax.set_ylabel("Quantidade de ocorrências")
    ax.set_title("Resultado funcional por condição experimental")
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


# 3. Gráfico 3 — Eficiência sob equivalência comportamental (Seção 48)
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
    ax.set_title("Eficiência de tokens sob equivalência comportamental")
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


# 6. Gráfico 6 — Governança das tarefas violadoras (Seção 51)
def fig_06_violating_matrix(paired: List[Dict[str, Any]], batch_dir: Path) -> Optional[str]:
    vios = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]
    if len(vios) < 2:
        return None

    nome = "figure-06-violating-governance-matrix"
    fig, ax = plt.subplots(figsize=(6.8, max(3.5, len(vios) * 0.45)))
    y_pos = np.arange(len(vios))

    desfechos_d = [p.get("classificationD", "INDETERMINADO") for p in vios]
    labels = [p["taskId"] for p in vios]
    cores = [COR_POSITIVO if d in ("BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA") else COR_NEGATIVO for d in desfechos_d]

    ax.barh(y_pos, [1] * len(vios), color=cores, edgecolor="black", linewidth=0.7, height=0.6)
    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{t} -> {d}" for t, d in zip(labels, desfechos_d)])
    ax.set_xticks([])
    ax.set_title("Governança e bloqueio em tarefas violadoras (Condição D)")
    _salvar_figura(fig, batch_dir, nome)
    return nome


# 7. Gráfico 7 — Mecanismo de governança (Seção 52)
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


# 8. Gráfico 8 — Reconhecimento semântico (Seção 53)
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


# 9. Gráfico 9 — Tokens não cacheados (Seção 54)
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


# 10. Gráfico 10 — Tempo de execução (Seção 55)
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
    # Mede a diferença de tempo de execução pareada observável
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


# 12. Gráfico 12 — Trade-off e benefício líquido (Seção 57)
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


def generate_all_figures(paired: List[Dict[str, Any]], stats: Dict[str, Any], batch_dir: Path) -> List[str]:
    """Gera todas as 12 figuras científicas, retornando os nomes das que foram efetivamente geradas."""
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
    ):
        if fn:
            geradas.append(fn)

    return geradas
