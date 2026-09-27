"""Adaptador do agente opencode para o BSH Benchmark.

Adição aditiva: implementa o mesmo contrato de ``BenchmarkAgentAdapter`` usado por
Codex e Agy, sem alterar o núcleo, as condições, os oráculos ou a análise científica.
O produto BSH expõe ``bsh opencode`` para a TUI e ``bsh opencode --prompt-file`` para a
execução governada não-interativa, preservando os mesmos artefatos públicos.
"""

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from ..core.capabilities import AgentCapabilityProfile
from .base import BenchmarkAgentAdapter


def _parse_usage(value: Any) -> Optional[Dict[str, int]]:
    """Extrai o último bloco de tokens observado em uma estrutura JSON do opencode."""
    found: Optional[Dict[str, int]] = None
    if isinstance(value, list):
        for item in value:
            found = _parse_usage(item) or found
        return found
    if not isinstance(value, dict):
        return None
    tokens = value.get("tokens")
    if isinstance(tokens, dict) and ("input" in tokens or "output" in tokens):
        entrada = tokens.get("input") or 0
        saida = tokens.get("output") or 0
        if entrada or saida:
            cache = tokens.get("cache") if isinstance(tokens.get("cache"), dict) else {}
            reasoning = tokens.get("reasoning") or 0
            total = tokens.get("total") or (entrada + saida + reasoning + (cache.get("read") or 0))
            return {
                "input": int(entrada), "output": int(saida), "reasoning": int(reasoning),
                "cacheRead": int(cache.get("read") or 0), "total": int(total),
            }
    for item in value.values():
        found = _parse_usage(item) or found
    return found


