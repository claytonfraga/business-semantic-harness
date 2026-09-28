"""Regressões dos conceitos A/B/C/D e dos quatro contrastes no Relatório de Análise."""

import unittest

from benchmark.core.experimental_report import (
    _auditable_indicators, _conclusion_paragraphs, _denial_decomposition, _g4_case_paragraphs,
    _glossary_paragraphs, _intro_paragraphs,
)


class ReportConceptRegression(unittest.TestCase):
    def test_Given_glossary_When_built_Then_priority_terms_present(self):
        """opencode: Given the glossary, When built, Then priority operational terms are present."""
        text = " ".join(_glossary_paragraphs())
        for term in ("solicitação permitida", "candidato produzido", "validade semântica do candidato",
                     "reconhecimento", "INDETERMINATE", "falso bloqueio", "contenção", "escape",
                     "oportunidade de enforcement", "intervenção independente"):
            self.assertIn(term, text)

    def test_Given_indicators_When_built_Then_two_distinct_rates_defined(self):
        """opencode: Given indicators, When built, Then false-block and delivery rates are distinct."""
        lines = _auditable_indicators({}, "batch-inexistente")
        self.assertTrue(any("Taxa de falsos bloqueios" in line for line in lines))
        self.assertTrue(any("Taxa de entrega das solicitações" in line for line in lines))

    def test_Given_missing_batch_When_case_and_decomposition_Then_no_contradiction(self):
        """opencode: Given a missing batch, When case/decomposition, Then they do not invent data."""
        self.assertTrue(_g4_case_paragraphs("batch-inexistente"))
        self.assertTrue(_denial_decomposition("batch-inexistente"))

    def test_Given_introduction_When_built_Then_C_and_D_use_BSH_and_only_D_has_enforcement(self):
        """opencode: Given the introduction, When built, Then C/D use BSH and only D has enforcement."""
        text = " ".join(_intro_paragraphs())
        self.assertIn("C — BSH consultivo", text)
        self.assertIn("D — BSH completo", text)
        self.assertIn("sem enforcement independente no gate de promoção", text)
        self.assertIn("acrescenta enforcement independente no gate de promoção", text)
        self.assertIn("D = BSH consultivo + controle independente da promoção", text)

    def test_Given_introduction_When_built_Then_all_four_contrasts_documented(self):
        """opencode: Given the introduction, When built, Then A×B, B×C, C×D and A×D are documented."""
        text = " ".join(_intro_paragraphs())
        for contrast in ("A × B", "B × C", "C × D", "A × D"):
            self.assertIn(contrast, text)

    def test_Given_conclusion_When_built_from_results_Then_distinguishes_consultative_from_enforcement(self):
        """opencode: Given the conclusion, When built from results, Then consultative is distinct from enforcement."""
        stats = {"researchQuestions": {"RQ3": {"status": "DESCRITIVA"}, "RQ4": {"status": "DESCRITIVA"},
                                       "RQ5": {"status": "DESCRITIVA", "metric": {"independentEnforcementActivated": 2}},
                                       "RQ1_A": {"status": "DESCRITIVA"}}}
        verdicts = {"researchQuestions": {"RQ3": {"verdict": "PARCIALMENTE_SUSTENTADO"},
                                          "RQ4": {"verdict": "PARCIALMENTE_SUSTENTADO"},
                                          "RQ5": {"verdict": "NAO_DEMONSTRADO"},
                                          "RQ1_A": {"verdict": "PARCIALMENTE_SUSTENTADO"}}}
        text = " ".join(_conclusion_paragraphs(stats, verdicts))
        self.assertIn("valor do BSH consultivo", text)
        self.assertIn("não trata C e D como equivalentes", text)
        self.assertIn("A × B", text)
        self.assertIn("B × C", text)
        self.assertIn("C × D", text)
        self.assertIn("A × D", text)


if __name__ == "__main__":
    unittest.main()
