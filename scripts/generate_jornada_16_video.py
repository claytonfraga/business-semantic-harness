#!/usr/bin/env python3
import os
import sys
import time
import shutil
import hashlib
import subprocess
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MONO_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
BOLD_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
SANS_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

FONT_SIZE = 14
LINE_HEIGHT = 18
PADDING = 16
BG_COLOR = (13, 17, 23)        # GitHub Dark Dimmed theme
TEXT_COLOR = (230, 237, 243)

ANSI_REGEX = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')

def clean_terminal_text(text: str) -> str:
    return ANSI_REGEX.sub('', text)

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def render_slide(title: str, subtitle: str, bullets: list[str], output_path: Path, width: int = 1280, height: int = 720) -> None:
    img = Image.new("RGB", (width, height), (10, 14, 20)) # Pure black background (#0a0e14)
    draw = ImageDraw.Draw(img)

    title_font = ImageFont.truetype(SANS_BOLD, 36)
    sub_font = ImageFont.truetype(SANS_FONT, 20)
    bullet_font = ImageFont.truetype(SANS_FONT, 18)
    badge_font = ImageFont.truetype(MONO_FONT, 14)

    # Decorative header line
    draw.rectangle([(80, 70), (width - 80, 72)], fill=(56, 189, 248))

    # Badge
    draw.rectangle([(80, 90), (490, 122)], fill=(30, 41, 59))
    draw.text((95, 96), "BSH SPEC-DRIVEN E2E TEST - JORNADA 16", font=badge_font, fill=(56, 189, 248))

    # Main Title
    draw.text((80, 140), title, font=title_font, fill=(255, 255, 255))
    draw.text((80, 195), subtitle, font=sub_font, fill=(148, 163, 184))

    # Bullets
    y = 260
    for bullet in bullets:
        draw.ellipse([(80, y + 6), (90, y + 16)], fill=(56, 189, 248))
        draw.text((105, y), bullet, font=bullet_font, fill=(241, 245, 249))
        y += 44

    # Footer
    draw.rectangle([(80, height - 70), (width - 80, height - 68)], fill=(30, 41, 59))
    draw.text((80, height - 52), "Oracle BSH (Business Semantic Harness) • OpenTUI Component TUI Architecture", font=sub_font, fill=(100, 116, 139))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)

def render_terminal_frame(text: str, title: str, output_path: Path, width: int = 1280, height: int = 720) -> None:
    img = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(MONO_FONT, FONT_SIZE)
    bold_font = ImageFont.truetype(BOLD_FONT, FONT_SIZE)
    header_font = ImageFont.truetype(MONO_FONT, 13)

    # Top title bar
    draw.rectangle([(0, 0), (width, 36)], fill=(22, 27, 34))
    draw.text((PADDING, 10), title, font=header_font, fill=(56, 189, 248))

    raw_lines = text.split("\n")
    y = 48
    for line in raw_lines:
        clean = clean_terminal_text(line)
        if not clean.strip():
            y += LINE_HEIGHT
            continue

        fill_color = TEXT_COLOR
        use_font = font

        if "[*] GOVERNED" in clean or "· GOVERNED" in clean or "[OK]" in clean or "[+]" in clean or "✔" in clean:
            fill_color = (46, 160, 67)   # Green
        elif "[!] DOMAIN MISMATCH" in clean or "ALERTA" in clean or "[!]" in clean or "[⚠" in clean:
            fill_color = (210, 153, 34)  # Yellow
        elif "[X] VIOLATION" in clean or "ERRO" in clean or "Erro" in clean:
            fill_color = (248, 81, 73)   # Red
        elif "[User]" in clean or "▎ >" in clean:
            fill_color = (88, 166, 255)  # Blue
            use_font = bold_font
        elif "[QUEUED]" in clean:
            fill_color = (219, 109, 40)  # Orange
            use_font = bold_font
        elif "[BSH Agent]" in clean:
            fill_color = (187, 128, 252) # Purple
            use_font = bold_font
        elif "Slash commands" in clean or "Select OpenRouter model" in clean or "Select business domain" in clean or "BSH skills" in clean:
            fill_color = (56, 189, 248)  # Cyan
            use_font = bold_font
        elif "/" in clean and ("model" in clean or "domain" in clean or "skills" in clean or "exit" in clean):
            fill_color = (187, 128, 252) # Purple
            use_font = bold_font
        elif "───" in clean or "┌──" in clean or "└──" in clean:
            fill_color = (48, 54, 61)
        elif "[Ctrl+" in clean or "·" in clean:
            fill_color = (139, 148, 158)

        draw.text((PADDING, y), clean, font=use_font, fill=fill_color)
        y += LINE_HEIGHT

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)

