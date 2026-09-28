#!/usr/bin/env python3
"""Gera um relatorio TeX e PDF para cada lote (execucao completa) do benchmark.

O PDF fica na pasta do lote e e copiado para a pasta Downloads, com o nome
`relatorio-benchmark-<pasta-do-lote>.pdf`.
"""
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
DOWNLOADS = Path("/mnt/c/Users/clayt/Downloads")
def rotulos_para(agente: str = "codex") -> dict:
    nome = "Agy" if str(agente).lower() == "agy" else "Codex"
    return {
        "sem-harness": f"A - {nome} direto",
        "com-contexto-sem-enforcement": f"B - {nome} com contexto ontologico, sem enforcement independente",
        "com-harness": f"C - {nome} com BSH e enforcement independente",
    }

ROTULOS = rotulos_para("codex")


def _esc(texto: str) -> str:
    return (texto.replace("\\", "\\textbackslash{}").replace("&", "\\&").replace("%", "\\%")
            .replace("_", "\\_").replace("#", "\\#").replace("{", "\\{").replace("}", "\\}"))


def _tabela_condicoes(stats: dict, rotulos: dict = None) -> str:
    rot = rotulos or ROTULOS
    linhas = [r"\begin{tabular}{lrrrr}", r"\toprule",
              r"Condicao & n & Media (tokens) & Desvio & IC 95\% \\", r"\midrule"]
    for condicao, rotulo in rot.items():
        resumo = (stats.get("resumo") or {}).get(condicao)
        if not resumo:
            continue
        t = resumo.get("totais", {})
        linhas.append(f"{_esc(rotulo)} & {t.get('n', 0)} & {t.get('media', 0):.0f} & {t.get('desvio', 0):.0f} & $\\pm${t.get('ic95', 0):.0f} \\\\")
    linhas += [r"\bottomrule", r"\end{tabular}"]
    return "\n".join(linhas)


def construir_tex(pasta: str, stats: dict) -> str:
    pareado = stats.get("pareado") or {}
    prompt = stats.get("prompt", "")
    agente = stats.get("ambiente", {}).get("agente") or ("agy" if pasta.startswith("agy-") else "codex")
    rotulos = rotulos_para(agente)
    return rf"""\documentclass[11pt,a4paper]{{article}}
\usepackage[utf8]{{inputenc}}
\usepackage[T1]{{fontenc}}
\usepackage[margin=2.4cm]{{geometry}}
\usepackage{{booktabs}}
\usepackage{{graphicx}}
\usepackage{{hyperref}}
\graphicspath{{{{./}}}}
\title{{Relatorio de benchmark --- {_esc(pasta)}}}
\author{{Business Semantic Harness}}
\date{{\today}}
\begin{{document}}
\maketitle
\section{{Lote}}
Pasta: \texttt{{{_esc(pasta)}}}.\\Prompt: {_esc(prompt)}.

\section{{Condicoes}}
{_tabela_condicoes(stats, rotulos)}

\section{{Comparacao pareada}}
Diferenca media (sem menos com): {pareado.get('diferenca_media', 0):.0f} tokens
({pareado.get('diferenca_percentual', 0):+.2f}\%), IC 95\% $\pm${pareado.get('diferenca_ic95', 0):.0f},
Cohen's $d_z$ = {pareado.get('cohen_dz', 0):.2f}.
Teste de Wilcoxon: W = {pareado.get('wilcoxon_estatistica', 0)}, p = {pareado.get('wilcoxon_p', 0)}.

\section{{Figura principal}}
\includegraphics[width=0.95\linewidth]{{charts/00-figura-principal.png}}

\section{{Leitura}}
A condicao C aplica enforcement semantico independente: uma operacao governada so e aceita
apos passar pela ontologia e pelas restricoes SHACL, mesmo que o agente nao relate conflito.
Reducao de tokens nao e sinonimo de correcao; compare tambem violacoes bloqueadas e nao detectadas.
\end{{document}}
"""


def gerar_relatorio(lote_dir: Path) -> Path | None:
    if not lote_dir.is_dir():
        return None
    pasta = lote_dir.name
    arquivo_stats = lote_dir / "stats.json"
    stats = json.loads(arquivo_stats.read_text(encoding="utf-8")) if arquivo_stats.is_file() else {}
    tex = lote_dir / f"relatorio-benchmark-{pasta}.tex"
    tex.write_text(construir_tex(pasta, stats), encoding="utf-8")
    if shutil.which("pdflatex") is None:
        return tex
    for _ in range(2):
        subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex.name],
                       cwd=lote_dir, capture_output=True, text=True)
    pdf = lote_dir / f"relatorio-benchmark-{pasta}.pdf"
    if pdf.is_file() and DOWNLOADS.is_dir():
        shutil.copy(pdf, DOWNLOADS / pdf.name)
    return pdf if pdf.is_file() else tex


if __name__ == "__main__":
    import sys
    alvo = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if alvo:
        print(gerar_relatorio(alvo))
