import { ansi, stripAnsi } from './ansi.js';

export interface RenderState {
  model: string;
  contextLength?: number;
  domain?: string;
  governed: boolean;
  tokensTotal: number;
  sessionCost?: number;
  width?: number;
  height?: number;
  scrollOffset?: number;
}

export interface GateCheckItem {
  ok: boolean;
  text: string;
}

export interface ChatEntry {
  type: 'user' | 'agent' | 'tool' | 'tool_result' | 'gate' | 'blank';
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown> | string;
  gateShape?: string;
  gateChecks?: GateCheckItem[];
  gateStatus?: 'CONFORMING' | 'VIOLATION';
}

export function formatContextLength(ctx?: number): string {
  if (!ctx) return '128k ctx';
  if (ctx >= 1024 * 1024) return `${(ctx / (1024 * 1024)).toFixed(0)}M ctx`;
  return `${Math.round(ctx / 1024)}k ctx`;
}

/**
 * Word-wraps text preserving ANSI color codes so content flows naturally inside terminal borders.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim()) {
      lines.push('');
      continue;
    }

    const words = rawLine.split(' ');
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (stripAnsi(candidate).length <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Frames a line within vertical borders: │ <text> <pad> │
 */
export function boxedLine(text: string, width: number): string {
  const interior = Math.max(10, width - 4);
  const visible = stripAnsi(text);

  if (visible.length > interior) {
    const truncated = `${text.slice(0, interior - 3)}...`;
    const pad = ' '.repeat(Math.max(0, interior - stripAnsi(truncated).length));
    return `│ ${truncated}${pad} │`;
  }

  const pad = ' '.repeat(Math.max(0, interior - visible.length));
  return `│ ${text}${pad} │`;
}

export function formatToolInvocation(name: string, args: Record<string, unknown> | string): string {
  if (typeof args === 'string') {
    return `${name}("${args}")`;
  }

  switch (name) {
    case 'read_file':
      return `read_file("${String(args.path || '')}")`;
    case 'write_file':
      return `write_file("${String(args.path || '')}")`;
    case 'replace_file_content':
      return `replace_file_content("${String(args.path || '')}")`;
    case 'list_directory':
      return `list_directory("${String(args.path || '.')}")`;
    case 'run_bash_command': {
      const cmd = String(args.command || '');
      const brief = cmd.length > 55 ? `${cmd.slice(0, 52)}...` : cmd;
      return `run_bash("${brief}")`;
    }
    default:
      return `${name}(${JSON.stringify(args).slice(0, 50)})`;
  }
}

export function renderHeader(state: RenderState, width: number): string {
  const logo = `${ansi.bold}${ansi.brightBlue}BSH${ansi.reset} ${ansi.dim}[Business Semantic Harness]${ansi.reset}`;
  const statusBadge = state.governed
    ? `${ansi.bold}${ansi.brightGreen}[● GOVERNED]${ansi.reset}`
    : `${ansi.bold}${ansi.yellow}[○ UNGOVERNED]${ansi.reset}`;

  const visibleLogo = 'BSH [Business Semantic Harness]';
  const visibleStatus = state.governed ? '[● GOVERNED]' : '[○ UNGOVERNED]';
  const fixedChars = 3 + visibleLogo.length + 1 + 1 + visibleStatus.length + 3;
  const topBorderLen = Math.max(2, width - fixedChars);
  const firstLine = `┌─ ${logo} ${'─'.repeat(topBorderLen)} ${statusBadge} ─┐`;

  const ctxStr = state.contextLength ? ` (${formatContextLength(state.contextLength)})` : ' (128k ctx)';
  const modelStr = `${state.model}${ctxStr}`;

  const domainStr = state.domain
    ? `${ansi.brightGreen}${state.domain}${ansi.reset} ${ansi.dim}(SHACL active)${ansi.reset}`
    : `${ansi.yellow}none${ansi.reset} ${ansi.dim}(inactive)${ansi.reset}`;

  const tokensStr = state.tokensTotal.toLocaleString();
  const costStr = state.sessionCost !== undefined ? ` ($${state.sessionCost.toFixed(4)})` : '';
  const infoLine = `Model: ${ansi.cyan}${modelStr}${ansi.reset}   Domain: ${domainStr}   Tokens: ${tokensStr}${costStr}`;
  const secondLine = boxedLine(infoLine, width);
  const separator = `├${'─'.repeat(Math.max(0, width - 2))}┤`;

  return [firstLine, secondLine, separator].join('\n');
}

