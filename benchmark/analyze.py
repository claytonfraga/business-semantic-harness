#!/usr/bin/env python3
"""Analise do benchmark, por lote.

Cada lote em results/<data-hora-segundos>/ e um benchmark: contem as execucoes
numeradas (1..n), o aquecimento e os proprios artefatos de analise
(stats.md, stats.json, measurements.csv e charts/).
"""
import csv
import json
import os
import subprocess
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy import stats as scipy_stats

from lib import statistics as stats

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
RESULTS = HERE / "results"
ROTULOS = {"sem-bsh": "Codex sem BSH", "com-bsh": "Codex com BSH harness"}
CORES = {"sem-bsh": "#D55E00", "com-bsh": "#0072B2"}

plt.rcParams.update({
    "figure.dpi": 300, "savefig.dpi": 300, "font.size": 11, "axes.titlesize": 12,
    "axes.grid": True, "grid.alpha": 0.3, "grid.linestyle": "--",
    "axes.spines.top": False, "axes.spines.right": False,
})


def _normalizado(registro):
    return max(0, registro["entrada"] - registro["cache"]) + registro["saida"]


def carregar(lote_dir):
    execucoes = {}
    erros = {"sem-bsh": 0, "com-bsh": 0}
    for pasta in sorted(lote_dir.iterdir()):
        if not pasta.is_dir() or pasta.name == "aquecimento":
            continue
        registro = {}
        for condicao in ("sem-bsh", "com-bsh"):
            arquivo = pasta / condicao / "result.json"
            if not arquivo.is_file():
                continue
            dado = json.loads(arquivo.read_text(encoding="utf-8"))
            if dado.get("erro"):
                erros[condicao] += 1
            else:
                registro[condicao] = dado
        if registro:
            meta_file = pasta / "metadata.json"
            registro["_prompt"] = json.loads(meta_file.read_text(encoding="utf-8")).get("prompt", "desconhecido") if meta_file.is_file() else "desconhecido"
            execucoes[pasta.name] = registro
    return execucoes, erros


def valores(execucoes, condicao, campo):
    return [registro[condicao][campo] for registro in execucoes.values() if condicao in registro]


def pares(execucoes, campo):
    sem, com = [], []
    for registro in execucoes.values():
        if "sem-bsh" in registro and "com-bsh" in registro:
            sem.append(registro["sem-bsh"][campo])
            com.append(registro["com-bsh"][campo])
    return sem, com


def metadados(lote_dir):
    for pasta in sorted(lote_dir.iterdir()):
        arquivo = pasta / "metadata.json"
        if arquivo.is_file():
            return json.loads(arquivo.read_text(encoding="utf-8"))
    return {}


def commit_harness():
    try:
        return subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return "indisponivel"


def agrupar_por_prompt(execucoes):
    grupos = {}
    for registro in execucoes.values():
        grupos.setdefault(registro.get("_prompt", "desconhecido"), []).append(registro)
    return grupos


def resumo_prompt(registros):
    sem = [r["sem-bsh"]["totais"] for r in registros if "sem-bsh" in r]
    com = [r["com-bsh"]["totais"] for r in registros if "com-bsh" in r]
    sem_media, com_media = stats.describe(sem)["media"], stats.describe(com)["media"]
    reducao = ((com_media - sem_media) / sem_media * 100) if sem_media else 0.0
    pvalor = None
    if len(sem) >= 1 and len(sem) == len(com):
        try:
            pvalor = float(scipy_stats.wilcoxon(sem, com).pvalue)
        except ValueError:
            pvalor = None
    return {
        "n": min(len(sem), len(com)), "sem_media": sem_media, "com_media": com_media, "reducao": reducao,
        "sem_bloqueados": sum(1 for r in registros if "sem-bsh" in r and r["sem-bsh"].get("bloqueado")),
        "com_bloqueados": sum(1 for r in registros if "com-bsh" in r and r["com-bsh"].get("bloqueado")),
        "p": pvalor,
    }


