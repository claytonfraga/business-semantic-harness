#!/usr/bin/env python3
import os
import sys
import time
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
BG_COLOR = (13, 17, 23)        # GitHub Dark theme
TEXT_COLOR = (230, 237, 243)

ANSI_REGEX = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')

def clean_terminal_text(text: str) -> str:
    return ANSI_REGEX.sub('', text)

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
    draw.rectangle([(80, 90), (460, 122)], fill=(30, 41, 59))
    draw.text((95, 96), "BSH SPEC-DRIVEN E2E TEST - JORNADA 15", font=badge_font, fill=(56, 189, 248))

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
    draw.text((80, height - 52), "Oracle BSH (Business Semantic Harness) • Slash Commands Menu & Discovery", font=sub_font, fill=(100, 116, 139))

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

        if "[*] GOVERNED" in clean or "[OK]" in clean or "[+]" in clean or "✔" in clean:
            fill_color = (46, 160, 67)   # Green
        elif "[!] DOMAIN MISMATCH" in clean or "ALERTA" in clean or "[!]" in clean:
            fill_color = (210, 153, 34)  # Yellow
        elif "[X] VIOLATION" in clean or "ERRO" in clean or "Erro" in clean:
            fill_color = (248, 81, 73)   # Red
        elif "> [User]" in clean or "▎ >" in clean:
            fill_color = (88, 166, 255)  # Blue
            use_font = bold_font
        elif "Menu de Comandos" in clean or "Slash Commands" in clean:
            fill_color = (56, 189, 248)  # Cyan
            use_font = bold_font
        elif "/" in clean and ("model" in clean or "domain" in clean or "skills" in clean or "exit" in clean):
            fill_color = (187, 128, 252) # Purple
            use_font = bold_font
        elif "───" in clean:
            fill_color = (48, 54, 61)
        elif "[Ctrl+" in clean or "·" in clean:
            fill_color = (139, 148, 158)

        draw.text((PADDING, y), clean, font=use_font, fill=fill_color)
        y += LINE_HEIGHT

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)

def main():
    work_dir = Path("/home/clayton/projetos/oracle")
    pilot_dir = work_dir / "pilot" / "asset-management"
    frames_dir = Path("/tmp/bsh-jornada-15-frames")
    frames_dir.mkdir(parents=True, exist_ok=True)
    for f in frames_dir.glob("*.png"):
        f.unlink()

    session_name = "bsh-jornada-15-slash"
    video_out = work_dir / "evaluation" / "videos" / "bsh-slash-commands-menu.mp4"
    screenshot_out = work_dir / "evaluation" / "screenshots" / "bsh-slash-commands-menu.png"
    wsl_downloads = Path("/mnt/c/Users/clayt/Downloads/bsh")
    wsl_downloads.mkdir(parents=True, exist_ok=True)

    frame_idx = 0

    print("--- [1/5] Generating opening black slide ---")
    slide_path = frames_dir / f"frame_{frame_idx:05d}.png"
    render_slide(
        title="Jornada 15: Paleta Flutuante de Comandos com Barra no OpenTUI",
        subtitle="Verificação E2E Baseada em Especificação (openspec/specs)",
        bullets=[
            "1. Acionamento estrito ao digitar '/' com o prompt vazio",
            "2. Paleta flutuante OpenTUI compacta (<=72 colunas) com rolagem por janela",
            "3. Navegação por setas com cor distinta e vibrante para cada comando ativo",
            "4. Decisão de NÃO SELECIONAR: pressionar Escape fecha a paleta com limpeza",
            "5. Filtragem em tempo real ('ex'), realce de caracteres e execução com Enter",
        ],
        output_path=slide_path
    )
    # 3 seconds of slide (30 frames at 10 fps)
    for _ in range(29):
        frame_idx += 1
        dup_path = frames_dir / f"frame_{frame_idx:05d}.png"
        dup_path.write_bytes(slide_path.read_bytes())

    print("--- [2/5] Starting tmux session with global bsh binary ---")
    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)
    subprocess.run(["tmux", "new-session", "-d", "-s", session_name, "-x", "120", "-y", "32"], check=True)

    # Launch BSH TUI
    subprocess.run(["tmux", "send-keys", "-t", session_name, f"bsh --project {pilot_dir}", "Enter"], check=True)
    time.sleep(4.0)

    # Idle TUI screen
    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Clean Idle Prompt Ready for Input", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # ---------------- Step 1: Type '/' in empty prompt ----------------
    print("--- [3/5] Typing '/' in empty prompt to open floating OpenTUI palette ---")
    subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", "/"], check=True)
    time.sleep(1.5)

    # Capture open menu modal with /model active (Magenta)
    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: OpenTUI Palette - /model Active (Magenta)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Navigate Down to /domain (Emerald Green)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
    time.sleep(0.8)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Navigation - /domain Active (Emerald Green)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Navigate Down to /skills (Electric Cyan)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
    time.sleep(0.8)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Navigation - /skills Active (Electric Cyan)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Navigate Down to /diff (Golden Yellow)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
    time.sleep(0.8)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Navigation - /diff Active (Golden Yellow)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Navigate Down to /rules (Sky Blue)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
    time.sleep(0.8)
    for _ in range(8):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Navigation - /rules Active (Sky Blue)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Navigate Down to /settings (Peach Orange) -> triggers window scroll to (2-6 of 14)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Down"], check=True)
    time.sleep(0.8)
    for _ in range(10):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Window Scroll (2-6 of 14) - /settings Active", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # ---------------- Step 2: Decision NOT TO SELECT (Escape) ----------------
    print("--- [4/5] Pressing Escape to dismiss palette without selecting ---")
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Escape"], check=True)
    time.sleep(1.5)
    for _ in range(10):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Palette Dismissed (Escape) - Clean Prompt Restored", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # ---------------- Step 3: Reopen and filter with 'ex' ----------------
    print("--- [5/5] Reopening with '/', filtering 'ex', and selecting /exit ---")
    subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", "/"], check=True)
    time.sleep(1.0)

    for char in "ex":
        subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
        time.sleep(0.1)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Real-Time Filtering (/exit Crimson)", frames_dir / f"frame_{frame_idx:05d}.png")

    time.sleep(1.5)
    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Filtered /exit Highlighted in Crimson", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Save screenshot of the filtered menu
    screenshot_out.parent.mkdir(parents=True, exist_ok=True)
    render_terminal_frame(text, "BSH TUI: OpenTUI Floating Slash Palette", screenshot_out)
    print(f"Screenshot final salva em: {screenshot_out}")

    # Confirm with Enter
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)
    time.sleep(2.0)

    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Execution of /exit and Clean Terminal Exit", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Hold final frame for 1.5 seconds
    final_frame = frames_dir / f"frame_{frame_idx:05d}.png"
    for _ in range(15):
        frame_idx += 1
        dup = frames_dir / f"frame_{frame_idx:05d}.png"
        dup.write_bytes(final_frame.read_bytes())

    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)

    # Encode video
    print("Codificando vídeo oficial com ffmpeg...")
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
    print(f"Vídeo da Jornada 15 gerado com sucesso: {video_out}")

    # Sync with WSL Downloads
    if wsl_downloads.exists():
        import shutil
        shutil.copy2(video_out, wsl_downloads / video_out.name)
        shutil.copy2(screenshot_out, wsl_downloads / screenshot_out.name)
        print(f"Vídeo e captura sincronizados com sucesso em: {wsl_downloads}")

    # Cleanup temporary frames
    for f in frames_dir.glob("*.png"):
        f.unlink()
    frames_dir.rmdir()
    print("Concluído!")

if __name__ == "__main__":
    main()
