"""Regressões Given/When/Then da observabilidade de mudança no código-base (agente-agnóstica)."""

import unittest

from benchmark.core.codebase_change import (
    codebase_change_issues, compute_change_disposition, compute_code_base_changed,
    compute_enforcement_outcome_observed, is_experimental_codebase_path,
)


class CodeBaseChangeRegression(unittest.TestCase):
    def test_Given_equal_tree_hashes_When_computed_Then_false(self):
        """opencode: Given equal trees, When computed, Then codeBaseChanged is false."""
        self.assertFalse(compute_code_base_changed("a", "a"))

    def test_Given_different_tree_hashes_When_computed_Then_true(self):
        """opencode: Given different trees, When computed, Then codeBaseChanged is true."""
        self.assertTrue(compute_code_base_changed("a", "b"))

    def test_Given_missing_tree_hash_When_computed_Then_null(self):
        """opencode: Given a missing tree hash, When computed, Then codeBaseChanged is null."""
        self.assertIsNone(compute_code_base_changed(None, "b"))
        self.assertIsNone(compute_code_base_changed("a", None))

    def test_Given_five_scenarios_When_disposition_Then_correct(self):
        """opencode: Given the five candidate/origin scenarios, When disposition, Then correct."""
        # nenhum candidato
        self.assertEqual(compute_change_disposition(False, False, False), "NO_CHANGE_PRODUCED")
        # candidato tecnico sem alteracao material (changeSetDetected=false)
        self.assertEqual(compute_change_disposition(False, False, False), "NO_CHANGE_PRODUCED")
        # candidato material bloqueado
        self.assertEqual(compute_change_disposition(True, True, False), "CHANGE_BLOCKED")
        # candidato material nao aplicado
        self.assertEqual(compute_change_disposition(True, False, False), "CHANGE_PRODUCED_NOT_APPLIED")
        # alteracao aplicada
        self.assertEqual(compute_change_disposition(True, False, True), "CHANGE_APPLIED")

    def test_Given_insufficient_evidence_When_disposition_Then_indeterminate(self):
        """opencode: Given insufficient evidence, When disposition, Then INDETERMINATE."""
        self.assertEqual(compute_change_disposition(None, None, None), "INDETERMINATE")

    def test_Given_promoted_null_but_trees_differ_When_disposition_Then_change_applied(self):
        """opencode: Given promoted null and different trees, When disposition, Then CHANGE_APPLIED."""
        self.assertTrue(compute_code_base_changed("initial", "final"))
        self.assertEqual(compute_change_disposition(False, None, True), "CHANGE_APPLIED")

    def test_Given_same_git_state_across_agents_When_disposition_Then_identical(self):
        """opencode: Given the same Git state, When disposition, Then identical across agents."""
        for _agent in ("opencode", "codex", "agy"):
            self.assertEqual(compute_change_disposition(True, True, False), "CHANGE_BLOCKED")
            self.assertTrue(compute_code_base_changed("a", "b"))

    def test_Given_enforcement_outcomes_When_computed_Then_observational_label(self):
        """opencode: Given candidate applicability, When computed, Then the outcome is labelled."""
        self.assertEqual(compute_enforcement_outcome_observed("A", False, None, None), "NOT_APPLICABLE")
        self.assertEqual(compute_enforcement_outcome_observed("D", False, "CONFORMING", "ALLOW"), "NOT_TRIGGERED")
        self.assertEqual(compute_enforcement_outcome_observed("D", None, "CONFORMING", "ALLOW"), "NOT_TRIGGERED")
        self.assertEqual(compute_enforcement_outcome_observed("D", True, "CONFORMING", "ALLOW"), "ALLOW")
        self.assertEqual(compute_enforcement_outcome_observed("D", True, "VIOLATION", "DENY"), "DENY")
        self.assertEqual(compute_enforcement_outcome_observed("D", True, "INDETERMINATE", "DENY"), "INDETERMINATE")
        self.assertEqual(compute_enforcement_outcome_observed("D", True, "VALIDATION_ERROR", "DENY"), "VALIDATION_ERROR")

    def test_Given_paths_When_classified_Then_only_experimental_codebase_paths_are_relevant(self):
        """opencode: Given file paths, When classified, Then only source-relevant paths count."""
        self.assertTrue(is_experimental_codebase_path("src/assets/domain/asset.ts"))
        self.assertTrue(is_experimental_codebase_path("test/server.test.mjs"))
        self.assertFalse(is_experimental_codebase_path("dist/server.js"))
        self.assertFalse(is_experimental_codebase_path("coverage/index.html"))
        self.assertFalse(is_experimental_codebase_path("node_modules/pkg/index.js"))
        self.assertFalse(is_experimental_codebase_path(".venv/lib/python/site.py"))
        self.assertFalse(is_experimental_codebase_path("__pycache__/x.pyc"))
        self.assertFalse(is_experimental_codebase_path(".bsh/local/session.jsonl"))


