"""Orquestrador experimental do BSH Benchmark (Seção 3).

Coordena a preparação de worktrees, seleção de agentes via registro,
aplicação de estratégias experimentais A/B/C/D, coleta e normalização canônica,
geração de artefatos estruturados e disparo da análise científica.
"""

import csv
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import random
import shutil
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

from .adapters.base import AgentAdapterRegistry, BenchmarkAgentAdapter
from .core.config import load_and_validate_config, save_config_to_batch
from .core.models import CanonicalBenchmarkRun, compute_experiment_hashes
from .core.governance_observation import collect_governance_observation
from .core.classification import classify_run, determine_governance_mechanism
from .strategies import CONDITION_STRATEGIES, evaluate_workspace_changes

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
FIXTURE_PROJECT = REPO / "test" / "fixtures" / "enforcement-project"
RESULTS_DIR = HERE / "results"
TASKS_FILE = HERE / "tasks.json"

# Definição canônica das 10 replicações pré-planejadas (Seção 13)
PRE_PLANNED_REPLICATIONS = [
    {"baseTaskId": "V1", "replicationIndex": 2, "condition": "D"},
    {"baseTaskId": "V1", "replicationIndex": 2, "condition": "A"},
    {"baseTaskId": "V2", "replicationIndex": 2, "condition": "D"},
    {"baseTaskId": "V2", "replicationIndex": 2, "condition": "A"},
    {"baseTaskId": "G1", "replicationIndex": 2, "condition": "D"},
    {"baseTaskId": "G1", "replicationIndex": 2, "condition": "A"},
    {"baseTaskId": "G2", "replicationIndex": 2, "condition": "D"},
    {"baseTaskId": "G2", "replicationIndex": 2, "condition": "A"},
    {"baseTaskId": "U1", "replicationIndex": 2, "condition": "D"},
    {"baseTaskId": "U1", "replicationIndex": 2, "condition": "A"},
]

SMOKE_TARGETS = [
    ("V1", 1, "A"), ("V1", 1, "B"), ("V1", 1, "C"), ("V1", 1, "D"),
    ("G1", 1, "A"), ("G1", 1, "B"), ("G1", 1, "C"), ("G1", 1, "D"),
]


