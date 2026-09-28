"""Regressões da geração de figuras (task 6)."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from benchmark.core.report_figures import build_figures


def run(run_id, condition="A", task_type="valida_governada", **fields):
    base = {"runId": run_id, "condition": condition, "taskType": task_type}
    base.update(fields)
    return base


class ReportFiguresRegression(unittest.TestCase):
    def test_Given_no_runs_When_building_figures_Then_no_empty_figure(self):
        """opencode: Given no runs, When building figures, Then no empty figure is produced."""
        with TemporaryDirectory() as directory:
            self.assertEqual(build_figures(directory, [], {}), [])
            self.assertFalse((Path(directory) / "figures").exists())

    def test_Given_runs_When_building_figures_Then_pdf_and_metadata(self):
        """opencode: Given runs, When building figures, Then PDFs and metadata are produced."""
        runs = [run("a", "A"), run("c", "C", "violadora"),
                run("d", "D", "violadora", promotionDecision="DENY", validationComplete=False)]
        results = {"d": {"governanceDecision": {"promotionDecision": "DENY", "failureStage": "RECOGNITION"}}}
        with TemporaryDirectory() as directory:
            figures = build_figures(directory, runs, results)
            self.assertTrue(figures)
            for figure in figures:
                self.assertTrue(os.path.isfile(figure["path"]))
                self.assertTrue(figure["question"] and figure["population"] and figure["source"])
            self.assertIn("fig-denials", {figure["id"] for figure in figures})


if __name__ == "__main__":
    unittest.main()
