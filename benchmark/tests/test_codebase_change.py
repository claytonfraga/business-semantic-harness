"""Regressões Given/When/Then da observabilidade de mudança no código-base (agente-agnóstica)."""

import unittest

from benchmark.core.codebase_change import (
    codebase_change_issues, compute_change_disposition, compute_code_base_changed,
    compute_enforcement_outcome_observed,
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

    def test_Given_no_change_and_no_codebase_change_When_disposition_Then_no_change_produced(self):
        """opencode: Given no change and no codebase change, When disposition, Then NO_CHANGE_PRODUCED."""
        self.assertEqual(compute_change_disposition(False, False, False, False), "NO_CHANGE_PRODUCED")

    def test_Given_change_blocked_When_disposition_Then_change_blocked(self):
        """opencode: Given a produced candidate blocked, When disposition, Then CHANGE_BLOCKED."""
        self.assertEqual(compute_change_disposition(True, True, True, False), "CHANGE_BLOCKED")

    def test_Given_change_not_applied_without_block_When_disposition_Then_not_applied(self):
        """opencode: Given a produced candidate not applied, When disposition, Then CHANGE_PRODUCED_NOT_APPLIED."""
        self.assertEqual(compute_change_disposition(True, True, False, False), "CHANGE_PRODUCED_NOT_APPLIED")

    def test_Given_codebase_changed_When_disposition_Then_change_applied(self):
        """opencode: Given the codebase changed, When disposition, Then CHANGE_APPLIED."""
        self.assertEqual(compute_change_disposition(True, True, False, True), "CHANGE_APPLIED")

    def test_Given_insufficient_evidence_When_disposition_Then_indeterminate(self):
        """opencode: Given insufficient evidence, When disposition, Then INDETERMINATE."""
        self.assertEqual(compute_change_disposition(None, None, None, None), "INDETERMINATE")

    def test_Given_promoted_null_but_trees_differ_When_disposition_Then_change_applied(self):
        """opencode: Given promoted null and different trees, When disposition, Then CHANGE_APPLIED."""
        code_base_changed = compute_code_base_changed("initial", "final")
        self.assertTrue(code_base_changed)
        self.assertEqual(compute_change_disposition(False, None, None, code_base_changed), "CHANGE_APPLIED")

    def test_Given_candidate_structure_without_content_change_When_disposition_Then_not_applied_nor_blocked(self):
        """opencode: Given candidate commit/fingerprint without content change, When disposition, Then not applied nor blocked."""
        disposition = compute_change_disposition(False, False, False, False)
        self.assertEqual(disposition, "NO_CHANGE_PRODUCED")
        self.assertNotIn(disposition, ("CHANGE_APPLIED", "CHANGE_BLOCKED"))

    def test_Given_same_git_state_across_agents_When_disposition_Then_identical(self):
        """opencode: Given the same Git state, When disposition, Then identical across agents."""
        for _agent in ("opencode", "codex", "agy"):
            self.assertEqual(compute_change_disposition(True, True, True, False), "CHANGE_BLOCKED")
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

    def test_Given_pipeline_without_candidate_When_outcome_Then_not_triggered(self):
        """opencode: Given pipeline executed without candidate, When outcome, Then NOT_TRIGGERED."""
        for agent in ("opencode", "codex", "agy"):
            self.assertEqual(compute_enforcement_outcome_observed("D", False, "CONFORMING", "ALLOW"), "NOT_TRIGGERED")

    def test_Given_candidate_commit_without_created_When_evaluated_Then_candidate_is_not_inferred(self):
        """opencode: Given a candidateCommit without candidateCreated, When evaluated, Then no candidate is inferred."""
        self.assertEqual(compute_enforcement_outcome_observed("D", False, "CONFORMING", "ALLOW"), "NOT_TRIGGERED")


class CodeBaseChangeInvariantRegression(unittest.TestCase):
    def test_Given_contradictory_codebase_change_When_validated_Then_rejected(self):
        """opencode: Given codeBaseChanged true with equal hashes, When validated, Then rejected."""
        issues = codebase_change_issues("a", "a", True, "CHANGE_APPLIED")
        self.assertTrue(any("codeBaseChanged" in issue for issue in issues))

    def test_Given_blocked_with_codebase_change_When_validated_Then_rejected(self):
        """opencode: Given CHANGE_BLOCKED with codeBaseChanged true, When validated, Then rejected."""
        issues = codebase_change_issues("a", "b", True, "CHANGE_BLOCKED")
        self.assertTrue(any("CHANGE_BLOCKED" in issue for issue in issues))

    def test_Given_applied_without_codebase_change_When_validated_Then_rejected(self):
        """opencode: Given CHANGE_APPLIED with codeBaseChanged false, When validated, Then rejected."""
        issues = codebase_change_issues("a", "a", False, "CHANGE_APPLIED")
        self.assertTrue(any("CHANGE_APPLIED" in issue for issue in issues))

    def test_Given_consistent_record_When_validated_Then_no_issues(self):
        """opencode: Given a consistent record, When validated, Then no issues."""
        self.assertEqual(codebase_change_issues("a", "b", True, "CHANGE_APPLIED"), [])
        self.assertEqual(codebase_change_issues("a", "a", False, "NO_CHANGE_PRODUCED"), [])


if __name__ == "__main__":
    unittest.main()
