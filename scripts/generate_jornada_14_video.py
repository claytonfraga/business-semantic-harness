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
    draw.rectangle([(80, 90), (450, 122)], fill=(30, 41, 59))
    draw.text((95, 96), "BSH SPEC-DRIVEN MULTI-TURN E2E TEST", font=badge_font, fill=(56, 189, 248))

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
    draw.text((80, height - 52), "Oracle BSH (Business Semantic Harness) • Multi-Turn Skill Lifecycle & Verification", font=sub_font, fill=(100, 116, 139))

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
        elif "[Skill:" in clean or "Skill ativada:" in clean or "Skill:" in clean or "[⚡ ACTIVE]" in clean:
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
    frames_dir = Path("/tmp/bsh-jornada-14-frames")
    frames_dir.mkdir(parents=True, exist_ok=True)
    for f in frames_dir.glob("*.png"):
        f.unlink()

    session_name = "bsh-jornada-14-multiturn"
    video_out = work_dir / "evaluation" / "videos" / "bsh-skills-dynamic-inclusion.mp4"
    screenshot_out = work_dir / "evaluation" / "screenshots" / "bsh-skills-dynamic-inclusion.png"
    wsl_downloads = Path("/mnt/c/Users/clayt/Downloads/bsh")
    wsl_downloads.mkdir(parents=True, exist_ok=True)

    frame_idx = 0

    print("--- [1/6] Gerando slide de abertura com foco no Loop Interativo Multi-Turno ---")
    slide_path = frames_dir / f"frame_{frame_idx:05d}.png"
    render_slide(
        title="Jornada 14: Loop Interativo Multi-Turno com Skills no BSH",
        subtitle="Verificação E2E de Persistência de Contexto, Diálogo e Refinamento de Skill",
        bullets=[
            "1. Descoberta e inspeção formal de diretrizes da skill 'prototype' (.agents/skills)",
            "2. Ativação contextual dinâmica na TUI com indicador permanente [⚡ ACTIVE]",
            "3. Turno 1 (Criação): /prototype gera máquina de estados HTML interativa inicial",
            "4. Turno 2 (Refinamento no Loop): Feedback do usuário adiciona estado REJECTED e SHACL",
            "5. Turno 3 (Fechamento): Validação no Semantic Gate e conclusão formal via /skill done",
        ],
        output_path=slide_path
    )
    # 3 seconds of slide (30 frames at 10 fps)
    for _ in range(29):
        frame_idx += 1
        dup_path = frames_dir / f"frame_{frame_idx:05d}.png"
        dup_path.write_bytes(slide_path.read_bytes())

    print("--- [2/6] Iniciando sessão tmux do BSH ---")
    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)
    subprocess.run(["tmux", "new-session", "-d", "-s", session_name, "-x", "120", "-y", "32"], check=True)

    # CLI Discovery Check
    subprocess.run(["tmux", "send-keys", "-t", session_name, f"cd {work_dir} && bsh skill list | head -n 14", "Enter"], check=True)
    time.sleep(1.5)
    for _ in range(12):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH CLI: Listagem de Skills Descobertas", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Launch BSH TUI
    subprocess.run(["tmux", "send-keys", "-t", session_name, f"bsh --project {pilot_dir}", "Enter"], check=True)
    time.sleep(4.0)

    for _ in range(10):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Sessão Interativa Governada (Asset Management)", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # ---------------- TURNO 1: Invocação Inicial da Skill ----------------
    prompt_1 = "/prototype Criar protótipo HTML da máquina de estados de transição de ativos"
    print(f"--- [3/6] Turno 1 (Invocação Inicial): {prompt_1} ---")
    for char in prompt_1:
        subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
        time.sleep(0.02)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Digitando Invocação Slash (/prototype)", frames_dir / f"frame_{frame_idx:05d}.png")

    time.sleep(1.0)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)

    # Capture execution of Turn 1 (skill becomes active, header shows [⚡ ACTIVE])
    for _ in range(25):
        time.sleep(0.5)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Turno 1 - Geração Inicial sob Diretivas da Skill", frames_dir / f"frame_{frame_idx:05d}.png")

    # ---------------- TURNO 2: Diálogo & Refinamento no Loop da Skill ----------------
    prompt_2 = "Adicione o estado REJECTED com justificativa obrigatória e um botão de teste SHACL"
    print(f"--- [4/6] Turno 2 (Refinamento no Loop da Skill): {prompt_2} ---")
    time.sleep(1.0)
    for char in prompt_2:
        subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
        time.sleep(0.02)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Turno 2 - Enviando Refinamento Interativo no Loop da Skill", frames_dir / f"frame_{frame_idx:05d}.png")

    time.sleep(1.0)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)

    # Capture execution of Turn 2
    for _ in range(25):
        time.sleep(0.5)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Turno 2 - Refinando Protótipo sob a Skill 'prototype'", frames_dir / f"frame_{frame_idx:05d}.png")

    # ---------------- TURNO 3: Fechamento Formal com /skill done ----------------
    prompt_3 = "/skill done"
    print(f"--- [5/6] Turno 3 (Fechamento Formal do Loop): {prompt_3} ---")
    time.sleep(1.0)
    for char in prompt_3:
        subprocess.run(["tmux", "send-keys", "-t", session_name, "-l", char], check=True)
        time.sleep(0.04)
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Turno 3 - Concluindo Loop com /skill done", frames_dir / f"frame_{frame_idx:05d}.png")

    time.sleep(1.0)
    subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], check=True)
    time.sleep(2.0)

    for _ in range(15):
        frame_idx += 1
        text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
        render_terminal_frame(text, "BSH TUI: Turno 3 - Loop da Skill Concluído com Sucesso", frames_dir / f"frame_{frame_idx:05d}.png")
        time.sleep(0.1)

    # Final screenshot
    final_text = subprocess.run(["tmux", "capture-pane", "-t", session_name, "-p"], capture_output=True, text=True, check=True).stdout
    screenshot_out.parent.mkdir(parents=True, exist_ok=True)
    render_terminal_frame(final_text, "BSH TUI: Evidência Final do Loop Multi-Turno da Skill 'prototype'", screenshot_out)
    print(f"Screenshot final salva em: {screenshot_out}")

    # Hold final frame for 2 seconds
    final_frame = frames_dir / f"frame_{frame_idx:05d}.png"
    for _ in range(20):
        frame_idx += 1
        dup = frames_dir / f"frame_{frame_idx:05d}.png"
        dup.write_bytes(final_frame.read_bytes())

    # Exit cleanly
    subprocess.run(["tmux", "send-keys", "-t", session_name, "/exit", "Enter"], check=True)
    time.sleep(1.0)
    subprocess.run(["tmux", "kill-session", "-t", session_name], stderr=subprocess.DEVNULL)

    # Step 6: Encode video with ffmpeg
    print("--- [6/6] Codificando vídeo oficial com ffmpeg ---")
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
    print(f"Vídeo multi-turno gerado com sucesso: {video_out}")

    # Step 7: Sync with WSL Downloads
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
