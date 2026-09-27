"""Abstração comum de adaptador de agente para o BSH Benchmark (Seção 4 e 5).

Os adaptadores lidam exclusivamente com as particularidades operacionais
de inicialização, workspace, MCP, timeouts, logs brutos e extração de telemetria
de cada agente. Nenhuma regra estatística, científica ou de classificação reside aqui.
"""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..core.capabilities import AgentCapabilityProfile
from ..core.models import CanonicalBenchmarkRun


class BenchmarkAgentAdapter(ABC):
    """Abstração que define o contrato operacional de um agente de IA no benchmark."""

    @property
    @abstractmethod
    def agent_id(self) -> str:
        """Identificador canônico do agente (ex: 'agy', 'codex', 'claude')."""
        pass

    @property
    @abstractmethod
    def capability_profile(self) -> AgentCapabilityProfile:
        """Declaração de suporte a telemetria e controle do agente."""
        pass

    @property
    def name(self) -> str:
        return self.capability_profile.agentName

    @property
    def version(self) -> str:
        return getattr(self.capability_profile, "agentVersion", "1.0.0")

    @abstractmethod
    def run_direct(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        """Executa o agente diretamente sobre o workspace (Condições A e B).

        Retorna:
          (raw_telemetry, duration_seconds, stdout_or_pane_text, execution_status)
        """
        pass

    @abstractmethod
    def run_bsh_session(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        enforcement: bool = True,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        """Executa o agente governado pelo BSH em sessão worktree (Condições C e D).

        Retorna:
          (raw_telemetry, duration_seconds, stdout_or_pane_text, execution_status)
        """
        pass

    @abstractmethod
    def normalize_telemetry(self, raw_telemetry: Dict[str, Any]) -> Dict[str, Any]:
        """Converte a telemetria bruta específica do agente para campos numéricos canônicos."""
        pass


class AgentAdapterRegistry:
    """Registro extensível de adaptadores de agentes (Seção 5)."""

    _registry: Dict[str, Callable[[], BenchmarkAgentAdapter]] = {}

    @classmethod
    def register(cls, agent_id: str, factory: Callable[[], BenchmarkAgentAdapter]) -> None:
        """Registra um adaptador para um identificador de agente."""
        cls._registry[agent_id.lower()] = factory

    @classmethod
    def get(cls, agent_id: str) -> BenchmarkAgentAdapter:
        """Obtém uma instância do adaptador para o agente solicitado."""
        key = agent_id.lower()
        if key not in cls._registry:
            disponiveis = ", ".join(cls._registry.keys()) or "nenhum"
            raise ValueError(f"Agente experimental '{agent_id}' não registrado no benchmark. Disponíveis: {disponiveis}")
        return cls._registry[key]()

    @classmethod
    def list_registered(cls) -> List[str]:
        """Lista os agentes registrados."""
        return sorted(list(cls._registry.keys()))
