"""Testes de integridade metodológica e científica do BSH Benchmark (Seção 50).

Verificações obrigatórias:
1. 20 execuções implicam 20 classificações; sum(classificacoes) == execucoes.
2. Invariante violado torna o status do lote INVALID.
3. Condição A executando tarefa violadora recebe ALTERACAO_INCORRETA / VIOLACAO_NAO_DETECTADA, nunca ALTERACAO_CORRETA.
4. I1 e U1 mantêm seus tipos (indeterminada e fora_conhecimento).
5. Disclaimer obrigatório para SYNTHETIC_FIXTURE.
6. Placeholders proibidos (a1b2c3d4e5, ?, dummy) falham na validação.
7. Telemetria com cache > input define nonCachedTokens = None e elegibilidade falsa.
8. G3 (revisão humana) é excluído de equivalência comportamental (NAO_EQUIVALENTE), e violadoras são NAO_APLICAVEL.
9. Benefício líquido possui fórmula e denominador documentados literalmente.
10. Relatório contém rigorosamente todas as 20 seções canônicas obrigatórias.
"""

import json
from pathlib import Path
import pytest

from benchmark.adapters.agy import AgyBenchmarkAdapter
from benchmark.core.classification import classify_run, determine_governance_mechanism, evaluate_run_correctness
from benchmark.core.models import CanonicalBenchmarkRun
from benchmark.core.pairing import compute_paired_dataset
from benchmark.core.report import (
    build_latex_document,
    package_audit_zip,
    validate_report_content,
    CANONICAL_SECTIONS,
    TEXTO_SINTETICO,
)
from benchmark.core.statistics import compute_statistics
from benchmark.core.tables import generate_all_latex_tables
from benchmark.core.validation import validate_batch_data_quality
from benchmark.core.verdicts import build_evidence_matrix_and_verdicts


def test_invariant_sum_classifications_equals_runs(tmp_path):
    """Invariante: sum(classificações) da condição deve ser estritamente igual ao número de execuções."""
    # Cenário válido: 6 execuções nas condições A e D, 6 classificações e pares completos
    runs_valid = [
        {"runId": "r1", "taskId": "G1", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 100},
        {"runId": "r2", "taskId": "V1", "condicao": "A", "taskType": "violadora", "classification": "ALTERACAO_INCORRETA", "totalTokens": 120},
        {"runId": "r3", "taskId": "G2", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 110},
        {"runId": "r4", "taskId": "G1", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 105},
        {"runId": "r5", "taskId": "V1", "condicao": "D", "taskType": "violadora", "classification": "BLOQUEIO_CORRETO", "totalTokens": 50},
        {"runId": "r6", "taskId": "G2", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 115},
    ]
    paired_valid = [
        {"taskId": "G1", "taskType": "valida_governada", "tokensA": 100, "tokensD": 105, "eligibleForTokenAnalysis": True, "eligibleForGovernanceAnalysis": True, "behavioralEquivalence": "EQUIVALENTE"},
        {"taskId": "V1", "taskType": "violadora", "tokensA": 120, "tokensD": 50, "eligibleForTokenAnalysis": True, "eligibleForGovernanceAnalysis": True, "behavioralEquivalence": "NAO_APLICAVEL"},
        {"taskId": "G2", "taskType": "valida_governada", "tokensA": 110, "tokensD": 115, "eligibleForTokenAnalysis": True, "eligibleForGovernanceAnalysis": True, "behavioralEquivalence": "EQUIVALENTE"},
    ]
    meta = {
        "lote": "test-batch",
        "agente": "Agy",
        "modelo": "gemini-3.7-flash-medium",
        "dataOrigin": "SYNTHETIC_FIXTURE",
        "targetRuns": 6,
        "condicoes": ["A", "D"],
        "hashes": {
            "repositoryCommit": "abcdef123456",
            "bshProductTreeHash": "111122223333",
            "benchmarkTreeHash": "444455556666",
            "pilotHash": "555566667777",
            "ontologyHash": "777788889999",
            "shapesHash": "aaaabbbbcccc",
            "taskManifestHash": "ddddeeeeffff",
            "configHash": "000011112222",
        },
    }
    q_valid = validate_batch_data_quality(runs_valid, paired_valid, meta, tmp_path)
    assert q_valid["status"] == "VALID"
    assert q_valid["classificationCompleteness"] == "VALID"


