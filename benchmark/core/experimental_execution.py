"""Read-only scientific interpretation of one frozen experimental execution.

No value from the task oracle is used as an observed result.  Missing values
remain ``None`` throughout the analysis pipeline.
"""

from __future__ import annotations

from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
from typing import Any


from .enums import Classification, DataAvailability, ExecutionCompletion, GovernanceMechanism


BATCH_ID_PATTERN = re.compile(r"^[A-Za-z]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$")


AUDITED_FIELDS = (
    "runId", "batchId", "condition", "taskId", "baseTaskId", "replicationIndex",
    "startedAt", "finishedAt", "durationSeconds", "inputTokens", "cachedInputTokens",
    "outputTokens", "reasoningTokens", "totalTokens", "rawTelemetry",
    "changeSetDetected", "modifiedFiles", "createdFiles", "removedFiles",
    "addedLines", "removedLines", "diffSha256", "testsExecuted", "testsPassed",
    "ontologyQueried", "reportConflictCalled", "identifiedOperation", "identifiedShapes",
    "enforcementPipelineObserved", "candidateEnforcementApplicable",
    "independentEnforcementActivated", "enforcementStatus", "promoted",
    "originChanged", "classification", "validationStatus", "validationExecuted",
    "validationComplete", "policyDecision", "promotionDecision",
    "candidateFingerprint", "candidateGraphHash", "selectedShapes",
    "executedShapes", "missingFacts", "failureStage",
    "governanceDecisionSha256", "evidenceCollectionStatus",
)

METRIC_COVERAGE = {
    "tokenCoverage": ("totalTokens",),
    "durationCoverage": ("durationSeconds",),
    "testCoverage": ("testsExecuted", "testsPassed"),
    "diffCoverage": ("changeSetDetected", "diffSha256"),
    "semanticEvidenceCoverage": ("identifiedOperation", "identifiedShapes"),
    "enforcementCoverage": ("enforcementPipelineObserved", "validationStatus",
                            "validationExecuted", "validationComplete", "promotionDecision"),
    "classificationCoverage": ("classification",),
}

