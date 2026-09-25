"""Suíte de testes automatizados do BSH Benchmark.

Cobre todos os requisitos do Requirement 42 com nomenclatura BDD Given/When/Then:
- Preservação estrita de null em tokens não medidos.
- Impossibilidade de conversão null -> 0 em CSV e figuras.
- Exclusão de par incompleto da análise de tokens.
- Não cálculo do benefício líquido na ausência de pares válidos E violadores elegíveis.
- Estados explícitos de RQ3, RQ4 e RQ5 quando condições B e C não foram executadas.
- Diferenciação entre BLOQUEIO_CORRETO e SEM_ALTERACAO.
- Omissão de figuras por insuficiência de dados.
- Rejeição de '?' em metadados.
- Validação estrita de LaTeX antes de aceitação do PDF.
- Cálculo objetivo de benefício líquido negativo.
- Supressão de inferência estatística para n < 5.
- Pipeline completo em lote íntegro (complete_a_d).
"""

import json
from pathlib import Path
import pytest
import sys

BENCHMARK_DIR = Path(__file__).resolve().parent.parent
if str(BENCHMARK_DIR) not in sys.path:
    sys.path.insert(0, str(BENCHMARK_DIR))

from lib.execution_model import classify_execution, ExecutionRecord
from analysis.load_data import load_dataset, compute_paired_dataset, export_paired_csv
from analysis.validation import validate_benchmark_batch
from analysis.statistics import compute_statistics
from analysis.figures import (
    fig_01_paired_total_tokens,
    fig_02_token_difference,
    fig_04_net_benefit,
    fig_05_cost_factor,
    fig_06_distribution_by_task_type,
)
from analysis.build_report import (
    validate_report_content,
    build_and_compile_report,
)
from analysis.tables import _esc, _fmt
from fixtures.generate_fixtures import generate_all_fixtures, FIXTURES_DIR


@pytest.fixture(scope="session", autouse=True)
def setup_fixtures():
    """Gera todas as fixtures sintéticas antes da execução dos testes."""
    generate_all_fixtures()


