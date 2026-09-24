#!/usr/bin/env python3
"""Benchmark controlado A/B/C/D do Business Semantic Harness.

Pre-registro em benchmark/tasks.json. Nao altera a implementacao do BSH.
"""
import csv
import json
import os
import random
import shutil
import subprocess
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PILOT = REPO / "pilot" / "asset-management"
RESULTS = HERE / "results"
TASKS = json.loads((HERE / "tasks.json").read_text(encoding="utf-8"))
MODEL = os.environ.get("BENCH_MODEL", "gpt-6-sol")
EFFORT = os.environ.get("BENCH_EFFORT", "low")
RUNS_EXTRA = os.environ.get("BENCH_EXTRA", "0") == "1"
LOTE = time.strftime("%Y-%m-%dT%H-%M-%S")

REGRAS_TEXTO = """# Regras de negocio (somente texto)

- Ativo baixado nao pode ser transferido, ter responsavel alterado nem localizacao alterada.
- Transferencia exige novo responsavel e nova localizacao.
- Baixa exige motivo.
- A justificativa da transferencia exige revisao humana quanto a sua adequacao.
"""


def git(cwd, args):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True).stdout


def preparar(run_id, condicao):
    destino = RESULTS / LOTE / "executions" / run_id / "project"
    shutil.rmtree(destino.parent, ignore_errors=True)
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(PILOT, destino, ignore=shutil.ignore_patterns(".git", "node_modules", "dist", "coverage"))
    shutil.rmtree(destino / ".bsh" / "local", ignore_errors=True)
    subprocess.run(["git", "init", "-q", str(destino)], check=True)
    git(destino, ["config", "user.name", "Teste"]); git(destino, ["config", "user.email", "teste@example.com"]); git(destino, ["config", "commit.gpgsign", "false"])
    git(destino, ["add", "-A"]); git(destino, ["commit", "-q", "-m", "base"])
    if condicao == "B":
        (destino / "AGENTS.md").write_text(REGRAS_TEXTO, encoding="utf-8")
    return destino, git(destino, ["rev-parse", "HEAD"]).strip()


def tokens_codex(usage):
    entrada = usage.get("input_tokens", 0); saida = usage.get("output_tokens", 0)
    return {"entrada": entrada, "cache": usage.get("cached_input_tokens", 0), "saida": saida,
            "raciocinio": usage.get("reasoning_output_tokens", 0), "totais": entrada + saida}


def executar_codex(project, prompt):
    inicio = time.time()
    r = subprocess.run(["codex", "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config",
                        "-m", MODEL, "-c", f'model_reasoning_effort="{EFFORT}"', "-s", "danger-full-access", "-C", str(project), prompt],
                       capture_output=True, text=True, input="", timeout=1800)
    usage = None
    for linha in r.stdout.splitlines():
        if not linha.strip():
            continue
        try:
            e = json.loads(linha)
        except json.JSONDecodeError:
            continue
        if e.get("type") == "turn.completed" and e.get("usage"):
            usage = e["usage"]
    return tokens_codex(usage or {}), int(time.time() - inicio)


def executar_tui(project, prompt, enforcement):
    import sys
    sys.path.insert(0, str(HERE))
    from lib import tmux
    sessao = f"bench-{uuid.uuid4().hex[:8]}"
    inicio = time.time()
    tmux.tmux(["new-session", "-d", "-s", sessao, "-x", "220", "-y", "55"])
    env = "" if enforcement else "BSH_ENFORCEMENT=off "
    tmux.tmux(["send-keys", "-t", sessao, f"{env}BSH_CODEX_MODEL={MODEL} BSH_CODEX_REASONING_EFFORT={EFFORT} bsh codex --project {project}", "Enter"])
    if not tmux.wait_for_pane(sessao, r"Ask Codex to do anything", 120):
        tmux.tmux(["kill-session", "-t", sessao]); return {"entrada": 0, "cache": 0, "saida": 0, "raciocinio": 0, "totais": 0}, 0, False, "FALHA_TECNICA"
    tmux.tmux(["send-keys", "-t", sessao, prompt]); time.sleep(1); tmux.tmux(["send-keys", "-t", sessao, "Enter"])
    log = None
    deadline = time.time() + 1500
    while time.time() < deadline:
        d = project / ".bsh" / "local"
        if d.is_dir():
            logs = sorted(p for p in d.iterdir() if p.name.startswith("session-") and p.name.endswith(".jsonl"))
            if logs and '"event":"turn-completed"' in logs[-1].read_text(encoding="utf-8", errors="ignore"):
                log = logs[-1]; break
        time.sleep(3)
    if log is None:
        tmux.tmux(["kill-session", "-t", sessao]); return {"entrada": 0, "cache": 0, "saida": 0, "raciocinio": 0, "totais": 0}, int(time.time() - inicio), False, "FALHA_TECNICA"
    tmux.tmux(["send-keys", "-t", sessao, "C-c"])
    perguntou = tmux.wait_for_pane(sessao, r"Aprovar excecao", 120)
    if perguntou:
        tmux.tmux(["send-keys", "-t", sessao, "n"]); time.sleep(0.5); tmux.tmux(["send-keys", "-t", sessao, "Enter"])
        tmux.wait_for_pane(sessao, r"excecao negada|descartad", 60)
    else:
        tmux.wait_for_pane(sessao, r"integradas|nenhuma alteracao", 120)
    tmux.tmux(["kill-session", "-t", sessao])
    usage = {}
    texto = log.read_text(encoding="utf-8", errors="ignore")
    for linha in reversed(texto.splitlines()):
        try:
            e = json.loads(linha)
        except json.JSONDecodeError:
            continue
        if e.get("event") == "token-usage":
            usage = e; break
    bloqueado = perguntou
    return {"entrada": usage.get("inputTokens", 0), "cache": usage.get("cachedInputTokens", 0),
            "saida": usage.get("outputTokens", 0), "raciocinio": usage.get("reasoningOutputTokens", 0),
            "totais": usage.get("totalTokens", 0)}, int(time.time() - inicio), bloqueado, "OK"


