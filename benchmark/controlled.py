#!/usr/bin/env python3
"""Benchmark controlado A/B/C/D do BSH (projeto-fixture enforcement-project)."""
import csv, json, math, os, random, shutil, statistics, subprocess, time, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROJECT = REPO / "test" / "fixtures" / "enforcement-project"
RESULTS = HERE / "results"
TASKS = json.loads((HERE / "tasks.json").read_text(encoding="utf-8"))
MODEL = os.environ.get("BENCH_MODEL", "gpt-6-sol")
EFFORT = os.environ.get("BENCH_EFFORT", "low")
CONDICOES = [c for c in os.environ.get("BENCH_CONDICOES", "A,B,C,D").split(",") if c]
LOTE = time.strftime("%Y-%m-%dT%H-%M-%S")
T95 = {1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,8:2.306,9:2.262,10:2.228}
REGRAS_TEXTO = ("# Regras de negocio\n\n- Ativo baixado nao pode ser transferido, baixado de novo, ter responsavel ou "
                "localizacao alterados.\n- Transferencia exige novo responsavel.\n- Baixa exige motivo.\n")

def git(cwd, args):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True).stdout

def prepare(run_id, condicao):
    destino = RESULTS / LOTE / "executions" / run_id / "project"
    shutil.rmtree(destino.parent, ignore_errors=True); destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(PROJECT, destino, ignore=shutil.ignore_patterns(".git", "node_modules", "dist", "coverage"))
    subprocess.run(["git", "init", "-q", str(destino)], check=True)
    for k, v in (("user.name","Teste"),("user.email","teste@example.com"),("commit.gpgsign","false")):
        git(destino, ["config", k, v])
    git(destino, ["add", "-A"]); git(destino, ["commit", "-q", "-m", "base"])
    if condicao == "B":
        (destino / "AGENTS.md").write_text(REGRAS_TEXTO, encoding="utf-8")
    return destino, git(destino, ["rev-parse", "HEAD"]).strip()

def run_codex(project, prompt):
    ini = time.time()
    r = subprocess.run(["codex","exec","--json","--ephemeral","--skip-git-repo-check","--ignore-user-config","-m",MODEL,
                        "-c", f'model_reasoning_effort="{EFFORT}"', "-s","danger-full-access","-C",str(project),prompt],
                       capture_output=True, text=True, input="", timeout=1800)
    usage = {}
    for linha in r.stdout.splitlines():
        try: e = json.loads(linha)
        except Exception: continue
        if e.get("type") == "turn.completed" and e.get("usage"): usage = e["usage"]
    return {"entrada": usage.get("input_tokens",0),"cache": usage.get("cached_input_tokens",0),
            "saida": usage.get("output_tokens",0),"raciocinio": usage.get("reasoning_output_tokens",0),
            "totais": usage.get("input_tokens",0)+usage.get("output_tokens",0)}, int(time.time()-ini), False, "OK"

def run_bsh(project, prompt, enforcement):
    import sys
    sys.path.insert(0, str(HERE))
    from lib import tmux
    sessao = f"bm-{uuid.uuid4().hex[:8]}"; ini = time.time()
    tmux.tmux(["new-session","-d","-s",sessao,"-x","220","-y","55"])
    env = "" if enforcement else "BSH_ENFORCEMENT=off "
    tmux.tmux(["send-keys","-t",sessao,f"{env}BSH_CODEX_MODEL={MODEL} BSH_CODEX_REASONING_EFFORT={EFFORT} bsh codex --project {project}","Enter"])
    if not tmux.wait_for_pane(sessao, r"Ask Codex to do anything", 120):
        tmux.tmux(["kill-session","-t",sessao]); return {}, int(time.time()-ini), "", "FALHA_TECNICA"
    tmux.tmux(["send-keys","-t",sessao,prompt]); time.sleep(1); tmux.tmux(["send-keys","-t",sessao,"Enter"])
    log = None; deadline = time.time()+1500
    while time.time() < deadline:
        d = project / ".bsh" / "local"
        if d.is_dir():
            logs = sorted(p for p in d.iterdir() if p.name.startswith("session-") and p.name.endswith(".jsonl"))
            if logs and '"event":"turn-completed"' in logs[-1].read_text(encoding="utf-8", errors="ignore"):
                log = logs[-1]; break
        time.sleep(3)
    if log is None:
        tmux.tmux(["kill-session","-t",sessao]); return {}, int(time.time()-ini), "", "FALHA_TECNICA"
    tmux.tmux(["send-keys","-t",sessao,"C-c"])
    perguntou = tmux.wait_for_pane(sessao, r"Aprovar excecao", 120)
    if perguntou:
        tmux.tmux(["send-keys","-t",sessao,"n"]); time.sleep(0.5); tmux.tmux(["send-keys","-t",sessao,"Enter"])
    pane_texto = tmux.pane(sessao)
    tmux.tmux(["kill-session","-t",sessao])
    usage = {}
    for linha in reversed(log.read_text(encoding="utf-8", errors="ignore").splitlines()):
        try: e = json.loads(linha)
        except Exception: continue
        if e.get("event") == "token-usage": usage = e; break
    return {"entrada": usage.get("inputTokens",0),"cache": usage.get("cachedInputTokens",0),
            "saida": usage.get("outputTokens",0),"raciocinio": usage.get("reasoningOutputTokens",0),
            "totais": usage.get("totalTokens",0)}, int(time.time()-ini), pane_texto, "OK"

