"""Deterministic pairing, estimands and evidence for one experimental execution."""

from __future__ import annotations

from collections import Counter, defaultdict
import csv
import math
from pathlib import Path
import random
from statistics import NormalDist, mean, median, stdev, variance
from typing import Any


from .enums import EvidenceStrength, EvidenceVerdict, ResearchQuestionStatus, ScientificUsability
from .experimental_execution import token_accounting_comparability


CONTRASTS = (("A", "B"), ("B", "C"), ("C", "D"), ("A", "D"))
RQ_IDS = ("RQ1_A", "RQ1_B", "RQ2", "RQ3", "RQ4", "RQ5", "RQ6", "RQ7", "RQ8", "RQ9", "RQ10", "RQ11")


def pair_runs(runs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[tuple[str, int, str | None, str], dict[str, Any]] = {}
    for run in runs:
        key = (run["baseTaskId"], run["replicationIndex"], run.get("promptVariantId"), run["condition"])
        if key in groups:
            raise ValueError(f"HARD_FAIL: pareamento duplicado: {key}")
        groups[key] = run
    base_keys = sorted({(base, rep, variant) for base, rep, variant, _ in groups}, key=lambda item: (item[0], item[1], item[2] or ""))
    result: dict[str, list[dict[str, Any]]] = {}
    for left_condition, right_condition in CONTRASTS:
        label = f"{left_condition}-{right_condition}"
        pairs = []
        for base, rep, variant in base_keys:
            left = groups.get((base, rep, variant, left_condition))
            right = groups.get((base, rep, variant, right_condition))
            if left is None or right is None:
                status = "NO_MATCHING_RUN"
            elif left["taskType"] != right["taskType"] or left.get("model") != right.get("model"):
                status = "INCOMPATIBLE_PAIR"
            elif left.get("totalTokens") is None or right.get("totalTokens") is None:
                status = "MISSING_REQUIRED_DATA"
            else:
                status = "PAIRED"
            comparable = token_accounting_comparability(left, right) if left and right else "INDETERMINATE"
            pairs.append({
                "baseTaskId": base, "replicationIndex": rep, "promptVariantId": variant,
                "leftCondition": left_condition, "rightCondition": right_condition,
                "leftRunId": left.get("runId") if left else None, "rightRunId": right.get("runId") if right else None,
                "leftTokens": left.get("totalTokens") if left else None,
                "rightTokens": right.get("totalTokens") if right else None,
                "leftDuration": left.get("durationSeconds") if left else None,
                "rightDuration": right.get("durationSeconds") if right else None,
                "leftClassification": left.get("classification") if left else None,
                "rightClassification": right.get("classification") if right else None,
                "taskType": left.get("taskType") if left else (right.get("taskType") if right else None),
                "operation": left.get("operation") if left else (right.get("operation") if right else None),
                "difficulty": left.get("difficulty") if left else (right.get("difficulty") if right else None),
                "taskCategory": left.get("taskCategory") if left else (right.get("taskCategory") if right else None),
                "behavioralEquivalence": right.get("behavioralEquivalence") if right else None,
                "functionalCorrectnessLeft": left.get("functionalCorrectness") if left else None,
                "functionalCorrectnessRight": right.get("functionalCorrectness") if right else None,
                "governanceCorrectnessLeft": left.get("governanceCorrectness") if left else None,
                "governanceCorrectnessRight": right.get("governanceCorrectness") if right else None,
                "tokenAccountingComparable": comparable,
                "status": status,
            })
        result[label] = pairs
    return result


def export_pairs(batch_dir: Path, pairs: dict[str, list[dict[str, Any]]]) -> None:
    first_row = next((row for rows in pairs.values() for row in rows), None)
    fieldnames = list(first_row) if first_row else ["baseTaskId", "replicationIndex", "promptVariantId", "status"]
    for contrast, rows in pairs.items():
        path = batch_dir / f"paired-{contrast.lower()}.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
    with (batch_dir / "paired-results.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["contrast", *fieldnames])
        writer.writeheader()
        for contrast, rows in pairs.items():
            writer.writerows({"contrast": contrast, **row} for row in rows)


def _ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator > 0 else None


def _wilson(successes: int, total: int, confidence: float) -> list[float] | None:
    if total <= 0:
        return None
    z = NormalDist().inv_cdf(1 - (1 - confidence) / 2)
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0.0, center - half), min(1.0, center + half)]


