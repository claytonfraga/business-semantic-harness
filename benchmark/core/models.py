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
    nonCachedTokens: Optional[int] = None

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
    reportConflictCalled: Optional[bool] = None
    enforcementObserved: Optional[bool] = None
    enforcementStatus: Optional[str] = None    # conforme, violacao, revisao_humana, indeterminado, null
    identifiedOperation: Optional[str] = None
    identifiedShapes: Optional[List[str]] = None
    technicalGatesObserved: Optional[bool] = None
    technicalGatesPassed: Optional[bool] = None
    promoted: bool = False
    originChanged: bool = False

    # Sucesso funcional e verificação de regras
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
        d["bloqueado"] = (not self.promoted) and (self.changeSetDetected or self.enforcementStatus == "violacao")
        d["aplicado"] = self.promoted or (self.changeSetDetected and not d["bloqueado"])
        return d


def sha256_file(path: Path) -> str:
    if not path.is_file():
        return "not_found"
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def compute_directory_tree_hash(directory: Path, ignore_patterns: Optional[List[str]] = None) -> str:
    """Calcula um hash determinístico do conteúdo de um diretório."""
    if not directory.is_dir():
        return "not_found"
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


def compute_experiment_hashes(repo_root: Path, pilot_path: Path, tasks_file: Path) -> Dict[str, str]:
    """Calcula todos os hashes de congelamento exigidos pela Seção 2 do protocolo."""
    repo_commit = "unknown"
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo_root, capture_output=True, text=True)
        if r.returncode == 0:
            repo_commit = r.stdout.strip()
    except Exception:
        pass

    bsh_product_hash = compute_directory_tree_hash(repo_root / "src")
    benchmark_hash = compute_directory_tree_hash(repo_root / "benchmark", ignore_patterns=["results", ".venv", "__pycache__"])
    pilot_hash = compute_directory_tree_hash(pilot_path, ignore_patterns=[".git", ".bsh", "node_modules"])
    ontology_path = pilot_path / ".bsh" / "domains" / "ativos" / "ontology.jsonld"
    shapes_path = pilot_path / ".bsh" / "domains" / "ativos" / "shapes.ttl"

    return {
        "repositoryCommit": repo_commit,
        "bshProductTreeHash": bsh_product_hash,
        "benchmarkTreeHash": benchmark_hash,
        "pilotHash": pilot_hash,
        "ontologyHash": sha256_file(ontology_path),
        "shapesHash": sha256_file(shapes_path),
        "taskManifestHash": sha256_file(tasks_file),
    }
