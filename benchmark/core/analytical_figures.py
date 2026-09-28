"""Quatro figuras analíticas do relatório experimental, com conjuntos de dados derivados.

Amostra principal: as 48 execuções da 1ª repetição (12 tarefas × A/B/C/D).
Nas figuras restritas a C/D: as 24 execuções da 1ª repetição.
As 10 repetições complementares são mantidas à parte.

Orientação metodológica: Weissgerber et al. (2015) para exposição de observações individuais;
McNeil (1992) para pareamento; Kosara, Bendix e Hauser (2006) para frequências categóricas.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

plt.rcParams.update({"font.size": 14, "axes.labelsize": 14, "axes.titlesize": 15,
                     "xtick.labelsize": 13, "ytick.labelsize": 13, "legend.fontsize": 13})

CONDICOES = ("A", "B", "C", "D")
# Ordem de domínio: consulta, baixa, transferência (não lexicográfica).
ORDEM_TAREFAS = ["G4", "G5", "G6", "V6", "V7", "V8", "V9", "V10", "V11", "V12", "V13", "V14"]

ESTADOS = {
    "entregue": {"simbolo": "E", "cor": "#2E7D32", "rotulo": "alteração aplicada à origem"},
    "contido": {"simbolo": "C", "cor": "#1565C0", "rotulo": "contenção com conflito reportado"},
    "negado": {"simbolo": "N", "cor": "#C62828", "rotulo": "candidato produzido com promoção negada"},
    "indeterminado": {"simbolo": "?", "cor": "#616161", "rotulo": "sem alteração da origem, candidato/decisão desconhecidos"},
}


def _runs(batch_id: str) -> list[dict[str, Any]]:
    path = Path(__file__).resolve().parents[1] / "results" / batch_id / "classified-runs.json"
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []


def _replicacao(run: dict[str, Any]) -> int:
    return int(run.get("replicationIndex") or 1)


def _categoria(run: dict[str, Any]) -> str:
    return "violadora" if str(run.get("taskType") or "").lower() in ("violadora", "violating") else "permitida"


def _familia(task: str) -> str:
    if task.startswith("G"):
        return "consulta"
    return "baixa" if task in {"V6", "V7", "V8"} else "transferência"


def _estado(run: dict[str, Any]) -> str:
    if run.get("originChanged") is True or run.get("codeBaseChanged") is True:
        return "entregue"
    if run.get("reportConflictCalled") is True:
        return "contido"
    if run.get("promotionDecision") == "DENY":
        return "negado"
    return "indeterminado"


def _por_tarefa_condicao(rep1: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    grade: dict[tuple[str, str], dict[str, Any]] = {}
    for run in rep1:
        task = str(run.get("baseTaskId"))
        if task in ORDEM_TAREFAS:
            grade[(task, str(run.get("condition")))] = run
    return grade


def _salvar(fig, out_dir: Path, nome: str) -> str:
    out_dir.mkdir(parents=True, exist_ok=True)
    if getattr(fig, "_suptitle", None) is not None:
        fig.tight_layout(rect=[0, 0, 1, 0.94], h_pad=0.5, w_pad=0.8)
    else:
        fig.tight_layout(h_pad=0.5, w_pad=0.8)
    fig.savefig(out_dir / f"{nome}.pdf", format="pdf")
    fig.savefig(out_dir / f"{nome}.png", format="png", dpi=200)
    plt.close(fig)
    return nome


def _csv(out_dir: Path, nome: str, cabecalho: list[str], linhas: list[list[Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    conteudo = [",".join(cabecalho)] + [",".join("" if valor is None else str(valor) for valor in linha) for linha in linhas]
    (out_dir / f"{nome}.csv").write_text("\n".join(conteudo) + "\n", encoding="utf-8")


def figura1_matriz(rep1: list[dict[str, Any]], out_dir: Path) -> dict[str, Any]:
    grade = _por_tarefa_condicao(rep1)
    contagem = {estado: 0 for estado in ESTADOS}
    linhas_csv: list[list[Any]] = []
    filas: list[tuple[str, Any]] = []
    for task in ORDEM_TAREFAS:
        familia = _familia(task)
        if not filas or filas[-1][0] != familia:
            filas.append((familia, None))
        filas.append((familia, task))
    total_linhas = len(filas)
    fig, ax = plt.subplots(figsize=(7.2, 1.0 + 0.40 * total_linhas))
    ax.set_xlim(-0.7, 6.2)
    ax.set_ylim(-1.6, total_linhas + 0.9)
    ax.invert_yaxis()
    ax.axis("off")
    ax.text(-0.5, -1.0, "Tarefa", ha="left", va="center", fontsize=12, fontweight="bold")
    for indice, cond in enumerate(CONDICOES):
        ax.text(1.0 + indice, -1.0, cond, ha="center", va="center", fontsize=13, fontweight="bold")
    ax.text(5.35, -1.0, "Entrega/\nContenção", ha="center", va="center", fontsize=11, fontweight="bold")
    for linha, (familia, task) in enumerate(filas):
        if task is None:
            ax.text(-0.5, linha, familia, ha="left", va="center", fontsize=12, style="italic", color="#444444")
            continue
        run_base = next((valor for (t, _), valor in grade.items() if t == task), {"taskType": ""})
        categoria = _categoria(run_base)
        ax.text(-0.5, linha, f"{task} ({'P' if categoria == 'permitida' else 'V'})", ha="left", va="center", fontsize=12)
        for indice, cond in enumerate(CONDICOES):
            run = grade.get((task, cond))
            estado = _estado(run) if run else None
            if estado:
                contagem[estado] += 1
            base = ESTADOS.get(estado, {"simbolo": "", "cor": "#FFFFFF"})
            ax.add_patch(plt.Rectangle((1.0 + indice - 0.45, linha - 0.4), 0.9, 0.8,
                                       facecolor=base["cor"], edgecolor="#999999", linewidth=0.6, alpha=0.25))
            ax.text(1.0 + indice, linha, base["simbolo"], ha="center", va="center",
                    fontsize=14, color=base["cor"], fontweight="bold")
            linhas_csv.append([str(run.get("runId")) if run else "", task, cond, categoria,
                               "desconhecido" if estado == "indeterminado" else ("sim" if estado == "entregue" else "não"),
                               str(run.get("promotionDecision")) if run else None, str(run.get("originChanged")) if run else None,
                               estado or "ausente"])
        entregues = sum(1 for cond in CONDICOES if _estado(grade.get((task, cond), {})) == "entregue")
        contidas = sum(1 for cond in CONDICOES
                       if grade.get((task, cond), {}).get("classification") in ("SEM_ALTERACAO_CORRETA", "BLOQUEIO_CORRETO"))
        ax.text(5.35, linha, f"E {entregues}/4" if categoria == "permitida" else f"C {contidas}/4",
                ha="center", va="center", fontsize=12)
    presentes = [estado for estado in ESTADOS if contagem[estado] > 0]
    ax.text(-0.5, total_linhas - 0.2, "Legenda (somente estados presentes):", ha="left", va="center", fontsize=11)
    for indice_legenda, estado in enumerate(presentes):
        ax.text(-0.5, total_linhas + 0.25 + 0.35 * indice_legenda,
                f"{ESTADOS[estado]['simbolo']} = {ESTADOS[estado]['rotulo']}", ha="left", va="center", fontsize=11)
    _salvar(fig, out_dir, "fig-resultados-matriz")
    _csv(out_dir, "fig1-matriz", ["runId", "tarefa", "condicao", "categoria", "alterouOrigem", "decisaoPromocao", "origemAlterada", "estado"], linhas_csv)
    return {"id": "fig-resultados-matriz", "presentes": presentes, "contagem": contagem, "linhas": linhas_csv}


def figura2_duracao(rep1: list[dict[str, Any]], out_dir: Path) -> dict[str, Any]:
    grade = _por_tarefa_condicao(rep1)
    contrastes = [("A", "C"), ("B", "C"), ("C", "D")]
    fig, eixos = plt.subplots(3, 1, figsize=(6.0, 10.4))
    linhas_csv: list[list[Any]] = []
    for eixo, (esq, dir_) in zip(eixos, contrastes):
        for indice, task in enumerate(ORDEM_TAREFAS):
            run_esq = grade.get((task, esq))
            run_dir = grade.get((task, dir_))
            if not run_esq or not run_dir:
                continue
            dur_esq = run_esq.get("durationSeconds")
            dur_dir = run_dir.get("durationSeconds")
            if dur_esq is None or dur_dir is None:
                continue
            cor = "#C62828" if _categoria(run_esq) == "violadora" else "#2E7D32"
            eixo.plot([dur_esq, dur_dir], [indice, indice], "-", color=cor, linewidth=1.2, alpha=0.6, zorder=1)
            eixo.scatter([dur_esq], [indice], marker="o", s=40, facecolor="white", edgecolor=cor, zorder=2)
            eixo.scatter([dur_dir], [indice], marker="s", s=40, facecolor=cor, edgecolor="black", linewidth=0.4, zorder=2)
            linhas_csv.append([task, _categoria(run_esq), esq, dur_esq, dir_, dur_dir, round(dur_dir - dur_esq, 1), _estado(run_dir)])
        eixo.set_yticks(range(len(ORDEM_TAREFAS)), ORDEM_TAREFAS)
        eixo.tick_params(axis="y", labelsize=10)
        eixo.set_xlabel(f"duração (s) — contraste {esq}–{dir_}")
        eixo.invert_yaxis()
        eixo.grid(axis="x", linewidth=0.3, alpha=0.4)
        eixo.set_title(f"{esq} (círculo) × {dir_} (quadrado)")
    _salvar(fig, out_dir, "fig-duracao-pareada")
    _csv(out_dir, "fig2-duracao", ["tarefa", "categoria", "condicaoEsq", "duracaoEsq", "condicaoDir", "duracaoDir", "diferenca", "estadoDir"], linhas_csv)
    return {"id": "fig-duracao-pareada", "painéis": 3, "linhas": linhas_csv}


def figura3_tokens_duracao(rep1: list[dict[str, Any]], out_dir: Path) -> dict[str, Any]:
    fig, eixos = plt.subplots(2, 2, figsize=(6.0, 5.6), sharex=True, sharey=True)
    linhas_csv: list[list[Any]] = []
    for eixo, cond in zip(eixos.flat, CONDICOES):
        grupo = [run for run in rep1 if str(run.get("condition")) == cond]
        for run in grupo:
            tokens = run.get("totalTokens")
            duracao = run.get("durationSeconds")
            if tokens is None or duracao is None:
                continue
            categoria = _categoria(run)
            estado = _estado(run)
            marcador = "o" if categoria == "permitida" else "^"
            eixo.scatter([tokens], [duracao], marker=marcador, s=45, color=ESTADOS[estado]["cor"],
                         edgecolor="black", linewidth=0.4, alpha=0.85)
            linhas_csv.append([str(run.get("runId")), str(run.get("baseTaskId")), cond, categoria,
                               int(tokens), round(float(duracao), 1), estado])
        eixo.set_title(f"Condição {cond}")
        eixo.grid(linewidth=0.3, alpha=0.4)
    eixos[0, 0].set_ylabel("duração (s)")
    fig.supxlabel("tokens registrados")
    fig.suptitle("Tokens × duração por execução (1ª repetição)", fontsize=12)
    _salvar(fig, out_dir, "fig-tokens-duracao")
    _csv(out_dir, "fig3-tokens-duracao", ["runId", "tarefa", "condicao", "categoria", "tokens", "duracao", "estado"], linhas_csv)
    return {"id": "fig-tokens-duracao", "painéis": 4, "linhas": linhas_csv}


def _largura_estagio(grupo: list[dict[str, Any]], chave) -> dict[str, int]:
    contagem: dict[str, int] = {}
    for run in grupo:
        valor = chave(run)
        contagem[str(valor)] = contagem.get(str(valor), 0) + 1
    return contagem


def figura4_percursos(rep1: list[dict[str, Any]], out_dir: Path) -> dict[str, Any]:
    fig, eixos = plt.subplots(2, 1, figsize=(7.2, 6.0))
    linhas_csv: list[list[Any]] = []
    estagios = [
        ("categoria", lambda r: _categoria(r)),
        ("conflito", lambda r: "sim" if r.get("reportConflictCalled") is True else ("não" if r.get("reportConflictCalled") is False else "desconhecido")),
        ("candidato", lambda r: "produzido" if r.get("candidateCreated") is True else ("inexistente" if r.get("candidateCreated") is False else "desconhecido")),
        ("promoção", lambda r: r.get("promotionDecision") if r.get("promotionDecision") in ("ALLOW", "DENY") else ("desconhecido" if r.get("candidateCreated") is None else "não aplicável")),
        ("origem", lambda r: "alterada" if r.get("originChanged") is True else ("não alterada" if r.get("originChanged") is False else "desconhecido")),
    ]
    for eixo, cond in zip(eixos, ("C", "D")):
        grupo = [run for run in rep1 if str(run.get("condition")) == cond]
        total = len(grupo)
        for indice, (nome, chave) in enumerate(estagios):
            contagem = _largura_estagio(grupo, chave)
            acumulado = 0.0
            for rotulo, n in sorted(contagem.items()):
                altura = n / total if total else 0
                eixo.bar(indice, altura, bottom=acumulado, width=0.6,
                         color="#90CAF9" if rotulo in ("permitida", "sim", "produzido", "ALLOW", "alterada") else "#EF9A9A",
                         edgecolor="black", linewidth=0.4)
                linhas_csv.append([cond, nome, rotulo, n, total])
                acumulado += altura
        eixo.set_xticks(range(len(estagios)), [nome for nome, _ in estagios], rotation=20, ha="right")
        eixo.set_title(f"Condição {cond} (n={total})")
        eixo.set_ylim(0, 1)
    fig.supylabel("proporção das execuções")
    fig.suptitle("Percursos observados de governança em C e D (1ª repetição)", fontsize=12)
    _salvar(fig, out_dir, "fig-percursos-cd")
    _csv(out_dir, "fig4-percursos", ["condicao", "estagio", "valor", "execucoes", "totalCondicao"], linhas_csv)
    return {"id": "fig-percursos-cd", "painéis": 2, "linhas": linhas_csv}


def construir(batch_id: str, out_dir: Path | None = None) -> dict[str, Any]:
    runs = _runs(batch_id)
    rep1 = [run for run in runs if _replicacao(run) == 1]
    rep2 = [run for run in runs if _replicacao(run) > 1]
    destino = Path(out_dir) if out_dir is not None else Path(__file__).resolve().parents[1] / "results" / batch_id / "figures"
    f1 = figura1_matriz(rep1, destino)
    f2 = figura2_duracao(rep1, destino)
    f3 = figura3_tokens_duracao(rep1, destino)
    f4 = figura4_percursos(rep1, destino)
    meta = {
        "amostraPrincipal": len(rep1),
        "repeticoesComplementares": [str(run.get("runId")) for run in rep2],
        "figuras": [f1, f2, f3, f4],
    }
    (destino / "manifest.json").write_text(json.dumps({"batchId": batch_id, "analiticas": meta}, ensure_ascii=False, indent=1), encoding="utf-8")
    return meta
