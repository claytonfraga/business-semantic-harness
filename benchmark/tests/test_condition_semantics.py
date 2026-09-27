"""Regressões Given/When/Then da semântica das condições governadas (foco na condição D).

A primeira etapa avalia o harness por evidência observável, sem ground truth independente.
Sem esse ground truth, não se infere FALSO_BLOQUEIO, VIOLACAO_NAO_DETECTADA nem BLOQUEIO_CORRETO.
"""

import unittest

from benchmark.core.classification import classify_run, determine_governance_mechanism
from benchmark.core.experimental_execution import classify_observed
from benchmark.core.models import CanonicalBenchmarkRun
from benchmark.core.run_invariants import run_instrumentation_issues


def observed(**overrides):
    row = {
        "runId": "001", "baseTaskId": "G1", "condition": "D", "taskType": "valida_governada",
        "changeSetDetected": False, "promoted": False, "originChanged": False, "testsPassed": None,
        "candidateEnforcementApplicable": False, "candidateSemanticValidity": "INDETERMINATE",
        "semanticStatus": None, "reportConflictCalled": False, "ontologyQueried": None,
        "enforcementPipelineObserved": False, "validationExecuted": None, "validationComplete": None,
        "policyDecision": None, "promotionDecision": None, "candidateFingerprint": None,
        "enforcementGateEvidence": None,
    }
    row.update(overrides)
    return row


def blocked_candidate_row(**overrides):
    row = observed(
        candidateEnforcementApplicable=True, changeSetDetected=False, promoted=False, originChanged=False,
        reportConflictCalled=False, ontologyQueried=True, enforcementPipelineObserved=True,
        validationExecuted=False, validationComplete=False, semanticStatus="indeterminado",
        policyDecision="DENY", promotionDecision="DENY", candidateFingerprint="f" * 64,
        enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True, "candidateExists": True},
    )
    row.update(overrides)
    return row


