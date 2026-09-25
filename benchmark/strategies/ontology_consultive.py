"""Estratégia para a Condição C — Ontologia Consultiva (sem enforcement independente no gate)."""

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from ..adapters.base import BenchmarkAgentAdapter
from .base import ExperimentalConditionStrategy


class OntologyConsultiveConditionStrategy(ExperimentalConditionStrategy):
    """Condição C: Agente tem acesso às consultas ontológicas do BSH, mas enforcement no gate fica inativo."""

    @property
    def condition_id(self) -> str:
        return "C"

    @property
    def name(self) -> str:
        return "Ontologia Consultiva"

    def prepare_workspace(self, workspace_path: Path, base_commit: str) -> None:
        agents_file = workspace_path / "AGENTS.md"
        if agents_file.is_file():
            agents_file.unlink()

    def execute(
        self,
        adapter: BenchmarkAgentAdapter,
        workspace_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        return adapter.run_bsh_session(
            project_path=workspace_path,
            prompt=prompt,
            model=model,
            effort=effort,
            enforcement=False,
            timeout_seconds=timeout_seconds,
        )