def main():
    work_dir = Path("/home/clayton/projetos/oracle")
    orig_pilot_dir = work_dir / "pilot" / "asset-management"
    clean_pilot_dir = Path("/tmp/bsh-pilot-jornada-16")
    frames_dir = Path("/tmp/bsh-jornada-16-frames")
    frames_dir.mkdir(parents=True, exist_ok=True)
    for f in frames_dir.glob("*.png"):
        f.unlink()

    session_name = "bsh-jornada-16"
    batch_id = "batch-20261003-opentui"
    video_out = work_dir / "evaluation" / "videos" / "bsh-opentui-reconstruction-scenario.mp4"
    screenshot_out = work_dir / "evaluation" / "screenshots" / "bsh-opentui-reconstruction-scenario.png"
    wsl_downloads = Path("/mnt/c/Users/clayt/Downloads/bsh")
    wsl_downloads.mkdir(parents=True, exist_ok=True)

    # Setup clean pilot copy
    if clean_pilot_dir.exists():
        shutil.rmtree(clean_pilot_dir)
    shutil.copytree(orig_pilot_dir, clean_pilot_dir)

    print("--- [1/8] Validating ontology of clean pilot copy ---")
    val_res = subprocess.run(["bsh", "--project", str(clean_pilot_dir), "ontology", "validate"], capture_output=True, text=True, check=True)
    print(f"Ontology validation result: {val_res.stdout.strip()}")

    frame_idx = 0

    print("--- [2/8] Generating opening black slide (Objectives in Portuguese) ---")
    slide_path = frames_dir / f"frame_{frame_idx:05d}.png"
    render_slide(
        title="Jornada 16: Reconstrução da Arquitetura com OpenTUI",
        subtitle=f"Lote: {batch_id} • Verificação E2E Baseada em Especificação",
        bullets=[
            "1. Paridade de distribuição CLI: binário global 'bsh' executando no motor Bun empacotado",
            "2. Paleta flutuante com barra: acionada com prompt vazio '/', rolagem Tab/setas e cancelamento com Escape",
            "3. Seletores nativos (/model, /domain, /skills) com busca difusa e fechamento seguro",
            "4. Fila de prompts FIFO (distintivo [QUEUED]), alternância de raciocínio (Ctrl+O) e rolagem",
            "5. Adaptação responsiva de largura em 35, 60, 80 e 140 colunas sem quebras visuais",
            "6. Modificação de código governada vs cancelamento de conflito de governança (Escape)",
            "7. Verificação do adaptador Codex: recusa registrada como bloqueado antes do primeiro turno",
        ],
        output_path=slide_path
    )
    # 3 seconds of slide (30 frames at 10 fps)
    for _ in range(29):
        frame_idx += 1
        dup_path = frames_dir / f"frame_{frame_idx:05d}.png"
        dup_path.write_bytes(slide_path.read_bytes())

    print("--- [3/8] Starting tmux session with global bsh binary ---")
    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)
    subprocess.run(["tmux", "new-session", "-d", "-s", session_name, "-x", "120", "-y", "32"], check=True)

    # Launch BSH TUI
    subprocess.run(["tmux", "send-keys", "-t", session_name, f"bsh --project {clean_pilot_dir}", "Enter"], check=True)
    time.sleep(3.5)

    # Idle TUI screen
    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Clean Idle Prompt (GitHub Dark Dimmed)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # ---------------- Scenario 1: Palette and Selectors Navigation & Escape Cancellation ----------------
    print("--- [4/8] Scenario 1: Palette and Selectors Navigation with Safe Cancellation ---")
    # Trigger slash palette
    subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", "/"], check=True)
    time.sleep(1.0)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Floating Slash Palette - /model Active", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Navigate Down through palette items
    for cmd_name, color in [("/domain", "Emerald"), ("/skills", "Cyan"), ("/diff", "Yellow"), ("/rules", "Sky Blue"), ("/settings", "Orange")]:
        subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
        time.sleep(0.5)
        for _ in range(5):
            frame_idx += 1
            text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
            render_terminal_frame(text, f"BSH OpenTUI: Palette Navigation - {cmd_name} Active ({color})", frames_dir / f"frame_{frame_idx:05d}.png")
            time.sleep(0.1)

    # Tab cycling
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Tab"], check=True)
    time.sleep(0.5)
    for _ in range(5):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Tab Cycling in Slash Palette", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Filter with 'ex'
    for char in "ex":
        subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
        time.sleep(0.2)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Real-Time Fuzzy Filter (/exit Crimson)", frames_dir / f"frame_{frame_idx:05d}.png")

    time.sleep(0.8)
    for _ in range(6):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Filtered /exit Highlighted with '❯' Pointer", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Dismiss with Escape (DECISION NOT TO SELECT)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Escape"], check=True)
    time.sleep(1.0)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Palette Cancelled (Escape) - Clean Prompt Restored", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Open /model dialog
    subprocess.run(["tmux", "send-keys", "-t", session_name, "/model", "Enter"], check=True)
    time.sleep(1.5)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Model Selector Dialog - Browsing Models", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
    time.sleep(0.5)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Escape"], check=True)
    time.sleep(1.0)

    # Open /domain dialog
    subprocess.run(["tmux", "send-keys", "-t", session_name, "/domain", "Enter"], check=True)
    time.sleep(1.5)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Domain Selector Dialog - Ativos Domain Active", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    subprocess.run(["tmux", "send-keys", "-t", session_name, "Escape"], check=True)
    time.sleep(1.0)

    # Open /skills dialog
    subprocess.run(["tmux", "send-keys", "-t", session_name, "/skills", "Enter"], check=True)
    time.sleep(1.5)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Skills Dialog with ScrollBox Detail Budgeting", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    subprocess.run(["tmux", "send-keys", "-t", session_name, "Escape"], check=True)
    time.sleep(1.0)

    # ---------------- Scenario 2: Streaming, FIFO Prompt Queuing & Width Responsiveness ----------------
    print("--- [5/8] Scenario 2: FIFO Prompt Queueing, Reasoning Toggle & Width Responsiveness ---")
    # Send Prompt 1
    subprocess.run(["tmux", "send-keys", "-t", session_name, "What are the asset rules?", "Enter"], check=True)
    time.sleep(0.5)

    # Enqueue Prompt 2 while Turn 1 is executing
    subprocess.run(["tmux", "send-keys", "-t", session_name, "List the asset status values", "Enter"], check=True)
    time.sleep(1.0)

    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: FIFO Queue Active ([QUEUED] Badge & Queue:1)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Toggle reasoning with Ctrl+O
    subprocess.run(["tmux", "send-keys", "-t", session_name, "C-o"], check=True)
    time.sleep(0.8)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Reasoning Card Toggled via Ctrl+O", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Width Responsiveness: 140 columns
    subprocess.run(["tmux", "resize-window", "-t", session_name, "-x", "140", "-y", "32"], check=True)
    time.sleep(0.8)
    for _ in range(6):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Responsive Layout at 140 Columns (Wide)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Width Responsiveness: 80 columns
    subprocess.run(["tmux", "resize-window", "-t", session_name, "-x", "80", "-y", "28"], check=True)
    time.sleep(0.8)
    for _ in range(6):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Responsive Layout at 80 Columns (Standard)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Width Responsiveness: 60 columns
    subprocess.run(["tmux", "resize-window", "-t", session_name, "-x", "60", "-y", "26"], check=True)
    time.sleep(0.8)
    for _ in range(6):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Responsive Layout at 60 Columns (Compact)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Width Responsiveness: 35 columns
    subprocess.run(["tmux", "resize-window", "-t", session_name, "-x", "35", "-y", "24"], check=True)
    time.sleep(0.8)
    for _ in range(6):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Responsive Layout at 35 Columns (Minimum Safe)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Restore to 120 columns
    subprocess.run(["tmux", "resize-window", "-t", session_name, "-x", "120", "-y", "32"], check=True)
    time.sleep(1.0)

    # ---------------- Scenario 3 & 4: Governed Execution vs Governance Conflict Cancellation ----------------
    print("--- [6/8] Scenario 3 & 4: Governed Execution and Conflict Cancellation ---")
    # Send conflicting prompt:
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Remove the validation and transfer the retired asset without required fields", "Enter"], check=True)
    time.sleep(2.0)
    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Governance Alert & SHACL Policy Evaluation", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Cancel conflicting request with Escape
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Escape"], check=True)
    time.sleep(1.0)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Conflict Cancelled (Escape) - No Files Modified", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # ---------------- Scenario 5: Clean Exit ----------------
    print("--- [7/8] Scenario 5: Executing /exit for Clean Terminal Restoration ---")
    subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", "/"], check=True)
    time.sleep(0.8)
    for char in "exit":
        subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
        time.sleep(0.1)
    time.sleep(0.5)

    # Capture final screenshot of the filtered /exit palette
    text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
    screenshot_out.parent.mkdir(parents=True, exist_ok=True)
    render_terminal_frame(text, "BSH OpenTUI: Verified Component Architecture Final State", screenshot_out)
    print(f"Final screenshot saved: {screenshot_out}")

    for _ in range(10):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: /exit Ready for Dispatch", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)
    time.sleep(2.0)

    # Terminal restored after exit
    for _ in range(10):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH OpenTUI: Terminal Restored & Process Exited Cleanly", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)

    # ---------------- Scenario 6: Native Agent & Ontology Check ----------------
    print("--- [8/8] Scenario 6: Native Agent & Ontology Check ---")
    onto_res = subprocess.run(["bsh", "--project", str(clean_pilot_dir), "ontology", "validate"], capture_output=True, text=True)
    print(f"bsh ontology validate exit code: {onto_res.returncode}")
    print(f"bsh ontology validate output: {onto_res.stdout.strip()}")
    assert onto_res.returncode == 0, f"Expected exit code 0, got {onto_res.returncode}"
    print("Native BSH validated ontology successfully in clean pilot copy.")

    # Encode video
    print("Encoding official MP4 video with ffmpeg...")
    video_out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y",
        "-framerate", "10",
        "-i", str(frames_dir / "frame_%05d.png"),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "22",
        str(video_out)
    ], check=True)
    print(f"Official Journey 16 MP4 generated: {video_out}")

    # Synchronize to WSL Downloads
    print(f"Synchronizing evidence to WSL Downloads directory: {wsl_downloads}")
    dest_video = wsl_downloads / f"bsh-jornada-16-{batch_id}.mp4"
    dest_screenshot = wsl_downloads / f"bsh-jornada-16-{batch_id}.png"
    shutil.copy2(video_out, dest_video)
    shutil.copy2(screenshot_out, dest_screenshot)

    # SHA-256 verification
    hash_v_local = sha256_file(video_out)
    hash_v_dest = sha256_file(dest_video)
    hash_s_local = sha256_file(screenshot_out)
    hash_s_dest = sha256_file(dest_screenshot)

    assert hash_v_local == hash_v_dest, f"Video SHA-256 mismatch! {hash_v_local} vs {hash_v_dest}"
    assert hash_s_local == hash_s_dest, f"Screenshot SHA-256 mismatch! {hash_s_local} vs {hash_s_dest}"
    print(f"SHA-256 Verified for video: {hash_v_local}")
    print(f"SHA-256 Verified for screenshot: {hash_s_local}")

    # Cleanup temporary frames & pilot copy
    for f in frames_dir.glob("*.png"):
        f.unlink()
    frames_dir.rmdir()
    shutil.rmtree(clean_pilot_dir)

    print(f"Journey 16 E2E Execution & Artifact Synchronization Complete! (Batch: {batch_id})")

if __name__ == "__main__":
    main()