def _boxplot(execucoes, charts):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    dados = [valores(execucoes, c, "totais") for c in ("sem-bsh", "com-bsh")]
    caixas = eixo.boxplot(dados, tick_labels=[ROTULOS["sem-bsh"], ROTULOS["com-bsh"]], patch_artist=True, widths=0.5, showfliers=False)
    for caixa, c in zip(caixas["boxes"], ("sem-bsh", "com-bsh")):
        caixa.set_facecolor(CORES[c]); caixa.set_alpha(0.35)
    for indice, c in enumerate(("sem-bsh", "com-bsh")):
        jitter = [((i % 5) - 2) * 0.03 for i in range(len(dados[indice]))]
        eixo.scatter([indice + 1 + j for j in jitter], dados[indice], color=CORES[c], s=26, zorder=3, edgecolor="white", linewidth=0.5)
    eixo.set_ylabel("Tokens totais por execucao"); eixo.set_title("Distribuicao de tokens por condicao")
    figura.tight_layout(); figura.savefig(charts / "01-boxplot-tokens.png"); plt.close(figura)


def _media_ic(execucoes, charts):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    condicoes = ["sem-bsh", "com-bsh"]
    resumos = [stats.describe(valores(execucoes, c, "totais")) for c in condicoes]
    barras = eixo.bar([ROTULOS[c] for c in condicoes], [r["media"] for r in resumos], yerr=[r["ic95"] for r in resumos], capsize=6, color=[CORES[c] for c in condicoes], alpha=0.85)
    for barra, r in zip(barras, resumos):
        eixo.text(barra.get_x() + barra.get_width() / 2, r["media"], f"{r['media']:,.0f}", ha="center", va="bottom", fontsize=10)
    eixo.set_ylabel("Tokens totais (media, IC 95%)"); eixo.set_title("Custo medio de tokens por condicao")
    figura.tight_layout(); figura.savefig(charts / "02-media-ic95.png"); plt.close(figura)


def _pareado(execucoes, charts):
    figura, eixo = plt.subplots(figsize=(6.2, 5.2))
    sem, com = pares(execucoes, "totais")
    limite = max(sem + com + [1]) * 1.05
    eixo.plot([0, limite], [0, limite], linestyle="--", color="#9e9e9e", linewidth=1, label="mesmo custo (y = x)")
    eixo.scatter(sem, com, color=CORES["com-bsh"], s=45, edgecolor="white", linewidth=0.6, zorder=3, label="1 execucao")
    eixo.set_xlim(0, limite); eixo.set_ylim(0, limite)
    eixo.set_xlabel("Tokens sem BSH"); eixo.set_ylabel("Tokens com BSH")
    eixo.set_title("Custo pareado por execucao (cada ponto = 1 execucao)"); eixo.legend()
    figura.tight_layout(); figura.savefig(charts / "03-pareado.png"); plt.close(figura)


def _distribuicao(execucoes, charts):
    figura, eixo = plt.subplots(figsize=(6.4, 4.4))
    for c in ("sem-bsh", "com-bsh"):
        amostra = valores(execucoes, c, "totais")
        if len(amostra) > 1:
            eixo.hist(amostra, bins=min(8, len(amostra)), density=True, alpha=0.35, color=CORES[c], label=ROTULOS[c], edgecolor="white")
        if amostra:
            eixo.axvline(stats.describe(amostra)["media"], color=CORES[c], linestyle="--", linewidth=1.2)
    eixo.set_xlabel("Tokens totais"); eixo.set_ylabel("Densidade"); eixo.set_title("Distribuicao dos tokens"); eixo.legend()
    figura.tight_layout(); figura.savefig(charts / "04-distribuicao.png"); plt.close(figura)


def _governanca(execucoes, charts):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    condicoes = ["sem-bsh", "com-bsh"]
    taxas = []
    for c in condicoes:
        registros = [r[c] for r in execucoes.values() if c in r]
        taxas.append((sum(1 for r in registros if r.get("bloqueado")) / len(registros) * 100) if registros else 0.0)
    barras = eixo.bar([ROTULOS[c] for c in condicoes], taxas, color=[CORES[c] for c in condicoes], alpha=0.85)
    for barra, taxa in zip(barras, taxas):
        eixo.text(barra.get_x() + barra.get_width() / 2, taxa, f"{taxa:.0f}%", ha="center", va="bottom", fontsize=10)
    eixo.set_ylim(0, 105); eixo.set_ylabel("Execucoes bloqueadas (%)"); eixo.set_title("Governanca da ontologia")
    figura.tight_layout(); figura.savefig(charts / "05-governanca.png"); plt.close(figura)


