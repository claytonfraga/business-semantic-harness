"""Given/When/Then regressions derived from the benchmark analysis OpenSpec.

All evidence here is synthetic and held in memory or temporary directories.
No benchmark execution, agent, or campaign is started.
"""

import copy
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import yaml

from benchmark.core.experimental_execution import (
    BatchIsolationGate, ExperimentalExecutionCompletionGate,
    InstrumentationCompletenessGate, RecognitionGroundTruthIndependenceGate, availability, classify_observed,
    normalize_runs,
    write_json, read_json, canonical_json,
)
from benchmark.core.experimental_results import (
    ScientificUsabilityGate, build_evidence, compute_scientific_statistics,
    pair_runs, recognition_metrics,
)
from benchmark.core.experimental_report import PDFLayoutGate, build_number_provenance, build_report_model, compile_and_validate, render_latex
from benchmark.core.scientific_pipeline import ScientificConsistencyChecker, analyze_experimental_execution


ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = yaml.safe_load((ROOT / "analysis-requirements.yaml").read_text(encoding="utf-8"))
POLICY = yaml.safe_load((ROOT / "analysis-policy.yaml").read_text(encoding="utf-8"))


def raw(condition, total=100, task="G1", run_number=1, **fields):
    return {
        "runId": f"{run_number:03d}-{task}-{condition}", "batchId": "synthetic",
        "condition": condition, "taskId": task, "baseTaskId": task,
        "replicationIndex": 1, "agent": "codex", "model": "gpt-5.6-sol",
        "reasoningEffort": "low", "adapter": "codex", "adapterVersion": "1",
        "runtime": "codex", "telemetrySchemaVersion": "1", "tokenAccountingVersion": "1",
        "totalTokens": total, "durationSeconds": 10, "changeSetDetected": True,
        "promoted": True, "originChanged": True, "testsPassed": True,
        "functionalCorrectness": True, "behavioralEquivalence": "EQUIVALENTE",
        **fields,
    }


def classified(*records, task_type="valida_governada"):
    tasks = [{"id": item["baseTaskId"], "tipo": task_type, "expectedOperation": "op", "expectedShapes": ["S"]} for item in records]
    return [classify_observed(item) for item in normalize_runs("synthetic", list(records), tasks)]


def statistics(*records, task_type="valida_governada", ground_truth=False):
    runs = classified(*records, task_type=task_type)
    return compute_scientific_statistics(runs, pair_runs(runs), REQUIREMENTS, POLICY,
                                         {"recognitionMetricsValid": ground_truth})


