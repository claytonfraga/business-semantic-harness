"""Regressões dos conceitos A/B/C/D e dos quatro contrastes no Relatório de Análise."""

import unittest

from benchmark.core.experimental_report import _conclusion_paragraphs, _intro_paragraphs


class ReportConceptRegression(unittest.TestCase):
    def test_Given_introduction_When_built_Then_C_and_D_use_BSH_and_only_D_has_enforcement(self):
        """opencode: Given the introduction, When built, Then C/D use BSH and only D has enforcement."""
        text = " ".join(_intro_paragraphs())
        self.assertIn("C — BSH consultivo", text)
        self.assertIn("D — BSH completo", text)
        self.assertIn("apenas D possui enforcement independente", text)
        self.assertIn("Tanto C quanto D utilizam BSH", text)

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
