"""Regressões da camada canônica de cálculo (Frente 2 / contrato)."""

import unittest

from benchmark.core.analytics import (
    FIELD_CONTRACT, METRIC_CATALOG, compute_report_metrics, coverage_metric, delivery_metric,
    false_block_metric, load_classified, pair_metric, pairing_all, run_identity,
)


def run(run_id, **fields):
    base = {"batchId": "b", "runId": run_id, "baseTaskId": "G1", "promptVariantId": None,
            "replicationIndex": 1, "condition": "D", "taskType": "valida_governada"}
    base.update(fields)
    return base


class AnalyticsRegression(unittest.TestCase):
    def test_Given_confirmed_conforme_denied_When_false_block_Then_counted_with_ids(self):
        """opencode: Given a confirmed conforme candidate denied, When false block, Then numerator has its id."""
        runs = [run("r1", candidateSemanticValidity="VALID", candidateEnforcementApplicable=True,
                    promotionDecision="DENY")]
        metric = false_block_metric(runs)
        self.assertEqual(metric["numerador"], 1)
        self.assertEqual(metric["denominador"], 1)
        self.assertEqual(metric["idsNumerador"], ["r1"])

    def test_Given_unverified_validity_When_false_block_Then_excluded_not_counted(self):
        """opencode: Given unverified candidate validity, When false block, Then it is excluded, not counted."""
        runs = [run("r1", candidateSemanticValidity="INDETERMINATE", candidateEnforcementApplicable=True,
                    promotionDecision="DENY")]
        metric = false_block_metric(runs)
        self.assertEqual(metric["denominador"], 0)
        self.assertFalse(metric["calculavel"])
        self.assertEqual(metric["excluidos"]["validade nao verificada"], ["r1"])

    def test_Given_zero_denominator_When_metric_Then_not_computable(self):
        """opencode: Given zero denominator, When metric, Then it is not computable."""
        metric = false_block_metric([])
        self.assertIsNone(metric["valor"])
        self.assertFalse(metric["calculavel"])

    def test_Given_null_field_When_coverage_Then_not_converted_to_zero(self):
        """opencode: Given a null field, When coverage, Then it is missing, not zero."""
        runs = [run("r1", testsExecuted=True, testsPassed=None)]
        metric = coverage_metric(runs, "testsPassed", lambda r: r.get("testsExecuted") is True)
        self.assertEqual(metric["numerador"], 0)
        self.assertEqual(metric["denominador"], 1)
        self.assertEqual(metric["excluidos"]["ausente"], ["r1"])

    def test_Given_allowed_request_promoted_When_delivery_Then_counted(self):
        """opencode: Given an allowed request promoted, When delivery, Then it is counted."""
        runs = [run("r1", solicitacaoPermitida=True, candidateCreated=True, codeBaseChanged=True, promoted=True)]
        metric = delivery_metric(runs)
        self.assertEqual(metric["numerador"], 1)
        self.assertEqual(metric["denominador"], 1)

    def test_Given_report_metrics_When_built_Then_contract_and_identities_present(self):
        """opencode: Given runs, When report metrics, Then contract and identities are declared."""
        metrics = compute_report_metrics([run("r1"), run("r2")])
        self.assertEqual(metrics["identidades"]["unicas"], 2)
        self.assertIn("candidateSemanticValidity", {item["campo"] for item in FIELD_CONTRACT})

    def test_Given_identity_When_extracted_Then_unique_contract_fields(self):
        """opencode: Given a run, When identity, Then the contract fields are used."""
        identity = run_identity(run("r1"))
        self.assertEqual(identity, ("b", "G1", None, 1, "D", "r1"))

    def test_Given_missing_batch_When_loading_Then_empty(self):
        """opencode: Given a missing batch, When loading classified, Then empty without invention."""
        self.assertEqual(load_classified("/tmp/nao-existe-bsh"), [])


    def test_Given_paired_runs_When_contrast_Then_delta_and_reason_per_pair(self):
        """opencode: Given paired runs, When contrast, Then delta and per-pair reason are explicit."""
        runs = [run("a", condition="A", totalTokens=100), run("d", condition="D", totalTokens=80)]
        metric = pair_metric(runs, "A", "D")
        self.assertEqual(metric["estruturais"], 1)
        self.assertEqual(metric["elegiveis"], 1)
        self.assertEqual(metric["pares"][0]["deltaTokens"], 20)

    def test_Given_missing_partner_or_tokens_When_contrast_Then_exclusion_reason(self):
        """opencode: Given missing partner or tokens, When contrast, Then exclusion reason is recorded."""
        sem_parceiro = pair_metric([run("a", condition="A", totalTokens=100)], "A", "D")
        self.assertEqual(sem_parceiro["pares"][0]["status"], "NO_MATCHING_RUN")
        self.assertEqual(sem_parceiro["elegiveis"], 0)
        sem_tokens = pair_metric([run("a", condition="A", totalTokens=None),
                                  run("d", condition="D", totalTokens=80)], "A", "D")
        self.assertEqual(sem_tokens["pares"][0]["status"], "MISSING_REQUIRED_DATA")

    def test_Given_catalog_When_read_Then_metrics_declare_denominators(self):
        """opencode: Given the metric catalog, When read, Then each metric declares numerator/denominator."""
        names = {item["metrica"] for item in METRIC_CATALOG}
        self.assertIn("WORKLOAD_TOKEN_REDUCTION", names)
        for item in METRIC_CATALOG:
            self.assertTrue(item["numerador"] and item["denominador"] and item["unidade"])

    def test_Given_pairing_all_When_built_Then_four_contrasts(self):
        """opencode: Given pairing, When built, Then the four contrasts are present."""
        pairing = pairing_all([run("a", condition="A", totalTokens=1), run("b", condition="B", totalTokens=2)])
        self.assertEqual(set(pairing), {"A-B", "B-C", "C-D", "A-D"})


if __name__ == "__main__":
    unittest.main()
