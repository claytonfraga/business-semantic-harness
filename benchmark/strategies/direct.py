"""Estratégia para a Condição A — Direta (Agente sem BSH, sem ontologia, sem regras)."""

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from ..adapters.base import BenchmarkAgentAdapter
from .base import ExperimentalConditionStrategy


class DirectConditionStrategy(ExperimentalConditionStrategy):
    """Condição A: Agente executado diretamente sem governança ou contexto adicional."""

    @property
    def condition_id(self) -> str:
        return "A"

    @property
    def name(self) -> str:
        return "Direta"

    def prepare_workspace(self, workspace_path: Path, base_commit: str) -> None:
        # Garante ausência de AGENTS.md
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
        return adapter.run_direct(
            project_path=workspace_path,
            prompt=prompt,
            model=model,
            effort=effort,
            custom_instructions=None,
            timeout_seconds=timeout_seconds,
        )
