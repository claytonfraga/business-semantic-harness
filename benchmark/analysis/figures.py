"""Geração de figuras com qualidade de publicação científica em Engenharia de Software Experimental.

Contratos estritos:
- Apenas observações elegíveis participam da plotagem.
- NUNCA converte None ou NaN em 0.
- Se dados forem insuficientes, a figura NÃO É GERADA (retorna None), evitando eixos vazios ou barras em zero.
- Exportação simultânea em PDF vetorial e PNG (>= 300 dpi) com discriminação monocromática.
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

COR_DIRETO = "#4477AA"     # Azul suave / marcador quadrado
COR_BSH = "#CC6677"        # Terracota / marcador círculo
COR_NEUTRA = "#666666"
COR_POSITIVO = "#228833"
COR_NEGATIVO = "#EE6677"


def _salvar(fig: plt.Figure, figures_dir: Path, nome_base: str):
    figures_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = figures_dir / f"{nome_base}.pdf"
    png_path = figures_dir / f"{nome_base}.png"
    fig.tight_layout()
    fig.savefig(pdf_path, format="pdf", bbox_inches="tight")
    fig.savefig(png_path, format="png", dpi=300, bbox_inches="tight")
    plt.close(fig)


def fig_01_paired_total_tokens(paired: List[Dict[str, Any]], figures_dir: Path) -> Optional[str]:
    """Figura 1: Consumo total de tokens pareado por tarefa (Dumbbell plot)."""
    # Filtra SOMENTE pares elegíveis (ambos medidos e > 0)
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    if len(validos) < 2:
        return None  # Não gera gráfico enganoso se n < 2

    nome = "figure-01-paired-total-tokens"
    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))

    for idx, r in enumerate(validos):
        ax.plot([r["tokensA"], r["tokensD"]], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["tokensA"] for r in validos], y_pos, color=COR_DIRETO, marker="s", s=55,
               edgecolors="black", linewidths=0.8, label="Direto (sem BSH)", zorder=3)
    ax.scatter([r["tokensD"] for r in validos], y_pos, color=COR_BSH, marker="o", s=65,
               edgecolors="black", linewidths=0.8, label="BSH governado", zorder=3)

    ax.set_yticks(y_pos)
    labels = [f"{r['taskId']} ({'violadora' if r.get('taskType') in ('violadora','violating') else 'válida'})" for r in validos]
    ax.set_yticklabels(labels)
    ax.set_xlabel("Tokens totais consumidos (n = {})".format(len(validos)))
    ax.set_title("Consumo total de tokens pareado por tarefa (Dumbbell plot)")
    ax.legend(loc="lower right", framealpha=0.9)

    _salvar(fig, figures_dir, nome)
    return nome


def fig_02_token_difference(paired: List[Dict[str, Any]], figures_dir: Path) -> Optional[str]:
    """Figura 2: Variação percentual de tokens (gráfico de barras divergentes)."""
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("percentageDifference") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-02-token-difference"
    validos_ord = sorted(validos, key=lambda r: (r.get("taskType") not in ("violadora", "violating"), r.get("percentageDifference", 0)))
    y_pos = np.arange(len(validos_ord))
    diffs = [r["percentageDifference"] for r in validos_ord]
    labels = [f"{r['taskId']} ({r.get('taskType', '')})" for r in validos_ord]

    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos_ord) * 0.45)))
    cores = [COR_NEGATIVO if d > 0 else COR_POSITIVO for d in diffs]
    hatches = ["//" if r.get("taskType") in ("violadora", "violating") else "" for r in validos_ord]

    barras = ax.barh(y_pos, diffs, color=cores, edgecolor="black", linewidth=0.7, height=0.6)
    for barra, h in zip(barras, hatches):
        barra.set_hatch(h)

    ax.axvline(0, color="black", linestyle="-", linewidth=1.0)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels)
    ax.set_xlabel("Variação relativa de tokens (%) [BSH vs Direto] (n = {})".format(len(validos_ord)))
    ax.set_title("Variação percentual de tokens por tarefa (< 0 = economia)")

    _salvar(fig, figures_dir, nome)
    return nome


def fig_03_paired_uncached_tokens(paired: List[Dict[str, Any]], figures_dir: Path) -> Optional[str]:
    """Figura 3: Tokens não cacheados pareados por tarefa."""
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("nonCachedTokensA") is not None and p.get("nonCachedTokensD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-03-paired-uncached-tokens"
    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))

    for idx, r in enumerate(validos):
        ax.plot([r["nonCachedTokensA"], r["nonCachedTokensD"]], [idx, idx],
                color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["nonCachedTokensA"] for r in validos], y_pos, color=COR_DIRETO,
               marker="s", s=55, edgecolors="black", linewidths=0.8, label="Direto (sem BSH)", zorder=3)
    ax.scatter([r["nonCachedTokensD"] for r in validos], y_pos, color=COR_BSH,
               marker="o", s=65, edgecolors="black", linewidths=0.8, label="BSH governado", zorder=3)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{r['taskId']} ({r.get('taskType', '')})" for r in validos])
    ax.set_xlabel("Tokens não cacheados [(entrada - cache) + saída] (n = {})".format(len(validos)))
    ax.set_title("Custo pareado sem reaproveitamento de cache por tarefa")
    ax.legend(loc="lower right", framealpha=0.9)

    _salvar(fig, figures_dir, nome)
    return nome


def fig_04_net_benefit(stats: Dict[str, Any], figures_dir: Path) -> Optional[str]:
    """Figura 4: Economia nas violadoras vs Overhead nas válidas e Benefício Líquido."""
    rq2 = stats.get("rq2", {})
    econ = rq2.get("economia_total_violadoras")
    over = rq2.get("overhead_total_validas")
    liq = rq2.get("beneficio_liquido")

    # Requirement 22: SOMENTE gera se existirem pares válidos TANTO de válidas QUANTO de violadoras!
    # NUNCA mostre três barras iguais a zero!
    if econ is None or over is None or liq is None:
        return None

    nome = "figure-04-net-benefit"
    fig, ax = plt.subplots(figsize=(6.4, 4.2))

    categorias = [
        "Economia em\nTarefas Violadoras",
        "Overhead em\nTarefas Válidas",
        "Benefício Líquido\n(Workload Total)"
    ]
    valores = [econ, over, liq]
    cores = [COR_POSITIVO, COR_NEGATIVO, COR_DIRETO if liq >= 0 else COR_NEGATIVO]
    hatches = ["//", "\\\\", "xx"]

    barras = ax.bar(categorias, valores, color=cores, edgecolor="black", linewidth=0.8, width=0.52)
    for barra, h in zip(barras, hatches):
        barra.set_hatch(h)

    ax.axhline(0, color="black", linestyle="-", linewidth=0.8)
    for barra, val in zip(barras, valores):
        y_text = val if val >= 0 else val - (abs(val) * 0.08)
        va = "bottom" if val >= 0 else "top"
        ax.text(barra.get_x() + barra.get_width() / 2, y_text, f"{val:,.0f}", ha="center", va=va, fontsize=9, fontweight="bold")

    ax.set_ylabel("Quantidade de tokens")
    ax.set_title("Trade-off de tokens: Economia (violadoras) vs Overhead (válidas)")

    _salvar(fig, figures_dir, nome)
    return nome


def fig_05_cost_factor(paired: List[Dict[str, Any]], figures_dir: Path) -> Optional[str]:
    """Figura 5: Fator de custo (TokensBSH / TokensDireto com referência em 1.0)."""
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("costFactor") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-05-cost-factor"
    validos_ord = sorted(validos, key=lambda r: (r.get("taskType") not in ("violadora", "violating"), r.get("costFactor", 1.0)))
    y_pos = np.arange(len(validos_ord))
    fatores = [r["costFactor"] for r in validos_ord]
    labels = [f"{r['taskId']} ({r.get('taskType', '')})" for r in validos_ord]

    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos_ord) * 0.45)))
    cores = [COR_POSITIVO if f < 1.0 else (COR_NEUTRA if f == 1.0 else COR_NEGATIVO) for f in fatores]

    ax.barh(y_pos, fatores, color=cores, edgecolor="black", linewidth=0.7, height=0.6)
    ax.axvline(1.0, color="black", linestyle="--", linewidth=1.2, label="Paridade (Fator = 1.0)")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels)
    ax.set_xlabel("Fator de custo (Tokens BSH / Tokens Direto) [n = {}]".format(len(validos_ord)))
    ax.set_title("Fator de custo por tarefa (< 1.0 indica menor custo no BSH)")
    ax.legend(loc="upper right", framealpha=0.9)

    _salvar(fig, figures_dir, nome)
    return nome


def fig_06_distribution_by_task_type(paired: List[Dict[str, Any]], figures_dir: Path) -> Optional[str]:
    """Figura 6: Distribuição por tipo de tarefa (Boxplot com observações individuais)."""
    validos = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]
    val_dir = [p["tokensA"] for p in validos if p.get("taskType") in ("valida_governada", "valida", "valid")]
    val_bsh = [p["tokensD"] for p in validos if p.get("taskType") in ("valida_governada", "valida", "valid")]
    vio_dir = [p["tokensA"] for p in validos if p.get("taskType") in ("violadora", "violating")]
    vio_bsh = [p["tokensD"] for p in validos if p.get("taskType") in ("violadora", "violating")]

    # Requirement 28: Somente gera se houver dados amostrais suficientes (pelo menos 2 em cada grupo comparado)
    if len(val_dir) < 2 and len(vio_dir) < 2:
        return None

    nome = "figure-06-distribution-by-task-type"
    fig, ax = plt.subplots(figsize=(6.8, 4.5))

    amostras = [val_dir, val_bsh, vio_dir, vio_bsh]
    posicoes = [1, 2, 3.5, 4.5]
    rotulos = ["Válidas\n(Direto)", "Válidas\n(BSH)", "Violadoras\n(Direto)", "Violadoras\n(BSH)"]
    cores = [COR_DIRETO, COR_BSH, COR_DIRETO, COR_BSH]

    valid_grupos = [(am, pos, rot, cor) for am, pos, rot, cor in zip(amostras, posicoes, rotulos, cores) if len(am) >= 2]
    if len(valid_grupos) < 2:
        plt.close(fig)
        return None

    dados_plot = [g[0] for g in valid_grupos]
    pos_plot = [g[1] for g in valid_grupos]
    rot_plot = [g[2] for g in valid_grupos]
    cores_plot = [g[3] for g in valid_grupos]

    bp = ax.boxplot(dados_plot, positions=pos_plot, patch_artist=True, widths=0.45, showfliers=False)
    for patch, c in zip(bp["boxes"], cores_plot):
        patch.set_facecolor(c)
        patch.set_alpha(0.35)
        patch.set_edgecolor("black")

    for am, pos, _rot, c in valid_grupos:
        jitter = (np.random.RandomState(42).rand(len(am)) - 0.5) * 0.12
        ax.scatter([pos + j for j in jitter], am, color=c, edgecolors="black", linewidths=0.6, s=40, zorder=3)

    ax.set_xticks(pos_plot)
    ax.set_xticklabels(rot_plot)
    ax.set_ylabel("Tokens totais")
    ax.set_title("Distribuição de tokens por condição e tipo semântico")

    _salvar(fig, figures_dir, nome)
    return nome


def fig_07_paired_execution_time(paired: List[Dict[str, Any]], figures_dir: Path) -> Optional[str]:
    """Figura 7: Tempo de execução pareado por tarefa."""
    validos = [p for p in paired if p.get("durationA") is not None and p.get("durationD") is not None]
    if len(validos) < 2:
        return None

    nome = "figure-07-paired-execution-time"
    fig, ax = plt.subplots(figsize=(7.2, max(4.0, len(validos) * 0.45)))
    y_pos = np.arange(len(validos))

    for idx, r in enumerate(validos):
        ax.plot([r["durationA"], r["durationD"]], [idx, idx], color="#888888", linestyle="-", linewidth=1.5, zorder=1)

    ax.scatter([r["durationA"] for r in validos], y_pos, color=COR_DIRETO, marker="s", s=55,
               edgecolors="black", linewidths=0.8, label="Direto (sem BSH)", zorder=3)
    ax.scatter([r["durationD"] for r in validos], y_pos, color=COR_BSH, marker="o", s=65,
               edgecolors="black", linewidths=0.8, label="BSH governado", zorder=3)

    ax.set_yticks(y_pos)
    ax.set_yticklabels([f"{r['taskId']} ({r.get('taskType', '')})" for r in validos])
    ax.set_xlabel("Duração da execução em segundos (n = {})".format(len(validos)))
    ax.set_title("Tempo de execução pareado por tarefa")
    ax.legend(loc="lower right", framealpha=0.9)

    _salvar(fig, figures_dir, nome)
    return nome


def fig_08_governance_outcomes(stats: Dict[str, Any], figures_dir: Path) -> Optional[str]:
    """Figura 8: Resultado de governança por categoria e condição."""
    gov = stats.get("governanca", {})
    if not gov:
        return None

    classes = [
        "ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "VIOLACAO_NAO_DETECTADA",
        "FALSO_BLOQUEIO", "REVISAO_HUMANA", "SEM_ALTERACAO"
    ]
    condicoes = sorted(gov.keys())
    # Requirement 25: Só gera se houver classificações reais observadas (total > 0)
    total_obs = sum(sum(gov[c].values()) for c in condicoes)
    if total_obs == 0:
        return None

    nome = "figure-08-governance-outcomes"
    fig, ax = plt.subplots(figsize=(7.6, 4.4))
    x = np.arange(len(classes))
    largura = 0.8 / len(condicoes)

    cores_cond = [COR_DIRETO, COR_NEUTRA, "#E69F00", COR_BSH]
    hatches = ["", "//", "\\\\", "xx"]

    for idx, c in enumerate(condicoes):
        vals = [gov[c].get(cls, 0) for cls in classes]
        offset = (idx - len(condicoes) / 2 + 0.5) * largura
        bars = ax.bar(x + offset, vals, largura, label=f"Condição {c}",
                      color=cores_cond[idx % len(cores_cond)], edgecolor="black", linewidth=0.7)
        if idx < len(hatches):
            for b in bars:
                b.set_hatch(hatches[idx])

    ax.set_xticks(x)
    ax.set_xticklabels([c.replace("_", "\n") for c in classes], fontsize=8)
    ax.set_ylabel("Quantidade de ocorrências (Total = {})".format(total_obs))
    ax.set_title("Classificação dos desfechos de governança por condição")
    ax.legend(loc="upper right", framealpha=0.9)

    _salvar(fig, figures_dir, nome)
    return nome


def fig_09_semantic_recognition(stats: Dict[str, Any], figures_dir: Path) -> Optional[str]:
    """Figura 9: Reconhecimento semântico (Precision e Recall)."""
    sr = stats.get("rq6", {})
    recall = sr.get("recall")
    precision = sr.get("precision")
    if recall is None or precision is None:
        return None

    nome = "figure-09-semantic-recognition"
    fig, ax = plt.subplots(figsize=(5.4, 3.8))
    metricas = ["Recall", "Precision"]
    valores = [recall * 100.0, precision * 100.0]

    barras = ax.bar(metricas, valores, color=[COR_BSH, COR_POSITIVO], edgecolor="black", linewidth=0.8, width=0.45)
    for b in barras:
        ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 1.5, f"{b.get_height():.1f}%",
                ha="center", va="bottom", fontweight="bold")

    ax.set_ylim(0, 115)
    ax.set_ylabel("Taxa (%)")
    ax.set_title("Eficácia do reconhecimento semântico independente (Condição D)")

    _salvar(fig, figures_dir, nome)
    return nome


def fig_10_token_decomposition(data: Dict[str, Any], figures_dir: Path) -> Optional[str]:
    """Figura 10: Decomposição de tokens por condição."""
    measurements = data.get("measurements", [])
    condicoes = sorted({m.get("condicao") for m in measurements if m.get("condicao")})

    # Requirement 26: Somente apresenta condições com componentes observados
    condicoes_validas = []
    for c in condicoes:
        sub = [m for m in measurements if m.get("condicao") == c and m.get("entrada") is not None and m.get("saida") is not None]
        if sub:
            condicoes_validas.append(c)

    if not condicoes_validas:
        return None

    nome = "figure-10-token-decomposition"
    fig, ax = plt.subplots(figsize=(6.4, 4.4))

    entradas = []
    saidas = []
    raciocinios = []
    for c in condicoes_validas:
        sub = [m for m in measurements if m.get("condicao") == c and m.get("entrada") is not None and m.get("saida") is not None]
        ent = [m["entrada"] for m in sub]
        sai = [m["saida"] for m in sub]
        rac = [m.get("raciocinio", 0) or 0 for m in sub]
        entradas.append(np.mean(ent))
        saidas.append(np.mean(sai))
        raciocinios.append(np.mean(rac))

    x = np.arange(len(condicoes_validas))
    ax.bar(x, entradas, label="Entrada", color="#4477AA", edgecolor="black", linewidth=0.7, width=0.45)
    ax.bar(x, saidas, bottom=entradas, label="Saída", color="#EE6677", edgecolor="black", linewidth=0.7, width=0.45)
    bottom_rac = [e + s for e, s in zip(entradas, saidas)]
    ax.bar(x, raciocinios, bottom=bottom_rac, label="Raciocínio", color="#CCBB44", edgecolor="black", linewidth=0.7, width=0.45)

    ax.set_xticks(x)
    ax.set_xticklabels([f"Condição {c}" for c in condicoes_validas])
    ax.set_ylabel("Média de tokens")
    ax.set_title("Decomposição média do consumo de tokens por condição")
    ax.legend(loc="upper right", framealpha=0.9)

    _salvar(fig, figures_dir, nome)
    return nome


def fig_12_statistical_estimates(stats: Dict[str, Any], figures_dir: Path) -> Optional[str]:
    """Figura 12: Estimativas de magnitude de efeito e IC 95% para tokens e tempo."""
    todas = stats.get("segmentos", {}).get("todas", {})
    dif_tok = todas.get("diferenca_absoluta", {})
    dif_tmp = todas.get("diferenca_tempo", {})

    # Requirement 27: Somente gera se houver ICs calculados com dados reais (n >= 3)
    if dif_tok.get("ic95_inferior") is None and dif_tmp.get("ic95_inferior") is None:
        return None

    nome = "figure-12-statistical-estimates"
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8.0, 3.8), gridspec_kw={"width_ratios": [1.4, 1.0]})

    metricas_tok = ["Tokens Totais"]
    medias_tok = [dif_tok.get("media", 0) or 0]
    err_inf = [abs((dif_tok.get("media") or 0) - (dif_tok.get("ic95_inferior") or 0))]
    err_sup = [abs((dif_tok.get("ic95_superior") or 0) - (dif_tok.get("media") or 0))]

    y1 = np.arange(len(metricas_tok))
    ax1.errorbar(medias_tok, y1, xerr=[err_inf, err_sup], fmt="o", color=COR_BSH, ecolor="black",
                 elinewidth=1.5, capsize=5, capthick=1.2, markersize=7)
    ax1.axvline(0, color="black", linestyle="--", linewidth=1.0)
    ax1.set_yticks(y1)
    ax1.set_yticklabels(metricas_tok)
    ax1.set_xlabel("Diferença pareada (BSH - Direto) [Tokens]")
    ax1.set_title("Estimativa de efeito (Tokens)")

    media_tmp = dif_tmp.get("media", 0) or 0
    err_t_inf = abs(media_tmp - (dif_tmp.get("ic95_inferior") or 0))
    err_t_sup = abs((dif_tmp.get("ic95_superior") or 0) - media_tmp)

    ax2.errorbar([media_tmp], [0], xerr=[[err_t_inf], [err_t_sup]], fmt="s", color=COR_DIRETO, ecolor="black",
                 elinewidth=1.5, capsize=5, capthick=1.2, markersize=7)
    ax2.axvline(0, color="black", linestyle="--", linewidth=1.0)
    ax2.set_yticks([0])
    ax2.set_yticklabels(["Tempo (s)"])
    ax2.set_xlabel("Diferença pareada (s)")
    ax2.set_title("Estimativa de efeito (Tempo)")

    fig.suptitle("Estimativas de magnitude de efeito pareado com IC 95%", fontsize=11)
    _salvar(fig, figures_dir, nome)
    return nome


def generate_all_figures(data: Dict[str, Any], paired: List[Dict[str, Any]], stats: Dict[str, Any]) -> List[str]:
    """Gera todas as figuras científicas no diretório figures/ da execução."""
    figures_dir = data.get("batch_dir", Path()) / "figures"
    geradas: List[str] = []

    for fn in (
        fig_01_paired_total_tokens(paired, figures_dir),
        fig_02_token_difference(paired, figures_dir),
        fig_03_paired_uncached_tokens(paired, figures_dir),
        fig_04_net_benefit(stats, figures_dir),
        fig_05_cost_factor(paired, figures_dir),
        fig_06_distribution_by_task_type(paired, figures_dir),
        fig_07_paired_execution_time(paired, figures_dir),
        fig_08_governance_outcomes(stats, figures_dir),
        fig_09_semantic_recognition(stats, figures_dir),
        fig_10_token_decomposition(data, figures_dir),
        fig_12_statistical_estimates(stats, figures_dir),
    ):
        if fn:
            geradas.append(fn)

    return geradas
