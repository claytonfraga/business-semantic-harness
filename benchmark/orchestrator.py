"""Orquestrador experimental do BSH Benchmark (Seção 3).

Coordena a preparação de worktrees, seleção de agentes via registro,
aplicação de estratégias experimentais A/B/C/D, coleta e normalização canônica,
geração de artefatos estruturados e disparo da análise científica.
"""

import csv
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import time
from typing import Any, Dict, List, Optional, Tuple

from .adapters.base import AgentAdapterRegistry, BenchmarkAgentAdapter
from .core.config import load_and_validate_config, save_config_to_batch
from .core.models import CanonicalBenchmarkRun, compute_experiment_hashes
from .core.classification import classify_run, determine_governance_mechanism
from .core.pairing import compute_paired_dataset, export_paired_csvs
from .core.statistics import compute_statistics, export_statistics_json
from .core.validation import validate_batch_data_quality
from .core.figures import generate_all_figures
from .core.report import generate_and_compile_report
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
        """Lê relatórios e evidências deixadas pelo BSH no diretório .bsh/local."""
        relatorio: Dict[str, Any] = {}
        sessions_dir = project_path / ".bsh" / "local" / "sessions"
        if sessions_dir.is_dir():
            rels = sorted(sessions_dir.glob("*.report.json"))
            if rels:
                try:
                    relatorio = json.loads(rels[-1].read_text(encoding="utf-8"))
                except Exception:
                    pass

        enforcement_ev: Optional[Dict[str, Any]] = None
        enf_dir = project_path / ".bsh" / "local" / "enforcement"
        if enf_dir.is_dir():
            enfs = sorted(enf_dir.glob("*.json"))
            if enfs:
                try:
                    enforcement_ev = json.loads(enfs[-1].read_text(encoding="utf-8"))
                except Exception:
                    pass

        logs_count = 0
        local_dir = project_path / ".bsh" / "local"
        if local_dir.is_dir():
            logs_count = len(list(local_dir.glob("session-*.jsonl")))

        return {
            "relatorio": relatorio,
            "enforcementEvidence": enforcement_ev,
            "ontologyQueried": logs_count > 0,
            "promoted": bool(relatorio.get("promovido")),
            "originChanged": bool(relatorio.get("origemAlterada")),
            "blocked": bool(relatorio.get("bloqueado")),
            "statusEnforcement": relatorio.get("statusEnforcement") or (enforcement_ev.get("status") if enforcement_ev else None),
            "enforcementObserved": enforcement_ev is not None or "statusEnforcement" in relatorio,
            "technicalGatesPassed": relatorio.get("gatesAprovados"),
        }

    def execute_plan(self, smoke_only: bool = False, max_runs: Optional[int] = None) -> Path:
        """Executa o plano experimental completo (ou smoke test)."""
        self.batch_dir.mkdir(parents=True, exist_ok=True)
        (self.batch_dir / "executions").mkdir(parents=True, exist_ok=True)

        if self.config_path and self.config_path.is_file():
            save_config_to_batch(self.config_path, self.batch_dir)

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

            raw_tel, duration, pane_out, status = strategy.execute(
                adapter=self.adapter,
                workspace_path=project_dir,
                prompt=tinfo["prompt"],
                model=self.model,
                effort=self.reasoning_effort,
            )

            # Avaliações do workspace
            ws_eval = evaluate_workspace_changes(project_dir, base_commit, tinfo)

            # Observações do BSH
            bsh_obs = self.collect_bsh_observables(project_dir) if cond in ("C", "D") else {}

            promoted = bsh_obs.get("promoted", ws_eval["changeSetDetected"] if cond in ("A", "B") else False)
            origin_changed = bsh_obs.get("originChanged", ws_eval["changeSetDetected"] if cond in ("A", "B") else False)
            enf_status = bsh_obs.get("statusEnforcement")
            enf_obs = bsh_obs.get("enforcementObserved", False if cond in ("A", "B") else None)
            blocked = bsh_obs.get("blocked", False) or (enf_status in ("violacao", "revisao_humana")) or ("excecao negada" in pane_out) or ("Aprovar excecao" in pane_out)

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
                report_conflict_called=False,
                technical_failure=(status == "FALHA_TECNICA"),
                task_id=base_tid,
            )

            mech = determine_governance_mechanism(
                condition=cond,
                classification=cls,
                change_set_detected=ws_eval["changeSetDetected"],
                promoted=promoted,
                ontology_queried=bsh_obs.get("ontologyQueried"),
                report_conflict_called=False,
                enforcement_observed=enf_obs,
                enforcement_status=enf_status,
                technical_gates_passed=bsh_obs.get("technicalGatesPassed"),
                task_type=tinfo.get("tipo", "valida_governada"),
            )

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
                reportConflictCalled=False,
                enforcementObserved=enf_obs,
                enforcementStatus=enf_status,
                identifiedOperation=(bsh_obs.get("enforcementEvidence") or {}).get("resultados", [{}])[0].get("operacao") if bsh_obs.get("enforcementEvidence") else None,
                identifiedShapes=[(bsh_obs.get("enforcementEvidence") or {}).get("resultados", [{}])[0].get("shape")] if (bsh_obs.get("enforcementEvidence") and (bsh_obs.get("enforcementEvidence") or {}).get("resultados", [{}])[0].get("shape")) else None,
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

        # Salva metadados e artefatos globais do lote
        self.save_batch_artifacts(runs_records)
        return self.batch_dir

    def save_batch_artifacts(self, runs_records: List[CanonicalBenchmarkRun]) -> None:
        """Salva todos os artefatos agregados do lote e dispara a análise completa."""
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
            "agente": self.agent_id,
            "modelo": self.model,
            "esforco": self.reasoning_effort,
            "condicoes": ["A", "B", "C", "D"],
            "targetRuns": len(runs_records),
            "ordemExecucao": [r.runId for r in runs_records],
            "hashes": hashes,
            "bshProductTreeHash": hashes["bshProductTreeHash"],
            "commitBsh": hashes["repositoryCommit"],
        }
        (self.batch_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")

        # 5. Reconhecimento semântico
        d_runs = [r for r in runs_records if r.condition == "D" and r.taskType in ("valida_governada", "violadora")]
        gov_ops = len(d_runs)
        corr_ops = sum(1 for r in d_runs if r.identifiedOperation is not None)
        semantic_rec = {
            "operationRecall": (corr_ops / gov_ops) if gov_ops > 0 else 0.0,
            "operationPrecision": 1.0 if corr_ops > 0 else 0.0,
            "shapeRecall": (corr_ops / gov_ops) if gov_ops > 0 else 0.0,
            "shapePrecision": 1.0 if corr_ops > 0 else 0.0,
        }
        (self.batch_dir / "semantic-recognition.json").write_text(json.dumps(semantic_rec, indent=2, ensure_ascii=False), encoding="utf-8")

        # 6. Pareamento e CSVs
        paired = compute_paired_dataset(measurements, self.tasks_list)
        export_paired_csvs(paired, self.batch_dir)

        # 7. Estatísticas
        stats = compute_statistics(measurements, paired, semantic_rec, metadata)
        export_statistics_json(stats, self.batch_dir)

        # 8. Validação de qualidade dos dados
        quality = validate_batch_data_quality(measurements, paired, metadata, self.batch_dir)

        # 9. Geração de figuras científicas
        figures_geradas = generate_all_figures(paired, stats, self.batch_dir)

        # 10. Relatório LaTeX, PDF e cópia para Downloads
        generate_and_compile_report(
            batch_dir=self.batch_dir,
            metadata=metadata,
            stats=stats,
            quality=quality,
            measurements=measurements,
            paired=paired,
            capabilities=self.adapter.capability_profile.to_dict(),
            generated_figures=figures_geradas,
            tasks=self.tasks_list,
        )
