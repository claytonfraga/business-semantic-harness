"""Given/When/Then regressions for the batch-local technical execution record."""

from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

import yaml

from benchmark.core.experimental_execution import read_json, write_json
from benchmark.core.technical_execution_report import generate_execution_report


def make_batch(root: Path, batch_id: str, *, missing_token_a: bool = False,
               missing_d: bool = False, duplicate: bool = False) -> Path:
    batch = root / batch_id
    batch.mkdir()
    config = {"experiment": {"conditions": ["A", "D"], "tasks": ["G1"],
                             "replications": {"enabled": False}},
              "agent": {"id": "codex", "model": "gpt-5.6-sol", "reasoningEffort": "low"},
              "project": {"ontologyDomain": "synthetic"}}
    (batch / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
    write_json(batch / "tasks.json", {"tarefas": [{"id": "G1", "tipo": "valida_governada",
                                                    "expectedOperation": "op", "expectedShapes": ["S"]}]})
    records = []
    for index, condition in enumerate(("A", "D"), 1):
        if condition == "D" and missing_d:
            continue
        run_id = f"{index:03d}-G1-{condition}"
        record = {"batchId": batch_id, "runId": run_id, "taskId": "G1", "baseTaskId": "G1",
                  "condition": condition, "replicationIndex": 1, "agent": "codex",
                  "model": "gpt-5.6-sol", "reasoningEffort": "low",
                  "startedAt": "2026-09-26T18:00:00Z", "finishedAt": "2026-09-26T18:01:00Z",
                  "durationSeconds": 60, "inputTokens": 10, "cachedInputTokens": 0,
                  "outputTokens": 5, "reasoningTokens": 0,
                  "totalTokens": None if missing_token_a and condition == "A" else (12345 if condition == "D" else 15),
                  "rawTelemetry": {}, "changeSetDetected": True, "testsPassed": True,
                  "promoted": True, "originChanged": True,
                  "identifiedOperation": "op" if condition == "D" else None,
                  "identifiedShapes": ["S"] if condition == "D" else None,
                  "enforcementPipelineObserved": False if condition == "D" else None,
                  "candidateEnforcementApplicable": False if condition == "D" else None,
                  "independentEnforcementActivated": False if condition == "D" else None}
        records.append(record)
        result_file = batch / "executions" / run_id / "result.json"
        result_file.parent.mkdir(parents=True)
        write_json(result_file, record)
        (result_file.parent / "project").mkdir()
    if duplicate:
        records.append({**records[0], "runId": "003-G1-A"})
    write_json(batch / "measurements.json", records)
    write_json(batch / "metadata.json", {"lote": batch_id, "dataOrigin": "SYNTHETIC_FIXTURE",
                                          "agente": "codex", "modelo": "gpt-5.6-sol", "esforco": "low",
                                          "startedAt": "2026-09-26T18:00:00Z",
                                          "finishedAt": "2026-09-26T18:01:00Z",
                                          "ordemExecucao": [record["runId"] for record in records],
                                          "hashes": {"repositoryCommit": "a" * 40},
                                          "originFinalCommit": "a" * 40})
    return batch


class TechnicalExecutionReportRegression(unittest.TestCase):
    def test_Given_two_batches_When_reports_generated_Then_no_cross_batch_values(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            first = make_batch(root, "batch-one")
            second = make_batch(root, "batch-two")
            second_records = read_json(second / "measurements.json")
            second_records[1]["totalTokens"] = 987654
            write_json(second / "measurements.json", second_records)
            second_result = second / "executions" / second_records[1]["runId"] / "result.json"
            write_json(second_result, second_records[1])
            first_report = generate_execution_report(first)
            second_report = generate_execution_report(second)
            self.assertTrue(first_report["EXECUTION_REPORT_VALID"], first_report["layout"])
            self.assertTrue(second_report["EXECUTION_REPORT_VALID"], second_report["layout"])
            first_model = read_json(first / "execution-report" / "execution-report-model.json")
            second_model = read_json(second / "execution-report" / "execution-report-model.json")
            self.assertEqual({run["batchId"] for run in first_model["runs"]}, {"batch-one"})
            self.assertEqual({run["batchId"] for run in second_model["runs"]}, {"batch-two"})
            self.assertNotIn("987654", json.dumps(first_model))
            self.assertNotEqual(first_report["executionReportPath"], second_report["executionReportPath"])

    def test_Given_one_batch_When_report_generated_Then_only_technical_content_and_one_pdf(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one")
            result = generate_execution_report(batch)
            self.assertTrue(result["EXECUTION_REPORT_VALID"], result["layout"])
            report_dir = batch / "execution-report"
            self.assertEqual(len(list(report_dir.glob("execution-report-*.pdf"))), 1)
            self.assertTrue((report_dir / "execution-report-model.json").is_file())
            self.assertTrue((report_dir / "execution-report-provenance.json").is_file())
            self.assertTrue((batch / "analysis-readiness.json").is_file())
            text = Path(result["markdownPath"]).read_text(encoding="utf-8")
            for forbidden in ("RQ1", "benefício líquido", "hipótese comprovada", "significância", "evidence strength"):
                self.assertNotIn(forbidden.lower(), text.lower())
            repeated = generate_execution_report(batch)
            self.assertTrue(repeated["EXECUTION_REPORT_VALID"], repeated["layout"])
            self.assertEqual(len(list(report_dir.glob("execution-report-*.pdf"))), 1)

    def test_Given_foreign_batch_run_When_report_requested_Then_generation_blocked(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one")
            records = read_json(batch / "measurements.json")
            records[0]["batchId"] = "batch-two"
            write_json(batch / "measurements.json", records)
            result = generate_execution_report(batch)
            self.assertEqual(result["status"], "EXECUTION_REPORT_GENERATION_BLOCKED")
            self.assertFalse((batch / "execution-report").exists())

    def test_Given_contamination_after_report_When_regenerated_Then_stale_pdf_is_removed(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one")
            first = generate_execution_report(batch)
            self.assertTrue(first["EXECUTION_REPORT_VALID"], first["layout"])
            records = read_json(batch / "measurements.json")
            records[0]["batchId"] = "batch-two"
            write_json(batch / "measurements.json", records)
            blocked = generate_execution_report(batch)
            self.assertEqual(blocked["status"], "EXECUTION_REPORT_GENERATION_BLOCKED")
            self.assertFalse(list((batch / "execution-report").glob("execution-report-*.pdf")))

    def test_Given_foreign_batch_statistics_When_report_requested_Then_generation_blocked(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one")
            write_json(batch / "statistics.json", {"batchId": "batch-two", "totalTokens": 999999})
            result = generate_execution_report(batch)
            self.assertEqual(result["status"], "EXECUTION_REPORT_GENERATION_BLOCKED")
            self.assertEqual(result["isolation"]["foreignBatchStatistics"], 1)
            self.assertFalse((batch / "execution-report").exists())

    def test_Given_missing_A_tokens_When_report_generated_Then_coverage_zero_and_no_savings(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one", missing_token_a=True)
            result = generate_execution_report(batch)
            self.assertTrue(result["EXECUTION_REPORT_VALID"], result["layout"])
            model = read_json(batch / "execution-report" / "execution-report-model.json")
            self.assertEqual(model["coverage"]["totalTokens"]["A"]["coveragePercentage"], 0)
            self.assertEqual(model["coverage"]["totalTokens"]["D"]["coveragePercentage"], 100)
            self.assertFalse(model["readiness"]["tokenComparisonReadiness"])
            self.assertIsNone(next(run["totalTokens"] for run in model["runs"] if run["condition"] == "A"))
            self.assertNotIn("economia", Path(result["markdownPath"]).read_text(encoding="utf-8").lower())

    def test_Given_batch_metadata_for_another_agent_When_report_generated_Then_identity_is_not_static(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one")
            metadata = read_json(batch / "metadata.json")
            metadata.update({"agente": "agy", "modelo": "fixture-model", "esforco": "medium"})
            write_json(batch / "metadata.json", metadata)
            result = generate_execution_report(batch)
            self.assertTrue(result["EXECUTION_REPORT_VALID"], result["layout"])
            model = read_json(batch / "execution-report" / "execution-report-model.json")
            self.assertEqual((model["identity"]["agent"], model["identity"]["model"],
                              model["identity"]["reasoningEffort"]),
                             ("agy", "fixture-model", "medium"))
            self.assertEqual(model["readiness"]["overallStatus"], "NOT_READY_FOR_ANALYSIS")
            cover = Path(result["markdownPath"]).read_text(encoding="utf-8")
            self.assertIn("fixture-model", cover)

    def test_Given_missing_planned_run_When_report_generated_Then_not_ready(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one", missing_d=True)
            result = generate_execution_report(batch)
            self.assertTrue(result["EXECUTION_REPORT_VALID"], result["layout"])
            self.assertEqual(result["completion"]["missingRuns"], 1)
            self.assertEqual(read_json(batch / "execution-report" / "execution-report-model.json")["executionStatus"], "INCOMPLETE")
            self.assertEqual(result["readiness"]["overallStatus"], "NOT_READY_FOR_ANALYSIS")

    def test_Given_duplicate_run_When_report_generated_Then_execution_fail(self):
        with TemporaryDirectory() as directory:
            batch = make_batch(Path(directory), "batch-one", duplicate=True)
            result = generate_execution_report(batch)
            self.assertTrue(result["EXECUTION_REPORT_VALID"], result["layout"])
            self.assertEqual(result["completion"]["duplicateRuns"], 1)
            self.assertGreater(result["summary"]["executionFailCount"], 0)


if __name__ == "__main__":
    unittest.main()
