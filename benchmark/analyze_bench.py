#!/usr/bin/env python3
"""Estatisticas, graficos e relatorio do benchmark controlado."""
import json, math, statistics
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

T95 = {1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,9:2.262,10:2.228}
COND = ["A","B","C","D"]
CORES = {"A":"#999999","B":"#D55E00","C":"#E69F00","D":"#0072B2"}
CLASSES = ["ALTERACAO_CORRETA","ALTERACAO_INCORRETA","BLOQUEIO_CORRETO","FALSO_BLOQUEIO","VIOLACAO_NAO_DETECTADA","REVISAO_HUMANA","INDETERMINADO","FALHA_TECNICA"]

def summary(vals):
    vals=[v for v in vals if v is not None]
    if not vals: return {"n":0,"media":0,"mediana":0,"desvio":0,"min":0,"max":0,"ic95":0}
    m=statistics.mean(vals); d=statistics.stdev(vals) if len(vals)>1 else 0.0
    return {"n":len(vals),"media":m,"mediana":statistics.median(vals),"desvio":d,"min":min(vals),"max":max(vals),
            "ic95": T95.get(len(vals)-1,1.96)*(d/math.sqrt(len(vals))) if len(vals)>1 else 0.0}

def por_cond(regs, cond): return [r for r in regs if r["condicao"]==cond]

