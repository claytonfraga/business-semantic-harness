"""Observabilidade agente-agnóstica de mudança no código-base experimental.

Este módulo é a fonte canônica para decidir, sem inferência semântica, se a alteração
produzida durante uma run chegou ou não ao código-base, usando os hashes de árvore Git.
Independente de agente, modelo e domínio.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Optional

CHANGE_DISPOSITIONS = (
    "NO_CHANGE_PRODUCED", "CHANGE_PRODUCED_NOT_APPLIED", "CHANGE_BLOCKED",
    "CHANGE_APPLIED", "INDETERMINATE",
)

ENFORCEMENT_OUTCOMES = (
    "NOT_APPLICABLE", "NOT_TRIGGERED", "ALLOW", "DENY", "INDETERMINATE", "VALIDATION_ERROR",
)

# Universo único do "código-base experimental": diretórios derivados/temporários ficam fora,
# e as duas métricas (changeSetDetected e codeBaseChanged) observam exatamente este universo.
EXPERIMENTAL_CODEBASE_IGNORE = (".git", "node_modules", "dist", "coverage", "__pycache__", ".venv")


def is_experimental_codebase_path(path: str) -> bool:
    """True se o caminho pertence ao código-base experimental (fonte/artefatos versionáveis relevantes)."""
    normalized = path.replace("\\", "/")
    if normalized.startswith(".bsh/local/") or normalized == ".bsh/local":
        return False
    first = normalized.split("/", 1)[0]
    return first not in EXPERIMENTAL_CODEBASE_IGNORE


def compute_codebase_tree_hash(directory) -> Optional[str]:
    """Hash de conteúdo do código-base experimental, usando a MESMA definição de universo acima."""
    root = Path(directory)
    if not root.is_dir():
        return None
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if not is_experimental_codebase_path(rel):
            continue
        data = path.read_bytes()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(data)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(data)
    return digest.hexdigest()


def compute_code_base_changed(origin_initial_tree_hash: Optional[str],
                              origin_final_tree_hash: Optional[str]) -> Optional[bool]:
    """codeBaseChanged = originInitialTreeHash != originFinalTreeHash quando ambos existem; senão None."""
    if origin_initial_tree_hash is None or origin_final_tree_hash is None:
        return None
    return origin_initial_tree_hash != origin_final_tree_hash


def compute_change_disposition(change_set_detected: Optional[bool], blocked: Optional[bool],
                               code_base_changed: Optional[bool]) -> str:
    """Classificação observacional do processamento, a partir das evidências já determinadas."""
    if change_set_detected is None or code_base_changed is None:
        return "INDETERMINATE"
    if code_base_changed is True:
        return "CHANGE_APPLIED"
    if change_set_detected is False:
        return "NO_CHANGE_PRODUCED"
    if change_set_detected is True and blocked is True:
        return "CHANGE_BLOCKED"
    if change_set_detected is True:
        return "CHANGE_PRODUCED_NOT_APPLIED"
    return "INDETERMINATE"


def compute_enforcement_outcome_observed(condition: str, candidate_enforcement_applicable: Optional[bool],
                                         validation_status: Optional[str],
                                         promotion_decision: Optional[str]) -> str:
    """Descreve o enforcement efetivamente aplicado a um candidato; o pipeline sem candidato não conta.

    candidateEnforcementApplicable é a fonte canônica de existência/aplicabilidade do candidato.
    """
    if condition in ("A", "B"):
        return "NOT_APPLICABLE"
    if candidate_enforcement_applicable is not True:
        return "NOT_TRIGGERED"
    if validation_status == "VALIDATION_ERROR":
        return "VALIDATION_ERROR"
    if validation_status == "INDETERMINATE":
        return "INDETERMINATE"
    if promotion_decision == "ALLOW":
        return "ALLOW"
    if promotion_decision == "DENY":
        return "DENY"
    return "INDETERMINATE"


def codebase_change_issues(origin_initial_tree_hash: Optional[str], origin_final_tree_hash: Optional[str],
                           code_base_changed: Optional[bool], change_disposition: Optional[str]) -> list[str]:
    """Invariantes de consistência entre hashes Git, codeBaseChanged e changeDisposition."""
    issues: list[str] = []
    if origin_initial_tree_hash is not None and origin_final_tree_hash is not None:
        expected = origin_initial_tree_hash != origin_final_tree_hash
        if code_base_changed is None:
            issues.append("codeBaseChanged ausente apesar de hashes de árvore disponíveis")
        elif code_base_changed is not expected:
            issues.append("codeBaseChanged diverge dos hashes de árvore do origin")
    if code_base_changed is True and change_disposition != "CHANGE_APPLIED":
        issues.append("codeBaseChanged=true exige changeDisposition=CHANGE_APPLIED")
    if change_disposition == "CHANGE_APPLIED" and code_base_changed is not True:
        issues.append("changeDisposition=CHANGE_APPLIED exige codeBaseChanged=true")
    if change_disposition == "CHANGE_BLOCKED" and code_base_changed is True:
        issues.append("changeDisposition=CHANGE_BLOCKED não admite codeBaseChanged=true")
    if change_disposition == "NO_CHANGE_PRODUCED" and code_base_changed is True:
        issues.append("changeDisposition=NO_CHANGE_PRODUCED não admite codeBaseChanged=true")
    return issues