def _cluster_bootstrap(values: list[tuple[str, float]], iterations: int, seed: int, confidence: float) -> list[float] | None:
    clusters: dict[str, list[float]] = defaultdict(list)
    for base, value in values:
        clusters[base].append(value)
    keys = sorted(clusters)
    if len(keys) < 2 or iterations <= 0:
        return None
    rng = random.Random(seed)
    samples = []
    for _ in range(iterations):
        draw = [rng.choice(keys) for _ in keys]
        samples.append(mean(value for key in draw for value in clusters[key]))
    samples.sort()
    tail = (1 - confidence) / 2
    return [samples[int(tail * (len(samples) - 1))], samples[int((1 - tail) * (len(samples) - 1))]]


def _cluster_ratio_bootstrap(pairs: list[dict[str, Any]], policy: dict[str, Any]) -> list[float] | None:
    clusters: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for pair in pairs:
        clusters[pair["baseTaskId"]].append(pair)
    keys = sorted(clusters)
    if len(keys) < 2:
        return None
    settings = policy.get("statistical_methods", {}).get("bootstrap", {})
    iterations = int(settings.get("iterations", 1000))
    if iterations <= 0:
        return None
    rng = random.Random(int(settings.get("seed", 42)))
    estimates = []
    for _ in range(iterations):
        draw = [rng.choice(keys) for _ in keys]
        selected = [pair for key in draw for pair in clusters[key]]
        denominator = sum(pair["leftTokens"] for pair in selected)
        if denominator > 0:
            estimates.append(1 - sum(pair["rightTokens"] for pair in selected) / denominator)
    if not estimates:
        return None
    estimates.sort()
    tail = (1 - float(settings.get("confidence_level", 0.95))) / 2
    return [estimates[int(tail * (len(estimates) - 1))], estimates[int((1 - tail) * (len(estimates) - 1))]]


def _summary(values: list[float], clustered: list[tuple[str, float]], policy: dict[str, Any]) -> dict[str, Any]:
    boot = policy.get("statistical_methods", {}).get("bootstrap", {})
    return {
        "nRuns": len(values), "nBaseTasks": len({base for base, _ in clustered}),
        "mean": mean(values) if values else None,
        "median": median(values) if values else None,
        "standardDeviation": stdev(values) if len(values) > 1 else None,
        "minimum": min(values) if values else None,
        "maximum": max(values) if values else None,
        "confidenceInterval": _cluster_bootstrap(clustered, int(boot.get("iterations", 1000)), int(boot.get("seed", 42)), float(boot.get("confidence_level", 0.95))),
    }


def _strength(n_base: int, policy: dict[str, Any]) -> str:
    thresholds = policy.get("thresholds", {}).get("analysis", {}).get("evidence_strength", {})
    if n_base >= int(thresholds.get("strong_min_base_tasks", 20)):
        return EvidenceStrength.FORTE.value
    if n_base >= int(thresholds.get("moderate_min_base_tasks", 6)):
        return EvidenceStrength.MODERADA.value
    if n_base > 0:
        return EvidenceStrength.LIMITADA.value
    return EvidenceStrength.AUSENTE.value


def _rq(status: str, rows: list[dict[str, Any]], required: list[str], available: list[str], metric: Any, limitations: list[str]) -> dict[str, Any]:
    run_ids = sorted({run_id for row in rows for run_id in (row.get("leftRunId"), row.get("rightRunId"), row.get("runId")) if run_id})
    return {"status": status, "nRuns": len(run_ids), "nBaseTasks": len({row["baseTaskId"] for row in rows}),
            "requiredEvidence": required, "availableEvidence": available, "metric": metric, "limitations": limitations,
            "sourceRuns": run_ids,
            "sourceBaseTasks": sorted({row["baseTaskId"] for row in rows})}


