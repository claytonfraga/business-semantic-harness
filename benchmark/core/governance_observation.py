"""Collect BSH governance evidence from exactly one session in a run workspace."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


SEMANTIC_TO_LEGACY = {
    "CONFORMING": "conforme",
    "VIOLATION": "violacao",
    "INDETERMINATE": "indeterminado",
    "VALIDATION_ERROR": "erro_validacao",
}


def _read_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} não contém objeto JSON")
    return value


def _bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _base(status: str, reason: str | None = None) -> dict[str, Any]:
    return {
        "evidenceCollectionStatus": status, "evidenceCollectionIssue": reason,
        "sessionId": None, "sessionReportSource": None, "governanceDecisionSource": None,
        "governanceDecisionSha256": None, "enforcementEvidence": None,
        "ontologyQueried": None, "reportConflictCalled": None, "queryCount": None,
        "promoted": None, "originChanged": None, "blocked": None,
        "statusEnforcement": None, "validationStatus": None,
        "enforcementObserved": None, "enforcementPipelineObserved": None,
        "technicalGatesPassed": None, "identifiedOperation": None,
        "identifiedShapes": None, "candidateEnforcementApplicable": None,
        "independentEnforcementActivated": None, "enforcementGateEvidence": None,
    }


def _tool_observations(local: Path) -> tuple[bool | None, bool | None, int | None]:
    logs = sorted(local.glob("session-*.jsonl"))
    if len(logs) != 1:
        return None, None, None
    queries = 0
    conflict = False
    completed_turns = 0
    try:
        for line in logs[0].read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            if not isinstance(entry, dict):
                raise ValueError("entrada de log inválida")
            if entry.get("event") == "turn-completed" and entry.get("status") == "completed":
                completed_turns += 1
            if entry.get("event") != "item-completed" or entry.get("itemType") != "mcpToolCall":
                continue
            if entry.get("tool") == "bsh_query_ontology":
                queries += 1
            if entry.get("tool") == "bsh_report_conflict":
                conflict = True
    except (ValueError, UnicodeError):
        return None, None, None
    if completed_turns == 0:
        return None, None, None
    return queries > 0, conflict, queries


def collect_governance_observation(project_path: Path) -> dict[str, Any]:
    """Keep absence distinct from false; never select evidence by filename order."""
    local = Path(project_path) / ".bsh" / "local"
    reports = sorted((local / "sessions").glob("*.report.json"))
    decisions = sorted((local / "enforcement").glob("*.json"))
    if not reports:
        return _base("INVALID", "decisão sem relatório de sessão") if decisions else _base("MISSING")
    if len(reports) != 1:
        return _base("INVALID", "múltiplos relatórios de sessão no workspace da run")
    report_path = reports[0]
    session_id = report_path.name.removesuffix(".report.json")
    decision_path = local / "enforcement" / f"{session_id}.json"
    if any(path != decision_path for path in decisions):
        return _base("INVALID", "decisão de outra sessão no workspace da run")
    try:
        report = _read_object(report_path)
        decision = _read_object(decision_path) if decision_path.is_file() else None
    except (ValueError, UnicodeError, OSError) as error:
        return _base("INVALID", str(error))
    promoted = _bool(report.get("promovido"))
    origin_changed = _bool(report.get("origemAlterada"))
    if decision is not None:
        semantic_status = decision.get("validationStatus")
        if semantic_status not in SEMANTIC_TO_LEGACY:
            return _base("INVALID", "validationStatus inválido ou ausente")
        selected = decision.get("selectedShapes")
        executed_shapes = decision.get("executedShapes")
        if not isinstance(selected, list) or not isinstance(executed_shapes, list) or not all(
            isinstance(shape, str) for shape in (*selected, *executed_shapes)
        ):
            return _base("INVALID", "shapes selecionados ou executados sem estrutura válida")
        if decision.get("validationComplete") is True and (
            decision.get("validationExecuted") is not True or not set(selected).issubset(set(executed_shapes))
        ):
            return _base("INVALID", "validação declarada completa com shape não executado")
        if semantic_status == "CONFORMING" and not all((
            decision.get("validationExecuted") is True,
            decision.get("validationComplete") is True,
            decision.get("policyDecision") == "ALLOW",
            decision.get("promotionDecision") == "ALLOW",
            isinstance(decision.get("candidateFingerprint"), str),
        )):
            return _base("INVALID", "conformidade declarada sem autorização ou validação completa")
        if report.get("validationStatus") not in (None, semantic_status):
            return _base("INVALID", "status do relatório diverge da decisão")
        if report.get("candidateFingerprint") not in (None, decision.get("candidateFingerprint")):
            return _base("INVALID", "fingerprint do relatório diverge da decisão")
        if _bool(decision.get("originChanged")) not in (None, origin_changed):
            return _base("INVALID", "alteração do origin diverge da decisão")
        if decision.get("promotionDecision") == "ALLOW" and semantic_status != "CONFORMING":
            return _base("INVALID", "promoção autorizada sem conformidade")
        if promoted is True and decision.get("promotionDecision") != "ALLOW":
            return _base("INVALID", "promoção observada com decisão não permissiva")
    ontology_queried, conflict_called, query_count = _tool_observations(local)
    observed = _base("VALID" if decision is not None else "MISSING")
    observed.update({
        "sessionId": session_id,
        "sessionReportSource": str(report_path.relative_to(project_path)),
        "governanceDecisionSource": str(decision_path.relative_to(project_path)) if decision else None,
        "governanceDecisionSha256": hashlib.sha256(decision_path.read_bytes()).hexdigest() if decision else None,
        "enforcementEvidence": decision,
        "ontologyQueried": ontology_queried, "reportConflictCalled": conflict_called,
        "queryCount": query_count,
        "promoted": promoted, "originChanged": origin_changed,
        "blocked": _bool(report.get("bloqueado")),
        "technicalGatesPassed": _bool(report.get("gatesAprovados")),
    })
    if decision is None:
        return observed
    operations = decision.get("recognizedOperation")
    selected = decision.get("selectedShapes")
    if not isinstance(operations, list) or not isinstance(selected, list):
        return _base("INVALID", "reconhecimento ou shapes sem estrutura válida")
    status = decision["validationStatus"]
    executed = _bool(decision.get("validationExecuted"))
    complete = _bool(decision.get("validationComplete"))
    gate_denied = decision.get("promotionDecision") == "DENY"
    gate_evidence = {
        "gateActivated": gate_denied,
        "blockedPromotion": gate_denied and promoted is False and origin_changed is False,
        "validationExecuted": executed, "validationComplete": complete,
        "policyDecision": decision.get("policyDecision"),
        "promotionDecision": decision.get("promotionDecision"),
        "candidateFingerprint": decision.get("candidateFingerprint"),
        "decisionSource": observed["governanceDecisionSource"],
    }
    observed.update({
        "statusEnforcement": SEMANTIC_TO_LEGACY[status],
        "validationStatus": status, "enforcementObserved": executed,
        "enforcementPipelineObserved": executed,
        "identifiedOperation": operations[0] if len(operations) == 1 else None,
        "identifiedShapes": selected,
        "candidateEnforcementApplicable": bool(operations) if operations else None,
        "independentEnforcementActivated": None if conflict_called is None or promoted is None or origin_changed is None else all((
            status == "VIOLATION", executed is True, complete is True,
            decision.get("policyDecision") == "DENY", gate_evidence["blockedPromotion"],
            isinstance(decision.get("candidateFingerprint"), str),
            conflict_called is False,
        )),
        "enforcementGateEvidence": gate_evidence,
    })
    return observed