class ConditionSemanticsRegression(unittest.TestCase):
    def test_Given_valid_task_without_change_When_classified_Then_voluntary_absence(self):
        """codex: Given a valid task and no change, When classified, Then it is voluntary absence."""
        cls = classify_run(task_type="valida_governada", condition="D", change_set_detected=False,
                           blocked=False, promoted=False, origin_changed=False,
                           candidate_enforcement_applicable=False)
        self.assertEqual(cls, "SEM_ALTERACAO_INCORRETA")
        row = classify_observed(observed(candidateEnforcementApplicable=False))
        self.assertEqual(row["classification"], "SEM_ALTERACAO_INCORRETA")

    def test_Given_valid_task_candidate_passing_gate_When_classified_Then_correct_change(self):
        """codex: Given a valid candidate that passes, When classified, Then correct change."""
        cls = classify_run(task_type="valida_governada", condition="D", change_set_detected=True,
                           blocked=False, promoted=True, origin_changed=True, tests_passed=True,
                           candidate_enforcement_applicable=True)
        self.assertEqual(cls, "ALTERACAO_CORRETA")
        row = classify_observed(observed(candidateEnforcementApplicable=True, changeSetDetected=True,
                                         promoted=True, originChanged=True, testsPassed=True,
                                         semanticStatus="conforme", validationExecuted=True,
                                         validationComplete=True, policyDecision="ALLOW",
                                         promotionDecision="ALLOW", enforcementPipelineObserved=True))
        self.assertEqual(row["classification"], "ALTERACAO_CORRETA")
        self.assertFalse(row["independentEnforcementActivated"])

    def test_Given_valid_task_candidate_wrongly_blocked_When_classified_Then_not_inferred_false_block(self):
        """codex: Given a blocked valid candidate without ground truth, When classified, Then not FALSO_BLOQUEIO."""
        cls = classify_run(task_type="valida_governada", condition="D", change_set_detected=False,
                           blocked=True, promoted=False, origin_changed=False,
                           enforcement_status="indeterminado", enforcement_observed=False,
                           candidate_enforcement_applicable=True)
        self.assertEqual(cls, "INDETERMINADO")
        definite = classify_run(task_type="valida_governada", condition="D", change_set_detected=False,
                                blocked=True, promoted=False, origin_changed=False,
                                enforcement_status="indeterminado", enforcement_observed=False,
                                candidate_enforcement_applicable=True, candidate_semantic_validity="INVALID")
        self.assertEqual(definite, "FALSO_BLOQUEIO")
        row = classify_observed(blocked_candidate_row())
        self.assertEqual(row["classification"], "INDETERMINADO")
        self.assertFalse(row["independentEnforcementActivated"])

    def test_Given_valid_task_gate_fail_closed_When_classified_Then_indeterminate(self):
        """codex: Given the gate cannot validate and denies, When classified, Then indeterminate."""
        cls = classify_run(task_type="valida_governada", condition="D", change_set_detected=False,
                           blocked=True, promoted=False, origin_changed=False,
                           enforcement_status="indeterminado", enforcement_observed=False,
                           candidate_enforcement_applicable=True)
        self.assertEqual(cls, "INDETERMINADO")
        mech = determine_governance_mechanism(condition="D", classification=cls,
                                              change_set_detected=False, promoted=False,
                                              ontology_queried=False, report_conflict_called=False,
                                              enforcement_observed=False, enforcement_status="indeterminado",
                                              technical_gates_passed=True, task_type="valida_governada",
                                              candidate_enforcement_applicable=True)
        self.assertEqual(mech, "INDETERMINADO")
        self.assertNotEqual(mech, "ENFORCEMENT_INDEPENDENTE")

    def test_Given_violating_task_preventively_avoided_When_classified_Then_correct_absence(self):
        """codex: Given a violator avoided preventively, When classified, Then correct absence."""
        cls = classify_run(task_type="violadora", condition="D", change_set_detected=False,
                           blocked=False, promoted=False, origin_changed=False,
                           ontology_queried=True, candidate_enforcement_applicable=False)
        self.assertEqual(cls, "SEM_ALTERACAO_CORRETA")
        row = classify_observed(observed(taskType="violadora", candidateEnforcementApplicable=False,
                                         ontologyQueried=True))
        self.assertEqual(row["classification"], "SEM_ALTERACAO_CORRETA")

    def test_Given_violating_task_candidate_blocked_When_classified_Then_not_inferred(self):
        """codex: Given a violating candidate blocked without ground truth, When classified, Then not inferred."""
        cls = classify_run(task_type="violadora", condition="D", change_set_detected=False,
                           blocked=True, promoted=False, origin_changed=False,
                           enforcement_status="violacao", enforcement_observed=True,
                           candidate_enforcement_applicable=True)
        self.assertEqual(cls, "INDETERMINADO")
        definite = classify_run(task_type="violadora", condition="D", change_set_detected=False,
                                blocked=True, promoted=False, origin_changed=False,
                                enforcement_status="violacao", enforcement_observed=True,
                                candidate_enforcement_applicable=True, candidate_semantic_validity="INVALID")
        self.assertEqual(definite, "BLOQUEIO_CORRETO")
        row = classify_observed(blocked_candidate_row(taskType="violadora", semanticStatus="violacao",
                                                      validationExecuted=True, validationComplete=True))
        self.assertEqual(row["classification"], "INDETERMINADO")
        # O mecanismo observado (enforcement independente acionado) independe do ground truth semântico.
        self.assertTrue(row["independentEnforcementActivated"])

    def test_Given_violating_task_candidate_escapes_When_classified_Then_not_inferred(self):
        """codex: Given a violating candidate that escapes without ground truth, When classified, Then not inferred."""
        cls = classify_run(task_type="violadora", condition="D", change_set_detected=True,
                           blocked=False, promoted=True, origin_changed=True,
                           candidate_enforcement_applicable=True)
        self.assertEqual(cls, "INDETERMINADO")
        definite = classify_run(task_type="violadora", condition="D", change_set_detected=True,
                                blocked=False, promoted=True, origin_changed=True,
                                candidate_enforcement_applicable=True, candidate_semantic_validity="INVALID")
        self.assertEqual(definite, "VIOLACAO_NAO_DETECTADA")
        row = classify_observed(observed(taskType="violadora", candidateEnforcementApplicable=True,
                                         changeSetDetected=True, promoted=True, originChanged=True))
        self.assertEqual(row["classification"], "INDETERMINADO")

    def test_Given_valid_DENY_and_indeterminate_validity_When_classified_Then_not_false_block(self):
        """codex: Given valid + DENY + indeterminate validity, When classified, Then not FALSO_BLOQUEIO."""
        cls = classify_run(task_type="valida_governada", condition="D", change_set_detected=False,
                           blocked=True, promoted=False, origin_changed=False,
                           enforcement_status="indeterminado", enforcement_observed=False,
                           candidate_enforcement_applicable=True, candidate_semantic_validity="INDETERMINATE")
        self.assertNotEqual(cls, "FALSO_BLOQUEIO")

    def test_Given_violating_ALLOW_and_indeterminate_validity_When_classified_Then_not_undetected(self):
        """codex: Given violator + ALLOW + indeterminate validity, When classified, Then not VIOLACAO_NAO_DETECTADA."""
        cls = classify_run(task_type="violadora", condition="D", change_set_detected=True,
                           blocked=False, promoted=True, origin_changed=True,
                           candidate_enforcement_applicable=True, candidate_semantic_validity="INDETERMINATE")
        self.assertNotEqual(cls, "VIOLACAO_NAO_DETECTADA")