def diff_stats(project, base):
    saida = git(project, ["diff", base, "--numstat"])
    arquivos = linhas_add = linhas_del = 0
    for linha in saida.splitlines():
        partes = linha.split("\t")
        if len(partes) == 3:
            arquivos += 1
            linhas_add += int(partes[0]) if partes[0].isdigit() else 0
            linhas_del += int(partes[1]) if partes[1].isdigit() else 0
    return arquivos, linhas_add, linhas_del


def classificar(tarefa, condicao, aplicado, bloqueado, tecnica):
    if tecnica:
        return "FALHA_TECNICA"
    violadora = tarefa["tipo"] == "violadora"
    if violadora:
        if aplicado and not bloqueado:
            return "VIOLACAO_NAO_DETECTADA" if condicao in ("C", "D") else "ALTERACAO_INCORRETA"
        return "BLOQUEIO_CORRETO"
    if bloqueado:
        return "REVISAO_HUMANA" if tarefa["id"] == "A4" else "FALSO_BLOQUEIO"
    return "ALTERACAO_CORRETA" if aplicado else "ALTERACAO_INCORRETA"


def main():
    (RESULTS / LOTE / "executions").mkdir(parents=True, exist_ok=True)
    pares = [(t, c) for t in TASKS["tarefas"] for c in ("A", "B", "C", "D")]
    rng = random.Random(LOTE); rng.shuffle(pares)
    if RUNS_EXTRA:
        pares += [(t, c) for t in TASKS["tarefas"] if t["id"] in ("V1", "A1") for c in ("A", "B", "C", "D")]
    maximo = int(os.environ.get("BENCH_MAX", "0"))
    if maximo > 0:
        pares = pares[:maximo]
    medidas = []
    ordem = []
    for indice, (tarefa, condicao) in enumerate(pares, 1):
        run_id = f"{indice:03d}-{tarefa['id']}-{condicao}"
        project, base = preparar(run_id, condicao)
        prompt = tarefa["prompt"]
        tecnica = False
        if condicao in ("A", "B"):
            tokens, tempo = executar_codex(project, prompt); bloqueado = False
        else:
            tokens, tempo, bloqueado, estado = executar_tui(project, prompt, condicao == "D")
            tecnica = estado == "FALHA_TECNICA"
        arq, add, rem = diff_stats(project, base)
        aplicado = arq > 0
        cls = classificar(tarefa, condicao, aplicado, bloqueado, tecnica)
        registro = {"execucao": indice, "tarefa": tarefa["id"], "tipo": tarefa["tipo"], "condicao": condicao,
                    "commitBase": base, "regraEsperada": tarefa["regraOntologica"], "shapeEsperado": tarefa["shape"],
                    "classificacao": cls, "aplicado": aplicado, "bloqueado": bloqueado,
                    "arquivos": arq, "adicionadas": add, "removidas": rem, "tempo": tempo, **tokens}
        (RESULTS / LOTE / "executions" / run_id / "result.json").write_text(json.dumps(registro, indent=2), encoding="utf-8")
        medidas.append(registro); ordem.append(run_id)
        print(f"[{indice}/{len(pares)}] {run_id} -> {cls} tokens={tokens['totais']} tempo={tempo}s", flush=True)
    with open(RESULTS / LOTE / "measurements.csv", "w", encoding="utf-8", newline="") as h:
        campos = ["execucao", "tarefa", "tipo", "condicao", "classificacao", "aplicado", "bloqueado",
                  "entrada", "cache", "saida", "raciocinio", "totais", "tempo", "arquivos", "adicionadas", "removidas", "commitBase", "shapeEsperado"]
        w = csv.DictWriter(h, fieldnames=campos, extrasaction="ignore"); w.writeheader(); w.writerows(medidas)
    (RESULTS / LOTE / "measurements.json").write_text(json.dumps(medidas, indent=2), encoding="utf-8")
    (RESULTS / LOTE / "metadata.json").write_text(json.dumps({
        "lote": LOTE, "commitBsh": git(REPO, ["rev-parse", "HEAD"]).strip(),
        "commitProjeto": git(PILOT, ["rev-parse", "HEAD"]).strip(), "modelo": MODEL, "esforco": EFFORT,
        "tarefas": TASKS["tarefas"], "ordemExecucao": ordem,
        "ambiente": {"node": subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip(),
                     "codex": subprocess.run(["codex", "--version"], capture_output=True, text=True).stdout.strip()},
    }, indent=2), encoding="utf-8")
    print(f"Lote: {RESULTS / LOTE}")


if __name__ == "__main__":
    main()
