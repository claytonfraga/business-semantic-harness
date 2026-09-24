import os
import shutil
import subprocess
import time

from lib import tmux
from lib import tokens

TUI_OPEN_S = 90
TURN_S = 600
FINALIZE_S = 90


def _kill(session):
    try:
        tmux.tmux(["kill-session", "-t", session])
    except Exception:
        pass


def _prepare_project(execution_dir, pilot):
    project = os.path.join(execution_dir, "project")
    shutil.rmtree(project, ignore_errors=True)
    os.makedirs(project, exist_ok=True)
    shutil.copytree(pilot, project, dirs_exist_ok=True)
    shutil.rmtree(os.path.join(project, ".bsh", "local"), ignore_errors=True)
    return project


def run_sem_bsh(execution_dir, pilot, prompt, model, effort):
    project = _prepare_project(execution_dir, pilot)
    started = time.time()
    result = subprocess.run(
        [
            "codex", "exec", "--json", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config",
            "-m", model, "-c", f'model_reasoning_effort="{effort}"', "-s", "danger-full-access",
            "-C", project, prompt,
        ],
        capture_output=True, text=True, input="", timeout=TURN_S,
    )
    with open(os.path.join(execution_dir, "exec-output.jsonl"), "w", encoding="utf-8") as handle:
        handle.write(result.stdout)
    with open(os.path.join(execution_dir, "exec-stderr.log"), "w", encoding="utf-8") as handle:
        handle.write(result.stderr)
    usage = tokens.usage_from_exec_output(result.stdout)
    if not usage:
        raise RuntimeError("Uso de tokens indisponivel no codex exec")
    entrada = usage.get("input_tokens", 0)
    saida = usage.get("output_tokens", 0)
    return {
        "condicao": "sem-harness", "entrada": entrada, "cache": usage.get("cached_input_tokens", 0),
        "saida": saida, "raciocinio": usage.get("reasoning_output_tokens", 0), "totais": entrada + saida,
        "consultas": 0, "conflitos": 0, "bloqueado": False, "erro": False,
        "duracao": int(time.time() - started),
    }


def run_com_bsh(execution_dir, pilot, prompt, model, effort, session):
    project = _prepare_project(execution_dir, pilot)
    _kill(session)
    started = time.time()
    tmux.tmux(["new-session", "-d", "-s", session, "-x", "220", "-y", "55"])
    tmux.tmux(["send-keys", "-t", session, f"BSH_CODEX_MODEL={model} BSH_CODEX_REASONING_EFFORT={effort} bsh codex --project {project}", "Enter"])
    if not tmux.wait_for_pane(session, r"Ask Codex to do anything", TUI_OPEN_S):
        _kill(session)
        raise RuntimeError("TUI do Codex nao abriu")
    tmux.tmux(["send-keys", "-t", session, prompt])
    time.sleep(1)
    tmux.tmux(["send-keys", "-t", session, "Enter"])
    if not tmux.wait_for_log(project, tokens.turn_completed, TURN_S):
        _kill(session)
        raise RuntimeError("Turno do BSH nao concluiu no tempo esperado")
    log_file = tokens.newest_session_log(project)
    tmux.tmux(["send-keys", "-t", session, "C-c"])
    asked = tmux.wait_for_pane(session, r"Aprovar excecao", FINALIZE_S)
    if asked:
        tmux.tmux(["send-keys", "-t", session, "n"])
        time.sleep(0.5)
        tmux.tmux(["send-keys", "-t", session, "Enter"])
        tmux.wait_for_pane(session, r"teste E2E encerrado|excecao negada", FINALIZE_S)
    else:
        tmux.wait_for_pane(session, r"ontologia respeitada|nenhuma alteracao", FINALIZE_S)
    with open(os.path.join(execution_dir, "pane-final.txt"), "w", encoding="utf-8") as handle:
        handle.write(tmux.pane(session))
    usage = tokens.last_token_usage(log_file) or {}
    row = {
        "condicao": "com-harness", "entrada": usage.get("inputTokens", 0), "cache": usage.get("cachedInputTokens", 0),
        "saida": usage.get("outputTokens", 0), "raciocinio": usage.get("reasoningOutputTokens", 0),
        "totais": usage.get("totalTokens", 0),
        "consultas": tokens.count_occurrences(log_file, '"tool":"bsh_query_ontology"'),
        "conflitos": tokens.count_occurrences(log_file, '"conflict":true'),
        "bloqueado": asked, "erro": False, "duracao": int(time.time() - started),
    }
    _kill(session)
    return row
