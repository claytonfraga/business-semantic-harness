export const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Bright
  brightBlue: '\x1b[94m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightRed: '\x1b[91m',

  // Backgrounds
  bgBlue: '\x1b[44m',
  bgDark: '\x1b[48;5;236m',
  bgGray: '\x1b[48;5;238m',

  // Cursor & Screen
  clearScreen: '\x1b[2J\x1b[H',
  clearLine: '\x1b[2K\r',
  cursorUp: (n = 1) => `\x1b[${n}A`,
  cursorDown: (n = 1) => `\x1b[${n}B`,
  cursorTo: (x: number, y: number) => `\x1b[${y};${x}H`,
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
};

export function stripAnsi(str: string): string {
  let res = '';
  let inEscape = false;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 27) {
      inEscape = true;
      continue;
    }
    if (inEscape) {
      if (str[i] === 'm') {
        inEscape = false;
      }
      continue;
    }
    res += str[i];
  }
  return res;
}

export function box(title: string, lines: string[], width = 80): string {
  const horizontal = '─'.repeat(Math.max(0, width - 2));
  const top = `┌─ ${ansi.bold}${title}${ansi.reset} ${'─'.repeat(Math.max(0, width - title.length - 5))}┐`;
  const bottom = `└${horizontal}┘`;
  const formattedLines = lines.map((l) => {
    const rawLen = stripAnsi(l).length;
    const pad = ' '.repeat(Math.max(0, width - rawLen - 4));
    return `│ ${l}${pad} │`;
  });
  return [top, ...formattedLines, bottom].join('\n');
}