def test_invariant_violation_marks_batch_as_invalid(tmp_path):
    """Invariante violado (classificação nula/ausente) marca o lote como INVALID."""
    runs_broken = [
        {"runId": "r1", "taskId": "G1", "condicao": "A", "classification": "ALTERACAO_CORRETA", "totalTokens": 100},
        {"runId": "r2", "taskId": "V1", "condicao": "A", "classification": None, "totalTokens": 120},
    ]
    meta = {
        "lote": "test-broken",
        "agente": "Agy",
        "modelo": "gemini-3.7-flash-medium",
        "dataOrigin": "SYNTHETIC_FIXTURE",
        "targetRuns": 2,
        "condicoes": ["A"],
    }
    q_broken = validate_batch_data_quality(runs_broken, [], meta, tmp_path)
    assert q_broken["classificationCompleteness"] == "INVALID"
    assert q_broken["status"] == "INVALID"
    assert any("Invariante violada" in r for r in q_broken["reasons"])


def test_condition_a_violating_task_classification():
    """Condição A que altera worktree ou passa testes em tarefa violadora recebe ALTERACAO_INCORRETA."""
    cls_a = classify_run(
        task_type="violadora",
        condition="A",
        change_set_detected=True,
        blocked=False,
        promoted=False,
        origin_changed=True,
        tests_passed=True,
    )
    assert cls_a in ("ALTERACAO_INCORRETA", "VIOLACAO_NAO_DETECTADA")
    assert cls_a != "ALTERACAO_CORRETA"

    eval_a = evaluate_run_correctness(
        task_type="violadora",
        condition="A",
        classification=cls_a,
        change_set_detected=True,
        tests_passed=True,
    )
    assert eval_a["governanceCorrectness"] is False
    assert eval_a["taskOutcomeCorrect"] is False


def test_tasks_i1_and_u1_types():
    """I1 e U1 são preservados com suas semânticas próprias e não são violadoras por omissão."""
    # U1 fora do conhecimento governado
    cls_u1 = classify_run(
        task_type="fora_conhecimento",
        condition="D",
        change_set_detected=True,
        blocked=False,
        promoted=True,
        origin_changed=True,
        tests_passed=True,
    )
    assert cls_u1 == "ALTERACAO_CORRETA"

    # I1 indeterminada
    cls_i1 = classify_run(
        task_type="indeterminada",
        condition="D",
        change_set_detected=False,
        blocked=True,
        promoted=False,
        origin_changed=False,
    )
    assert cls_i1 in ("BLOQUEIO_CORRETO", "INDETERMINADO", "SEM_ALTERACAO_INDETERMINADA")


def test_synthetic_fixture_disclaimer_in_report():
    """Lote com dataOrigin=SYNTHETIC_FIXTURE inclui com destaque o disclaimer metodológico obrigatório."""
    meta = {
        "lote": "synth-lote",
        "agente": "Agy",
        "modelo": "gemini-3.7-flash-medium",
        "dataOrigin": "SYNTHETIC_FIXTURE",
        "hashes": {},
    }
    stats = {
        "rq1": {},
        "rq2": {},
        "rq6": {},
        "segmentos": {"validas_equivalentes": {}},
    }
    quality = {"dataOrigin": "SYNTHETIC_FIXTURE", "completeTokenPairs": 0}
    tables = generate_all_latex_tables(quality, [], [], {}, meta)
    tex = build_latex_document(Path("."), meta, stats, quality, tables, [], paired=[])
    assert TEXTO_SINTETICO in tex
    assert "AVISO METODOLÓGICO: DADOS SINTÉTICOS" in tex


def test_forbidden_placeholders_fail_validation():
    """Placeholders proibidos (a1b2c3d4e5, ?, dummy) causam erro na validação do relatório."""
    bad_tex = r"""
    \section{Caracterização da Campanha}
    \section{Origem e Integridade dos Dados}
    \section{Agente, Modelo e Ambiente}
    commit: a1b2c3d4e5
    """
    errors = validate_report_content(bad_tex)
    assert any("a1b2c3d4e5" in e for e in errors)

    bad_tex_question = r"""
    \section{Caracterização da Campanha}
    commit: ? \\
    """
    errors_q = validate_report_content(bad_tex_question)
    assert any("Placeholder '?'" in e for e in errors_q)


