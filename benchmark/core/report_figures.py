"""Figuras do relatório geradas a partir do mesmo modelo de dados das tabelas.

Cada figura retorna metadados (pergunta, população, fonte). Métrica não calculável não gera
figura vazia/sintética no relatório da campanha.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

CONDICOES = ("A", "B", "C", "D")


def _categoria(run: dict[str, Any]) -> str:
    ttype = str(run.get("taskType") or "").lower()
    return "violadora" if ttype in ("violadora", "violating") else "permitida"


def _salvar(fig, out_dir: Path, figura_id: str) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    caminho = out_dir / f"{figura_id}.pdf"
    fig.savefig(caminho, format="pdf", bbox_inches="tight")
    plt.close(fig)
    return str(caminho)


def figure_outcomes(runs: list[dict[str, Any]], out_dir: Path) -> list[dict[str, Any]]:
    if not runs:
        return []
    dados: dict[str, Counter] = {cond: Counter() for cond in CONDICOES}
    for run in runs:
        dados[str(run.get("condition"))][_categoria(run)] += 1
    fig, axes = plt.subplots(1, 2, figsize=(8, 3))
    for ax, categoria in zip(axes, ("permitida", "violadora")):
        valores = [dados[cond].get(categoria, 0) for cond in CONDICOES]
        ax.bar(CONDICOES, valores, color="#4C72B0")
        ax.set_title(f"Solicitações {categoria}")
        ax.set_ylabel("execuções")
        for index, valor in enumerate(valores):
            ax.text(index, valor, str(valor), ha="center", va="bottom")
    return [{"id": "fig-outcomes", "title": "Composição dos desfechos por condição e categoria",
             "question": "Quantas execuções por condição e categoria de solicitação?",
             "population": "todas as execuções observadas", "source": "classified-runs.json",
             "path": _salvar(fig, out_dir, "fig-outcomes")}]


def figure_denials(runs: list[dict[str, Any]], out_dir: Path, results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    etapas = Counter()
    for run in runs:
        if str(run.get("condition")) != "D":
            continue
        resultado = results.get(str(run.get("runId")), {})
        gd = resultado.get("governanceDecision") if isinstance(resultado.get("governanceDecision"), dict) else {}
        if gd.get("promotionDecision") != "DENY":
            continue
        stage = gd.get("failureStage") or ("SHACL_VIOLATION" if gd.get("validationStatus") == "VIOLATION" else "DESCONHECIDA")
        etapas[str(stage)] += 1
    if not etapas:
        return []
    fig, ax = plt.subplots(figsize=(6, 3))
    nomes = list(etapas)
    ax.bar(nomes, [etapas[nome] for nome in nomes], color="#C44E52")
    ax.set_ylabel("negativas")
    ax.set_title("Negativas em D por etapa")
    return [{"id": "fig-denials", "title": "Distribuição das negativas em D por etapa de falha",
             "question": "Em que etapa as negativas de D ocorreram?",
             "population": "execuções D com promotionDecision=DENY", "source": "executions/*/result.json",
             "path": _salvar(fig, out_dir, "fig-denials")}]


def figure_coverage(runs: list[dict[str, Any]], out_dir: Path) -> list[dict[str, Any]]:
    if not runs:
        return []
    campos = {"tokens": "totalTokens", "testes": "testsPassed", "consulta": "ontologyQueried",
              "validacao": "validationComplete", "decisao": "promotionDecision"}
    contagem = {nome: [sum(1 for r in runs if r.get("condition") == cond and r.get(campo) is not None)
                       for cond in CONDICOES] for nome, campo in campos.items()}
    fig, ax = plt.subplots(figsize=(8, 3))
    largura = 0.15
    for index, (nome, valores) in enumerate(contagem.items()):
        posicoes = [i + index * largura for i in range(len(CONDICOES))]
        ax.bar(posicoes, valores, width=largura, label=nome)
    ax.set_xticks([i + 2 * largura for i in range(len(CONDICOES))])
    ax.set_xticklabels(CONDICOES)
    ax.set_ylabel("execuções com campo observado")
    ax.legend()
    return [{"id": "fig-coverage", "title": "Cobertura das evidências por condição",
             "question": "Quais evidências estão disponíveis por condição?",
             "population": "todas as execuções observadas", "source": "classified-runs.json",
             "path": _salvar(fig, out_dir, "fig-coverage")}]


def build_figures(batch_dir: str, runs: list[dict[str, Any]], results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out_dir = Path(batch_dir) / "figures"
    figuras: list[dict[str, Any]] = []
    figuras += figure_outcomes(runs, out_dir)
    figuras += figure_denials(runs, out_dir, results)
    figuras += figure_coverage(runs, out_dir)
    return figuras