class OpenCodeBenchmarkAdapter(BenchmarkAgentAdapter):
    """Adaptador para execução e coleta do runtime opencode."""

    def __init__(self) -> None:
        self.last_execution_diagnostic: Dict[str, Any] = {}

    @property
    def agent_id(self) -> str:
        return "opencode"

    @property
    def capability_profile(self) -> AgentCapabilityProfile:
        return AgentCapabilityProfile(
            agentId="opencode",
            agentName="OpenCode CLI",
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

    @staticmethod
    def _output_text(value: Any) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return value or ""

    def _isolated_environment(self, model: Optional[str]) -> Tuple[Dict[str, str], Optional[str]]:
        """HOME/XDG isolado com credenciais copiadas e configuração mínima (condições A/B)."""
        home = tempfile.mkdtemp(prefix="bsh-opencode-bench-")
        os.chmod(home, 0o700)
        config_dir = Path(home) / ".config" / "opencode"
        data_dir = Path(home) / ".local" / "share" / "opencode"
        config_dir.mkdir(parents=True, exist_ok=True)
        data_dir.mkdir(parents=True, exist_ok=True)
        for filename in ("auth.json", "mcp-auth.json"):
            origem = Path.home() / ".local" / "share" / "opencode" / filename
            if origem.is_file():
                shutil.copy2(origem, data_dir / filename)
        config: Dict[str, Any] = {
            "$schema": "https://opencode.ai/config.json",
            "share": "disabled", "autoupdate": False, "snapshot": False,
            "plugin": [], "lsp": False, "formatter": False,
        }
        if model:
            config["model"] = model
        (config_dir / "opencode.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
        environment = {
            **os.environ,
            "HOME": home,
            "XDG_CONFIG_HOME": str(Path(home) / ".config"),
            "XDG_DATA_HOME": str(Path(home) / ".local" / "share"),
            "XDG_CACHE_HOME": str(Path(home) / ".cache"),
            "XDG_STATE_HOME": str(Path(home) / ".local" / "state"),
        }
        return environment, home

    def run_direct(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        ini = time.time()
        self.last_execution_diagnostic = {}
        environment, home = self._isolated_environment(model)
        cmd = ["opencode", "run", "--format", "json", "--auto", "--dir", str(project_path)]
        if model:
            cmd.extend(["-m", model])
        cmd.append(prompt)
        try:
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, input="",
                                   timeout=timeout_seconds, cwd=str(project_path), env=environment)
            except subprocess.TimeoutExpired as exc:
                stdout_text = self._output_text(exc.stdout)
                self.last_execution_diagnostic = {
                    "failureType": "TIMEOUT",
                    "failureMessage": f"opencode excedeu o limite de {timeout_seconds} segundos",
                    "processExitCode": None, "processStderr": self._output_text(exc.stderr),
                    "executionTimeoutSeconds": timeout_seconds,
                }
                return self._usage_from_text(stdout_text), time.time() - ini, stdout_text, "FALHA_TECNICA"
            except OSError as exc:
                self.last_execution_diagnostic = {
                    "failureType": "PROCESS_START_ERROR", "failureMessage": str(exc),
                    "processExitCode": None, "processStderr": None,
                    "executionTimeoutSeconds": timeout_seconds,
                }
                return {}, time.time() - ini, "", "FALHA_TECNICA"
        finally:
            if home:
                shutil.rmtree(home, ignore_errors=True)

        status = "OK" if r.returncode == 0 else "FALHA_TECNICA"
        if r.returncode != 0:
            self.last_execution_diagnostic = {
                "failureType": "NONZERO_EXIT", "failureMessage": f"opencode encerrou com código {r.returncode}",
                "processExitCode": r.returncode, "processStderr": r.stderr,
                "executionTimeoutSeconds": timeout_seconds,
            }
        else:
            self.last_execution_diagnostic = {
                "failureType": None, "failureMessage": None, "processExitCode": r.returncode,
                "processStderr": r.stderr or None, "executionTimeoutSeconds": timeout_seconds,
            }
        return self._usage_from_text(r.stdout), time.time() - ini, r.stdout, status

    @staticmethod
    def _usage_from_text(stdout_text: str) -> Dict[str, Any]:
        found: Dict[str, Any] = {}
        for linha in stdout_text.splitlines():
            texto = linha.strip()
            if not texto.startswith("{"):
                continue
            try:
                parsed = _parse_usage(json.loads(texto))
            except Exception:
                continue
            if parsed:
                found = parsed
        return found

    @staticmethod
    def _read_bsh_usage(project_path: Path) -> Dict[str, Any]:
        local = project_path / ".bsh" / "local"
        if not local.is_dir():
            return {}
        logs = sorted(local.glob("session-*.jsonl"))
        for log in reversed(logs):
            try:
                for linha in reversed(log.read_text(encoding="utf-8", errors="ignore").splitlines()):
                    try:
                        entry = json.loads(linha)
                    except Exception:
                        continue
                    if entry.get("event") == "token-usage":
                        return {
                            "input": entry.get("inputTokens"), "output": entry.get("outputTokens"),
                            "reasoning": entry.get("reasoningOutputTokens"), "cacheRead": entry.get("cachedInputTokens"),
                            "total": entry.get("totalTokens"),
                        }
            except Exception:
                continue
        return {}

    def run_bsh_session(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        enforcement: bool = True,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        ini = time.time()
        self.last_execution_diagnostic = {}
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as handle:
            handle.write(prompt)
            prompt_file = handle.name
        cmd = ["bsh", "opencode"]
        if not enforcement:
            cmd.append("--consultative")
        cmd.extend(["--prompt-file", prompt_file, "--project", str(project_path)])
        if model:
            cmd.extend(["--model", model])
        try:
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, input="",
                                   timeout=timeout_seconds, cwd=str(project_path))
            except subprocess.TimeoutExpired as exc:
                pane_texto = self._output_text(exc.stdout) + self._output_text(exc.stderr)
                self.last_execution_diagnostic = {
                    "failureType": "TIMEOUT",
                    "failureMessage": f"A sessão BSH/opencode excedeu o limite de {timeout_seconds} segundos",
                    "processExitCode": None, "processStderr": pane_texto,
                    "executionTimeoutSeconds": timeout_seconds,
                }
                return {}, time.time() - ini, pane_texto, "FALHA_TECNICA"
            except OSError as exc:
                self.last_execution_diagnostic = {
                    "failureType": "PROCESS_START_ERROR", "failureMessage": str(exc),
                    "processExitCode": None, "processStderr": None,
                    "executionTimeoutSeconds": timeout_seconds,
                }
                return {}, time.time() - ini, "", "FALHA_TECNICA"
        finally:
            Path(prompt_file).unlink(missing_ok=True)

        pane_texto = (r.stdout or "") + (r.stderr or "")
        usage = self._read_bsh_usage(project_path)
        status = "OK" if r.returncode == 0 else "FALHA_TECNICA"
        if r.returncode != 0:
            self.last_execution_diagnostic = {
                "failureType": "NONZERO_EXIT", "failureMessage": f"bsh opencode encerrou com código {r.returncode}",
                "processExitCode": r.returncode, "processStderr": r.stderr,
                "executionTimeoutSeconds": timeout_seconds,
            }
        else:
            self.last_execution_diagnostic = {
                "failureType": None, "failureMessage": None, "processExitCode": r.returncode,
                "processStderr": r.stderr or None, "executionTimeoutSeconds": timeout_seconds,
            }
        return usage, time.time() - ini, pane_texto, status

    def normalize_telemetry(self, raw_telemetry: Dict[str, Any]) -> Dict[str, Optional[int]]:
        if not raw_telemetry:
            return {
                "inputTokens": None, "cachedInputTokens": None, "outputTokens": None,
                "reasoningTokens": None, "totalTokens": None, "nonCachedTokens": None,
            }

        def observed(*names: str) -> Optional[int]:
            for name in names:
                value = raw_telemetry.get(name)
                if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                    return value
            return None

        inp = observed("input", "inputTokens", "input_tokens")
        cac = observed("cacheRead", "cachedInputTokens")
        out = observed("output", "outputTokens", "output_tokens")
        rac = observed("reasoning", "reasoningOutputTokens", "reasoning_tokens")
        tot = observed("total", "totalTokens", "total_tokens")
        if tot is None and inp is not None and out is not None:
            tot = inp + out + (rac or 0) + (cac or 0)
        # A semântica de tokens não cacheados depende do runtime; não inferir.
        return {
            "inputTokens": inp, "cachedInputTokens": cac, "outputTokens": out,
            "reasoningTokens": rac, "totalTokens": tot, "nonCachedTokens": None,
        }
