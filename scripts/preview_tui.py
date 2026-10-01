#!/usr/bin/env python3
import subprocess
import time
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MONO_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_SIZE = 14
LINE_HEIGHT = 18
PADDING = 16
BG_COLOR = (15, 23, 42)       # Slate 900
TEXT_COLOR = (241, 245, 249)  # Slate 100

ANSI_REGEX = re.compile(r'\x1b\[[0-9;?]*[a-zA-Z]')

def clean_terminal_text(text: str) -> str:
    return ANSI_REGEX.sub('', text)

def render_terminal_frame(text: str, title: str, output_path: Path, width: int = 1280, height: int = 720) -> None:
    img = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(MONO_FONT, FONT_SIZE)
    bold_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", FONT_SIZE)
    header_font = ImageFont.truetype(MONO_FONT, 13)

    # Top title bar
    draw.rectangle([(0, 0), (width, 36)], fill=(30, 41, 59))
    draw.text((PADDING, 10), title, font=header_font, fill=(56, 189, 248))

    raw_lines = text.split("\n")
    y = 48
    for line in raw_lines:
        clean = clean_terminal_text(line)
        if not clean.strip():
            y += LINE_HEIGHT
            continue

        # Color syntax rules inspired by image.png
        fill_color = TEXT_COLOR
        use_font = font

        if "[*] GOVERNED" in clean or "[OK] CONFORMING" in clean or "[+]" in clean:
            fill_color = (34, 197, 94)  # Emerald 500
        elif "[!] DOMAIN MISMATCH" in clean or "[!] [Semantic Domain Alert]" in clean or "[!] mismatch" in clean:
            fill_color = (250, 204, 21) # Amber 400
        elif "[X] VIOLATION" in clean or "Promotion blocked" in clean:
            fill_color = (248, 113, 113) # Red 400
        elif "> [User]" in clean or "▎ >" in clean:
            fill_color = (56, 189, 248) # Sky 400
            use_font = bold_font
        elif "[BSH Agent]" in clean:
            fill_color = (192, 132, 252) # Purple 400
            use_font = bold_font
        elif ">_ Tool:" in clean:
            fill_color = (251, 191, 36) # Amber 300
        elif "->" in clean and "Status" not in clean:
            fill_color = (74, 222, 128) # Green 400
        elif "───" in clean or "───" in line:
            fill_color = (71, 85, 105)  # Slate 600
        elif "[Ctrl+" in clean or "git(" in clean or "·" in clean:
            fill_color = (148, 163, 184) # Slate 400

        draw.text((PADDING, y), clean, font=use_font, fill=fill_color)
        y += LINE_HEIGHT

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)

def main():
    session = "bsh-tui-preview"
    subprocess.run(["tmux", "kill-session", "-t", session], stderr=subprocess.DEVNULL)
    
    # 120 cols x 32 rows terminal
    subprocess.run(["tmux", "new-session", "-d", "-s", session, "-x", "120", "-y", "32"], check=True)
    
    pilot_dir = "/home/clayton/projetos/oracle/pilot/asset-management"
    subprocess.run(["tmux", "send-keys", "-t", session, f"bsh --project {pilot_dir}", "Enter"], check=True)
    
    # Wait for bsh initialization and alternate buffer switch
    time.sleep(5.0)
    
    # Type user prompt interactively so it appears in the prompt box
    prompt = "Transfer retired asset AST-002 to Maintenance department without justification"
    for char in prompt:
        subprocess.run(["tmux", "send-keys", "-t", session, "-l", char], check=True)
        time.sleep(0.03)
    time.sleep(2.0)
    
    # Capture pane with the prompt actively typed in the prompt box
    text_typing = subprocess.run(["tmux", "capture-pane", "-t", session, "-p"], capture_output=True, text=True, check=True).stdout
    out_typing = Path("/home/clayton/projetos/oracle/screenshots/bsh-tui-live-prompt-typing.png")
    render_terminal_frame(text_typing, "BSH TUI: Live User Prompt Box & Responsive Rich Footer", out_typing)
    print(f"Captured typing preview: {out_typing}")
    
    # Press Enter to run prompt and see gate verdict
    subprocess.run(["tmux", "send-keys", "-t", session, "Enter"], check=True)
    time.sleep(12.0)
    
    text_verdict = subprocess.run(["tmux", "capture-pane", "-t", session, "-p"], capture_output=True, text=True, check=True).stdout
    out_verdict = Path("/home/clayton/projetos/oracle/screenshots/bsh-tui-live-preview.png")
    render_terminal_frame(text_verdict, "BSH TUI: Semantic Gate Evaluation & Responsive Footer", out_verdict)
    print(f"Captured verdict preview: {out_verdict}")
    
    # Clean exit
    subprocess.run(["tmux", "send-keys", "-t", session, "/exit", "Enter"], check=True)
    time.sleep(1.0)
    subprocess.run(["tmux", "kill-session", "-t", session], stderr=subprocess.DEVNULL)

if __name__ == "__main__":
    main()
