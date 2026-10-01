import { ansi, stripAnsi } from './ansi.js';

export interface RenderState {
  model: string;
  contextLength?: number;
  domain?: string;
  ontologySummary?: string;
  projectFolder?: string;
  gitBranch?: string;
  governed: boolean;
  alignmentStatus?: 'ALIGNED' | 'MISMATCH' | 'INSUFFICIENT_DATA';
  alignmentWarning?: string;
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
  type: 'user' | 'agent' | 'tool' | 'tool_result' | 'gate' | 'alert' | 'prompt_violation' | 'blank';
  content?: string;
  isViolating?: boolean;
  toolName?: string;
  toolArgs?: Record<string, unknown> | string;
  gateShape?: string;
  gateChecks?: GateCheckItem[];
  gateStatus?: 'CONFORMING' | 'VIOLATION';
  violationShape?: string;
  violationRule?: string;
  waitingConfirmation?: boolean;
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
 * Safely truncates a string preserving ANSI escape sequences.
 */
export function truncateAnsi(text: string, maxWidth: number): string {
  const visible = stripAnsi(text);
  if (visible.length <= maxWidth) return text;
  if (!text.includes('\x1b')) {
    return `${text.slice(0, maxWidth - 3)}...`;
  }

  let visibleCount = 0;
  let result = '';
  let inEscape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\x1b') {
      inEscape = true;
      result += ch;
      continue;
    }
    if (inEscape) {
      result += ch;
      if (ch === 'm' || ch === 'K' || ch === 'H') {
        inEscape = false;
      }
      continue;
    }
    if (visibleCount >= maxWidth - 3) {
      result += `...${ansi.reset}`;
      break;
    }
    result += ch;
    visibleCount++;
  }
  return result;
}

/**
 * Formats a line to exact visible width without lateral borders.
 */
export function tuiLine(text: string, width: number): string {
  const visibleLen = stripAnsi(text).length;
  if (visibleLen === width) {
    return text;
  }
  if (visibleLen < width) {
    return `${text}${' '.repeat(width - visibleLen)}`;
  }
  const truncated = truncateAnsi(text, width);
  const truncatedLen = stripAnsi(truncated).length;
  if (truncatedLen < width) {
    return `${truncated}${' '.repeat(width - truncatedLen)}`;
  }
  return truncated;
}

/**
 * Backward-compatible alias for line formatting.
 */
export function boxedLine(text: string, width: number): string {
  return tuiLine(text, width);
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
  
  let statusBadge: string;
  let visibleStatus: string;
  if (!state.governed) {
    statusBadge = `${ansi.bold}${ansi.yellow}[o] UNGOVERNED${ansi.reset}`;
    visibleStatus = '[o] UNGOVERNED';
  } else if (state.alignmentStatus === 'MISMATCH') {
    statusBadge = `${ansi.bold}${ansi.yellow}[!] DOMAIN MISMATCH${ansi.reset}`;
    visibleStatus = '[!] DOMAIN MISMATCH';
  } else {
    statusBadge = `${ansi.bold}${ansi.brightGreen}[*] GOVERNED${ansi.reset}`;
    visibleStatus = '[*] GOVERNED';
  }

  const visibleLogo = 'BSH [Business Semantic Harness]';
  const fixedChars = 4 + visibleLogo.length + 2 + visibleStatus.length + 4;
  const dashCount = Math.max(2, width - fixedChars);
  const firstLine = `─── ${logo} ${'─'.repeat(dashCount)} ${statusBadge} ───`;

  const ctxStr = state.contextLength ? ` (${formatContextLength(state.contextLength)})` : ' (128k ctx)';
  const modelStr = `${state.model}${ctxStr}`;

  let ontologyStr = '';
  const domainText = state.ontologySummary || state.domain;
  if (domainText) {
    if (!state.governed) {
      ontologyStr = `${ansi.yellow}${domainText}${ansi.reset} ${ansi.dim}(inactive)${ansi.reset}`;
    } else if (state.alignmentStatus === 'MISMATCH') {
      ontologyStr = `${ansi.bold}${ansi.yellow}[!] mismatch${ansi.reset} ${ansi.yellow}${domainText}${ansi.reset}`;
    } else {
      ontologyStr = `${ansi.brightGreen}${domainText}${ansi.reset} ${ansi.dim}(SHACL active)${ansi.reset}`;
    }
  } else {
    ontologyStr = `${ansi.yellow}none${ansi.reset} ${ansi.dim}(inactive)${ansi.reset}`;
  }

  const secondLine = tuiLine(`  Model: ${ansi.cyan}${modelStr}${ansi.reset}   Ontology: ${ontologyStr}`, width);

  const projectStr = state.projectFolder || 'project';
  const branchStr = state.gitBranch ? `git(${state.gitBranch})` : 'non-git';
  const tokensStr = state.tokensTotal.toLocaleString();
  const costStr = state.sessionCost !== undefined ? ` ($${state.sessionCost.toFixed(4)})` : '';
  const thirdLine = tuiLine(
    `  Project: ${ansi.blue}${projectStr}${ansi.reset}   Branch: ${ansi.magenta}${branchStr}${ansi.reset}   Tokens: ${tokensStr}${costStr}`,
    width
  );

  const separator = '─'.repeat(width);

  return [tuiLine(firstLine, width), secondLine, thirdLine, separator].join('\n');
}