class ScientificPipelineRegression(unittest.TestCase):
    def check_consistency(self, stats, evidence=None, verdicts=None, model=None):
        runs = classified(raw("A"), raw("D"))
        pairs = pair_runs(runs)
        canonical_evidence, canonical_verdicts = build_evidence(stats, REQUIREMENTS, POLICY)
        evidence = canonical_evidence if evidence is None else evidence
        verdicts = canonical_verdicts if verdicts is None else verdicts
        model = model or {"batchId": "synthetic", "statistics": stats, "evidenceMatrix": evidence,
                          "verdicts": verdicts, "sections": [], "abstract": {}}
        numbers = build_number_provenance(model)
        with TemporaryDirectory() as directory:
            batch = Path(directory)
            for name, value in (("statistics.json", stats), ("evidence-matrix.json", evidence),
                                ("verdicts.json", verdicts), ("report-model.json", model),
                                ("report-number-provenance.json", numbers)):
                write_json(batch / name, value)
            return ScientificConsistencyChecker().check(batch, runs, pairs, stats, evidence, verdicts, model, numbers)

    def test_Given_missing_tokens_When_normalized_Then_missing_is_not_zero(self):
        runs = normalize_runs("synthetic", [raw("A", total=None)], [{"id": "G1", "tipo": "valida_governada"}])
        self.assertIsNone(runs[0]["totalTokens"])
        self.assertEqual(runs[0]["availability"]["totalTokens"], "MISSING")
        self.assertEqual(availability(0), "OBSERVED_ZERO")

    def test_Given_negative_tokens_When_normalized_Then_invalid_not_missing(self):
        runs = normalize_runs("synthetic", [raw("A", total=-1)], [{"id": "G1", "tipo": "valida_governada"}])
        self.assertIsNone(runs[0]["totalTokens"])
        self.assertEqual(runs[0]["availability"]["totalTokens"], "INVALID")
        self.assertGreater(InstrumentationCompletenessGate().evaluate(runs)["invalidValues"], 0)

    def test_Given_missing_A_baseline_When_analyzed_Then_RQ1A_has_no_percentage(self):
        result = statistics(raw("A", total=None), raw("D", total=10))
        entry = result["researchQuestions"]["RQ1_A"]
        self.assertEqual(entry["status"], "DADOS_INSUFICIENTES")
        self.assertIsNone(entry["metric"]["WORKLOAD_TOKEN_REDUCTION"])

    def test_Given_foreign_batch_When_isolation_checked_Then_hard_fail(self):
        with TemporaryDirectory() as directory:
            result = BatchIsolationGate(Path(directory), "synthetic").evaluate([raw("A", batchId="foreign")])
        self.assertEqual(result["status"], "HARD_FAIL")
        self.assertEqual(result["foreignBatchRuns"], 1)

    def test_Given_figure_without_batch_manifest_When_isolation_checked_Then_hard_fail(self):
        with TemporaryDirectory() as directory:
            figures = Path(directory) / "figures"
            figures.mkdir()
            (figures / "stale.pdf").write_bytes(b"stale")
            result = BatchIsolationGate(Path(directory), "synthetic").evaluate([raw("A")])
        self.assertEqual(result["status"], "HARD_FAIL")
        self.assertEqual(result["foreignBatchFigures"], 1)

    def test_Given_missing_planned_run_When_completion_checked_Then_resumable(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory) / "synthetic"
            batch.mkdir()
            result = ExperimentalExecutionCompletionGate(batch).evaluate(
                {"experiment": {"conditions": ["A", "D"], "tasks": ["G1"], "replications": {"enabled": False}}},
                [{"id": "G1"}], {"lote": "synthetic"}, [raw("A")])
        self.assertEqual(result["completionStatus"], "INCOMPLETE_RESUMABLE")
        self.assertEqual(result["missingRuns"], 1)

    def test_Given_duplicate_run_When_completion_checked_Then_invalid(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory) / "synthetic"
            batch.mkdir()
            result = ExperimentalExecutionCompletionGate(batch).evaluate(
                {"experiment": {"conditions": ["A"], "tasks": ["G1"], "replications": {"enabled": False}}},
                [{"id": "G1"}], {"lote": "synthetic"}, [raw("A"), raw("A")])
        self.assertEqual(result["completionStatus"], "INVALID")

    def test_Given_replication_plan_without_order_When_completion_checked_Then_missing_replication_identified(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory) / "synthetic"
            batch.mkdir()
            runs = [raw("A"), raw("D")]
            result = ExperimentalExecutionCompletionGate(batch).evaluate(
                {"experiment": {"conditions": ["A", "D"], "tasks": ["G1"],
                                "replications": {"enabled": True, "maximumAdditionalExecutions": 2}}},
                [{"id": "G1"}], {"lote": "synthetic"}, runs)
        self.assertEqual(result["completionStatus"], "INCOMPLETE_RESUMABLE")
        self.assertEqual(result["missingReplications"], [2])

    def test_Given_one_base_task_When_equivalent_Then_descriptive_only(self):
        result = statistics(raw("A"), raw("D", total=80))
        self.assertEqual(result["researchQuestions"]["RQ1_B"]["status"], "DESCRITIVA")
        self.assertEqual(result["researchQuestions"]["RQ1_B"]["nBaseTasks"], 1)
        evidence, _ = build_evidence(result, REQUIREMENTS, POLICY)
        self.assertEqual(next(item for item in evidence if item["researchQuestion"] == "RQ1_B")["evidenceStrength"], "LIMITADA")

    def test_Given_D_spends_more_tokens_When_verdict_built_Then_reduction_contradicted(self):
        result = statistics(raw("A", total=100), raw("D", total=150))
        evidence, _ = build_evidence(result, REQUIREMENTS, POLICY)
        self.assertEqual(next(item for item in evidence if item["researchQuestion"] == "RQ1_A")["verdict"], "CONTRADITO")

    def test_Given_ground_truth_copied_When_checked_Then_recognition_invalid(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory)
            (batch / "tasks.json").write_text("[]", encoding="utf-8")
            runs = classified(raw("D", expectedSource="tasks.json", observedSource="tasks.json"))
            result = RecognitionGroundTruthIndependenceGate().evaluate(runs, batch)
        self.assertEqual(result["status"], "FAIL")

    def test_Given_independent_sources_but_observed_value_stale_When_checked_Then_recognition_invalid(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory)
            (batch / "tasks.json").write_text(json.dumps({"tarefas": [{"id": "G1", "expectedOperation": "op", "expectedShapes": ["S"]}]}), encoding="utf-8")
            evidence = batch / "executions" / "001-G1-D" / "result.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text(json.dumps({"identifiedOperation": "different", "identifiedShapes": ["S"]}), encoding="utf-8")
            runs = classified(raw("D", identifiedOperation="op", identifiedShapes=["S"]))
            result = RecognitionGroundTruthIndependenceGate().evaluate(runs, batch)
        self.assertFalse(result["recognitionMetricsValid"])

    def test_Given_shape_not_applicable_When_measured_Then_no_shape_true_positive(self):
        item = {"condition": "D", "baseTaskId": "G1", "expectedOperation": "op",
                "identifiedOperation": "op", "expectedShapes": ["NAO_APLICAVEL"],
                "identifiedShapes": []}
        result = recognition_metrics([item], True)
        self.assertEqual(result["shape"]["ShapeTP"], 0)
        self.assertIsNone(result["shape"]["precision"])

    def test_Given_consultation_without_candidate_When_classified_Then_no_independent_enforcement(self):
        item = classified(raw("D", changeSetDetected=False, promoted=False, originChanged=False,
                              ontologyQueried=True, candidateEnforcementApplicable=False), task_type="violadora")[0]
        self.assertFalse(item["independentEnforcementActivated"])
        self.assertEqual(item["governanceMechanism"], "CONSULTA_PREVENTIVA")

    def test_Given_no_independent_activation_When_verdict_built_Then_not_demonstrated(self):
        result = statistics(raw("A"), raw("D"))
        _, verdicts = build_evidence(result, REQUIREMENTS, POLICY)
        self.assertEqual(verdicts["researchQuestions"]["RQ11"]["verdict"], "NAO_AVALIADO")

    def test_Given_false_block_When_classified_Then_distinct_from_correct_block(self):
        item = classified(raw("D", promoted=False, originChanged=False, semanticStatus="violacao",
                              candidateSemanticValidity="INVALID"))[0]
        self.assertEqual(item["classification"], "FALSO_BLOQUEIO")

    def test_Given_undetected_violation_When_classified_Then_escape_visible(self):
        item = classified(raw("D", semanticStatus="violacao", candidateSemanticValidity="INVALID"),
                          task_type="violadora")[0]
        self.assertEqual(item["classification"], "VIOLACAO_NAO_DETECTADA")

    def test_Given_one_pair_When_correlation_checked_Then_pearson_and_spearman_null(self):
        result = statistics(raw("A"), raw("D", total=80))
        correlation = result["researchQuestions"]["RQ8"]["metric"]["correlation"]
        self.assertEqual(correlation["status"], "NOT_COMPUTABLE")
        self.assertIsNone(correlation["pearson"])
        self.assertIsNone(correlation["spearman"])

    def test_Given_zero_violations_When_wilson_computed_Then_upper_bound_positive(self):
        records = [raw("C", task=f"G{number}") for number in range(1, 4)]
        result = statistics(*records)
        self.assertEqual(result["falseBlocks"]["falseBlocksObserved"], 0)
        self.assertGreater(result["falseBlocks"]["confidenceInterval"][1], 0)
        self.assertEqual(result["falseBlocks"]["intervalSidedness"], "two-sided")

    def test_Given_stale_statistics_When_consistency_checked_Then_hard_fail(self):
        result = statistics(raw("A"), raw("D"))
        runs = classified(raw("A"), raw("D"))
        model = {"batchId": "synthetic", "statistics": result, "evidenceMatrix": [], "verdicts": {}}
        with TemporaryDirectory() as directory:
            checked = ScientificConsistencyChecker().check(Path(directory), runs, pair_runs(runs), result, [], {}, model, [])
        self.assertEqual(checked["status"], "HARD_FAIL")
        self.assertTrue(any("stale or missing statistics.json" in issue for issue in checked["issues"]))

    def test_Given_stale_evidence_matrix_When_checked_Then_hard_fail(self):
        stats = statistics(raw("A"), raw("D"))
        evidence, _ = build_evidence(stats, REQUIREMENTS, POLICY)
        evidence = copy.deepcopy(evidence)
        evidence[0]["nRuns"] = 999
        checked = self.check_consistency(stats, evidence=evidence)
        self.assertIn("evidence matrix diverges from statistics", checked["issues"])

    def test_Given_stale_verdicts_When_checked_Then_hard_fail(self):
        stats = statistics(raw("A"), raw("D"))
        _, verdicts = build_evidence(stats, REQUIREMENTS, POLICY)
        verdicts = copy.deepcopy(verdicts)
        verdicts["researchQuestions"]["RQ1_A"]["verdict"] = "SUSTENTADO_NESTE_LOTE"
        checked = self.check_consistency(stats, verdicts=verdicts)
        self.assertIn("verdicts diverge from evidence matrix/statistics", checked["issues"])

    def test_Given_nine_of_eleven_prevented_When_report_says_one_hundred_percent_Then_hard_fail(self):
        stats = statistics(raw("A"), raw("D"))
        stats["violations"] = {"containedViolations": 9, "escapedViolations": 2,
                               "eligibleViolatingRuns": 11, "undeterminedViolatingRuns": 0}
        evidence, verdicts = build_evidence(stats, REQUIREMENTS, POLICY)
        model = {"batchId": "synthetic", "statistics": stats, "evidenceMatrix": evidence,
                 "verdicts": verdicts, "sections": [{"title": "Conclusão", "paragraphs": ["100% prevenido"]}],
                 "abstract": {}}
        checked = self.check_consistency(stats, evidence, verdicts, model)
        self.assertIn("report claims 100% prevention against observed escapes", checked["issues"])

    def test_Given_no_independent_gate_activation_When_report_claims_success_Then_hard_fail(self):
        stats = statistics(raw("A"), raw("D"))
        evidence, verdicts = build_evidence(stats, REQUIREMENTS, POLICY)
        model = {"batchId": "synthetic", "statistics": stats, "evidenceMatrix": evidence,
                 "verdicts": verdicts,
                 "sections": [{"title": "Conclusão", "paragraphs": ["O enforcement independente foi bem-sucedido."]}],
                 "abstract": {}}
        checked = self.check_consistency(stats, evidence, verdicts, model)
        self.assertIn("report claims successful independent enforcement without activation", checked["issues"])

    def test_Given_old_conclusion_after_model_hash_When_checked_Then_hard_fail(self):
        stats = statistics(raw("A"), raw("D"))
        evidence, verdicts = build_evidence(stats, REQUIREMENTS, POLICY)
        model = {"batchId": "synthetic", "statistics": stats, "evidenceMatrix": evidence,
                 "verdicts": verdicts, "sections": [{"title": "Conclusão", "paragraphs": ["Resultado atual."]}],
                 "abstract": {}, "provenance": {}}
        model["scientificContentHash"] = hashlib.sha256(canonical_json(model).encode()).hexdigest()
        model["provenance"]["scientificContentHash"] = model["scientificContentHash"]
        model["sections"][0]["paragraphs"] = ["Conclusão antiga mantida indevidamente."]
        checked = self.check_consistency(stats, evidence, verdicts, model)
        self.assertIn("report scientific content hash mismatch", checked["issues"])

    def test_Given_wide_table_pdf_When_layout_checked_Then_publication_block(self):
        import fitz
        with TemporaryDirectory() as directory:
            path = Path(directory) / "wide.pdf"
            document = fitz.open()
            page = document.new_page()
            page.insert_text((page.rect.width - 5, 100), "This table exceeds the right margin")
            document.save(path)
            document.close()
            result = PDFLayoutGate().validate(path, Path(directory) / "pages")
        self.assertEqual(result["status"], "PUBLICATION_BLOCK")

    def test_Given_undefined_reference_When_compiled_Then_publication_block(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "reference.tex"
            path.write_text("\\documentclass{article}\\begin{document}See \\ref{missing}.\\end{document}", encoding="utf-8")
            result = compile_and_validate(path, {})
        self.assertEqual(result["status"], "PUBLICATION_BLOCK")
        self.assertFalse(result["crossReferencesValid"])

    def test_Given_model_only_When_rendered_Then_latex_compiles_without_raw_runs(self):
        model = {"title": "Relatório de Análise Experimental", "subtitle": "synthetic",
                 "dataOrigin": "SYNTHETIC_FIXTURE",
                 "abstract": {"objective": "Teste de renderização", "design": "Modelo mínimo",
                              "nRuns": 0, "nBaseTasks": 0, "mainResults": {}, "limitations": []},
                 "sections": [{"title": "Introdução", "paragraphs": ["Texto com citação [wohlin2012]."]}],
                 "tables": [], "figures": [],
                 "references": [{"key": "wohlin2012", "author": "WOHLIN et al.", "year": "2012",
                                 "entry": "WOHLIN, C. et al. Experimentation in Software Engineering. Springer, 2012."}]}
        with TemporaryDirectory() as directory:
            tex = render_latex(model, Path(directory))
            result = compile_and_validate(tex, model)
        self.assertEqual(result["status"], "PASS", result["issues"])

    def test_Given_full_synthetic_model_When_rendered_Then_publication_layout_passes(self):
        runs = classified(raw("A", total=None), raw("D", total=20))
        pairs = pair_runs(runs)
        stats = compute_scientific_statistics(runs, pairs, REQUIREMENTS, POLICY, {"recognitionMetricsValid": False})
        evidence, verdicts = build_evidence(stats, REQUIREMENTS, POLICY)
        coverage = InstrumentationCompletenessGate().evaluate(runs)
        quality = {"byCondition": coverage["byCondition"]}
        completion = {"plannedRuns": 2, "observedRuns": 2, "completedRuns": 2,
                      "missingRuns": 0, "failedRuns": 0, "completionStatus": "COMPLETE"}
        model = build_report_model("synthetic", {"agente": "codex", "modelo": "gpt-5.6-sol",
                                                 "esforco": "low", "dataOrigin": "SYNTHETIC_FIXTURE"},
                                   {"agent": {"id": "codex", "model": "gpt-5.6-sol", "reasoningEffort": "low"},
                                    "project": {"ontologyDomain": "synthetic"}},
                                   completion, quality, {"status": "PASS"},
                                   ScientificUsabilityGate().evaluate(stats, REQUIREMENTS),
                                   {"recognitionMetricsValid": False}, stats, evidence, verdicts, pairs, {})
        unsigned = copy.deepcopy(model)
        unsigned.pop("scientificContentHash")
        unsigned["provenance"].pop("scientificContentHash")
        self.assertEqual(model["scientificContentHash"], hashlib.sha256(canonical_json(unsigned).encode()).hexdigest())
        with TemporaryDirectory() as directory:
            tex = render_latex(model, Path(directory))
            rendered = tex.read_text(encoding="utf-8")
            result = compile_and_validate(tex, model)
        self.assertEqual(result["status"], "PASS", result["issues"])
        titles = [section["title"] for section in model["sections"]]
        for expected_title in ("Introdução", "Conclusão", "Auditoria por Execução", "Análise de Caso: G4",
                               "Glossário Operacional e Regras de Cálculo",
                               "Indicadores Auditáveis e Decomposição das Negativas",
                               "Reconciliação entre Campanhas"):
            self.assertIn(expected_title, titles)
        for term in ("falso bloqueio", "oportunidade de enforcement", "Taxa de falsos bloqueios",
                     "Taxa de entrega das solicitações", "solicitacaoPermitida"):
            self.assertIn(term, rendered)

    def test_Given_complete_synthetic_batch_When_analyzed_without_publication_Then_pipeline_is_consistent(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory) / "synthetic"
            batch.mkdir()
            records = [raw(condition, run_number=index, identifiedOperation="op", identifiedShapes=["S"])
                       for index, condition in enumerate("ABCD", 1)]
            config = {"experiment": {"conditions": list("ABCD"), "tasks": ["G1"],
                                     "replications": {"enabled": False}},
                      "agent": {"id": "codex", "model": "gpt-5.6-sol", "reasoningEffort": "low"},
                      "project": {"ontologyDomain": "synthetic"}}
            (batch / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
            write_json(batch / "tasks.json", {"tarefas": [{"id": "G1", "tipo": "valida_governada",
                                                            "expectedOperation": "op", "expectedShapes": ["S"]}]})
            write_json(batch / "metadata.json", {"lote": "synthetic", "dataOrigin": "SYNTHETIC_FIXTURE",
                                                  "agente": "codex", "modelo": "gpt-5.6-sol", "esforco": "low",
                                                  "ordemExecucao": [record["runId"] for record in records]})
            write_json(batch / "measurements.json", records)
            for record in records:
                path = batch / "executions" / record["runId"] / "result.json"
                path.parent.mkdir(parents=True)
                write_json(path, record)
            result = analyze_experimental_execution(batch, publish=False)
            self.assertEqual(result["status"], "ANALYSIS_READY", result)
            self.assertIsNotNone(result["auditPdf"])
            self.assertTrue((batch / "report-model.json").is_file())
            self.assertFalse((batch / "report.pdf").exists())
            first = {name: read_json(batch / name) for name in (
                "statistics.json", "evidence-matrix.json", "verdicts.json", "report-model.json")}
            repeated = analyze_experimental_execution(batch, publish=False)
            self.assertEqual(repeated["status"], "ANALYSIS_READY", repeated)
            for name, value in first.items():
                self.assertEqual(value, read_json(batch / name), name)


if __name__ == "__main__":
    unittest.main()
