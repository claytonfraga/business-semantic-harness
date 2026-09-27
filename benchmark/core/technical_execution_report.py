"""Factual, batch-local record of an Experimental Execution.

This module never imports scientific statistics, research questions, estimands,
evidence verdicts or the scientific report renderer. The PDF receives only the
serialized execution-report-model.json created from this batch's raw artifacts.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any

import yaml

from .enums import Classification
from .experimental_execution import (
    AUDITED_FIELDS, BatchIsolationGate, ExperimentalExecutionCompletionGate,
    InstrumentationCompletenessGate, _planned_identities, availability,
    classify_observed, normalize_runs, read_json, run_identity, sha256_file,
    task_list, write_json,
)
from .experimental_report import PDFLayoutGate


TITLE = "Relatório Técnico da Execução Experimental do Business Semantic Harness"
SUBTITLE = "Registro de Execução, Instrumentação, Integridade e Proveniência"
REPORT_DIRECTORY = "execution-report"
TELEMETRY_FIELDS = (
    "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens",
    "totalTokens", "durationSeconds", "rawTelemetry",
)
TECHNICAL_FIELDS = (
    "runId", "batchId", "condition", "taskId", "baseTaskId", "replicationIndex",
    "startedAt", "finishedAt", "durationSeconds", "inputTokens", "cachedInputTokens",
    "outputTokens", "reasoningTokens", "totalTokens", "rawTelemetry",
    "changeSetDetected", "testsExecuted", "testsPassed", "promoted", "originChanged",
    "classification",
)
SECTIONS = (
    "Identificação da Execução Experimental", "Proveniência e Versões",
    "Plano da Execução", "Execução Observada", "Completude",
    "Matriz de Tarefas e Replicações", "Instrumentação", "Cobertura de Telemetria",
    "Estado dos Dados", "Registro por Run", "Alterações de Código Observadas",
    "Testes Técnicos", "Evidência Semântica Observada", "Origem dos Valores Esperados",
    "Interações com a Ontologia", "Mecanismos de Governança Observados",
    "Enforcement", "Promoção Git", "Classificações Observadas",
    "Problemas Detectados na Execução", "Integridade das Worktrees",
    "Integridade do Origin", "Diagnóstico de Dados Ausentes",
    "Disponibilidade para Pareamento Posterior", "Artefatos e Hashes",
    "Limitações Técnicas da Execução", "Prontidão para Análise",
    "Síntese Técnica da Execução",
)
PROHIBITED_STRUCTURE = re.compile(
    r"(?:Research Questions?|\bRQ\d+(?:[-_][AB])?\b|benef[ií]cio l[ií]quido|"
    r"hip[oó]tese comprovada|signific[aâ]ncia|evidence strength|veredito cient[ií]fico|"
    r"Amea[cç]as [àa] Validade|Trabalhos Futuros|Diretrizes para Ado[cç][aã]o)",
    re.IGNORECASE,
)


def _read_optional_json(path: Path, issues: list[dict[str, Any]], default: Any) -> Any:
    if not path.is_file():
        issues.append({"severity": "EXECUTION_FAIL", "code": "MISSING_ARTIFACT", "detail": path.name})
        return default
    try:
        return read_json(path)
    except (ValueError, UnicodeError) as error:
        issues.append({"severity": "EXECUTION_FAIL", "code": "CORRUPT_ARTIFACT", "detail": f"{path.name}: {error}"})
        return default


def _read_batch(batch_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    issues: list[dict[str, Any]] = []
    config_path = batch_dir / "config.yaml"
    if config_path.is_file():
        try:
            config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError, yaml.YAMLError) as error:
            issues.append({"severity": "EXECUTION_FAIL", "code": "CORRUPT_CONFIG", "detail": str(error)})
            config = {}
    else:
        issues.append({"severity": "EXECUTION_FAIL", "code": "MISSING_ARTIFACT", "detail": "config.yaml"})
        config = {}
    task_data = _read_optional_json(batch_dir / "tasks.json", issues, [])
    tasks = task_list(task_data) if isinstance(task_data, (dict, list)) else []
    metadata = _read_optional_json(batch_dir / "metadata.json", issues, {})
    runs = _read_optional_json(batch_dir / "measurements.json", issues, [])
    if not isinstance(config, dict) or not isinstance(metadata, dict) or not isinstance(runs, list):
        issues.append({"severity": "EXECUTION_FAIL", "code": "INVALID_STRUCTURE", "detail": "config, metadata or measurements"})
        config = config if isinstance(config, dict) else {}
        metadata = metadata if isinstance(metadata, dict) else {}
        runs = runs if isinstance(runs, list) else []
    if any(not isinstance(run, dict) for run in runs):
        issues.append({"severity": "EXECUTION_FAIL", "code": "INVALID_RUN", "detail": "measurements.json contains non-object run"})
        runs = [run for run in runs if isinstance(run, dict)]
    return config, tasks, metadata, runs, issues


def _isolation(batch_dir: Path, batch_id: str, runs: list[dict[str, Any]]) -> dict[str, Any]:
    result = BatchIsolationGate(batch_dir, batch_id).evaluate(runs)
    observed_ids = sorted({str(run.get("batchId")) for run in runs})
    foreign_telemetry = []
    for run in runs:
        telemetry = run.get("rawTelemetry")
        if isinstance(telemetry, dict) and telemetry.get("batchId") not in (None, batch_id):
            foreign_telemetry.append(str(run.get("runId")))
    for path in batch_dir.rglob("*"):
        if not path.is_file() or "telemetry" not in path.name.lower() or path.suffix != ".json":
            continue
        try:
            value = read_json(path)
        except (ValueError, UnicodeError):
            foreign_telemetry.append(str(path.relative_to(batch_dir)))
            continue
        if isinstance(value, dict) and value.get("batchId") not in (None, batch_id):
            foreign_telemetry.append(str(path.relative_to(batch_dir)))
    result.update({"requestedBatchId": batch_id, "observedBatchId": observed_ids[0] if len(observed_ids) == 1 else None,
                   "distinctBatchIds": len(observed_ids), "foreignBatchTelemetry": len(foreign_telemetry),
                   "foreignBatchTelemetryDetails": sorted(set(foreign_telemetry))})
    if len(observed_ids) != 1 or observed_ids[0] != batch_id or foreign_telemetry:
        result["status"] = "HARD_FAIL"
    return result


def _safe_completion(batch_dir: Path, config: dict[str, Any], tasks: list[dict[str, Any]],
                     metadata: dict[str, Any], runs: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        return ExperimentalExecutionCompletionGate(batch_dir).evaluate(config, tasks, metadata, runs)
    except (ValueError, TypeError, KeyError) as error:
        return {"batchId": batch_dir.name, "completionStatus": "INVALID", "plannedRuns": 0,
                "observedRuns": len(runs), "completedRuns": 0, "failedRuns": 0,
                "missingRuns": 0, "duplicateRuns": 0, "unexpectedRuns": 0,
                "pendingRuns": 0, "runningRuns": 0, "missingRunKeys": [],
                "duplicateRunKeys": [], "unexpectedRunKeys": [], "missingConditions": [],
                "missingTasks": [], "missingReplications": [], "reasons": [str(error)]}


def _source_hashes(batch_dir: Path, tasks: list[dict[str, Any]], metadata: dict[str, Any]) -> dict[str, Any]:
    previous = metadata.get("hashes") if isinstance(metadata.get("hashes"), dict) else {}
    oracle = [{"taskId": task.get("id") or task.get("taskId"),
               "expectedOperation": task.get("expectedOperation") or task.get("operacao"),
               "expectedShapes": task.get("expectedShapes") or task.get("expectedShape") or task.get("shape")}
              for task in tasks]
    oracle_hash = hashlib.sha256(json.dumps(oracle, ensure_ascii=False, sort_keys=True,
                                           separators=(",", ":")).encode("utf-8")).hexdigest() if tasks else None
    return {
        "repositoryCommit": previous.get("repositoryCommit") or metadata.get("commitBsh"),
        "bshProductTreeHash": previous.get("bshProductTreeHash") or metadata.get("bshProductTreeHash"),
        "benchmarkTreeHash": previous.get("benchmarkTreeHash"),
        "pilotCommit": previous.get("pilotCommit"),
        "ontologyHash": previous.get("ontologyHash"), "shapesHash": previous.get("shapesHash"),
        "policyHash": previous.get("policyHash"),
        "taskManifestHash": sha256_file(batch_dir / "tasks.json"),
        "oracleHash": oracle_hash, "fixtureHash": previous.get("fixtureHash"),
        "configHash": sha256_file(batch_dir / "config.yaml"),
        "analysisPlanHash": sha256_file(batch_dir / "analysis-plan.yaml") or previous.get("analysisPlanHash"),
        "analysisPolicyHash": sha256_file(batch_dir / "analysis-policy.yaml") or previous.get("analysisPolicyHash"),
    }


def _field_coverage(runs: list[dict[str, Any]], conditions: list[str]) -> dict[str, Any]:
    result = {}
    for field in (*TELEMETRY_FIELDS, "classification", "identifiedOperation", "identifiedShapes",
                  "enforcementPipelineObserved", "candidateEnforcementApplicable", "independentEnforcementActivated"):
        cells = {}
        for condition in conditions:
            group = [run for run in runs if run["condition"] == condition]
            applicable = condition in {"C", "D"} or field not in {
                "identifiedOperation", "identifiedShapes", "enforcementPipelineObserved",
                "candidateEnforcementApplicable", "independentEnforcementActivated"}
            expected = len(group) if applicable else 0
            observed = sum(run.get("availability", {}).get(field) in {"PRESENT", "OBSERVED_ZERO"} for run in group) if applicable else 0
            cells[condition] = {"observed": observed, "expected": expected,
                                "coveragePercentage": 100 * observed / expected if expected else None,
                                "status": "NOT_APPLICABLE" if not applicable else ("PASS" if observed == expected else "MISSING")}
        result[field] = cells
    return result


def _missing_data(runs: list[dict[str, Any]], conditions: list[str]) -> list[dict[str, Any]]:
    rows = []
    for condition in conditions:
        group = [run for run in runs if run["condition"] == condition]
        for field in AUDITED_FIELDS:
            affected = [run["runId"] for run in group if run.get("availability", {}).get(field) in {"MISSING", "INVALID", "INDETERMINATE"}]
            applicable = [run for run in group if run.get("availability", {}).get(field) != "NOT_APPLICABLE"]
            if affected:
                rows.append({"field": field, "condition": condition, "affectedRuns": affected,
                             "expectedCount": len(applicable), "observedCount": len(applicable) - len(affected),
                             "reason": "INVALID" if any(run.get("availability", {}).get(field) == "INVALID" for run in group) else "MISSING"})
    return rows


def _matrix(config: dict[str, Any], metadata: dict[str, Any], tasks: list[dict[str, Any]],
            runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        planned = _planned_identities(config, metadata, tasks)
    except (ValueError, TypeError):
        planned = []
    by_key: dict[tuple[str, str, int, str | None], list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        try:
            by_key[run_identity(run)].append(run)
        except (ValueError, TypeError, KeyError):
            continue
    rows = []
    for condition, base, rep, variant in planned:
        matches = by_key.pop((condition, base, rep, variant), [])
        for match in matches or [None]:
            rows.append({"baseTaskId": base, "taskId": (match or {}).get("taskId"),
                         "condition": condition, "replicationIndex": rep, "promptVariantId": variant,
                         "runId": (match or {}).get("runId"),
                         "executionStatus": (match or {}).get("executionStatus") or ("MISSING" if match is None else "COMPLETED")})
    for identity, matches in by_key.items():
        for match in matches:
            rows.append({"baseTaskId": identity[1], "taskId": match.get("taskId"),
                         "condition": identity[0], "replicationIndex": identity[2],
                         "promptVariantId": identity[3], "runId": match.get("runId"),
                         "executionStatus": "UNEXPECTED"})
    return rows


def _worktrees(batch_dir: Path, runs: list[dict[str, Any]]) -> dict[str, Any]:
    execution_dir = batch_dir / "executions"
    expected = {str(run.get("runId")) for run in runs if run.get("runId")}
    actual = {path.name for path in execution_dir.iterdir() if path.is_dir()} if execution_dir.is_dir() else set()
    created = sum((execution_dir / run_id / "project").is_dir() for run_id in expected)
    finalized = sum((execution_dir / run_id / "result.json").is_file() for run_id in expected)
    residual = sorted(actual - expected)
    return {"worktreesCreated": created, "worktreesFinalized": finalized,
            "worktreesResidual": len(residual), "residualPaths": residual,
            "missingWorkspaces": sorted(run_id for run_id in expected if not (execution_dir / run_id / "project").is_dir()),
            "missingResultFiles": sorted(run_id for run_id in expected if not (execution_dir / run_id / "result.json").is_file()),
            "integrityConfirmed": bool(expected) and created == finalized == len(expected) and not residual}


def _origin(batch_dir: Path, runs: list[dict[str, Any]], metadata: dict[str, Any]) -> dict[str, Any]:
    initial = metadata.get("originInitialCommit")
    final = metadata.get("originFinalCommit")
    unexpected = [run["runId"] for run in runs if run.get("unexpectedOriginChange") is True]
    return {"originInitialCommit": initial, "originFinalCommit": final,
            "unexpectedOriginChanges": len(unexpected), "affectedRuns": unexpected,
            "integrityConfirmed": initial is not None and final is not None and not unexpected}


def _technical_pairs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    keys = {condition: {(run["baseTaskId"], run["replicationIndex"], run.get("promptVariantId"))
                        for run in runs if run["condition"] == condition}
            for condition in "ABCD"}
    return {f"{left}×{right}": {"pairedRuns": len(keys[left] & keys[right]),
                                "missingPairs": len(keys[left] ^ keys[right])}
            for left, right in (("A", "B"), ("B", "C"), ("C", "D"), ("A", "D"))}


def _readiness(completion: dict[str, Any], isolation: dict[str, Any], coverage: dict[str, Any],
               worktrees: dict[str, Any], origin: dict[str, Any], issues: list[dict[str, Any]],
               runs: list[dict[str, Any]], conditions: list[str]) -> dict[str, Any]:
    def complete(field: str, selected: tuple[str, ...]) -> bool:
        return all(coverage[field][condition]["expected"] > 0
                   and coverage[field][condition]["observed"] == coverage[field][condition]["expected"]
                   for condition in selected)
    ad = tuple(condition for condition in ("A", "D") if condition in conditions)
    token = len(ad) == 2 and complete("totalTokens", ad)
    duration = len(ad) == 2 and complete("durationSeconds", ad)
    classifications = bool(runs) and all(run.get("classification") in {item.value for item in Classification}
                          and run.get("classification") != "INDETERMINADO" for run in runs)
    semantic_conditions = tuple(condition for condition in ("C", "D") if condition in conditions)
    recognition = bool(semantic_conditions) and all(complete(field, semantic_conditions) for field in ("identifiedOperation", "identifiedShapes"))
    enforcement = "D" in conditions and all(complete(field, ("D",)) for field in (
        "enforcementPipelineObserved", "candidateEnforcementApplicable", "independentEnforcementActivated"))
    critical = (completion["completionStatus"] != "COMPLETE" or isolation["status"] != "PASS"
                or any(issue["severity"] == "EXECUTION_FAIL" for issue in issues))
    technical_integrity = worktrees["integrityConfirmed"] and origin["integrityConfirmed"]
    def observed(run: dict[str, Any], field: str) -> bool:
        return run.get("availability", {}).get(field) in {"PRESENT", "OBSERVED_ZERO"}
    all_required = all(observed(run, field) for run in runs for field in TECHNICAL_FIELDS)
    all_required = all_required and all(
        observed(run, field)
        for run in runs if run["condition"] in {"C", "D"}
        for field in ("ontologyQueried", "reportConflictCalled", "identifiedOperation",
                      "identifiedShapes", "enforcementPipelineObserved",
                      "candidateEnforcementApplicable", "independentEnforcementActivated")
    )
    all_required = all_required and all(
        observed(run, field)
        for run in runs if run.get("changeSetDetected") is True
        for field in ("modifiedFiles", "createdFiles", "removedFiles", "addedLines",
                      "removedLines", "diffSha256")
    )
    if critical:
        status = "NOT_READY_FOR_ANALYSIS"
    elif token and duration and classifications and recognition and enforcement and technical_integrity and all_required:
        status = "READY_FOR_ANALYSIS"
    else:
        status = "PARTIALLY_READY_FOR_ANALYSIS"
    available = [name for name, ready in (("tokens", token), ("duration", duration),
                                          ("classification", classifications), ("recognition", recognition),
                                          ("enforcement", enforcement)) if ready]
    blocked = [name for name in ("tokens", "duration", "classification", "recognition", "enforcement") if name not in available]
    return {"batchId": isolation["requestedBatchId"], "executionComplete": completion["completionStatus"] == "COMPLETE",
            "tokenAnalysisReady": token, "tokenComparisonReadiness": token,
            "durationAnalysisReady": duration, "classificationAnalysisReady": classifications,
            "recognitionAnalysisPotentiallyReady": recognition,
            "enforcementAnalysisPotentiallyReady": enforcement,
            "worktreeIntegrityConfirmed": worktrees["integrityConfirmed"],
            "originIntegrityConfirmed": origin["integrityConfirmed"],
            "analysesPotentiallyAvailable": available, "analysesBlockedByMissingData": blocked,
            "overallStatus": status, "READY_FOR_ANALYSIS": status == "READY_FOR_ANALYSIS"}


def _table(section: str, title: str, headers: list[str], rows: list[list[Any]], source: str,
           units: str = "registros") -> dict[str, Any]:
    return {"section": section, "title": title, "headers": headers,
            "rows": [["MISSING" if value is None else str(value) for value in row] for row in rows],
            "sourceArtifact": source, "units": units, "n": len(rows)}


def _build_tables(model: dict[str, Any]) -> list[dict[str, Any]]:
    runs = model["runs"]
    completion = model["completion"]
    coverage = model["coverage"]
    tables = []
    def add(section: str, title: str, fields: list[str], items: list[dict[str, Any]], source: str, units: str = "registros") -> None:
        tables.append(_table(section, title, fields, [[item.get(field) for field in fields] for item in items], source, units))
    add("Identificação da Execução Experimental", "Identificação e versões", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["identity"].items()], "metadata.json")
    add("Proveniência e Versões", "Hashes e commits congelados", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["sourceHashes"].items()], "metadata.json")
    add("Plano da Execução", "Plano congelado", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["plan"].items()], "config.yaml")
    add("Execução Observada", "Contagens observadas", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in completion.items() if key.endswith("Runs")], "execution-completion.json", "runs")
    add("Matriz de Tarefas e Replicações", "Tarefas, condições e replicações", ["baseTaskId", "taskId", "condition", "replicationIndex", "runId", "executionStatus"],
        model["taskMatrix"], "config.yaml + tasks.json + measurements.json")
    add("Instrumentação", "Campos esperados na coleta", ["campo", "estado"],
        [{"campo": field, "estado": "coletado por run; ver cobertura"} for field in AUDITED_FIELDS], "instrumentation-coverage.json")
    tables.append(_table("Cobertura de Telemetria", "Disponibilidade de telemetria por condição",
                         ["Campo", *model["conditions"]],
                         [[field, *[f"{coverage[field][condition]['observed']}/{coverage[field][condition]['expected']} ({coverage[field][condition]['coveragePercentage']:.1f}%)" if coverage[field][condition]["coveragePercentage"] is not None else "NOT_APPLICABLE"
                                    for condition in model["conditions"]]] for field in TELEMETRY_FIELDS],
                         "instrumentation-coverage.json", "registros e porcentagem"))
    add("Estado dos Dados", "Estados canônicos de disponibilidade", ["state", "meaning"],
        [{"state": "PRESENT", "meaning": "valor observado"},
         {"state": "OBSERVED_ZERO", "meaning": "zero ou falso medido explicitamente"},
         {"state": "MISSING", "meaning": "valor não coletado; permanece null"},
         {"state": "NOT_APPLICABLE", "meaning": "campo não aplicável à condição"},
         {"state": "INVALID", "meaning": "valor coletado fora do domínio válido"},
         {"state": "INDETERMINATE", "meaning": "evidência insuficiente para decidir estado"}],
        "schema da instrumentação")
    add("Estado dos Dados", "Estados de disponibilidade observados", ["condition", "field", "state", "count"],
        model["availabilityCounts"], "classified-runs.json", "campos")
    register_groups = (
        ("Identificação e tempo por run", ["runId", "condition", "baseTaskId", "replicationIndex", "executionStatus", "startedAt", "finishedAt", "durationSeconds"]),
        ("Tokens por run", ["runId", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens", "nonCachedTokens"]),
        ("Testes e alteração por run", ["runId", "testsExecuted", "testsPassed", "changeSetDetected", "ontologyQueried", "reportConflictCalled"]),
        ("Reconhecimento e enforcement por run", ["runId", "identifiedOperation", "identifiedShapes", "enforcementPipelineObserved", "candidateEnforcementApplicable", "independentEnforcementActivated"]),
        ("Promoção e classificação por run", ["runId", "promoted", "originChanged", "classification"]),
    )
    for title, fields in register_groups:
        add("Registro por Run", title, fields, runs, "measurements.json + classified-runs.json")
    add("Alterações de Código Observadas", "Diffs observados", ["runId", "baseTaskId", "condition", "modifiedFiles", "createdFiles", "removedFiles", "addedLines", "removedLines", "diffSha256"],
        [run for run in runs if run.get("changeSetDetected") is True], "measurements.json")
    add("Testes Técnicos", "Testes técnicos por run", ["runId", "testsExecuted", "testsPassed", "testsFailed", "testCommand"], runs, "measurements.json")
    add("Evidência Semântica Observada", "Operações e shapes registrados", ["runId", "expectedOperation", "identifiedOperation", "expectedShapes", "identifiedShapes"],
        runs, "tasks.json + executions/*/result.json")
    add("Origem dos Valores Esperados", "Origem do oracle", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["oracleOrigin"].items()], "tasks.json")
    add("Interações com a Ontologia", "Interações registradas por run", ["runId", "ontologyQueried", "queryCount", "semanticToolsCalled"], runs, "measurements.json")
    add("Mecanismos de Governança Observados", "Mecanismos registrados", ["runId", "condition", "governanceMechanism"], runs, "classified-runs.json")
    add("Enforcement", "Evidência de enforcement por run", ["runId", "enforcementPipelineObserved", "candidateEnforcementApplicable", "independentEnforcementActivated", "semanticStatus", "promoted", "originChanged"], runs, "measurements.json + classified-runs.json")
    add("Promoção Git", "Promoção e origin por run", ["runId", "candidateCreated", "promotionAttempted", "promotionSucceeded", "originChanged"], runs, "measurements.json")
    add("Classificações Observadas", "Classificações por condição", ["condition", "classification", "count"],
        model["classificationRows"], "classified-runs.json", "runs")
    add("Problemas Detectados na Execução", "Problemas e severidade", ["severity", "code", "detail"], model["issues"], "execution-report-data-" + model["batchId"] + ".json")
    add("Integridade das Worktrees", "Workspaces da execução", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["worktrees"].items()], "executions/")
    add("Integridade do Origin", "Commits e alterações do origin", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["origin"].items()], "metadata.json + measurements.json")
    add("Diagnóstico de Dados Ausentes", "Campos ausentes e afetados", ["field", "condition", "affectedRuns", "expectedCount", "observedCount", "reason"],
        model["missingData"], "classified-runs.json")
    add("Disponibilidade para Pareamento Posterior", "Chaves disponíveis para pareamento posterior", ["contraste", "pairedRuns", "missingPairs"],
        [{"contraste": contrast, **value} for contrast, value in model["technicalPairs"].items()], "classified-runs.json", "chaves de run")
    add("Artefatos e Hashes", "Inventário de artefatos da execução", ["artifact", "path", "SHA-256", "status"],
        model["artifacts"], "execution-report-data-" + model["batchId"] + ".json")
    add("Prontidão para Análise", "Prontidão técnica", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["readiness"].items()], "analysis-readiness.json")
    add("Síntese Técnica da Execução", "Síntese administrativa", ["campo", "valor"],
        [{"campo": key, "valor": value} for key, value in model["summary"].items()], "execution-report-data-" + model["batchId"] + ".json")
    return tables


def _artifact_inventory(batch_dir: Path) -> list[dict[str, Any]]:
    names = ("config.yaml", "tasks.json", "metadata.json", "measurements.json",
             "measurements.csv", "agent-capabilities.json", "analysis-plan.yaml",
             "analysis-policy.yaml")
    return [{"artifact": name, "path": str(batch_dir / name), "SHA-256": sha256_file(batch_dir / name),
             "status": "PRESENT" if (batch_dir / name).is_file() else "MISSING"} for name in names]


def _model(batch_dir: Path, config: dict[str, Any], tasks: list[dict[str, Any]], metadata: dict[str, Any],
           raw: list[dict[str, Any]], initial_issues: list[dict[str, Any]],
           isolation: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    batch_id = batch_dir.name
    completion = _safe_completion(batch_dir, config, tasks, metadata, raw)
    valid_raw = []
    for source in raw:
        try:
            run_identity(source)
        except (ValueError, TypeError, KeyError) as error:
            initial_issues.append({"severity": "EXECUTION_FAIL", "code": "INVALID_RUN_IDENTITY",
                                   "detail": f"{source.get('runId')}: {error}"})
            continue
        valid_raw.append(source)
    normalized = normalize_runs(batch_id, valid_raw, tasks)
    classified = [classify_observed(run) for run in normalized]
    by_raw_id = {run.get("runId"): run for run in valid_raw}
    for run in classified:
        run["availability"]["classification"] = availability(run["classification"])
        source = by_raw_id.get(run["runId"], {})
        if run.get("executionStatus") is None:
            evidence_file = batch_dir / "executions" / str(run["runId"]) / "result.json"
            run["executionStatus"] = "COMPLETED" if evidence_file.is_file() else "INDETERMINATE"
        for field in ("testsFailed", "testCommand", "queryCount", "semanticToolsCalled",
                      "candidateCreated", "promotionAttempted", "promotionSucceeded",
                      "worktreePath", "baseCommit"):
            run[field] = source.get(field)
        run["nonCachedTokens"] = source.get("nonCachedTokens") if source.get("nonCachedTokensSource") == "DIRECT_ADAPTER_METRIC" and source.get("tokenAccountingVersion") else None
    instrument = InstrumentationCompletenessGate().evaluate(classified)
    conditions = [str(item) for item in config.get("experiment", {}).get("conditions", []) if str(item) in "ABCD"]
    conditions = list(dict.fromkeys([*conditions, *[run["condition"] for run in classified if run["condition"] in "ABCD"]]))
    if not conditions:
        conditions = list("ABCD")
    coverage = _field_coverage(classified, conditions)
    missing = _missing_data(classified, conditions)
    worktrees = _worktrees(batch_dir, classified)
    origin = _origin(batch_dir, raw, metadata)
    issues = list(initial_issues)
    agent_cfg = config.get("agent") if isinstance(config.get("agent"), dict) else {}
    for field, declared, config_value in (
        ("agent", metadata.get("agente"), agent_cfg.get("id")),
        ("model", metadata.get("modelo"), agent_cfg.get("model")),
        ("reasoningEffort", metadata.get("esforco"), agent_cfg.get("reasoningEffort")),
    ):
        if declared is not None and config_value is not None and declared != config_value:
            issues.append({"severity": "EXECUTION_FAIL", "code": "INCONSISTENT_CONFIGURATION",
                           "detail": f"{field}: metadata.json diverge de config.yaml"})
        expected = declared if declared is not None else config_value
        mismatched = [run["runId"] for run in classified if expected is not None and run.get(field) is not None and run[field] != expected]
        if mismatched:
            issues.append({"severity": "EXECUTION_FAIL", "code": "INCONSISTENT_RUN_IDENTITY",
                           "detail": f"{field}: {mismatched}"})
    if completion["completionStatus"] != "COMPLETE":
        issues.append({"severity": "EXECUTION_FAIL", "code": "EXECUTION_INCOMPLETE", "detail": completion["completionStatus"]})
    if completion["duplicateRuns"]:
        issues.append({"severity": "EXECUTION_FAIL", "code": "DUPLICATE_RUN", "detail": str(completion["duplicateRunKeys"])})
    if instrument["invalidValues"]:
        issues.append({"severity": "EXECUTION_FAIL", "code": "INVALID_INSTRUMENTATION", "detail": str(instrument["invalidValues"])})
    if worktrees["worktreesResidual"] or worktrees["missingResultFiles"]:
        issues.append({"severity": "EXECUTION_FAIL", "code": "WORKTREE_INTEGRITY_FAILURE", "detail": json.dumps(worktrees, ensure_ascii=False)})
    elif worktrees["missingWorkspaces"]:
        issues.append({"severity": "EXECUTION_WARNING", "code": "WORKTREE_INTEGRITY_UNCONFIRMED", "detail": json.dumps(worktrees, ensure_ascii=False)})
    if origin["unexpectedOriginChanges"]:
        issues.append({"severity": "EXECUTION_FAIL", "code": "UNEXPECTED_ORIGIN_CHANGE", "detail": str(origin["affectedRuns"])})
    elif not origin["integrityConfirmed"]:
        issues.append({"severity": "EXECUTION_WARNING", "code": "ORIGIN_INTEGRITY_UNCONFIRMED", "detail": "Commits inicial/final indisponíveis"})
    if missing:
        issues.append({"severity": "EXECUTION_WARNING", "code": "MISSING_DATA", "detail": f"{len(missing)} campos/condições com ausência"})
    if any(run["classification"] == "FALHA_TECNICA" for run in classified):
        issues.append({"severity": "EXECUTION_FAIL", "code": "TECHNICAL_FAILURE", "detail": "Run com FALHA_TECNICA"})
    if any(run["classification"] == "FALHA_INSTRUMENTACAO" for run in classified):
        issues.append({"severity": "EXECUTION_FAIL", "code": "INSTRUMENTATION_FAILURE", "detail": "Run com FALHA_INSTRUMENTACAO"})
    readiness = _readiness(completion, isolation, coverage, worktrees, origin, issues, classified, conditions)
    class_rows = []
    for condition in conditions:
        group = [run for run in classified if run["condition"] == condition and str(run.get("executionStatus") or "").upper() not in {"PENDING", "RUNNING", "FAILED", "FALHA_TECNICA", "FALHA_INSTRUMENTACAO"}]
        for classification, count in sorted(Counter(run["classification"] for run in group).items()):
            class_rows.append({"condition": condition, "classification": classification, "count": count})
    classifiable = sum(row["count"] for row in class_rows)
    execution_status = "COMPLETE" if completion["completionStatus"] == "COMPLETE" else ("INVALID" if completion["completionStatus"] == "INVALID" else "INCOMPLETE")
    source_hashes = _source_hashes(batch_dir, tasks, metadata)
    agent_cfg = config.get("agent") if isinstance(config.get("agent"), dict) else {}
    identity = {
        "batchId": batch_id, "dataOrigin": metadata.get("dataOrigin"),
        "agent": metadata.get("agente") or agent_cfg.get("id"),
        "agentVersion": metadata.get("versaoAgente") or metadata.get("agentVersion"),
        "model": metadata.get("modelo") or agent_cfg.get("model"),
        "reasoningEffort": metadata.get("esforco") or agent_cfg.get("reasoningEffort"),
        "adapter": metadata.get("agentAdapter") or agent_cfg.get("adapter"),
        "adapterVersion": metadata.get("agentAdapterVersion"),
        "adapterCommit": metadata.get("adapterCommit"),
        "runtimeVersion": metadata.get("runtimeVersion"),
        "telemetrySchemaVersion": metadata.get("telemetrySchemaVersion"),
        "tokenAccountingVersion": metadata.get("tokenAccountingVersion"),
        "domain": config.get("project", {}).get("ontologyDomain"),
        "executionStartedAt": metadata.get("startedAt") or min((run.get("startedAt") for run in raw if run.get("startedAt")), default=None),
        "executionFinishedAt": metadata.get("finishedAt") or max((run.get("finishedAt") for run in raw if run.get("finishedAt")), default=None),
        "reportGeneratedAt": datetime.now(timezone.utc).isoformat(),
    }
    plan = {"conditionsPlanned": config.get("experiment", {}).get("conditions"),
            "baseTasksPlanned": config.get("experiment", {}).get("tasks"),
            "replicationsPlanned": config.get("experiment", {}).get("replications"),
            "runsPlanned": completion["plannedRuns"]}
    summary = {"batchId": batch_id, "executionStatus": execution_status,
               "plannedRuns": completion["plannedRuns"], "observedRuns": completion["observedRuns"],
               "nBaseTasks": len({run["baseTaskId"] for run in classified}),
               "nReplications": len({run["replicationIndex"] for run in classified}),
               "tokenCoverage": {condition: coverage["totalTokens"][condition] for condition in conditions},
               "durationCoverage": {condition: coverage["durationSeconds"][condition] for condition in conditions},
               "classificationCoverage": {condition: coverage["classification"][condition] for condition in conditions},
               "semanticEvidenceCoverage": {condition: coverage["identifiedOperation"][condition] for condition in conditions},
               "enforcementEvidenceCoverage": {condition: coverage["enforcementPipelineObserved"][condition] for condition in conditions},
               "missingDataCount": sum(len(item["affectedRuns"]) for item in missing),
               "executionFailCount": sum(issue["severity"] == "EXECUTION_FAIL" for issue in issues),
               "executionWarningCount": sum(issue["severity"] == "EXECUTION_WARNING" for issue in issues),
               "batchIsolationStatus": isolation["status"],
               "READY_FOR_ANALYSIS": readiness["READY_FOR_ANALYSIS"]}
    model = {"title": TITLE, "subtitle": SUBTITLE, "batchId": batch_id,
             "sections": list(SECTIONS), "identity": identity, "sourceHashes": source_hashes,
             "plan": plan, "completion": completion, "executionStatus": execution_status,
             "isolation": isolation, "instrumentation": instrument, "conditions": conditions,
             "coverage": coverage, "availabilityCounts": [
                 {"condition": condition, "field": field, "state": state, "count": count}
                 for condition in conditions for field in AUDITED_FIELDS
                 for state, count in sorted(Counter(run["availability"].get(field, "MISSING") for run in classified if run["condition"] == condition).items())],
             "taskMatrix": _matrix(config, metadata, tasks, raw), "runs": classified,
             "missingData": missing, "worktrees": worktrees, "origin": origin,
             "technicalPairs": _technical_pairs(classified), "classificationRows": class_rows,
             "completedClassifiableRuns": classifiable,
             "oracleOrigin": {"expectedOperationSource": "tasks.json" if tasks else None,
                              "expectedShapesSource": "tasks.json" if tasks else None,
                              "oracleHash": source_hashes["oracleHash"],
                              "oracleFrozenAt": metadata.get("oracleFrozenAt") or metadata.get("taskManifestFrozenAt")},
             "artifacts": _artifact_inventory(batch_dir), "issues": issues,
             "readiness": readiness, "summary": summary}
    model["tables"] = _build_tables(model)
    return model, completion, instrument, readiness


def _provenance(model: dict[str, Any]) -> list[dict[str, Any]]:
    batch_id = model["batchId"]
    run_ids = [run["runId"] for run in model["runs"]]
    entries = []
    def add(fields: dict[str, Any], artifact: str, source_runs: list[str] | None = None) -> None:
        for field, value in fields.items():
            entries.append({"field": field, "value": value, "sourceArtifact": artifact,
                            "sourceRunIds": source_runs or [], "batchId": batch_id})
    for key, value in model["identity"].items():
        source = "report generator clock" if key == "reportGeneratedAt" else ("config.yaml" if key == "domain" else "metadata.json")
        add({key: value}, source)
    add(model["sourceHashes"], "metadata.json + frozen batch artifacts")
    add(model["plan"], "config.yaml + tasks.json")
    add(model["completion"], "config.yaml + measurements.json", run_ids)
    add(model["coverage"], "classified-runs.json", run_ids)
    add(model["worktrees"], "executions/", run_ids)
    add(model["origin"], "metadata.json + measurements.json", run_ids)
    add(model["readiness"], "execution-completion.json + instrumentation-coverage.json", run_ids)
    add({"missingData": model["missingData"]}, "classified-runs.json", run_ids)
    add({"classificationRows": model["classificationRows"]}, "classified-runs.json", run_ids)
    add({"artifacts": model["artifacts"]}, "batch-local files", run_ids)
    add(model["summary"], "execution-report-data-" + batch_id + ".json", run_ids)
    for run in model["runs"]:
        for key, value in run.items():
            if key in {"rawTelemetry", "availability"}:
                continue
            source = ("tasks.json" if key.startswith("expected") else
                      "classified-runs.json" if key in {"classification", "governanceMechanism"} else
                      "measurements.json")
            add({f"runs.{run['runId']}.{key}": value}, source, [run["runId"]])
    return entries


def _display(value: Any) -> str:
    if value is None:
        return "MISSING"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def _markdown(model: dict[str, Any]) -> str:
    lines = [f"# {model['title']}", "", model["subtitle"], "",
             f"batchId: `{model['batchId']}`", ""]
    for field in ("dataOrigin", "agent", "model", "reasoningEffort", "domain",
                  "executionStartedAt", "executionFinishedAt", "reportGeneratedAt"):
        lines.append(f"{field}: {_display(model['identity'].get(field))}")
    lines.append("")
    by_section: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for table in model["tables"]:
        by_section[table["section"]].append(table)
    for index, section in enumerate(model["sections"], 1):
        lines.extend([f"## {index}. {section}", ""])
        if section == "Completude":
            lines.extend([f"Status: `{model['completion']['completionStatus']}`.", ""])
        if section == "Prontidão para Análise":
            lines.extend([f"Status técnico: `{model['readiness']['overallStatus']}`.", ""])
        if section == "Síntese Técnica da Execução":
            lines.extend(["Esta execução experimental foi registrada e validada quanto à sua integridade técnica. O status de prontidão abaixo indica se seus dados podem ser encaminhados ao módulo separado de Análise Experimental. Nenhuma inferência científica é realizada neste documento.", ""])
        for table in by_section.get(section, []):
            lines.extend([f"### {table['title']}", "", "| " + " | ".join(table["headers"]) + " |",
                          "| " + " | ".join("---" for _ in table["headers"]) + " |"])
            for row in table["rows"]:
                lines.append("| " + " | ".join(_display(value).replace("|", "\\|").replace("\n", " ") for value in row) + " |")
            lines.extend(["", f"Fonte: `{table['sourceArtifact']}`; unidades: {table['units']}; n={table['n']}.", ""])
    return "\n".join(lines) + "\n"


def _latex(value: Any) -> str:
    text = _display(value)
    characters = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$",
                  "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}",
                  "^": r"\textasciicircum{}"}
    chunks = re.sub(r"([A-Za-zÀ-ÿ0-9]{5})(?=[A-Za-zÀ-ÿ0-9])", r"\1<wbr>", text).split("<wbr>")
    return r"\allowbreak{}".join("".join(characters.get(char, char) for char in chunk)
                                  .replace(r"\_", r"\_\allowbreak{}")
                                  .replace("-", r"-\allowbreak{}")
                                  .replace(":", r":\allowbreak{}")
                                  .replace("/", r"/\allowbreak{}") for chunk in chunks)


def _render_latex(model: dict[str, Any]) -> str:
    lines = [r"\documentclass[11pt,a4paper]{article}", r"\usepackage[utf8]{inputenc}",
             r"\usepackage[T1]{fontenc}", r"\usepackage[brazil]{babel}",
             r"\usepackage[margin=2.2cm]{geometry}", r"\usepackage{longtable,array,booktabs,hyperref}",
             r"\setlength{\parindent}{0pt}", r"\setlength{\parskip}{0.5em}", r"\sloppy",
             r"\begin{document}", r"\begin{titlepage}\centering",
             r"{\LARGE\bfseries " + _latex(model["title"]) + r"\par}",
             r"\vspace{1.5cm}{\large " + _latex(model["subtitle"]) + r"\par}",
             r"\vfill " + _latex(model["batchId"]) + r"\par"]
    for field in ("dataOrigin", "agent", "model", "reasoningEffort", "domain",
                  "executionStartedAt", "executionFinishedAt", "reportGeneratedAt"):
        lines.append(_latex(field) + ": " + _latex(model["identity"].get(field)) + r"\par")
    lines.extend([r"\end{titlepage}",
             r"\section*{Resumo Técnico}",
             "Execução " + _latex(model["batchId"]) + "; status " + _latex(model["executionStatus"]) +
             "; runs planejadas " + str(model["completion"]["plannedRuns"]) + "; runs observadas " +
             str(model["completion"]["observedRuns"]) + "; prontidão " + _latex(model["readiness"]["overallStatus"]) + ".",
             r"\tableofcontents", r"\clearpage"])
    by_section: dict[str, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    for number, table in enumerate(model["tables"], 1):
        by_section[table["section"]].append((number, table))
    for section_number, section in enumerate(model["sections"], 1):
        lines.append(r"\section{" + _latex(section) + r"}\label{sec:" + str(section_number) + "}")
        if section == "Completude":
            lines.append("Status registrado: " + _latex(model["completion"]["completionStatus"]) + ".")
        if section == "Prontidão para Análise":
            lines.append("Status de prontidão técnica: " + _latex(model["readiness"]["overallStatus"]) + ".")
        if section == "Síntese Técnica da Execução":
            lines.append("Esta execução experimental foi registrada e validada quanto à sua integridade técnica. O status de prontidão abaixo indica se seus dados podem ser encaminhados ao módulo separado de Análise Experimental. Nenhuma inferência científica é realizada neste documento.")
        for table_number, table in by_section.get(section, []):
            lines.append("A Tabela~\\ref{tab:" + str(table_number) + "} registra os dados desta seção.")
            width = 0.77 if len(table["headers"]) >= 7 else 0.85
            columns = "".join("p{" + f"{width / len(table['headers']):.4f}" + r"\textwidth}" for _ in table["headers"])
            lines.append(r"\begin{longtable}{@{}" + columns + "@{}}")
            lines.append(r"\caption{" + _latex(table["title"]) + "; unidades: " + _latex(table["units"]) +
                         "; n=" + str(table["n"]) + "; fonte: " + _latex(table["sourceArtifact"]) +
                         r"}\label{tab:" + str(table_number) + r"}\\")
            lines.append(r"\toprule " + " & ".join(_latex(item) for item in table["headers"]) + r"\\\midrule\endfirsthead")
            lines.append(r"\toprule " + " & ".join(_latex(item) for item in table["headers"]) + r"\\\midrule\endhead")
            for row in table["rows"]:
                lines.append(" & ".join(_latex(item) for item in row) + r"\\")
            lines.extend([r"\bottomrule", r"\end{longtable}"])
    lines.append(r"\end{document}")
    return "\n".join(lines) + "\n"


def _compile_pdf(tex_path: Path) -> dict[str, Any]:
    issues = []
    log = ""
    for _ in range(3):
        completed = subprocess.run(["pdflatex", "-halt-on-error", "-interaction=nonstopmode", tex_path.name],
                                   cwd=tex_path.parent, capture_output=True, text=True, errors="replace",
                                   timeout=180, check=False)
        log = completed.stdout + completed.stderr
        if completed.returncode:
            issues.append({"type": "LATEX_COMPILE_FAILED", "detail": log[-1500:]})
            break
    log_path = tex_path.with_suffix(".log")
    if log_path.is_file():
        log = log_path.read_text(encoding="utf-8", errors="replace")
    if re.search(r"undefined references?|undefined citations?|Citation .* undefined|multiply defined|duplicate label", log, re.IGNORECASE):
        issues.append({"type": "UNRESOLVED_REFERENCE_OR_CITATION"})
    if re.search(r"Overfull \\hbox|Overfull \\vbox", log):
        issues.append({"type": "LATEX_OVERFLOW"})
    pdf = tex_path.with_suffix(".pdf")
    layout = PDFLayoutGate().validate(pdf, tex_path.parent / "layout-pages") if pdf.is_file() else {"status": "PUBLICATION_BLOCK", "issues": [{"type": "PDF_MISSING"}], "pagesRendered": 0, "pdfValid": False}
    issues.extend(layout["issues"])
    return {"status": "PASS" if not issues else "FAIL", "issues": issues,
            "pagesRendered": layout["pagesRendered"], "mediaCropTextImageValid": layout["status"] == "PASS",
            "referencesValid": not any(issue["type"] == "UNRESOLVED_REFERENCE_OR_CITATION" for issue in issues),
            "pdfValid": pdf.is_file() and not issues}


def generate_execution_report(batch_dir: Path) -> dict[str, Any]:
    """Produce exactly one technical report for a batch, or block on contamination."""
    batch_dir = Path(batch_dir).resolve()
    if not batch_dir.is_dir():
        raise FileNotFoundError(batch_dir)
    batch_id = batch_dir.name
    config, tasks, metadata, raw, initial_issues = _read_batch(batch_dir)
    isolation = _isolation(batch_dir, batch_id, raw)
    write_json(batch_dir / "batch-isolation-validation.json", isolation)
    if isolation["status"] != "PASS":
        report_dir = batch_dir / REPORT_DIRECTORY
        if report_dir.is_dir():
            for old in report_dir.iterdir():
                if old.is_file() and (old.name.startswith("execution-report-") or old.suffix in {".aux", ".log", ".out", ".toc"}):
                    old.unlink()
        return {"batchId": batch_id, "status": "EXECUTION_REPORT_GENERATION_BLOCKED",
                "reason": "Batch isolation failed", "isolation": isolation,
                "executionReportPath": None, "EXECUTION_REPORT_VALID": False,
                "READY_FOR_ANALYSIS": False}
    model, completion, instrument, readiness = _model(batch_dir, config, tasks, metadata, raw, initial_issues, isolation)
    write_json(batch_dir / "execution-completion.json", completion)
    write_json(batch_dir / "instrumentation-coverage.json", {"batchId": batch_id,
               "byCondition": instrument["byCondition"], "fieldsByCondition": instrument["fieldsByCondition"],
               "telemetryFields": model["coverage"], "invalidValues": instrument["invalidValues"]})
    write_json(batch_dir / "analysis-readiness.json", readiness)
    report_dir = batch_dir / REPORT_DIRECTORY
    report_dir.mkdir(exist_ok=True)
    for old in report_dir.iterdir():
        if old.is_file() and (old.name.startswith("execution-report-") or old.suffix in {".aux", ".log", ".out", ".toc"}):
            old.unlink()
    for name in ("execution-completion.json", "instrumentation-coverage.json",
                 "analysis-readiness.json", "batch-isolation-validation.json"):
        write_json(report_dir / name, read_json(batch_dir / name))
    data_path = report_dir / f"execution-report-data-{batch_id}.json"
    model_path = report_dir / "execution-report-model.json"
    provenance_path = report_dir / "execution-report-provenance.json"
    write_json(report_dir / "classified-runs.json", model["runs"])
    write_json(data_path, {key: value for key, value in model.items() if key != "tables"})
    write_json(model_path, model)
    write_json(provenance_path, _provenance(model))
    timestamp = datetime.fromisoformat(model["identity"]["reportGeneratedAt"]).strftime("%Y%m%dT%H%M%S")
    stem = f"execution-report-{batch_id}-{timestamp}"
    md_path = report_dir / f"{stem}.md"
    tex_path = report_dir / f"{stem}.tex"
    md_path.write_text(_markdown(read_json(model_path)), encoding="utf-8")
    tex_path.write_text(_render_latex(read_json(model_path)), encoding="utf-8")
    structure = "\n".join((md_path.read_text(encoding="utf-8"), tex_path.read_text(encoding="utf-8")))
    if PROHIBITED_STRUCTURE.search(structure):
        layout = {"status": "FAIL", "issues": [{"type": "SCIENTIFIC_CONTENT_IN_TECHNICAL_REPORT"}],
                  "pagesRendered": 0, "mediaCropTextImageValid": False, "referencesValid": False, "pdfValid": False}
    else:
        layout = _compile_pdf(tex_path)
    write_json(report_dir / "execution-report-layout-validation.json", layout)
    valid = isolation["status"] == "PASS" and layout["status"] == "PASS"
    write_json(report_dir / "execution-report-validation.json", {
        "batchId": batch_id, "EXECUTION_REPORT_VALID": valid,
        "READY_FOR_ANALYSIS": readiness["READY_FOR_ANALYSIS"],
        "executionStatus": model["executionStatus"], "layoutStatus": layout["status"]})
    pdf_path = tex_path.with_suffix(".pdf") if valid else None
    return {"batchId": batch_id, "status": "EXECUTION_REPORT_VALID" if valid else "EXECUTION_REPORT_INVALID",
            "executionReportPath": str(pdf_path) if pdf_path else None,
            "identity": model["identity"],
            "modelPath": str(model_path), "markdownPath": str(md_path), "latexPath": str(tex_path),
            "EXECUTION_REPORT_VALID": valid, "READY_FOR_ANALYSIS": readiness["READY_FOR_ANALYSIS"],
            "readiness": readiness, "completion": completion, "isolation": isolation,
            "summary": model["summary"], "layout": layout}