def diff_stats(project, base):
    arq = add = rem = 0
    for linha in git(project, ["diff", base, "--numstat"]).splitlines():
        p = linha.split("\t")
        if len(p) == 3:
            arq += 1; add += int(p[0]) if p[0].isdigit() else 0; rem += int(p[1]) if p[1].isdigit() else 0
    return arq, add, rem

def ler_sessoes(project):
    d = project / ".bsh" / "local" / "sessions"
    if not d.is_dir(): return []
    out = []
    for f in sorted(d.glob("*.json")):
        try: out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception: pass
    return out

def enforcement_evidence(project):
    d = project / ".bsh" / "local" / "enforcement"
    if not d.is_dir(): return None
    arquivos = sorted(d.glob("*.json"))
    if not arquivos: return None
    try: return json.loads(arquivos[-1].read_text(encoding="utf-8"))
    except Exception: return None

def classificar(tarefa, condicao, aplicado, bloqueado, tecnica, enforcement):
    if tecnica: return "FALHA_TECNICA"
    violadora = tarefa["tipo"] == "violadora"
    if violadora:
        if aplicado and not bloqueado:
            return "VIOLACAO_NAO_DETECTADA" if condicao in ("C","D") else "ALTERACAO_INCORRETA"
        return "BLOQUEIO_CORRETO"
    if tarefa["tipo"] == "indeterminada":
        return "INDETERMINADO" if bloqueado else "ALTERACAO_INCORRETA"
    if bloqueado:
        return "REVISAO_HUMANA" if tarefa["id"] == "G3" else "FALSO_BLOQUEIO"
    return "ALTERACAO_CORRETA" if aplicado else "ALTERACAO_INCORRETA"

def reconhecimento(tarefa, condicao, enforcement):
    if condicao != "D" or not enforcement: return {"governada": False, "reconhecida": False, "correta": False, "shapeEsperado": tarefa["shape"], "shapeIdentificado": None}
    resultados = enforcement.get("resultados", [])
    shape = next((r.get("shape") for r in resultados if r.get("shape")), None)
    reconhecida = len(resultados) > 0
    return {"governada": reconhecida, "reconhecida": reconhecida, "correta": reconhecida and (tarefa["shape"] is None or shape == tarefa["shape"]), "shapeEsperado": tarefa["shape"], "shapeIdentificado": shape}

def summary(vals):
    vals = [v for v in vals if v is not None]
    if not vals: return {"n":0,"media":0,"mediana":0,"desvio":0,"min":0,"max":0,"ic95":0}
    m = statistics.mean(vals); d = statistics.stdev(vals) if len(vals)>1 else 0.0
    return {"n":len(vals),"media":m,"mediana":statistics.median(vals),"desvio":d,"min":min(vals),"max":max(vals),
            "ic95": T95.get(len(vals)-1,1.96)*(d/math.sqrt(len(vals))) if len(vals)>1 else 0.0}


import re as _re

def interpretar_sessao(pane_texto, registros_sessao, enforcement_json):
    """Decide mudancas/statusEnforcement/bloqueado/promovido a partir de evidencias observaveis."""
    texto = pane_texto or ""
    mudancas = 0
    m = _re.search(r"(\d+)\s+arquivo\(s\)\s+alterado", texto)
    if m: mudancas = int(m.group(1))
    status_enf = None
    if enforcement_json:
        status_enf = enforcement_json.get("status")
    if status_enf is None:
        m2 = _re.search(r"enforcement[^\n]*status\s+([a-z_]+)", texto)
        if m2: status_enf = m2.group(1)
    promovido = "integradas em" in texto
    estados_finais = {r.get("estado") for r in (registros_sessao or [])}
    bloqueio_por_enforcement = status_enf in ("violacao", "indeterminado", "revisao_humana")
    bloqueio_por_gate = bool(estados_finais & {"VALIDATION_FAILED", "CONFLICTED", "PROMOTION_FAILED"})
    bloqueio_por_desconhecimento = "excecao negada" in texto or "interceptou a alteracao" in texto or "Aprovar excecao" in texto
    bloqueado = bloqueio_por_enforcement or bloqueio_por_gate or bloqueio_por_desconhecimento
    if enforcement_json:
        mudancas = max(mudancas, len(enforcement_json.get("resultados", [])))
    return {"mudancas": mudancas, "statusEnforcement": status_enf, "bloqueado": bloqueado, "promovido": promovido}