def recognition_metrics(runs: list[dict[str, Any]], independent: bool) -> dict[str, Any]:
    if not independent:
        return {"status": ResearchQuestionStatus.NAO_AVALIADA.value, "recognitionMetricsValid": False,
                "operation": None, "shape": None}
    operation = Counter({"TP": 0, "FP": 0, "FN": 0, "TN": 0})
    shape = Counter({"ShapeTP": 0, "ShapeFP": 0, "ShapeFN": 0})
    eligible = []
    for run in runs:
        if run["condition"] not in {"C", "D"}:
            continue
        expected_op = run.get("expectedOperation")
        observed_op = run.get("identifiedOperation")
        observed_shapes = run.get("identifiedShapes")
        if observed_op is None or observed_shapes is None:
            continue
        eligible.append(run)
        if expected_op and observed_op == expected_op:
            operation["TP"] += 1
        elif expected_op and observed_op != expected_op:
            operation["FP"] += 1
            operation["FN"] += 1
        elif not expected_op and observed_op:
            operation["FP"] += 1
        else:
            operation["TN"] += 1
        expected_shapes = set(run.get("expectedShapes") or []) - {"NAO_APLICAVEL", "NOT_APPLICABLE"}
        observed_set = set(observed_shapes) - {"NAO_APLICAVEL", "NOT_APPLICABLE"}
        shape["ShapeTP"] += len(expected_shapes & observed_set)
        shape["ShapeFP"] += len(observed_set - expected_shapes)
        shape["ShapeFN"] += len(expected_shapes - observed_set)
    if not eligible:
        return {"status": ResearchQuestionStatus.DADOS_INSUFICIENTES.value, "recognitionMetricsValid": True,
                "operation": None, "shape": None}
    operation_result = {**operation,
        "precision": _ratio(operation["TP"], operation["TP"] + operation["FP"]),
        "recall": _ratio(operation["TP"], operation["TP"] + operation["FN"]),
        "specificity": _ratio(operation["TN"], operation["TN"] + operation["FP"]),
        "falsePositiveRate": _ratio(operation["FP"], operation["FP"] + operation["TN"])}
    shape_result = {**shape,
        "precision": _ratio(shape["ShapeTP"], shape["ShapeTP"] + shape["ShapeFP"]),
        "recall": _ratio(shape["ShapeTP"], shape["ShapeTP"] + shape["ShapeFN"])}
    return {"status": ResearchQuestionStatus.DESCRITIVA.value, "recognitionMetricsValid": True,
            "nRuns": len(eligible), "nBaseTasks": len({run["baseTaskId"] for run in eligible}),
            "operation": operation_result, "shape": shape_result}