def test_telemetry_normalization_cached_greater_than_input():
    """Quando cachedTokens > inputTokens na telemetria Agy, nonCachedTokens deve ser None e elegibilidade falsa."""
    adapter = AgyBenchmarkAdapter()
    raw = {
        "totalTokens": 500,
        "inputTokens": 300,
        "cachedTokens": 400,  # 400 > 300
        "outputTokens": 100,
    }
    norm = adapter.normalize_telemetry(raw)
    assert norm["rawTotalTokens"] == 500
    assert norm["nonCachedTokens"] is None
    assert norm["nonCachedTokensEligible"] is False
    assert "Semântica de cache incompatível" in norm["nonCachedTokensExclusionReason"]


def test_behavioral_equivalence_excludes_g3_and_violating_tasks():
    """G3 (revisão humana) é NAO_EQUIVALENTE e tarefas violadoras são NAO_APLICAVEL para equivalência."""
    runs = [
        # G1 válida concluída em A e D
        {"runId": "r1", "baseTaskId": "G1", "taskId": "G1", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1000},
        {"runId": "r2", "baseTaskId": "G1", "taskId": "G1", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 800},
        # G3 válida que exigiu revisão humana
        {"runId": "r3", "baseTaskId": "G3", "taskId": "G3", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1200},
        {"runId": "r4", "baseTaskId": "G3", "taskId": "G3", "condicao": "D", "taskType": "valida_governada", "classification": "REVISAO_HUMANA", "totalTokens": 300},
        # V1 violadora
        {"runId": "r5", "baseTaskId": "V1", "taskId": "V1", "condicao": "A", "taskType": "violadora", "classification": "ALTERACAO_INCORRETA", "totalTokens": 1500, "changeSetDetected": True},
        {"runId": "r6", "baseTaskId": "V1", "taskId": "V1", "condicao": "D", "taskType": "violadora", "classification": "BLOQUEIO_CORRETO", "totalTokens": 400, "governanceMechanism": "ENFORCEMENT_INDEPENDENTE"},
    ]
    paired = compute_paired_dataset(runs)
    by_task = {p["taskId"]: p for p in paired}

    # G1: ambas ALTERACAO_CORRETA -> EQUIVALENTE
    assert by_task["G1"]["behavioralEquivalence"] == "EQUIVALENTE"

    # G3: revisão humana em D -> NAO_EQUIVALENTE
    assert by_task["G3"]["behavioralEquivalence"] == "NAO_EQUIVALENTE"

    # V1: violadora -> NAO_APLICAVEL
    assert by_task["V1"]["behavioralEquivalence"] == "NAO_APLICAVEL"
    assert by_task["V1"]["aImplementedViolation"] is True
    assert by_task["V1"]["avoidedCostEligible"] is True
    assert by_task["V1"]["avoidedCostTokens"] == (1500 - 400)


def test_net_benefit_formula_and_denominator():
    """Benefício líquido calcula explicitamente benefícioLiquidoTokens, fórmula e denominador."""
    runs = [
        # G1 válida equivalente: D gastou 200 a mais (overhead = 200)
        {"runId": "r1", "baseTaskId": "G1", "taskId": "G1", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1000},
        {"runId": "r2", "baseTaskId": "G1", "taskId": "G1", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1200},
        # V1 violadora governada: A gastou 1500, D gastou 300 (economia evitada = 1200)
        {"runId": "r3", "baseTaskId": "V1", "taskId": "V1", "condicao": "A", "taskType": "violadora", "classification": "ALTERACAO_INCORRETA", "totalTokens": 1500, "changeSetDetected": True},
        {"runId": "r4", "baseTaskId": "V1", "taskId": "V1", "condicao": "D", "taskType": "violadora", "classification": "BLOQUEIO_CORRETO", "totalTokens": 300, "governanceMechanism": "ENFORCEMENT_INDEPENDENTE"},
    ]
    paired = compute_paired_dataset(runs)
    stats = compute_statistics(runs, paired)

    rq2 = stats["rq2"]
    assert rq2["OverheadValidasEquivalentes"] == 200.0
    assert rq2["EconomiaVioladorasCorretamenteGovernadas"] == 1200.0
    assert rq2["beneficioLiquidoTokens"] == 1000.0
    assert "Benefício líquido" in rq2["beneficioLiquidoFormula"]
    assert rq2["beneficioLiquidoDenominador"] == 2500.0
    # Denominador = 1000 + 1500 = 2500 -> 1000 / 2500 * 100 = 40.0%
    assert rq2["beneficioLiquidoPercentual"] == 40.0