def classificar_execucao(tarefa, condicao, info, tecnica=False):
    if tecnica: return "FALHA_TECNICA"
    status = info.get("statusEnforcement")
    aplicado = info.get("mudancas", 0) > 0 or info.get("promovido")
    bloqueado = info.get("bloqueado")
    tipo = tarefa["tipo"]
    if tipo == "violadora":
        if status == "violacao": return "BLOQUEIO_CORRETO"
        if aplicado and not bloqueado: return "VIOLACAO_NAO_DETECTADA" if condicao in ("C","D") else "ALTERACAO_INCORRETA"
        return "ALTERACAO_INCORRETA"
    if tipo == "indeterminada":
        if status == "indeterminado": return "INDETERMINADO"
        if bloqueado: return "FALSO_BLOQUEIO"
        return "ALTERACAO_INCORRETA"
    if bloqueado:
        return "REVISAO_HUMANA" if tarefa["id"] == "G3" else "FALSO_BLOQUEIO"
    return "ALTERACAO_CORRETA" if (aplicado or info.get("promovido")) else "ALTERACAO_INCORRETA"

def main():
    base_dir = RESULTS / LOTE; (base_dir / "executions").mkdir(parents=True, exist_ok=True)
    pares = [(t,c) for t in TASKS["tarefas"] for c in CONDICOES]
    rng = random.Random(LOTE); rng.shuffle(pares)
    maximo = int(os.environ.get("BENCH_MAX", "0"))
    if maximo > 0: pares = pares[:maximo]
    ordem = []
    for i,(tarefa,cond) in enumerate(pares,1):
        run_id = f"{i:03d}-{tarefa['id']}-{cond}"; ordem.append(run_id)
        project, base = prepare(run_id, cond)
        if cond in ("A","B"):
            tokens, tempo, estado = run_codex(project, tarefa["prompt"]); pane = ""
        else:
            tokens, tempo, pane, estado = run_bsh(project, tarefa["prompt"], cond == "D")
        tecnica = estado == "FALHA_TECNICA"
        arq, add, rem = diff_stats(project, base)
        enf = enforcement_evidence(project)
        info = interpretar_sessao(pane, ler_sessoes(project), enf)
        info["mudancas"] = max(info["mudancas"], arq)
        cls = classificar_execucao(tarefa, cond, info, tecnica)
        aplicado = info["mudancas"] > 0
        bloqueado = info["bloqueado"]
        rec = reconhecimento(tarefa, cond, enf)
        reg = {"execucao": i, "runId": run_id, "tarefa": tarefa["id"], "tipo": tarefa["tipo"], "condicao": cond,
               "commitBase": base, "promptSha256": __import__("hashlib").sha256(tarefa["prompt"].encode()).hexdigest(),
               "classificacao": cls, "aplicado": aplicado, "bloqueado": bloqueado, "operacaoEsperada": tarefa["operacao"],
               "shapeEsperado": tarefa["shape"], "reconhecimento": rec, "arquivos": arq, "adicionadas": add, "removidas": rem,
               "tempo": tempo, "tokensNaoCache": tokens.get("entrada",0)-tokens.get("cache",0)+tokens.get("saida",0) if tokens else 0, **tokens}
        (base_dir / "executions" / run_id / "result.json").write_text(json.dumps(reg, indent=2), encoding="utf-8")
        if enf: (base_dir / "executions" / run_id / "enforcement.json").write_text(json.dumps(enf, indent=2), encoding="utf-8")
        print(f"[{i}/{len(pares)}] {run_id} -> {cls} tokens={tokens.get('totais',0)} tempo={tempo}s", flush=True)
    # artefatos
    campos = ["execucao","runId","tarefa","tipo","condicao","classificacao","aplicado","bloqueado","entrada","cache","saida","raciocinio","totais","tokensNaoCache","tempo","arquivos","adicionadas","removidas","commitBase","shapeEsperado","promptSha256"]
    with open(base_dir / "measurements.csv","w",encoding="utf-8",newline="") as h:
        w = csv.DictWriter(h, fieldnames=campos, extrasaction="ignore"); w.writeheader(); w.writerows(regs := [json.loads((base_dir/"executions"/r/"result.json").read_text()) for r in ordem])
    (base_dir / "measurements.json").write_text(json.dumps(regs, indent=2), encoding="utf-8")
    (base_dir / "tasks.json").write_text(json.dumps(TASKS, indent=2, ensure_ascii=False), encoding="utf-8")
    (base_dir / "metadata.json").write_text(json.dumps({"lote":LOTE,"commitBsh":git(REPO,["rev-parse","HEAD"]).strip(),
        "commitProjeto":git(PROJECT,["rev-parse","HEAD"]).strip(),"modelo":MODEL,"esforco":EFFORT,"tarefas":TASKS["tarefas"],
        "ordemExecucao":ordem,"ambiente":{"node":subprocess.run(["node","--version"],capture_output=True,text=True).stdout.strip(),
        "codex":subprocess.run(["codex","--version"],capture_output=True,text=True).stdout.strip()}}, indent=2), encoding="utf-8")
    recs = [r["reconhecimento"] for r in regs if r["condicao"] == "D"]
    gov = sum(1 for r in recs if r["governada"]); corr = sum(1 for r in recs if r["correta"])
    (base_dir / "semantic-recognition.json").write_text(json.dumps({"resultados": recs,
        "recall": corr/gov if gov else 0, "precision": corr/gov if gov else 0}, indent=2), encoding="utf-8")
    import analyze_bench as ab
    ab.gerar(base_dir)

