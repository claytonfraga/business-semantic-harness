#!/usr/bin/env python3
"""Benchmark: Agente sem harness vs Agente com harness (Codex ou Agy).

Boas praticas:
- mesmo prompt, modelo e esforco nas condicoes;
- copias limpas e isoladas por execucao;
- ordem das condicoes randomizada por execucao (semente registrada);
- aquecimento descartado (BENCH_WARMUP por condicao);
- suite de prompts opcional (BENCH_PROMPTS), ciclada entre execucoes;
- proveniencia: hash do commit do harness e hash do prompt em metadata.json;
- layout: results/<agente>-<data-hora-segundos>/<n>/ com prompt, metadados e artefatos.
"""
import hashlib
import json
import os
import platform
import random
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import conditions  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PILOT = os.path.join(REPO, "pilot", "asset-management")
RESULTS = os.path.join(HERE, "results")
PROMPTS_ENV = os.environ.get("BENCH_PROMPTS") or os.environ.get("BENCH_PROMPT")
if PROMPTS_ENV:
    PROMPT_FILES = [os.path.abspath(part.strip()) for part in PROMPTS_ENV.split(",") if part.strip()]
else:
    PROMPT_FILES = [os.path.join(HERE, "prompts", "aderente.txt")]
RUNS = int(os.environ.get("BENCH_RUNS", "1"))
WARMUP = int(os.environ.get("BENCH_WARMUP", "1"))
CONCORRENCIA = max(1, int(os.environ.get("BENCH_CONCURRENCY", "3")))


def parse_agent():
    for i, arg in enumerate(sys.argv):
        if arg in ("--agent", "-a") and i + 1 < len(sys.argv):
            return sys.argv[i + 1].lower()
    return os.environ.get("BENCH_AGENT", "codex").lower()


AGENT = parse_agent()
DEFAULT_MODEL = "gemini-3.7-flash-low" if AGENT == "agy" else "gpt-6-sol"
MODEL = os.environ.get("BENCH_MODEL", DEFAULT_MODEL)
EFFORT = os.environ.get("BENCH_EFFORT", "low")
LOTE = f"{AGENT}-{time.strftime('%Y-%m-%dT%H-%M-%S')}"
CONDICOES = [
    ("sem-harness", ""),
    ("com-contexto-sem-enforcement", "BSH_ENFORCEMENT=off "),
    ("com-harness", ""),
]


def sha256_texto(texto):
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def commit_harness():
    try:
        return subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return "indisponivel"


