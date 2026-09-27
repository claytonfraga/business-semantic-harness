"""Modelo canônico de dados experimentais do BSH Benchmark.

O modelo canônico é estritamente desacoplado de qualquer agente de IA específico.
Tanto Agy quanto Codex (e quaisquer futuros agentes) convertem suas saídas
e evidências locais para este modelo canônico.
"""

from dataclasses import dataclass, asdict, field
import hashlib
from pathlib import Path
import subprocess
from typing import Any, Dict, List, Optional


import platform

@dataclass
class CanonicalBenchmarkRun:
    """Registro estruturado de uma execução experimental individual."""
    runId: str
    batchId: str
    taskId: str
    baseTaskId: str
    condition: str                           # A, B, C, D
    agent: str                               # Identificador abstrato do agente (ex: agy, codex)
    replicationIndex: int = 1
    taskType: str = "valida_governada"       # valida_governada, violadora, indeterminada, fora_conhecimento
    dataOrigin: str = "REAL_EXECUTION"       # REAL_EXECUTION, SYNTHETIC_FIXTURE, IMPORTED_REAL_EXECUTION

    agentVersion: Optional[str] = None
    model: Optional[str] = None
    reasoningEffort: Optional[str] = None

    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    durationSeconds: Optional[float] = None
    baseCommit: Optional[str] = None
    promptSha256: Optional[str] = None
    sessionId: Optional[str] = None
    worktreePath: Optional[str] = None
    branchName: Optional[str] = None

    # Telemetria de tokens (estritamente None quando não observados, NUNCA 0)
    inputTokens: Optional[int] = None
    cachedInputTokens: Optional[int] = None
    outputTokens: Optional[int] = None
    reasoningTokens: Optional[int] = None
    totalTokens: Optional[int] = None
    rawTotalTokens: Optional[int] = None
    normalizedTotalTokens: Optional[int] = None
    nonCachedTokens: Optional[int] = None
    nonCachedTokensEligible: bool = True
    nonCachedTokensExclusionReason: Optional[str] = None
    tokenTelemetryStatus: str = "VALID"      # VALID, PARTIAL, INCONSISTENT, NOT_AVAILABLE

    # Alterações no repositório / worktree
    changeSetDetected: bool = False
    modifiedFiles: int = 0
    createdFiles: int = 0
    removedFiles: int = 0
    addedLines: int = 0
    removedLines: int = 0
    diffSha256: Optional[str] = None

    # Observabilidade de BSH e Governança
    ontologyQueried: Optional[bool] = None
    queryCount: Optional[int] = None
    reportConflictCalled: Optional[bool] = None
    enforcementObserved: Optional[bool] = None
    enforcementStatus: Optional[str] = None    # conforme, violacao, revisao_humana, indeterminado, null
    enforcementPipelineObserved: Optional[bool] = None
    candidateEnforcementApplicable: Optional[bool] = None
    independentEnforcementActivated: Optional[bool] = None
    enforcementGateEvidence: Optional[Dict[str, Any]] = None
    governanceDecision: Optional[Dict[str, Any]] = None
    evidenceCollectionStatus: Optional[str] = None
    evidenceCollectionIssue: Optional[str] = None
    sessionReportSource: Optional[str] = None
    governanceDecisionSource: Optional[str] = None
    governanceDecisionSha256: Optional[str] = None
    governanceInteraction: Optional[str] = None
    governanceIntervention: Optional[str] = None
    expectedOperation: Optional[str] = None
    expectedShape: Optional[str] = None
    identifiedOperation: Optional[str] = None
    identifiedShapes: Optional[List[str]] = None
    operationRecognitionCorrect: Optional[bool] = None
    shapeRecognitionCorrect: Optional[bool] = None
    technicalGatesObserved: Optional[bool] = None
    technicalGatesPassed: Optional[bool] = None
    promoted: Optional[bool] = None
    originChanged: Optional[bool] = None

    # Sucesso funcional, governança e verificação de regras (Seção 7)
    promptFulfillment: Optional[bool] = None
    functionalCorrectness: Optional[bool] = None
    governanceCorrectness: Optional[bool] = None
    taskOutcomeCorrect: Optional[bool] = None
    testsPassed: Optional[bool] = None
    violacaoImplementada: Optional[bool] = None
    functionalSuccess: Optional[bool] = None

    # Classificação baseada em evidências
    # ALTERACAO_CORRETA, ALTERACAO_INCORRETA, BLOQUEIO_CORRETO, FALSO_BLOQUEIO,
    # VIOLACAO_NAO_DETECTADA, REVISAO_HUMANA, INDETERMINADO,
    # SEM_ALTERACAO_CORRETA, SEM_ALTERACAO_INCORRETA, SEM_ALTERACAO_INDETERMINADA,
    # FALHA_TECNICA, FALHA_INSTRUMENTACAO
    classification: str = "INDETERMINADO"

    # Mecanismo de governança responsável pelo desfecho
    # NONE, CONSULTA_PREVENTIVA, CONFLITO_REPORTADO, ENFORCEMENT_INDEPENDENTE,
    # REVISAO_HUMANA, GATE_TECNICO, INDETERMINADO, NAO_OBSERVAVEL
    governanceMechanism: str = "INDETERMINADO"

    # Equivalência comportamental (preenchida ou pareada no subconjunto)
    # EQUIVALENTE, NAO_EQUIVALENTE, INDETERMINADA, NAO_APLICAVEL
    behavioralEquivalence: str = "NAO_APLICAVEL"

    failureType: Optional[str] = None
    failureMessage: Optional[str] = None

    # Telemetria bruta preservada para auditoria completa
    rawTelemetry: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        # Aliases de compatibilidade para relatórios e análises legadas
        d["execucao"] = self.runId
        d["tarefa"] = self.taskId
        d["tipo"] = self.taskType
        d["condicao"] = self.condition
        d["agente"] = self.agent
        d["classificacao"] = self.classification
        d["tempo"] = self.durationSeconds
        d["totais"] = self.totalTokens
        d["entrada"] = self.inputTokens
        d["saida"] = self.outputTokens
        d["cache"] = self.cachedInputTokens
        d["raciocinio"] = self.reasoningTokens
        d["tokensNaoCache"] = self.nonCachedTokens
        d["arquivos"] = self.modifiedFiles + self.createdFiles
        d["adicionadas"] = self.addedLines
        d["removidas"] = self.removedLines
        d["bloqueado"] = ((self.promoted is False) and
                         (self.changeSetDetected or self.enforcementStatus == "violacao")) if self.promoted is not None else None
        d["aplicado"] = (self.promoted or (self.changeSetDetected and d["bloqueado"] is False)) if self.promoted is not None else None
        return d


