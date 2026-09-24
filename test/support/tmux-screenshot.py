#!/usr/bin/env python3
"""Captura uma sessão tmux em texto e em PNG para evidência de testes."""
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_SIZE = 15
LINE_HEIGHT = 19
PADDING = 18
BACKGROUND = (24, 26, 31)
FOREGROUND = (212, 214, 220)
TITLE_COLOR = (120, 200, 255)


def capture(session: str, scrollback: int) -> str:
    result = subprocess.run(
        ["tmux", "capture-pane", "-t", session, "-p", "-S", f"-{scrollback}"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.rstrip("\n")


def render(text: str, title: str, output: Path) -> None:
    font = ImageFont.truetype(MONO, FONT_SIZE)
    title_font = ImageFont.truetype(MONO, FONT_SIZE + 1)
    lines = text.split("\n")
    columns = max((len(line) for line in lines), default=1)
    width = PADDING * 2 + columns * (FONT_SIZE // 2 + 1) + 4
    height = PADDING * 3 + (len(lines) + 1) * LINE_HEIGHT + 8
    image = Image.new("RGB", (max(width, 320), max(height, 120)), BACKGROUND)
    draw = ImageDraw.Draw(image)
    draw.text((PADDING, PADDING), title, font=title_font, fill=TITLE_COLOR)
    y = PADDING * 2 + LINE_HEIGHT
    for line in lines:
        draw.text((PADDING, y), line, font=font, fill=FOREGROUND)
        y += LINE_HEIGHT
    image.save(output)


def main() -> int:
    if len(sys.argv) < 3:
        print("uso: tmux-screenshot.py <sessao> <caminho-base> [scrollback]", file=sys.stderr)
        return 2
    session = sys.argv[1]
    base = Path(sys.argv[2])
    scrollback = int(sys.argv[3]) if len(sys.argv) > 3 else 400
    base.parent.mkdir(parents=True, exist_ok=True)
    text = capture(session, scrollback)
    base.with_suffix(".txt").write_text(text + "\n", encoding="utf-8")
    render(text, f"tmux: {session}", base.with_suffix(".png"))
    print(f"{base.with_suffix('.txt')}")
    print(f"{base.with_suffix('.png')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())