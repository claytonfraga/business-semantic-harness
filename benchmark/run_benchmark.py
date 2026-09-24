#!/usr/bin/env python3
"""Benchmark: Codex sem harness vs Codex com harness.

Boas praticas:
- mesmo prompt, modelo e esforco nas duas condicoes;
- copias limpas e isoladas por execucao;
- ordem das condicoes randomizada por execucao (semente registrada);
- aquecimento descartado (BENCH_WARMUP por condicao);
- suite de prompts opcional (BENCH_PROMPTS), ciclada entre execucoes;
- proveniencia: hash do commit do harness e hash do prompt em metadata.json;
- layout: results/<data-hora-segundos>/<n>/ com prompt, metadados e artefatos.
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
MODEL = os.environ.get("BENCH_MODEL", "gpt-6-sol")
EFFORT = os.environ.get("BENCH_EFFORT", "low")
LOTE = time.strftime("%Y-%m-%dT%H-%M-%S")


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
        bsh = json.load(open(os.path.join(REPO, "package.json"), encoding="utf-8"))["version"]
    except Exception:
        bsh = "indisponivel"
    return {"codex": codex, "bsh": bsh, "python": platform.python_version(), "plataforma": platform.platform(), "commit_harness": commit_harness()}


def prompts():
    return [{"arquivo": arquivo, "texto": open(arquivo, encoding="utf-8").read().strip()} for arquivo in PROMPT_FILES]


def escrever_metadados(diretorio, dados):
    os.makedirs(diretorio, exist_ok=True)
    with open(os.path.join(diretorio, "metadata.json"), "w", encoding="utf-8") as handle:
        json.dump(dados, handle, indent=2, ensure_ascii=False)


def executar_condicao(condicao, execucao, condition_dir, prompt):
    try:
        if condicao == "sem-harness":
            return conditions.run_sem_bsh(condition_dir, PILOT, prompt, MODEL, EFFORT)
        return conditions.run_com_bsh(condition_dir, PILOT, prompt, MODEL, EFFORT, f"bench-{condicao}-{LOTE}-{execucao}")
    except Exception as error:  # noqa: BLE001
        print(f"[{LOTE} #{execucao}] {condicao} erro: {error}", flush=True)
        return {"condicao": condicao, "entrada": 0, "cache": 0, "saida": 0, "raciocinio": 0, "totais": 0,
                "consultas": 0, "conflitos": 0, "bloqueado": False, "erro": True, "duracao": 0}


def executar_execucao(execucao, lista_prompts):
    prompt = lista_prompts[(execucao - 1) % len(lista_prompts)]
    execution_dir = os.path.join(RESULTS, LOTE, str(execucao))
    os.makedirs(execution_dir, exist_ok=True)
    with open(os.path.join(execution_dir, "prompt.txt"), "w", encoding="utf-8") as handle:
        handle.write(prompt["texto"] + "\n")
    rng = random.Random(f"{LOTE}-{execucao}")
    ordem = ["sem-harness", "com-harness"]
    rng.shuffle(ordem)
    escrever_metadados(execution_dir, {
        "lote": LOTE, "execucao": execucao, "prompt_arquivo": prompt["arquivo"], "prompt": prompt["texto"],
        "prompt_sha256": sha256_texto(prompt["texto"]), "modelo": MODEL, "esforco": EFFORT,
        "ordem": ordem, "semente": f"{LOTE}-{execucao}", "ambiente": ambiente(),
    })
    resultados = {}
    for condicao in ordem:
        condition_dir = os.path.join(execution_dir, condicao)
        os.makedirs(condition_dir, exist_ok=True)
        print(f"[{LOTE} #{execucao}] {condicao}", flush=True)
        row = executar_condicao(condicao, execucao, condition_dir, prompt["texto"])
        record = {**row, "execucao": execucao, "lote": LOTE, "modelo": MODEL, "esforco": EFFORT, "prompt_sha256": sha256_texto(prompt["texto"])}
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
        for condicao in ("sem-harness", "com-harness"):
            directory = os.path.join(RESULTS, LOTE, "aquecimento", str(indice), condicao)
            os.makedirs(directory, exist_ok=True)
            print(f"[{LOTE}] aquecimento {indice} {condicao}", flush=True)
            executar_condicao(condicao, f"aquecimento-{indice}", directory, prompt["texto"])


def main():
    os.makedirs(os.path.join(RESULTS, LOTE), exist_ok=True)
    lista_prompts = prompts()
    print(f"Lote: {LOTE}; execucoes: {RUNS}; aquecimento: {WARMUP}; concorrencia: {CONCORRENCIA}; prompts: {len(lista_prompts)}", flush=True)
    executar_aquecimento(lista_prompts)
    with ThreadPoolExecutor(max_workers=CONCORRENCIA) as executor:
        list(executor.map(lambda execucao: executar_execucao(execucao, lista_prompts), range(1, RUNS + 1)))
    print(f"Resultados: {os.path.join(RESULTS, LOTE)}")


if __name__ == "__main__":
    main()
