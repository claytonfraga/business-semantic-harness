"""The sole analysis path from raw experimental runs to a publishable PDF."""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from typing import Any

import yaml

from .experimental_execution import (
    BatchIsolationGate, ExperimentalExecutionCompletionGate, InstrumentationCompletenessGate,
    RecognitionGroundTruthIndependenceGate, canonical_json, classify_observed, normalize_runs,
    read_json, sha256_file, task_list, write_json,
)
from .experimental_results import (
    ScientificUsabilityGate, build_evidence, compute_scientific_statistics, export_evidence_csv,
    export_pairs, pair_runs,
)
from .experimental_report import (
    PDFLayoutGate, build_number_provenance, build_report_model, compile_and_validate,
    render_figures, render_latex,
)
from .technical_execution_report import generate_execution_report


BENCHMARK = Path(__file__).resolve().parent.parent
REQUIREMENTS = BENCHMARK / "analysis-requirements.yaml"
POLICY = BENCHMARK / "analysis-policy.yaml"
PLAN = BENCHMARK / "analysis-plan.yaml"
SCIENTIFIC_OUTPUTS = (
    "normalized-runs.json", "classified-runs.json", "paired-results.csv", "paired-a-b.csv",
    "paired-b-c.csv", "paired-c-d.csv", "paired-a-d.csv", "statistics.json",
    "evidence-matrix.json", "evidence-matrix.csv", "verdicts.json", "report-model.json",
    "report-number-provenance.json", "scientific-hashes.json", "report.tex", "report.pdf",
)


class ScientificHardFail(RuntimeError):
    pass