def gerar(base: Path):
    regs = json.loads((base/"measurements.json").read_text())
    charts = base/"charts"; charts.mkdir(exist_ok=True)
    stats = {}
    for c in COND:
        sub = por_cond(regs,c)
        stats[c] = {"totais":summary([r["totais"] for r in sub]),"tempo":summary([r["tempo"] for r in sub]),
                    "naoCache":summary([r["tokensNaoCache"] for r in sub]),"arquivos":summary([r["arquivos"] for r in sub]),
                    "linhas":summary([r["adicionadas"]+r["removidas"] for r in sub]),"classes":{k:sum(1 for r in sub if r["classificacao"]==k) for k in CLASSES}}
    def bar(nome, titulo, valores, labels=None, cores=None):
        labels = labels or COND
        cores = cores or [CORES[c] for c in COND]
        fig,ax=plt.subplots(figsize=(6,4)); ax.bar(labels, valores, color=cores); ax.set_title(titulo)
        for i,v in enumerate(valores): ax.text(i,v,f"{v:.0f}",ha="center",va="bottom")
        fig.tight_layout(); fig.savefig(charts/nome,dpi=140); plt.close(fig)
    bar("01-tokens-por-condicao.png","Tokens totais por condicao",[stats[c]["totais"]["media"] for c in COND])
    bar("02-tempo-por-condicao.png","Tempo medio (s) por condicao",[stats[c]["tempo"]["media"] for c in COND])
    val = [r for r in regs if r["tipo"] != "violadora"]; vio = [r for r in regs if r["tipo"] == "violadora"]
    bar("03-tokens-validas.png","Tokens medios em tarefas nao violadoras",[summary([r["totais"] for r in val if r["condicao"]==c])["media"] for c in COND])
    bar("04-tokens-violadoras.png","Tokens medios em tarefas violadoras",[summary([r["totais"] for r in vio if r["condicao"]==c])["media"] for c in COND])
    vioD = por_cond(regs,"D"); vioD = [r for r in vioD if r["tipo"]=="violadora"]
    det = sum(1 for r in vioD if r["classificacao"]=="BLOQUEIO_CORRETO"); nd = sum(1 for r in vioD if r["classificacao"]=="VIOLACAO_NAO_DETECTADA")
    bar("05-deteccao-violacoes.png","Deteccao vs nao deteccao (condicao D, violadoras)",[det,nd], labels=["detectadas","nao detectadas"], cores=["#0072B2","#D55E00"])
    fb = [sum(1 for r in por_cond(regs,c) if r["classificacao"]=="FALSO_BLOQUEIO") for c in COND]
    bar("06-falsos-bloqueios.png","Falsos bloqueios por condicao",fb)
    sr = json.loads((base/"semantic-recognition.json").read_text())
    bar("07-semantico.png","Reconhecimento semantico (D): recall/precision",[sr.get("recall",0)*100, sr.get("precision",0)*100], labels=["recall","precision"], cores=["#0072B2","#009E73"])
    # comparacoes pareadas A×B, B×C, C×D, A×D (por tarefa, tokens totais)
    def por_tarefa(cond): return {r["tarefa"]:r["totais"] for r in por_cond(regs,cond)}
    comp = {}
    for a,b in (("A","B"),("B","C"),("C","D"),("A","D")):
        ta,tb = por_tarefa(a), por_tarefa(b); difs=[ta[k]-tb[k] for k in ta if k in tb]
        comp[f"{a}x{b}"] = {"media":statistics.mean(difs) if difs else 0, "n":len(difs)}
    bar("08-pareado.png","Diferenca pareada de tokens (A-B, B-C, C-D, A-D)",[comp[k]["media"] for k in ("AxB","BxC","CxD","AxD")])
    (base/"stats.json").write_text(json.dumps({"condicoes":stats,"comparacoes":comp,"semantico":sr}, indent=2), encoding="utf-8")
    # stats.md e report.md
    linhas=["# Benchmark controlado — estatisticas",""]
    linhas.append("| Condicao | n | tokens media | mediana | desvio | IC95 | min | max | tempo medio (s) |")
    linhas.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for c in COND:
        t=stats[c]["totais"]
        linhas.append(f"| {c} | {t['n']} | {t['media']:.0f} | {t['mediana']:.0f} | {t['desvio']:.0f} | ±{t['ic95']:.0f} | {t['min']:.0f} | {t['max']:.0f} | {stats[c]['tempo']['media']:.0f} |")
    linhas.append(""); linhas.append("Classificacoes por condicao:")
    linhas.append("| Condicao | "+" | ".join(CLASSES)+" |"); linhas.append("| --- |"+" --- |"*len(CLASSES))
    for c in COND: linhas.append("| "+c+" | "+" | ".join(str(stats[c]["classes"][k]) for k in CLASSES)+" |")
    linhas.append(""); linhas.append("Comparacoes pareadas (tokens): "+", ".join(f"{k}: {v['media']:.0f}" for k,v in comp.items()))
    meta = {}
    if (base / "metadata.json").is_file():
        try: meta = json.loads((base / "metadata.json").read_text(encoding="utf-8"))
        except Exception: pass
    agente = meta.get("agente") or ("agy" if base.name.startswith("agy-") else "codex")

    rel=["# Relatorio do benchmark controlado","",f"Lote: {base.name}",f"Agente: {agente.upper()}","",
         "## 1. Eficacia do reconhecimento semantico",f"recall={sr.get('recall',0):.2f}, precision={sr.get('precision',0):.2f} (condicao D).","",
         "## 2. Eficacia do enforcement (D, violadoras)",f"bloqueios corretos={det}, nao detectadas={nd}.","",
         "## 3. Independencia do relato do agente","Na condicao D o enforcement roda no gate; ver executions/*/enforcement.json (report_conflict nao e pre-condicao).","",
         "## 4. Tarefas nao violadoras","falsos bloqueios: "+", ".join(f"{c}={stats[c]['classes']['FALSO_BLOQUEIO']}" for c in COND),"",
         "## 5. Tarefas incompatíveis","nao detectadas: "+", ".join(f"{c}={stats[c]['classes']['VIOLACAO_NAO_DETECTADA']}" for c in COND),"",
         "## 6. Falsos positivos",f"total falsos bloqueios={sum(stats[c]['classes']['FALSO_BLOQUEIO'] for c in COND)}","",
         "## 7. Falsos negativos",f"total violacoes nao detectadas={sum(stats[c]['classes']['VIOLACAO_NAO_DETECTADA'] for c in COND)}","",
         "## 8. Estados indeterminados",f"total={sum(stats[c]['classes']['INDETERMINADO'] for c in COND)}","",
         "## 9. Revisoes humanas",f"total={sum(stats[c]['classes']['REVISAO_HUMANA'] for c in COND)}","",
         "## 10. Custo computacional","Ver stats.md (tokens/tempo por condicao).","",
         "## 11. Overhead","tokens medios em validas: "+", ".join(f"{c}={summary([r['totais'] for r in val if r['condicao']==c])['media']:.0f}" for c in COND),"",
         "## 12. Isolamento por worktree","Cada execucao parte de copia Git limpa; rejeitadas nao chegam a origem (ver executions/).","",
         "## 13. Qualidade tecnica","Gates por execucao registrados nas runs; ver measurements.","",
         "## 14. Ameacas a validade interna","Modelo nao deterministico; n=10 por condicao; agente pode reportar conflito voluntariamente (afeta A/B/C).","",
         "## 15. Ameacas a validade externa","Um projeto pequeno e um modelo; nao generaliza.","",
         "## 16. Limitacoes estatisticas","Amostras pequenas; resultados descritivos; sem inferencia forte.","",
         "## Falhas tecnicas",f"total={sum(stats[c]['classes']['FALHA_TECNICA'] for c in COND)}","",
         "Nao tratar tokens como qualidade; SHACL nao prova o codigo."]
    (base/"report.md").write_text("\n".join(rel)+"\n", encoding="utf-8")
    print(f"stats/report/charts em {base}")

if __name__ == "__main__":
    import sys
    gerar(Path(sys.argv[1]))
