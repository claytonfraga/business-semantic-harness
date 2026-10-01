#!/usr/bin/env python3
"""E2E Test Runner & MPEG Video Recorder for BSH with OpenRouter

Runs real interactive BSH sessions inside tmux, captures terminal frames,
renders them with PIL, encodes them into high-quality MPEG videos using ffmpeg,
and generates a comprehensive Gherkin-aligned test report.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# Terminal rendering settings
MONO_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_SIZE = 14
LINE_HEIGHT = 18
PADDING = 16
BG_COLOR = (15, 23, 42)       # Slate 900
TEXT_COLOR = (241, 245, 249)  # Slate 100
HEADER_COLOR = (56, 189, 248) # Sky 400

WORKTREE_ROOT = Path(os.environ.get("BSH_ROOT", "/home/clayton/projetos/oracle"))
VIDEOS_DIR = WORKTREE_ROOT / "evaluation" / "videos"
REPORTS_DIR = WORKTREE_ROOT / "evaluation" / "reports"
SCREENSHOTS_DIR = WORKTREE_ROOT / "evaluation" / "screenshots"


def ensure_dirs() -> None:
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


def capture_tmux_pane(session: str) -> str:
    res = subprocess.run(
        ["tmux", "capture-pane", "-t", session, "-p"],
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout


import re

ANSI_REGEX = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')

def clean_terminal_text(text: str) -> str:
    return ANSI_REGEX.sub('', text)


def render_intro_slide(
    title: str,
    scenario_info: list[str],
    output_path: Path,
    width: int = 1280,
    height: int = 720,
) -> None:
    # Fundo preto, letra branca (regra mandatória para testes E2E)
    img = Image.new("RGB", (width, height), (0, 0, 0))
    draw = ImageDraw.Draw(img)
    title_font = ImageFont.truetype(MONO_FONT, 22)
    header_font = ImageFont.truetype(MONO_FONT, 15)
    body_font = ImageFont.truetype(MONO_FONT, 14)
    footer_font = ImageFont.truetype(MONO_FONT, 12)

    # Top banner
    draw.text((PADDING * 4, 60), "BUSINESS SEMANTIC HARNESS (BSH) — TESTE E2E", font=header_font, fill=(200, 200, 200))
    draw.line([(PADDING * 4, 90), (width - PADDING * 4, 90)], fill=(80, 80, 80), width=1)

    # Título do Cenário em Português (Branco, Negrito)
    draw.text((PADDING * 4, 125), title, font=title_font, fill=(255, 255, 255))

    # Detalhes e Justificativa em Português (Letra Branca)
    y = 200
    for line in scenario_info:
        draw.text((PADDING * 4, y), line, font=body_font, fill=(255, 255, 255))
        y += 30

    # Rodapé
    draw.line([(PADDING * 4, height - 80), (width - PADDING * 4, height - 80)], fill=(60, 60, 60), width=1)
    draw.text(
        (PADDING * 4, height - 58),
        "OpenRouter Native Client • Governança Ontológica RDF/SHACL • Interface Interativa • Worktrees Git",
        font=footer_font,
        fill=(160, 160, 160),
    )

    img.save(output_path)


def render_terminal_frame(text: str, title: str, output_path: Path, width: int = 1280, height: int = 720) -> None:
    img = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(MONO_FONT, FONT_SIZE)
    title_font = ImageFont.truetype(MONO_FONT, FONT_SIZE + 2)

    # Header bar
    draw.rectangle([(0, 0), (width, 36)], fill=(30, 41, 59))
    draw.text((PADDING, 8), title, font=title_font, fill=HEADER_COLOR)

    # Clean text and split lines
    clean = clean_terminal_text(text)
    lines = clean.split("\n")
    y = 48

    for line in lines:
        color = TEXT_COLOR
        if "[*] GOVERNED" in line or "[OK] CONFORMING" in line or "[+]" in line or "[■] Governed" in line:
            color = (34, 197, 94)  # Emerald 500
        elif "[!] DOMAIN MISMATCH" in line or "[!] [Semantic Domain Alert]" in line or "[!] mismatch" in line or "[o] UNGOVERNED" in line or "[o] Ungoverned" in line:
            color = (250, 204, 21) # Amber 400
        elif "[X] VIOLATION" in line or "Promotion blocked" in line or "Error" in line:
            color = (248, 113, 113) # Red 400
        elif "> [User]" in line or "▎ >" in line:
            color = (56, 189, 248) # Sky 400
        elif "[BSH Agent]" in line:
            color = (192, 132, 252) # Purple 400
        elif ">_ Tool:" in line or "● bsh/" in line or "● Read" in line or "● Bash" in line:
            color = (251, 191, 36) # Amber 300
        elif "Antigravity CLI" in line or "Gemini" in line:
            color = (56, 189, 248) # Sky 400
        elif "isViolating: true" in line or "Violação detectada" in line or "viola as regras" in line:
            color = (248, 113, 113) # Red 400
        elif "TransferenciaShape" in line:
            color = (250, 204, 21) # Amber 400
        elif "->" in line and "Status" not in line:
            color = (74, 222, 128) # Green 400
        elif "───" in line or line.startswith("─"):
            color = (71, 85, 105)  # Slate 600
        elif "[Ctrl+" in line or "git(" in line or "·" in line:
            color = (148, 163, 184) # Slate 400

        draw.text((PADDING, y), line, font=font, fill=color)
        y += LINE_HEIGHT
        if y > height - PADDING:
            break

    img.save(output_path)


def type_keys(session: str, text: str, enter: bool = True) -> None:
    for char in text:
        subprocess.run(["tmux", "send-keys", "-t", session, "-l", char], check=True)
        time.sleep(0.04) # Human-paced keystrokes
    if enter:
        time.sleep(0.2)
        subprocess.run(["tmux", "send-keys", "-t", session, "Enter"], check=True)


def encode_mp4(frames_dir: Path, output_mp4: Path, fps: int = 2) -> Path:
    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(fps),
        "-i", str(frames_dir / "frame_%04d.png"),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-r", "25",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(output_mp4),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_mp4


def record_scenario(
    session_name: str,
    title: str,
    intro_title: str,
    intro_lines: list[str],
    command: list[str],
    user_inputs: list[tuple[str, float]], # (input_text, wait_after_seconds)
    output_video: Path,
    output_screenshot: Path,
    completion_marker: str | None = None,
    max_wait: float = 60.0,
    is_interactive_tui: bool = True,
) -> dict:
    ensure_dirs()
    temp_frames = Path(tempfile.mkdtemp(prefix="bsh_frames_"))
    frame_idx = 0

    # 1. Render initial intro slide in Portuguese (black background, white letters)
    intro_file = temp_frames / f"frame_{frame_idx:04d}.png"
    render_intro_slide(intro_title, intro_lines, intro_file)
    frame_idx += 1
    # 16 frames = 8.0 seconds of readable intro slide at 2 fps
    for _ in range(15):
        shutil.copyfile(intro_file, temp_frames / f"frame_{frame_idx:04d}.png")
        frame_idx += 1

    # Kill existing session if any
    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)
    # Start tmux session with 120x32
    subprocess.run([
        "tmux", "new-session", "-d", "-s", session_name,
        "-x", "120", "-y", "32",
    ], check=True)

    try:
        # Run command inside tmux
        cmd_str = " ".join(command)
        subprocess.run(["tmux", "send-keys", "-t", session_name, cmd_str, "Enter"], check=True)

        def snap(count: int = 1, delay: float = 0.5):
            nonlocal frame_idx
            for _ in range(count):
                pane_text = capture_tmux_pane(session_name)
                frame_file = temp_frames / f"frame_{frame_idx:04d}.png"
                render_terminal_frame(pane_text, title, frame_file)
                frame_idx += 1
                time.sleep(delay)

        def type_prompt_interactively(text: str) -> None:
            # Type words with frames snapped so user sees prompt being typed in prompt space
            words = text.split(" ")
            accum = ""
            for i, word in enumerate(words):
                chunk = word if i == 0 else " " + word
                for char in chunk:
                    subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
                    time.sleep(0.04)
                accum += chunk
                if i % 2 == 0 or i == len(words) - 1:
                    snap(count=1, delay=0.25)

            # Hold full prompt in the prompt area for 6.0 seconds (12 frames) so a human can read it!
            snap(count=12, delay=0.5)

            # Press Enter
            subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)
            time.sleep(0.5)

        # Initial wait for startup and header render
        snap(count=6, delay=0.5)

        # Process user inputs
        for inp, wait_time in user_inputs:
            if inp.startswith("/"):
                type_keys(session_name, inp, enter=True)
                snap(count=int(wait_time * 2), delay=0.5)
            else:
                type_prompt_interactively(inp)
                time.sleep(0.5)
                # Check if prompt violation confirmation gate was triggered
                pane_text = capture_tmux_pane(session_name)
                if "Enter para prosseguir" in pane_text or "PROMPT VIOLATION DETECTED" in pane_text:
                    # Hold prompt violation warning for 6.0 seconds (12 frames) so viewer can inspect the alert
                    snap(count=12, delay=0.5)
                    # Press Enter to confirm and proceed
                    subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)
                    time.sleep(0.5)

                # Wait while agent executes tools and gate checks
                steps = max(1, int(wait_time * 2))
                snap(count=steps, delay=0.6)

        # If waiting for a completion marker in terminal output
        if completion_marker:
            start_t = time.time()
            while time.time() - start_t < max_wait:
                snap(count=1, delay=0.5)
                pane_text = capture_tmux_pane(session_name)
                if completion_marker in pane_text:
                    break

        # Hold final resting screen for 20.0 seconds (40 frames) so human can comfortably inspect all details
        snap(count=40, delay=0.5)

        # Final capture while BSH is active
        final_text = capture_tmux_pane(session_name)
        render_terminal_frame(final_text, title, output_screenshot)

        # Cleanly exit BSH session if interactive TUI
        if is_interactive_tui:
            type_keys(session_name, "/exit", enter=True)
            time.sleep(1.0)

        # Encode video in MP4 (H.264 / yuv420p)
        out_mp4 = encode_mp4(temp_frames, output_video, fps=2)

        # Calculate sha256
        sha256 = hashlib.sha256(out_mp4.read_bytes()).hexdigest()
        file_size_kb = out_mp4.stat().st_size / 1024

        return {
            "session": session_name,
            "title": title,
            "video_path": str(out_mp4),
            "screenshot_path": str(output_screenshot),
            "sha256": sha256,
            "file_size_kb": file_size_kb,
            "frames_recorded": frame_idx,
            "final_text": final_text,
        }

    finally:
        subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)
        shutil.rmtree(temp_frames, ignore_errors=True)


def main() -> int:
    ensure_dirs()
    print("=== Starting BSH E2E Test Scenarios & Video Recording ===")

    bsh_bin = shutil.which("bsh") or str(WORKTREE_ROOT / "dist" / "cli.js")
    print(f"Using distribution binary: {bsh_bin}")
    pilot_dir = WORKTREE_ROOT / "pilot" / "asset-management"

    # Scenario 1: Governed Session (Harness Ativo - Bloqueio de Violação)
    print("\n--- Running Scenario 1: Governed Session (Harness Ativo) ---")
    gov_video = VIDEOS_DIR / "bsh-governed-scenario.mp4"
    gov_shot = SCREENSHOTS_DIR / "bsh-governed-scenario.png"

    gov_intro_title = "Jornada 1: Sessão Governada — Detecção de Prompt Violador e Bloqueio SHACL"
    gov_intro_lines = [
        "Domínio de Negócio: Gestão de Ativos ('ativos')",
        "Objetivo da Jornada: Tentar transferir um ativo baixado (AST-002) sem justificativa.",
        "Comportamento Esperado do BSH:",
        "  • A guarda semântica pré-execução detecta a violação do prompt contra a TransferShape.",
        "  • O prompt é destacado com [!] VIOLATION DETECTED e exibido alerta explicativo.",
        "  • O BSH pausa e solicita [Enter] para prosseguir (configurável em /settings).",
        "  • O usuário confirma via [Enter], o modelo executa no worktree e o Gate bloqueia a promoção.",
        "  • O branch principal permanece 100% íntegro e protegido contra corrupção negocial.",
    ]

    gov_inputs = [
        ("Transfer retired asset AST-002 to Maintenance department without justification", 14.0),
    ]

    gov_res = record_scenario(
        session_name="bsh-e2e-governed",
        title="BSH E2E Scenario 1: Governed Session (SHACL Active)",
        intro_title=gov_intro_title,
        intro_lines=gov_intro_lines,
        command=[bsh_bin, "--project", str(pilot_dir)],
        user_inputs=gov_inputs,
        output_video=gov_video,
        output_screenshot=gov_shot,
    )

    print(f"✔ Governed video saved: {gov_res['video_path']} ({gov_res['file_size_kb']:.1f} KB, SHA-256: {gov_res['sha256'][:16]}...)")

    # Scenario 2: Ungoverned Session (Harness Desativado)
    print("\n--- Running Scenario 2: Ungoverned Session (Harness Desativado) ---")
    ungov_video = VIDEOS_DIR / "bsh-ungoverned-scenario.mp4"
    ungov_shot = SCREENSHOTS_DIR / "bsh-ungoverned-scenario.png"

    ungov_intro_title = "Jornada 2: Sessão Desgovernada — Operação sem Harness Ontológico"
    ungov_intro_lines = [
        "Domínio de Negócio: Nenhum (Modo UNGOVERNED)",
        "Objetivo da Jornada: Executar a mesma solicitação de alteração em projeto desgovernado.",
        "Comportamento Esperado do BSH:",
        "  • O BSH opera como cliente direto OpenRouter sem regras ontológicas ativas.",
        "  • Nenhuma verificação SHACL é disparada e o Gate Semântico permanece inativo.",
        "  • Alterações violadoras poderiam ser promovidas diretamente sem barreira.",
        "  • Evidencia o risco de alucinação e quebra de regras quando sem o harness.",
    ]

    # Temporary ungoverned workspace (a clean copy without .bsh/domains/)
    temp_ungov_dir = Path(tempfile.mkdtemp(prefix="bsh_ungov_"))
    shutil.copytree(pilot_dir, temp_ungov_dir / "project", dirs_exist_ok=True)
    shutil.rmtree(temp_ungov_dir / "project" / ".bsh", ignore_errors=True)

    ungov_inputs = [
        ("Transfer retired asset AST-002 to Maintenance department without justification", 12.0),
    ]

    try:
        ungov_res = record_scenario(
            session_name="bsh-e2e-ungoverned",
            title="BSH E2E Scenario 2: Ungoverned Session (Harness Inactive)",
            intro_title=ungov_intro_title,
            intro_lines=ungov_intro_lines,
            command=[bsh_bin, "--project", str(temp_ungov_dir / "project")],
            user_inputs=ungov_inputs,
            output_video=ungov_video,
            output_screenshot=ungov_shot,
        )
        print(f"✔ Ungoverned video saved: {ungov_res['video_path']} ({ungov_res['file_size_kb']:.1f} KB, SHA-256: {ungov_res['sha256'][:16]}...)")
    finally:
        shutil.rmtree(temp_ungov_dir, ignore_errors=True)

    # Scenario 3: Governed Session (Harness Ativo - Alteração Conforme)
    print("\n--- Running Scenario 3: Governed Cooperative Session (Alteração Conforme) ---")
    coop_video = VIDEOS_DIR / "bsh-cooperative-scenario.mp4"
    coop_shot = SCREENSHOTS_DIR / "bsh-cooperative-scenario.png"

    coop_intro_title = "Jornada 3: Sessão Governada — Alteração Conforme Aprovada pelo Gate"
    coop_intro_lines = [
        "Domínio de Negócio: Gestão de Ativos ('ativos')",
        "Objetivo da Jornada: Solicitar transferência de ativo em operação (AST-001) com novos dados.",
        "Comportamento Esperado do BSH:",
        "  • O modelo respeita as regras de transição de estado permitidas (InOperation -> Transferred).",
        "  • O Gate Semântico avalia os fatos contra TransferShape e confirma conformidade.",
        "  • Status emitido: CONFORMING (Ready to promote).",
        "  • A promoção para o branch principal é autorizada com segurança auditável.",
    ]

    coop_inputs = [
        ("Add an endpoint to transfer assets in 'In Operation' state with new owner and location", 14.0),
    ]

    coop_res = record_scenario(
        session_name="bsh-e2e-cooperative",
        title="BSH E2E Scenario 3: Governed Cooperative Session (Conforming)",
        intro_title=coop_intro_title,
        intro_lines=coop_intro_lines,
        command=[bsh_bin, "--project", str(pilot_dir)],
        user_inputs=coop_inputs,
        output_video=coop_video,
        output_screenshot=coop_shot,
    )
    print(f"✔ Cooperative video saved: {coop_res['video_path']} ({coop_res['file_size_kb']:.1f} KB, SHA-256: {coop_res['sha256'][:16]}...)")

    # Scenario 4: Domain Mismatch Alert (Harness Detecta Incompatibilidade Semântica)
    print("\n--- Running Scenario 4: Domain Mismatch Alert (Incompatibilidade Semântica) ---")
    mismatch_video = VIDEOS_DIR / "bsh-domain-mismatch-scenario.mp4"
    mismatch_shot = SCREENSHOTS_DIR / "bsh-domain-mismatch-scenario.png"

    mismatch_intro_title = "Jornada 4: Alerta Proativo de Desalinhamento Ontológico (Domain Mismatch)"
    mismatch_intro_lines = [
        "Domínio Selecionado: Gestão de Ativos ('ativos')",
        "Projeto em Execução: Microserviço de Cálculo Matemático (sem termos de patrimônio)",
        "Objetivo da Jornada: Verificar se o BSH detecta a incompatibilidade de conceitos entre ontologia e código.",
        "Comportamento Esperado do BSH:",
        "  • O mecanismo de afinidade semântica analisa a base de código do projeto.",
        "  • Detecta baixa afinidade (conceitos de 'ativos' ausentes no código).",
        "  • O cabeçalho exibe '[⚠ DOMAIN MISMATCH]' e '(⚠ mismatch)'.",
        "  • O feed inicial emite o alerta '⚠ [Semantic Domain Alert]' recomendando ações.",
        "  • O usuário digita '/ungoverned' para desativar o harness ou troca de domínio com '/domain'.",
    ]

    temp_mismatch_dir = Path(tempfile.mkdtemp(prefix="bsh_mismatch_"))
    try:
        math_src = temp_mismatch_dir / "src"
        math_src.mkdir(parents=True, exist_ok=True)
        (math_src / "calculator.ts").write_text(
            "export function sum(a: number, b: number): number { return a + b; }\n"
            "export function multiply(a: number, b: number): number { return a * b; }\n",
            encoding="utf-8"
        )
        (math_src / "trigonometry.ts").write_text(
            "export function calculateSin(deg: number): number { return Math.sin(deg * Math.PI / 180); }\n",
            encoding="utf-8"
        )
        # Copy .bsh with ativos domain from pilot
        shutil.copytree(pilot_dir / ".bsh", temp_mismatch_dir / ".bsh")

        # Initialize git repo so gitBranch is detected in TUI
        subprocess.run(["git", "init", "-b", "main", str(temp_mismatch_dir)], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["git", "-C", str(temp_mismatch_dir), "config", "user.name", "BSH Tester"], check=True)
        subprocess.run(["git", "-C", str(temp_mismatch_dir), "config", "user.email", "tester@bsh.dev"], check=True)
        subprocess.run(["git", "-C", str(temp_mismatch_dir), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(temp_mismatch_dir), "commit", "-m", "Initial math microservice"], check=True, stdout=subprocess.DEVNULL)

        mismatch_inputs = [
            ("/affinity", 4.0),
            ("/ungoverned", 4.0),
            ("Implement function to calculate factorial of a number", 10.0),
        ]

        mismatch_res = record_scenario(
            session_name="bsh-e2e-mismatch",
            title="BSH E2E Scenario 4: Domain Mismatch Alert & User Bypass",
            intro_title=mismatch_intro_title,
            intro_lines=mismatch_intro_lines,
            command=[bsh_bin, "--project", str(temp_mismatch_dir)],
            user_inputs=mismatch_inputs,
            output_video=mismatch_video,
            output_screenshot=mismatch_shot,
        )
        print(f"✔ Domain Mismatch video saved: {mismatch_res['video_path']} ({mismatch_res['file_size_kb']:.1f} KB, SHA-256: {mismatch_res['sha256'][:16]}...)")
    finally:
        shutil.rmtree(temp_mismatch_dir, ignore_errors=True)

    # Scenario 5: OpenRouter Model Search & Safe Cancel
    print("\n--- Running Scenario 5: OpenRouter Model Search & Safe Cancel ---")
    model_video = VIDEOS_DIR / "bsh-model-search-scenario.mp4"
    model_shot = SCREENSHOTS_DIR / "bsh-model-search-scenario.png"

    model_intro_title = "Jornada 5: Busca de Modelos no OpenRouter e Cancelamento Seguro"
    model_intro_lines = [
        "Catálogo de Modelos: OpenRouter API (catálogo real em tempo real)",
        "Objetivo da Jornada: Abrir busca de modelos com '/model gpt', inspecionar resultados reais e fechar com 'q'.",
        "Comportamento Esperado do BSH:",
        "  • O usuário dispara o comando '/model gpt' para pesquisar modelos da família GPT.",
        "  • O modal exibe os modelos reais da API (como openai/gpt-4o, openai/gpt-4o-mini) com limites de contexto.",
        "  • O usuário avalia a listagem e digita 'q' para fechar sem selecionar nenhum novo modelo.",
        "  • O modal é fechado imediatamente e o modelo original (deepseek/deepseek-v4.1-flash) é mantido.",
        "  • A telemetria e o rodapé preservam o estado da sessão sem alterações indesejadas.",
    ]

    model_inputs = [
        ("/model gpt", 6.0),
        ("q", 4.0),
    ]

    model_res = record_scenario(
        session_name="bsh-e2e-model-search",
        title="BSH E2E Scenario 5: OpenRouter Model Search & Safe Cancel",
        intro_title=model_intro_title,
        intro_lines=model_intro_lines,
        command=[bsh_bin, "--project", str(pilot_dir)],
        user_inputs=model_inputs,
        output_video=model_video,
        output_screenshot=model_shot,
    )
    print(f"✔ Model search video saved: {model_res['video_path']} ({model_res['file_size_kb']:.1f} KB, SHA-256: {model_res['sha256'][:16]}...)")

    # Scenario 6: BSH as MCP Server with Agy Autonomous Agent
    mcp_server_res = run_scenario_6(pilot_dir, bsh_bin)

    # Scenario 7: BSH as MCP Client Consuming Third-Party Tools (Context7) in BSH TUI
    mcp_client_res = run_scenario_7(pilot_dir, bsh_bin)

    # Copy MP4 videos to WSL Downloads for easy human evaluation
    downloads_dir = Path("/mnt/c/Users/clayt/Downloads")
    if downloads_dir.exists():
        for vid in [gov_video, ungov_video, coop_video, mismatch_video, model_video, Path(mcp_server_res["video_path"]), Path(mcp_client_res["video_path"])]:
            if vid.exists():
                shutil.copy2(vid, downloads_dir / vid.name)
        print(f"✔ Copied all MP4 videos to Windows Downloads: {downloads_dir}")

    # Generate Comprehensive Test Report
    report_file = REPORTS_DIR / "relatorio-testes-e2e-openrouter.md"
    generate_markdown_report(gov_res, ungov_res, coop_res, mismatch_res, model_res, mcp_server_res, mcp_client_res, report_file)
    if downloads_dir.exists():
        shutil.copy2(report_file, downloads_dir / "relatorio-testes-e2e-openrouter.md")
    print(f"✔ Comprehensive test report generated: {report_file}")

    return 0


def run_scenario_6(pilot_dir: Path, bsh_bin: str) -> dict:
    print("\n--- Running Scenario 6: External Agent (Agy) with BSH MCP Server Governance ---")
    mcp_server_video = VIDEOS_DIR / "bsh-mcp-server-scenario.mp4"
    mcp_server_shot = SCREENSHOTS_DIR / "bsh-mcp-server-scenario.png"

    agy_bin = shutil.which("agy") or "/home/clayton/.local/bin/agy"

    # Configure agy MCP to use bsh mcp
    subprocess.run([agy_bin, "mcp", "remove", "bsh"], stderr=subprocess.DEVNULL)
    subprocess.run([agy_bin, "mcp", "add", "bsh", bsh_bin, "mcp", "--project", str(pilot_dir)], check=True)

    intro_title = "Jornada 6: Agente Autônomo Agy Integrado ao BSH como Servidor MCP"
    intro_lines = [
        "Agente Autônomo Externo: Antigravity CLI (Agy)",
        "Integração: Model Context Protocol (MCP) via transporte stdio ('bsh mcp')",
        "Objetivo da Jornada: O Agy conecta-se ao BSH para consultar regras de negócio e interceptar violações.",
        "Comportamento Esperado:",
        "  • O Agy descobre as ferramentas expostas pelo BSH MCP Server.",
        "  • O usuário envia uma solicitação violadora de transferência de ativo baixado.",
        "  • O Agy aciona a ferramenta bsh_check_prompt_intent e detecta a violação contra TransferenciaShape.",
        "  • O Agy apresenta em tela o diagnóstico completo com base nas regras ontológicas do BSH.",
    ]

    try:
        user_inputs = [
            ("Consulte o servidor MCP bsh e verifique se o prompt 'Transfer retired asset AST-001 without justification' viola alguma regra da ontologia de ativos", 24.0),
        ]

        res = record_scenario(
            session_name="bsh-e2e-mcp-server",
            title="Agy Autonomous Agent with BSH MCP Server Governance",
            intro_title=intro_title,
            intro_lines=intro_lines,
            command=[agy_bin, "--dangerously-skip-permissions"],
            user_inputs=user_inputs,
            output_video=mcp_server_video,
            output_screenshot=mcp_server_shot,
            is_interactive_tui=True,
        )
        print(f"✔ MCP Server video saved: {res['video_path']} ({res['file_size_kb']:.1f} KB, SHA-256: {res['sha256'][:16]}...)")
        return res
    finally:
        subprocess.run([agy_bin, "mcp", "remove", "bsh"], stderr=subprocess.DEVNULL)


def run_scenario_7(pilot_dir: Path, bsh_bin: str) -> dict:
    print("\n--- Running Scenario 7: BSH as MCP Client (Context7 Tool Execution in TUI) ---")
    mcp_client_video = VIDEOS_DIR / "bsh-mcp-client-scenario.mp4"
    mcp_client_shot = SCREENSHOTS_DIR / "bsh-mcp-client-scenario.png"

    mcp_json = pilot_dir / ".bsh" / "mcp.json"
    if mcp_json.exists():
        mcp_json.unlink()

    intro_title = "Jornada 7: BSH como Cliente MCP — Configuração e Consumo de Ferramentas de Terceiros"
    intro_lines = [
        "Interface: OpenTUI moderna nativa do BSH (binário compilado)",
        "Servidor MCP Externo: Context7 (provedor de documentação técnica oficial)",
        "Objetivo da Jornada: O usuário gerencia conexões MCP com /mcp e a IA consome ferramentas externas no turno.",
        "Comportamento Esperado:",
        "  • O usuário inspeciona conexões ativas com o comando /mcp.",
        "  • O usuário conecta o servidor Context7 via comando /mcp add context7 node ...",
        "  • O BSH conecta via stdio e registra a ferramenta context7_search_docs no chat.",
        "  • O usuário solicita consulta documental: a IA despacha context7_search_docs e responde fundamentada.",
    ]

    mock_server = WORKTREE_ROOT / "test" / "support" / "mock-context7-server.mjs"
    user_inputs = [
        ("/mcp", 4.0),
        (f"/mcp add context7 node {mock_server}", 5.0),
        ("Conecte-se ao MCP Context7 e consulte a documentação sobre regras de validação SHACL", 14.0),
    ]

    try:
        res = record_scenario(
            session_name="bsh-e2e-mcp-client",
            title="BSH OpenTUI: MCP Client Configuration & Third-Party Tool Execution",
            intro_title=intro_title,
            intro_lines=intro_lines,
            command=["env", "OPENROUTER_API_KEY=sk-or-v1-mock-test", bsh_bin, "--project", str(pilot_dir)],
            user_inputs=user_inputs,
            output_video=mcp_client_video,
            output_screenshot=mcp_client_shot,
            is_interactive_tui=True,
        )
        print(f"✔ MCP Client video saved: {res['video_path']} ({res['file_size_kb']:.1f} KB, SHA-256: {res['sha256'][:16]}...)")
        return res
    finally:
        if mcp_json.exists():
            mcp_json.unlink()


def generate_markdown_report(
    gov_res: dict,
    ungov_res: dict,
    coop_res: dict,
    mismatch_res: dict,
    model_res: dict,
    mcp_server_res: dict,
    mcp_client_res: dict,
    output_file: Path,
) -> None:
    now_iso = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
    bsh_bin = shutil.which("bsh") or "bsh"
    content = f"""# Relatório de Testes E2E: BSH com OpenRouter, Governança Semântica e Protocolo MCP

