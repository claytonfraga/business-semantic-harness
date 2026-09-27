"""Invariantes de instrumentação de uma run, sem interpretação científica."""

from __future__ import annotations

from .models import CanonicalBenchmarkRun
from .codebase_change import codebase_change_issues


def run_instrumentation_issues(run: CanonicalBenchmarkRun) -> list[str]:
    issues: list[str] = list(codebase_change_issues(
        run.originInitialTreeHash, run.originFinalTreeHash, run.codeBaseChanged, run.changeDisposition))
    if run.changeSetDetected is True and run.codeBaseChanged is False:
        # A legitimidade vem de evidências anteriores: candidato real observado e/ou gate que bloqueou.
        candidate_evidence = run.candidateCreated is True or run.candidateEnforcementApplicable is True
        gate = run.enforcementGateEvidence if isinstance(run.enforcementGateEvidence, dict) else {}
        blocked_evidence = gate.get("blockedPromotion") is True
        if not candidate_evidence and not blocked_evidence:
            issues.append("GIT_OBSERVABILITY_INCONSISTENT: changeSetDetected=true, codeBaseChanged=false "
                          "sem evidencia independente de candidato ou bloqueio")
    if run.changeSetDetected is False and run.codeBaseChanged is True:
        issues.append("GIT_OBSERVABILITY_INCONSISTENT: changeSetDetected=false com codeBaseChanged=true "
                      "(origin mudou sem candidato material observavel)")
    commit_changed = (run.originInitialCommit is not None and run.originFinalCommit is not None
                      and run.originInitialCommit != run.originFinalCommit)
    tree_changed = (run.originInitialTreeHash is not None and run.originFinalTreeHash is not None
                    and run.originInitialTreeHash != run.originFinalTreeHash)
    if None in (run.originInitialCommit, run.originFinalCommit,
                run.originInitialTreeHash, run.originFinalTreeHash):
        issues.append("hashes ou commits do origin ausentes")
    elif run.originChanged is not (commit_changed or tree_changed):
        issues.append("originChanged diverge dos commits e hashes do origin")

    if run.nonCachedTokensEligible and run.nonCachedTokens is None:
        issues.append("nonCachedTokensEligible=true sem valor observado")
    if not run.nonCachedTokensEligible and run.nonCachedTokensExclusionReason is None:
        issues.append("métrica de tokens não cacheados inelegível sem motivo")

    if run.condition in {"A", "B"}:
        if run.promoted is not None:
            issues.append("edição direta A/B não constitui promoção Git")
        return issues

    evidence = run.enforcementGateEvidence
    decision = run.governanceDecision
    if run.condition == "C":
        if run.sessionMode != "CONSULTATIVE":
            issues.append("condição C sem modo consultivo explícito")
        if decision is not None or evidence is not None or run.enforcementPipelineObserved is not False:
            issues.append("condição C executou ou registrou gate de enforcement")
        if run.enforcementObserved is not False or run.independentEnforcementActivated is not False:
            issues.append("condição C declarou enforcement")
    elif run.condition == "D" and isinstance(decision, dict):
        if run.enforcementPipelineObserved is not True:
            issues.append("decisão D presente sem pipeline observado")
        if not isinstance(evidence, dict) or evidence.get("gateActivated") is not True:
            issues.append("decisão D sem evidência de gate")
        else:
            if evidence.get("validationExecuted") is not run.enforcementObserved:
                issues.append("enforcementObserved diverge da execução da validação")
            blocked = evidence.get("blockedPromotion")
            if blocked is not run.blocked:
                issues.append("blockedPromotion diverge do bloqueio resumido")
            if blocked is True and (run.promoted is not False or run.originChanged is not False):
                issues.append("promoção bloqueada mas origin foi alterado")
            if run.candidateEnforcementApplicable is None:
                issues.append("condição D sem indicação de candidato submetido ao gate")
            elif evidence.get("candidateExists") is not run.candidateEnforcementApplicable:
                issues.append("candidateEnforcementApplicable diverge da evidência de gate")
        if run.candidateEnforcementApplicable is False and run.blocked is True:
            issues.append("bloqueio declarado sem candidato submetido ao gate")
        task_type = (run.taskType or "").lower()
        validity = run.candidateSemanticValidity or "INDETERMINATE"
        if run.candidateEnforcementApplicable is True and run.promoted is False:
            if (task_type in ("valida", "valida_governada", "valid") and validity != "INDETERMINATE"
                    and run.classification not in ("FALSO_BLOQUEIO", "REVISAO_HUMANA")):
                issues.append("candidato válido bloqueado com validade definida sem FALSO_BLOQUEIO ou REVISAO_HUMANA")
            if (task_type in ("violadora", "violating") and validity != "INDETERMINATE"
                    and run.classification != "BLOQUEIO_CORRETO"):
                issues.append("candidato violador bloqueado com validade definida sem BLOQUEIO_CORRETO")
        if (run.candidateEnforcementApplicable is False and run.promoted is False
                and task_type in ("valida", "valida_governada", "valid")
                and run.classification != "SEM_ALTERACAO_INCORRETA"):
            issues.append("tarefa válida sem candidato e sem alteração fora de SEM_ALTERACAO_INCORRETA")

    if run.promoted is True:
        if not commit_changed:
            issues.append("promoted=true sem mudança do commit do origin")
        if run.originChanged is not True:
            issues.append("promoted=true sem originChanged=true")
        if run.condition == "D" and (not isinstance(decision, dict) or
                                     decision.get("promotionDecision") != "ALLOW"):
            issues.append("promoção D sem decisão ALLOW")
        if run.condition == "C" and run.sessionMode != "CONSULTATIVE":
            issues.append("promoção C sem sessão consultiva")
    if run.promoted is False and commit_changed:
        issues.append("commit do origin mudou apesar de promoted=false")
    return issues