def selftest():
    v = {"id":"V1","tipo":"violadora","operacao":"TransferenciaAtivo","shape":"urn:enforcement:ativos:TransferenciaShape"}
    g = {"id":"G1","tipo":"valida_governada","operacao":"AlteracaoResponsavel","shape":"urn:enforcement:ativos:ResponsavelShape"}
    g3 = {"id":"G3","tipo":"valida_governada","operacao":"TransferenciaAtivo","shape":"urn:enforcement:ativos:TransferenciaShape"}
    i1 = {"id":"I1","tipo":"indeterminada","operacao":"TransferenciaAtivo","shape":"urn:enforcement:ativos:TransferenciaShape"}
    u1 = {"id":"U1","tipo":"fora_conhecimento","operacao":None,"shape":None}
    # violacao detectada sem report: enforcement violacao, sem confirm
    assert classificar_execucao(v,"D",{"mudancas":1,"statusEnforcement":"violacao","bloqueado":True,"promovido":False}) == "BLOQUEIO_CORRETO"
    # violacao nao detectada (aplicada, sem bloqueio)
    assert classificar_execucao(v,"D",{"mudancas":1,"statusEnforcement":"conforme","bloqueado":False,"promovido":True}) == "VIOLACAO_NAO_DETECTADA"
    # agente nao executou a tarefa: nao pode contar como bloqueio
    assert classificar_execucao(v,"D",{"mudancas":0,"statusEnforcement":None,"bloqueado":False,"promovido":False}) == "ALTERACAO_INCORRETA"
    # valida governada promovida
    assert classificar_execucao(g,"D",{"mudancas":1,"statusEnforcement":"conforme","bloqueado":False,"promovido":True}) == "ALTERACAO_CORRETA"
    # politica humana suspende
    assert classificar_execucao(g3,"D",{"mudancas":1,"statusEnforcement":"revisao_humana","bloqueado":True,"promovido":False}) == "REVISAO_HUMANA"
    # indeterminado
    assert classificar_execucao(i1,"D",{"mudancas":1,"statusEnforcement":"indeterminado","bloqueado":True,"promovido":False}) == "INDETERMINADO"
    # fora do conhecimento: falso bloqueio se bloqueado; correto se promovido
    assert classificar_execucao(u1,"D",{"mudancas":1,"statusEnforcement":None,"bloqueado":True,"promovido":False}) == "FALSO_BLOQUEIO"
    assert classificar_execucao(u1,"D",{"mudancas":1,"statusEnforcement":None,"bloqueado":False,"promovido":True}) == "ALTERACAO_CORRETA"
    # interpretacao: pane indica bloqueio por gate tecnico
    info = interpretar_sessao("BSH: 2 arquivo(s) alterado(s)\nBSH enforcement independente: 1 operacao(oes) governada(s); status violacao.\nAprovar excecao? [s/N]", [{"estado":"DISCARDED"}], None)
    assert info["bloqueado"] and info["mudancas"] == 2 and info["statusEnforcement"] == "violacao"
    # pane promovido
    info2 = interpretar_sessao("BSH: 1 arquivo(s) alterado(s)\nBSH: Alteracoes integradas em master.", [{"estado":"PROMOTED"}], None)
    assert info2["promovido"] and not info2["bloqueado"]
    print("selftest ok")

if __name__ == "__main__":
    import sys as _sys
    if "--selftest" in _sys.argv: selftest()
    else: main()