class BenchmarkExperimentOrchestrator:
    """Orquestrador central de experimentos do BSH Benchmark."""

    def __init__(
        self,
        agent_id: Optional[str] = None,
        model: Optional[str] = None,
        reasoning_effort: Optional[str] = None,
        batch_id: Optional[str] = None,
        tasks_path: Optional[Path] = None,
        config: Optional[Dict[str, Any]] = None,
        config_path: Optional[Path] = None,
    ):
        self.config_path = Path(config_path).resolve() if config_path else None
        if self.config_path and not config:
            self.config = load_and_validate_config(self.config_path, repo_root=REPO)
        else:
            self.config = config or {}

        # Prioriza valores explícitos, depois config, depois defaults canônicos
        cfg_agent = self.config.get("agent", {})
        self.agent_id = (agent_id or cfg_agent.get("id") or "agy").lower()
        self.model = model or cfg_agent.get("model") or "gemini-3.7-flash-low"
        self.reasoning_effort = reasoning_effort or cfg_agent.get("reasoningEffort") or "low"

        self.batch_id = batch_id or f"{self.agent_id}-{time.strftime('%Y-%m-%dT%H-%M-%S')}"
        self.batch_dir = RESULTS_DIR / self.batch_id

        # Configurações experimentais declarativas
        cfg_bench = self.config.get("benchmark", {})
        self.configured_max_runs = cfg_bench.get("maximumExecutions", 50)
        self.randomize_order = cfg_bench.get("randomizeExecutionOrder", True)

        cfg_proj = self.config.get("project", {})
        project_rel = cfg_proj.get("path")
        if project_rel:
            self.project_source = (REPO / project_rel).resolve()
        else:
            self.project_source = FIXTURE_PROJECT

        cfg_exp = self.config.get("experiment", {})
        self.configured_tasks = cfg_exp.get("tasks")
        self.configured_conditions = cfg_exp.get("conditions") or ["A", "B", "C", "D"]
        self.configured_replications = cfg_exp.get("replications")
        self.configured_smoke = cfg_exp.get("smokeTest")

        self.tasks_path = tasks_path or TASKS_FILE
        self.tasks_data = json.loads(self.tasks_path.read_text(encoding="utf-8"))
        self.tasks_list = self.tasks_data.get("tarefas", [])
        self.tasks_map = {t["id"]: t for t in self.tasks_list}
        self.adapter: BenchmarkAgentAdapter = AgentAdapterRegistry.get(self.agent_id)

    def prepare_workspace(self, run_id: str, condition: str) -> Tuple[Path, str]:
        """Copia o projeto fonte limpo e inicializa o Git."""
        dest = self.batch_dir / "executions" / run_id / "project"
        shutil.rmtree(dest.parent, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.project_source, dest, ignore=shutil.ignore_patterns(".git", "node_modules", "dist", "coverage"))

        # Cria symlink de node_modules se existir na fonte para viabilizar testes rápidos
        src_nm = self.project_source / "node_modules"
        if src_nm.is_dir() and not (dest / "node_modules").exists():
            try:
                os.symlink(src_nm, dest / "node_modules")
            except Exception:
                pass

        subprocess.run(["git", "init", "-q", str(dest)], check=True)
        for k, v in (("user.name", "Teste"), ("user.email", "teste@example.com"), ("commit.gpgsign", "false")):
            subprocess.run(["git", "-C", str(dest), "config", k, v], check=True)
        subprocess.run(["git", "-C", str(dest), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(dest), "commit", "-q", "-m", "base"], check=True)

        base_commit = subprocess.run(["git", "-C", str(dest), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
        strategy = CONDITION_STRATEGIES[condition]
        strategy.prepare_workspace(dest, base_commit)
        return dest, base_commit

    def collect_bsh_observables(self, project_path: Path) -> Dict[str, Any]:
        """Lê apenas o relatório e a decisão da mesma sessão BSH."""
        return collect_governance_observation(project_path)

    def execute_plan(self, smoke_only: bool = False, max_runs: Optional[int] = None) -> Path:
        """Executa o plano experimental completo (ou smoke test)."""
        self.batch_dir.mkdir(parents=True, exist_ok=True)
        (self.batch_dir / "executions").mkdir(parents=True, exist_ok=True)

        if self.config_path and self.config_path.is_file():
            save_config_to_batch(self.config_path, self.batch_dir)

        # FASE A0: Validação e Integração da Base Semântica
        from .core.semantic_preflight import run_semantic_preflight
        preflight_data = run_semantic_preflight(output_dir=self.batch_dir)
        if preflight_data.get("status") != "APPROVED":
            raise RuntimeError(f"HARD_FAIL: Validação pré-voo da base semântica reprovada (FASE A0): {preflight_data.get('reasons')}")

        # Monta a lista planejada
        if smoke_only:
            if self.configured_smoke and self.configured_smoke.get("runs"):
                plan = [
                    {"baseTaskId": item["task"], "replicationIndex": 1, "condition": item["condition"]}
                    for item in self.configured_smoke["runs"]
                ]
            else:
                plan = [
                    {"baseTaskId": t, "replicationIndex": rep, "condition": c}
                    for t, rep, c in SMOKE_TARGETS
                ]
        else:
            active_tasks = [t for t in self.tasks_list if t["id"] in self.configured_tasks] if self.configured_tasks else self.tasks_list
            active_conditions = self.configured_conditions or ["A", "B", "C", "D"]
            main_40 = []
            for t in active_tasks:
                for c in active_conditions:
                    main_40.append({"baseTaskId": t["id"], "replicationIndex": 1, "condition": c})

            rng = random.Random(self.batch_id)
            if self.randomize_order:
                rng.shuffle(main_40)

            # Replicacoes
            reps_10 = []
            if not self.configured_replications or self.configured_replications.get("enabled", True):
                max_add = self.configured_replications.get("maximumAdditionalExecutions", 10) if self.configured_replications else 10
                if self.configured_tasks:
                    rep_candidates = []
                    for tid in [t["id"] for t in active_tasks]:
                        rep_candidates.append({"baseTaskId": tid, "replicationIndex": 2, "condition": "D"})
                        rep_candidates.append({"baseTaskId": tid, "replicationIndex": 2, "condition": "A"})
                    reps_10 = rep_candidates[:max_add]
                else:
                    reps_10 = list(PRE_PLANNED_REPLICATIONS)[:max_add]
                if self.randomize_order:
                    rng.shuffle(reps_10)

            plan = main_40 + reps_10
            target_runs = max_runs if max_runs is not None else self.configured_max_runs
            plan = plan[:target_runs]

        print(f"[{self.batch_id}] Iniciando campanha com agente '{self.agent_id}' e modelo '{self.model}'. Total: {len(plan)} execuções.")
        started_at = datetime.now(timezone.utc).isoformat()

        runs_records: List[CanonicalBenchmarkRun] = []
        for idx, item in enumerate(plan, 1):
            base_tid = item["baseTaskId"]
            rep_idx = item["replicationIndex"]
            cond = item["condition"]
            tinfo = self.tasks_map.get(base_tid, {})

            task_suffix = f"{base_tid}#{rep_idx}" if rep_idx > 1 else base_tid
            run_id = f"{idx:03d}-{task_suffix}-{cond}"

            print(f"[{idx}/{len(plan)}] Executando {run_id} ({self.agent_id})...", flush=True)

            project_dir, base_commit = self.prepare_workspace(run_id, cond)
            strategy = CONDITION_STRATEGIES[cond]

            timeout_sec = self.config.get("benchmark", {}).get("executionTimeoutSeconds", 60)
            raw_tel, duration, pane_out, status = strategy.execute(
                adapter=self.adapter,
                workspace_path=project_dir,
                prompt=tinfo["prompt"],
                model=self.model,
                effort=self.reasoning_effort,
                timeout_seconds=timeout_sec,
            )

            # Avaliações do workspace
            ws_eval = evaluate_workspace_changes(project_dir, base_commit, tinfo)

            # Observações do BSH
            bsh_obs = self.collect_bsh_observables(project_dir) if cond in ("C", "D") else {}
            for evidence_path in ("sessionReportSource", "governanceDecisionSource"):
                if bsh_obs.get(evidence_path):
                    bsh_obs[evidence_path] = f"executions/{run_id}/project/{bsh_obs[evidence_path]}"

            promoted = bsh_obs.get("promoted") if cond in ("C", "D") else ws_eval["changeSetDetected"]
            origin_changed = bsh_obs.get("originChanged") if cond in ("C", "D") else ws_eval["changeSetDetected"]
            enf_status = bsh_obs.get("statusEnforcement")
            enf_obs = bsh_obs.get("enforcementObserved") if cond in ("C", "D") else False
            blocked = bsh_obs.get("blocked") is True or (enf_status in ("violacao", "revisao_humana"))

            norm_tokens = self.adapter.normalize_telemetry(raw_tel)

            cls = classify_run(
                task_type=tinfo.get("tipo", "valida_governada"),
                condition=cond,
                change_set_detected=ws_eval["changeSetDetected"],
                blocked=blocked,
                promoted=promoted,
                origin_changed=origin_changed,
                enforcement_status=enf_status,
                enforcement_observed=enf_obs,
                technical_gates_passed=bsh_obs.get("technicalGatesPassed"),
                tests_passed=ws_eval["testsPassed"],
                ontology_queried=bsh_obs.get("ontologyQueried"),
                report_conflict_called=bsh_obs.get("reportConflictCalled"),
                technical_failure=(status == "FALHA_TECNICA"),
                instrumentation_failure=bsh_obs.get("evidenceCollectionStatus") == "INVALID",
                task_id=base_tid,
            )

            mech = determine_governance_mechanism(
                condition=cond,
                classification=cls,
                change_set_detected=ws_eval["changeSetDetected"],
                promoted=promoted,
                ontology_queried=bsh_obs.get("ontologyQueried"),
                report_conflict_called=bsh_obs.get("reportConflictCalled"),
                enforcement_observed=enf_obs,
                enforcement_status=enf_status,
                technical_gates_passed=bsh_obs.get("technicalGatesPassed"),
                task_type=tinfo.get("tipo", "valida_governada"),
            )
            if cond in ("C", "D") and (promoted is None or origin_changed is None) and status != "FALHA_TECNICA":
                cls = "FALHA_INSTRUMENTACAO" if bsh_obs.get("evidenceCollectionStatus") == "INVALID" else "INDETERMINADO"
                mech = "INDETERMINADO"

            func_success = (cls in ("ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA")) if status != "FALHA_TECNICA" else False

            run_record = CanonicalBenchmarkRun(
                runId=run_id,
                batchId=self.batch_id,
                taskId=task_suffix,
                baseTaskId=base_tid,
                replicationIndex=rep_idx,
                condition=cond,
                agent=self.agent_id,
                taskType=tinfo.get("tipo", "valida_governada"),
                agentVersion=self.agent_id,
                model=self.model,
                reasoningEffort=self.reasoning_effort,
                durationSeconds=duration,
                baseCommit=base_commit,
                promptSha256=hashlib.sha256(tinfo["prompt"].encode("utf-8")).hexdigest(),
                inputTokens=norm_tokens.get("inputTokens"),
                cachedInputTokens=norm_tokens.get("cachedInputTokens"),
                outputTokens=norm_tokens.get("outputTokens"),
                reasoningTokens=norm_tokens.get("reasoningTokens"),
                totalTokens=norm_tokens.get("totalTokens"),
                nonCachedTokens=norm_tokens.get("nonCachedTokens"),
                changeSetDetected=ws_eval["changeSetDetected"],
                modifiedFiles=ws_eval["modifiedFiles"],
                addedLines=ws_eval["addedLines"],
                removedLines=ws_eval["removedLines"],
                ontologyQueried=bsh_obs.get("ontologyQueried"),
                queryCount=bsh_obs.get("queryCount"),
                reportConflictCalled=bsh_obs.get("reportConflictCalled"),
                enforcementObserved=enf_obs,
                enforcementStatus=enf_status,
                enforcementPipelineObserved=bsh_obs.get("enforcementPipelineObserved"),
                candidateEnforcementApplicable=bsh_obs.get("candidateEnforcementApplicable"),
                independentEnforcementActivated=bsh_obs.get("independentEnforcementActivated"),
                enforcementGateEvidence=bsh_obs.get("enforcementGateEvidence"),
                governanceDecision=bsh_obs.get("enforcementEvidence"),
                evidenceCollectionStatus=bsh_obs.get("evidenceCollectionStatus"),
                evidenceCollectionIssue=bsh_obs.get("evidenceCollectionIssue"),
                sessionReportSource=bsh_obs.get("sessionReportSource"),
                governanceDecisionSource=bsh_obs.get("governanceDecisionSource"),
                governanceDecisionSha256=bsh_obs.get("governanceDecisionSha256"),
                sessionId=bsh_obs.get("sessionId"),
                identifiedOperation=bsh_obs.get("identifiedOperation"),
                identifiedShapes=bsh_obs.get("identifiedShapes"),
                technicalGatesObserved=bsh_obs.get("technicalGatesPassed") is not None,
                technicalGatesPassed=bsh_obs.get("technicalGatesPassed"),
                promoted=promoted,
                originChanged=origin_changed,
                testsPassed=ws_eval["testsPassed"],
                violacaoImplementada=ws_eval["violacaoImplementada"],
                functionalSuccess=func_success,
                classification=cls,
                governanceMechanism=mech,
                rawTelemetry=raw_tel,
            )

            runs_records.append(run_record)
            (self.batch_dir / "executions" / run_id / "result.json").write_text(
                json.dumps(run_record.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"      Desfecho: {cls} | Tokens: {run_record.totalTokens} | Duração: {duration:.1f}s | Mecanismo: {mech}")

        finished_at = datetime.now(timezone.utc).isoformat()
        # Salva metadados e artefatos globais do lote
        self.save_batch_artifacts(runs_records, started_at=started_at, finished_at=finished_at)
        return self.batch_dir

    def save_batch_artifacts(
        self,
        runs_records: List[CanonicalBenchmarkRun],
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
    ) -> None:
        """Salva os dados observados do lote e gera seu relatório técnico."""
        measurements = [r.to_dict() for r in runs_records]

        # 1. measurements.json e measurements.csv
        (self.batch_dir / "measurements.json").write_text(json.dumps(measurements, indent=2, ensure_ascii=False), encoding="utf-8")
        campos_csv = [
            "execucao", "runId", "agente", "tarefa", "tipo", "condicao", "classificacao",
            "governanceMechanism", "functionalSuccess", "aplicado", "bloqueado",
            "entrada", "cache", "saida", "raciocinio", "totais", "tokensNaoCache",
            "tempo", "arquivos", "adicionadas", "removidas", "commitBase", "promptSha256"
        ]
        with open(self.batch_dir / "measurements.csv", "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=campos_csv, extrasaction="ignore")
            w.writeheader()
            w.writerows(measurements)

        # 2. agent-capabilities.json
        (self.batch_dir / "agent-capabilities.json").write_text(
            json.dumps(self.adapter.capability_profile.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # 3. tasks.json
        (self.batch_dir / "tasks.json").write_text(
            json.dumps(self.tasks_data, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        # 4. Hashes de reprodutibilidade e metadata.json
        hashes = compute_experiment_hashes(REPO, self.project_source, self.tasks_path)
        metadata = {
            "lote": self.batch_id,
            "dataOrigin": "REAL_EXECUTION",
            "agente": self.agent_id,
            "modelo": self.model,
            "esforco": self.reasoning_effort,
            "startedAt": started_at,
            "finishedAt": finished_at,
            "condicoes": ["A", "B", "C", "D"],
            "targetRuns": len(runs_records),
            "ordemExecucao": [r.runId for r in runs_records],
            "hashes": hashes,
            "bshProductTreeHash": hashes["bshProductTreeHash"],
            "commitBsh": hashes["repositoryCommit"],
        }
        (self.batch_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")

        # 5. Registra a execução; a análise científica é iniciada separadamente.
        from .core.technical_execution_report import generate_execution_report
        generate_execution_report(self.batch_dir)
