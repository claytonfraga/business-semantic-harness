"""Regressões Given/When/Then do adaptador opencode do benchmark."""

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from benchmark.adapters.base import AgentAdapterRegistry
from benchmark.adapters.opencode import OpenCodeBenchmarkAdapter


class OpenCodeAdapterRegression(unittest.TestCase):
    def test_Given_opencode_agent_When_registered_Then_adapter_matches_contract(self):
        """opencode: Given the agent id, When resolved, Then the adapter follows the contract."""
        adapter = AgentAdapterRegistry.get("opencode")
        self.assertEqual(adapter.agent_id, "opencode")
        self.assertEqual(adapter.capability_profile.supportsTotalTokens, True)
        self.assertTrue(callable(adapter.run_direct))
        self.assertTrue(callable(adapter.run_bsh_session))
        self.assertTrue(callable(adapter.normalize_telemetry))
        self.assertIn("opencode", AgentAdapterRegistry.list_registered())

    def test_Given_opencode_json_events_When_parsed_Then_last_tokens_block_is_used(self):
        """opencode: Given JSON events, When parsed, Then the most cumulative tokens block wins."""
        saida = "\n".join([
            json.dumps({"type": "step", "tokens": {"input": 10, "output": 2, "reasoning": 0, "cache": {"read": 0, "write": 0}}}),
            json.dumps({"type": "step", "tokens": {"input": 54009, "output": 123, "reasoning": 87, "cache": {"read": 1792, "write": 0}}}),
        ])
        usage = OpenCodeBenchmarkAdapter._usage_from_text(saida)
        self.assertEqual(usage["input"], 54009)
        self.assertEqual(usage["output"], 123)
        self.assertEqual(usage["cacheRead"], 1792)

    def test_Given_opencode_usage_When_normalized_Then_fields_are_canonical_and_cache_is_not_inferred(self):
        """opencode: Given usage, When normalized, Then canonical tokens and no inferred cache metric."""
        adapter = OpenCodeBenchmarkAdapter()
        tokens = adapter.normalize_telemetry({"input": 54009, "output": 123, "reasoning": 87, "cacheRead": 1792, "total": 56011})
        self.assertEqual(tokens["inputTokens"], 54009)
        self.assertEqual(tokens["outputTokens"], 123)
        self.assertEqual(tokens["reasoningTokens"], 87)
        self.assertEqual(tokens["cachedInputTokens"], 1792)
        self.assertEqual(tokens["totalTokens"], 56011)
        self.assertIsNone(tokens["nonCachedTokens"])

    def test_Given_no_opencode_telemetry_When_normalized_Then_absence_is_not_zero(self):
        """opencode: Given no telemetry, When normalized, Then absence stays None."""
        tokens = OpenCodeBenchmarkAdapter().normalize_telemetry({})
        for field in ("inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens"):
            self.assertIsNone(tokens[field])
            self.assertNotEqual(tokens[field], 0)

    def test_Given_bsh_consultative_session_log_When_read_Then_token_usage_is_recovered(self):
        """opencode: Given a BSH session log, When read, Then token usage is recovered."""
        with TemporaryDirectory() as directory:
            project = Path(directory)
            local = project / ".bsh" / "local"
            local.mkdir(parents=True)
            (local / "session-fixture.jsonl").write_text(
                json.dumps({"event": "turn-completed", "status": "completed"}) + "\n" +
                json.dumps({"event": "token-usage", "inputTokens": 100, "outputTokens": 20,
                            "cachedInputTokens": 5, "reasoningOutputTokens": 3, "totalTokens": 128}) + "\n",
                encoding="utf-8",
            )
            usage = OpenCodeBenchmarkAdapter._read_bsh_usage(project)
            self.assertEqual(usage["input"], 100)
            self.assertEqual(usage["total"], 128)


if __name__ == "__main__":
    unittest.main()
