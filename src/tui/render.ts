import { ansi, stripAnsi } from './ansi.js';

export interface RenderState {
  model: string;
  contextLength?: number;
  domain?: string;
  governed: boolean;
  tokensTotal: number;
  sessionCost?: number;
  width?: number;
}

export interface ChatEntry {
  type: 'user' | 'agent' | 'tool' | 'tool_result' | 'gate' | 'blank';
  content?: string;
  toolName?: string;
  toolArgs?: string;
  gateShape?: string;
  gateChecks?: Array<{ ok: boolean; text: string }>;
  gateStatus?: 'CONFORMING' | 'VIOLATION';
}

export function formatContextLength(ctx?: number): string {
  if (!ctx) return '128k ctx';
  if (ctx >= 1024 * 1024) return `${(ctx / (1024 * 1024)).toFixed(0)}M ctx`;
  return `${Math.round(ctx / 1024)}k ctx`;
}

export function boxedLine(text: string, width = 79): string {
  const visibleLen = stripAnsi(text).length;
  if (visibleLen > width - 4) {
    // Truncate if overflowing
    const truncated = text.slice(0, width - 7) + '...';
    const pad = ' '.repeat(Math.max(0, width - stripAnsi(truncated).length - 4));
    return `│ ${truncated}${pad} │`;
  }
  const pad = ' '.repeat(Math.max(0, width - visibleLen - 4));
  return `│ ${text}${pad} │`;
}

export function renderHeader(state: RenderState): string {
  const width = state.width || (process.stdout.columns && process.stdout.columns > 90 ? process.stdout.columns : 100);
  const logo = `${ansi.bold}${ansi.brightBlue}BSH${ansi.reset} ${ansi.dim}[Business Semantic Harness]${ansi.reset}`;
  const statusBadge = state.governed
    ? `${ansi.bold}${ansi.brightGreen}[● GOVERNED]${ansi.reset}`
    : `${ansi.bold}${ansi.yellow}[○ UNGOVERNED]${ansi.reset}`;

  const topBorderLen = Math.max(2, width - 52);
  const firstLine = `┌─ ${logo} ${'─'.repeat(topBorderLen)} ${statusBadge} ─┐`;

  const ctxStr = state.contextLength ? ` [${formatContextLength(state.contextLength)}]` : ' [128k ctx]';
  const modelStr = `${state.model}${ctxStr}`;

  const domainStr = state.domain
    ? `${ansi.green}${state.domain}${ansi.reset} ${ansi.dim}(SHACL active)${ansi.reset}`
    : `${ansi.dim}none${ansi.reset}`;

  const tokensStr = state.tokensTotal.toLocaleString();
  const infoLine = `Model: ${ansi.cyan}${modelStr}${ansi.reset}   Domain: ${domainStr}   Tokens: ${tokensStr}`;
  const secondLine = boxedLine(infoLine, width);
  const separator = `├${'─'.repeat(Math.max(0, width - 2))}┤`;

  return [firstLine, secondLine, separator].join('\n');
}

export function renderFooter(promptText = '[Type your prompt here...]', width = 96): string {
  const separator = `├${'─'.repeat(Math.max(0, width - 2))}┤`;
  const promptLine = boxedLine(`${ansi.bold}> ${ansi.reset}${promptText}`, width);
  const shortcuts = `${ansi.bold}[Ctrl+M]${ansi.reset} Model  ${ansi.bold}[Ctrl+D]${ansi.reset} Domain/SHACL  ${ansi.bold}[Ctrl+G]${ansi.reset} Diff/Gate  ${ansi.bold}[Ctrl+C]${ansi.reset} Exit`;
  const shortcutsLine = boxedLine(shortcuts, width);
  const bottom = `└${'─'.repeat(Math.max(0, width - 2))}┘`;

  return [separator, promptLine, shortcutsLine, bottom].join('\n');
}

export function renderChatEntry(entry: ChatEntry, width = 96): string[] {
  const lines: string[] = [];

  switch (entry.type) {
    case 'blank':
      lines.push(boxedLine('', width));
      break;

    case 'user':
      lines.push(boxedLine(`${ansi.bold}[User]${ansi.reset} ${entry.content || ''}`, width));
      lines.push(boxedLine('', width));
      break;

    case 'agent':
      lines.push(boxedLine(`${ansi.bold}${ansi.cyan}[BSH Agent]${ansi.reset}`, width));
      for (const line of (entry.content || '').split('\n')) {
        lines.push(boxedLine(line, width));
      }
      lines.push(boxedLine('', width));
      break;

    case 'tool':
      lines.push(boxedLine(`${ansi.yellow}⚙ Tool:${ansi.reset} ${ansi.bold}${entry.toolName}${ansi.reset}(${entry.toolArgs || ''})`, width));
      break;

    case 'tool_result':
      lines.push(boxedLine(`${ansi.green}↳${ansi.reset} ${entry.content || ''}`, width));
      lines.push(boxedLine('', width));
      break;

    case 'gate': {
      lines.push(boxedLine(`${ansi.bold}${ansi.brightBlue}🛡 Semantic Gate${ansi.reset} [Evaluating SHACL constraints: ${entry.gateShape || 'DomainShapes'}]`, width));
      if (entry.gateChecks) {
        for (const check of entry.gateChecks) {
          const icon = check.ok ? `${ansi.brightGreen}✔${ansi.reset}` : `${ansi.brightRed}✖${ansi.reset}`;
          lines.push(boxedLine(`  ${icon} ${check.text}`, width));
        }
      }
      if (entry.gateStatus === 'CONFORMING') {
        lines.push(boxedLine(`  ${ansi.brightGreen}→ Status: CONFORMING (Ready to promote)${ansi.reset}`, width));
      } else if (entry.gateStatus === 'VIOLATION') {
        lines.push(boxedLine(`  ${ansi.brightRed}→ Status: VIOLATION (Promotion blocked)${ansi.reset}`, width));
      }
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
  customWidth?: number
): string {
  const width = customWidth || state.width || (process.stdout.columns && process.stdout.columns > 90 ? process.stdout.columns : 100);
  const headerState = { ...state, width };
  const header = renderHeader(headerState);
  const chatLines: string[] = [];
  if (entries.length === 0) {
    // Add an empty boxed line so there is space between header and footer
    chatLines.push(boxedLine('', width));
  } else {
    for (const e of entries) {
      chatLines.push(...renderChatEntry(e, width));
    }
  }
  const promptLine = boxedLine(`${ansi.bold}> ${ansi.reset}${currentPrompt}`, width);
  const shortcuts = `${ansi.bold}[Ctrl+M]${ansi.reset} Model  ${ansi.bold}[Ctrl+D]${ansi.reset} Domain/SHACL  ${ansi.bold}[Ctrl+G]${ansi.reset} Diff/Gate  ${ansi.bold}[Ctrl+C]${ansi.reset} Exit`;
  const shortcutsLine = boxedLine(shortcuts, width);
  const separator = `├${'─'.repeat(Math.max(0, width - 2))}┤`;
  const bottom = `└${'─'.repeat(Math.max(0, width - 2))}┘`;

  return [header, ...chatLines, separator, promptLine, shortcutsLine, bottom].join('\n');
}

