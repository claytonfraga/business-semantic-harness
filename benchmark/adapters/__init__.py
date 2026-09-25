"""Adaptadores de agentes do BSH Benchmark e registro dinâmico."""

from .base import BenchmarkAgentAdapter, AgentAdapterRegistry
from .codex import CodexBenchmarkAdapter
from .agy import AgyBenchmarkAdapter

# Auto-registro dos adaptadores conhecidos
AgentAdapterRegistry.register("codex", lambda: CodexBenchmarkAdapter())
AgentAdapterRegistry.register("agy", lambda: AgyBenchmarkAdapter())

__all__ = [
    "BenchmarkAgentAdapter",
    "AgentAdapterRegistry",
    "CodexBenchmarkAdapter",
    "AgyBenchmarkAdapter",
]
