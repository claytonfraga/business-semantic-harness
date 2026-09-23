#!/usr/bin/env python3
"""Benchmark: Codex sem Oracle vs Codex com Oracle harness.

Boas praticas:
- mesmo prompt, modelo e esforco nas duas condicoes;
- copias limpas e isoladas por execucao;
- ordem das condicoes alternada entre execucoes;
- cada execucao em results/<data-hora-segundos>-<n>/ com prompt, metadados e artefatos;
- analise agregada (media, desvio padrao, IC 95%, graficos) em results/.
"""
import json
import os
import platform
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import conditions  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PILOT = os.path.join(REPO, "pilot", "asset-management")
RESULTS = os.path.join(HERE, "results")
PROMPT_FILE = os.environ.get("BENCH_PROMPT") or os.path.join(HERE, "prompts", "aderente.txt")
PROMPT = open(PROMPT_FILE, encoding="utf-8").read().strip()
RUNS = int(os.environ.get("BENCH_RUNS", "1"))
CONCORRENCIA = max(1, int(os.environ.get("BENCH_CONCURRENCY", "3")))
MODEL = os.environ.get("BENCH_MODEL", "gpt-6-sol")
EFFORT = os.environ.get("BENCH_EFFORT", "low")


def ambiente():
    try:
        codex = subprocess.run(["codex", "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        codex = "indisponivel"
    try:
        oracle = json.load(open(os.path.join(REPO, "package.json"), encoding="utf-8"))["version"]
    except Exception:
        oracle = "indisponivel"
    return {"codex": codex, "oracle": oracle, "python": platform.python_version(), "plataforma": platform.platform()}


def executar_condicao(condicao, execucao, condition_dir, pasta):
    print(f"[exec {execucao}] {condicao} -> {pasta}", flush=True)
    try:
        if condicao == "sem-oracle":
            row = conditions.run_sem_oracle(condition_dir, PILOT, PROMPT, MODEL, EFFORT)
        else:
            row = conditions.run_com_oracle(condition_dir, PILOT, PROMPT, MODEL, EFFORT, f"bench-{condicao}-{execucao}")
    except Exception as error:  # noqa: BLE001
        row = {"condicao": condicao, "entrada": 0, "cache": 0, "saida": 0, "raciocinio": 0, "totais": 0,
               "consultas": 0, "conflitos": 0, "bloqueado": False, "erro": True, "duracao": 0}
        print(f"[exec {execucao}] {condicao} erro: {error}", flush=True)
    record = {**row, "execucao": execucao, "pasta": pasta, "modelo": MODEL, "esforco": EFFORT}
    with open(os.path.join(condition_dir, "result.json"), "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2)
    print(f"[exec {execucao}] {condicao} tokens={row['totais']} bloqueado={'sim' if row['bloqueado'] else 'nao'} {row['duracao']}s", flush=True)
    return record


def executar_execucao(execucao):
    pasta = f"{time.strftime('%Y-%m-%dT%H-%M-%S')}-{execucao}"
    execution_dir = os.path.join(RESULTS, pasta)
    os.makedirs(execution_dir, exist_ok=True)
    with open(os.path.join(execution_dir, "prompt.txt"), "w", encoding="utf-8") as handle:
        handle.write(PROMPT + "\n")
    with open(os.path.join(execution_dir, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump({"pasta": pasta, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "modelo": MODEL,
                   "esforco": EFFORT, "prompt_file": PROMPT_FILE, "prompt": PROMPT, "ambiente": ambiente()}, handle, indent=2)
    ordem = ["sem-oracle", "com-oracle"] if execucao % 2 == 1 else ["com-oracle", "sem-oracle"]
    resultados = {}
    for condicao in ordem:
        condition_dir = os.path.join(execution_dir, condicao)
        os.makedirs(condition_dir, exist_ok=True)
        resultados[condicao] = executar_condicao(condicao, execucao, condition_dir, pasta)
    with open(os.path.join(execution_dir, "result.json"), "w", encoding="utf-8") as handle:
        json.dump(resultados, handle, indent=2)


def main():
    os.makedirs(RESULTS, exist_ok=True)
    print(f"Execucoes: {RUNS}; concorrencia: {CONCORRENCIA}; prompt: {PROMPT_FILE}", flush=True)
    with ThreadPoolExecutor(max_workers=CONCORRENCIA) as executor:
        list(executor.map(executar_execucao, range(1, RUNS + 1)))
    print(f"Resultados: {RESULTS}")


if __name__ == "__main__":
    main()
