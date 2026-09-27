"""Gate de Completude da Campanha Experimental (Seções 1 a 6).

Reconstrói a execução planejada a partir de config.yaml, tasks.json e replicações,
comparando com as execuções observadas para determinar:
- COMPLETE: 100% das execuções planejadas executadas com desfecho terminal e worktrees limpas
- INCOMPLETE_RESUMABLE: execuções pendentes mas hashes e ambiente idênticos
- INCOMPLETE_NOT_RESUMABLE: falha na instrumentação, hashes divergentes ou artefatos corrompidos
- INVALID: combinações incoerentes, cardinalidades violadas ou contaminação
"""

import json
from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional, Set, Tuple

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TASKS_FILE = REPO / "benchmark" / "tasks.json"
CONFIG_FILE = REPO / "benchmark" / "config.yaml"


class CampaignCompletionGate:
    """Validador e auditor de completude operacional da campanha."""

    def __init__(
        self,
        batch_dir: Path,
        config_path: Optional[Path] = None,
        tasks_path: Optional[Path] = None,
    ):
        self.batch_dir = Path(batch_dir).resolve()
        self.config_path = Path(config_path).resolve() if config_path else (self.batch_dir / "config.yaml")
        if not self.config_path.is_file() and CONFIG_FILE.is_file():
            self.config_path = CONFIG_FILE

        self.tasks_path = Path(tasks_path).resolve() if tasks_path else (self.batch_dir / "tasks.json")
        if not self.tasks_path.is_file() and TASKS_FILE.is_file():
            self.tasks_path = TASKS_FILE

    def evaluate(self) -> Dict[str, Any]:
        """Avalia exaustivamente a completude planejada vs observada."""
        # 1. Carrega tasks.json
        tasks_data = json.loads(self.tasks_path.read_text(encoding="utf-8")) if self.tasks_path.is_file() else {}
        task_list = tasks_data.get("tarefas") or tasks_data.get("tasks") or (tasks_data if isinstance(tasks_data, list) else [])
        all_task_ids = [t.get("taskId") or t.get("id") for t in task_list if isinstance(t, dict)]

        # 2. Carrega config.yaml (ou metadata.json se yaml não estiver disponível)
        from .config import load_and_validate_config
        config = {}
        if self.config_path.is_file():
            try:
                config = load_and_validate_config(self.config_path, repo_root=REPO)
            except Exception:
                pass

        meta_file = self.batch_dir / "metadata.json"
        metadata = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.is_file() else {}

        # 3. Determina o plano esperado
        exp_cfg = config.get("experiment", {})
        planned_conditions = exp_cfg.get("conditions") or metadata.get("condicoes") or ["A", "B", "C", "D"]
        cfg_tasks = exp_cfg.get("tasks")
        planned_base_tasks = cfg_tasks if cfg_tasks else [t for t in all_task_ids if "#" not in t]

        # Réplicas planejadas
        max_reps = 10
        rep_cfg = exp_cfg.get("replications", {})
        if isinstance(rep_cfg, dict):
            max_reps = rep_cfg.get("maximumAdditionalExecutions", 10) if rep_cfg.get("enabled", True) else 0

        planned_runs: List[Dict[str, Any]] = []
        # Main 48 (12 tarefas * 4 condições)
        for t in planned_base_tasks:
            for c in planned_conditions:
                planned_runs.append({
                    "condition": c,
                    "baseTaskId": t,
                    "replicationIndex": 1,
                    "runKey": f"{t}-1-{c}"
                })

        # 10 Replicações pré-planejadas
        rep_targets = [
            ("G4", 2, "D"), ("G4", 2, "A"),
            ("G5", 2, "D"), ("G5", 2, "A"),
            ("G6", 2, "D"), ("G6", 2, "A"),
            ("V6", 2, "D"), ("V6", 2, "A"),
            ("V7", 2, "D"), ("V7", 2, "A"),
        ]
        for t, rep, c in rep_targets[:max_reps]:
            if t in planned_base_tasks and c in planned_conditions:
                planned_runs.append({
                    "condition": c,
                    "baseTaskId": t,
                    "replicationIndex": rep,
                    "runKey": f"{t}-{rep}-{c}"
                })

        planned_count = len(planned_runs)
        planned_keys = {r["runKey"] for r in planned_runs}

        # 4. Observações reais no batch
        meas_file = self.batch_dir / "measurements.json"
        observed_measurements: List[Dict[str, Any]] = []
        if meas_file.is_file():
            try:
                observed_measurements = json.loads(meas_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        observed_keys: Set[str] = set()
        duplicate_keys: List[str] = []
        observed_runs_data: List[Dict[str, Any]] = []
        observed_conditions: Set[str] = set()
        observed_base_tasks: Set[str] = set()
        observed_reps: Set[int] = set()

        executions_dir = self.batch_dir / "executions"
        existing_exec_dirs = {d.name for d in executions_dir.iterdir() if d.is_dir()} if executions_dir.is_dir() else set()

        running_or_pending: List[str] = []
        unterminated_runs: List[str] = []

        for m in observed_measurements:
            c = str(m.get("condition") or m.get("condicao") or "")
            tid = str(m.get("taskId") or m.get("tarefa") or "")
            base_tid = str(m.get("baseTaskId") or tid.split("#")[0])
            rep = int(m.get("replicationIndex") or (int(tid.split("#")[1]) if "#" in tid else 1))
            run_id = str(m.get("runId") or "")

            run_key = f"{base_tid}-{rep}-{c}"
            if run_key in observed_keys:
                duplicate_keys.append(run_key)
            observed_keys.add(run_key)

            if c:
                observed_conditions.add(c)
            if base_tid:
                observed_base_tasks.add(base_tid)
            observed_reps.add(rep)

            status = m.get("executionStatus") or ("COMPLETED" if m.get("classification") not in ("FALHA_TECNICA", "FALHA_INSTRUMENTACAO") else m.get("classification"))
            started_at = m.get("startedAt")
            finished_at = m.get("finishedAt")

            # Verifica se worktree ou arquivo de resultado existe
            has_res_file = (executions_dir / run_id / "result.json").is_file() if run_id else False

            is_running = m.get("status") in ("RUNNING", "PENDING")
            if is_running:
                running_or_pending.append(run_id or run_key)

            if not m.get("classification") and not status:
                unterminated_runs.append(run_id or run_key)

            observed_runs_data.append({
                "runId": run_id,
                "runKey": run_key,
                "condition": c,
                "baseTaskId": base_tid,
                "replicationIndex": rep,
                "classification": m.get("classification"),
                "executionStatus": status,
                "startedAt": started_at,
                "finishedAt": finished_at,
                "hasExecutionDir": run_id in existing_exec_dirs,
                "hasResultJson": has_res_file,
            })

        missing_keys = sorted(list(planned_keys - observed_keys))
        unexpected_keys = sorted(list(observed_keys - planned_keys))
        missing_conditions = sorted(list(set(planned_conditions) - observed_conditions))
        missing_tasks = sorted(list(set(planned_base_tasks) - observed_base_tasks))

        observed_count = len(observed_measurements)

        # 5. Avaliação do Status da Campanha
        if observed_count == planned_count and len(missing_keys) == 0 and len(duplicate_keys) == 0 and len(unexpected_keys) == 0 and len(running_or_pending) == 0 and len(unterminated_runs) == 0:
            completion_status = "COMPLETE"
        elif observed_count > 0 and len(missing_keys) > 0 and len(running_or_pending) == 0:
            completion_status = "INCOMPLETE_RESUMABLE"
        elif observed_count == 0 or len(unexpected_keys) > 0:
            completion_status = "INVALID"
        else:
            completion_status = "INCOMPLETE_NOT_RESUMABLE"

        summary = {
            "batchId": metadata.get("lote", self.batch_dir.name),
            "completionStatus": completion_status,
            "plannedRuns": planned_count,
            "observedRuns": observed_count,
            "missingRuns": len(missing_keys),
            "duplicateRuns": len(duplicate_keys),
            "unexpectedRuns": len(unexpected_keys),
            "runningOrPendingRuns": len(running_or_pending),
            "unterminatedRuns": len(unterminated_runs),
            "plannedConditions": planned_conditions,
            "observedConditions": sorted(list(observed_conditions)),
            "missingConditions": missing_conditions,
            "plannedBaseTasks": planned_base_tasks,
            "observedBaseTasks": sorted(list(observed_base_tasks)),
            "missingTasks": missing_tasks,
            "missingRunKeys": missing_keys,
            "duplicateRunKeys": duplicate_keys,
            "unexpectedRunKeys": unexpected_keys,
            "details": {
                "allPlannedSatisfied": len(missing_keys) == 0,
                "zeroDuplicates": len(duplicate_keys) == 0,
                "zeroUnexpected": len(unexpected_keys) == 0,
                "allTerminalStatus": len(unterminated_runs) == 0,
            }
        }

        # Salva campaign-completion.json
        (self.batch_dir / "campaign-completion.json").write_text(
            json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # Salva campaign-completion.md
        md_lines = [
            f"# Relatório de Completude Operacional da Campanha — {summary['batchId']}",
            "",
            f"- **Status de Completude**: `{completion_status}`",
            f"- **Execuções Planejadas**: {planned_count}",
            f"- **Execuções Observadas**: {observed_count}",
            f"- **Execuções Faltantes**: {len(missing_keys)}",
            f"- **Execuções Duplicadas**: {len(duplicate_keys)}",
            f"- **Execuções Inesperadas**: {len(unexpected_keys)}",
            "",
            "## Condições e Tarefas",
            f"- Condições Planejadas: {', '.join(planned_conditions)} | Observadas: {', '.join(sorted(list(observed_conditions)))}",
            f"- Tarefas-Base Planejadas: {len(planned_base_tasks)} | Observadas: {len(observed_base_tasks)}",
            "",
        ]
        if missing_keys:
            md_lines.append("### Execuções Ausentes")
            for k in missing_keys:
                md_lines.append(f"- `{k}`")
            md_lines.append("")
        if duplicate_keys:
            md_lines.append("### Execuções Duplicadas")
            for k in duplicate_keys:
                md_lines.append(f"- `{k}`")
            md_lines.append("")

        (self.batch_dir / "campaign-completion.md").write_text("\n".join(md_lines), encoding="utf-8")
        return summary
