"""Regressões Given/When/Then da especificação execution-instrumentation."""

import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from benchmark.adapters.codex import CodexBenchmarkAdapter
from benchmark.core.experimental_execution import InstrumentationCompletenessGate, normalize_runs, read_json
from benchmark.core.governance_observation import collect_governance_observation
from benchmark.core.models import CanonicalBenchmarkRun
from benchmark.core.run_invariants import run_instrumentation_issues
from benchmark.core.technical_execution_report import _compile_pdf, _origin, _render_latex
from benchmark.orchestrator import BenchmarkExperimentOrchestrator
from benchmark.strategies.base import evaluate_workspace_changes


def git(project: Path, *arguments: str) -> str:
    result = subprocess.run(["git", "-C", str(project), *arguments],
                            check=True, capture_output=True, text=True)
    return result.stdout.strip()


def project_with_commit(root: Path) -> tuple[Path, str]:
    project = root / "pilot"
    project.mkdir()
    (project / "src").mkdir()
    (project / "src" / "asset.js").write_text("export const value = 1;\n", encoding="utf-8")
    git(project, "init", "-q")
    git(project, "config", "user.name", "Fixture")
    git(project, "config", "user.email", "fixture@example.com")
    git(project, "config", "commit.gpgsign", "false")
    git(project, "add", "-A")
    git(project, "commit", "-q", "-m", "base")
    return project, git(project, "rev-parse", "HEAD")


def orchestrator(root: Path, project: Path) -> BenchmarkExperimentOrchestrator:
    tasks = root / "tasks.json"
    tasks.write_text(json.dumps({"tarefas": [{"id": "G1", "tipo": "valida_governada",
                                              "prompt": "fixture"}]}), encoding="utf-8")
    config = {"benchmark": {"maximumExecutions": 1, "randomizeExecutionOrder": False},
              "agent": {"id": "codex", "model": "gpt-5.6-sol", "reasoningEffort": "low"},
              "project": {"path": str(project)},
              "experiment": {"conditions": ["A"], "tasks": ["G1"],
                             "replications": {"enabled": False}}}
    runner = BenchmarkExperimentOrchestrator(config=config, tasks_path=tasks, batch_id="fixture-batch")
    runner.batch_dir = root / "fixture-batch"
    return runner


class NoAgentStrategy:
    def prepare_workspace(self, workspace_path: Path, base_commit: str) -> None:
        pass

    def execute(self, **kwargs):
        return {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5}, 0.01, "", "OK"


