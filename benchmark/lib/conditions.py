import json
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
    if not os.path.isdir(os.path.join(project, ".git")):
        subprocess.run(["git", "init", "-q", project], check=True)
        subprocess.run(["git", "-C", project, "config", "user.name", "Benchmark"], check=True)
        subprocess.run(["git", "-C", project, "config", "user.email", "bench@example.com"], check=True)
        subprocess.run(["git", "-C", project, "config", "commit.gpgsign", "false"], check=True)
        subprocess.run(["git", "-C", project, "add", "-A"], check=True)
        subprocess.run(["git", "-C", project, "commit", "-q", "-m", "initial benchmark base"], check=True)
    return project


def _prepare_agy_home(execution_dir, project):
    home_dir = os.path.join(execution_dir, "agy-home")
    os.makedirs(home_dir, exist_ok=True, mode=0o700)
    gemini_dir = os.path.join(home_dir, ".gemini")
    agy_dir = os.path.join(gemini_dir, "antigravity-cli")
    cache_dir = os.path.join(agy_dir, "cache")
    config_dir = os.path.join(gemini_dir, "config")
    os.makedirs(agy_dir, exist_ok=True, mode=0o700)
    os.makedirs(cache_dir, exist_ok=True, mode=0o700)
    os.makedirs(config_dir, exist_ok=True, mode=0o700)

    real_gemini = os.path.join(os.path.expanduser("~"), ".gemini")
    real_agy = os.path.join(real_gemini, "antigravity-cli")

    for f in ["oauth_creds.json", "google_accounts.json", "google_account_id", "installation_id", "state.json"]:
        src = os.path.join(real_gemini, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(gemini_dir, f))

    for f in ["antigravity-oauth-token", "installation_id", "jetski_state.pbtxt"]:
        src = os.path.join(real_agy, f)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(agy_dir, f))

    with open(os.path.join(gemini_dir, "trustedFolders.json"), "w", encoding="utf-8") as h:
        json.dump({project: "TRUST_FOLDER"}, h)
    with open(os.path.join(agy_dir, "settings.json"), "w", encoding="utf-8") as h:
        json.dump({"trustedWorkspaces": [project], "permissions": {"allow": ["*"]}}, h)
    with open(os.path.join(gemini_dir, "settings.json"), "w", encoding="utf-8") as h:
        json.dump({"ui": {"theme": "Default"}}, h)
    with open(os.path.join(cache_dir, "onboarding.json"), "w", encoding="utf-8") as h:
        json.dump({"consumerOnboardingComplete": True, "onboardingComplete": True}, h)

    return home_dir


def run_sem_bsh_codex(execution_dir, pilot, prompt, model, effort):
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


def run_sem_bsh_agy(execution_dir, pilot, prompt, model, effort):
    project = _prepare_project(execution_dir, pilot)
    started = time.time()
    home_dir = _prepare_agy_home(execution_dir, project)
    env = {**os.environ, "HOME": home_dir}
    cmd = ["agy", "-p", prompt, "--dangerously-skip-permissions", "--output-format", "json"]
    if model:
        cmd.extend(["--model", model])
    if effort:
        cmd.extend(["--effort", effort])

    result = subprocess.run(cmd, cwd=project, env=env, capture_output=True, text=True, input="", timeout=TURN_S)
    with open(os.path.join(execution_dir, "exec-output.jsonl"), "w", encoding="utf-8") as handle:
        handle.write(result.stdout)
    with open(os.path.join(execution_dir, "exec-stderr.log"), "w", encoding="utf-8") as handle:
        handle.write(result.stderr)

    usage = None
    try:
        data = json.loads(result.stdout.strip())
        if isinstance(data, dict):
            usage = data.get("usage")
    except Exception:
        pass

    entrada = usage.get("input_tokens") if usage else None
    saida = usage.get("output_tokens") if usage else None
    cache = usage.get("cache_read_tokens") if usage else None
    raciocinio = usage.get("thinking_tokens") if usage else None
    totais = usage.get("total_tokens") if usage else None
    if totais is None and entrada is not None and saida is not None:
        totais = entrada + saida

    return {
        "condicao": "sem-harness", "entrada": entrada, "cache": cache,
        "saida": saida, "raciocinio": raciocinio, "totais": totais,
        "consultas": 0, "conflitos": 0, "bloqueado": False, "erro": result.returncode != 0,
        "duracao": int(time.time() - started),
    }


def run_sem_bsh(execution_dir, pilot, prompt, model, effort, agent="codex"):
    if agent == "agy":
        return run_sem_bsh_agy(execution_dir, pilot, prompt, model, effort)
    return run_sem_bsh_codex(execution_dir, pilot, prompt, model, effort)