def compute_scientific_statistics(runs: list[dict[str, Any]], pairs: dict[str, list[dict[str, Any]]],
                                  requirements: dict[str, Any], policy: dict[str, Any], ground_truth: dict[str, Any]) -> dict[str, Any]:
    by_condition = {condition: [run for run in runs if run["condition"] == condition] for condition in "ABCD"}
    classifications = {condition: dict(sorted(Counter(run["classification"] for run in group).items())) for condition, group in by_condition.items()}
    rq: dict[str, Any] = {}
    ad = [pair for pair in pairs["A-D"] if pair["status"] == "PAIRED"]
    comparable = [pair for pair in ad if pair["tokenAccountingComparable"] == "TRUE"]
    a_sum = sum(pair["leftTokens"] for pair in comparable)
    d_sum = sum(pair["rightTokens"] for pair in comparable)
    reduction = (1 - d_sum / a_sum) if comparable and a_sum > 0 else None
    eligible_ad = [pair for pair in comparable if pair["leftTokens"] > 0]
    inferential_min = int(policy.get("thresholds", {}).get("analysis", {}).get("inferential_min_base_tasks", 6))
    rq["RQ1_A"] = _rq(
        (ResearchQuestionStatus.RESPONDIDA.value if len({p["baseTaskId"] for p in comparable}) >= inferential_min else ResearchQuestionStatus.DESCRITIVA.value) if reduction is not None else ResearchQuestionStatus.DADOS_INSUFICIENTES.value,
        comparable, requirements["RQ1_A"]["requires"], ["totalTokens:A", "totalTokens:D", "comparableTokenAccounting"] if reduction is not None else [],
        {"WORKLOAD_TOKEN_REDUCTION": reduction, "sumTokensA": a_sum if comparable else None,
         "sumTokensD": d_sum if comparable else None, "eligiblePairs": len(comparable),
         "confidenceInterval": _cluster_ratio_bootstrap(comparable, policy) if reduction is not None else None},
         [] if reduction is not None else (
             ["Sem pares A-D pareados neste batch: não há base de pareamento"] if not ad
             else ["Pares A-D existem, mas a contabilidade de tokens não é comparável (não integrada ao cálculo), portanto o consumo bruto não é estimável"] if not comparable
             else ["Denominador A não positivo entre os pares comparáveis"] if a_sum <= 0
             else ["Telemetria de tokens ausente em algum par comparável"]))
    equivalent = [pair for pair in eligible_ad if pair["taskType"] == "valida_governada" and pair["functionalCorrectnessLeft"] is True and pair["functionalCorrectnessRight"] is True and pair["behavioralEquivalence"] == "EQUIVALENTE"]
    eq_delta = [(pair["baseTaskId"], pair["leftTokens"] - pair["rightTokens"]) for pair in equivalent]
    eq_status = ResearchQuestionStatus.DADOS_INSUFICIENTES if not equivalent else (ResearchQuestionStatus.DESCRITIVA if len({p["baseTaskId"] for p in equivalent}) < inferential_min else ResearchQuestionStatus.RESPONDIDA)
    rq["RQ1_B"] = _rq(eq_status.value, equivalent, requirements["RQ1_B"]["requires"], requirements["RQ1_B"]["requires"] if equivalent else [],
                       _summary([value for _, value in eq_delta], eq_delta, policy) if equivalent else None,
                       ["Número de tarefas-base abaixo do limiar inferencial; sem inferência populacional"] if eq_status == ResearchQuestionStatus.DESCRITIVA else ([] if equivalent else ["Não há pares válidos, corretos e comprovadamente equivalentes"]))
    valid_saving = sum(max(0, value) for _, value in eq_delta) if equivalent else None
    valid_overhead = sum(max(0, -value) for _, value in eq_delta) if equivalent else None
    invalid_governed = [pair for pair in comparable if pair["taskType"] == "violadora" and pair["leftClassification"] in {"ALTERACAO_INCORRETA", "VIOLACAO_NAO_DETECTADA"} and pair["rightClassification"] in {"BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA"}]
    avoided = sum(max(0, pair["leftTokens"] - pair["rightTokens"]) for pair in invalid_governed) if invalid_governed else None
    net = valid_saving - valid_overhead + avoided if all(item is not None for item in (valid_saving, valid_overhead, avoided)) else None
    rq["RQ2"] = _rq(ResearchQuestionStatus.DESCRITIVA.value if net is not None else ResearchQuestionStatus.DADOS_INSUFICIENTES.value,
                    equivalent + invalid_governed, requirements["RQ2"]["requires"], requirements["RQ2"]["requires"] if net is not None else [],
                    {"EconomiaValidasEquivalentes": valid_saving, "OverheadValidasEquivalentes": valid_overhead,
                     "CustoEvitadoVioladoras": avoided, "BeneficioLiquido": net},
                    [] if net is not None else ["Componente não observável; benefício líquido não calculável"])
    for rq_id, contrast in (("RQ3", "A-B"), ("RQ4", "B-C"), ("RQ5", "C-D")):
        matched = [pair for pair in pairs[contrast] if pair["status"] == "PAIRED"]
        deltas = [(pair["baseTaskId"], pair["leftTokens"] - pair["rightTokens"]) for pair in matched if pair["tokenAccountingComparable"] == "TRUE"]
        metric = {"contrast": contrast, "classificationTransitions": dict(sorted(Counter(f"{pair['leftClassification']}->{pair['rightClassification']}" for pair in matched).items())),
                  "tokenDifference": _summary([value for _, value in deltas], deltas, policy) if deltas else None}
        if rq_id == "RQ5":
            metric["independentEnforcementActivated"] = sum(run["independentEnforcementActivated"] is True for run in by_condition["D"])
            metric["validationOutcomes"] = dict(sorted(Counter(
                run.get("validationStatus") or "MISSING" for run in by_condition["D"]).items()))
        fields = [f"paired:{contrast.replace('-', ':')}", f"classification:{contrast[0]}", f"classification:{contrast[-1]}"] if matched else []
        if rq_id == "RQ5" and by_condition["D"] and all(
            run.get("evidenceCollectionStatus") == "VALID" and
            run.get("validationStatus") in {"CONFORMING", "VIOLATION", "INDETERMINATE", "VALIDATION_ERROR"} and
            isinstance(run.get("validationExecuted"), bool) and
            isinstance(run.get("validationComplete"), bool) and
            run.get("promotionDecision") in {"ALLOW", "DENY", "REVALIDATION_REQUIRED"}
            for run in by_condition["D"]):
            fields.append("enforcementEvidence")
        rq[rq_id] = _rq(ResearchQuestionStatus.DESCRITIVA.value if matched else ResearchQuestionStatus.DADOS_INSUFICIENTES.value,
                        matched, requirements[rq_id]["requires"], fields, metric,
                        ["Contraste observacional; mecanismo isolado apenas se evidência específica existir"] if matched else ["Sem pares elegíveis"])
    recognition = recognition_metrics(runs, ground_truth.get("recognitionMetricsValid") is True)
    semantic_rows = [run for run in runs if run["condition"] in {"C", "D"} and run.get("identifiedOperation") is not None and run.get("identifiedShapes") is not None]
    rq["RQ6"] = _rq(recognition["status"], semantic_rows, requirements["RQ6"]["requires"], requirements["RQ6"]["requires"] if recognition["status"] == ResearchQuestionStatus.DESCRITIVA.value else [], recognition,
                    [] if recognition["status"] == ResearchQuestionStatus.DESCRITIVA.value else ["Ground truth não independente ou evidência semântica ausente"])
    mechanisms = dict(sorted(Counter(run["governanceMechanism"] for run in runs).items()))
    mechanism_outcomes = dict(sorted(Counter(
        f"{run['governanceMechanism']} × {run['classification']}" for run in runs).items()))
    interactions = dict(sorted(Counter(run["governanceInteraction"] for run in runs).items()))
    interventions = dict(sorted(Counter(run["governanceIntervention"] for run in runs).items()))
    rq["RQ7"] = _rq(ResearchQuestionStatus.DESCRITIVA.value, runs, requirements["RQ7"]["requires"], requirements["RQ7"]["requires"],
                    {"mechanisms": mechanisms, "mechanismByOutcome": mechanism_outcomes,
                     "governanceInteraction": interactions, "governanceIntervention": interventions}, [])
    time_pairs = [pair for pair in comparable if pair["leftDuration"] is not None and pair["rightDuration"] is not None]
    time_deltas = [(pair["baseTaskId"], pair["rightDuration"] - pair["leftDuration"]) for pair in time_pairs]
    token_deltas = [pair["leftTokens"] - pair["rightTokens"] for pair in time_pairs]
    min_correlation = int(policy.get("thresholds", {}).get("analysis", {}).get("correlation_min_eligible_pairs", 6))
    correlation: dict[str, Any] = {"status": "NOT_COMPUTABLE", "pearson": None, "spearman": None}
    if len(time_pairs) >= min_correlation and len({pair["baseTaskId"] for pair in time_pairs}) >= 2 and variance(token_deltas) > 0 and variance([delta for _, delta in time_deltas]) > 0:
        from scipy.stats import pearsonr, spearmanr
        correlation = {"status": "COMPUTABLE", "pearson": float(pearsonr(token_deltas, [delta for _, delta in time_deltas]).statistic),
                       "spearman": float(spearmanr(token_deltas, [delta for _, delta in time_deltas]).statistic)}
    rq["RQ8"] = _rq(ResearchQuestionStatus.DESCRITIVA.value if correlation["status"] == "COMPUTABLE" else ResearchQuestionStatus.DADOS_INSUFICIENTES.value,
                    time_pairs, requirements["RQ8"]["requires"], requirements["RQ8"]["requires"] if correlation["status"] == "COMPUTABLE" else [],
                    {"correlation": correlation, "DeltaTime": _summary([value for _, value in time_deltas], time_deltas, policy),
                     "TimeVariationPercentage": _summary([100 * (pair["rightDuration"] - pair["leftDuration"]) / pair["leftDuration"] for pair in time_pairs if pair["leftDuration"] > 0], [(pair["baseTaskId"], 100 * (pair["rightDuration"] - pair["leftDuration"]) / pair["leftDuration"]) for pair in time_pairs if pair["leftDuration"] > 0], policy)},
                    [] if correlation["status"] == "COMPUTABLE" else ["Pares insuficientes ou variância nula; correlação não calculável"])
    distribution: dict[str, dict[str, Any]] = {}
    for field in ("baseTaskId", "taskCategory", "operation", "difficulty", "taskType"):
        values: dict[str, list[float]] = defaultdict(list)
        for pair in comparable:
            values[str(pair.get(field) or "NAO_DISPONIVEL")].append(pair["leftTokens"] - pair["rightTokens"])
        distribution[field] = {key: {"nRuns": len(items), "netTokens": sum(items), "savings": sum(max(0, value) for value in items), "overhead": sum(max(0, -value) for value in items)} for key, items in sorted(values.items())}
    rq["RQ9"] = _rq(ResearchQuestionStatus.DESCRITIVA.value if comparable else ResearchQuestionStatus.DADOS_INSUFICIENTES.value,
                    comparable, requirements["RQ9"]["requires"], requirements["RQ9"]["requires"] if comparable and all(pair.get("taskCategory") is not None for pair in comparable) else [], distribution, [] if comparable else ["Sem pares comparáveis"])
    implemented = [run for run in runs if run["taskType"] == "violadora" and run.get("violacaoImplementada") is True]
    testable = [run for run in implemented if run.get("testsExecuted") is True and isinstance(run.get("testsPassed"), bool) and run.get("semanticStatus") in {"conforme", "violacao"}]
    matrix = Counter({f"tests_{str(passed).lower()}__semantic_{semantic}": 0
                      for passed in (True, False) for semantic in ("conforme", "violacao")})
    matrix.update(f"tests_{str(run['testsPassed']).lower()}__semantic_{run['semanticStatus']}" for run in testable)
    passing = sum(run["testsPassed"] is True and run["semanticStatus"] == "violacao" for run in testable)
    failing = sum(run["testsPassed"] is False and run["semanticStatus"] == "violacao" for run in testable)
    rq["RQ10"] = _rq(ResearchQuestionStatus.DESCRITIVA.value if testable else ResearchQuestionStatus.DADOS_INSUFICIENTES.value,
                     testable, requirements["RQ10"]["requires"], requirements["RQ10"]["requires"] if testable else [],
                     {"semanticViolationsImplemented": len(implemented), "semanticViolationsPassingTests": passing,
                      "semanticViolationsFailingTests": failing, "testsSemanticMatrix": dict(matrix)},
                     [] if testable else ["Nenhuma violação implementada com testes e status semântico observados"])
    opportunity = [run for run in by_condition["D"] if run.get("changeSetDetected") is True
                   and run.get("candidateEnforcementApplicable") is True
                   and run.get("validationStatus") == "VIOLATION"
                   and run.get("validationExecuted") is True and run.get("validationComplete") is True
                   and isinstance(run.get("candidateFingerprint"), str)
                   and run.get("reportConflictCalled") is False]
    independent = [run for run in opportunity if run["independentEnforcementActivated"] is True]
    independent_fields = [field for field in requirements["RQ11"]["requires"]
                          if opportunity and all(run.get(field) is not None for run in opportunity)]
    rq["RQ11"] = _rq(ResearchQuestionStatus.DESCRITIVA.value if opportunity else ResearchQuestionStatus.NAO_AVALIADA.value,
                     opportunity, requirements["RQ11"]["requires"], independent_fields,
                     {"independentOpportunities": len(opportunity), "independentEnforcementActivated": len(independent)},
                     [] if opportunity else ["Nenhuma oportunidade real de enforcement independente"])
    for rq_id, entry in rq.items():
        missing_requirements = [field for field in requirements[rq_id]["requires"] if field not in entry["availableEvidence"]]
        if missing_requirements and entry["status"] != ResearchQuestionStatus.NAO_AVALIADA.value:
            entry["status"] = ResearchQuestionStatus.DADOS_INSUFICIENTES.value
            entry["limitations"].append("Requisitos ausentes: " + ", ".join(missing_requirements))
    valid_opportunities = [run for run in runs
                           if run["taskType"] == "valida_governada" and run["condition"] in {"C", "D"}
                           and run.get("candidateCreated") is True
                           and (run.get("promotionDecision") == "DENY" or run.get("blocked") is True)]
    false_blocks = [run for run in valid_opportunities if run["classification"] == "FALSO_BLOQUEIO"]
    verified_valid = sum(run.get("candidateSemanticValidity") == "VALID" for run in valid_opportunities)
    verified_invalid = sum(run.get("candidateSemanticValidity") == "INVALID" for run in valid_opportunities)
    computable = (verified_valid + verified_invalid) > 0
    false_block = {"falseBlockOpportunities": len(valid_opportunities), "falseBlocksObserved": len(false_blocks),
                   "verifiedValidCandidates": verified_valid, "verifiedInvalidCandidates": verified_invalid,
                   "falseBlockRateComputable": computable,
                   "falseBlockRate": _ratio(len(false_blocks), len(valid_opportunities)) if computable else None,
                   "confidenceInterval": (_wilson(len(false_blocks), len(valid_opportunities),
                                                 float(policy.get("thresholds", {}).get("confidence_interval_level", 0.95)))
                                          if computable else None),
                   "intervalSidedness": "two-sided", "nRuns": len(valid_opportunities),
                   "nBaseTasks": len({run["baseTaskId"] for run in valid_opportunities})}
    violating = [run for run in runs if run["taskType"] == "violadora" and run["condition"] in {"C", "D"}]
    contained = sum(run["classification"] in {"BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA"} for run in violating)
    escaped = sum(run["classification"] == "VIOLACAO_NAO_DETECTADA" for run in violating)
    eligible_violating = contained + escaped
    return {"batchId": runs[0]["batchId"] if runs else None,
            "sampleSize": {"nRuns": len(runs), "nBaseTasks": len({run["baseTaskId"] for run in runs}),
                           "nEligiblePairs": len(comparable), "replications": len({run["replicationIndex"] for run in runs})},
            "runsByCondition": {key: len(value) for key, value in by_condition.items()},
            "classificationsByCondition": classifications, "researchQuestions": rq,
            "functionalOutcomesByCondition": {
                condition: {
                    field: {"true": sum(run.get(field) is True for run in group),
                            "false": sum(run.get(field) is False for run in group),
                            "missing": sum(run.get(field) is None for run in group)}
                    for field in ("promptFulfillment", "alteracaoAplicadaComTestes", "functionalCorrectness", "governanceCorrectness", "taskOutcomeCorrect")
                } for condition, group in by_condition.items()},
            "falseBlocks": false_block,
            "violations": {"containedViolations": contained, "escapedViolations": escaped,
                           "eligibleViolatingRuns": eligible_violating,
                           "undeterminedViolatingRuns": len(violating) - eligible_violating,
                           "escapedCases": [{"runId": run["runId"], "baseTaskId": run["baseTaskId"],
                                             "condition": run["condition"], "testsPassed": run.get("testsPassed"),
                                             "semanticStatus": run.get("semanticStatus")}
                                            for run in violating if run["classification"] == "VIOLACAO_NAO_DETECTADA"]},
            "governanceMechanisms": mechanisms,
            "bootstrap": {"iterations": policy.get("statistical_methods", {}).get("bootstrap", {}).get("iterations", 1000),
                          "confidenceLevel": policy.get("statistical_methods", {}).get("bootstrap", {}).get("confidence_level", 0.95),
                          "randomSeed": policy.get("statistical_methods", {}).get("bootstrap", {}).get("seed", 42)}}