class TestBenchmarkAnalysis:

    def test_given_unmeasured_tokens_when_loaded_then_null_is_strictly_preserved(self):
        """Requirement 42.1: Preservação estrita de null em tokens não medidos."""
        batch_dir = FIXTURES_DIR / "missing_tokens_d"
        data = load_dataset(batch_dir)
        measurements = data["measurements"]

        d_runs = [m for m in measurements if m.get("condicao") == "D"]
        assert len(d_runs) > 0

        for r in d_runs:
            assert r.get("totais") is None
            assert r.get("totalTokens") is None
            assert r.get("entrada") is None
            assert r.get("saida") is None

        paired = compute_paired_dataset(data)
        for p in paired:
            assert p["tokensD"] is None
            assert p["eligibleForTokenAnalysis"] is False
            assert "Telemetria de tokens ausente" in p["exclusionReason"]

    def test_given_null_tokens_when_exported_to_csv_then_no_zero_conversion(self, tmp_path):
        """Requirement 42.2: Impossibilidade de conversão null -> 0 em CSV."""
        batch_dir = FIXTURES_DIR / "missing_tokens_d"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)

        csv_file = tmp_path / "paired-results.csv"
        export_paired_csv(paired, csv_file)

        content = csv_file.read_text(encoding="utf-8")
        lines = [line.split(",") for line in content.strip().split("\n")]
        header = lines[0]
        tokens_d_idx = header.index("tokensD")

        for row in lines[1:]:
            val = row[tokens_d_idx]
            # Deve ser string vazia em CSV, NUNCA '0' ou '0.0'
            assert val == "", f"Esperado valor nulo/vazio para tokensD no CSV, encontrado: '{val}'"

    def test_given_missing_tokens_when_generating_token_figures_then_figures_are_omitted(self, tmp_path):
        """Requirement 42.7: Omissão de figuras por insuficiência de dados."""
        batch_dir = FIXTURES_DIR / "missing_tokens_d"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)
        stats = compute_statistics(data, paired)

        f1 = fig_01_paired_total_tokens(paired, tmp_path)
        f2 = fig_02_token_difference(paired, tmp_path)
        f4 = fig_04_net_benefit(stats, tmp_path)
        f5 = fig_05_cost_factor(paired, tmp_path)

        assert f1 is None, "fig_01 deveria ser omitida por falta de pares elegíveis"
        assert f2 is None, "fig_02 deveria ser omitida por falta de pares elegíveis"
        assert f4 is None, "fig_04 deveria ser omitida por falta de pares válidos/violadores elegíveis"
        assert f5 is None, "fig_05 deveria ser omitida por falta de pares elegíveis"

    def test_given_incomplete_pair_when_analyzed_then_excluded_from_token_analysis(self):
        """Requirement 42.3: Exclusão de par incompleto da análise de tokens."""
        batch_dir = FIXTURES_DIR / "incomplete_pair"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)

        v1_pair = next(p for p in paired if p["taskId"] == "V1")
        assert v1_pair["eligibleForTokenAnalysis"] is False
        assert v1_pair["exclusionReason"] == "Condição governada (D) não executada"

    def test_given_missing_eligible_violators_or_valid_when_computing_net_benefit_then_returns_none(self):
        """Requirement 42.4: Não cálculo do benefício líquido na ausência de pares válidos E violadores elegíveis."""
        batch_dir = FIXTURES_DIR / "missing_tokens_d"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)
        stats = compute_statistics(data, paired)

        rq2 = stats["rq2"]
        assert rq2["status"] == "DADOS_INSUFICIENTES"
        assert rq2["beneficio_liquido"] is None
        assert rq2["economia_total_violadoras"] is None
        assert rq2["overhead_total_validas"] is None
        assert "Não foi possível calcular o benefício líquido" in rq2["motivo_incompletude"]

    def test_given_conditions_b_and_c_not_executed_when_evaluating_rqs_then_explicit_unassessed_status(self):
        """Requirement 42.5: Estados explícitos de RQ3, RQ4 e RQ5 quando condições B e C não foram executadas."""
        batch_dir = FIXTURES_DIR / "complete_a_d"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)
        stats = compute_statistics(data, paired)

        assert stats["rq3"]["status"] == "NAO_AVALIADA"
        assert "Condição B" in stats["rq3"]["motivo"]

        assert stats["rq4"]["status"] == "NAO_AVALIADA"
        assert "Condição C" in stats["rq4"]["motivo"]

        assert stats["rq5"]["status"] == "NAO_AVALIADA"
        assert "Condição C não foi executada" in stats["rq5"]["motivo"]

    def test_given_no_worktree_changes_when_classified_then_sem_alteracao_never_bloqueio_correto(self):
        """Requirement 42.6: Diferenciação entre BLOQUEIO_CORRETO e SEM_ALTERACAO."""
        # Se não houve alterações na worktree e não foi promovido
        cls = classify_execution(
            task_type="violadora",
            condition="D",
            change_set_detected=False,
            blocked=True,  # Mesmo se blocked estiver marcado como True!
            promoted=False,
            origin_changed=False,
            enforcement_status=None,
            enforcement_executed=False,
        )
        assert cls == "SEM_ALTERACAO", f"Deveria ser SEM_ALTERACAO, foi: {cls}"

    def test_given_violating_task_blocked_by_enforcement_when_classified_then_bloqueio_correto(self):
        """Verifica classificação de bloqueio correto em tarefa violadora."""
        cls = classify_execution(
            task_type="violadora",
            condition="D",
            change_set_detected=True,
            blocked=True,
            promoted=False,
            origin_changed=False,
            enforcement_status="violacao",
            enforcement_executed=True,
        )
        assert cls == "BLOQUEIO_CORRETO"

    def test_given_valid_task_erroneously_blocked_when_classified_then_falso_bloqueio(self):
        """Verifica classificação de falso bloqueio em tarefa válida governada."""
        cls = classify_execution(
            task_type="valida_governada",
            condition="D",
            change_set_detected=True,
            blocked=True,
            promoted=False,
            origin_changed=False,
            enforcement_status="violacao",
            enforcement_executed=True,
        )
        assert cls == "FALSO_BLOQUEIO"

    def test_given_unknown_metadata_when_escaped_then_replaces_question_mark_with_endash(self):
        """Requirement 42.8: Rejeição de '?' em metadados."""
        assert _esc("?") == r"\textendash"
        assert _esc(None) == r"\textendash"
        assert _esc("None") == r"\textendash"
        assert _fmt("?") == r"\textendash"
        assert _fmt(None) == r"\textendash"

    def test_given_invalid_latex_with_unresolved_refs_when_validated_then_rejects(self):
        """Requirement 42.9: Validação estrita de LaTeX antes de aceitação do PDF."""
        tex_com_erro_ref = r"\section{Teste} Conforme visto na Tabela ??."
        erros = validate_report_content(tex_com_erro_ref)
        assert len(erros) > 0
        assert any("Referências pendentes" in e for e in erros)

        tex_com_interrogacao = "Item commit: ? no lote"
        erros2 = validate_report_content(tex_com_interrogacao)
        assert len(erros2) > 0
        assert any("Placeholder '?' detectado" in e for e in erros2)

        tex_com_nan = "Diferença média: NaN tokens"
        erros3 = validate_report_content(tex_com_nan)
        assert len(erros3) > 0
        assert any("Valor numérico inválido 'NaN'" in e for e in erros3)

    def test_given_negative_net_benefit_when_computed_then_reported_objectively(self):
        """Verifica cálculo e relatório com benefício líquido negativo."""
        batch_dir = FIXTURES_DIR / "negative_net_benefit"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)
        stats = compute_statistics(data, paired)

        rq2 = stats["rq2"]
        assert rq2["status"] == "RESPONDIDA"
        assert rq2["beneficio_liquido"] is not None
        assert rq2["beneficio_liquido"] < 0, f"Esperado benefício líquido negativo, obtido: {rq2['beneficio_liquido']}"

    def test_given_sample_under_five_when_computing_inferential_stats_then_inference_skipped(self):
        """Verifica que com n < 5 a inferência estatística é desabilitada."""
        batch_dir = FIXTURES_DIR / "insufficient_inference"
        data = load_dataset(batch_dir)
        paired = compute_paired_dataset(data)
        stats = compute_statistics(data, paired)

        inf = stats["inferencial"]
        assert inf["executado"] is False
        assert "Amostra insuficiente (n_elegivel < 5)" in inf["motivo"]
        # Descritiva ainda assim deve calcular n_obs = 2
        assert stats["segmentos"]["todas"]["n_observado"] == 2

    def test_given_complete_dataset_when_full_pipeline_executed_then_all_figures_and_pdf_generated(self):
        """Verifica execução completa do pipeline de análise no lote íntegro complete_a_d."""
        batch_dir = FIXTURES_DIR / "complete_a_d"
        from analyze import run_full_analysis

        result = run_full_analysis(batch_dir)

        assert result["status"] == "VALID"
        stats = json.loads((batch_dir / "statistics.json").read_text(encoding="utf-8"))
        assert stats["rq1"]["status"] == "RESPONDIDA"
        assert stats["rq2"]["status"] == "RESPONDIDA"
        assert stats["rq2"]["beneficio_liquido"] > 0
        assert stats["inferencial"]["executado"] is True

        # Figuras geradas
        figs = result["figures"]
        assert len(figs) >= 8

        # PDF gerado
        pdf_path = batch_dir / "report" / "benchmark-report.pdf"
        assert pdf_path.is_file()
        assert pdf_path.stat().st_size > 50000