export function renderChatEntry(entry: ChatEntry, width: number): string[] {
  const lines: string[] = [];

  switch (entry.type) {
    case 'blank':
      lines.push(tuiLine('', width));
      break;

    case 'user': {
      const wrapped = wrapText(entry.content || '', width - 14);
      const isViolating = entry.isViolating;
      const barColor = isViolating ? ansi.brightRed : ansi.cyan;
      const userTag = isViolating
        ? `${ansi.bold}${ansi.brightRed}> [User] [!] VIOLATION DETECTED${ansi.reset}`
        : `${ansi.bold}${ansi.cyan}> [User]${ansi.reset}`;
      lines.push(tuiLine(`  ${barColor}▎${ansi.reset} ${userTag} ${wrapped[0] || ''}`, width));
      for (let i = 1; i < wrapped.length; i++) {
        lines.push(tuiLine(`  ${ansi.dim}▎${ansi.reset}   ${wrapped[i]}`, width));
      }
      lines.push(tuiLine('', width));
      break;
    }

    case 'agent': {
      lines.push(tuiLine(`  ${ansi.magenta}▎${ansi.reset} ${ansi.bold}${ansi.magenta}[BSH Agent]${ansi.reset}`, width));
      for (const rawLine of (entry.content || '').split('\n')) {
        const wrapped = wrapText(rawLine, width - 8);
        for (const w of wrapped) {
          lines.push(tuiLine(`  ${ansi.dim}▎${ansi.reset}   ${w}`, width));
        }
      }
      lines.push(tuiLine('', width));
      break;
    }

    case 'tool': {
      const inv = formatToolInvocation(entry.toolName || '', entry.toolArgs || {});
      lines.push(tuiLine(`  ${ansi.blue}▎${ansi.reset} ${ansi.yellow}>_ Tool:${ansi.reset} ${ansi.bold}${inv}${ansi.reset}`, width));
      break;
    }

    case 'tool_result': {
      lines.push(tuiLine(`  ${ansi.dim}▎${ansi.reset}   ${ansi.green}->${ansi.reset} ${entry.content || ''}`, width));
      lines.push(tuiLine('', width));
      break;
    }

    case 'gate': {
      const isViolation = entry.gateStatus === 'VIOLATION';
      const shape = entry.gateShape || 'TransferShape';
      const barColor = isViolation ? ansi.brightRed : ansi.brightGreen;
      const title = `${ansi.bold}${ansi.cyan}[#] Semantic Gate${ansi.reset} ${ansi.dim}[SHACL: ${ansi.reset}${ansi.bold}${shape}${ansi.reset}${ansi.dim}]${ansi.reset}`;
      const badge = isViolation
        ? `${ansi.bold}${ansi.brightRed}[X] VIOLATION${ansi.reset}`
        : `${ansi.bold}${ansi.brightGreen}[OK] CONFORMING${ansi.reset}`;

      lines.push(tuiLine(`  ${barColor}▎${ansi.reset} ${title} ${badge}`, width));

      if (entry.gateChecks && entry.gateChecks.length > 0) {
        for (const check of entry.gateChecks) {
          const checkIcon = check.ok ? `${ansi.brightGreen}[+]${ansi.reset}` : `${ansi.brightRed}[X]${ansi.reset}`;
          lines.push(tuiLine(`  ${barColor}▎${ansi.reset}   ${checkIcon} ${check.text}`, width));
        }
      }

      const statusText = isViolation
        ? `${ansi.bold}${ansi.brightRed}-> Status: VIOLATION (Promotion blocked)${ansi.reset}`
        : `${ansi.bold}${ansi.brightGreen}-> Status: CONFORMING (Ready to promote)${ansi.reset}`;
      lines.push(tuiLine(`  ${barColor}▎${ansi.reset}   ${statusText}`, width));
      lines.push(tuiLine('', width));
      break;
    }

    case 'alert': {
      lines.push(tuiLine(`  ${ansi.brightYellow}▎${ansi.reset} ${ansi.bold}${ansi.yellow}[!] [Semantic Domain Alert]${ansi.reset}`, width));
      for (const rawLine of (entry.content || '').split('\n')) {
        const wrapped = wrapText(rawLine, width - 8);
        for (const w of wrapped) {
          lines.push(tuiLine(`  ${ansi.brightYellow}▎${ansi.reset}   ${ansi.yellow}${w}${ansi.reset}`, width));
        }
      }
      lines.push(tuiLine('', width));
      break;
    }

    case 'prompt_violation': {
      lines.push(tuiLine(`  ${ansi.brightRed}▎${ansi.reset} ${ansi.bold}${ansi.brightRed}[!] [PROMPT VIOLATION DETECTED]${ansi.reset} ${ansi.dim}[Pre-flight Semantic Guard]${ansi.reset}`, width));
      if (entry.violationShape) {
        lines.push(tuiLine(`  ${ansi.brightRed}▎${ansi.reset}   ${ansi.bold}${ansi.yellow}Shape Violada:${ansi.reset} ${entry.violationShape}`, width));
      }
      if (entry.violationRule) {
        lines.push(tuiLine(`  ${ansi.brightRed}▎${ansi.reset}   ${ansi.bold}${ansi.yellow}Regra SHACL:${ansi.reset} ${entry.violationRule}`, width));
      }
      if (entry.content) {
        for (const rawLine of entry.content.split('\n')) {
          const wrapped = wrapText(rawLine, width - 8);
          for (const w of wrapped) {
            lines.push(tuiLine(`  ${ansi.brightRed}▎${ansi.reset}   ${ansi.red}${w}${ansi.reset}`, width));
          }
        }
      }
      if (entry.waitingConfirmation) {
        lines.push(tuiLine(`  ${ansi.brightRed}▎${ansi.reset}   ${ansi.bold}${ansi.brightYellow}-> Pressione [Enter] para prosseguir ou digite /cancel para descartar${ansi.reset}`, width));
      }
      lines.push(tuiLine('', width));
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
  const terminalCols = process.stdout.columns && process.stdout.columns >= 50 ? process.stdout.columns : 96;
  const terminalRows = process.stdout.rows && process.stdout.rows >= 12 ? process.stdout.rows : 30;

  // Fully responsive to total screen resolution (no arbitrary max width clamp)
  const width = Math.max(60, customWidth || state.width || terminalCols);
  const height = Math.max(12, customHeight || state.height || terminalRows);

  const header = renderHeader(state, width);
  const headerLinesCount = 4;
  const footerLinesCount = 5;
  const chromeCount = headerLinesCount + footerLinesCount;
  const viewportHeight = Math.max(4, height - chromeCount);

  // Render all conversation entries into lines
  const allContentLines: string[] = [];
  if (entries.length === 0) {
    allContentLines.push(tuiLine('', width));
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
      viewportLines.push(tuiLine('', width));
    }
  } else {
    const endIndex = totalContent - scrollOffset;
    const startIndex = Math.max(0, endIndex - viewportHeight);
    viewportLines = allContentLines.slice(startIndex, endIndex);
    while (viewportLines.length < viewportHeight) {
      viewportLines.unshift(tuiLine('', width));
    }

    // Render vertical scrollbar on the rightmost column of each viewport row
    const thumbHeight = Math.max(1, Math.min(viewportHeight, Math.round((viewportHeight / totalContent) * viewportHeight)));
    const scrollProgress = maxScroll > 0 ? (maxScroll - scrollOffset) / maxScroll : 1;
    const thumbTop = Math.max(0, Math.min(viewportHeight - thumbHeight, Math.round(scrollProgress * (viewportHeight - thumbHeight))));

    viewportLines = viewportLines.map((line, idx) => {
      const isThumb = idx >= thumbTop && idx < thumbTop + thumbHeight;
      const scrollChar = isThumb ? `${ansi.cyan}█${ansi.reset}` : `${ansi.dim}│${ansi.reset}`;
      const baseLine = tuiLine(line, width - 1);
      return `${baseLine}${scrollChar}`;
    });
  }

  // Rich prompt box inspired by image.png and OpenTUI standards
  const modeBadge = !state.governed
    ? `${ansi.bold}${ansi.yellow}[o] Ungoverned${ansi.reset}`
    : state.alignmentStatus === 'MISMATCH'
    ? `${ansi.bold}${ansi.yellow}[!] Domain Mismatch${ansi.reset}`
    : `${ansi.bold}${ansi.brightGreen}[■] Governed${ansi.reset}`;

  const domainBadge = state.ontologySummary
    ? (state.alignmentStatus === 'MISMATCH' ? `${ansi.yellow}${state.ontologySummary}${ansi.reset}` : `${ansi.cyan}${state.ontologySummary}${ansi.reset}`)
    : (state.domain ? `${ansi.cyan}${state.domain}${ansi.reset}` : `${ansi.dim}none${ansi.reset}`);

  const promptBadgeLine = tuiLine(
    `  ${modeBadge} ${ansi.dim}·${ansi.reset} ${ansi.bold}${state.model}${ansi.reset} ${ansi.dim}·${ansi.reset} ${domainBadge} ${ansi.dim}· OpenRouter${ansi.reset}`,
    width
  );

  const promptDisplay = currentPrompt !== undefined ? currentPrompt : `${ansi.dim}[Type your prompt here...]${ansi.reset}`;
  const promptInputLine = tuiLine(`  ${ansi.cyan}▎${ansi.reset} ${ansi.bold}${ansi.brightWhite}>${ansi.reset} ${promptDisplay}`, width);

  // Footer status line: project path, branch, tokens, percentage, cost, shortcuts
  const branchStr = state.gitBranch ? `git(${state.gitBranch})` : 'non-git';
  const projectFolder = state.projectFolder || 'project';
  const ctxTotal = state.contextLength || 131072;
  const ctxUsed = state.tokensTotal;
  const ctxPct = ((ctxUsed / ctxTotal) * 100).toFixed(1);
  const ctxStr = `${(ctxUsed / 1000).toFixed(1)}k (${ctxPct}%)`;
  const costStr = state.sessionCost !== undefined ? `$${state.sessionCost.toFixed(2)}` : '$0.00';
  const scrollIndicator = scrollOffset > 0 ? ` ${ansi.yellow}[^ Scroll: +${scrollOffset}]${ansi.reset}` : '';
  const shortcuts = width >= 105
    ? `${ansi.bold}[Ctrl+M]${ansi.reset} Model ${ansi.bold}[Ctrl+D]${ansi.reset} Domain ${ansi.bold}[Ctrl+G]${ansi.reset} Diff ${ansi.bold}[PgUp/PgDn]${ansi.reset} Scroll`
    : `${ansi.bold}[Ctrl+M]${ansi.reset} ${ansi.bold}[Ctrl+D]${ansi.reset} ${ansi.bold}[Ctrl+G]${ansi.reset} ${ansi.bold}[PgUp/Dn]${ansi.reset}`;

  const leftPart = `  ${ansi.dim}${projectFolder}${ansi.reset} ${ansi.magenta}${branchStr}${ansi.reset}`;
  const rightPart = `${ansi.cyan}${ctxStr}${ansi.reset} ${ansi.dim}·${ansi.reset} ${ansi.green}${costStr}${ansi.reset}${scrollIndicator} ${ansi.dim}·${ansi.reset} ${shortcuts}`;
  
  const leftVis = stripAnsi(leftPart).length;
  const rightVis = stripAnsi(rightPart).length;
  const gap = Math.max(2, width - leftVis - rightVis);
  const footerStatusLine = tuiLine(`${leftPart}${' '.repeat(gap)}${rightPart}`, width);

  const separator = '─'.repeat(width);
  const bottom = '─'.repeat(width);

  return [header, ...viewportLines, separator, promptBadgeLine, promptInputLine, footerStatusLine, bottom].join('\n');
}
