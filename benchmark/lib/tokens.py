import json
import os


def usage_from_exec_output(output):
    usage = None
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "turn.completed" and event.get("usage"):
            usage = event["usage"]
    return usage


def newest_session_log(project):
    directory = os.path.join(project, ".oracle", "local")
    if not os.path.isdir(directory):
        return None
    files = sorted(name for name in os.listdir(directory) if name.startswith("session-") and name.endswith(".jsonl"))
    return os.path.join(directory, files[-1]) if files else None


def turn_completed(project):
    log_file = newest_session_log(project)
    return bool(log_file) and log_has(log_file, '"event":"turn-completed"')


def last_token_usage(log_file):
    if not log_file or not os.path.isfile(log_file):
        return None
    with open(log_file, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if entry.get("event") == "token-usage":
            return entry
    return None


def count_occurrences(log_file, needle):
    if not log_file or not os.path.isfile(log_file):
        return 0
    with open(log_file, encoding="utf-8") as handle:
        return sum(1 for line in handle if needle in line)


def log_has(log_file, needle):
    if not log_file or not os.path.isfile(log_file):
        return False
    with open(log_file, encoding="utf-8") as handle:
        return needle in handle.read()
