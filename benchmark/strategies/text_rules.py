"""Estratégia para a Condição B — Regras Textuais em Linguagem Natural."""

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from ..adapters.base import BenchmarkAgentAdapter
from .base import ExperimentalConditionStrategy

REGRAS_TEXTUAIS = """# Regras de Negócio do Domínio

- Um ativo com estadoAtual igual a Baixado não pode ser transferido.
- Um ativo com estadoAtual igual a Baixado não pode ser baixado novamente.
- Um ativo com estadoAtual igual a Baixado não pode ter seu responsável alterado.
- Um ativo com estadoAtual igual a Baixado não pode ter sua localização alterada.
- A transferência de ativo exige a indicação explícita de um novo responsável.
- A baixa de ativo exige a indicação de um motivo.
"""


class TextRulesConditionStrategy(ExperimentalConditionStrategy):
    """Condição B: Agente recebe regras textuais de negócio via AGENTS.md, sem ontologia ou SHACL."""

    @property
    def condition_id(self) -> str:
        return "B"

    @property
    def name(self) -> str:
        return "Regras Textuais"

    def prepare_workspace(self, workspace_path: Path, base_commit: str) -> None:
        (workspace_path / "AGENTS.md").write_text(REGRAS_TEXTUAIS, encoding="utf-8")

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
            custom_instructions=REGRAS_TEXTUAIS,
            timeout_seconds=timeout_seconds,
        )
