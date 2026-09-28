"""Invariantes executáveis de execução/desfecho (contrato do relatório BSH).

Detecta combinações impossíveis (interrompe o indicador com os identificadores) e casos de
evidência insuficiente (limitação, sem inventar valor). Propriedades permanecem separadas.
"""

from __future__ import annotations

from typing import Any


class InvariantError(RuntimeError):
    pass


SITUACAO = {
    "OK": "concluida",
    "FALHA_TECNICA": "falha",
    "FALHA_INSTRUMENTACAO": "falha",
}


def run_situation(run: dict[str, Any]) -> str:
    status = str(run.get("executionStatus") or "").upper()
    if status in SITUACAO:
        return SITUACAO[status]
    if run.get("classification") in ("FALHA_TECNICA", "FALHA_INSTRUMENTACAO"):
        return "falha"
    return "desconhecida"


def _violation(issues: list[dict[str, Any]], run: dict[str, Any], rule: str, detail: str) -> None:
    issues.append({"runId": run.get("runId"), "condition": run.get("condition"), "rule": rule, "detail": detail})


def validate_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Valida invariantes. `violations` = combinações impossíveis; `limitations` = evidência insuficiente."""
    violations: list[dict[str, Any]] = []
    limitations: list[dict[str, Any]] = []

    for run in runs:
        if not run.get("runId"):
            _violation(violations, run, "identidade", "Run sem runId")
        if run.get("promoted") is True and run.get("codeBaseChanged") is False:
            _violation(violations, run, "promocao-sem-mudanca", "promoted=true com codeBaseChanged=false")
        if run.get("codeBaseChanged") is True and run.get("changeSetDetected") is False:
            _violation(violations, run, "origin-sem-candidato", "codeBaseChanged=true com changeSetDetected=false")
        if run.get("promotionDecision") == "ALLOW" and run.get("blocked") is True:
            _violation(violations, run, "allow-bloqueado", "promotionDecision=ALLOW com blocked=true")
        if run.get("candidateSemanticValidity") == "VALID" and not (
                run.get("candidateCreated") is True or run.get("candidateEnforcementApplicable") is True):
            _violation(violations, run, "validade-sem-candidato", "validade VALID sem candidato observado")
        if run.get("classification") == "FALSO_BLOQUEIO" and run.get("candidateSemanticValidity") != "VALID":
            _violation(violations, run, "falso-bloqueio-sem-validade", "FALSO_BLOQUEIO sem validade comprovada")
        if run.get("condition") == "C" and run.get("sessionMode") not in (None, "CONSULTATIVE"):
            _violation(violations, run, "condicao-c-nao-consultiva", "Condição C não é CONSULTATIVE")
        if run.get("testsExecuted") is False and run.get("testsPassed") is not None:
            _violation(violations, run, "teste-nao-executado-com-resultado", "testsPassed preenchido sem execução")
        if run.get("candidateEnforcementApplicable") is True and run.get("candidateCreated") is False \
                and run.get("changeSetDetected") is not True:
            limitations.append({"runId": run.get("runId"), "rule": "candidato-aplicavel-sem-materialidade",
                                "detail": "candidato aplicável sem mudança material observável"})
        if run.get("condition") in ("C", "D") and run.get("candidateSemanticValidity") in (None, "INDETERMINATE"):
            limitations.append({"runId": run.get("runId"), "rule": "validade-indeterminada",
                                "detail": "validade do candidato não verificada independentemente"})

    situacoes = [run_situation(run) for run in runs]
    reconciliacao = {
        "observadas": len(runs),
        "concluidas": sum(s == "concluida" for s in situacoes),
        "falhas": sum(s == "falha" for s in situacoes),
        "desconhecidas": sum(s == "desconhecida" for s in situacoes),
    }
    return {
        "status": "FAIL" if violations else "PASS",
        "violations": violations,
        "limitations": limitations,
        "reconciliacao": reconciliacao,
    }


def assert_consistent(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Interrompe com os identificadores quando há combinação impossível."""
    report = validate_runs(runs)
    if report["violations"]:
        ids = ", ".join(str(v["runId"]) for v in report["violations"])
        raise InvariantError("Invariantes violados (IDs: " + ids + "): " +
                             "; ".join(v["rule"] for v in report["violations"]))
    return report
