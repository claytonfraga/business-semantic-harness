import { ansi, stripAnsi } from './ansi.js';

export interface RenderState {
  model: string;
  domain?: string;
  governed: boolean;
  tokensTotal: number;
  sessionCost?: number;
  width?: number;
}

export function renderHeader(state: RenderState): string {
  const width = state.width || process.stdout.columns || 80;
  const logo = `${ansi.bold}${ansi.brightBlue}BSH${ansi.reset} ${ansi.dim}[Business Semantic Harness]${ansi.reset}`;
  const statusBadge = state.governed
    ? `${ansi.bgBlue}${ansi.bold} ● GOVERNED ${ansi.reset}`
    : `${ansi.bgGray}${ansi.yellow} ○ UNGOVERNED ${ansi.reset}`;

  const firstLine = `┌─ ${logo} ${'─'.repeat(Math.max(2, width - 42))} ${statusBadge} ┐`;

  const domainStr = state.domain
    ? `${ansi.green}${state.domain}${ansi.reset} ${ansi.dim}(SHACL active)${ansi.reset}`
    : `${ansi.dim}none${ansi.reset}`;

  const costStr = state.sessionCost ? ` | $${state.sessionCost.toFixed(4)}` : '';
  const secondLine = `│ ${ansi.bold}Model:${ansi.reset} ${ansi.cyan}${state.model}${ansi.reset}   ${ansi.bold}Domain:${ansi.reset} ${domainStr}   ${ansi.bold}Tokens:${ansi.reset} ${state.tokensTotal.toLocaleString()}${costStr}`;

  const padding = ' '.repeat(Math.max(0, width - stripAnsi(secondLine).length - 3));
  const secondLinePadded = `${secondLine}${padding}│`;
  const separator = `├${'─'.repeat(Math.max(0, width - 2))}┤`;

  return [firstLine, secondLinePadded, separator].join('\n');
}

export function renderFooter(width?: number): string {
  const w = width || process.stdout.columns || 80;
  const separator = `├${'─'.repeat(Math.max(0, w - 2))}┤`;
  const shortcuts = `│ ${ansi.bold}[Ctrl+M]${ansi.reset} Model  ${ansi.bold}[Ctrl+D]${ansi.reset} Domain/SHACL  ${ansi.bold}[Ctrl+G]${ansi.reset} Diff/Gate  ${ansi.bold}[Ctrl+L]${ansi.reset} Clear  ${ansi.bold}[Esc]${ansi.reset} Exit`;
  const pad = ' '.repeat(Math.max(0, w - stripAnsi(shortcuts).length - 3));
  const bottom = `└${'─'.repeat(Math.max(0, w - 2))}┘`;

  return [separator, `${shortcuts}${pad}│`, bottom].join('\n');
}

export function formatToolStart(name: string, args: Record<string, unknown>): string {
  const argsBrief = JSON.stringify(args);
  const truncated = argsBrief.length > 60 ? `${argsBrief.slice(0, 57)}...` : argsBrief;
  return `\n  ${ansi.yellow}⚙ Tool Invocation:${ansi.reset} ${ansi.bold}${name}${ansi.reset}(${ansi.dim}${truncated}${ansi.reset})`;
}

export function formatToolDone(name: string, result: string): string {
  const firstLine = result.split('\n')[0] || '';
  const preview = firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;
  return `  ${ansi.green}↳ Result:${ansi.reset} ${ansi.dim}${preview}${ansi.reset}\n`;
}

export function formatGovernanceAlert(conforms: boolean, violations: string[]): string {
  if (conforms) {
    return `\n  ${ansi.brightGreen}🛡 Semantic Gate:${ansi.reset} ${ansi.bold}CONFORMING${ansi.reset} (All SHACL constraints satisfied)`;
  }
  const count = violations.length;
  const header = `\n  ${ansi.brightRed}🛡 Semantic Gate VIOLATION:${ansi.reset} ${ansi.bold}${count} constraint(s) failed${ansi.reset}:`;
  const items = violations.map((v) => `    ${ansi.red}✖${ansi.reset} ${v}`).join('\n');
  return `${header}\n${items}`;
}
