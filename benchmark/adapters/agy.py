"""Adaptador do agente Agy para o BSH Benchmark."""

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


def _parse_varint(buf: bytes, offset: int) -> Tuple[int, int]:
    res = 0
    shift = 0
    curr = offset
    while curr < len(buf):
        b = buf[curr]
        curr += 1
        res |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return res, curr


def _extract_tokens_from_sqlite(home_dir: Path) -> Dict[str, Any]:
    conv_dir = home_dir / ".gemini" / "antigravity-cli" / "conversations"
    if not conv_dir.is_dir():
        return {}
    db_files = list(conv_dir.glob("*.db"))
    if not db_files:
        return {}

    import sqlite3
    last_in = None
    sum_out = 0
    sum_reasoning = 0
    last_cache = 0

    for db_path in db_files:
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cursor = conn.cursor()
            cursor.execute("SELECT idx, metadata FROM steps ORDER BY idx")
            rows = cursor.fetchall()
            conn.close()

            for _idx, meta in rows:
                if not meta or not isinstance(meta, (bytes, bytearray)):
                    continue
                i = 0
                while i < len(meta):
                    tag_byte = meta[i]
                    i += 1
                    tag = tag_byte >> 3
                    wire = tag_byte & 7
                    if wire == 0:
                        _, next_i = _parse_varint(meta, i)
                        i = next_i
                    elif wire == 2:
                        length, next_i = _parse_varint(meta, i)
                        i = next_i
                        sub_end = i + length
                        if sub_end > len(meta):
                            break
                        if tag == 9:
                            sj = i
                            inp = None
                            out = None
                            cache = 0
                            reasoning = 0
                            while sj < sub_end:
                                st_byte = meta[sj]
                                sj += 1
                                stag = st_byte >> 3
                                swire = st_byte & 7
                                if swire == 0:
                                    val, next_s = _parse_varint(meta, sj)
                                    sj = next_s
                                    if stag == 2:
                                        inp = val
                                    elif stag == 3:
                                        out = val
                                    elif stag == 5:
                                        cache = val
                                    elif stag == 6:
                                        reasoning = val
                                elif swire == 2:
                                    slen, next_s = _parse_varint(meta, sj)
                                    sj = next_s + slen
                                else:
                                    break
                            if inp is not None and out is not None:
                                last_in = inp
                                sum_out += out
                                sum_reasoning += reasoning
                                last_cache = cache
                        i = sub_end
                    else:
                        break
        except Exception:
            continue

    if last_in is not None and sum_out is not None:
        return {
            "input_tokens": last_in,
            "output_tokens": sum_out,
            "cache_read_tokens": last_cache,
            "thinking_tokens": sum_reasoning,
            "total_tokens": last_in + sum_out,
        }
    return {}


