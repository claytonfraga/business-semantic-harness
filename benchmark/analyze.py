#!/usr/bin/env python3
"""Analise do benchmark: estatisticas, comparacao e graficos.

Le results/<pasta>/<condicao>/result.json e escreve results/stats.md,
results/stats.json, results/measurements.csv e graficos em results/charts/.
"""
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from lib import statistics as stats

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
CHARTS = RESULTS / "charts"
ROTULOS = {"sem-oracle": "Codex sem Oracle", "com-oracle": "Codex com Oracle harness"}
CORES = {"sem-oracle": "#D55E00", "com-oracle": "#0072B2"}

plt.rcParams.update({
    "figure.dpi": 300, "savefig.dpi": 300, "font.size": 11, "axes.titlesize": 12,
    "axes.grid": True, "grid.alpha": 0.3, "grid.linestyle": "--",
    "axes.spines.top": False, "axes.spines.right": False,
})


def carregar():
    execucoes = {}
    for pasta in sorted(RESULTS.iterdir()):
        if not pasta.is_dir() or pasta.name == "charts":
            continue
        registro = {}
        for condicao in ("sem-oracle", "com-oracle"):
            arquivo = pasta / condicao / "result.json"
            if arquivo.is_file():
                dado = json.loads(arquivo.read_text(encoding="utf-8"))
                if not dado.get("erro"):
                    registro[condicao] = dado
        if registro:
            execucoes[pasta.name] = registro
    return execucoes


def valores(execucoes, condicao, campo):
    return [registro[condicao][campo] for registro in execucoes.values() if condicao in registro]


def metadados():
    for pasta in sorted(RESULTS.iterdir()):
        arquivo = pasta / "metadata.json"
        if arquivo.is_file():
            return json.loads(arquivo.read_text(encoding="utf-8"))
    return {}


def _boxplot(execucoes):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    dados = [valores(execucoes, c, "totais") for c in ("sem-oracle", "com-oracle")]
    caixas = eixo.boxplot(dados, tick_labels=[ROTULOS["sem-oracle"], ROTULOS["com-oracle"]], patch_artist=True, widths=0.5, showfliers=False)
    for caixa, c in zip(caixas["boxes"], ("sem-oracle", "com-oracle")):
        caixa.set_facecolor(CORES[c]); caixa.set_alpha(0.35)
    for indice, c in enumerate(("sem-oracle", "com-oracle")):
        jitter = [((i % 5) - 2) * 0.03 for i in range(len(dados[indice]))]
        eixo.scatter([indice + 1 + j for j in jitter], dados[indice], color=CORES[c], s=26, zorder=3, edgecolor="white", linewidth=0.5)
    eixo.set_ylabel("Tokens totais por execucao"); eixo.set_title("Distribuicao de tokens por condicao")
    figura.tight_layout(); figura.savefig(CHARTS / "01-boxplot-tokens.png"); plt.close(figura)


def _media_ic(execucoes):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    condicoes = ["sem-oracle", "com-oracle"]
    resumos = [stats.describe(valores(execucoes, c, "totais")) for c in condicoes]
    barras = eixo.bar([ROTULOS[c] for c in condicoes], [r["media"] for r in resumos], yerr=[r["ic95"] for r in resumos], capsize=6, color=[CORES[c] for c in condicoes], alpha=0.85)
    for barra, r in zip(barras, resumos):
        eixo.text(barra.get_x() + barra.get_width() / 2, r["media"], f"{r['media']:,.0f}", ha="center", va="bottom", fontsize=10)
    eixo.set_ylabel("Tokens totais (media, IC 95%)"); eixo.set_title("Custo medio de tokens por condicao")
    figura.tight_layout(); figura.savefig(CHARTS / "02-media-ic95.png"); plt.close(figura)