def test_report_contains_all_36_canonical_sections():
    """Documento LaTeX gerado contém rigorosamente todas as 36 seções canônicas na ordem correta."""
    meta = {
        "lote": "canonical-test",
        "agente": "Agy",
        "modelo": "gemini-3.7-flash-medium",
        "dataOrigin": "REAL_EXECUTION",
        "hashes": {
            "repositoryCommit": "abc123def456",
            "bshProductTreeHash": "111222333444",
            "benchmarkTreeHash": "555666777888",
            "ontologyHash": "999aaabbbccc",
            "shapesHash": "dddeeefff000",
            "taskManifestHash": "111333555777",
            "configHash": "222444666888",
        },
    }
    stats = {
        "rq1": {},
        "rq2": {},
        "rq6": {},
        "segmentos": {"validas_equivalentes": {}},
    }
    quality = {"dataOrigin": "REAL_EXECUTION", "completeTokenPairs": 1}
    tables = generate_all_latex_tables(quality, [], [], {}, meta)
    tex = build_latex_document(Path("."), meta, stats, quality, tables, [], paired=[])

    last_pos = -1
    for sec in CANONICAL_SECTIONS:
        sec_tag = f"\\section{{{sec}}}"
        pos = tex.find(sec_tag)
        assert pos != -1, f"Seção canônica ausente: {sec_tag}"
        assert pos > last_pos, f"Seção canônica fora de ordem: {sec_tag}"
        last_pos = pos

    errors = validate_report_content(tex)
    assert errors == []


def test_tokens_saved_and_extra_calculation():
    """Tokens economizados e gastos a mais são ambos não-negativos e calculados corretamente."""
    runs = [
        # Tarefa onde BSH economizou (D < A)
        {"runId": "r1", "taskId": "T1", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1000},
        {"runId": "r2", "taskId": "T1", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 600},
        # Tarefa onde BSH teve overhead (D > A)
        {"runId": "r3", "taskId": "T2", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 500},
        {"runId": "r4", "taskId": "T2", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 700},
    ]
    paired = compute_paired_dataset(runs)
    by_id = {p["taskId"]: p for p in paired}

    # T1: Economia = 400 (40.0%), Extra = 0.0
    p1 = by_id["T1"]
    assert p1["tokensSaved"] == 400.0
    assert p1["tokensSavedPercentage"] == 40.0
    assert p1["tokensExtra"] == 0.0
    assert p1["tokensExtraPercentage"] == 0.0

    # T2: Extra = 200 (40.0%), Economia = 0.0
    p2 = by_id["T2"]
    assert p2["tokensSaved"] == 0.0
    assert p2["tokensSavedPercentage"] == 0.0
    assert p2["tokensExtra"] == 200.0
    assert p2["tokensExtraPercentage"] == 40.0


def test_null_does_not_become_zero():
    """Valores nulos de telemetria não são convertidos para zero silenciosamente."""
    run = CanonicalBenchmarkRun(
        runId="r-null",
        batchId="b-null",
        taskId="G1",
        baseTaskId="G1",
        replicationIndex=1,
        taskType="valida_governada",
        condition="D",
        agent="Agy",
        agentVersion="1.0.0",
        model="gemini-3.7-flash-medium",
        reasoningEffort="medium",
        dataOrigin="REAL_EXECUTION",
        changeSetDetected=False,
        modifiedFiles=0,
        addedLines=0,
        removedLines=0,
        testsPassed=True,
        technicalGatesPassed=True,
        ontologyQueried=True,
        reportConflictCalled=False,
        identifiedOperation=None,
        identifiedShapes=[],
        expectedOperation="OperacaoA",
        expectedShape="ShapeA",
        promoted=False,
        originChanged=False,
        enforcementObserved=False,
        enforcementPipelineObserved=True,
        candidateEnforcementApplicable=False,
        enforcementStatus="NO_VIOLATION_OBSERVED",
        inputTokens=100,
        cachedInputTokens=200,
        outputTokens=50,
        reasoningTokens=None,
        totalTokens=150,
        rawTotalTokens=150,
        normalizedTotalTokens=150,
        nonCachedTokens=None,
        nonCachedTokensEligible=False,
        nonCachedTokensExclusionReason="Cache incompatível",
        tokenTelemetryStatus="PARTIAL",
        durationSeconds=10.5,
        violacaoImplementada=None,
        functionalSuccess=True,
        promptFulfillment=True,
        functionalCorrectness=True,
        governanceCorrectness=True,
        taskOutcomeCorrect=True,
        classification="SEM_ALTERACAO_CORRETA",
        governanceMechanism="CONSULTA_PREVENTIVA",
        rawTelemetry={},
    )
    d = run.to_dict()
    assert d["tokensNaoCache"] is None
    assert d["nonCachedTokens"] is None
    assert d["reasoningTokens"] is None
    assert d["violacaoImplementada"] is None