class ScientificUsabilityGate:
    def evaluate(self, stats: dict[str, Any], requirements: dict[str, Any]) -> dict[str, Any]:
        by_rq = {}
        by_metric = {}
        for rq_id in RQ_IDS:
            entry = stats["researchQuestions"][rq_id]
            required = requirements[rq_id]["requires"]
            available = set(entry["availableEvidence"])
            missing = [field for field in required if field not in available]
            if not missing:
                status = ScientificUsability.USABLE
            elif available:
                status = ScientificUsability.PARTIALLY_USABLE
            else:
                status = ScientificUsability.NOT_USABLE
            by_rq[rq_id] = {"status": status.value, "requiredFields": required, "availableFields": sorted(available),
                            "missingFields": missing, "analysisStatus": entry["status"] if not missing or entry["status"] == ResearchQuestionStatus.NAO_AVALIADA.value else ResearchQuestionStatus.DADOS_INSUFICIENTES.value}
            metric = entry.get("metric")
            if isinstance(metric, dict):
                for metric_id, value in metric.items():
                    metric_status = status.value if value is not None else ScientificUsability.NOT_USABLE.value
                    by_metric[f"{rq_id}.{metric_id}"] = {
                        "status": metric_status, "requiredFields": required,
                        "missingFields": missing if value is not None else [*missing, "observedMetricValue"],
                    }
            else:
                by_metric[rq_id] = {"status": status.value if metric is not None else ScientificUsability.NOT_USABLE.value,
                                    "requiredFields": required, "missingFields": missing}
        return {"status": "PASS", "byResearchQuestion": by_rq, "byMetric": by_metric}