def _read_batch(batch_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    required = ("config.yaml", "tasks.json", "metadata.json", "measurements.json")
    missing = [name for name in required if not (batch_dir / name).is_file()]
    if missing:
        raise ScientificHardFail("Artefatos brutos ausentes: " + ", ".join(missing))
    config = yaml.safe_load((batch_dir / "config.yaml").read_text(encoding="utf-8"))
    tasks = task_list(read_json(batch_dir / "tasks.json"))
    metadata = read_json(batch_dir / "metadata.json")
    runs = read_json(batch_dir / "measurements.json")
    if not isinstance(config, dict) or not isinstance(metadata, dict) or not isinstance(runs, list) or not tasks:
        raise ScientificHardFail("Artefatos brutos estruturalmente inválidos")
    if not all(isinstance(run, dict) for run in runs):
        raise ScientificHardFail("measurements.json contém run não estruturada")
    return config, tasks, metadata, runs


def _md_quality(quality: dict[str, Any], batch_id: str) -> str:
    lines = [f"# Qualidade dos dados — Execução Experimental {batch_id}", "",
             "| Condição | Métrica | Observado | Esperado | Percentual |",
             "| --- | --- | ---: | ---: | ---: |"]
    for condition, group in quality["byCondition"].items():
        for metric, data in group.items():
            if metric == "runs":
                continue
            percentage = "indisponível" if data["percentage"] is None else f"{data['percentage']:.1f}%"
            lines.append(f"| {condition} | {metric} | {data['observed']} | {data['expected']} | {percentage} |")
    return "\n".join(lines) + "\n"




def _technical_pdf(batch_dir: Path) -> Path | None:
    reports = sorted((batch_dir / "execution-report").glob("execution-report-*.pdf"))
    return reports[-1] if reports else None


def _blocked(batch_dir: Path, batch_id: str, reason: str, audit: dict[str, Any]) -> dict[str, Any]:
    for name in SCIENTIFIC_OUTPUTS:
        path = batch_dir / name
        if path.is_file():
            path.unlink()
    report_dir = batch_dir / "report"
    for name in ("report.tex", "report.pdf"):
        path = report_dir / name
        if path.is_file():
            path.unlink()
    result = {"batchId": batch_id, "status": "SCIENTIFIC_REPORT_GENERATION_BLOCKED",
              "reason": reason, "scientificReportBlocked": True, **audit}
    write_json(batch_dir / "scientific-audit.json", result)
    pdf = _technical_pdf(batch_dir)
    result["auditPdf"] = str(pdf) if pdf else None
    write_json(batch_dir / "scientific-audit.json", result)
    completion = audit.get("completion", {})
    isolation = audit.get("isolation", {})
    write_json(batch_dir / "final-publication-validation.json", {
        "batchId": batch_id, "executionComplete": completion.get("completionStatus") == "COMPLETE",
        "batchIsolated": isolation.get("status") == "PASS", "instrumentationValid": False,
        "dataQualityValid": False, "analysisEligibilityValid": False, "pairingValid": False,
        "statisticsValid": False, "recognitionGroundTruthIndependent": False,
        "evidenceMatrixValid": False, "verdictsValid": False, "reportNumbersValid": False,
        "crossReferencesValid": False, "citationsValid": False, "layoutValid": False,
        "pdfValid": False, "hardFailCount": 1 if reason.startswith("HARD_FAIL") or completion.get("completionStatus") in {"INVALID", "INCOMPLETE_NOT_RESUMABLE", "INCOMPLETE_RESUMABLE"} else 0,
        "publicationBlockCount": 1, "warningCount": 0, "PUBLICATION_READY": False,
        "status": "SCIENTIFIC_REPORT_GENERATION_BLOCKED", "reason": reason,
    })
    return result


class ScientificConsistencyChecker:
    def check(self, batch_dir: Path, runs: list[dict[str, Any]], pairs: dict[str, list[dict[str, Any]]],
              stats: dict[str, Any], evidence: list[dict[str, Any]], verdicts: dict[str, Any],
              model: dict[str, Any], numbers: list[dict[str, Any]]) -> dict[str, Any]:
        errors = []
        by_condition = stats["runsByCondition"]
        classification = stats["classificationsByCondition"]
        if any(sum(classification[condition].values()) != by_condition[condition] for condition in "ABCD"):
            errors.append("sum(classificationsByCondition) != runsByCondition")
        if sum(sum(values.values()) for values in classification.values()) != len(runs):
            errors.append("sum(classifications) != totalRuns")
        vio = stats["violations"]
        if vio["containedViolations"] + vio["escapedViolations"] != vio["eligibleViolatingRuns"]:
            errors.append("contained + escaped != eligibleViolatingRuns")
        false_block = stats["falseBlocks"]
        if false_block["falseBlocksObserved"] > false_block["falseBlockOpportunities"]:
            errors.append("falseBlocks > falseBlockOpportunities")
        for label, rows in pairs.items():
            left, right = label.split("-")
            if sum(row["status"] == "PAIRED" for row in rows) > min(by_condition[left], by_condition[right]):
                errors.append(f"pairedRuns > min(leftRuns,rightRuns): {label}")
        if model.get("statistics") != stats or model.get("evidenceMatrix") != evidence or model.get("verdicts") != verdicts:
            errors.append("report-model diverges from statistics/evidence/verdicts")
        unsigned = copy.deepcopy(model)
        declared_hash = unsigned.pop("scientificContentHash", None)
        if isinstance(unsigned.get("provenance"), dict):
            unsigned["provenance"].pop("scientificContentHash", None)
        if declared_hash != hashlib.sha256(canonical_json(unsigned).encode("utf-8")).hexdigest():
            errors.append("report scientific content hash mismatch")
        requirements = yaml.safe_load(REQUIREMENTS.read_text(encoding="utf-8"))
        policy = yaml.safe_load(POLICY.read_text(encoding="utf-8"))
        expected_evidence, expected_verdicts = build_evidence(stats, requirements, policy)
        if evidence != expected_evidence:
            errors.append("evidence matrix diverges from statistics")
        if verdicts != expected_verdicts:
            errors.append("verdicts diverge from evidence matrix/statistics")
        if numbers != build_number_provenance(model):
            errors.append("report number provenance diverges from report model")
        if [row.get("verdict") for row in evidence] != [verdicts.get("researchQuestions", {}).get(row.get("researchQuestion"), {}).get("verdict") for row in evidence]:
            errors.append("evidence matrix diverges from verdicts")
        if any(row["batchId"] != stats["batchId"] for row in evidence):
            errors.append("foreign batch in evidence")
        if any(number["batchId"] != stats["batchId"] for number in numbers):
            errors.append("foreign batch in number provenance")
        rq1 = stats["researchQuestions"]["RQ1_A"]["metric"]
        if rq1["sumTokensA"] in (None, 0) and rq1["WORKLOAD_TOKEN_REDUCTION"] is not None:
            errors.append("token reduction without denominator")
        rq8 = stats["researchQuestions"]["RQ8"]["metric"]["correlation"]
        if rq8["status"] != "COMPUTABLE" and (rq8["pearson"] is not None or rq8["spearman"] is not None):
            errors.append("correlation interpreted when not computable")
        rq11 = stats["researchQuestions"]["RQ11"]["metric"]
        if rq11["independentEnforcementActivated"] == 0 and any(row.get("researchQuestion") == "RQ11" and row.get("verdict") == "SUSTENTADO_NESTE_LOTE" for row in evidence):
            errors.append("independent enforcement claimed without activation")
        report_text = json.dumps({"sections": model.get("sections"), "abstract": model.get("abstract")}, ensure_ascii=False).lower()
        if rq11["independentEnforcementActivated"] == 0 and re.search(
            r"(?:enforcement independente|independent enforcement).{0,32}(?:bem.sucedido|successful|comprovado)", report_text):
            errors.append("report claims successful independent enforcement without activation")
        if vio["eligibleViolatingRuns"] > 0 and vio["containedViolations"] < vio["eligibleViolatingRuns"]:
            if re.search(r"100\s*%\s*(?:das\s+)?(?:violações\s+)?(?:prevenid[ao]s?|contid[ao]s?)", report_text):
                errors.append("report claims 100% prevention against observed escapes")
        rq10 = stats["researchQuestions"]["RQ10"]["metric"]
        if rq10["semanticViolationsPassingTests"] == 0 and "multiple violations escaped tests" in json.dumps(model).lower():
            errors.append("report claims unsupported semantic test escapes")
        if stats["researchQuestions"]["RQ1_B"]["nBaseTasks"] == 1 and "multiple equivalent tasks" in json.dumps(model).lower():
            errors.append("report overstates equivalent base tasks")
        for name, expected in (("statistics.json", stats), ("evidence-matrix.json", evidence),
                               ("verdicts.json", verdicts), ("report-model.json", model),
                               ("report-number-provenance.json", numbers)):
            path = batch_dir / name
            if not path.is_file() or read_json(path) != expected:
                errors.append(f"stale or missing {name}")
        return {"status": "PASS" if not errors else "HARD_FAIL", "issues": errors}


def analyze_experimental_execution(batch_id_or_path: str | Path, *, publish: bool = True) -> dict[str, Any]:
    """Analyze existing raw data only; never starts agents or creates runs."""
    batch_dir = Path(batch_id_or_path).resolve()
    if not batch_dir.is_dir():
        batch_dir = (BENCHMARK / "results" / str(batch_id_or_path)).resolve()
    if not batch_dir.is_dir():
        raise ScientificHardFail(f"Execução Experimental não encontrada: {batch_id_or_path}")
    batch_id = batch_dir.name
    declared_batch = os.environ.get("ANALYSIS_BATCH_ID")
    if declared_batch and declared_batch != batch_id:
        return _blocked(batch_dir, batch_id, "HARD_FAIL: ANALYSIS_BATCH_ID diverge do batch selecionado",
                        {"isolation": {"status": "HARD_FAIL", "declaredBatchId": declared_batch, "batchId": batch_id}})
    technical = generate_execution_report(batch_dir)
    if technical["status"] == "EXECUTION_REPORT_GENERATION_BLOCKED":
        return _blocked(batch_dir, batch_id, "HARD_FAIL: technical execution report batch isolation",
                        {"isolation": technical["isolation"], "executionReport": technical})
    if not technical["EXECUTION_REPORT_VALID"] or technical["readiness"]["overallStatus"] == "NOT_READY_FOR_ANALYSIS":
        return _blocked(batch_dir, batch_id, "HARD_FAIL: technical execution integrity or report layout",
                        {"completion": technical["completion"], "isolation": technical["isolation"],
                         "executionReport": technical})
    try:
        config, tasks, metadata, raw = _read_batch(batch_dir)
    except ScientificHardFail as error:
        return _blocked(batch_dir, batch_id, str(error), {})
    completion = ExperimentalExecutionCompletionGate(batch_dir).evaluate(config, tasks, metadata, raw)
    write_json(batch_dir / "execution-validation.json", completion)
    if completion["completionStatus"] != "COMPLETE":
        return _blocked(batch_dir, batch_id, completion["completionStatus"], {"completion": completion})
    isolation = BatchIsolationGate(batch_dir, batch_id).evaluate(raw)
    write_json(batch_dir / "batch-isolation-validation.json", isolation)
    if isolation["status"] != "PASS":
        return _blocked(batch_dir, batch_id, "HARD_FAIL: batch contamination", {"completion": completion, "isolation": isolation})
    normalized = normalize_runs(batch_id, raw, tasks)
    write_json(batch_dir / "normalized-runs.json", normalized)
    classified = [classify_observed(run) for run in normalized]
    for run in classified:
        run["availability"]["classification"] = "PRESENT"
    write_json(batch_dir / "classified-runs.json", classified)
    instrumentation = InstrumentationCompletenessGate().evaluate(classified)
    write_json(batch_dir / "instrumentation-completeness.json", instrumentation)
    quality = {"batchId": batch_id, "status": "PASS" if instrumentation["invalidValues"] == 0 else "HARD_FAIL",
               "byCondition": instrumentation["byCondition"]}
    write_json(batch_dir / "data-quality.json", quality)
    (batch_dir / "data-quality.md").write_text(_md_quality(quality, batch_id), encoding="utf-8")
    if quality["status"] != "PASS":
        return _blocked(batch_dir, batch_id, "HARD_FAIL: invalid instrumentation values", {"completion": completion, "isolation": isolation, "instrumentation": instrumentation, "quality": quality})
    ground_truth = RecognitionGroundTruthIndependenceGate().evaluate(classified, batch_dir)
    write_json(batch_dir / "ground-truth-independence.json", ground_truth)
    pairs = pair_runs(classified)
    export_pairs(batch_dir, pairs)
    requirements = yaml.safe_load(REQUIREMENTS.read_text(encoding="utf-8"))
    policy = yaml.safe_load(POLICY.read_text(encoding="utf-8"))
    plan = yaml.safe_load(PLAN.read_text(encoding="utf-8"))
    stats = compute_scientific_statistics(classified, pairs, requirements, {**policy, "statistical_methods": plan.get("statistical_methods", {})}, ground_truth)
    write_json(batch_dir / "statistics.json", stats)
    usability = ScientificUsabilityGate().evaluate(stats, requirements)
    write_json(batch_dir / "scientific-usability.json", usability)
    evidence, verdicts = build_evidence(stats, requirements, policy)
    write_json(batch_dir / "evidence-matrix.json", evidence)
    export_evidence_csv(batch_dir / "evidence-matrix.csv", evidence)
    write_json(batch_dir / "verdicts.json", verdicts)
    hashes = {name: sha256_file(batch_dir / name if name in {"config.yaml", "tasks.json", "measurements.json", "metadata.json"} else BENCHMARK / name)
              for name in ("config.yaml", "tasks.json", "measurements.json", "metadata.json", "analysis-plan.yaml", "analysis-policy.yaml")}
    generator_sources = ("core/experimental_execution.py", "core/experimental_results.py",
                         "core/experimental_report.py", "core/scientific_pipeline.py")
    hashes["reportGeneratorTreeHash"] = hashlib.sha256(canonical_json(
        {name: sha256_file(BENCHMARK / name) for name in generator_sources}).encode("utf-8")).hexdigest()
    commit_result = subprocess.run(["/usr/bin/rtk", "git", "rev-parse", "HEAD"], cwd=BENCHMARK.parent,
                                   capture_output=True, text=True, errors="replace", check=False)
    hashes["reportGeneratorCommit"] = commit_result.stdout.strip() if commit_result.returncode == 0 else None
    model = build_report_model(batch_id, metadata, config, completion, quality, isolation, usability, ground_truth,
                               stats, evidence, verdicts, pairs, hashes)
    write_json(batch_dir / "report-model.json", model)
    numbers = build_number_provenance(model)
    write_json(batch_dir / "report-number-provenance.json", numbers)
    write_json(batch_dir / "scientific-hashes.json", {"batchId": batch_id, "scientificContentHash": model["scientificContentHash"],
                                                     "sourceHashes": hashes})
    checker = ScientificConsistencyChecker().check(batch_dir, classified, pairs, stats, evidence, verdicts, model, numbers)
    write_json(batch_dir / "scientific-consistency.json", checker)
    if checker["status"] != "PASS":
        return _blocked(batch_dir, batch_id, "HARD_FAIL: scientific consistency", {"completion": completion, "isolation": isolation, "quality": quality, "gates": checker})
    audit = {"completion": completion, "isolation": isolation, "instrumentation": instrumentation,
             "quality": quality, "pairing": {key: {"nRuns": sum(row["status"] == "PAIRED" for row in rows),
                                                   "nBaseTasks": len({row["baseTaskId"] for row in rows if row["status"] == "PAIRED"})} for key, rows in pairs.items()},
             "provenance": hashes, "gates": checker, "scientificReportBlocked": False}
    audit_pdf = _technical_pdf(batch_dir)
    if publish and audit_pdf is None:
        return _blocked(batch_dir, batch_id, "PUBLICATION_BLOCK: audit PDF compilation", audit)
    publication = {"executionComplete": True, "batchIsolated": True, "instrumentationValid": True,
                   "dataQualityValid": True, "analysisEligibilityValid": True, "pairingValid": True,
                   "statisticsValid": True, "recognitionGroundTruthIndependent": ground_truth["recognitionMetricsValid"],
                   "evidenceMatrixValid": True, "verdictsValid": True, "reportNumbersValid": True,
                   "crossReferencesValid": False, "citationsValid": False, "layoutValid": False, "pdfValid": False,
                   "hardFailCount": 0, "publicationBlockCount": 0, "warningCount": sum(value["status"] != "USABLE" for value in usability["byResearchQuestion"].values()),
                   "PUBLICATION_READY": False, "batchId": batch_id}
    if publish:
        render_figures(model, batch_dir)
        tex = render_latex(read_json(batch_dir / "report-model.json"), batch_dir)
        pdf_gate = compile_and_validate(tex, model)
        write_json(batch_dir / "pdf-layout-validation.json", pdf_gate)
        publication.update({key: pdf_gate[key] for key in ("crossReferencesValid", "citationsValid", "layoutValid", "pdfValid")})
        publication["publicationBlockCount"] = len(pdf_gate["issues"])
        if pdf_gate["status"] == "PASS":
            (batch_dir / "report.pdf").write_bytes(tex.with_suffix(".pdf").read_bytes())
            (batch_dir / "report.tex").write_text(tex.read_text(encoding="utf-8"), encoding="utf-8")
    publication["PUBLICATION_READY"] = publication["hardFailCount"] == 0 and publication["publicationBlockCount"] == 0 and all(publication[key] for key in ("executionComplete", "batchIsolated", "instrumentationValid", "dataQualityValid", "analysisEligibilityValid", "pairingValid", "statisticsValid", "evidenceMatrixValid", "verdictsValid", "reportNumbersValid", "crossReferencesValid", "citationsValid", "layoutValid", "pdfValid"))
    write_json(batch_dir / "final-publication-validation.json", publication)
    return {"batchId": batch_id, "status": "PUBLICATION_READY" if publication["PUBLICATION_READY"] else ("ANALYSIS_READY" if not publish else "PUBLICATION_BLOCK"),
            "auditPdf": str(audit_pdf) if audit_pdf else None, "publication": publication}