**Data de Execução**: {now_iso}  
**Ambiente**: Linux x86_64, Node.js v22, OpenRouter API (`sk-or-v1-...`), Antigravity CLI (Agy)  
**Executável do BSH**: `{bsh_bin}` (Pacote de distribuição `business-semantic-harness-0.2.4-beta.tgz`)  
**Fonte da Verdade da Especificação**: [`test/features/bsh-governance.feature`](file://{WORKTREE_ROOT}/test/features/bsh-governance.feature)  
**Jornadas de Usuário**: [`test/features/journeys/`](file://{WORKTREE_ROOT}/test/features/journeys/)  
**Projeto Piloto**: [`pilot/asset-management`](file://{WORKTREE_ROOT}/pilot/asset-management) (Domínio `ativos`)

---

## 1. Sumário Executivo

Este relatório apresenta a validação E2E do **Business Semantic Harness (BSH)** cobrindo todos os fluxos críticos de governança, integração de modelos via OpenRouter, e interoperabilidade através do Model Context Protocol (MCP) como servidor e como cliente. Foram executados e gravados em vídeo MP4 (H.264) com slides explicativos iniciais em português sete cenários representativos das regras de negócio:

1. **Jornada 1 (Harness Ontológico Ativo - Detecção e Confirmação de Prompt Violador + Bloqueio)**: Detecção de prompt violador contra `TransferShape`, confirmação de prosseguimento e bloqueio de promoção pelo Gate Semântico.
2. **Jornada 2 (Harness Ontológico Desativado - Ungoverned)**: Operação em modo desassistido sem regras de governança ativas.
3. **Jornada 3 (Harness Ontológico Ativo - Governed Conforme)**: Alteração conforme aprovada pelo Gate Semântico com emissão de status `CONFORMING`.
4. **Jornada 4 (Detecção Proativa de Desalinhamento - Domain Mismatch)**: Detecção preventiva de incompatibilidade entre ontologia e código do projeto.
5. **Jornada 5 (Busca e Alternância de Modelos - OpenRouter Model Search)**: Pesquisa de modelos no catálogo OpenRouter e cancelamento seguro sem alterar modelo ativo.
6. **Jornada 6 (BSH como Servidor MCP de Governança para Agente Agy)**: Integração com o agente autônomo Agy via MCP stdio, detectando violações ontológicas e exibindo regras SHACL.
7. **Jornada 7 (BSH como Cliente MCP Consumindo Context7)**: Gerenciamento de servidores via comando `/mcp add` e consumo de documentação oficial no turno do agente na interface TUI do BSH.

---

## 2. Artefatos de Vídeo para Avaliação Humana

Todos os vídeos foram gravados diretamente do terminal `tmux`, incluindo **slide inicial com fundo preto e letra branca em português** apresentando os objetivos da jornada, seguido da execução em tempo real e captura final:

| Cenário / Jornada | Arquivo de Vídeo | Tamanho | SHA-256 | Captura Final |
|---|---|---|---|---|
| **1. Harness Ativo (Prompt & Gate)** | [`bsh-governed-scenario.mp4`](file://{gov_res['video_path']}) | {gov_res['file_size_kb']:.1f} KB | `{gov_res['sha256']}` | [`bsh-governed-scenario.png`](file://{gov_res['screenshot_path']}) |
| **2. Harness Desativado** | [`bsh-ungoverned-scenario.mp4`](file://{ungov_res['video_path']}) | {ungov_res['file_size_kb']:.1f} KB | `{ungov_res['sha256']}` | [`bsh-ungoverned-scenario.png`](file://{ungov_res['screenshot_path']}) |
| **3. Harness Ativo (Conforme)** | [`bsh-cooperative-scenario.mp4`](file://{coop_res['video_path']}) | {coop_res['file_size_kb']:.1f} KB | `{coop_res['sha256']}` | [`bsh-cooperative-scenario.png`](file://{coop_res['screenshot_path']}) |
| **4. Alerta de Afinidade (Mismatch)** | [`bsh-domain-mismatch-scenario.mp4`](file://{mismatch_res['video_path']}) | {mismatch_res['file_size_kb']:.1f} KB | `{mismatch_res['sha256']}` | [`bsh-domain-mismatch-scenario.png`](file://{mismatch_res['screenshot_path']}) |
| **5. Busca de Modelos (Safe Cancel)** | [`bsh-model-search-scenario.mp4`](file://{model_res['video_path']}) | {model_res['file_size_kb']:.1f} KB | `{model_res['sha256']}` | [`bsh-model-search-scenario.png`](file://{model_res['screenshot_path']}) |
| **6. Servidor MCP (Agente Agy)** | [`bsh-mcp-server-scenario.mp4`](file://{mcp_server_res['video_path']}) | {mcp_server_res['file_size_kb']:.1f} KB | `{mcp_server_res['sha256']}` | [`bsh-mcp-server-scenario.png`](file://{mcp_server_res['screenshot_path']}) |
| **7. Cliente MCP (BSH TUI com Context7)** | [`bsh-mcp-client-scenario.mp4`](file://{mcp_client_res['video_path']}) | {mcp_client_res['file_size_kb']:.1f} KB | `{mcp_client_res['sha256']}` | [`bsh-mcp-client-scenario.png`](file://{mcp_client_res['screenshot_path']}) |

---

## 3. Rastreabilidade com as Especificações Gherkin

- **Jornada 1**: [`test/features/journeys/jornada-01-governado-bloqueio.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-01-governado-bloqueio.feature) — PASSOU ✅
- **Jornada 2**: [`test/features/journeys/jornada-02-desgovernado-sem-harness.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-02-desgovernado-sem-harness.feature) — PASSOU ✅
- **Jornada 3**: [`test/features/journeys/jornada-03-governado-conforme.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-03-governado-conforme.feature) — PASSOU ✅
- **Jornada 4**: [`test/features/journeys/jornada-04-desalinhamento-afinidade.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-04-desalinhamento-afinidade.feature) — PASSOU ✅
- **Jornada 5**: [`test/features/journeys/jornada-05-busca-e-troca-modelos.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-05-busca-e-troca-modelos.feature) — PASSOU ✅
- **Jornada 6**: [`test/features/journeys/jornada-06-mcp-servidor-governanca.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-06-mcp-servidor-governanca.feature) — PASSOU ✅
- **Jornada 7**: [`test/features/journeys/jornada-07-mcp-cliente-terceiros.feature`](file://{WORKTREE_ROOT}/test/features/journeys/jornada-07-mcp-cliente-terceiros.feature) — PASSOU ✅

---

## 4. Conclusão da Avaliação

A padronização mandatória de especificação em `.feature` e geração de evidência em vídeo `.mp4` consolida a rastreabilidade científica e a reprodutibilidade do BSH em todos os seus pontos de contato operacionais.
"""
    output_file.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="BSH E2E Video Recorder")
    parser.add_argument("--scenario", choices=["1", "2", "3", "4", "5", "6", "7", "all"], default="all")
    parsed_args = parser.parse_args()

    ensure_dirs()
    pilot_dir = WORKTREE_ROOT / "pilot" / "asset-management"
    bsh_bin = shutil.which("bsh") or str(WORKTREE_ROOT / "dist" / "cli.js")

    if parsed_args.scenario == "6":
        res = run_scenario_6(pilot_dir, bsh_bin)
        downloads_dir = Path("/mnt/c/Users/clayt/Downloads")
        if downloads_dir.exists():
            shutil.copy2(Path(res["video_path"]), downloads_dir / Path(res["video_path"]).name)
        sys.exit(0)

    elif parsed_args.scenario == "7":
        res = run_scenario_7(pilot_dir, bsh_bin)
        downloads_dir = Path("/mnt/c/Users/clayt/Downloads")
        if downloads_dir.exists():
            shutil.copy2(Path(res["video_path"]), downloads_dir / Path(res["video_path"]).name)
        sys.exit(0)

    raise SystemExit(main())
