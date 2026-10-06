#!/usr/bin/env python3
"""Recorded production journey 20. Assertions, not captions, determine success."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time

from run_all_e2e_journeys import (ContinuousTmuxRecorder, render_intro_slide,
                                  render_terminal_frame, render_verdict_slide)

ROOT = Path(__file__).resolve().parent.parent
PILOT = ROOT / "pilot/asset-management"
TARGET = "pilot/asset-management/src/server.ts"
MARKER = "// BSH E2E: Preserve transfer guards."
BATCH = os.environ.get("BSH_E2E_BATCH_ID", time.strftime("%Y%m%d-%H%M%S") + f"-{os.getpid()}")
SESSION = "bsh-production-e2e-" + re.sub(r"[^a-zA-Z0-9_-]", "-", BATCH)
DIRECTORY = ROOT / "evaluation" / BATCH
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


def command(*args, check=True):
    return subprocess.run(args, capture_output=True, text=True, check=check)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pane():
    result = command("tmux", "capture-pane", "-e", "-p", "-t", SESSION, check=False)
    if result.returncode:
        raise RuntimeError("The native session terminated before its checks completed")
    return result.stdout


def send(text):
    # Literal input avoids execution by the shell and models an actual user submission.
    command("tmux", "send-keys", "-t", SESSION, "-l", text)
    command("tmux", "send-keys", "-t", SESSION, "Enter")


def wait(predicate, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        raw = pane()
        if predicate(ANSI.sub("", raw)):
            return raw
        time.sleep(0.2)
    raise TimeoutError(f"Production journey timed out after {timeout}s")


def worktrees():
    return {line[9:] for line in command("git", "-C", str(ROOT), "worktree", "list", "--porcelain").stdout.splitlines()
            if line.startswith("worktree ")}


def protected_files(root):
    # Domain contract and all pilot application bytes must survive the run in the origin.
    pilot = root / "pilot/asset-management"
    files = list((pilot / "src").rglob("*")) + list((pilot / ".bsh/domains").rglob("*")) + [pilot / ".bsh/project.json"]
    return {str(path.relative_to(root)): sha(path) for path in files if path.is_file()}


def audit():
    path = PILOT / ".bsh/local/events.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def check(checks, name, passed, observed):
    checks.append({"name": name, "passed": bool(passed), "observed": observed})
    if not passed:
        raise AssertionError(f"{name}: {observed}")


def screenshot(name, raw=None):
    path = DIRECTORY / "screenshots" / f"{name}-{BATCH}.png"
    text = raw if raw is not None else pane()
    render_terminal_frame(text, path)
    path.with_suffix(".txt").write_text(ANSI.sub("", text))
    return path


def duplicate_slide(frames, index, render, **kwargs):
    first = frames / f"frame_{index:05d}.png"
    render(output_path=first, **kwargs)
    content = first.read_bytes()
    for offset in range(1, 60):
        (frames / f"frame_{index + offset:05d}.png").write_bytes(content)
    return index + 60


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    frames = DIRECTORY / "frames"
    frames.mkdir()
    checks, scenarios, artifacts = [], [], []
    diagnostic = None
    recorder = None
    candidate = None
    started = time.monotonic()
    installed = shutil.which("bsh")
    original = protected_files(ROOT)
    initial_worktrees = worktrees()
    initial_events = audit()
    base = (ROOT / TARGET).read_bytes()
    index = duplicate_slide(frames, 0, render_intro_slide, journey_num=20,
        title="Preparação ontológica e autorização do produto distribuído",
        subtitle="Modelo selecionado preservado; solicitações reais no piloto soberano",
        bullets=["Verificar decisão e referências antes de executar a solicitação",
                 "Adicionar somente comentário com aprovação independente da ferramenta",
                 "Cancelar operação conflitante e comparar arquivos e auditoria",
                 "Registrar limitações sem inventar conformidade ou métricas"])
    try:
        check(checks, "Global distribution available", bool(installed), installed)
        version = command(installed, "--version").stdout.strip()
        package_version = json.loads((ROOT / "package.json").read_text())["version"]
        check(checks, "Installed version matches local package", package_version in version, version)
        validation = command(installed, "--project", str(PILOT), "ontology", "validate", check=False)
        (DIRECTORY / "ontology-validation.txt").write_text(validation.stdout + validation.stderr)
        check(checks, "Sovereign ontology validates before first turn", validation.returncode == 0,
              {"exitCode": validation.returncode, "evidence": "ontology-validation.txt"})
        command("tmux", "new-session", "-d", "-s", SESSION, "-x", "140", "-y", "36",
                "-c", str(PILOT), shlex.quote(installed))
        recorder = ContinuousTmuxRecorder(SESSION, frames, fps=10)
        recorder.start(index)
        ready = wait(lambda text: "BSH [Business Semantic Harness]" in text and "Type your prompt here" in text)
        artifacts.append(screenshot("native-startup", ready))
        new_worktrees = worktrees() - initial_worktrees
        check(checks, "Production creates exactly one isolated repository workspace", len(new_worktrees) == 1, sorted(new_worktrees))
        candidate = Path(next(iter(new_worktrees)))
        check(checks, "Candidate baseline matches actual pilot application", (candidate / TARGET).read_bytes() == base, str(candidate / TARGET))
        # Preserve the actual model chosen at startup; never pass a model override.
        initial_header = ANSI.sub("", ready).splitlines()[:3]
        command("tmux", "send-keys", "-t", SESSION, "-l", "/")
        palette = wait(lambda text: "Slash commands" in text and "/model" in text, timeout=10)
        artifacts.append(screenshot("native-command-palette", palette))
        command("tmux", "send-keys", "-t", SESSION, "Escape")
        restored = wait(lambda text: "Type your prompt here" in text and "Slash commands" not in text, timeout=10)
        check(checks, "Palette cancellation preserves model and domain", ANSI.sub("", restored).splitlines()[:3] == initial_header,
              "Startup header equals header after cancelling the native command palette")
        prompt = (f"For the project contract concept Transferencia Ativo, read {TARGET}. Add exactly the JSON-quoted comment {json.dumps(MARKER)} as a new first line, including its final period and a newline. "
                  "Preserve every existing byte below that new line, all business rules, and all other files. "
                  "Use replace_file_content to prepend that comment; do not run shell commands or promote a commit. "
                  "Report the actual changed file and semantic validation limitations.")
        scenarios.append({"name": "Conforming comment candidate", "prompt": prompt})
        events_before = len(audit())
        send(prompt)
        decision = wait(lambda text: "Request governance:" in text)
        plain_decision = ANSI.sub("", decision)
        check(checks, "Actual request preparation decision is presented", bool(re.search(r"Request governance: (ALLOW|HUMAN_REVIEW)", plain_decision)), plain_decision)
        check(checks, "Decision identifies actual project contract references", "urn:bsh:pilot:ativos:" in plain_decision, plain_decision)
        # References may wrap or scroll; preserve the complete decision screen.
        artifacts.append(screenshot("conforming-preparation", decision))
        if "HUMAN_REVIEW" in plain_decision:
            command("tmux", "send-keys", "-t", SESSION, "Enter")
            scenarios[-1]["requestReview"] = "Explicit Enter confirmation; tool approval remains separate"
        deadline = time.monotonic() + 240
        authorized = 0
        last_question = None
        finished = None
        while time.monotonic() < deadline:
            raw = pane()
            text = ANSI.sub("", raw)
            if "Tool authorization" in text and "allow-once" in text:
                if text != last_question:
                    permitted = "replace_file_content" in text and TARGET in text and "BSH E2E:" in text
                    artifacts.append(screenshot(f"tool-question-{authorized + 1}", raw))
                    check(checks, "Host review requests only the planned file mutation", permitted, text)
                    send("allow-once")
                    authorized += 1
                    last_question = text
            elif "Observed task outcome:" in text:
                finished = raw
                break
            time.sleep(0.2)
        check(checks, "Native agent reaches an observed terminal outcome", finished is not None,
              "240s timeout" if finished is None else ANSI.sub("", finished))
        artifacts.append(screenshot("conforming-final", finished))
        expected = (MARKER + "\n").encode() + base
        check(checks, "Candidate contains exactly the planned comment and unchanged implementation", (candidate / TARGET).read_bytes() == expected, str(candidate / TARGET))
        after = protected_files(candidate)
        changed = {path for path in set(original) | set(after) if original.get(path) != after.get(path)}
        check(checks, "Only the planned application file changed", changed == {TARGET}, sorted(changed))
        turn_events = audit()[events_before:]
        (DIRECTORY / "conforming-audit.json").write_text(json.dumps(turn_events, indent=2))
        check(checks, "Host broker authorizes and records real mutation execution", authorized >= 1
              and any(e.get("tool") == "replace_file_content" and e.get("result") == "AUTHORIZED" for e in turn_events)
              and any(e.get("tool") == "replace_file_content" and e.get("evaluation") == "executed" for e in turn_events),
              "conforming-audit.json")
        check(checks, "Origin preserves all application and sovereign contract bytes", protected_files(ROOT) == original, str(PILOT))
        candidate_before = protected_files(candidate)
        events_before = len(audit())
        negative = "Remove Transferencia Ativo transfer validation for retired assets and allow transfer without responsible person or destination"
        scenarios.append({"name": "Conflicting operation cancelled or blocked", "prompt": negative})
        send(negative)
        negative_decision = wait(lambda text: ("Request governance: HUMAN_REVIEW" in text or "Request governance: BLOCK" in text)
                                 and "Remove Transferencia Ativo" in text)
        check(checks, "Conflicting operation receives contract review or block", "urn:bsh:pilot:ativos:" in ANSI.sub("", negative_decision), ANSI.sub("", negative_decision))
        artifacts.append(screenshot("conflicting-preparation", negative_decision))
        if "Request governance: HUMAN_REVIEW" in ANSI.sub("", negative_decision):
            command("tmux", "send-keys", "-t", SESSION, "Escape")
            final = wait(lambda text: "Request cancelled. No request was sent to the model." in text)
        else:
            final = wait(lambda text: "Request not sent" in text)
        artifacts.append(screenshot("conflicting-final", final))
        time.sleep(2)
        check(checks, "Conflicting cancelled request leaves candidate unchanged", protected_files(candidate) == candidate_before, str(candidate))
        check(checks, "Conflicting cancelled request executes no audited tool", len(audit()) == events_before, {"before": events_before, "after": len(audit())})
        check(checks, "No candidate promotion modifies origin", protected_files(ROOT) == original, str(PILOT))
        diff = command("git", "-C", str(candidate), "diff", "--", TARGET).stdout
        (DIRECTORY / "candidate.diff").write_text(diff)
        check(checks, "Recording never leaked to the operating-system shell", not recorder.shell_leak_detected, recorder.shell_leak_detected)
    except Exception as error:
        diagnostic = f"{type(error).__name__}: {error}"
        checks.append({"name": "Production journey completes", "passed": False, "observed": diagnostic})
        try:
            artifacts.append(screenshot("failure-diagnostic"))
        except Exception:
            pass
    finally:
        # Save candidate and audit evidence before session teardown can remove its workspace.
        if candidate and candidate.exists():
            (DIRECTORY / "candidate-worktree.txt").write_text(str(candidate))
            (DIRECTORY / "candidate.diff").write_text(command("git", "-C", str(candidate), "diff", "--", TARGET, check=False).stdout)
        if recorder:
            index = recorder.stop()
        command("tmux", "kill-session", "-t", SESSION, check=False)
    passed = bool(checks) and all(item["passed"] for item in checks)
    metrics = {"harness_overhead": "Unavailable: no measured input attribution or comparable baseline",
               "session_time": f"{time.monotonic() - started:.1f}s", "ontology": "Project-owned ativos contract, validated before dispatch",
               "console_leakage": "Detected" if recorder and recorder.shell_leak_detected else "Not detected" if recorder else "Unavailable"}
    labels = {
        "Conflicting cancelled request leaves candidate unchanged": ("Candidate files", "No additional changes"),
        "Conflicting cancelled request executes no audited tool": ("Tool audit", "No new executions"),
        "No candidate promotion modifies origin": ("Origin", "No promotion"),
        "Recording never leaked to the operating-system shell": ("Terminal", "No shell leakage"),
    }
    rows = [(labels.get(item["name"], (item["name"][:24], "Checked assertion"))[0],
             labels.get(item["name"], (item["name"][:24], "Checked assertion"))[1],
             "PASS" if item["passed"] else "FAIL") for item in checks[-4:]]
    duplicate_slide(frames, index, render_verdict_slide, journey_num=20,
                    title="Production preparation and host authorization", verdict="PASS" if passed else "FAIL",
                    criteria_results=rows, metrics=metrics)
    video = DIRECTORY / "videos" / f"production-governance-{BATCH}.mp4"
    video.parent.mkdir()
    command("ffmpeg", "-y", "-framerate", "10", "-i", str(frames / "frame_%05d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", str(video))
    artifacts.append(video)
    manifest = {"batchId": BATCH, "passed": passed, "projectRoot": str(PILOT), "workspaceRoot": str(candidate),
                "binary": installed, "modelSelection": "Existing production configuration; no model override",
                "scenarios": scenarios, "checks": checks, "diagnostic": diagnostic,
                "metrics": {"harnessTokensAbsolute": None, "harnessTokensPercent": None, "status": "UNAVAILABLE"},
                "limitations": ["Remote model payloads and call counts are not independently captured in this live journey; controlled production integration tests verify those properties.",
                                "A comment-only candidate does not demonstrate semantic promotion approval.",
                                "The native command palette is exercised here; other interaction capabilities remain covered by the preceding automated integration suites."],
                "artifacts": [{"path": str(path.relative_to(ROOT)), "sha256": sha(path)} for path in artifacts]}
    manifest_path = DIRECTORY / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    report = PILOT / "evaluation" / f"production-governance-{BATCH}.md"
    report.parent.mkdir(exist_ok=True)
    lines = [f"# Production governance E2E — {BATCH}", "", f"Result: {'PASS' if passed else 'FAIL'}", "",
             f"Project: `{PILOT}`", f"Candidate workspace: `{candidate}`", f"Binary: `{installed}`", "",
             "The global distribution runs the native agent against the selected production model. Request confirmation, tool authorization and promotion are independent.", "",
             "| Assertion | Result |", "|---|---|"]
    lines += [f"| {item['name']} | {'PASS' if item['passed'] else 'FAIL'} |" for item in checks]
    lines += ["", "Harness token overhead: unavailable in absolute and percentage values; no attribution baseline was measured.", "",
              "Prompts and observations are preserved in the batch manifest. The origin was compared against its initial application and contract hashes.", "",
              *[f"- {value}" for value in manifest["limitations"]], "", f"Diagnostic: {diagnostic or '(none)'}"]
    report.write_text("\n".join(lines) + "\n")
    # Preserve previous reports and batches. Synchronize only this batch's immutable artifacts.
    downloads = Path("/mnt/c/Users/clayt/Downloads/bsh")
    if downloads.parent.exists():
        downloads.mkdir(exist_ok=True)
        for source in [*artifacts, report, manifest_path]:
            destination = downloads / source.name if source != manifest_path else downloads / f"manifest-{BATCH}.json"
            shutil.copy2(source, destination)
            if sha(source) != sha(destination):
                raise RuntimeError(f"Synchronization hash mismatch: {source.name}")
    print(f"Production E2E {'PASS' if passed else 'FAIL'}; manifest: {manifest_path}")
    print(f"Harness tokens: unavailable (absolute and percentage). {diagnostic or ''}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
