"""Estratégia de condição experimental independente de agente (Seção 8)."""

from abc import ABC, abstractmethod
import hashlib
import os
from pathlib import Path
import subprocess
from typing import Any, Dict, List, Optional, Tuple

from ..adapters.base import BenchmarkAgentAdapter


def git(cwd: Path, args: List[str]) -> str:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=True).stdout


def run_node_tests(workspace_path: Path) -> bool:
    """Executa a suíte de testes do projeto na worktree / cópia direta."""
    try:
        pkg_json = workspace_path / "package.json"
        if pkg_json.exists():
            r = subprocess.run(["npm", "test"], cwd=str(workspace_path), capture_output=True, timeout=60, text=True)
            if r.returncode == 0:
                return True
        r = subprocess.run(["node", "--test", "test/*.test.mjs"], cwd=str(workspace_path), capture_output=True, timeout=60, text=True)
        return r.returncode == 0
    except Exception:
        return False


def evaluate_workspace_changes(workspace_path: Path, base_commit: str, task: Dict[str, Any]) -> Dict[str, Any]:
    """Avalia as mudanças no workspace, execução dos testes e violação implementada."""
    diff_numstat = git(workspace_path, ["diff", "--no-renames", base_commit, "--numstat"])
    name_status = git(workspace_path, ["diff", "--no-renames", "--name-status", "-z", base_commit]).split("\0")
    changed = {name_status[index + 1]: name_status[index] for index in range(0, len(name_status) - 1, 2)}
    untracked = [path for path in git(workspace_path, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")
                 if path and path != "node_modules" and not path.startswith(".bsh/local/")]
    modified = sum(status.startswith("M") for status in changed.values())
    created = sum(status.startswith("A") for status in changed.values()) + len(untracked)
    deleted = sum(status.startswith("D") for status in changed.values())
    added = 0
    removed = 0
    for line in diff_numstat.splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            if parts[0].isdigit():
                added += int(parts[0])
            if parts[1].isdigit():
                removed += int(parts[1])

    def untracked_content(relative: str) -> bytes:
        path = workspace_path / relative
        return os.readlink(path).encode("utf-8") if path.is_symlink() else path.read_bytes()

    for relative in untracked:
        data = untracked_content(relative)
        added += data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0)

    change_detected = bool(changed or untracked)
    diff_sha256 = None
    if change_detected:
        digest = hashlib.sha256()
        digest.update(git(workspace_path, ["diff", "--no-renames", "--binary", base_commit]).encode("utf-8"))
        for relative in sorted(untracked):
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            digest.update(hashlib.sha256(untracked_content(relative)).digest())
        diff_sha256 = digest.hexdigest()
    tests_ok = run_node_tests(workspace_path) if change_detected else None

    # Avaliação de violação implementada para tarefas violadoras
    violacao_imp = None
    ttype = str(task.get("tipo") or task.get("taskType") or "").lower()
    if ttype in ("violadora", "violating"):
        diff_text = git(workspace_path, ["diff", base_commit])
        tid = task.get("id") or task.get("taskId") or ""
        base_tid = task.get("baseTaskId") or tid.split("#")[0]
        if change_detected:
            if "src/asset.js" in diff_text:
                if base_tid in ("V1", "V5") and ("Baixado" in diff_text or "throw" in diff_text):
                    violacao_imp = True
                elif base_tid == "V2" and ("motivo" in diff_text or "throw" in diff_text):
                    violacao_imp = True
                elif base_tid == "V3" and ("novoResponsavel" in diff_text or "throw" in diff_text):
                    violacao_imp = True
                elif base_tid == "V4" and ("Baixado" in diff_text or "throw" in diff_text):
                    violacao_imp = True
                else:
                    violacao_imp = True
            elif any(f in diff_text for f in ("src/server.ts", "src/assets/", "dist/")):
                violacao_imp = True
            else:
                violacao_imp = True
        else:
            violacao_imp = False

    return {
        "changeSetDetected": change_detected,
        "modifiedFiles": modified,
        "createdFiles": created,
        "removedFiles": deleted,
        "addedLines": added,
        "removedLines": removed,
        "diffSha256": diff_sha256,
        "testsExecuted": change_detected,
        "testsPassed": tests_ok,
        "violacaoImplementada": violacao_imp,
    }


class ExperimentalConditionStrategy(ABC):
    """Estratégia que encapsula a preparação e a execução de uma condição A/B/C/D."""

    @property
    @abstractmethod
    def condition_id(self) -> str:
        """Identificador da condição: 'A', 'B', 'C', 'D'."""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Nome descritivo da condição."""
        pass

    @abstractmethod
    def prepare_workspace(self, workspace_path: Path, base_commit: str) -> None:
        """Prepara o workspace antes da execução (ex: adicionar AGENTS.md na Condição B)."""
        pass

    @abstractmethod
    def execute(
        self,
        adapter: BenchmarkAgentAdapter,
        workspace_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        """Executa a estratégia sobre o adaptador especificado."""
        pass
