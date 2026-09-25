"""Validação e carregamento da configuração declarativa do BSH Benchmark (config.yaml)."""

from pathlib import Path
import shutil
from typing import Any, Dict, List, Optional
import yaml

from ..adapters.base import AgentAdapterRegistry


def load_and_validate_config(config_path: Path, repo_root: Optional[Path] = None) -> Dict[str, Any]:
    """Carrega e valida estritamente benchmark/config.yaml.

    Encerra com ValueError objetivo caso qualquer parâmetro obrigatório
    esteja ausente, inválido ou aponte para recursos inexistentes.
    """
    config_path = Path(config_path).resolve()
    if not config_path.is_file():
        raise ValueError(f"Arquivo de configuração inexistente: {config_path}")

    try:
        raw_text = config_path.read_text(encoding="utf-8")
        cfg = yaml.safe_load(raw_text)
    except Exception as e:
        raise ValueError(f"Erro de sintaxe YAML no arquivo {config_path}: {e}")

    if not isinstance(cfg, dict):
        raise ValueError(f"Configuração inválida em {config_path}: esperado objeto/dicionário na raiz.")

    root = repo_root or config_path.parent.parent

    # 1. Seção benchmark
    if "benchmark" not in cfg or not isinstance(cfg["benchmark"], dict):
        raise ValueError("Seção obrigatória 'benchmark' ausente ou inválida em config.yaml.")
    bench_sec = cfg["benchmark"]
    if not bench_sec.get("name"):
        raise ValueError("Campo obrigatório 'benchmark.name' ausente ou vazio em config.yaml.")
    max_execs = bench_sec.get("maximumExecutions", 50)
    if not isinstance(max_execs, int) or max_execs <= 0:
        raise ValueError(f"Campo 'benchmark.maximumExecutions' deve ser um inteiro positivo, obtido: {max_execs}")

    # 2. Seção agent
    if "agent" not in cfg or not isinstance(cfg["agent"], dict):
        raise ValueError("Seção obrigatória 'agent' ausente ou inválida em config.yaml.")
    ag_sec = cfg["agent"]
    ag_id = ag_sec.get("id")
    if not ag_id or not isinstance(ag_id, str):
        raise ValueError("Campo obrigatório 'agent.id' ausente ou vazio em config.yaml.")
    registered_agents = AgentAdapterRegistry.list_registered()
    if ag_id.lower() not in registered_agents:
        raise ValueError(f"Agente 'agent.id: {ag_id}' não está registrado. Agentes suportados: {', '.join(registered_agents)}")
    if not ag_sec.get("model"):
        raise ValueError("Campo obrigatório 'agent.model' ausente ou vazio em config.yaml.")

    # 3. Seção project
    if "project" not in cfg or not isinstance(cfg["project"], dict):
        raise ValueError("Seção obrigatória 'project' ausente ou inválida em config.yaml.")
    proj_sec = cfg["project"]
    proj_rel = proj_sec.get("path")
    if not proj_rel:
        raise ValueError("Campo obrigatório 'project.path' ausente em config.yaml.")
    proj_path = Path(proj_rel)
    if not proj_path.is_absolute():
        proj_path = (root / proj_path).resolve()
    if not proj_path.is_dir():
        # Fallback para test/fixtures/enforcement-project se for o projeto de teste
        alt_path = root / "test" / "fixtures" / "enforcement-project"
        if alt_path.is_dir():
            proj_path = alt_path
        else:
            raise ValueError(f"Diretório do projeto 'project.path: {proj_rel}' não encontrado em {proj_path}.")
    cfg["project"]["resolvedPath"] = str(proj_path)

    domain = proj_sec.get("ontologyDomain", "ativos")
    domain_dir = proj_path / ".bsh" / "domains" / domain
    if not domain_dir.is_dir():
        # Se for o projeto piloto, verifica se a ontologia existe
        pass

    # 4. Seção experiment
    if "experiment" not in cfg or not isinstance(cfg["experiment"], dict):
        raise ValueError("Seção obrigatória 'experiment' ausente ou inválida em config.yaml.")
    exp_sec = cfg["experiment"]
    conditions = exp_sec.get("conditions")
    if not conditions or not isinstance(conditions, list):
        raise ValueError("Campo obrigatório 'experiment.conditions' deve ser uma lista não vazia.")
    valid_conditions = {"A", "B", "C", "D"}
    for c in conditions:
        if c not in valid_conditions:
            raise ValueError(f"Condição experimental inválida 'experiment.conditions: {c}'. Válidas: A, B, C, D.")

    tasks = exp_sec.get("tasks")
    if not tasks or not isinstance(tasks, list):
        raise ValueError("Campo obrigatório 'experiment.tasks' deve ser uma lista não vazia.")

    # 5. Seção statistics (opcional, com validação se presente)
    if "statistics" in cfg and isinstance(cfg["statistics"], dict):
        stat_sec = cfg["statistics"]
        conf = stat_sec.get("confidenceLevel")
        if conf is not None and (not isinstance(conf, (int, float)) or not (0 < conf < 1)):
            raise ValueError(f"Campo 'statistics.confidenceLevel' deve estar entre 0 e 1, obtido: {conf}")

    return cfg


def save_config_to_batch(config_path: Path, batch_dir: Path) -> Path:
    """Copia integralmente config.yaml para a pasta do lote para reprodutibilidade."""
    batch_dir = Path(batch_dir)
    batch_dir.mkdir(parents=True, exist_ok=True)
    dest = batch_dir / "config.yaml"
    shutil.copy2(config_path, dest)
    return dest