export function renderChatEntry(entry: ChatEntry, width: number): string[] {
  const lines: string[] = [];
  const interior = Math.max(10, width - 4);

  switch (entry.type) {
    case 'blank':
      lines.push(boxedLine('', width));
      break;

    case 'user': {
      const wrapped = wrapText(entry.content || '', interior - 8);
      lines.push(boxedLine(`${ansi.bold}[User]${ansi.reset} ${wrapped[0] || ''}`, width));
      for (let i = 1; i < wrapped.length; i++) {
        lines.push(boxedLine(`       ${wrapped[i]}`, width));
      }
      lines.push(boxedLine('', width));
      break;
    }

    case 'agent': {
      lines.push(boxedLine(`${ansi.bold}${ansi.cyan}[BSH Agent]${ansi.reset}`, width));
      for (const rawLine of (entry.content || '').split('\n')) {
        const wrapped = wrapText(rawLine, interior);
        for (const w of wrapped) {
          lines.push(boxedLine(w, width));
        }
      }
      lines.push(boxedLine('', width));
      break;
    }

    case 'tool': {
      const inv = formatToolInvocation(entry.toolName || '', entry.toolArgs || {});
      lines.push(boxedLine(`${ansi.yellow}⚙ Tool:${ansi.reset} ${ansi.bold}${inv}${ansi.reset}`, width));
      break;
    }

    case 'tool_result': {
      lines.push(boxedLine(`${ansi.green}↳${ansi.reset} ${entry.content || ''}`, width));
      lines.push(boxedLine('', width));
      break;
    }

    case 'gate': {
      const isViolation = entry.gateStatus === 'VIOLATION';
      const shape = entry.gateShape || 'TransferShape';
      const title = `${ansi.bold}${isViolation ? `${ansi.brightRed}🚨 Semantic Gate` : `${ansi.brightCyan}🛡️  Semantic Gate`}${ansi.reset} ${ansi.dim}[Evaluating SHACL constraints: ${ansi.reset}${ansi.bold}${shape}${ansi.reset}${ansi.dim}]${ansi.reset}`;
      const badge = isViolation
        ? `${ansi.bold}${ansi.brightRed}[✖ VIOLATION]${ansi.reset}`
        : `${ansi.bold}${ansi.brightGreen}[● CONFORMING]${ansi.reset}`;

      const topPrefix = `┌─ ${title} `;
      const topSuffix = ` ${badge} ─┐`;
      const dashCount = Math.max(2, interior - stripAnsi(topPrefix).length - stripAnsi(topSuffix).length);
      const topBorder = `┌─ ${title} ${ansi.dim}${'─'.repeat(dashCount)}${ansi.reset} ${badge} ─┐`;

      lines.push(boxedLine(topBorder, width));

      const innerContentWidth = Math.max(4, interior - 4);

      if (entry.gateChecks && entry.gateChecks.length > 0) {
        for (const check of entry.gateChecks) {
          const icon = check.ok ? `${ansi.brightGreen}✔${ansi.reset}` : `${ansi.brightRed}✖${ansi.reset}`;
          const text = `  ${icon} ${check.text}`;
          const visible = stripAnsi(text);
          if (visible.length > innerContentWidth) {
            const truncated = `${text.slice(0, innerContentWidth - 3)}...`;
            const pad = ' '.repeat(Math.max(0, innerContentWidth - stripAnsi(truncated).length));
            lines.push(boxedLine(`│ ${truncated}${pad} │`, width));
          } else {
            const pad = ' '.repeat(Math.max(0, innerContentWidth - visible.length));
            lines.push(boxedLine(`│ ${text}${pad} │`, width));
          }
        }
      }

      const statusText = isViolation
        ? `  ${ansi.bold}${ansi.brightRed}→ Status: VIOLATION (Promotion blocked)${ansi.reset}`
        : `  ${ansi.bold}${ansi.brightGreen}→ Status: CONFORMING (Ready to promote)${ansi.reset}`;
      const visibleStatus = stripAnsi(statusText);
      const statusPad = ' '.repeat(Math.max(0, innerContentWidth - visibleStatus.length));
      lines.push(boxedLine(`│ ${statusText}${statusPad} │`, width));

      const bottomBorder = `└${ansi.dim}${'─'.repeat(Math.max(2, interior - 2))}${ansi.reset}┘`;
      lines.push(boxedLine(bottomBorder, width));
      lines.push(boxedLine('', width));
      break;
    }
  }

  return lines;
}

