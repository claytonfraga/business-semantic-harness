"""Abstração de telemetria por adaptador e semântica unificada de tokens para o BSH Benchmark.

Contratos estritos:
- Ausência de telemetria DEVE retornar None (nunca 0).
- Zero representa exclusivamente medição confirmada de 0 tokens.
- Semântica de tokens documentada e uniforme.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BenchmarkTelemetryProvider(ABC):
    """Provedor abstrato de telemetria para agentes avaliados no benchmark."""

    @abstractmethod
    def extract_telemetry(self, raw_output: Any, execution_context: Dict[str, Any]) -> Dict[str, Optional[float]]:
        """Extrai métricas de telemetria do resultado da execução.

        Campos retornados:
        - inputTokens: tokens de prompt/entrada (ou None)
        - cachedInputTokens: tokens de entrada lidos de cache (ou None)
        - outputTokens: tokens gerados/resposta (ou None)
        - reasoningTokens: tokens de raciocínio / Chain-of-Thought (ou None)
        - totalTokens: total de tokens (ou None)
        - nonCachedTokens: tokens brutos não cacheados (ou None)
        """
        pass


class AgyTelemetryProvider(BenchmarkTelemetryProvider):
    """Provedor de telemetria para o agente Antigravity CLI (Agy)."""

    def extract_telemetry(self, raw_output: Any, execution_context: Dict[str, Any]) -> Dict[str, Optional[float]]:
        # No modo interativo TUI (bsh agy), a telemetria não é emitida estruturadamente
        # Retorna explicitamente None para todas as métricas de tokens
        usage = None
        if isinstance(raw_output, dict):
            usage = raw_output.get("usage")
        elif isinstance(raw_output, str) and raw_output.strip().startswith("{"):
            try:
                import json
                data = json.loads(raw_output.strip())
                if isinstance(data, dict):
                    usage = data.get("usage")
            except Exception:
                usage = None

        if not usage:
            return {
                "inputTokens": None,
                "cachedInputTokens": None,
                "outputTokens": None,
                "reasoningTokens": None,
                "totalTokens": None,
                "nonCachedTokens": None,
            }

        inp = usage.get("input_tokens")
        cac = usage.get("cache_read_tokens")
        out = usage.get("output_tokens")
        rac = usage.get("thinking_tokens")
        tot = usage.get("total_tokens")

        # Se totalTokens não for emitido, calcula fórmula documentada: input + output
        if tot is None and inp is not None and out is not None:
            tot = inp + out

        # Fórmula não cacheada documentada: (input - cache) + output
        non_cached = None
        if inp is not None and out is not None:
            c = cac or 0
            non_cached = max(0, (inp - c)) + out

        return {
            "inputTokens": inp,
            "cachedInputTokens": cac,
            "outputTokens": out,
            "reasoningTokens": rac,
            "totalTokens": tot,
            "nonCachedTokens": non_cached,
        }


class CodexTelemetryProvider(BenchmarkTelemetryProvider):
    """Provedor de telemetria para o agente Codex."""

    def extract_telemetry(self, raw_output: Any, execution_context: Dict[str, Any]) -> Dict[str, Optional[float]]:
        usage = None
        if isinstance(raw_output, dict):
            usage = raw_output.get("usage")
        elif isinstance(raw_output, str):
            # Parse de eventos codex exec
            try:
                from lib import tokens
                usage = tokens.usage_from_exec_output(raw_output)
            except Exception:
                usage = None

        if not usage:
            return {
                "inputTokens": None,
                "cachedInputTokens": None,
                "outputTokens": None,
                "reasoningTokens": None,
                "totalTokens": None,
                "nonCachedTokens": None,
            }

        inp = usage.get("input_tokens")
        cac = usage.get("cached_input_tokens")
        out = usage.get("output_tokens")
        rac = usage.get("reasoning_output_tokens")
        tot = usage.get("total_tokens")

        if tot is None and inp is not None and out is not None:
            tot = inp + out

        non_cached = None
        if inp is not None and out is not None:
            c = cac or 0
            non_cached = max(0, (inp - c)) + out

        return {
            "inputTokens": inp,
            "cachedInputTokens": cac,
            "outputTokens": out,
            "reasoningTokens": rac,
            "totalTokens": tot,
            "nonCachedTokens": non_cached,
        }


def get_telemetry_provider(agent: str) -> BenchmarkTelemetryProvider:
    """Fábrica de provedores de telemetria por agente."""
    if agent.lower() == "agy":
        return AgyTelemetryProvider()
    return CodexTelemetryProvider()