def _pareado(execucoes):
    figura, eixo = plt.subplots(figsize=(6.6, 4.4))
    for registro in execucoes.values():
        if "sem-oracle" in registro and "com-oracle" in registro:
            eixo.plot([0, 1], [registro["sem-oracle"]["totais"], registro["com-oracle"]["totais"]], color="#9e9e9e", alpha=0.6, linewidth=1)
            eixo.scatter([0], [registro["sem-oracle"]["totais"]], color=CORES["sem-oracle"], s=28, zorder=3)
            eixo.scatter([1], [registro["com-oracle"]["totais"]], color=CORES["com-oracle"], s=28, zorder=3)
    eixo.set_xticks([0, 1]); eixo.set_xticklabels([ROTULOS["sem-oracle"], ROTULOS["com-oracle"]])
    eixo.set_ylabel("Tokens totais"); eixo.set_title("Comparacao pareada por execucao")
    figura.tight_layout(); figura.savefig(CHARTS / "03-pareado.png"); plt.close(figura)


def _distribuicao(execucoes):
    figura, eixo = plt.subplots(figsize=(6.4, 4.4))
    for c in ("sem-oracle", "com-oracle"):
        amostra = valores(execucoes, c, "totais")
        if len(amostra) > 1:
            eixo.hist(amostra, bins=min(8, len(amostra)), density=True, alpha=0.35, color=CORES[c], label=ROTULOS[c], edgecolor="white")
        if amostra:
            eixo.axvline(stats.describe(amostra)["media"], color=CORES[c], linestyle="--", linewidth=1.2)
    eixo.set_xlabel("Tokens totais"); eixo.set_ylabel("Densidade"); eixo.set_title("Distribuicao dos tokens"); eixo.legend()
    figura.tight_layout(); figura.savefig(CHARTS / "04-distribuicao.png"); plt.close(figura)


def _governanca(execucoes):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    condicoes = ["sem-oracle", "com-oracle"]
    taxas = []
    for c in condicoes:
        registros = [r[c] for r in execucoes.values() if c in r]
        taxas.append((sum(1 for r in registros if r.get("bloqueado")) / len(registros) * 100) if registros else 0.0)
    barras = eixo.bar([ROTULOS[c] for c in condicoes], taxas, color=[CORES[c] for c in condicoes], alpha=0.85)
    for barra, taxa in zip(barras, taxas):
        eixo.text(barra.get_x() + barra.get_width() / 2, taxa, f"{taxa:.0f}%", ha="center", va="bottom", fontsize=10)
    eixo.set_ylim(0, 105); eixo.set_ylabel("Execucoes bloqueadas (%)"); eixo.set_title("Governanca da ontologia")
    figura.tight_layout(); figura.savefig(CHARTS / "05-governanca.png"); plt.close(figura)


def _principal(execucoes):
    figura, eixos = plt.subplots(2, 2, figsize=(11, 8.5))
    condicoes = ["sem-oracle", "com-oracle"]
    dados = [valores(execucoes, c, "totais") for c in condicoes]
    caixas = eixos[0][0].boxplot(dados, tick_labels=[ROTULOS[c] for c in condicoes], patch_artist=True, widths=0.5, showfliers=False)
    for caixa, c in zip(caixas["boxes"], condicoes):
        caixa.set_facecolor(CORES[c]); caixa.set_alpha(0.35)
    eixos[0][0].set_title("(a) Distribuicao de tokens"); eixos[0][0].set_ylabel("Tokens totais")
    resumos = [stats.describe(a) for a in dados]
    eixos[0][1].bar([ROTULOS[c] for c in condicoes], [r["media"] for r in resumos], yerr=[r["ic95"] for r in resumos], capsize=6, color=[CORES[c] for c in condicoes], alpha=0.85)
    eixos[0][1].set_title("(b) Media com IC 95%"); eixos[0][1].set_ylabel("Tokens totais")
    for registro in execucoes.values():
        if "sem-oracle" in registro and "com-oracle" in registro:
            eixos[1][0].plot([0, 1], [registro["sem-oracle"]["totais"], registro["com-oracle"]["totais"]], color="#9e9e9e", alpha=0.6, linewidth=1)
    eixos[1][0].scatter([0] * len(dados[0]), dados[0], color=CORES["sem-oracle"], s=24)
    eixos[1][0].scatter([1] * len(dados[1]), dados[1], color=CORES["com-oracle"], s=24)
    eixos[1][0].set_xticks([0, 1]); eixos[1][0].set_xticklabels([ROTULOS[c] for c in condicoes]); eixos[1][0].set_title("(c) Comparacao pareada"); eixos[1][0].set_ylabel("Tokens totais")
    taxas = []
    for c in condicoes:
        registros = [r[c] for r in execucoes.values() if c in r]
        taxas.append((sum(1 for r in registros if r.get("bloqueado")) / len(registros) * 100) if registros else 0.0)
    eixos[1][1].bar([ROTULOS[c] for c in condicoes], taxas, color=[CORES[c] for c in condicoes], alpha=0.85)
    eixos[1][1].set_ylim(0, 105); eixos[1][1].set_ylabel("Bloqueios (%)"); eixos[1][1].set_title("(d) Governanca")
    figura.suptitle("Benchmark: Codex sem Oracle vs Codex com Oracle harness", fontsize=13)
    figura.tight_layout(rect=[0, 0, 1, 0.97]); figura.savefig(CHARTS / "00-figura-principal.png"); plt.close(figura)