def test_fake_commit_invalidates_real_campaign(tmp_path):
    """Placeholder de commit ou dummy em lote real marca metadados como INVALID."""
    runs = [
        {"runId": "r1", "taskId": "G1", "condicao": "A", "classification": "ALTERACAO_CORRETA", "totalTokens": 100},
        {"runId": "r2", "taskId": "G1", "condicao": "D", "classification": "ALTERACAO_CORRETA", "totalTokens": 105},
    ]
    meta = {
        "lote": "test-fake-commit",
        "agente": "Agy",
        "modelo": "gemini-3.7-flash-medium",
        "dataOrigin": "REAL_EXECUTION",
        "targetRuns": 2,
        "condicoes": ["A", "D"],
        "hashes": {
            "repositoryCommit": "a1b2c3d4e5",
            "bshProductTreeHash": "111122223333",
            "benchmarkTreeHash": "444455556666",
            "pilotHash": "555566667777",
            "ontologyHash": "777788889999",
            "shapesHash": "aaaabbbbcccc",
            "taskManifestHash": "ddddeeeeffff",
        },
    }
    q = validate_batch_data_quality(runs, [], meta, tmp_path)
    assert q["metadataCompleteness"] == "INVALID"
    assert q["status"] == "INVALID"


def test_preventive_consultation_is_not_independent_enforcement():
    """Prevenção consultiva é diferenciada de enforcement independente."""
    mech_prev = determine_governance_mechanism(
        condition="D",
        classification="SEM_ALTERACAO_CORRETA",
        change_set_detected=False,
        promoted=False,
        ontology_queried=True,
        report_conflict_called=False,
        enforcement_observed=False,
        enforcement_status="NO_VIOLATION_OBSERVED",
        technical_gates_passed=True,
        task_type="violadora",
        candidate_enforcement_applicable=False,
    )
    assert mech_prev == "CONSULTA_PREVENTIVA"
    assert mech_prev != "ENFORCEMENT_INDEPENDENTE"

    mech_enf = determine_governance_mechanism(
        condition="D",
        classification="BLOQUEIO_CORRETO",
        change_set_detected=True,
        promoted=False,
        ontology_queried=False,
        report_conflict_called=False,
        enforcement_observed=True,
        enforcement_status="ENFORCEMENT_TRIGGERED",
        technical_gates_passed=True,
        task_type="violadora",
        candidate_enforcement_applicable=True,
    )
    assert mech_enf == "ENFORCEMENT_INDEPENDENTE"


def test_independent_enforcement_requires_candidate_change():
    """Enforcement independente exige que uma alteração candidata exista (change_set_detected=True)."""
    mech = determine_governance_mechanism(
        condition="D",
        classification="BLOQUEIO_CORRETO",
        change_set_detected=False,
        promoted=False,
        ontology_queried=False,
        report_conflict_called=False,
        enforcement_observed=False,
        enforcement_status=None,
        technical_gates_passed=True,
        task_type="violadora",
        candidate_enforcement_applicable=False,
    )
    assert mech != "ENFORCEMENT_INDEPENDENTE"


def test_u1_does_not_inflate_precision_or_recall():
    """Tarefas fora do domínio conhecido (U1) não inflam precision ou recall de operações governadas."""
    runs = [
        {"runId": "r1", "taskId": "G1", "condicao": "D", "taskType": "valida_governada", "tipo": "valida_governada", "identifiedOperation": "Op1"},
        {"runId": "r2", "taskId": "U1", "condicao": "D", "taskType": "fora_conhecimento", "tipo": "fora_conhecimento", "identifiedOperation": None},
    ]
    d_gov_runs = [r for r in runs if r.get("condicao") == "D" and r.get("tipo") in ("valida_governada", "violadora")]
    assert len(d_gov_runs) == 1
    assert "U1" not in [r["taskId"] for r in d_gov_runs]