def sha256_file(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def compute_directory_tree_hash(directory: Path, ignore_patterns: Optional[List[str]] = None) -> Optional[str]:
    """Calcula um hash determinístico do conteúdo de um diretório."""
    if not directory.is_dir():
        return None
    ignore = set(ignore_patterns or [".git", "node_modules", "dist", "coverage", "__pycache__", ".venv"])
    h = hashlib.sha256()
    for p in sorted(directory.rglob("*")):
        if p.is_file():
            rel_parts = set(p.relative_to(directory).parts)
            if rel_parts & ignore:
                continue
            h.update(str(p.relative_to(directory)).encode("utf-8"))
            try:
                h.update(p.read_bytes())
            except Exception:
                pass
    return h.hexdigest()


def compute_experiment_hashes(repo_root: Path, pilot_path: Path, tasks_file: Path) -> Dict[str, Any]:
    """Calcula todos os hashes e metadados de sistema exigidos pelas Seções 2, 3 e 23 do protocolo."""
    repo_commit = None
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo_root, capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            repo_commit = r.stdout.strip()
    except Exception:
        pass

    pilot_commit = None
    try:
        r = subprocess.run(["git", "log", "-1", "--format=%H", "--", str(pilot_path.relative_to(repo_root))], cwd=repo_root, capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            pilot_commit = r.stdout.strip()
        else:
            pilot_commit = repo_commit
    except Exception:
        pilot_commit = repo_commit

    node_ver = None
    try:
        r = subprocess.run(["node", "--version"], capture_output=True, text=True)
        if r.returncode == 0:
            node_ver = r.stdout.strip()
    except Exception:
        pass

    npm_ver = None
    try:
        r = subprocess.run(["npm", "--version"], capture_output=True, text=True)
        if r.returncode == 0:
            npm_ver = r.stdout.strip()
    except Exception:
        pass

    git_ver = None
    try:
        r = subprocess.run(["git", "--version"], capture_output=True, text=True)
        if r.returncode == 0:
            git_ver = r.stdout.strip()
    except Exception:
        pass

    os_info = f"{platform.system()} {platform.release()} ({platform.machine()})"

    bsh_product_hash = compute_directory_tree_hash(repo_root / "src")
    benchmark_hash = compute_directory_tree_hash(repo_root / "benchmark", ignore_patterns=["results", ".venv", "__pycache__"])
    pilot_hash = compute_directory_tree_hash(pilot_path, ignore_patterns=[".git", ".bsh", "node_modules"])
    ontology_path = pilot_path / ".bsh" / "domains" / "ativos" / "ontology.jsonld"
    shapes_path = pilot_path / ".bsh" / "domains" / "ativos" / "shapes.ttl"
    policy_path = pilot_path / ".bsh" / "domains" / "ativos" / "policies.yaml"
    config_path = repo_root / "benchmark" / "config.yaml"
    plan_path = repo_root / "benchmark" / "analysis-plan.yaml"
    policy_cfg_path = repo_root / "benchmark" / "analysis-policy.yaml"

    return {
        "repositoryCommit": repo_commit,
        "pilotCommit": pilot_commit,
        "nodeVersion": node_ver,
        "npmVersion": npm_ver,
        "gitVersion": git_ver,
        "operatingSystem": os_info,
        "bshProductTreeHash": bsh_product_hash,
        "benchmarkTreeHash": benchmark_hash,
        "pilotHash": pilot_hash,
        "ontologyHash": sha256_file(ontology_path),
        "shapesHash": sha256_file(shapes_path),
        "policyHash": sha256_file(policy_path),
        "enforcementConfigurationHash": None,
        "taskManifestHash": sha256_file(tasks_file),
        "configHash": sha256_file(config_path),
        "analysisPlanHash": sha256_file(plan_path),
        "analysisPolicyHash": sha256_file(policy_cfg_path),
    }
