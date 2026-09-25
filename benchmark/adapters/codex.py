"""Adaptador do agente Codex para o BSH Benchmark."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from typing import Any, Dict, Optional, Tuple
import uuid

from ..core.capabilities import AgentCapabilityProfile
from .base import BenchmarkAgentAdapter


class CodexBenchmarkAdapter(BenchmarkAgentAdapter):
    """Adaptador para execução e coleta do runtime Codex."""

    @property
    def agent_id(self) -> str:
        return "codex"

    @property
    def capability_profile(self) -> AgentCapabilityProfile:
        return AgentCapabilityProfile(
            agentId="codex",
            agentName="Codex Native CLI",
            supportsInputTokens=True,
            supportsCachedInputTokens=True,
            supportsOutputTokens=True,
            supportsReasoningTokens=True,
            supportsTotalTokens=True,
            supportsStructuredTelemetry=True,
            supportsMcp=True,
            supportsCustomInstructions=True,
            supportsWorkspaceSelection=True,
            supportsNonInteractiveExecution=True,
            supportsInteractiveTui=True,
            supportsStructuredToolEvents=True,
        )

    def run_direct(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = "gpt-6-sol",
        effort: Optional[str] = "low",
        custom_instructions: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        ini = time.time()
        cmd = [
            "codex", "exec", "--json", "--ephemeral", "--skip-git-repo-check",
            "--ignore-user-config", "-s", "danger-full-access", "-C", str(project_path)
        ]
        if model:
            cmd.extend(["-m", model])
        if effort:
            cmd.extend(["-c", f'model_reasoning_effort="{effort}"'])
        cmd.append(prompt)

        try:
            r = subprocess.run(cmd, capture_output=True, text=True, input="", timeout=timeout_seconds)
            status = "OK" if r.returncode == 0 else "FALHA_TECNICA"
            stdout_text = r.stdout
        except Exception as e:
            return {}, time.time() - ini, str(e), "FALHA_TECNICA"

        raw_usage = {}
        for linha in stdout_text.splitlines():
            try:
                e = json.loads(linha)
                if e.get("type") == "turn.completed" and e.get("usage"):
                    raw_usage = e["usage"]
            except Exception:
                continue

        dur = time.time() - ini
        return raw_usage, dur, stdout_text, status

    def run_bsh_session(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = "gpt-6-sol",
        effort: Optional[str] = "low",
        enforcement: bool = True,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        from ..lib import tmux

        sessao = f"bm-{uuid.uuid4().hex[:8]}"
        ini = time.time()
        tmux.tmux(["new-session", "-d", "-s", sessao, "-x", "220", "-y", "55"])
        env = "" if enforcement else "BSH_ENFORCEMENT=off "
        model_env = f"BSH_CODEX_MODEL={model} " if model else ""
        effort_env = f'BSH_CODEX_REASONING_EFFORT="{effort}" ' if effort else ""

        tmux.tmux(["send-keys", "-t", sessao, f"{env}{model_env}{effort_env}bsh codex --project {project_path}", "Enter"])
        if not tmux.wait_for_pane(sessao, r"Ask Codex to do anything", 120):
            tmux.tmux(["kill-session", "-t", sessao])
            return {}, time.time() - ini, "", "FALHA_TECNICA"

        tmux.tmux(["send-keys", "-t", sessao, prompt])
        time.sleep(1)
        tmux.tmux(["send-keys", "-t", sessao, "Enter"])

        log = None
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            d = project_path / ".bsh" / "local"
            if d.is_dir():
                logs = sorted(p for p in d.iterdir() if p.name.startswith("session-") and p.name.endswith(".jsonl"))
                if logs and '"event":"turn-completed"' in logs[-1].read_text(encoding="utf-8", errors="ignore"):
                    log = logs[-1]
                    break
            time.sleep(3)

        if log is None:
            tmux.tmux(["kill-session", "-t", sessao])
            return {}, time.time() - ini, "", "FALHA_TECNICA"

        tmux.tmux(["send-keys", "-t", sessao, "C-c"])
        tmux.wait_for_pane(sessao, r"Aprovar excecao|custo da verificacao ontologica|tokens indisponiveis|nenhuma alteracao|Worktree temporaria removida|a validacao falhou|promocao nao realizada", 120)

        p_fim = tmux.pane(sessao)
        if "Aprovar excecao" in p_fim:
            tmux.tmux(["send-keys", "-t", sessao, "n"])
            time.sleep(0.5)
            tmux.tmux(["send-keys", "-t", sessao, "Enter"])
            tmux.wait_for_pane(sessao, r"excecao negada|teste E2E encerrado|Worktree temporaria removida", 30)
        else:
            time.sleep(2)

        pane_texto = tmux.pane(sessao)
        tmux.tmux(["kill-session", "-t", sessao])

        raw_usage = {}
        for linha in reversed(log.read_text(encoding="utf-8", errors="ignore").splitlines()):
            try:
                e = json.loads(linha)
                if e.get("event") == "token-usage":
                    raw_usage = e
                    break
            except Exception:
                continue

        dur = time.time() - ini
        return raw_usage, dur, pane_texto, "OK"

    def normalize_telemetry(self, raw_telemetry: Dict[str, Any]) -> Dict[str, Optional[int]]:
        if not raw_telemetry:
            return {
                "inputTokens": None, "cachedInputTokens": None, "outputTokens": None,
                "reasoningTokens": None, "totalTokens": None, "nonCachedTokens": None
            }
        inp = raw_telemetry.get("inputTokens") or raw_telemetry.get("input_tokens")
        cac = raw_telemetry.get("cachedInputTokens") or raw_telemetry.get("cached_input_tokens")
        out = raw_telemetry.get("outputTokens") or raw_telemetry.get("output_tokens")
        rac = raw_telemetry.get("reasoningOutputTokens") or raw_telemetry.get("reasoning_output_tokens")
        tot = raw_telemetry.get("totalTokens") or raw_telemetry.get("total_tokens")

        if tot is None and inp is not None and out is not None:
            tot = inp + out

        nc = None
        if inp is not None and out is not None:
            c = cac or 0
            nc = max(0, inp - c) + out

        return {
            "inputTokens": inp,
            "cachedInputTokens": cac,
            "outputTokens": out,
            "reasoningTokens": rac,
            "totalTokens": tot,
            "nonCachedTokens": nc,
        }
