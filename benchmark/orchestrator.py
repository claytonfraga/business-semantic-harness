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
from .core.models import CanonicalBenchmarkRun, compute_directory_tree_hash, compute_experiment_hashes
from .core.codebase_change import (compute_change_disposition, compute_code_base_changed,
                                   compute_codebase_tree_hash, compute_enforcement_outcome_observed)
from .core.governance_observation import collect_governance_observation
from .core.run_invariants import run_instrumentation_issues
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
        def ignore_runtime_artifacts(directory: str, names: List[str]) -> set[str]:
            ignored = set(names) & {".git", "node_modules", "dist", "coverage"}
            if Path(directory).name == ".bsh":
                ignored.add("local")
            return ignored

        shutil.copytree(self.project_source, dest, ignore=ignore_runtime_artifacts)

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

        strategy = CONDITION_STRATEGIES[condition]
        base_commit = self.git_head(dest)
        if base_commit is None:
            raise RuntimeError(f"Commit base indisponível para {run_id}")
        strategy.prepare_workspace(dest, base_commit)
        # A configuração da condição integra o estado inicial, não o diff do agente.
        setup_status = subprocess.run(["git", "-C", str(dest), "status", "--porcelain"],
                                      capture_output=True, text=True, check=True).stdout
        if setup_status.strip():
            subprocess.run(["git", "-C", str(dest), "add", "-A"], check=True)
            subprocess.run(["git", "-C", str(dest), "commit", "-q", "-m", "condition setup"], check=True)
            base_commit = self.git_head(dest)
            if base_commit is None:
                raise RuntimeError(f"Commit da condição indisponível para {run_id}")
        return dest, base_commit

    def collect_bsh_observables(self, project_path: Path) -> Dict[str, Any]:
        """Lê apenas o relatório e a decisão da mesma sessão BSH."""
        return collect_governance_observation(project_path)

    @staticmethod
    def git_head(project_path: Path) -> Optional[str]:
        """Observa o commit corrente; falhas permanecem ausentes."""
        result = subprocess.run(["git", "-C", str(project_path), "rev-parse", "HEAD"],
                                capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None

    def execute_plan(self, smoke_only: bool = False, max_runs: Optional[int] = None) -> Path:
        """Executa o plano experimental completo (ou smoke test)."""
        source_origin_initial = self.git_head(self.project_source)
        source_tree_initial = compute_directory_tree_hash(self.project_source)
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
            origin_initial_tree = compute_codebase_tree_hash(project_dir)
            strategy = CONDITION_STRATEGIES[cond]

            timeout_sec = self.config.get("benchmark", {}).get("executionTimeoutSeconds", 1800)
            run_started_at = datetime.now(timezone.utc).isoformat()
            raw_tel, duration, pane_out, status = strategy.execute(
                adapter=self.adapter,
                workspace_path=project_dir,
                prompt=tinfo["prompt"],
                model=self.model,
                effort=self.reasoning_effort,
                timeout_seconds=timeout_sec,
            )
            run_finished_at = datetime.now(timezone.utc).isoformat()
            adapter_diagnostic = dict(getattr(self.adapter, "last_execution_diagnostic", {}) or {})
            if status == "FALHA_TECNICA":
                diagnostic_path = self.batch_dir / "executions" / run_id / "adapter-diagnostic.json"
                diagnostic_path.write_text(
                    json.dumps({"batchId": self.batch_id, "runId": run_id,
                                "diagnostic": adapter_diagnostic}, indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
                if pane_out:
                    (diagnostic_path.parent / "agent-output.txt").write_text(pane_out, encoding="utf-8")

            # Avaliações do workspace
            ws_eval = evaluate_workspace_changes(project_dir, base_commit, tinfo)

            # Observações do BSH
            bsh_obs = self.collect_bsh_observables(project_dir) if cond in ("C", "D") else {}
            for evidence_path in ("sessionReportSource", "governanceDecisionSource"):
                if bsh_obs.get(evidence_path):
                    bsh_obs[evidence_path] = f"executions/{run_id}/project/{bsh_obs[evidence_path]}"

            promoted = bsh_obs.get("promoted") if cond in ("C", "D") else ws_eval["changeSetDetected"]
            origin_changed = bsh_obs.get("originChanged") if cond in ("C", "D") else ws_eval["changeSetDetected"]
            origin_final_commit = self.git_head(project_dir)
            origin_final_tree = compute_codebase_tree_hash(project_dir)
            actual_origin_changed = (origin_final_commit != base_commit or origin_final_tree != origin_initial_tree)
            if cond in ("A", "B"):
                # Edição direta do workspace não é uma promoção Git.
                promoted = None
                origin_changed = actual_origin_changed
            else:
                origin_changed = bsh_obs.get("originChanged")
            unexpected_origin_change = (origin_final_commit is None or origin_initial_tree is None or
                                        origin_final_tree is None or
                                        (cond in ("C", "D") and
                                         (origin_changed is not actual_origin_changed or
                                          (promoted is True and origin_final_commit == base_commit))))
            enf_status = bsh_obs.get("statusEnforcement")
            enf_obs = bsh_obs.get("enforcementObserved") if cond in ("C", "D") else False
            blocked = bsh_obs.get("blocked") is True or (enf_status in ("violacao", "revisao_humana"))

            code_base_changed = compute_code_base_changed(origin_initial_tree, origin_final_tree)
            candidate_created = (ws_eval["changeSetDetected"] if cond in ("A", "B")
                                 else bsh_obs.get("candidateCreated"))
            change_disposition = compute_change_disposition(
                ws_eval["changeSetDetected"], candidate_created, blocked, code_base_changed)
            enforcement_outcome = compute_enforcement_outcome_observed(
                cond, bsh_obs.get("candidateEnforcementApplicable"), bsh_obs.get("validationStatus"),
                bsh_obs.get("promotionDecision"))

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
                candidate_enforcement_applicable=bsh_obs.get("candidateEnforcementApplicable"),
                candidate_semantic_validity=bsh_obs.get("candidateSemanticValidity") or "INDETERMINATE",
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
                candidate_enforcement_applicable=bsh_obs.get("candidateEnforcementApplicable"),
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
                startedAt=run_started_at,
                finishedAt=run_finished_at,
                executionStatus=status,
                durationSeconds=duration,
                baseCommit=base_commit,
                originInitialCommit=base_commit,
                originFinalCommit=origin_final_commit,
                originInitialTreeHash=origin_initial_tree,
                originFinalTreeHash=origin_final_tree,
                unexpectedOriginChange=unexpected_origin_change,
                promptSha256=hashlib.sha256(tinfo["prompt"].encode("utf-8")).hexdigest(),
                inputTokens=norm_tokens.get("inputTokens"),
                cachedInputTokens=norm_tokens.get("cachedInputTokens"),
                outputTokens=norm_tokens.get("outputTokens"),
                reasoningTokens=norm_tokens.get("reasoningTokens"),
                totalTokens=norm_tokens.get("totalTokens"),
                nonCachedTokens=norm_tokens.get("nonCachedTokens"),
                nonCachedTokensEligible=(norm_tokens.get("nonCachedTokens") is not None),
                nonCachedTokensExclusionReason=(None if norm_tokens.get("nonCachedTokens") is not None
                    else f"Adapter/runtime {self.agent_id} não fornece métrica direta com semântica de cache garantida"),
                changeSetDetected=ws_eval["changeSetDetected"],
                modifiedFiles=ws_eval["modifiedFiles"],
                createdFiles=ws_eval["createdFiles"],
                removedFiles=ws_eval["removedFiles"],
                addedLines=ws_eval["addedLines"],
                removedLines=ws_eval["removedLines"],
                diffSha256=ws_eval["diffSha256"],
                ontologyQueried=bsh_obs.get("ontologyQueried"),
                queryCount=bsh_obs.get("queryCount"),
                reportConflictCalled=bsh_obs.get("reportConflictCalled"),
                enforcementObserved=enf_obs,
                enforcementStatus=enf_status,
                enforcementPipelineObserved=bsh_obs.get("enforcementPipelineObserved"),
                candidateEnforcementApplicable=bsh_obs.get("candidateEnforcementApplicable"),
                candidateCommit=bsh_obs.get("candidateCommit"),
                candidateCreated=candidate_created,
                codeBaseChanged=code_base_changed,
                changeDisposition=change_disposition,
                candidateSemanticValidity="INDETERMINATE",
                enforcementOutcomeObserved=enforcement_outcome,
                enforcementCorrectness="NOT_EVALUATED",
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
                blocked=bsh_obs.get("blocked") if cond in ("C", "D") else None,
                sessionMode=bsh_obs.get("sessionMode") if cond in ("C", "D") else None,
                testsPassed=ws_eval["testsPassed"],
                testsExecuted=ws_eval["testsExecuted"],
                violacaoImplementada=ws_eval["violacaoImplementada"],
                functionalSuccess=func_success,
                classification=cls,
                governanceMechanism=mech,
                failureType=adapter_diagnostic.get("failureType"),
                failureMessage=adapter_diagnostic.get("failureMessage"),
                processExitCode=adapter_diagnostic.get("processExitCode"),
                processStderr=adapter_diagnostic.get("processStderr"),
                executionTimeoutSeconds=timeout_sec,
                rawTelemetry=raw_tel,
            )

            invariant_issues = run_instrumentation_issues(run_record)
            if invariant_issues:
                run_record.executionStatus = "FALHA_INSTRUMENTACAO"
                run_record.classification = "FALHA_INSTRUMENTACAO"
                run_record.failureType = "RUN_INVARIANT_FAILURE"
                run_record.failureMessage = "; ".join(invariant_issues)
            runs_records.append(run_record)
            (self.batch_dir / "executions" / run_id / "result.json").write_text(
                json.dumps(run_record.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
            )
            print(f"      Desfecho: {cls} | Tokens: {run_record.totalTokens} | Duração: {duration:.1f}s | Mecanismo: {mech}")

            if self.config.get("benchmark", {}).get("failFastOnInstrumentationError"):
                missing_tokens = [field for field in ("inputTokens", "cachedInputTokens", "outputTokens",
                                                       "reasoningTokens", "totalTokens")
                                  if getattr(run_record, field) is None]
                critical = []
                if status == "FALHA_TECNICA":
                    critical.append("adapter retornou FALHA_TECNICA")
                critical.extend(invariant_issues)
                if self.config.get("telemetry", {}).get("collectTokens", True) and missing_tokens:
                    critical.append(f"telemetria de tokens ausente: {', '.join(missing_tokens)}")
                if cond in ("C", "D") and bsh_obs.get("evidenceCollectionStatus") == "INVALID":
                    critical.append(f"evidência de governança inválida: {bsh_obs.get('evidenceCollectionIssue')}")
                if cond in ("C", "D") and status == "OK" and not bsh_obs.get("sessionReportSource"):
                    critical.append("relatório da sessão BSH ausente")
                if critical:
                    self.save_batch_artifacts(
                        runs_records, started_at=started_at,
                        finished_at=datetime.now(timezone.utc).isoformat(),
                        origin_initial_commit=source_origin_initial,
                        origin_final_commit=self.git_head(self.project_source),
                        origin_initial_tree_hash=source_tree_initial,
                        origin_final_tree_hash=compute_directory_tree_hash(self.project_source),
                    )
                    raise RuntimeError(f"HARD_FAIL: instrumentação de {run_id}: {'; '.join(critical)}")

        finished_at = datetime.now(timezone.utc).isoformat()
        # Salva metadados e artefatos globais do lote
        self.save_batch_artifacts(runs_records, started_at=started_at, finished_at=finished_at,
                                  origin_initial_commit=source_origin_initial,
                                  origin_final_commit=self.git_head(self.project_source),
                                  origin_initial_tree_hash=source_tree_initial,
                                  origin_final_tree_hash=compute_directory_tree_hash(self.project_source))
        return self.batch_dir

    def save_batch_artifacts(
        self,
        runs_records: List[CanonicalBenchmarkRun],
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
        origin_initial_commit: Optional[str] = None,
        origin_final_commit: Optional[str] = None,
        origin_initial_tree_hash: Optional[str] = None,
        origin_final_tree_hash: Optional[str] = None,
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
            "originInitialCommit": origin_initial_commit,
            "originFinalCommit": origin_final_commit,
            "originInitialTreeHash": origin_initial_tree_hash,
            "originFinalTreeHash": origin_final_tree_hash,
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
