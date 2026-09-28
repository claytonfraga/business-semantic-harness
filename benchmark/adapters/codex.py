"""Adaptador do agente Codex para o BSH Benchmark."""

import json
from pathlib import Path
import subprocess
import time
from typing import Any, Dict, Optional, Tuple
import uuid

from ..core.capabilities import AgentCapabilityProfile
from .base import BenchmarkAgentAdapter


class CodexBenchmarkAdapter(BenchmarkAgentAdapter):
    """Adaptador para execução e coleta do runtime Codex."""

    def __init__(self) -> None:
        self.last_execution_diagnostic: Dict[str, Any] = {}

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
        self.last_execution_diagnostic = {}
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
        except subprocess.TimeoutExpired as exc:
            stdout_text = self._output_text(exc.stdout)
            stderr_text = self._output_text(exc.stderr)
            self.last_execution_diagnostic = {
                "failureType": "TIMEOUT",
                "failureMessage": f"Codex excedeu o limite de {timeout_seconds} segundos",
                "processExitCode": None,
                "processStderr": stderr_text,
                "executionTimeoutSeconds": timeout_seconds,
            }
            return self._extract_usage(stdout_text), time.time() - ini, stdout_text, "FALHA_TECNICA"
        except OSError as exc:
            self.last_execution_diagnostic = {
                "failureType": "PROCESS_START_ERROR",
                "failureMessage": str(exc),
                "processExitCode": None,
                "processStderr": None,
                "executionTimeoutSeconds": timeout_seconds,
            }
            return {}, time.time() - ini, "", "FALHA_TECNICA"

        status = "OK" if r.returncode == 0 else "FALHA_TECNICA"
        stdout_text = r.stdout
        if r.returncode != 0:
            self.last_execution_diagnostic = {
                "failureType": "NONZERO_EXIT",
                "failureMessage": f"Codex encerrou com código {r.returncode}",
                "processExitCode": r.returncode,
                "processStderr": r.stderr,
                "executionTimeoutSeconds": timeout_seconds,
            }
        else:
            self.last_execution_diagnostic = {
                "failureType": None,
                "failureMessage": None,
                "processExitCode": r.returncode,
                "processStderr": r.stderr or None,
                "executionTimeoutSeconds": timeout_seconds,
            }

        dur = time.time() - ini
        return self._extract_usage(stdout_text), dur, stdout_text, status

    @staticmethod
    def _output_text(value: Any) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return value or ""

    @staticmethod
    def _extract_usage(stdout_text: str) -> Dict[str, Any]:
        raw_usage: Dict[str, Any] = {}
        for linha in stdout_text.splitlines():
            try:
                e = json.loads(linha)
                if e.get("type") == "turn.completed" and e.get("usage"):
                    raw_usage = e["usage"]
            except Exception:
                continue
        return raw_usage

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
        self.last_execution_diagnostic = {}
        tmux.tmux(["new-session", "-d", "-s", sessao, "-x", "220", "-y", "55"])
        # A condição C usa um modo consultivo explícito; a variável legada não
        # desativa o gate do produto e não constitui separação experimental.
        mode = "" if enforcement else " --consultative"
        model_env = f"BSH_CODEX_MODEL={model} " if model else ""
        effort_env = f'BSH_CODEX_REASONING_EFFORT="{effort}" ' if effort else ""

        tmux.tmux(["send-keys", "-t", sessao, f"{model_env}{effort_env}bsh codex{mode} --project {project_path}", "Enter"])
        if not tmux.wait_for_pane(sessao, r"Ask Codex to do anything", 120):
            pane_texto = tmux.pane(sessao)
            tmux.tmux(["kill-session", "-t", sessao])
            self.last_execution_diagnostic = {
                "failureType": "SESSION_START_TIMEOUT",
                "failureMessage": "A sessão BSH não ficou pronta em 120 segundos",
                "processExitCode": None,
                "processStderr": pane_texto,
                "executionTimeoutSeconds": timeout_seconds,
            }
            return {}, time.time() - ini, pane_texto, "FALHA_TECNICA"

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
            pane_texto = tmux.pane(sessao)
            tmux.tmux(["kill-session", "-t", sessao])
            self.last_execution_diagnostic = {
                "failureType": "TURN_TIMEOUT",
                "failureMessage": f"A sessão BSH não concluiu o turno em {timeout_seconds} segundos",
                "processExitCode": None,
                "processStderr": pane_texto,
                "executionTimeoutSeconds": timeout_seconds,
            }
            return {}, time.time() - ini, pane_texto, "FALHA_TECNICA"

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
        def observed(*names: str) -> Optional[int]:
            for name in names:
                value = raw_telemetry.get(name)
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                    return value
            return None

        inp = observed("inputTokens", "input_tokens")
        cac = observed("cachedInputTokens", "cached_input_tokens")
        out = observed("outputTokens", "output_tokens")
        rac = observed("reasoningOutputTokens", "reasoning_output_tokens")
        tot = observed("totalTokens", "total_tokens")

        if tot is None and inp is not None and out is not None:
            tot = inp + out

        # A semântica de tokens não cacheados depende do runtime; não inferir.
        nc = None

        return {
            "inputTokens": inp,
            "cachedInputTokens": cac,
            "outputTokens": out,
            "reasoningTokens": rac,
            "totalTokens": tot,
            "nonCachedTokens": nc,
        }