def run_com_bsh_codex(execution_dir, pilot, prompt, model, effort, session, extra_env=""):
    project = _prepare_project(execution_dir, pilot)
    _kill(session)
    started = time.time()
    tmux.tmux(["new-session", "-d", "-s", session, "-x", "220", "-y", "55", "bash"])
    time.sleep(0.5)
    tmux.tmux(["send-keys", "-t", session, f"{extra_env}BSH_CODEX_MODEL={model} BSH_CODEX_REASONING_EFFORT={effort} bsh codex --project {project}", "Enter"])
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
    tmux.wait_for_pane(session, r"Aprovar excecao|custo da verificacao ontologica|tokens indisponiveis|nenhuma alteracao|Worktree temporaria removida|a validacao falhou|promocao nao realizada", FINALIZE_S)
    asked = "Aprovar excecao" in tmux.pane(session)
    if asked:
        tmux.tmux(["send-keys", "-t", session, "n"])
        time.sleep(0.5)
        tmux.tmux(["send-keys", "-t", session, "Enter"])
        tmux.wait_for_pane(session, r"teste E2E encerrado|excecao negada|Worktree temporaria removida", 30)
    else:
        time.sleep(2)
    with open(os.path.join(execution_dir, "pane-final.txt"), "w", encoding="utf-8") as handle:
        handle.write(tmux.pane(session))
    usage = tokens.last_token_usage(log_file)
    row = {
        "condicao": "com-harness",
        "entrada": usage.get("inputTokens") if usage else None,
        "cache": usage.get("cachedInputTokens") if usage else None,
        "saida": usage.get("outputTokens") if usage else None,
        "raciocinio": usage.get("reasoningOutputTokens") if usage else None,
        "totais": usage.get("totalTokens") if usage else None,
        "consultas": tokens.count_occurrences(log_file, '"tool":"bsh_query_ontology"'),
        "conflitos": tokens.count_occurrences(log_file, '"conflict":true'),
        "bloqueado": asked, "erro": False, "duracao": int(time.time() - started),
    }
    _kill(session)
    return row


def run_com_bsh_agy(execution_dir, pilot, prompt, model, effort, session, extra_env=""):
    project = _prepare_project(execution_dir, pilot)
    _kill(session)
    started = time.time()
    tmux.tmux(["new-session", "-d", "-s", session, "-x", "220", "-y", "55", "bash"])
    time.sleep(0.5)
    model_env = f"BSH_AGY_MODEL={model} " if model else ""
    tmux.tmux(["send-keys", "-t", session, f"{extra_env}{model_env}bsh agy --project {project}", "Enter"])
    if not tmux.wait_for_pane(session, r"Antigravity CLI|\? for shortcuts|Gemini|>", TUI_OPEN_S):
        _kill(session)
        raise RuntimeError("TUI do Agy nao abriu")
    tmux.tmux(["send-keys", "-t", session, prompt])
    time.sleep(1)
    tmux.tmux(["send-keys", "-t", session, "Enter"])

    deadline = time.time() + TURN_S
    started_processing = False
    while time.time() < deadline:
        time.sleep(2)
        p = tmux.pane(session)
        if "esc to cancel" in p:
            started_processing = True
        elif started_processing and ("? for shortcuts" in p or ">" in p[-200:]):
            break
        elif not started_processing and ("? for shortcuts" in p[-200:] and "BSH pronto" in p):
            break

    time.sleep(1)
    tmux.tmux(["send-keys", "-t", session, "/exit", "Enter"])
    tmux.wait_for_pane(session, r"Aprovar excecao|custo da verificacao ontologica|tokens indisponiveis|nenhuma alteracao|Worktree temporaria removida|a validacao falhou|promocao nao realizada", FINALIZE_S)
    asked = "Aprovar excecao" in tmux.pane(session)
    if asked:
        tmux.tmux(["send-keys", "-t", session, "n"])
        time.sleep(0.5)
        tmux.tmux(["send-keys", "-t", session, "Enter"])
        tmux.wait_for_pane(session, r"teste E2E encerrado|excecao negada|Worktree temporaria removida", 30)
    else:
        time.sleep(2)

    with open(os.path.join(execution_dir, "pane-final.txt"), "w", encoding="utf-8") as handle:
        handle.write(tmux.pane(session))

    log_file = tokens.newest_session_log(project)
    usage = tokens.last_token_usage(log_file)

    report_data = {}
    sessions_dir = os.path.join(project, ".bsh", "local", "sessions")
    if os.path.isdir(sessions_dir):
        reports = sorted(f for f in os.listdir(sessions_dir) if f.endswith(".report.json"))
        if reports:
            try:
                with open(os.path.join(sessions_dir, reports[-1]), encoding="utf-8") as rf:
                    report_data = json.load(rf)
            except Exception:
                pass

    consultas = tokens.count_occurrences(log_file, '"tool":"bsh_query_ontology"') if log_file else 0
    conflitos = tokens.count_occurrences(log_file, '"conflict":true') if log_file else 0
    bloqueado = asked or report_data.get("bloqueado", False)

    row = {
        "condicao": "com-harness",
        "entrada": usage.get("inputTokens") if usage else None,
        "cache": usage.get("cachedInputTokens") if usage else None,
        "saida": usage.get("outputTokens") if usage else None,
        "raciocinio": usage.get("reasoningOutputTokens") if usage else None,
        "totais": usage.get("totalTokens") if usage else None,
        "consultas": consultas,
        "conflitos": conflitos,
        "bloqueado": bloqueado, "erro": False, "duracao": int(time.time() - started),
    }
    _kill(session)
    return row


def run_com_bsh(execution_dir, pilot, prompt, model, effort, session, extra_env="", agent="codex"):
    if agent == "agy":
        return run_com_bsh_agy(execution_dir, pilot, prompt, model, effort, session, extra_env)
    return run_com_bsh_codex(execution_dir, pilot, prompt, model, effort, session, extra_env)