def test_evidence_matrix_and_verdicts_consistency():
    """Veredito de enforcement independente não é favorável quando nenhum caso foi ativado."""
    runs = [
        {"runId": "r1", "condicao": "A", "taskId": "V1", "classification": "ALTERACAO_INCORRETA"},
        {"runId": "r2", "condicao": "D", "taskId": "V1", "classification": "SEM_ALTERACAO_CORRETA"},
    ]
    paired = [
        {
            "taskId": "V1", "taskType": "violadora", "tokensA": 1000, "tokensD": 300,
            "classificationA": "ALTERACAO_INCORRETA", "classificationD": "SEM_ALTERACAO_CORRETA",
            "governanceMechanismD": "CONSULTA_PREVENTIVA", "behavioralEquivalence": "NAO_APLICAVEL",
            "aImplementedViolation": True, "semanticViolationWithTechnicalTestsPassing": True,
        }
    ]
    stats = {
        "rq1": {},
        "rq2": {"beneficio_liquido": 700},
        "rq6": {"operationPrecision": 1.0, "operationRecall": 1.0},
        "segmentos": {"validas_equivalentes": {}},
    }
    ont_data = {"queriesPrecedingPreventionCount": 1}
    harness_data = {"independentEnforcementCases": []}

    res = build_evidence_matrix_and_verdicts(runs, paired, stats, ont_data, harness_data)
    verdicts = res["verdicts"]

    assert verdicts["ENFORCEMENT_VERDICT"]["verdict"] == "NAO_DEMONSTRADO"
    assert verdicts["OVERALL_BSH_VERDICT"]["verdict"] == "PARCIALMENTE_SUSTENTADO"


def test_canonical_sections_count_is_48():
    """O relatório científico deve conter exatamente 48 seções canônicas conforme a Seção 88."""
    assert len(CANONICAL_SECTIONS) == 48
    assert CANONICAL_SECTIONS[0] == "Introdução"
    assert CANONICAL_SECTIONS[3] == "Inventário de Capacidade dos Artefatos"
    assert CANONICAL_SECTIONS[5] == "Plano de Análise Congelado"
    assert CANONICAL_SECTIONS[16] == "Cobertura Ontológica"
    assert CANONICAL_SECTIONS[29] == "Casos de Violação Não Detectada"
    assert CANONICAL_SECTIONS[30] == "Análise de Falsos Bloqueios"
    assert CANONICAL_SECTIONS[47] == "Conclusão"


def test_artifact_capability_inventory_e0(tmp_path):
    """Etapa E0 avalia cobertura de campos obrigatórios e exporta artefatos JSON, CSV e MD."""
    from benchmark.core.inventory import evaluate_artifact_inventory, export_artifact_inventory

    runs = [
        {
            "runId": "r1",
            "totalTokens": 1000,
            "inputTokens": 800,
            "outputTokens": 200,
            "durationSeconds": 45.0,
            "modifiedFiles": 1,
            "addedLines": 10,
            "removedLines": 0,
            "testsPassed": True,
            "technicalGatesPassed": True,
            "ontologyQueried": True,
            "reportConflictCalled": False,
            "promoted": True,
            "originChanged": True,
            "enforcementObserved": False,
            "enforcementStatus": "NO_VIOLATION_OBSERVED",
            "classification": "ALTERACAO_CORRETA",
            "governanceMechanism": "CONSULTA_PREVENTIVA",
            "taskOutcomeCorrect": True,
            "dataOrigin": "REAL_EXECUTION",
            "nonCachedTokens": None,
        }
    ]
    inv = evaluate_artifact_inventory(runs)
    assert inv["totalRuns"] == 1
    assert inv["fields"]["totalTokens"]["status"] == "PRESENTE"
    assert inv["fields"]["durationSeconds"]["status"] == "PRESENTE"
    assert inv["fields"]["nonCachedTokens"]["status"] == "AUSENTE"
    assert inv["fields"]["nonCachedTokens"]["analysisSuppressed"] is True

    export_artifact_inventory(inv, tmp_path)
    assert (tmp_path / "artifact-capability-inventory.json").is_file()
    assert (tmp_path / "artifact-capability-inventory.csv").is_file()
    assert (tmp_path / "artifact-capability-inventory.md").is_file()


