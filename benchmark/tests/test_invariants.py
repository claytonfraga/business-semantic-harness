"""Regressões dos invariantes executáveis (task 3)."""

import unittest

from benchmark.core.invariants import InvariantError, assert_consistent, run_situation, validate_runs


def run(run_id="r1", **fields):
    base = {"batchId": "b", "runId": run_id, "baseTaskId": "G1", "replicationIndex": 1,
            "condition": "D", "executionStatus": "OK", "taskType": "valida_governada"}
    base.update(fields)
    return base


class InvariantsRegression(unittest.TestCase):
    def test_Given_promoted_without_codebase_change_When_validated_Then_violation(self):
        """opencode: Given promoted without code change, When validated, Then violation with id."""
        report = validate_runs([run("r1", promoted=True, codeBaseChanged=False)])
        self.assertEqual(report["status"], "FAIL")
        self.assertTrue(any(v["runId"] == "r1" for v in report["violations"]))

    def test_Given_origin_change_without_candidate_When_validated_Then_violation(self):
        """opencode: Given origin change without candidate, When validated, Then violation."""
        report = validate_runs([run("r2", codeBaseChanged=True, changeSetDetected=False)])
        self.assertTrue(any(v["rule"] == "origin-sem-candidato" for v in report["violations"]))

    def test_Given_false_block_without_validity_When_validated_Then_violation(self):
        """opencode: Given FALSO_BLOQUEIO without verified validity, When validated, Then violation."""
        report = validate_runs([run("r3", classification="FALSO_BLOQUEIO", candidateSemanticValidity="INDETERMINATE")])
        self.assertTrue(any(v["rule"] == "falso-bloqueio-sem-validade" for v in report["violations"]))

    def test_Given_unverified_validity_When_validated_Then_limitation_not_violation(self):
        """opencode: Given unverified validity, When validated, Then limitation, not violation."""
        report = validate_runs([run("r4", condition="D", candidateSemanticValidity="INDETERMINATE")])
        self.assertEqual(report["status"], "PASS")
        self.assertTrue(any(l["rule"] == "validade-indeterminada" for l in report["limitations"]))

    def test_Given_impossible_combination_When_asserted_Then_raises_with_ids(self):
        """opencode: Given an impossible combination, When asserted, Then it raises with ids."""
        with self.assertRaises(InvariantError) as context:
            assert_consistent([run("r9", promoted=True, codeBaseChanged=False)])
        self.assertIn("r9", str(context.exception))

    def test_Given_situations_When_reconciled_Then_counts_add_up(self):
        """opencode: Given situations, When reconciled, Then counts add up."""
        runs = [run("a", executionStatus="OK"), run("b", executionStatus="FALHA_TECNICA"),
                run("c", executionStatus="FALHA_INSTRUMENTACAO")]
        report = validate_runs(runs)
        rec = report["reconciliacao"]
        self.assertEqual(rec["observadas"], 3)
        self.assertEqual(rec["concluidas"], 1)
        self.assertEqual(rec["falhas"], 2)
        self.assertEqual(run_situation(runs[0]), "concluida")


if __name__ == "__main__":
    unittest.main()