def _normalizado_chart(execucoes, charts):
    figura, eixo = plt.subplots(figsize=(6.2, 4.4))
    condicoes = ["sem-bsh", "com-bsh"]
    resumos = [stats.describe([_normalizado(r[c]) for r in execucoes.values() if c in r]) for c in condicoes]
    barras = eixo.bar([ROTULOS[c] for c in condicoes], [r["media"] for r in resumos], yerr=[r["ic95"] for r in resumos], capsize=6, color=[CORES[c] for c in condicoes], alpha=0.85)
    for barra, r in zip(barras, resumos):
        eixo.text(barra.get_x() + barra.get_width() / 2, r["media"], f"{r['media']:,.0f}", ha="center", va="bottom", fontsize=10)
    eixo.set_ylabel("Tokens nao cacheados (media, IC 95%)"); eixo.set_title("Custo sem cache por condicao")
    figura.tight_layout(); figura.savefig(charts / "06-tokens-nao-cacheados.png"); plt.close(figura)


def _por_prompt_chart(grupos, charts):
    resumos = {prompt: resumo_prompt(registros) for prompt, registros in grupos.items()}
    rotulos = [(prompt[:36] + "...") if len(prompt) > 39 else prompt for prompt in grupos]
    x = list(range(len(rotulos)))
    largura = 0.38
    figura, eixo = plt.subplots(figsize=(max(7.5, 2.4 * len(rotulos)), 4.9))
    eixo.bar([i - largura / 2 for i in x], [r["sem_media"] for r in resumos.values()], largura, label=ROTULOS["sem-bsh"], color=CORES["sem-bsh"], alpha=0.85)
    eixo.bar([i + largura / 2 for i in x], [r["com_media"] for r in resumos.values()], largura, label=ROTULOS["com-bsh"], color=CORES["com-bsh"], alpha=0.85)
    eixo.set_xticks(x); eixo.set_xticklabels(rotulos, rotation=12, ha="right", fontsize=9)
    eixo.set_ylabel("Tokens totais (media)"); eixo.set_title("Custo medio por prompt e condicao"); eixo.legend()
    figura.tight_layout(); figura.savefig(charts / "07-por-prompt.png"); plt.close(figura)
    return resumos


def _principal(execucoes, charts):
    figura, eixos = plt.subplots(2, 2, figsize=(11, 8.5))
    condicoes = ["sem-bsh", "com-bsh"]
    dados = [valores(execucoes, c, "totais") for c in condicoes]
    caixas = eixos[0][0].boxplot(dados, tick_labels=[ROTULOS[c] for c in condicoes], patch_artist=True, widths=0.5, showfliers=False)
    for caixa, c in zip(caixas["boxes"], condicoes):
        caixa.set_facecolor(CORES[c]); caixa.set_alpha(0.35)
    eixos[0][0].set_title("(a) Distribuicao de tokens"); eixos[0][0].set_ylabel("Tokens totais")
    resumos = [stats.describe(a) for a in dados]
    eixos[0][1].bar([ROTULOS[c] for c in condicoes], [r["media"] for r in resumos], yerr=[r["ic95"] for r in resumos], capsize=6, color=[CORES[c] for c in condicoes], alpha=0.85)
    eixos[0][1].set_title("(b) Media com IC 95%"); eixos[0][1].set_ylabel("Tokens totais")
    sem, com = pares(execucoes, "totais")
    limite = max(sem + com + [1]) * 1.05
    eixos[1][0].plot([0, limite], [0, limite], linestyle="--", color="#9e9e9e", linewidth=1)
    eixos[1][0].scatter(sem, com, color=CORES["com-bsh"], s=34, edgecolor="white", linewidth=0.5, zorder=3)
    eixos[1][0].set_xlim(0, limite); eixos[1][0].set_ylim(0, limite)
    eixos[1][0].set_xlabel("Sem BSH"); eixos[1][0].set_ylabel("Com BSH"); eixos[1][0].set_title("(c) Custo pareado (1 ponto = 1 execucao)")
    taxas = []
    for c in condicoes:
        registros = [r[c] for r in execucoes.values() if c in r]
        taxas.append((sum(1 for r in registros if r.get("bloqueado")) / len(registros) * 100) if registros else 0.0)
    eixos[1][1].bar([ROTULOS[c] for c in condicoes], taxas, color=[CORES[c] for c in condicoes], alpha=0.85)
    eixos[1][1].set_ylim(0, 105); eixos[1][1].set_ylabel("Bloqueios (%)"); eixos[1][1].set_title("(d) Governanca")
    figura.suptitle("Benchmark: Codex sem BSH vs Codex com BSH harness", fontsize=13)
    figura.tight_layout(rect=[0, 0, 1, 0.97]); figura.savefig(charts / "00-figura-principal.png"); plt.close(figura)


