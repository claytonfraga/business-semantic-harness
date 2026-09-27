"""Synthetic regressions derived from the governance-evidence-reporting OpenSpec."""

import json
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import yaml

from benchmark.core.governance_observation import collect_governance_observation
from benchmark.core.experimental_execution import classify_observed, normalize_runs
from benchmark.core.experimental_results import compute_scientific_statistics, pair_runs
from benchmark.core.technical_execution_report import _model, generate_execution_report
from benchmark.core.experimental_execution import write_json


BENCHMARK = Path(__file__).resolve().parents[1]
REQUIREMENTS = yaml.safe_load((BENCHMARK / "analysis-requirements.yaml").read_text(encoding="utf-8"))
POLICY = yaml.safe_load((BENCHMARK / "analysis-policy.yaml").read_text(encoding="utf-8"))


def decision(status="VIOLATION", **changes):
    item = {"recognizedOperation": ["urn:generic:Action"],
            "selectedShapes": ["urn:generic:Shape"], "executedShapes": ["urn:generic:Shape"],
            "factsExtracted": ["urn:generic:item urn:generic:value bad"], "missingFacts": [],
            "candidateGraphHash": "graph-hash", "validationStatus": status,
            "validationExecuted": True, "validationComplete": True,
            "violations": ["constraint failed"] if status == "VIOLATION" else [],
            "policyDecision": "DENY" if status != "CONFORMING" else "ALLOW",
            "promotionDecision": "DENY" if status != "CONFORMING" else "ALLOW",
            "reason": "constraint failed", "failureStage": None,
            "candidateFingerprint": "candidate-hash", "candidateCommit": "candidate-commit",
            "originCommit": "origin-commit", "originChanged": False,
            "results": []}
    item.update(changes)
    return item


def workspace(root, session="session-one", *, governance=None, promoted=False, conflict=False):
    local = root / ".bsh" / "local"
    (local / "sessions").mkdir(parents=True, exist_ok=True)
    (local / "enforcement").mkdir(exist_ok=True)
    (local / "sessions" / f"{session}.report.json").write_text(json.dumps({
        "promovido": promoted, "origemAlterada": promoted, "bloqueado": not promoted,
        "validationStatus": governance["validationStatus"] if governance else None,
        "candidateFingerprint": governance["candidateFingerprint"] if governance else None,
    }), encoding="utf-8")
    if governance:
        (local / "enforcement" / f"{session}.json").write_text(json.dumps(governance), encoding="utf-8")
    (local / "session-one.jsonl").write_text(json.dumps({
        "event": "item-completed", "itemType": "mcpToolCall",
        "tool": "bsh_report_conflict" if conflict else "bsh_query_ontology",
    }) + "\n" + json.dumps({"event": "turn-completed", "status": "completed"}) + "\n", encoding="utf-8")


def run(condition="D", **fields):
    return {"batchId": "synthetic", "runId": f"run-{condition}", "condition": condition,
            "taskId": "task", "baseTaskId": "task", "replicationIndex": 1,
            "agent": "codex", "model": "fixture-model", "reasoningEffort": "low",
            "durationSeconds": 1, "totalTokens": 10,
            "changeSetDetected": True, "testsPassed": True,
            "promoted": condition == "A", "originChanged": condition == "A",
            **fields}