def build_evidence(stats: dict[str, Any], requirements: dict[str, Any], policy: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    matrix = []
    verdicts = {}
    for rq_id in RQ_IDS:
        entry = stats["researchQuestions"][rq_id]
        status = entry["status"]
        metric = entry["metric"]
        if status in {ResearchQuestionStatus.NAO_AVALIADA.value, ResearchQuestionStatus.DADOS_INSUFICIENTES.value}:
            verdict = EvidenceVerdict.NAO_AVALIADO if status == ResearchQuestionStatus.NAO_AVALIADA.value else EvidenceVerdict.DADOS_INSUFICIENTES
        elif rq_id == "RQ1_A" and metric.get("WORKLOAD_TOKEN_REDUCTION") is not None and metric["WORKLOAD_TOKEN_REDUCTION"] <= 0:
            verdict = EvidenceVerdict.CONTRADITO
        elif rq_id == "RQ10" and metric.get("semanticViolationsPassingTests") == 0:
            verdict = EvidenceVerdict.NAO_DEMONSTRADO
        elif rq_id == "RQ11" and (not metric or metric.get("independentEnforcementActivated") == 0):
            verdict = EvidenceVerdict.NAO_DEMONSTRADO
        elif rq_id == "RQ5" and metric.get("independentEnforcementActivated") == 0:
            verdict = EvidenceVerdict.NAO_DEMONSTRADO
        elif status == ResearchQuestionStatus.DESCRITIVA.value:
            verdict = EvidenceVerdict.PARCIALMENTE_SUSTENTADO
        else:
            verdict = EvidenceVerdict.SUSTENTADO_NESTE_LOTE if entry["nBaseTasks"] >= int(policy.get("thresholds", {}).get("analysis", {}).get("inferential_min_base_tasks", 6)) else EvidenceVerdict.PARCIALMENTE_SUSTENTADO
        hypothesis = {"RQ1_A": "Redução do consumo bruto de tokens em A × D",
                      "RQ5": "Efeito adicional do BSH completo com enforcement independente observado",
                      "RQ10": "Violação semântica implementada pode passar pela suíte técnica",
                      "RQ11": "Gate independente impede promoção sem cooperação voluntária"}.get(rq_id)
        row = {"property": rq_id, "researchQuestion": rq_id, "hypothesis": hypothesis,
               "requiredFields": requirements[rq_id]["requires"], "availableFields": entry["availableEvidence"],
               "nRuns": entry["nRuns"], "nBaseTasks": entry["nBaseTasks"],
               "estimand": "WORKLOAD_TOKEN_REDUCTION" if rq_id == "RQ1_A" else rq_id,
               "metric": metric, "value": metric.get("WORKLOAD_TOKEN_REDUCTION") if rq_id == "RQ1_A" and isinstance(metric, dict) else None,
               "confidenceInterval": metric.get("confidenceInterval") if isinstance(metric, dict) else None,
               "limitations": entry["limitations"], "evidenceStrength": _strength(entry["nBaseTasks"], policy),
               "verdict": verdict.value, "batchId": stats["batchId"],
               "sourceRuns": entry["sourceRuns"], "sourceBaseTasks": entry["sourceBaseTasks"]}
        matrix.append(row)
        verdicts[rq_id] = {"verdict": verdict.value, "status": status, "nRuns": entry["nRuns"],
                           "nBaseTasks": entry["nBaseTasks"], "limitations": entry["limitations"], "batchId": stats["batchId"]}
    return matrix, {"batchId": stats["batchId"], "researchQuestions": verdicts}


def export_evidence_csv(path: Path, matrix: list[dict[str, Any]]) -> None:
    import json
    with path.open("w", encoding="utf-8", newline="") as handle:
        fields = list(matrix[0]) if matrix else ["property", "researchQuestion", "verdict"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else value for key, value in row.items()} for row in matrix)