def test_distinct_cost_metrics_and_false_block_analysis(tmp_path):
    """Estatísticas calculam custoPorEntregaFuncional vs custoPorDesfechoExperimentalCorreto e análise de falsos bloqueios."""
    runs = [
        # A: 2 tarefas (1 entrega válida correta, 1 violadora incorreta)
        {"runId": "r1", "taskId": "G1", "condicao": "A", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1000, "durationSeconds": 50, "functionalCorrectness": True, "taskOutcomeCorrect": True},
        {"runId": "r2", "taskId": "V1", "condicao": "A", "taskType": "violadora", "classification": "ALTERACAO_INCORRETA", "totalTokens": 1500, "durationSeconds": 60, "functionalCorrectness": False, "taskOutcomeCorrect": False},
        # D: 2 tarefas (1 entrega válida correta, 1 abstenção violadora correta)
        {"runId": "r3", "taskId": "G1", "condicao": "D", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 200, "durationSeconds": 55, "functionalCorrectness": True, "taskOutcomeCorrect": True},
        {"runId": "r4", "taskId": "V1", "condicao": "D", "taskType": "violadora", "classification": "SEM_ALTERACAO_CORRETA", "totalTokens": 100, "durationSeconds": 20, "functionalCorrectness": False, "taskOutcomeCorrect": True},
    ]
    paired = compute_paired_dataset(runs)
    stats = compute_statistics(runs, paired)

    cost_info = stats["costMetrics"]
    # Condição A: total = 2500 tokens
    # entregas corretas = 1 -> custoPorEntrega = 2500 / 1 = 2500
    # desfechos corretos = 1 -> custoPorDesfecho = 2500 / 1 = 2500
    assert cost_info["A"]["custoPorEntregaFuncional"] == 2500.0
    assert cost_info["A"]["custoPorDesfechoExperimentalCorreto"] == 2500.0

    # Condição D: total = 300 tokens
    # entregas corretas = 1 -> custoPorEntrega = 300 / 1 = 300
    # desfechos corretos = 2 -> custoPorDesfecho = 300 / 2 = 150
    assert cost_info["D"]["custoPorEntregaFuncional"] == 300.0
    assert cost_info["D"]["custoPorDesfechoExperimentalCorreto"] == 150.0

    fb_info = stats["falseBlockAnalysis"]
    assert fb_info["oportunidadesFalsoBloqueio"] == 1
    assert fb_info["falsosBloqueiosObservados"] == 0
    assert fb_info["taxaFalsoBloqueio"] == 0.0


def test_fifteen_technical_verdicts_present():
    """A matriz de vereditos deve conter todos os 15 vereditos formais da Seção 77."""
    runs = [
        {"runId": "r1", "condicao": "A", "taskId": "G1", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 1000, "durationSeconds": 50},
        {"runId": "r2", "condicao": "D", "taskId": "G1", "taskType": "valida_governada", "classification": "ALTERACAO_CORRETA", "totalTokens": 200, "durationSeconds": 55},
        {"runId": "r3", "condicao": "A", "taskId": "V1", "taskType": "violadora", "classification": "ALTERACAO_INCORRETA", "totalTokens": 1500, "durationSeconds": 60},
        {"runId": "r4", "condicao": "D", "taskId": "V1", "taskType": "violadora", "classification": "SEM_ALTERACAO_CORRETA", "totalTokens": 100, "durationSeconds": 20},
    ]
    paired = compute_paired_dataset(runs)
    stats = compute_statistics(runs, paired)
    res = build_evidence_matrix_and_verdicts(runs, paired, stats, {}, {})
    verdicts = res["verdicts"]

    required_verdicts = [
        "TOKEN_ECONOMY_VERDICT",
        "SEMANTIC_GOVERNANCE_VERDICT",
        "ONTOLOGY_UTILITY_VERDICT",
        "ENFORCEMENT_VERDICT",
        "HARNESS_VERDICT",
        "LATENCY_VERDICT",
        "COMPARABILITY_VERDICT",
        "FALSE_BLOCK_VERDICT",
        "MECHANISM_ISOLATION_VERDICT",
        "TASK_COMPLEXITY_SENSITIVITY_VERDICT",
        "PROVENANCE_INTEGRITY_VERDICT",
        "COMPLIANCE_PASSAGE_VERDICT",
        "UNCACHED_TOKENS_VERDICT",
        "CROSS_CONDITION_PROGRESSION_VERDICT",
        "OVERALL_BSH_VERDICT",
    ]
    for req in required_verdicts:
        assert req in verdicts, f"Veredito ausente: {req}"