DERIVED_ARTIFACTS = {
    "normalized-runs.json", "classified-runs.json", "paired-results.csv", "paired-a-b.csv",
    "paired-b-c.csv", "paired-c-d.csv", "paired-a-d.csv", "statistics.json",
    "evidence-matrix.json", "verdicts.json", "report-model.json",
    "report-number-provenance.json", "scientific-hashes.json",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256_file(path: Path) -> str | None:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def task_list(tasks: Any) -> list[dict[str, Any]]:
    values = tasks.get("tarefas") or tasks.get("tasks") or [] if isinstance(tasks, dict) else tasks
    return [item for item in values if isinstance(item, dict)]


def run_identity(run: dict[str, Any]) -> tuple[str, str, int, str | None]:
    task_id = str(run.get("taskId") or run.get("tarefa") or "")
    base = str(run.get("baseTaskId") or task_id.split("#")[0])
    suffix = task_id.split("#", 1)
    raw_rep = run.get("replicationIndex")
    rep = int(raw_rep) if raw_rep is not None else (int(suffix[1]) if len(suffix) == 2 and suffix[1].isdigit() else 1)
    return str(run.get("condition") or run.get("condicao") or ""), base, rep, run.get("promptVariantId")


def identity_label(identity: tuple[str, str, int, str | None]) -> str:
    condition, base, rep, variant = identity
    return f"{base}#{rep}:{condition}" + (f":{variant}" if variant else "")


def _planned_identities(config: dict[str, Any], metadata: dict[str, Any], tasks: list[dict[str, Any]]) -> list[tuple[str, str, int, str | None]]:
    experiment = config.get("experiment", {})
    conditions = experiment.get("conditions")
    task_ids = experiment.get("tasks")
    if not isinstance(conditions, list) or not isinstance(task_ids, list):
        raise ValueError("Configuração congelada sem condições ou tarefas")
    known = {str(item.get("baseTaskId") or item.get("taskId") or item.get("id")) for item in tasks}
    if any(str(task) not in known for task in task_ids):
        raise ValueError("Plano referencia tarefa ausente do manifesto congelado")
    planned = [(str(condition), str(task), 1, None) for task in task_ids for condition in conditions]
    replications = experiment.get("replications") or {}
    if replications.get("enabled"):
        additional = [(condition, str(task), 2, None)
                      for task in task_ids for condition in ("D", "A") if condition in conditions]
        limit = replications.get("maximumAdditionalExecutions", len(additional))
        if not isinstance(limit, int) or limit < 0:
            raise ValueError("Limite de replicações inválido")
        planned.extend(additional[:limit])
    maximum = config.get("benchmark", {}).get("maximumExecutions")
    if maximum is not None:
        if not isinstance(maximum, int) or maximum < 1:
            raise ValueError("Número máximo de runs inválido")
        planned = planned[:maximum]
    return planned


class ExperimentalExecutionCompletionGate:
    def __init__(self, batch_dir: Path):
        self.batch_dir = Path(batch_dir)

    def evaluate(self, config: dict[str, Any], tasks: list[dict[str, Any]], metadata: dict[str, Any], runs: list[dict[str, Any]]) -> dict[str, Any]:
        batch_id = self.batch_dir.name
        reasons: list[str] = []
        try:
            planned = _planned_identities(config, metadata, tasks)
        except (ValueError, TypeError) as error:
            planned = []
            reasons.append(str(error))
        counts = Counter(run_identity(run) for run in runs)
        planned_counts = Counter(planned)
        order = metadata.get("ordemExecucao")
        if isinstance(order, list):
            if len(order) != len(set(order)):
                reasons.append("ordemExecucao contém runId duplicado")
            if set(order) != {run.get("runId") for run in runs}:
                reasons.append("ordemExecucao diverge dos runIds observados")
        missing = sorted((identity_label(key) for key in planned_counts for _ in range(max(0, planned_counts[key] - counts[key]))))
        duplicate = sorted(identity_label(key) for key, count in counts.items() if count > 1)
        unexpected = sorted(identity_label(key) for key in counts if key not in planned_counts)
        pending = [str(run.get("runId")) for run in runs if str(run.get("executionStatus") or run.get("status") or "").upper() == "PENDING"]
        running = [str(run.get("runId")) for run in runs if str(run.get("executionStatus") or run.get("status") or "").upper() == "RUNNING"]
        failed = [str(run.get("runId")) for run in runs if str(run.get("executionStatus") or run.get("status") or "").upper() in {"FAILED", "FALHA_TECNICA", "FALHA_INSTRUMENTACAO"}]
        completed = len(runs) - len(pending) - len(running) - len(failed)
        if metadata.get("lote") not in (None, batch_id):
            reasons.append("metadata.lote difere do batchId")
        if any(not run.get("runId") for run in runs):
            reasons.append("Run sem runId")
        if duplicate or unexpected:
            reasons.append("Runs duplicadas ou inesperadas")
        if reasons:
            status = ExecutionCompletion.INVALID
        elif failed or pending or running:
            status = ExecutionCompletion.INCOMPLETE_NOT_RESUMABLE
        elif missing:
            status = ExecutionCompletion.INCOMPLETE_RESUMABLE
        else:
            status = ExecutionCompletion.COMPLETE
        planned_conditions = set(config.get("experiment", {}).get("conditions", []))
        planned_tasks = set(config.get("experiment", {}).get("tasks", []))
        observed_conditions = {run_identity(run)[0] for run in runs}
        observed_tasks = {run_identity(run)[1] for run in runs}
        return {
            "batchId": batch_id, "completionStatus": status.value,
            "plannedRuns": len(planned), "observedRuns": len(runs), "completedRuns": completed,
            "failedRuns": len(failed), "missingRuns": len(missing), "duplicateRuns": len(duplicate),
            "unexpectedRuns": len(unexpected), "pendingRuns": len(pending), "runningRuns": len(running),
            "missingRunKeys": missing, "duplicateRunKeys": duplicate, "unexpectedRunKeys": unexpected,
            "missingConditions": sorted(planned_conditions - observed_conditions),
            "missingTasks": sorted(planned_tasks - observed_tasks),
            "missingReplications": sorted({int(key.split(":")[0].split("#")[1]) for key in missing}),
            "reasons": reasons,
        }


class BatchIsolationGate:
    def __init__(self, batch_dir: Path, analysis_batch_id: str):
        self.batch_dir = Path(batch_dir)
        self.analysis_batch_id = analysis_batch_id

    def evaluate(self, runs: list[dict[str, Any]]) -> dict[str, Any]:
        categories: dict[str, list[str]] = {name: [] for name in (
            "foreignBatchRuns", "foreignBatchArtifacts", "foreignBatchStatistics", "foreignBatchFigures",
            "foreignBatchTables", "foreignBatchEvidence", "foreignBatchVerdicts", "foreignBatchReferences",
        )}
        for run in runs:
            if run.get("batchId") != self.analysis_batch_id:
                categories["foreignBatchRuns"].append(str(run.get("runId")))
        figure_dir = self.batch_dir / "figures"
        if figure_dir.is_dir() and any(path.is_file() for path in figure_dir.iterdir()):
            manifest = figure_dir / "manifest.json"
            try:
                figure_manifest = read_json(manifest) if manifest.is_file() else {}
            except (ValueError, UnicodeError):
                figure_manifest = {}
            if not isinstance(figure_manifest, dict) or figure_manifest.get("batchId") != self.analysis_batch_id:
                categories["foreignBatchFigures"].append("figures/manifest.json")
        for path in self.batch_dir.rglob("*"):
            if not path.is_file() or path.name in {"measurements.json", "tasks.json", "config.yaml"}:
                continue
            if path.suffix not in {".json", ".csv", ".tex", ".md"}:
                continue
            relative = str(path.relative_to(self.batch_dir))
            if path.suffix == ".json":
                try:
                    data = read_json(path)
                except (ValueError, UnicodeError):
                    categories["foreignBatchArtifacts"].append(relative)
                    continue
                ids: set[str] = set()
                def walk(value: Any) -> None:
                    if isinstance(value, dict):
                        for key, item in value.items():
                            if key == "availability":
                                continue
                            if key in {"batchId", "sourceBatchId", "analysisBatchId"} and isinstance(item, str):
                                ids.add(item)
                            else:
                                walk(item)
                    elif isinstance(value, list):
                        for item in value:
                            walk(item)
                walk(data)
                if not ids or ids == {self.analysis_batch_id}:
                    continue
            else:
                text = path.read_text(encoding="utf-8", errors="replace")
                ids = {value for value in re.findall(r"(?:batchId|analysisBatchId)[\s:=\"']+([\w-]+)", text)
                       if BATCH_ID_PATTERN.match(value)}
                if not ids or ids == {self.analysis_batch_id}:
                    continue
            category = "foreignBatchArtifacts"
            if "statistic" in relative: category = "foreignBatchStatistics"
            elif "figure" in relative: category = "foreignBatchFigures"
            elif "table" in relative: category = "foreignBatchTables"
            elif "evidence" in relative: category = "foreignBatchEvidence"
            elif "verdict" in relative: category = "foreignBatchVerdicts"
            elif "reference" in relative: category = "foreignBatchReferences"
            categories[category].append(f"{relative}: {sorted(ids)}")
        status = "PASS" if not any(categories.values()) else "HARD_FAIL"
        return {"batchId": self.analysis_batch_id, "status": status, **{key: len(value) for key, value in categories.items()}, "details": categories}


def availability(value: Any, applicable: bool = True) -> str:
    if not applicable:
        return DataAvailability.NOT_APPLICABLE.value
    if value is None:
        return DataAvailability.MISSING.value
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        return DataAvailability.INVALID.value
    if value is False or value == 0 or value == []:
        return DataAvailability.OBSERVED_ZERO.value
    return DataAvailability.PRESENT.value


def _observed(run: dict[str, Any], field: str, *aliases: str) -> Any:
    for key in (field, *aliases):
        if key in run:
            return run[key]
    return None


def _nonnegative_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    return number if 0 <= number < float("inf") else None


_LEGACY_SEMANTIC_STATUS = {"CONFORMING": "conforme", "VIOLATION": "violacao",
                           "INDETERMINATE": "indeterminado", "VALIDATION_ERROR": "erro_validacao"}


def _semantic_status(source: dict[str, Any], decision: dict[str, Any] | None) -> str | None:
    canonical = decision.get("validationStatus") if decision else source.get("validationStatus")
    if canonical is not None:
        return _LEGACY_SEMANTIC_STATUS.get(canonical)
    legacy = source.get("semanticStatus") or source.get("enforcementStatus")
    return legacy if legacy in _LEGACY_SEMANTIC_STATUS.values() or legacy == "revisao_humana" else None


def oracle_candidate_validity(task: dict[str, Any]) -> str:
    """Validade semântica do candidato segundo o oráculo independente da tarefa congelada."""
    expected = str(task.get("expectedSemanticOutcome") or "").strip().lower()
    if expected in ("violacao", "violacao_semantica", "invalid"):
        return "INVALID"
    if expected in ("conforme", "valid", "conforme_semantica"):
        return "VALID"
    return "INDETERMINATE"


def normalize_runs(batch_id: str, runs: list[dict[str, Any]], tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_task = {str(item.get("baseTaskId") or item.get("taskId") or item.get("id")): item for item in tasks}
    result = []
    for source in runs:
        decision = source.get("governanceDecision") if isinstance(source.get("governanceDecision"), dict) else None
        semantic_status = _semantic_status(source, decision)
        condition, base, rep, variant = run_identity(source)
        task = by_task.get(base, {})
        row: dict[str, Any] = {
            "runId": source.get("runId") or source.get("execucao"),
            "batchId": source.get("batchId"), "condition": condition,
            "taskId": source.get("taskId") or source.get("tarefa"), "baseTaskId": base,
            "sessionId": source.get("sessionId"),
            "replicationIndex": rep, "promptVariantId": variant,
            "taskType": task.get("taskType") or task.get("tipo"),
            "taskCategory": task.get("semanticClusterId") or task.get("taskType") or task.get("tipo"),
            "operation": task.get("expectedOperation") or task.get("operacao"),
            "difficulty": task.get("difficulty"),
            "agent": _observed(source, "agent", "agente"),
            "model": _observed(source, "model", "modelo"),
            "reasoningEffort": source.get("reasoningEffort"),
            "adapter": source.get("adapter"), "adapterVersion": source.get("adapterVersion"),
            "runtime": source.get("runtime"),
            "telemetrySchemaVersion": source.get("telemetrySchemaVersion"),
            "tokenAccountingVersion": source.get("tokenAccountingVersion"),
            "startedAt": source.get("startedAt"), "finishedAt": source.get("finishedAt"),
            "durationSeconds": _nonnegative_number(_observed(source, "durationSeconds", "tempo")),
            "rawTelemetry": source.get("rawTelemetry"),
            "inputTokens": _nonnegative_number(_observed(source, "inputTokens", "entrada")),
            "cachedInputTokens": _nonnegative_number(_observed(source, "cachedInputTokens", "cache")),
            "outputTokens": _nonnegative_number(_observed(source, "outputTokens", "saida")),
            "reasoningTokens": _nonnegative_number(_observed(source, "reasoningTokens", "raciocinio")),
            "totalTokens": _nonnegative_number(_observed(source, "totalTokens", "totais")),
            "changeSetDetected": _observed(source, "changeSetDetected"),
            "modifiedFiles": _observed(source, "modifiedFiles"),
            "createdFiles": _observed(source, "createdFiles"),
            "removedFiles": _observed(source, "removedFiles"),
            "addedLines": _observed(source, "addedLines", "adicionadas"),
            "removedLines": _observed(source, "removedLines", "removidas"),
            "diffSha256": source.get("diffSha256"),
            "testsExecuted": _observed(source, "testsExecuted", "technicalGatesObserved", "technicalGatesExecuted"),
            "testsPassed": _observed(source, "testsPassed", "technicalGatesPassed"),
            "ontologyQueried": source.get("ontologyQueried"),
            "reportConflictCalled": source.get("reportConflictCalled"),
            "identifiedOperation": _observed(source, "identifiedOperation", "identifiedGovernedOperation"),
            "identifiedShapes": source.get("identifiedShapes"),
            "enforcementPipelineObserved": _observed(source, "enforcementPipelineObserved", "enforcementObserved", "enforcementExecuted"),
            "enforcementGateEvidence": source.get("enforcementGateEvidence"),
            "candidateEnforcementApplicable": source.get("candidateEnforcementApplicable"),
            "candidateCommit": source.get("candidateCommit"),
            "candidateCreated": source.get("candidateCreated"),
            "candidateInitialTreeHash": source.get("candidateInitialTreeHash"),
            "candidateFinalTreeHash": source.get("candidateFinalTreeHash"),
            "codeBaseChanged": source.get("codeBaseChanged"),
            "changeDisposition": source.get("changeDisposition"),
            "candidateSemanticValidity": source.get("candidateSemanticValidity") or "INDETERMINATE",
            "solicitacaoPermitida": oracle_candidate_validity(task) == "VALID",
            "enforcementOutcomeObserved": source.get("enforcementOutcomeObserved"),
            "enforcementCorrectness": source.get("enforcementCorrectness") or "NOT_EVALUATED",
            "independentEnforcementActivated": source.get("independentEnforcementActivated"),
            "enforcementStatus": semantic_status,
            "semanticStatus": semantic_status,
            "governanceDecision": decision,
            "evidenceCollectionStatus": source.get("evidenceCollectionStatus"),
            "evidenceCollectionIssue": source.get("evidenceCollectionIssue"),
            "sessionReportSource": source.get("sessionReportSource"),
            "governanceDecisionSource": source.get("governanceDecisionSource"),
            "governanceDecisionSha256": source.get("governanceDecisionSha256"),
            "validationStatus": decision.get("validationStatus") if decision else source.get("validationStatus"),
            "validationExecuted": decision.get("validationExecuted") if decision else None,
            "validationComplete": decision.get("validationComplete") if decision else None,
            "policyDecision": decision.get("policyDecision") if decision else None,
            "promotionDecision": decision.get("promotionDecision") if decision else None,
            "candidateFingerprint": decision.get("candidateFingerprint") if decision else None,
            "candidateGraphHash": decision.get("candidateGraphHash") if decision else None,
            "recognizedOperation": decision.get("recognizedOperation") if decision else None,
            "selectedShapes": decision.get("selectedShapes") if decision else None,
            "executedShapes": decision.get("executedShapes") if decision else None,
            "factsExtracted": decision.get("factsExtracted") if decision else None,
            "missingFacts": decision.get("missingFacts") if decision else None,
            "violations": decision.get("violations") if decision else None,
            "failureStage": decision.get("failureStage") if decision else None,
            "governanceReason": decision.get("reason") if decision else None,
            "promoted": source.get("promoted"), "originChanged": source.get("originChanged"),
            "violacaoImplementada": source.get("violacaoImplementada"),
            "functionalCorrectnessObserved": source.get("functionalCorrectness"),
            "behavioralEquivalence": source.get("behavioralEquivalence"),
            "executionStatus": source.get("executionStatus") or source.get("status"),
            "expectedOperation": task.get("expectedOperation") or task.get("operacao"),
            "expectedShapes": task.get("expectedShapes") or ([task.get("expectedShape") or task.get("shape")] if task.get("expectedShape") or task.get("shape") else []),
            "expectedSource": "tasks.json",
            "observedSource": source.get("observedSource") or (f"executions/{source.get('runId')}/result.json" if source.get("runId") else None),
        }
        governed_fields = {"ontologyQueried", "reportConflictCalled", "identifiedOperation", "identifiedShapes",
    "enforcementPipelineObserved", "candidateEnforcementApplicable", "candidateCommit",
    "candidateCreated", "codeBaseChanged", "changeDisposition", "candidateSemanticValidity",
    "enforcementOutcomeObserved", "enforcementCorrectness",
                           "independentEnforcementActivated", "enforcementStatus", "validationStatus",
                           "validationExecuted", "validationComplete", "policyDecision", "promotionDecision",
                           "candidateFingerprint", "candidateGraphHash", "selectedShapes", "executedShapes",
                           "missingFacts", "failureStage", "governanceDecisionSha256", "evidenceCollectionStatus"}
        enforcement_only = {"enforcementStatus", "validationStatus", "validationExecuted",
                            "validationComplete", "policyDecision", "promotionDecision",
                            "candidateFingerprint", "candidateGraphHash", "selectedShapes",
                            "executedShapes", "missingFacts", "failureStage", "governanceDecisionSha256"}
        row["availability"] = {
            field: availability(row.get(field), applicable=(
                condition == "D" if field in enforcement_only else
                condition in {"C", "D"} if field in governed_fields else True))
            for field in AUDITED_FIELDS}
        if row["testsExecuted"] is False:
            row["availability"]["testsPassed"] = DataAvailability.NOT_APPLICABLE.value
        numeric_sources = {
            "durationSeconds": ("durationSeconds", "tempo"),
            "inputTokens": ("inputTokens", "entrada"),
            "cachedInputTokens": ("cachedInputTokens", "cache"),
            "outputTokens": ("outputTokens", "saida"),
            "reasoningTokens": ("reasoningTokens", "raciocinio"),
            "totalTokens": ("totalTokens", "totais"),
            "addedLines": ("addedLines", "adicionadas"),
            "removedLines": ("removedLines", "removidas"),
            "modifiedFiles": ("modifiedFiles",),
            "createdFiles": ("createdFiles",),
            "removedFiles": ("removedFiles",),
        }
        for field, names in numeric_sources.items():
            raw_value = _observed(source, names[0], *names[1:])
            if raw_value is not None and _nonnegative_number(raw_value) is None:
                row["availability"][field] = DataAvailability.INVALID.value
                row[field] = None
        result.append(row)
    return sorted(result, key=lambda row: (row["baseTaskId"], row["replicationIndex"], row["condition"], row["runId"] or ""))


def classify_observed(row: dict[str, Any]) -> dict[str, Any]:
    """Single outcome decision table; oracle type informs only expected behavior."""
    task_type = row.get("taskType")
    changed = row.get("changeSetDetected")
    promoted = row.get("promoted")
    origin = row.get("originChanged")
    tests = row.get("testsPassed")
    status = str(row.get("executionStatus") or "").upper()
    if row.get("evidenceCollectionStatus") == "INVALID" or status == "FALHA_INSTRUMENTACAO":
        cls = Classification.FALHA_INSTRUMENTACAO
    elif status == "FALHA_TECNICA":
        cls = Classification.FALHA_TECNICA
    elif changed is None or origin is None or (promoted is None and row["condition"] not in {"A", "B"}):
        cls = Classification.INDETERMINADO
    elif task_type == "violadora":
        if row["condition"] in {"A", "B"}:
            # A/B não executam governança: o critério é funcional e explícito.
            cls = Classification.ALTERACAO_INCORRETA if changed else Classification.SEM_ALTERACAO_CORRETA
        elif promoted or origin:
            cls = Classification.VIOLACAO_NAO_DETECTADA if row.get("candidateSemanticValidity") == "INVALID" else Classification.INDETERMINADO
        elif row.get("candidateEnforcementApplicable") is True:
            if (row.get("semanticStatus") == "violacao" and row.get("validationComplete") is True
                    and row.get("enforcementPipelineObserved") is True
                    and row.get("candidateSemanticValidity") == "INVALID"):
                cls = Classification.BLOQUEIO_CORRETO
            else:
                cls = Classification.INDETERMINADO
        elif changed and row.get("semanticStatus") == "violacao" and row.get("validationComplete") is True and row.get("enforcementPipelineObserved") is True and row.get("candidateSemanticValidity") == "INVALID":
            cls = Classification.BLOQUEIO_CORRETO
        elif not changed and not promoted and not origin:
            cls = Classification.SEM_ALTERACAO_CORRETA
        elif changed:
            cls = Classification.ALTERACAO_INCORRETA
        else:
            cls = Classification.INDETERMINADO
    elif task_type in {"valida_governada", "valida", "valida_livre"}:
        if row["condition"] in {"A", "B"}:
            # A/B não executam governança: o critério é funcional (mudança aplicada + testes).
            if changed and tests is True:
                cls = Classification.ALTERACAO_CORRETA
            elif changed and tests is False:
                cls = Classification.ALTERACAO_INCORRETA
            elif not changed:
                cls = Classification.SEM_ALTERACAO_INCORRETA
            else:
                cls = Classification.INDETERMINADO
        elif changed and promoted and origin and tests is True:
            cls = Classification.ALTERACAO_CORRETA
        elif row.get("candidateEnforcementApplicable") is True and not promoted:
            if row.get("semanticStatus") == "revisao_humana":
                cls = Classification.REVISAO_HUMANA
            elif row.get("candidateSemanticValidity") == "VALID":
                cls = Classification.FALSO_BLOQUEIO
            elif row.get("candidateSemanticValidity") == "INVALID":
                cls = Classification.BLOQUEIO_CORRETO
            else:
                cls = Classification.INDETERMINADO
        elif changed and not promoted and row.get("semanticStatus") == "revisao_humana":
            cls = Classification.REVISAO_HUMANA
        elif changed and not promoted and row.get("semanticStatus") == "violacao":
            if row.get("candidateSemanticValidity") == "VALID":
                cls = Classification.FALSO_BLOQUEIO
            elif row.get("candidateSemanticValidity") == "INVALID":
                cls = Classification.BLOQUEIO_CORRETO
            else:
                cls = Classification.INDETERMINADO
        elif not changed:
            cls = Classification.SEM_ALTERACAO_INCORRETA
        elif changed and tests is False:
            cls = Classification.ALTERACAO_INCORRETA
        else:
            cls = Classification.INDETERMINADO
    elif not changed:
        cls = Classification.SEM_ALTERACAO_INDETERMINADA
    else:
        cls = Classification.INDETERMINADO

    independent = all((
        row.get("candidateEnforcementApplicable") is True,
        row.get("semanticStatus") == "violacao", row.get("reportConflictCalled") is False,
        row.get("enforcementPipelineObserved") is True,
        row.get("validationExecuted") is True, row.get("validationComplete") is True,
        row.get("policyDecision") == "DENY", row.get("promotionDecision") == "DENY",
        isinstance(row.get("candidateFingerprint"), str),
        isinstance(row.get("enforcementGateEvidence"), dict),
        (row.get("enforcementGateEvidence") or {}).get("gateActivated") is True,
        (row.get("enforcementGateEvidence") or {}).get("blockedPromotion") is True,
        promoted is False, origin is False,
    ))
    if row["condition"] == "A":
        mechanism = GovernanceMechanism.NONE
    elif independent:
        mechanism = GovernanceMechanism.ENFORCEMENT_INDEPENDENTE
    elif row.get("reportConflictCalled") is True:
        mechanism = GovernanceMechanism.CONFLITO_REPORTADO
    elif row.get("candidateEnforcementApplicable") is True and promoted is False and row.get("enforcementPipelineObserved") is True:
        mechanism = GovernanceMechanism.INDETERMINADO
    elif row.get("ontologyQueried") is True and changed is False:
        mechanism = GovernanceMechanism.CONSULTA_PREVENTIVA
    elif row.get("semanticStatus") == "revisao_humana":
        mechanism = GovernanceMechanism.REVISAO_HUMANA
    elif tests is False and changed is True and promoted is False:
        mechanism = GovernanceMechanism.GATE_TECNICO
    elif row["condition"] in {"C", "D"} and promoted is True and row.get("semanticStatus") == "conforme":
        mechanism = GovernanceMechanism.PASSAGEM_CONFORME
    else:
        mechanism = GovernanceMechanism.INDETERMINADO
    violation = task_type == "violadora"
    if violation:
        prompt_fulfillment = bool(changed and (promoted or origin)) if changed is not None else None
        functional = None
        governance = (not promoted and not origin) if promoted is not None and origin is not None else None
        outcome = governance
    else:
        functional_observed = row.get("functionalCorrectnessObserved")
        if row["condition"] in {"A", "B"}:
            # A/B: critério funcional explícito; validade semântica verificada é NOT_EVALUATED.
            prompt_fulfillment = bool(changed) if changed is not None else None
            functional = (changed and tests is True) if changed is not None and tests is not None else None
            governance = None
            outcome = functional
        else:
            prompt_fulfillment = bool(changed and promoted) if changed is not None and promoted is not None else None
            functional = functional_observed if isinstance(functional_observed, bool) else None
            governance = (cls != Classification.FALSO_BLOQUEIO) if cls not in {Classification.INDETERMINADO, Classification.FALHA_TECNICA, Classification.FALHA_INSTRUMENTACAO} else None
            outcome = bool(functional and governance) if functional is not None and governance is not None else None
    return {**row, "classification": cls.value, "governanceMechanism": mechanism.value,
            "governanceInteraction": "PREVENTIVA" if row.get("ontologyQueried") is True else ("DIAGNOSTICA" if row.get("enforcementPipelineObserved") is True else "INEXISTENTE"),
            "governanceIntervention": "BLOQUEANTE" if independent else ("CONSULTIVA" if mechanism in {GovernanceMechanism.CONSULTA_PREVENTIVA, GovernanceMechanism.CONFLITO_REPORTADO} else "INEXISTENTE"),
            "independentEnforcementActivated": independent,
            "promptFulfillment": prompt_fulfillment, "functionalCorrectness": functional,
            "governanceCorrectness": governance, "taskOutcomeCorrect": outcome}


class InstrumentationCompletenessGate:
    def evaluate(self, runs: list[dict[str, Any]]) -> dict[str, Any]:
        by_condition: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for run in runs:
            by_condition[run["condition"]].append(run)
        coverage: dict[str, Any] = {}
        field_coverage: dict[str, Any] = {}
        for condition in ("A", "B", "C", "D"):
            group = by_condition[condition]
            coverage[condition] = {"runs": len(group)}
            field_coverage[condition] = {}
            for name, fields in METRIC_COVERAGE.items():
                if name == "enforcementCoverage":
                    applicable_fields = fields if condition == "D" else (
                        ("enforcementPipelineObserved",) if condition == "C" else ())
                elif name == "semanticEvidenceCoverage":
                    applicable_fields = fields if condition == "D" else ()
                else:
                    applicable_fields = fields if condition in {"C", "D"} else tuple(field for field in fields if field not in {"identifiedOperation", "identifiedShapes", "enforcementPipelineObserved", "enforcementStatus"})
                eligible = [run for run in group if run.get("testsExecuted") is True] if name == "testCoverage" else group
                observed = sum(all(run.get(field) is not None for field in applicable_fields) for run in eligible) if applicable_fields else 0
                expected = len(eligible) if applicable_fields else 0
                coverage[condition][name] = {"observed": observed, "expected": expected, "percentage": (100 * observed / expected) if expected else None}
            for field in AUDITED_FIELDS:
                counts = Counter(run["availability"].get(field, availability(run.get(field))) for run in group)
                field_coverage[condition][field] = dict(counts)
        return {"status": "PASS", "byCondition": coverage, "fieldsByCondition": field_coverage,
                "runs": len(runs), "invalidValues": sum(1 for run in runs for state in run["availability"].values() if state == DataAvailability.INVALID.value)}


def token_accounting_comparability(left: dict[str, Any], right: dict[str, Any]) -> str:
    keys = ("agent", "model", "reasoningEffort", "adapter", "adapterVersion", "runtime", "telemetrySchemaVersion", "tokenAccountingVersion")
    if any(left.get(key) is None or right.get(key) is None for key in keys):
        return "INDETERMINATE"
    return "TRUE" if all(left[key] == right[key] for key in keys) else "FALSE"


class RecognitionGroundTruthIndependenceGate:
    def evaluate(self, runs: list[dict[str, Any]], batch_dir: Path) -> dict[str, Any]:
        source = batch_dir / "tasks.json"
        task_map = {str(task.get("baseTaskId") or task.get("taskId") or task.get("id")): task
                    for task in task_list(read_json(source))} if source.is_file() else {}
        issues = []
        for run in runs:
            if run["condition"] not in {"C", "D"}:
                continue
            observed_name = run.get("observedSource")
            observed_path = (batch_dir / observed_name).resolve() if observed_name else None
            if (run.get("expectedSource") != "tasks.json" or not observed_name
                    or observed_name == "tasks.json" or observed_path is None
                    or not observed_path.is_relative_to(batch_dir.resolve()) or not observed_path.is_file()):
                issues.append({"runId": run.get("runId"), "reason": "Fonte observada ausente, igual ao oracle ou fora do batch"})
                continue
            task = task_map.get(run["baseTaskId"], {})
            if not task:
                issues.append({"runId": run.get("runId"), "reason": "Tarefa ausente no oracle congelado"})
                continue
            expected_operation = task.get("expectedOperation") or task.get("operacao")
            expected_shapes = task.get("expectedShapes") or ([task.get("expectedShape") or task.get("shape")] if task.get("expectedShape") or task.get("shape") else [])
            try:
                observed = read_json(observed_path)
            except (ValueError, UnicodeError):
                issues.append({"runId": run.get("runId"), "reason": "Evidência observada inválida"})
                continue
            if not isinstance(observed, dict):
                issues.append({"runId": run.get("runId"), "reason": "Evidência observada não estruturada"})
                continue
            if run.get("expectedOperation") != expected_operation or run.get("expectedShapes") != expected_shapes:
                issues.append({"runId": run.get("runId"), "reason": "Ground truth diverge do oracle congelado"})
            if run.get("identifiedOperation") != observed.get("identifiedOperation") or run.get("identifiedShapes") != observed.get("identifiedShapes"):
                issues.append({"runId": run.get("runId"), "reason": "Observação diverge da evidência da execução"})
        valid = source.is_file() and not issues
        return {"status": "PASS" if valid else "FAIL", "recognitionMetricsValid": valid,
                "expectedSource": "tasks.json", "expectedSourceSha256": sha256_file(source),
                "observedSources": sorted({run["observedSource"] for run in runs if run.get("observedSource")}),
                "issues": issues}