def analisar(lote_dir):
    execucoes, erros = carregar(lote_dir)
    if not execucoes:
        return None
    charts = lote_dir / "charts"
    charts.mkdir(exist_ok=True)
    meta = metadados(lote_dir)
    ambiente = meta.get("ambiente", {})
    prompt = meta.get("prompt", "")
    condicoes = ["sem-bsh", "com-bsh"]

    resumo = {}
    for c in condicoes:
        registros = [r[c] for r in execucoes.values() if c in r]
        resumo[c] = {
            "totais": stats.describe([r["totais"] for r in registros]),
            "entrada": stats.describe([r["entrada"] for r in registros]),
            "saida": stats.describe([r["saida"] for r in registros]),
            "nao_cache": stats.describe([_normalizado(r) for r in registros]),
            "duracao": stats.describe([r["duracao"] for r in registros]),
            "consultas": sum(r["consultas"] for r in registros),
            "conflitos": sum(r["conflitos"] for r in registros),
            "bloqueados": sum(1 for r in registros if r.get("bloqueado")),
            "n": len(registros), "erros": erros[c],
        }

    sem, com = pares(execucoes, "totais")
    diferencas = [s - c for s, c in zip(sem, com)]
    sem_media, com_media = stats.describe(sem)["media"], stats.describe(com)["media"]
    dif_media, dif_desvio = stats.describe(diferencas)["media"], stats.describe(diferencas)["desvio"]
    n_pares = len(diferencas)
    t_crit = stats.T_95.get(n_pares - 1, 1.96)
    dif_ic = t_crit * (dif_desvio / (n_pares ** 0.5)) if n_pares > 1 else 0.0
    percentual = (com_media - sem_media) / sem_media * 100 if sem_media else 0.0
    dz = dif_media / dif_desvio if dif_desvio else 0.0
    wilcoxon = scipy_stats.wilcoxon(sem, com) if n_pares >= 1 else None

    relatorio = {
        "lote": lote_dir.name, "prompt": prompt, "ambiente": ambiente, "execucoes": len(execucoes), "resumo": resumo,
        "pareado": {
            "n_pares": n_pares, "diferenca_media": round(dif_media, 2), "diferenca_desvio": round(dif_desvio, 2),
            "diferenca_ic95": round(dif_ic, 2), "diferenca_percentual": round(percentual, 2), "cohen_dz": round(dz, 3),
            "wilcoxon_estatistica": round(float(wilcoxon.statistic), 3) if wilcoxon else None,
            "wilcoxon_p": round(float(wilcoxon.pvalue), 5) if wilcoxon else None,
        },
    }
    (lote_dir / "stats.json").write_text(json.dumps(relatorio, indent=2, ensure_ascii=False), encoding="utf-8")

    with open(lote_dir / "measurements.csv", "w", encoding="utf-8", newline="") as handle:
        escritor = csv.writer(handle)
        escritor.writerow(["condicao", "execucoes", "erros", "media_tokens", "mediana_tokens", "desvio_tokens", "cv_percentual", "ic95_tokens", "media_nao_cache", "min_tokens", "max_tokens", "bloqueados"])
        for c in condicoes:
            t, nc = resumo[c]["totais"], resumo[c]["nao_cache"]
            escritor.writerow([c, t["n"], resumo[c]["erros"], round(t["media"], 1), round(t["mediana"], 1), round(t["desvio"], 1), round(t["cv"], 2), round(t["ic95"], 1), round(nc["media"], 1), t["min"], t["max"], resumo[c]["bloqueados"]])

    _boxplot(execucoes, charts); _media_ic(execucoes, charts); _pareado(execucoes, charts); _distribuicao(execucoes, charts)
    _governanca(execucoes, charts); _normalizado_chart(execucoes, charts); _principal(execucoes, charts)
    grupos = agrupar_por_prompt(execucoes)
    resumos_prompt = _por_prompt_chart(grupos, charts)

    figura = lambda nome, titulo, o_que, como: [
        f"### {titulo}", "", f"![{titulo}](charts/{nome})", "",
        f"**O que mostra:** {o_que}", "", f"**Como interpretar:** {como}", "",
    ]
    linhas = [
        f"# Benchmark: Codex com e sem BSH harness — lote `{lote_dir.name}`", "",
        "## Objetivo", "",
        "Medir o custo em tokens e o efeito de governanca do BSH harness frente ao Codex direto, executando o mesmo pedido em copias limpas do projeto.", "",
        "## Desenho experimental", "",
        f"- Execucoes por condicao: **{len(execucoes)}** (aquecimento descartado; ordem das condicoes randomizada por execucao).",
        f"- Modelo: `{meta.get('modelo', '?')}` (esforco `{meta.get('esforco', '?')}`), identico nas duas condicoes.",
        "- Condicoes: `sem-bsh` (Codex direto) e `com-bsh` (`bsh codex`, harness).",
        "- Isolamento: copia limpa e independente por execucao.",
        f"- Pedido principal: \"{prompt}\"", "",
        "## Ambiente e proveniencia", "",
        f"- Codex: `{ambiente.get('codex', '?')}`",
        f"- BSH: `{ambiente.get('bsh', '?')}`",
        f"- Python: `{ambiente.get('python', '?')}`",
        f"- Plataforma: `{ambiente.get('plataforma', '?')}`",
        f"- Commit do harness: `{commit_harness()}`",
        f"- Hash do prompt: `{meta.get('prompt_sha256', '?')}`", "",
        "## Resultados", "",
        "| Condicao | n | Erros | Media | Mediana | Desvio padrao | CV (%) | IC 95% | Media sem cache | Min | Max | Bloqueios |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c in condicoes:
        t, nc = resumo[c]["totais"], resumo[c]["nao_cache"]
        linhas.append(f"| {ROTULOS[c]} | {t['n']} | {resumo[c]['erros']} | {t['media']:,.0f} | {t['mediana']:,.0f} | {t['desvio']:,.0f} | {t['cv']:.1f} | +/- {t['ic95']:,.0f} | {nc['media']:,.0f} | {t['min']:,.0f} | {t['max']:,.0f} | {resumo[c]['bloqueados']}/{t['n']} |")
    linhas += [
        "", "## Comparacao pareada", "",
        f"- Diferenca media (sem - com): **{dif_media:,.0f} tokens** (IC 95% +/- {dif_ic:,.0f}).",
        f"- Reducao media: **{percentual:+.2f}%** com o harness.",
        f"- Tamanho de efeito pareado (Cohen's d_z): **{dz:.2f}**.",
    ]
    if wilcoxon:
        linhas.append(f"- Teste de Wilcoxon signed-rank: **W = {float(wilcoxon.statistic):.1f}, p = {float(wilcoxon.pvalue):.5f}** (n = {n_pares} pares).")
    linhas += [
        "- Interpretacao: com p < 0,05, a diferenca e improvavel sob a hipotese nula; com n pequeno, leia junto com o IC e o tamanho de efeito.", "",
        "## Governanca", "",
        f"- Sem BSH: {resumo['sem-bsh']['bloqueados']}/{resumo['sem-bsh']['n']} execucoes bloqueadas pela ontologia.",
        f"- Com BSH: {resumo['com-bsh']['bloqueados']}/{resumo['com-bsh']['n']} execucoes bloqueadas pela ontologia.", "",
        "## Por prompt", "",
        "| Prompt | n | Media sem BSH | Media com BSH | Reducao (%) | Bloqueios sem/com | p (Wilcoxon) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for prompt, r in resumos_prompt.items():
        curto = (prompt[:60] + "...") if len(prompt) > 63 else prompt
        ptexto = f"{r['p']:.5f}" if r["p"] is not None else "-"
        linhas.append(f"| {curto} | {r['n']} | {r['sem_media']:,.0f} | {r['com_media']:,.0f} | {r['reducao']:+.1f} | {r['sem_bloqueados']}/{r['com_bloqueados']} | {ptexto} |")
    linhas += ["", "## Figuras e como interpreta-las", ""]
    linhas += figura("00-figura-principal.png", "Figura principal (a-d)",
        "visao consolidada: (a) distribuicao dos tokens, (b) media com IC 95%, (c) custo pareado por execucao e (d) taxa de bloqueio pela ontologia.",
        "use (a) para ver dispersao e outliers; (b) para comparar medias com incerteza; (c) pontos abaixo da diagonal indicam harness mais barato na mesma execucao; (d) mostra o efeito de governanca.")
    linhas += figura("01-boxplot-tokens.png", "Boxplot dos tokens",
        "caixas com mediana, quartis e amplitude; pontos sao execucoes individuais.",
        "caixas mais baixas e estreitas indicam menor custo e maior consistencia; pontos fora da caixa sao execucoes atipicas.")
    linhas += figura("02-media-ic95.png", "Media com IC 95%",
        "media de tokens por condicao com barra de erro do IC 95%.",
        "se os intervalos nao se sobrepoem, ha indicio de diferenca; sobreposicao pede cautela.")
    linhas += figura("03-pareado.png", "Custo pareado por execucao",
        "cada ponto e uma execucao: x = tokens sem BSH, y = tokens com BSH; a diagonal tracejada e y = x (mesmo custo).",
        "pontos abaixo da diagonal significam que o harness gastou menos naquela mesma execucao; a distancia vertical e a economia.")
    linhas += figura("04-distribuicao.png", "Distribuicao dos tokens",
        "histograma de densidade por condicao; linhas tracejadas marcam as medias.",
        "distribuicoes separadas indicam efeito consistente; sobreposicao indica custo parecido.")
    linhas += figura("05-governanca.png", "Governanca da ontologia",
        "percentual de execucoes bloqueadas pelo harness em cada condicao.",
        "0% sem BSH e 100% com BSH indica que so o harness aplicou a regra da ontologia.")
    linhas += figura("06-tokens-nao-cacheados.png", "Custo sem cache",
        "tokens nao cacheados = (entrada - cache) + saida, removendo o efeito de cache de prompt.",
        "metrica mais justa quando o cache varia entre condicoes; deve contar a mesma historia do total para ser robusta.")
    linhas += figura("07-por-prompt.png", "Custo medio por prompt",
        "media de tokens por prompt e por condicao, lado a lado.",
        "mostra como o efeito do harness varia com a tarefa; prompts que violam a ontologia tendem a ter grande reducao com o harness.")
    linhas += [
        "## Ameacas a validade", "",
        "- Amostra pequena: IC largos; nao se afirma significancia sem olhar o IC e o tamanho de efeito.",
        "- Variabilidade do modelo entre execucoes.",
        "- O efeito do harness depende do pedido; pedidos que exigem correcao de rumo tendem a favorece-lo.",
        "- O Codex direto nao recebe contexto ontologico nem o MCP BSH, parte do efeito medido.", "",
        "## Reproducao", "", "```bash",
        "BENCH_RUNS=10 BENCH_WARMUP=1 BENCH_PROMPT=benchmark/prompts/bloqueado.txt \\",
        "  benchmark/.venv/bin/python benchmark/run_benchmark.py",
        "benchmark/.venv/bin/python benchmark/analyze.py", "```",
    ]
    (lote_dir / "stats.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    return relatorio


def main():
    lote_filtro = os.environ.get("BENCH_LOTE")
    lotes = [d for d in sorted(RESULTS.iterdir()) if d.is_dir() and d.name != "charts" and (not lote_filtro or d.name == lote_filtro)]
    if not lotes:
        raise SystemExit("Nenhum lote em results/. Rode run_benchmark.py primeiro.")
    for lote_dir in lotes:
        relatorio = analisar(lote_dir)
        if relatorio:
            print(json.dumps({"lote": lote_dir.name, **relatorio["pareado"]}, indent=2, ensure_ascii=False))
            print(f"Relatorio: {lote_dir / 'stats.md'}")


if __name__ == "__main__":
    main()