def ambiente():
    try:
        codex = subprocess.run(["codex", "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        codex = "indisponivel"
    try:
        agy = subprocess.run(["agy", "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        agy = "indisponivel"
    try:
        bsh = json.load(open(os.path.join(REPO, "package.json"), encoding="utf-8"))["version"]
    except Exception:
        bsh = "indisponivel"
    return {
        "agente": AGENT,
        "codex": codex,
        "agy": agy,
        "bsh": bsh,
        "python": platform.python_version(),
        "plataforma": platform.platform(),
        "commit_harness": commit_harness(),
    }


def prompts():
    return [{"arquivo": arquivo, "texto": open(arquivo, encoding="utf-8").read().strip()} for arquivo in PROMPT_FILES]


def escrever_metadados(diretorio, dados):
    os.makedirs(diretorio, exist_ok=True)
    with open(os.path.join(diretorio, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(dados, handle, indent=2, ensure_ascii=False)


def executar_condicao(condicao, execucao, condition_dir, prompt, extra_env=""):
    try:
        if condicao == "sem-harness":
            return conditions.run_sem_bsh(condition_dir, PILOT, prompt, MODEL, EFFORT, agent=AGENT)
        return conditions.run_com_bsh(condition_dir, PILOT, prompt, MODEL, EFFORT, f"bench-{condicao}-{LOTE}-{execucao}", extra_env, agent=AGENT)
    except Exception as error:  # noqa: BLE001
        print(f"[{LOTE} #{execucao}] {condicao} erro: {error}", flush=True)
        return {"condicao": condicao, "agente": AGENT, "entrada": 0, "cache": 0, "saida": 0, "raciocinio": 0, "totais": 0,
                "consultas": 0, "conflitos": 0, "bloqueado": False, "erro": True, "duracao": 0}


def executar_execucao(execucao, lista_prompts):
    prompt = lista_prompts[(execucao - 1) % len(lista_prompts)]
    execution_dir = os.path.join(RESULTS, LOTE, str(execucao))
    os.makedirs(execution_dir, exist_ok=True)
    with open(os.path.join(execution_dir, "prompt.txt"), "w", encoding="utf-8") as handle:
        handle.write(prompt["texto"] + "\n")
    rng = random.Random(f"{LOTE}-{execucao}")
    ordem = [nome for nome, _ in CONDICOES]
    rng.shuffle(ordem)
    escrever_metadados(execution_dir, {
        "lote": LOTE, "agente": AGENT, "execucao": execucao, "prompt_arquivo": prompt["arquivo"], "prompt": prompt["texto"],
        "prompt_sha256": sha256_texto(prompt["texto"]), "modelo": MODEL, "esforco": EFFORT,
        "ordem": ordem, "semente": f"{LOTE}-{execucao}", "ambiente": ambiente(),
    })
    resultados = {}
    for condicao in ordem:
        condition_dir = os.path.join(execution_dir, condicao)
        os.makedirs(condition_dir, exist_ok=True)
        print(f"[{LOTE} #{execucao}] {condicao} (agente: {AGENT})", flush=True)
        row = executar_condicao(condicao, execucao, condition_dir, prompt["texto"], dict(CONDICOES).get(condicao, ""))
        record = {**row, "agente": AGENT, "execucao": execucao, "lote": LOTE, "modelo": MODEL, "esforco": EFFORT, "prompt_sha256": sha256_texto(prompt["texto"])}
        with open(os.path.join(condition_dir, "result.json"), "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=2)
        resultados[condicao] = record
        print(f"[{LOTE} #{execucao}] {condicao} tokens={row['totais']} bloqueado={'sim' if row['bloqueado'] else 'nao'} erro={'sim' if row['erro'] else 'nao'} {row['duracao']}s", flush=True)
    with open(os.path.join(execution_dir, "result.json"), "w", encoding="utf-8") as handle:
        json.dump(resultados, handle, indent=2)


def executar_aquecimento(lista_prompts):
    if WARMUP <= 0:
        return
    prompt = lista_prompts[0]
    for indice in range(1, WARMUP + 1):
        for condicao, extra_env in CONDICOES:
            directory = os.path.join(RESULTS, LOTE, "aquecimento", str(indice), condicao)
            os.makedirs(directory, exist_ok=True)
            print(f"[{LOTE}] aquecimento {indice} {condicao} (agente: {AGENT})", flush=True)
            executar_condicao(condicao, f"aquecimento-{indice}", directory, prompt["texto"], extra_env)


def main():
    os.makedirs(os.path.join(RESULTS, LOTE), exist_ok=True)
    lista_prompts = prompts()
    print(f"Agente: {AGENT}; Lote: {LOTE}; modelo: {MODEL}; execucoes: {RUNS}; aquecimento: {WARMUP}; concorrencia: {CONCORRENCIA}; prompts: {len(lista_prompts)}", flush=True)
    executar_aquecimento(lista_prompts)
    with ThreadPoolExecutor(max_workers=CONCORRENCIA) as executor:
        list(executor.map(lambda execucao: executar_execucao(execucao, lista_prompts), range(1, RUNS + 1)))
    lote_dir = Path(RESULTS) / LOTE
    print(f"Resultados: {lote_dir}")
    try:
        from analysis.build_report import run_analysis
        res = run_analysis(lote_dir)
        print(f"Análise concluída: {len(res.get('figures', []))} figuras geradas. Relatório: {res.get('pdf')}")
    except Exception as e:
        print(f"Aviso na análise científica: {e}")


if __name__ == "__main__":
    main()
