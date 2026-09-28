"""Regressões do contrato de classificação e sequência de negativa (task 4)."""

import unittest

from benchmark.core.classification_contract import (
    DECISION_TABLE, decision_row, denial_sequence, first_failed_stage,
)


class ClassificationContractRegression(unittest.TestCase):
    def test_Given_decision_table_When_read_Then_covers_all_classes(self):
        """opencode: Given the decision table, When read, Then all classes are covered."""
        classes = {row["classe"] for row in DECISION_TABLE}
        for expected in ("ALTERACAO_CORRETA", "ALTERACAO_INCORRETA", "SEM_ALTERACAO_CORRETA",
                         "SEM_ALTERACAO_INCORRETA", "FALSO_BLOQUEIO", "FALHA_INSTRUMENTACAO", "INDETERMINADO"):
            self.assertIn(expected, classes)

    def test_Given_false_block_row_When_read_Then_requires_verified_validity(self):
        """opencode: Given the false-block row, When read, Then it requires verified validity."""
        row = decision_row("FALSO_BLOQUEIO")
        self.assertEqual(row["valoresAdmissiveis"]["candidateSemanticValidity"], "VALID")

    def test_Given_failure_at_recognition_When_sequence_Then_first_stage_is_recognition(self):
        """opencode: Given recognition missing, When sequence, Then the first failed stage is declared."""
        result = {"governanceDecision": {"recognizedOperation": [], "candidateGraphHash": None,
                                         "validationExecuted": False, "validationComplete": False,
                                         "validationStatus": "INDETERMINATE", "promotionDecision": "DENY"}}
        sequence = denial_sequence(result)
        self.assertEqual(first_failed_stage(sequence), "RECONHECIMENTO")

    def test_Given_recognition_ok_but_no_facts_When_sequence_Then_fact_extraction_fails(self):
        """opencode: Given recognized operation without candidate facts, When sequence, Then fact extraction fails."""
        result = {"governanceDecision": {"recognizedOperation": ["urn:x:Op"], "candidateGraphHash": None,
                                         "factsExtracted": [], "validationExecuted": False,
                                         "validationComplete": False, "validationStatus": "INDETERMINATE",
                                         "promotionDecision": "DENY"}}
        sequence = denial_sequence(result)
        self.assertEqual(first_failed_stage(sequence), "EXTRACAO_FATOS")

    def test_Given_complete_gate_When_sequence_Then_no_failed_stage(self):
        """opencode: Given a complete gate, When sequence, Then no failed stage."""
        result = {"governanceDecision": {"recognizedOperation": ["urn:x:Op"], "candidateGraphHash": "h",
                                         "factsExtracted": ["f"], "validationExecuted": True,
                                         "validationComplete": True, "validationStatus": "VIOLATION",
                                         "promotionDecision": "DENY"}}
        self.assertEqual(first_failed_stage(denial_sequence(result)), "NENHUMA")


if __name__ == "__main__":
    unittest.main()