class AgyBenchmarkAdapter(BenchmarkAgentAdapter):
    """Adaptador para execução e coleta do runtime Agy (Antigravity CLI)."""

    @property
    def agent_id(self) -> str:
        return "agy"

    @property
    def capability_profile(self) -> AgentCapabilityProfile:
        return AgentCapabilityProfile(
            agentId="agy",
            agentName="Antigravity CLI (Agy)",
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
        model: Optional[str] = "gemini-3.7-flash-low",
        effort: Optional[str] = "low",
        custom_instructions: Optional[str] = None,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        ini = time.time()
        home_dir = project_path.parent / "agy-home"
        home_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(str(home_dir), 0o700)
        gemini_dir = home_dir / ".gemini"
        agy_dir = gemini_dir / "antigravity-cli"
        cache_dir = agy_dir / "cache"
        config_dir = gemini_dir / "config"
        agy_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)
        config_dir.mkdir(parents=True, exist_ok=True)

        real_gemini = Path.home() / ".gemini"
        real_agy = real_gemini / "antigravity-cli"

        for f in ["oauth_creds.json", "google_accounts.json", "google_account_id", "installation_id", "state.json"]:
            src = real_gemini / f
            if src.exists():
                shutil.copy2(src, gemini_dir / f)

        for f in ["antigravity-oauth-token", "installation_id", "jetski_state.pbtxt"]:
            src = real_agy / f
            if src.exists():
                shutil.copy2(src, agy_dir / f)

        (gemini_dir / "trustedFolders.json").write_text(json.dumps({str(project_path): "TRUST_FOLDER"}))
        (agy_dir / "settings.json").write_text(json.dumps({"trustedWorkspaces": [str(project_path)], "permissions": {"allow": ["*"]}}))
        (gemini_dir / "settings.json").write_text(json.dumps({"ui": {"theme": "Default"}}))
        (cache_dir / "onboarding.json").write_text(json.dumps({"consumerOnboardingComplete": True, "onboardingComplete": True}))

        env = {**os.environ, "HOME": str(home_dir)}
        cmd = ["agy", "-p", prompt, "--dangerously-skip-permissions", "--output-format", "json"]
        if model:
            cmd.extend(["--model", model])
        if effort:
            cmd.extend(["--effort", effort])

        try:
            r = subprocess.run(cmd, cwd=str(project_path), env=env, capture_output=True, text=True, input="", timeout=timeout_seconds)
            status = "OK" if r.returncode == 0 else "FALHA_TECNICA"
            stdout_text = r.stdout
        except Exception as e:
            return {}, time.time() - ini, str(e), "FALHA_TECNICA"

        raw_usage = {}
        try:
            data = json.loads(stdout_text.strip())
            if isinstance(data, dict):
                raw_usage = data.get("usage") or {}
        except Exception:
            pass

        if not raw_usage:
            raw_usage = _extract_tokens_from_sqlite(home_dir)

        dur = time.time() - ini
        return raw_usage, dur, stdout_text, status

    def run_bsh_session(
        self,
        project_path: Path,
        prompt: str,
        model: Optional[str] = "gemini-3.7-flash-low",
        effort: Optional[str] = "low",
        enforcement: bool = True,
        timeout_seconds: int = 1800,
    ) -> Tuple[Dict[str, Any], float, str, str]:
        from ..lib import tmux

        sessao = f"bm-{uuid.uuid4().hex[:8]}"
        ini = time.time()
        tmux.tmux(["new-session", "-d", "-s", sessao, "-x", "220", "-y", "55", "bash"])
        time.sleep(0.5)

        env = "" if enforcement else "BSH_ENFORCEMENT=off "
        model_env = f"BSH_AGY_MODEL={model} " if model else ""
        tmux.tmux(["send-keys", "-t", sessao, f"{env}{model_env}bsh agy --project {project_path}", "Enter"])

        if not tmux.wait_for_pane(sessao, r"Antigravity CLI|\? for shortcuts|Gemini|>", 120):
            tmux.tmux(["kill-session", "-t", sessao])
            return {}, time.time() - ini, "", "FALHA_TECNICA"

        tmux.tmux(["send-keys", "-t", sessao, prompt])
        time.sleep(1)
        tmux.tmux(["send-keys", "-t", sessao, "Enter"])

        deadline = time.time() + timeout_seconds
        started_processing = False
        consecutive_idle = 0
        prompt_resent = False

        while time.time() < deadline:
            time.sleep(2)
            p = tmux.pane(sessao)
            p_strip = p.strip()

            if "esc to cancel" in p:
                started_processing = True
                consecutive_idle = 0
            elif started_processing and ("? for shortcuts" in p_strip or p_strip.endswith(">") or ">" in p_strip[-200:]):
                consecutive_idle += 1
                if consecutive_idle >= 2:
                    break
            elif not started_processing:
                elapsed = time.time() - ini
                if elapsed > 15 and not prompt_resent:
                    tmux.tmux(["send-keys", "-t", sessao, "Enter"])
                    prompt_resent = True
                elif elapsed > 30 and "? for shortcuts" in p_strip:
                    break

        time.sleep(1)
        tmux.tmux(["send-keys", "-t", sessao, "/exit", "Enter"])
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
        d = project_path / ".bsh" / "local"
        if d.is_dir():
            logs = sorted(p for p in d.iterdir() if p.name.startswith("session-") and p.name.endswith(".jsonl"))
            if logs:
                for linha in reversed(logs[-1].read_text(encoding="utf-8", errors="ignore").splitlines()):
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
        cac = raw_telemetry.get("cachedInputTokens") or raw_telemetry.get("cache_read_tokens")
        out = raw_telemetry.get("outputTokens") or raw_telemetry.get("output_tokens")
        rac = raw_telemetry.get("reasoningOutputTokens") or raw_telemetry.get("thinking_tokens")
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
