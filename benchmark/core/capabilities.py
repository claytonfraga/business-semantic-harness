"""Perfil de capacidades do agente para o BSH Benchmark.

Cada adaptador de agente declara formalmente quais recursos e telemetrias
ele é capaz de expor. O núcleo experimental consulta essas capacidades
para determinar se uma métrica é observável ou deve ser registrada como None/NA.
"""

from dataclasses import dataclass, asdict
from typing import Any, Dict


@dataclass(frozen=True)
class AgentCapabilityProfile:
    """Declaração de capacidades e suporte a telemetria do agente experimental."""
    agentId: str
    agentName: str

    # Capacidades de telemetria de tokens
    supportsInputTokens: bool = True
    supportsCachedInputTokens: bool = True
    supportsOutputTokens: bool = True
    supportsReasoningTokens: bool = True
    supportsTotalTokens: bool = True
    supportsStructuredTelemetry: bool = True

    # Capacidades de execução e controle
    supportsMcp: bool = True
    supportsCustomInstructions: bool = True
    supportsWorkspaceSelection: bool = True
    supportsNonInteractiveExecution: bool = True
    supportsInteractiveTui: bool = False
    supportsStructuredToolEvents: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
