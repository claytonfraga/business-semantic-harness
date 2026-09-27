"""Gate de Completude de Dados e Saúde da Campanha Experimental (Seções 7 a 11 e 62).

Avalia campo a campo a presença de telemetria e evidências para cada condição experimental,
garantindo que telemetria ausente NUNCA seja convertida em zero e detectando
automaticamente falhas de instrumentação experimental.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional, Set, Tuple

AUDITED_FIELDS = [
    "durationSeconds",
    "inputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningTokens",
    "totalTokens",
    "testsPassed",
    "changeSetDetected",
    "ontologyQueried",
    "reportConflictCalled",
    "enforcementPipelineObserved",
    "candidateEnforcementApplicable",
    "independentEnforcementActivated",
    "promoted",
    "originChanged",
    "identifiedOperation",
    "identifiedShapes",
    "classification",
]


class CampaignDataCompletenessGate:
    """Validador e auditor de cobertura de telemetria e dados por condição."""

    def __init__(self, batch_dir: Path, measurements: Optional[List[Dict[str, Any]]] = None):
        self.batch_dir = Path(batch_dir).resolve()
        meas_file = self.batch_dir / "measurements.json"
        if measurements is not None:
            self.measurements = measurements
        elif meas_file.is_file():
            self.measurements = json.loads(meas_file.read_text(encoding="utf-8"))
        else:
            self.measurements = []

        meta_file = self.batch_dir / "metadata.json"
        self.metadata = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.is_file() else {}

    def audit(self, completion_summary: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Executa auditoria profunda de cobertura campo a campo por condição."""
        total_runs = len(self.measurements)
        runs_by_condition: Dict[str, List[Dict[str, Any]]] = {}
        for m in self.measurements:
            c = str(m.get("condition") or m.get("condicao") or "DESCONHECIDA")
            runs_by_condition.setdefault(c, []).append(m)

        conditions_list = sorted(list(runs_by_condition.keys()))

        field_coverage_global: Dict[str, Dict[str, Any]] = {}
        field_coverage_by_condition: Dict[str, Dict[str, Dict[str, Any]]] = {}

        for cond in conditions_list:
            field_coverage_by_condition[cond] = {}

        # 1. Auditoria campo a campo
        for field in AUDITED_FIELDS:
            # Global
            observed_count = sum(1 for m in self.measurements if m.get(field) is not None)
            missing_count = total_runs - observed_count
            pct = (observed_count / total_runs * 100.0) if total_runs > 0 else 0.0
            field_coverage_global[field] = {
                "expected": total_runs,
                "observed": observed_count,
                "missing": missing_count,
                "coveragePercentage": round(pct, 1),
            }

            # Por condição
            for cond in conditions_list:
                c_runs = runs_by_condition[cond]
                c_total = len(c_runs)
                c_obs = sum(1 for m in c_runs if m.get(field) is not None)
                c_pct = (c_obs / c_total * 100.0) if c_total > 0 else 0.0
                field_coverage_by_condition[cond][field] = {
                    "expected": c_total,
                    "observed": c_obs,
                    "missing": c_total - c_obs,
                    "coveragePercentage": round(c_pct, 1),
                }

        # 2. Métricas agregadas por condição (Seção 66)
        telemetry_coverage: Dict[str, float] = {}
        token_coverage: Dict[str, float] = {}
        duration_coverage: Dict[str, float] = {}
        classification_coverage: Dict[str, float] = {}

        for cond in ("A", "B", "C", "D"):
            c_runs = runs_by_condition.get(cond, [])
            n_c = len(c_runs)
            if n_c == 0:
                telemetry_coverage[cond] = 0.0
                token_coverage[cond] = 0.0
                duration_coverage[cond] = 0.0
                classification_coverage[cond] = 0.0
                continue

            valid_toks = sum(1 for m in c_runs if m.get("totalTokens") is not None)
            valid_durs = sum(1 for m in c_runs if m.get("durationSeconds") is not None and m.get("durationSeconds") > 0)
            valid_class = sum(1 for m in c_runs if m.get("classification") is not None)
            valid_tel = sum(1 for m in c_runs if m.get("totalTokens") is not None and m.get("durationSeconds") is not None)

            token_coverage[cond] = round(valid_toks / n_c * 100.0, 1)
            duration_coverage[cond] = round(valid_durs / n_c * 100.0, 1)
            classification_coverage[cond] = round(valid_class / n_c * 100.0, 1)
            telemetry_coverage[cond] = round(valid_tel / n_c * 100.0, 1)

        # 3. Detecção de Falhas de Instrumentação (Seções 9 a 11)
        blocking_problems: List[str] = []
        instrumentation_failures = 0
        primary_analysis_usable = True

        # Condição A é o baseline contrafactual obrigatório para RQ1, RQ2, RQ3, RQ8, RQ9
        if token_coverage.get("A", 0.0) == 0.0:
            primary_analysis_usable = False
            instrumentation_failures += 1
            blocking_problems.append(
                "FALHA_INSTRUMENTACAO CRÍTICA: Condição A possui 0.0% de telemetria de tokens válida. "
                "Cálculos de redução de tokens (RQ1), benefício líquido (RQ2) e custo direto são impossíveis."
            )

        if token_coverage.get("D", 0.0) == 0.0:
            primary_analysis_usable = False
            instrumentation_failures += 1
            blocking_problems.append(
                "FALHA_INSTRUMENTACAO CRÍTICA: Condição D possui 0.0% de telemetria de tokens válida."
            )

        # Contagem de falhas técnicas ou de instrumentação registradas
        tech_fails = sum(1 for m in self.measurements if m.get("classification") in ("FALHA_TECNICA", "FALHA_INSTRUMENTACAO"))
        if tech_fails > (total_runs * 0.3):
            primary_analysis_usable = False
            blocking_problems.append(
                f"Taxa excessiva de falhas técnicas/instrumentação: {tech_fails}/{total_runs} execuções ({tech_fails/total_runs*100:.1f}%)."
            )

        comp_status = (completion_summary or {}).get("completionStatus", "UNKNOWN")
        if comp_status not in ("COMPLETE", "UNKNOWN"):
            primary_analysis_usable = False
            blocking_problems.append(f"Campanha incompleta: status = {comp_status}.")

        overall_status = "APPROVED" if (primary_analysis_usable and len(blocking_problems) == 0) else "FAILED_INSTRUMENTATION"

        # 4. Geração dos relatórios
        health_report = {
            "batchId": self.metadata.get("lote", self.batch_dir.name),
            "status": overall_status,
            "completionStatus": comp_status,
            "plannedRuns": (completion_summary or {}).get("plannedRuns", total_runs),
            "observedRuns": total_runs,
            "missingRuns": (completion_summary or {}).get("missingRuns", 0),
            "failedRuns": tech_fails,
            "instrumentationFailures": instrumentation_failures,
            "primaryAnalysisUsable": primary_analysis_usable,
            "runsByCondition": {c: len(runs) for c, runs in runs_by_condition.items()},
            "telemetryCoverageByCondition": telemetry_coverage,
            "tokenCoverageByCondition": token_coverage,
            "durationCoverageByCondition": duration_coverage,
            "classificationCoverageByCondition": classification_coverage,
            "blockingProblems": blocking_problems,
            "fieldCoverageGlobal": field_coverage_global,
            "fieldCoverageByCondition": field_coverage_by_condition,
        }

        # Salva campaign-health-report.json e data-completeness.json
        (self.batch_dir / "campaign-health-report.json").write_text(
            json.dumps(health_report, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        (self.batch_dir / "data-completeness.json").write_text(
            json.dumps(health_report, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # Salva campaign-health-report.md
        md_lines = [
            f"# Relatório de Saúde da Campanha Experimental — {health_report['batchId']}",
            "",
            f"- **Status Geral da Cobertura**: `{overall_status}`",
            f"- **Apto para Análise Primária**: `{'SIM' if primary_analysis_usable else 'NÃO (BLOQUEADO)'}`",
            f"- **Execuções Observadas**: {total_runs}",
            f"- **Falhas de Instrumentação**: {instrumentation_failures}",
            "",
            "## Cobertura por Condição",
            f"- **Telemetria Completa**: A={telemetry_coverage.get('A', 0)}%, B={telemetry_coverage.get('B', 0)}%, C={telemetry_coverage.get('C', 0)}%, D={telemetry_coverage.get('D', 0)}%",
            f"- **Tokens Válidos**: A={token_coverage.get('A', 0)}%, B={token_coverage.get('B', 0)}%, C={token_coverage.get('C', 0)}%, D={token_coverage.get('D', 0)}%",
            f"- **Duração Válida**: A={duration_coverage.get('A', 0)}%, B={duration_coverage.get('B', 0)}%, C={duration_coverage.get('C', 0)}%, D={duration_coverage.get('D', 0)}%",
            "",
        ]
        if blocking_problems:
            md_lines.append("## Problemas Bloqueantes Detectados")
            for p in blocking_problems:
                md_lines.append(f"- :x: {p}")
            md_lines.append("")

        (self.batch_dir / "campaign-health-report.md").write_text("\n".join(md_lines), encoding="utf-8")
        (self.batch_dir / "data-completeness.md").write_text("\n".join(md_lines), encoding="utf-8")

        # Se não for usável, gera failed-campaign-manifest.json
        if not primary_analysis_usable:
            failed_manifest = {
                "batchId": health_report["batchId"],
                "reason": "FAILED_INSTRUMENTATION" if instrumentation_failures > 0 else "INCOMPLETE_OR_INVALID",
                "missingRuns": (completion_summary or {}).get("missingRuns", 0),
                "instrumentationProblems": blocking_problems,
                "hashes": self.metadata.get("hashes", {}),
                "startedAt": self.metadata.get("startedAt"),
                "lastObservedAt": self.metadata.get("finishedAt") or datetime.now(timezone.utc).isoformat(),
            }
            (self.batch_dir / "failed-campaign-manifest.json").write_text(
                json.dumps(failed_manifest, indent=2, ensure_ascii=False), encoding="utf-8"
            )

        return health_report


def quarantine_failed_campaign(batch_dir: Path) -> Path:
    """Move uma campanha inválida/defeituosa para benchmark/results/failed/<batchId>/ (Seção 6)."""
    batch_dir = Path(batch_dir).resolve()
    failed_dir = batch_dir.parent / "failed" / batch_dir.name
    failed_dir.parent.mkdir(parents=True, exist_ok=True)
    if failed_dir.exists():
        shutil.rmtree(failed_dir)
    shutil.move(str(batch_dir), str(failed_dir))
    return failed_dir