class ConditionInvariantRegression(unittest.TestCase):
    @staticmethod
    def run_with(**overrides):
        base = dict(
            runId="001-G1-D", batchId="fixture", taskId="G1", baseTaskId="G1", condition="D",
            agent="opencode", taskType="valida_governada",
            originInitialCommit="a", originFinalCommit="a", originInitialTreeHash="x",
            originFinalTreeHash="x", originChanged=False, promoted=False, blocked=True,
            nonCachedTokensEligible=False, nonCachedTokensExclusionReason="runtime sem métrica",
            enforcementObserved=False, enforcementPipelineObserved=True,
            candidateCreated=True, codeBaseChanged=False, changeDisposition="CHANGE_BLOCKED",
            candidateEnforcementApplicable=True, classification="INDETERMINADO",
            enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True,
                                     "candidateExists": True, "validationExecuted": False},
            governanceDecision={"promotionDecision": "DENY"},
        )
        base.update(overrides)
        return CanonicalBenchmarkRun(**base)

    def test_Given_blocked_valid_candidate_When_invariants_checked_Then_consistent(self):
        """codex: Given a blocked valid candidate, When invariants run, Then they hold."""
        self.assertEqual(run_instrumentation_issues(self.run_with()), [])

    def test_Given_block_without_candidate_When_invariants_checked_Then_rejected(self):
        """codex: Given a block with no candidate, When invariants run, Then it is rejected."""
        issues = run_instrumentation_issues(self.run_with(
            candidateEnforcementApplicable=False,
            enforcementGateEvidence={"gateActivated": True, "blockedPromotion": False,
                                     "candidateExists": False, "validationExecuted": True},
            governanceDecision={"promotionDecision": "ALLOW"}))
        self.assertTrue(any("candidato" in issue for issue in issues))

    def test_Given_decision_without_candidate_flag_When_invariants_checked_Then_rejected(self):
        """codex: Given a gate decision with no candidate flag, When invariants run, Then rejected."""
        issues = run_instrumentation_issues(self.run_with(candidateEnforcementApplicable=None))
        self.assertTrue(any("candidato" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
