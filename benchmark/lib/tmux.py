import re
import subprocess
import time


def tmux(args):
    return subprocess.run(["tmux", *args], capture_output=True, text=True, check=True).stdout


def pane(session):
    try:
        return tmux(["capture-pane", "-t", session, "-p", "-S", "-2000"])
    except Exception:
        return ""


def wait_for_pane(session, pattern, timeout_s):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if re.search(pattern, pane(session)):
            return True
        time.sleep(2)
    return False


def wait_for_log(project, predicate, timeout_s):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if predicate(project):
            return True
        time.sleep(3)
    return False