def main():
    execucoes = carregar()
    if not execucoes:
        raise SystemExit("Nenhum resultado em results/. Rode run_benchmark.py primeiro.")
    CHARTS.mkdir(exist_ok=True)
    meta = metadados()
    ambiente = meta.get("ambiente", {})
    prompt = meta.get("prompt", "")
    condicoes = ["sem-oracle", "com-oracle"]
    resumo = {}
    for c in condicoes:
        registros = [r[c] for r in execucoes.values() if c in r]
        resumo[c] = {
            "totais": stats.describe([r["totais"] for r in registros]),
            "entrada": stats.describe([r["entrada"] for r in registros]),
            "saida": stats.describe([r["saida"] for r in registros]),
            "duracao": stats.describe([r["duracao"] for r in registros]),
            "consultas": sum(r["consultas"] for r in registros),
            "conflitos": sum(r["conflitos"] for r in registros),
            "bloqueados": sum(1 for r in registros if r.get("bloqueado")),
            "n": len(registros),
        }
    sem = resumo["sem-oracle"]["totais"]["media"]
    com = resumo["com-oracle"]["totais"]["media"]
    diferenca = com - sem
    percentual = (diferenca / sem * 100) if sem else 0.0
    d = stats.cohen_d(valores(execucoes, "com-oracle", "totais"), valores(execucoes, "sem-oracle", "totais"))
    relatorio = {"prompt": prompt, "ambiente": ambiente, "execucoes": len(execucoes), "resumo": resumo,
                 "comparacao": {"sem_oracle_media": round(sem, 2), "com_oracle_media": round(com, 2),
                                "diferenca_tokens": round(diferenca, 2), "diferenca_percentual": round(percentual, 2), "cohen_d": round(d, 3)}}
    (RESULTS / "stats.json").write_text(json.dumps(relatorio, indent=2, ensure_ascii=False), encoding="utf-8")
    with open(RESULTS / "measurements.csv", "w", encoding="utf-8", newline="") as handle:
        escritor = csv.writer(handle)
        escritor.writerow(["condicao", "execucoes", "media_tokens", "mediana_tokens", "desvio_tokens", "cv_percentual", "ic95_tokens", "min_tokens", "max_tokens", "bloqueados"])
        for c in condicoes:
            t = resumo[c]["totais"]
            escritor.writerow([c, t["n"], round(t["media"], 1), round(t["mediana"], 1), round(t["desvio"], 1), round(t["cv"], 2), round(t["ic95"], 1), t["min"], t["max"], resumo[c]["bloqueados"]])
    _boxplot(execucoes); _media_ic(execucoes); _pareado(execucoes); _distribuicao(execucoes); _governanca(execucoes); _principal(execucoes)

    linhas = ["# Benchmark: Codex com e sem Oracle harness", "", "## Objetivo", "",
              "Medir o custo em tokens e o efeito de governanca do Oracle harness frente ao Codex direto, executando o mesmo pedido em copias limpas do projeto.", "",
              "## Desenho experimental", "",
              f"- Execucoes por condicao: **{len(execucoes)}**.",
              f"- Modelo: `{meta.get('modelo', '?')}` (esforco `{meta.get('esforco', '?')}`), identico nas duas condicoes.",
              "- Condicoes: `sem-oracle` (Codex direto) e `com-oracle` (`oracle codex`, harness).",
              "- Isolamento: copia limpa e independente por execucao; ordem das condicoes alternada.",
              f"- Pedido: \"{prompt}\"", "", "## Ambiente", "",
              f"- Codex: `{ambiente.get('codex', '?')}`",
              f"- Oracle: `{ambiente.get('oracle', '?')}`",
              f"- Python: `{ambiente.get('python', '?')}`",
              f"- Plataforma: `{ambiente.get('plataforma', '?')}`", "", "## Resultados", "",
              "| Condicao | n | Media | Mediana | Desvio padrao | CV (%) | IC 95% | Min | Max |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for c in condicoes:
        t = resumo[c]["totais"]
        linhas.append(f"| {ROTULOS[c]} | {t['n']} | {t['media']:,.0f} | {t['mediana']:,.0f} | {t['desvio']:,.0f} | {t['cv']:.1f} | +/- {t['ic95']:,.0f} | {t['min']:,.0f} | {t['max']:,.0f} |")
    linhas += ["", "Detalhe por metrica:", "",
               "| Condicao | Entrada (media) | Saida (media) | Duracao media (s) | Consultas | Conflitos | Bloqueios |",
               "| --- | --- | --- | --- | --- | --- | --- |"]
    for c in condicoes:
        r = resumo[c]
        linhas.append(f"| {ROTULOS[c]} | {r['entrada']['media']:,.0f} | {r['saida']['media']:,.0f} | {r['duracao']['media']:.0f} | {r['consultas']} | {r['conflitos']} | {r['bloqueados']}/{r['n']} |")
    sinal = "economia" if diferenca < 0 else "aumento"
    linhas += ["", "## Comparacao", "",
               f"- Media sem Oracle: **{sem:,.0f}** tokens; com Oracle: **{com:,.0f}** tokens.",
               f"- Diferenca media: **{diferenca:+,.0f} tokens ({percentual:+.2f}%)** ({sinal} com o harness).",
               f"- Tamanho de efeito (Cohen's d): **{d:.2f}**.", "", "## Governanca", "",
               f"- Sem Oracle: {resumo['sem-oracle']['bloqueados']}/{resumo['sem-oracle']['n']} bloqueadas.",
               f"- Com Oracle: {resumo['com-oracle']['bloqueados']}/{resumo['com-oracle']['n']} bloqueadas.", "",
               "## Figuras", "", "![Figura principal](charts/00-figura-principal.png)", "",
               "![Boxplot](charts/01-boxplot-tokens.png)", "", "![Media com IC 95%](charts/02-media-ic95.png)", "",
               "![Pareado](charts/03-pareado.png)", "", "![Distribuicao](charts/04-distribuicao.png)", "",
               "![Governanca](charts/05-governanca.png)", "", "## Ameacas a validade", "",
               "- Amostra pequena: IC largos; nao se afirma significancia estatistica.",
               "- Variabilidade do modelo entre execucoes.",
               "- O efeito do harness depende do pedido; pedidos que exigem correcao de rumo tendem a favorece-lo.",
               "- O Codex direto nao recebe contexto ontologico nem o MCP Oracle, parte do efeito medido.", "",
               "## Reproducao", "", "```bash",
               "BENCH_RUNS=10 BENCH_PROMPT=benchmark/prompts/bloqueado.txt \\",
               "  benchmark/.venv/bin/python benchmark/run_benchmark.py",
               "benchmark/.venv/bin/python benchmark/analyze.py", "```"]
    (RESULTS / "stats.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print(json.dumps(relatorio["comparacao"], indent=2, ensure_ascii=False))
    print(f"Relatorio: {RESULTS / 'stats.md'}")


if __name__ == "__main__":
    main()