export function renderCompleteTui(
  state: RenderState,
  entries: ChatEntry[],
  currentPrompt = '[Type your prompt here...]',
  customWidth?: number,
  customHeight?: number
): string {
  const terminalCols = process.stdout.columns && process.stdout.columns > 50 ? process.stdout.columns : 96;
  const terminalRows = process.stdout.rows && process.stdout.rows >= 15 ? process.stdout.rows : 30;

  const width = Math.min(120, Math.max(85, customWidth || state.width || terminalCols));
  const height = Math.max(15, customHeight || state.height || terminalRows);

  const header = renderHeader(state, width);
  const headerLinesCount = 3;
  const footerLinesCount = 4;
  const chromeCount = headerLinesCount + footerLinesCount;
  const viewportHeight = Math.max(4, height - chromeCount);

  // Render all conversation entries into lines
  const allContentLines: string[] = [];
  if (entries.length === 0) {
    allContentLines.push(boxedLine('', width));
  } else {
    for (const e of entries) {
      allContentLines.push(...renderChatEntry(e, width));
    }
  }

  // Calculate scrolled viewport window
  const totalContent = allContentLines.length;
  const maxScroll = Math.max(0, totalContent - viewportHeight);
  const scrollOffset = Math.max(0, Math.min(maxScroll, state.scrollOffset || 0));

  let viewportLines: string[] = [];
  if (totalContent <= viewportHeight) {
    viewportLines = [...allContentLines];
    while (viewportLines.length < viewportHeight) {
      viewportLines.push(boxedLine('', width));
    }
  } else {
    const endIndex = totalContent - scrollOffset;
    const startIndex = Math.max(0, endIndex - viewportHeight);
    viewportLines = allContentLines.slice(startIndex, endIndex);
    while (viewportLines.length < viewportHeight) {
      viewportLines.unshift(boxedLine('', width));
    }
  }

  const promptLine = boxedLine(`${ansi.bold}> ${ansi.reset}${currentPrompt}`, width);
  const scrollIndicator = scrollOffset > 0 ? ` ${ansi.yellow}[▲ Scroll: +${scrollOffset}]${ansi.reset}` : '';
  const shortcuts = `${ansi.bold}[Ctrl+M]${ansi.reset} Model  ${ansi.bold}[Ctrl+D]${ansi.reset} Domain/SHACL  ${ansi.bold}[Ctrl+G]${ansi.reset} Diff/Gate  ${ansi.bold}[Ctrl+C]${ansi.reset} Exit${scrollIndicator}`;
  const shortcutsLine = boxedLine(shortcuts, width);
  const separator = `├${'─'.repeat(Math.max(0, width - 2))}┤`;
  const bottom = `└${'─'.repeat(Math.max(0, width - 2))}┘`;

  return [header, ...viewportLines, separator, promptLine, shortcutsLine, bottom].join('\n');
}