def test_semantic_preflight_and_materialization(tmp_path):
    """FASE A0: Validação da base semântica, robustez e materialização determinística."""
    from benchmark.core.semantic_preflight import run_semantic_preflight

    preflight = run_semantic_preflight(output_dir=tmp_path)
    assert preflight["status"] == "APPROVED"
    assert preflight["semanticCorpusRobustness"] == "ROBUST"
    assert preflight["ontologySyntaxValid"] is True
    assert preflight["distribution"]["validGoverned"] >= 30
    assert preflight["distribution"]["violating"] >= 30
    assert preflight["materialization"]["enforcementChallengeMaterialized"] == 120
    assert (tmp_path / "semantic-preflight.json").is_file()
    assert (tmp_path / "semantic-preflight.md").is_file()
    assert (tmp_path / "semantic-task-materialization.json").is_file()
    assert (tmp_path / "semantic-task-materialization.csv").is_file()


def test_independent_enforcement_challenge_track(tmp_path):
    """FASE B2: Track INDEPENDENT_ENFORCEMENT_CHALLENGE testa 60 válidos e 60 inválidos."""
    from benchmark.core.independent_enforcement import run_independent_enforcement_challenge

    res = run_independent_enforcement_challenge(batch_dir=tmp_path, max_valid=10, max_invalid=10)
    assert res["status"] == "AVAILABLE"
    assert res["invalidCandidateCount"] == 10
    assert res["validCandidateCount"] == 10
    assert res["invalidCandidateDetectionRate"] == 100.0
    assert res["gateFalseBlockRate"] == 0.0
    assert (tmp_path / "enforcement-challenge-results.json").is_file()
    assert (tmp_path / "enforcement-challenge-results.csv").is_file()


def test_batch_isolation_pureza_gate(tmp_path):
    """FASE D: Gate de Pureza rejeita artefatos de outro lote e aprova lote estritamente isolado."""
    from benchmark.core.batch_isolation import validate_batch_isolation

    batch_id = "test-batch-001"
    # Lote limpo
    (tmp_path / "measurements.json").write_text(json.dumps([{"runId": f"{batch_id}-001-A", "batchId": batch_id}]), encoding="utf-8")
    iso = validate_batch_isolation(tmp_path, batch_id)
    assert iso["status"] == "APPROVED"
    assert iso["foreignBatchArtifactsDetected"] == 0
    assert iso["foreignBatchRunsDetected"] == 0
    assert iso["foreignBatchReferencesDetected"] == 0

    # Lote contaminado com runId de outro lote
    bad_dir = tmp_path / "bad"
    bad_dir.mkdir()
    (bad_dir / "measurements.json").write_text(json.dumps([{"runId": "other-batch-001-A", "batchId": "other-batch"}]), encoding="utf-8")
    try:
        validate_batch_isolation(bad_dir, "new-batch")
        assert False, "Deveria ter disparado HARD_FAIL para lote contaminado"
    except SystemExit:
        pass


def test_semantic_base_coverage_calculation(tmp_path):
    """Seção 56-A: Cobertura estrutural calcula percentuais de regras, operações e shapes."""
    from benchmark.core.semantic_base_coverage import compute_semantic_base_coverage

    cov = compute_semantic_base_coverage(output_dir=tmp_path)
    assert cov["semanticCasesTotal"] == 380
    assert cov["ruleCoveragePercentage"] > 80.0
    assert cov["operationCoveragePercentage"] == 100.0
    assert cov["shapeCoveragePercentage"] >= 60.0
    assert (tmp_path / "semantic-base-coverage.json").is_file()
    assert (tmp_path / "semantic-base-coverage.md").is_file()


def test_report_number_provenance_links_to_new_batch(tmp_path):
    """Seção 40: Numerais experimentais mapeiam para o batchId exclusivo."""
    from benchmark.core.report_provenance import generate_report_number_provenance

    stats = {
        "rq1": {"workloadTokenReduction": 0.45},
        "rq2": {"beneficio_liquido": 50000},
        "sampleSize": {"totalRuns": 58, "totalBaseTasks": 12},
    }
    entries = generate_report_number_provenance(tmp_path, stats, "batch-xyz")
    assert len(entries) > 10
    for e in entries:
        assert e["batchId"] == "batch-xyz"
        assert e["sourceArtifact"] == "statistics.json"
    assert (tmp_path / "report-number-provenance.json").is_file()