class CodeBaseChangeInvariantRegression(unittest.TestCase):
    def test_Given_contradictory_codebase_change_When_validated_Then_rejected(self):
        """opencode: Given codeBaseChanged true with equal hashes, When validated, Then rejected."""
        self.assertTrue(any("codeBaseChanged" in issue
                            for issue in codebase_change_issues("a", "a", True, "CHANGE_APPLIED")))

    def test_Given_blocked_with_codebase_change_When_validated_Then_rejected(self):
        """opencode: Given CHANGE_BLOCKED with codeBaseChanged true, When validated, Then rejected."""
        self.assertTrue(any("CHANGE_BLOCKED" in issue
                            for issue in codebase_change_issues("a", "b", True, "CHANGE_BLOCKED")))

    def test_Given_applied_without_codebase_change_When_validated_Then_rejected(self):
        """opencode: Given CHANGE_APPLIED with codeBaseChanged false, When validated, Then rejected."""
        self.assertTrue(any("CHANGE_APPLIED" in issue
                            for issue in codebase_change_issues("a", "a", False, "CHANGE_APPLIED")))

    def test_Given_consistent_record_When_validated_Then_no_issues(self):
        """opencode: Given a consistent record, When validated, Then no issues."""
        self.assertEqual(codebase_change_issues("a", "b", True, "CHANGE_APPLIED"), [])
        self.assertEqual(codebase_change_issues("a", "a", False, "NO_CHANGE_PRODUCED"), [])

    def test_Given_auditable_divergence_When_invariants_Then_allowed(self):
        """opencode: Given independent evidence of candidate/block, When invariants, Then allowed."""
        from benchmark.core.models import CanonicalBenchmarkRun
        from benchmark.core.run_invariants import run_instrumentation_issues
        run = CanonicalBenchmarkRun(
            runId="001-G1-D", batchId="fixture", taskId="G1", baseTaskId="G1", condition="D",
            agent="opencode", changeSetDetected=True, codeBaseChanged=False,
            originInitialTreeHash="x", originFinalTreeHash="x", changeDisposition="CHANGE_BLOCKED",
            candidateEnforcementApplicable=True,
            enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True},
            nonCachedTokensEligible=False, nonCachedTokensExclusionReason="runtime sem metrica")
        issues = run_instrumentation_issues(run)
        self.assertFalse(any("GIT_OBSERVABILITY_INCONSISTENT" in issue for issue in issues))

    def test_Given_divergence_without_independent_evidence_When_invariants_Then_inconsistent(self):
        """opencode: Given divergence without independent evidence, When invariants, Then inconsistent."""
        from benchmark.core.models import CanonicalBenchmarkRun
        from benchmark.core.run_invariants import run_instrumentation_issues
        run = CanonicalBenchmarkRun(
            runId="001-G1-D", batchId="fixture", taskId="G1", baseTaskId="G1", condition="D",
            agent="opencode", changeSetDetected=True, codeBaseChanged=False,
            originInitialTreeHash="x", originFinalTreeHash="x", changeDisposition="CHANGE_BLOCKED",
            candidateEnforcementApplicable=False, candidateCreated=False,
            nonCachedTokensEligible=False, nonCachedTokensExclusionReason="runtime sem metrica")
        issues = run_instrumentation_issues(run)
        self.assertTrue(any("GIT_OBSERVABILITY_INCONSISTENT" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()