class GovernanceReportingRegression(unittest.TestCase):
    def test_Given_one_session_When_collected_Then_exact_decision_and_observed_false_are_preserved(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, governance=decision())
            observed = collect_governance_observation(root)
            self.assertEqual(observed["evidenceCollectionStatus"], "VALID")
            self.assertEqual(observed["sessionId"], "session-one")
            self.assertEqual(observed["validationStatus"], "VIOLATION")
            self.assertEqual(observed["statusEnforcement"], "violacao")
            self.assertEqual(observed["identifiedShapes"], ["urn:generic:Shape"])
            self.assertFalse(observed["reportConflictCalled"])
            self.assertFalse(observed["promoted"])
            self.assertTrue(observed["independentEnforcementActivated"])
            self.assertEqual(observed["enforcementGateEvidence"]["candidateFingerprint"], "candidate-hash")

    def test_Given_two_sessions_When_collected_Then_no_latest_decision_is_selected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, governance=decision())
            workspace(root, session="session-two", governance=decision(status="CONFORMING"))
            observed = collect_governance_observation(root)
            self.assertEqual(observed["evidenceCollectionStatus"], "INVALID")
            self.assertIsNone(observed["enforcementEvidence"])
            self.assertIsNone(observed["promoted"])

    def test_Given_missing_or_unmatched_decision_When_collected_Then_evidence_is_not_invented(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root)
            observed = collect_governance_observation(root)
            self.assertEqual(observed["evidenceCollectionStatus"], "MISSING")
            self.assertIsNone(observed["validationStatus"])
            self.assertIsNone(observed["independentEnforcementActivated"])
            other = root / ".bsh" / "local" / "enforcement" / "another-session.json"
            other.write_text(json.dumps(decision()), encoding="utf-8")
            self.assertEqual(collect_governance_observation(root)["evidenceCollectionStatus"], "INVALID")

    def test_Given_no_completed_tool_log_When_collected_Then_absence_of_conflict_is_unproven(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, governance=decision())
            (root / ".bsh" / "local" / "session-one.jsonl").write_text("", encoding="utf-8")
            observed = collect_governance_observation(root)
            self.assertIsNone(observed["reportConflictCalled"])
            self.assertIsNone(observed["independentEnforcementActivated"])

    def test_Given_selected_shape_not_executed_When_decision_claims_completion_Then_evidence_is_invalid(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            workspace(root, governance=decision(executedShapes=[]))
            observed = collect_governance_observation(root)
            self.assertEqual(observed["evidenceCollectionStatus"], "INVALID")
            self.assertIsNone(observed["independentEnforcementActivated"])

    def test_Given_incomplete_or_error_decision_When_normalized_Then_no_independent_enforcement_is_claimed(self):
        tasks = [{"id": "task", "tipo": "violadora"}]
        for status in ("INDETERMINATE", "VALIDATION_ERROR"):
            evidence = decision(status=status, validationComplete=False, candidateFingerprint=None)
            raw = run(governanceDecision=evidence, validationStatus=status,
                      enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True},
                      candidateEnforcementApplicable=True, enforcementPipelineObserved=True,
                      reportConflictCalled=False, identifiedOperation="urn:generic:Action",
                      identifiedShapes=["urn:generic:Shape"])
            classified = classify_observed(normalize_runs("synthetic", [raw], tasks)[0])
            self.assertFalse(classified["independentEnforcementActivated"])
            self.assertNotEqual(classified["classification"], "BLOQUEIO_CORRETO")

    def test_Given_legacy_violation_label_When_analyzed_Then_independent_claim_is_not_available(self):
        tasks = [{"id": "task", "tipo": "violadora"}]
        legacy = run(enforcementStatus="violacao", enforcementPipelineObserved=True,
                     candidateEnforcementApplicable=True, reportConflictCalled=False,
                     enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True})
        classified = [classify_observed(row) for row in normalize_runs("synthetic", [run("A"), legacy], tasks)]
        stats = compute_scientific_statistics(classified, pair_runs(classified), REQUIREMENTS, POLICY,
                                              {"recognitionMetricsValid": False})
        self.assertFalse(next(row for row in classified if row["condition"] == "D")["independentEnforcementActivated"])
        self.assertEqual(stats["researchQuestions"]["RQ11"]["status"], "NAO_AVALIADA")
        self.assertNotIn("enforcementEvidence", stats["researchQuestions"]["RQ5"]["availableEvidence"])

    def test_Given_complete_gate_evidence_When_analyzed_Then_one_independent_activation_is_described(self):
        tasks = [{"id": "task", "tipo": "violadora"}]
        raw_d = run(governanceDecision=decision(), evidenceCollectionStatus="VALID",
                    enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True},
                    candidateEnforcementApplicable=True, enforcementPipelineObserved=True,
                    reportConflictCalled=False, identifiedOperation="urn:generic:Action",
                    identifiedShapes=["urn:generic:Shape"])
        classified = [classify_observed(row) for row in normalize_runs("synthetic", [run("A"), raw_d], tasks)]
        stats = compute_scientific_statistics(classified, pair_runs(classified), REQUIREMENTS, POLICY,
                                              {"recognitionMetricsValid": False})
        self.assertEqual(stats["researchQuestions"]["RQ11"]["status"], "DESCRITIVA")
        self.assertEqual(stats["researchQuestions"]["RQ11"]["metric"]["independentEnforcementActivated"], 1)
        self.assertIn("enforcementEvidence", stats["researchQuestions"]["RQ5"]["availableEvidence"])

    def test_Given_governance_decision_When_technical_model_built_Then_factual_diagnostics_have_provenance(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory) / "synthetic"
            batch.mkdir()
            raw_a = run("A")
            raw_d = run(governanceDecision=decision(), evidenceCollectionStatus="VALID",
                        governanceDecisionSource="executions/run-D/project/.bsh/local/enforcement/session-one.json",
                        sessionId="session-one",
                        enforcementPipelineObserved=True, reportConflictCalled=False,
                        identifiedOperation="urn:generic:Action", identifiedShapes=["urn:generic:Shape"],
                        candidateEnforcementApplicable=True,
                        enforcementGateEvidence={"gateActivated": True, "blockedPromotion": True})
            raw = [raw_a, raw_d]
            for record in raw:
                path = batch / "executions" / record["runId"]
                path.mkdir(parents=True)
                (path / "project").mkdir()
                (path / "result.json").write_text(json.dumps(record), encoding="utf-8")
            evidence_path = batch / raw_d["governanceDecisionSource"]
            evidence_path.parent.mkdir(parents=True)
            write_json(evidence_path, raw_d["governanceDecision"])
            raw_d["governanceDecisionSha256"] = hashlib.sha256(evidence_path.read_bytes()).hexdigest()
            write_json(batch / "executions" / "run-D" / "result.json", raw_d)
            config = {"experiment": {"conditions": ["A", "D"], "tasks": ["task"],
                                     "replications": {"enabled": False}},
                      "agent": {"id": "codex", "model": "fixture-model", "reasoningEffort": "low"},
                      "project": {"ontologyDomain": "generic"}}
            metadata = {"lote": "synthetic", "agente": "codex", "modelo": "fixture-model",
                        "esforco": "low", "originInitialCommit": "base", "originFinalCommit": "base"}
            model, _, _, readiness = _model(batch, config, tasks=[{"id": "task", "tipo": "violadora"}],
                                             metadata=metadata, raw=raw, initial_issues=[],
                                             isolation={"status": "PASS", "requestedBatchId": "synthetic"})
            self.assertEqual(readiness["enforcementAnalysisPotentiallyReady"], True)
            tables = [table for table in model["tables"] if table["title"] == "Decisão e completude da validação por run"]
            self.assertEqual(len(tables), 1)
            self.assertIn("VIOLATION", str(tables[0]["rows"]))
            self.assertNotIn("RQ1", str(tables[0]))
            self.assertEqual(next(row for row in model["runs"] if row["condition"] == "D")["candidateFingerprint"], "candidate-hash")
            (batch / "config.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
            write_json(batch / "tasks.json", {"tarefas": [{"id": "task", "tipo": "violadora"}]})
            write_json(batch / "metadata.json", metadata)
            write_json(batch / "measurements.json", raw)
            result = generate_execution_report(batch)
            self.assertTrue(result["EXECUTION_REPORT_VALID"], result["layout"])
            self.assertIsNotNone(result["executionReportPath"])
            self.assertTrue(Path(result["latexPath"]).is_file())
            self.assertTrue(Path(result["executionReportPath"]).is_file())
            write_json(evidence_path, decision(reason="stale decision"))
            stale_model, _, _, stale_readiness = _model(batch, config, tasks=[{"id": "task", "tipo": "violadora"}],
                                                        metadata=metadata, raw=raw, initial_issues=[],
                                                        isolation={"status": "PASS", "requestedBatchId": "synthetic"})
            self.assertFalse(stale_readiness["READY_FOR_ANALYSIS"])
            self.assertIn("GOVERNANCE_PROVENANCE_MISMATCH", [issue["code"] for issue in stale_model["issues"]])


if __name__ == "__main__":
    unittest.main()
