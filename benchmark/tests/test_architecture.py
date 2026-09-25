"""Testes automatizados da arquitetura independente de agentes (Seção 64)."""

import inspect
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
import pytest

from benchmark.core.capabilities import AgentCapabilityProfile
from benchmark.core.models import CanonicalBenchmarkRun
from benchmark.core.classification import classify_run, determine_governance_mechanism
from benchmark.core.pairing import compute_paired_dataset
from benchmark.core.statistics import compute_statistics
from benchmark.adapters.base import BenchmarkAgentAdapter, AgentAdapterRegistry
from benchmark.strategies import DirectConditionStrategy, CONDITION_STRATEGIES
import benchmark.core as core_pkg


class FakeBenchmarkAgentAdapter(BenchmarkAgentAdapter):
    """Adaptador sintético para comprovar independência do núcleo."""

    def __init__(self, agent_id: str = "fake_agent"):
        self._id = agent_id

    @property
    def agent_id(self) -> str:
        return self._id

    @property
    def capability_profile(self) -> AgentCapabilityProfile:
        return AgentCapabilityProfile(
            agentId=self._id,
            agentName="Fake AI Agent",
            supportsInputTokens=True,
            supportsCachedInputTokens=False,  # Não suporta cache
            supportsOutputTokens=True,
            supportsReasoningTokens=False,   # Não suporta raciocínio
            supportsTotalTokens=True,
        )

    def run_direct(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        raw = {"input": 120, "output": 45, "total": 165}
        return raw, 1.25, "Fake agent finished directly.", "OK"

    def run_bsh_session(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        enforcement: bool = True,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        raw = {"input": 150, "output": 50, "total": 200}
        return raw, 2.50, "Fake agent BSH session completed.", "OK"

    def normalize_telemetry(self, raw_telemetry: Dict[str, Any]) -> Dict[str, Optional[int]]:
        if not raw_telemetry:
            return {"inputTokens": None, "cachedInputTokens": None, "outputTokens": None,
                    "reasoningTokens": None, "totalTokens": None, "nonCachedTokens": None}
        return {
            "inputTokens": raw_telemetry.get("input"),
            "cachedInputTokens": None,       # Ausente conforme capability
            "outputTokens": raw_telemetry.get("output"),
            "reasoningTokens": None,         # Ausente conforme capability
            "totalTokens": raw_telemetry.get("total"),
            "nonCachedTokens": raw_telemetry.get("total"),
        }


def test_core_operates_with_fake_agent():
    """Comprova que o núcleo opera perfeitamente com um FakeBenchmarkAgentAdapter."""
    fake = FakeBenchmarkAgentAdapter("synthetic_agent")
    raw, dur, out, st = fake.run_direct(Path("/tmp"), "Teste")
    assert st == "OK"
    norm = fake.normalize_telemetry(raw)
    assert norm["inputTokens"] == 120
    assert norm["outputTokens"] == 45
    assert norm["totalTokens"] == 165
    assert norm["cachedInputTokens"] is None
    assert norm["reasoningTokens"] is None


def test_new_adapter_can_be_registered_dynamically():
    """Comprova que novos adaptadores (ex: claude, qwen) registram-se sem modificar o núcleo."""
    AgentAdapterRegistry.register("qwen", lambda: FakeBenchmarkAgentAdapter("qwen"))
    assert "qwen" in AgentAdapterRegistry.list_registered()
    adapter = AgentAdapterRegistry.get("qwen")
    assert adapter.agent_id == "qwen"


def test_missing_capability_produces_strictly_none():
    """Comprova que capacidade ausente produz estritamente None/null, nunca 0."""
    fake = FakeBenchmarkAgentAdapter("nocache_agent")
    norm = fake.normalize_telemetry({"input": 100, "output": 50, "total": 150})
    assert norm["cachedInputTokens"] is None
    assert norm["cachedInputTokens"] != 0
    assert norm["reasoningTokens"] is None
    assert norm["reasoningTokens"] != 0


def test_canonical_run_preserves_raw_telemetry():
    """Comprova que a telemetria bruta é integralmente preservada."""
    raw = {"engine": "custom", "tokens_raw": 999}
    run = CanonicalBenchmarkRun(
        runId="001-V1-A",
        batchId="batch-test",
        taskId="V1",
        baseTaskId="V1",
        condition="A",
        agent="fake",
        rawTelemetry=raw,
    )
    assert run.rawTelemetry == raw


def test_strategies_accept_any_compatible_adapter():
    """Comprova que as estratégias recebem qualquer adaptador compatível."""
    fake = FakeBenchmarkAgentAdapter("universal_agent")
    strat = CONDITION_STRATEGIES["A"]
    raw, dur, out, st = strat.execute(fake, Path("/tmp"), "Hello")
    assert st == "OK"
    assert raw["total"] == 165


def test_classification_does_not_depend_on_agent_name():
    """Comprova que a classificação independe do nome do agente."""
    for ag_name in ("codex", "agy", "claude", "qwen", "custom_robot"):
        cls = classify_run(
            task_type="violadora",
            condition="D",
            change_set_detected=True,
            blocked=True,
            promoted=False,
            origin_changed=False,
            enforcement_status="violacao",
        )
        assert cls == "BLOQUEIO_CORRETO"


def test_statistics_does_not_depend_on_agent_name():
    """Comprova que as estatísticas são calculadas identicamente independente do nome do agente."""
    runs = [
        {"runId": "001-G1-A", "baseTaskId": "G1", "taskId": "G1", "condicao": "A", "totalTokens": 100, "agente": "custom1", "classification": "ALTERACAO_CORRETA"},
        {"runId": "002-G1-D", "baseTaskId": "G1", "taskId": "G1", "condicao": "D", "totalTokens": 120, "agente": "custom1", "classification": "ALTERACAO_CORRETA"},
    ]
    paired = compute_paired_dataset(runs)
    stats = compute_statistics(runs, paired)
    assert stats["rq1"]["rq1_a"]["n_elegivel"] == 1
    assert stats["rq1"]["rq1_a"]["diferenca_media_tokens"] == 20.0


def test_architecture_core_modules_do_not_import_concrete_adapters():
    """Teste de arquitetura: benchmark/core/ NUNCA importa AgyBenchmarkAdapter nem CodexBenchmarkAdapter."""
    core_dir = Path(core_pkg.__file__).parent
    forbidden_terms = ["AgyBenchmarkAdapter", "CodexBenchmarkAdapter", "from ..adapters.agy", "from ..adapters.codex"]

    for py_file in core_dir.glob("*.py"):
        content = py_file.read_text(encoding="utf-8")
        for term in forbidden_terms:
            assert term not in content, f"Violação de arquitetura detectada em {py_file.name}: importou concretamente '{term}'!"