class ExecutionInstrumentationRegression(unittest.TestCase):
    def test_Given_consultative_C_When_observed_Then_no_independent_enforcement(self):
        """codex: Given C consultivo, When evidence is read, Then no semantic gate is claimed."""
        with TemporaryDirectory() as directory:
            project, base = project_with_commit(Path(directory))
            local = project / ".bsh" / "local"
            reports = local / "sessions"
            reports.mkdir(parents=True)
            (reports / "session-1.report.json").write_text(json.dumps({
                "sessionMode": "CONSULTATIVE", "promovido": False, "origemAlterada": False,
                "bloqueado": False, "enforcementExecutado": False, "origemHeadAntes": base,
            }), encoding="utf-8")
            (local / "session-1.jsonl").write_text(json.dumps({
                "event": "turn-completed", "status": "completed"}) + "\n", encoding="utf-8")
            evidence = collect_governance_observation(project)
            self.assertEqual(evidence["evidenceCollectionStatus"], "VALID")
            self.assertIsNone(evidence["enforcementGateEvidence"])
            self.assertFalse(evidence["enforcementPipelineObserved"])
            self.assertFalse(evidence["independentEnforcementActivated"])

    def test_Given_contradictory_gate_When_invariants_checked_Then_run_is_rejected(self):
        """codex: Given contradictory gate fields, When checked, Then reject the run."""
        run = CanonicalBenchmarkRun(runId="001-G1-D", batchId="fixture", taskId="G1",
                                   baseTaskId="G1", condition="D", agent="codex",
                                   originInitialCommit="a", originFinalCommit="a",
                                   originInitialTreeHash="x", originFinalTreeHash="x",
                                   originChanged=False, promoted=False, blocked=False,
                                   nonCachedTokensEligible=False,
                                   nonCachedTokensExclusionReason="runtime sem métrica",
                                   enforcementObserved=False, enforcementPipelineObserved=False,
                                   enforcementGateEvidence={"gateActivated": True,
                                                            "blockedPromotion": True,
                                                            "validationExecuted": False},
                                   governanceDecision={"promotionDecision": "DENY"})
        issues = run_instrumentation_issues(run)
        self.assertTrue(any("pipeline" in issue for issue in issues))
        self.assertTrue(any("blockedPromotion" in issue for issue in issues))

    def test_Given_C_with_gate_When_invariants_checked_Then_condition_is_rejected(self):
        """codex: Given an enforcement gate in C, When checked, Then reject contamination."""
        run = CanonicalBenchmarkRun(runId="001-G1-C", batchId="fixture", taskId="G1",
                                   baseTaskId="G1", condition="C", agent="codex",
                                   originInitialCommit="a", originFinalCommit="a",
                                   originInitialTreeHash="x", originFinalTreeHash="x",
                                   originChanged=False, promoted=False, sessionMode="CONSULTATIVE",
                                   nonCachedTokensEligible=False,
                                   nonCachedTokensExclusionReason="runtime sem métrica",
                                   enforcementObserved=False, enforcementPipelineObserved=True,
                                   independentEnforcementActivated=False,
                                   enforcementGateEvidence={"gateActivated": True})
        self.assertTrue(any("condição C" in issue for issue in run_instrumentation_issues(run)))

    def test_Given_origin_or_promotion_mismatch_When_checked_Then_evidence_is_required(self):
        """codex: Given conflicting Git evidence, When checked, Then reject promotion."""
        run = CanonicalBenchmarkRun(runId="001-G1-D", batchId="fixture", taskId="G1",
                                   baseTaskId="G1", condition="D", agent="codex",
                                   originInitialCommit="a", originFinalCommit="a",
                                   originInitialTreeHash="x", originFinalTreeHash="x",
                                   originChanged=True, promoted=True,
                                   nonCachedTokensEligible=False,
                                   nonCachedTokensExclusionReason="runtime sem métrica")
        issues = run_instrumentation_issues(run)
        self.assertTrue(any("originChanged" in issue for issue in issues))
        self.assertTrue(any("promoted=true" in issue for issue in issues))

    def test_Given_non_cached_metric_absent_When_eligible_Then_invariant_rejects_it(self):
        """codex: Given unavailable cache semantics, When eligible, Then reject null metric."""
        run = CanonicalBenchmarkRun(runId="001-G1-A", batchId="fixture", taskId="G1",
                                   baseTaskId="G1", condition="A", agent="codex",
                                   originInitialCommit="a", originFinalCommit="a",
                                   originInitialTreeHash="x", originFinalTreeHash="x",
                                   originChanged=False, nonCachedTokensEligible=True)
        self.assertTrue(any("nonCachedTokensEligible" in issue for issue in run_instrumentation_issues(run)))

    def test_Given_oracle_and_conflicting_observed_values_When_normalized_Then_ground_truth_comes_from_oracle(self):
        """codex: Given frozen oracle, When normalized, Then observed values cannot replace it."""
        task = {"id": "G1", "tipo": "valida_governada",
                "expectedOperation": "oracle-operation", "expectedShapes": ["oracle-shape"]}
        raw = {"batchId": "fixture", "runId": "001-G1-C", "condition": "C",
               "taskId": "G1", "baseTaskId": "G1", "replicationIndex": 1,
               "expectedOperation": "forged-operation", "expectedShape": "forged-shape",
               "identifiedOperation": "observed-operation", "identifiedShapes": ["observed-shape"]}
        row = normalize_runs("fixture", [raw], [task])[0]
        self.assertEqual(row["expectedOperation"], "oracle-operation")
        self.assertEqual(row["expectedShapes"], ["oracle-shape"])
        self.assertEqual(row["identifiedOperation"], "observed-operation")
        self.assertEqual(row["observedSource"], "executions/001-G1-C/result.json")
        self.assertEqual(row["expectedSource"], "tasks.json")

    def test_Given_codex_timeout_When_run_exits_Then_timeout_is_auditable(self):
        """codex: Given timeout, When exec expires, Then retain the cause."""
        adapter = CodexBenchmarkAdapter()
        expired = subprocess.TimeoutExpired(["codex", "exec"], 3, output=b'{"type":"turn.started"}\n',
                                            stderr=b"timeout diagnostic")
        with patch("benchmark.adapters.codex.subprocess.run", side_effect=expired):
            telemetry, _, output, status = adapter.run_direct(Path("/tmp"), "fixture", timeout_seconds=3)
        self.assertEqual(status, "FALHA_TECNICA")
        self.assertEqual(telemetry, {})
        self.assertIn("turn.started", output)
        self.assertEqual(adapter.last_execution_diagnostic["failureType"], "TIMEOUT")
        self.assertEqual(adapter.last_execution_diagnostic["processStderr"], "timeout diagnostic")
        self.assertIsNone(adapter.last_execution_diagnostic["processExitCode"])

    def test_Given_codex_nonzero_exit_When_run_exits_Then_exit_code_and_error_are_auditable(self):
        """codex: Given nonzero exit, When exec ends, Then retain code and stderr."""
        adapter = CodexBenchmarkAdapter()
        process = Mock(returncode=17, stdout='{"type":"turn.completed","usage":{"total_tokens":7}}\n',
                       stderr="runtime error")
        with patch("benchmark.adapters.codex.subprocess.run", return_value=process):
            telemetry, _, _, status = adapter.run_direct(Path("/tmp"), "fixture", timeout_seconds=3)
        self.assertEqual(status, "FALHA_TECNICA")
        self.assertEqual(telemetry["total_tokens"], 7)
        self.assertEqual(adapter.last_execution_diagnostic["failureType"], "NONZERO_EXIT")
        self.assertEqual(adapter.last_execution_diagnostic["processExitCode"], 17)
        self.assertEqual(adapter.last_execution_diagnostic["processStderr"], "runtime error")

    def test_Given_observed_zero_tokens_When_normalized_Then_zero_is_not_missing(self):
        tokens = CodexBenchmarkAdapter().normalize_telemetry({
            "inputTokens": 3, "cachedInputTokens": 0, "outputTokens": 2,
            "reasoningOutputTokens": 0, "totalTokens": 5,
        })
        self.assertEqual(tokens["cachedInputTokens"], 0)
        self.assertEqual(tokens["reasoningTokens"], 0)
        self.assertIsNone(tokens["nonCachedTokens"])

    def test_Given_no_change_When_workspace_evaluated_Then_tests_are_not_invented(self):
        with TemporaryDirectory() as directory:
            project, base = project_with_commit(Path(directory))
            result = evaluate_workspace_changes(project, base, {"tipo": "valida_governada"})
            self.assertFalse(result["changeSetDetected"])
            self.assertFalse(result["testsExecuted"])
            self.assertIsNone(result["testsPassed"])
            self.assertIsNone(result["diffSha256"])

    def test_Given_untracked_code_When_workspace_evaluated_Then_diff_has_provenance(self):
        with TemporaryDirectory() as directory:
            project, base = project_with_commit(Path(directory))
            added = project / "src" / "new.js"
            added.write_text("export const addition = 1;\n", encoding="utf-8")
            with patch("benchmark.strategies.base.run_node_tests", return_value=True):
                first = evaluate_workspace_changes(project, base, {"tipo": "valida_governada"})
                added.write_text("export const addition = 2;\n", encoding="utf-8")
                second = evaluate_workspace_changes(project, base, {"tipo": "valida_governada"})
            self.assertTrue(first["changeSetDetected"])
            self.assertTrue(first["testsExecuted"])
            self.assertTrue(first["testsPassed"])
            self.assertEqual(first["createdFiles"], 1)
            self.assertNotEqual(first["diffSha256"], second["diffSha256"])

    def test_Given_tracked_modification_and_removal_When_evaluated_Then_file_counts_are_distinct(self):
        with TemporaryDirectory() as directory:
            project, base = project_with_commit(Path(directory))
            tracked = project / "src" / "asset.js"
            tracked.write_text("export const value = 2;\n", encoding="utf-8")
            with patch("benchmark.strategies.base.run_node_tests", return_value=True):
                modified = evaluate_workspace_changes(project, base, {"tipo": "valida_governada"})
                tracked.unlink()
                removed = evaluate_workspace_changes(project, base, {"tipo": "valida_governada"})
            self.assertEqual(modified["modifiedFiles"], 1)
            self.assertEqual(modified["removedFiles"], 0)
            self.assertEqual(removed["modifiedFiles"], 0)
            self.assertEqual(removed["removedFiles"], 1)

    def test_Given_no_tests_When_normalized_Then_result_is_not_applicable(self):
        raw = {"batchId": "fixture", "runId": "001-G1-A", "condition": "A",
               "taskId": "G1", "baseTaskId": "G1", "replicationIndex": 1,
               "testsExecuted": False, "testsPassed": None}
        run = normalize_runs("fixture", [raw], [{"id": "G1", "tipo": "valida_governada"}])[0]
        self.assertEqual(run["availability"]["testsPassed"], "NOT_APPLICABLE")
        coverage = InstrumentationCompletenessGate().evaluate([run])["byCondition"]["A"]["testCoverage"]
        self.assertEqual(coverage["expected"], 0)

    def test_Given_condition_setup_When_workspace_prepared_Then_setup_is_baseline(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project, _ = project_with_commit(root)
            old_local = project / ".bsh" / "local"
            old_local.mkdir(parents=True)
            (old_local / "session-old.jsonl").write_text("old", encoding="utf-8")
            runner = orchestrator(root, project)
            workspace, base = runner.prepare_workspace("001-G1-B", "B")
            self.assertFalse((workspace / ".bsh" / "local").exists())
            self.assertTrue((workspace / "AGENTS.md").is_file())
            result = evaluate_workspace_changes(workspace, base, {"tipo": "valida_governada"})
            self.assertFalse(result["changeSetDetected"])

    def test_Given_stubbed_adapter_When_plan_runs_Then_required_observations_are_recorded(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project, source_commit = project_with_commit(root)
            runner = orchestrator(root, project)
            with patch("benchmark.core.semantic_preflight.run_semantic_preflight", return_value={"status": "APPROVED"}), \
                 patch("benchmark.core.technical_execution_report.generate_execution_report"), \
                 patch.dict("benchmark.orchestrator.CONDITION_STRATEGIES", {"A": NoAgentStrategy()}):
                runner.execute_plan()
            record = read_json(runner.batch_dir / "executions" / "001-G1-A" / "result.json")
            metadata = read_json(runner.batch_dir / "metadata.json")
            self.assertLessEqual(record["startedAt"], record["finishedAt"])
            self.assertEqual(record["executionStatus"], "OK")
            self.assertFalse(record["testsExecuted"])
            self.assertIsNone(record["testsPassed"])
            self.assertFalse(record["unexpectedOriginChange"])
            self.assertEqual((record["originInitialCommit"], record["originFinalCommit"]),
                             (record["baseCommit"], record["baseCommit"]))
            self.assertEqual((metadata["originInitialCommit"], metadata["originFinalCommit"]),
                             (source_commit, source_commit))
            self.assertEqual(metadata["originInitialTreeHash"], metadata["originFinalTreeHash"])

    def test_Given_missing_required_telemetry_When_robustness_enabled_Then_run_flagged_and_plan_continues(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            project, _ = project_with_commit(root)
            runner = orchestrator(root, project)
            runner.config["benchmark"].update({"maximumExecutions": 2,
                                                 "failFastOnInstrumentationError": True})
            runner.configured_max_runs = 2
            runner.config["experiment"]["conditions"] = ["A", "B"]
            runner.configured_conditions = ["A", "B"]
            strategy = NoAgentStrategy()
            with patch("benchmark.core.semantic_preflight.run_semantic_preflight", return_value={"status": "APPROVED"}), \
                 patch("benchmark.core.technical_execution_report.generate_execution_report"), \
                 patch.dict("benchmark.orchestrator.CONDITION_STRATEGIES", {"A": strategy, "B": strategy}):
                runner.execute_plan()
            records = read_json(runner.batch_dir / "measurements.json")
            self.assertEqual(len(records), 2)
            self.assertTrue(all(r.get("executionStatus") == "FALHA_INSTRUMENTACAO" for r in records))
            self.assertTrue((runner.batch_dir / "metadata.json").is_file())

    def test_Given_changed_source_tree_When_origin_checked_Then_integrity_fails(self):
        with TemporaryDirectory() as directory:
            batch = Path(directory)
            observed = _origin(batch, [], {"originInitialCommit": "base", "originFinalCommit": "base",
                                           "originInitialTreeHash": "before", "originFinalTreeHash": "after"})
            self.assertFalse(observed["integrityConfirmed"])

    def test_Given_wide_technical_table_When_latex_converted_Then_layout_has_no_overflow(self):
        with TemporaryDirectory() as directory:
            headers = ["runId", "evidenceCollectionStatus", "validationStatus", "validationExecuted",
                       "validationComplete", "policyDecision", "promotionDecision",
                       "candidateFingerprint", "failureStage", "governanceReason"]
            model = {"title": "Relatório Técnico da Execução Experimental",
                     "subtitle": "Registro técnico", "batchId": "fixture-batch",
                     "identity": {}, "executionStatus": "INCOMPLETE",
                     "completion": {"plannedRuns": 58, "observedRuns": 3},
                     "readiness": {"overallStatus": "NOT_READY_FOR_ANALYSIS"},
                     "sections": ["Enforcement"],
                     "tables": [{"section": "Enforcement", "title": "Decisão e completude da validação por run",
                                 "units": "registros", "n": 3, "sourceArtifact": "executions/*/project/.bsh/local/enforcement/*.json",
                                 "headers": headers,
                                 "rows": [["001-V13-C", "VALID", "CONFORMING", "True", "True", "ALLOW", "ALLOW",
                                           "57713968b9b71b8452bc4c6ea13948e723d1189b16b03630c2b32b66b3ce781f",
                                           "MISSING", "Estado candidato validado e conforme"]] * 3}]}
            tex = Path(directory) / "execution-report-fixture.tex"
            tex.write_text(_render_latex(model), encoding="utf-8")
            layout = _compile_pdf(tex)
            self.assertEqual(layout["status"], "PASS", layout)


if __name__ == "__main__":
    unittest.main()
