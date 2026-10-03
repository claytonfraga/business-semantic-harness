import { BoxRenderable, TextRenderable, StyledText, fg, type CliRenderer } from '@opentui/core';
import type { ChatEntry, ReceiptFileStat } from './state.js';
import { githubDarkDimmedTheme as theme } from './theme.js';

export function parseArgs(args: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof args === 'object' && args !== null) return args;
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      return { raw: args };
    }
  }
  return {};
}

export function formatToolInvocation(name: string, args: Record<string, unknown> | string): string {
  const parsed = parseArgs(args);
  if (['read_file', 'write_file', 'replace_file_content'].includes(name) && parsed.path) {
    return `${name}("${String(parsed.path)}")`;
  }
  if (name === 'list_directory') {
    return `${name}("${String(parsed.path || '.')}")`;
  }
  if (name === 'run_bash_command' && parsed.command) {
    const command = String(parsed.command);
    return `run_bash("${command.length > 55 ? `${command.slice(0, 52)}...` : command}")`;
  }
  if (typeof args === 'string' && !parsed.raw) {
    return `${name}(${args.slice(0, 50)})`;
  }
  if (typeof args === 'string' && parsed.raw) {
    return `${name}("${args}")`;
  }
  return `${name}(${JSON.stringify(parsed).slice(0, 50)})`;
}

export interface ActionStep {
  action: string;
  target: string;
  isEdit: boolean;
  isCommand: boolean;
  isOntology: boolean;
}

export function formatActionStep(name: string, args: Record<string, unknown> | string): ActionStep {
  const parsed = parseArgs(args);
  switch (name) {
    case 'read_file':
      return { action: '○ Reading', target: String(parsed.path || ''), isEdit: false, isCommand: false, isOntology: false };
    case 'write_file':
      return { action: '● Writing', target: String(parsed.path || ''), isEdit: true, isCommand: false, isOntology: false };
    case 'replace_file_content':
      return { action: '● Editing', target: String(parsed.path || ''), isEdit: true, isCommand: false, isOntology: false };
    case 'list_directory':
      return { action: '○ Exploring', target: String(parsed.path || '.'), isEdit: false, isCommand: false, isOntology: false };
    case 'search_code': {
      const q = String(parsed.query || '');
      return { action: '○ Searching codebase for', target: `"${q.length > 40 ? `${q.slice(0, 37)}...` : q}"`, isEdit: false, isCommand: false, isOntology: false };
    }
    case 'find_files': {
      const p = String(parsed.pattern || '');
      return { action: '○ Finding files matching', target: `"${p.length > 40 ? `${p.slice(0, 37)}...` : p}"`, isEdit: false, isCommand: false, isOntology: false };
    }
    case 'run_bash_command': {
      const cmd = String(parsed.command || '');
      return { action: '$', target: cmd.length > 55 ? `${cmd.slice(0, 52)}...` : cmd, isEdit: false, isCommand: true, isOntology: false };
    }
    case 'inspect_skill':
      return { action: '○ Inspecting skill', target: String(parsed.name || ''), isEdit: false, isCommand: false, isOntology: false };
    case 'bsh_query_ontology':
      return { action: '◈ Querying ontology', target: String(parsed.domain || parsed.iri || ''), isEdit: false, isCommand: false, isOntology: true };
    case 'bsh_validate_shacl':
      return { action: '◈ Validating SHACL', target: String(parsed.shape || parsed.domain || ''), isEdit: false, isCommand: false, isOntology: true };
    case 'bsh_check_affinity':
      return { action: '◈ Checking concept affinity', target: String(parsed.domain || ''), isEdit: false, isCommand: false, isOntology: true };
    case 'context7_search_docs': {
      const q = String(parsed.query || '');
      return { action: '○ Searching docs for', target: `"${q.length > 40 ? `${q.slice(0, 37)}...` : q}"`, isEdit: false, isCommand: false, isOntology: false };
    }
    default: {
      const serialized = typeof args === 'string' ? args : JSON.stringify(args);
      return { action: '○ Executing', target: `${name}(${serialized.slice(0, 45)})`, isEdit: false, isCommand: false, isOntology: false };
    }
  }
}

interface EntryRow { text: string; color: string; stats?: ReceiptFileStat }
function rowsFor(entry: ChatEntry): EntryRow[] {
  const row = (text: string, color: string = theme.text): EntryRow => ({ text, color });
  const files = (stats: ReceiptFileStat[]) => stats.map(stat => ({ text: stat.path, color: theme.text, stats: stat }));
  switch (entry.type) {
    case 'blank': return [row('')];
    case 'user': return [row(`[User]${entry.isViolating ? ' [!] VIOLATION DETECTED' : ''}${entry.isQueued ? ' [QUEUED]' : ''}`, entry.isViolating ? theme.error : theme.accent), row(entry.content || '')];
    case 'agent': return [row('[BSH Agent]', theme.accent), row(entry.content || '')];
    case 'tool': {
      if (entry.verbose) {
        return [row(`>_ Tool: ${formatToolInvocation(entry.toolName || '', entry.toolArgs || {})}`, theme.accent)];
      }
      const step = formatActionStep(entry.toolName || '', entry.toolArgs || {});
      const color = step.isEdit ? theme.success : step.isOntology ? theme.reasoning : step.isCommand ? theme.warning : theme.accent;
      return [row(`${step.action} ${step.target}`.trim(), color)];
    }
    case 'tool_result': {
      if (entry.verbose) {
        return [row(`Tool result: ${entry.content || ''}`)];
      }
      if (entry.isError) {
        return [row(`✖ ${entry.content || 'Action failed'}`, theme.error)];
      }
      if (!entry.content) return [row('')];
      return [row(`  ↳ ${entry.content}`, theme.muted)];
    }
    case 'gate': {
      const violation = entry.gateStatus === 'VIOLATION';
      const rows: EntryRow[] = [
        row(`Semantic Gate [SHACL: ${entry.gateShape || 'TransferShape'}] ${violation ? '[X] VIOLATION' : '[OK] CONFORMING'}`, violation ? theme.error : theme.success),
        ...(entry.gateChecks || []).map(check => row(`${check.ok ? '[+]' : '[X]'} ${check.text}`, check.ok ? theme.success : theme.error)),
        row(violation ? 'Status: VIOLATION (Promotion blocked)' : 'Status: CONFORMING (Ready to promote)', violation ? theme.error : theme.success),
      ];
      if (violation) {
        if (entry.violationBusinessRationale) {
          rows.push(row(`Fundamento Ontológico: ${entry.violationBusinessRationale}`, theme.text));
        }
        rows.push(row('✓ Repositório seguro: Branch master preservado no worktree isolado.', theme.success));
        rows.push(row('Ações Recomendadas: Adequar o código para respeitar a invariante ou /diff para revisar.', theme.muted));
      }
      return rows;
    }
    case 'alert': {
      const rows: EntryRow[] = [
        row('[!] Semantic Domain Alert', theme.warning),
        row(entry.content || '', theme.warning),
      ];
      if (entry.alertDiagnostic) {
        rows.push(row(`Diagnóstico: ${entry.alertDiagnostic}`, theme.text));
      }
      if (entry.alertRemediation && entry.alertRemediation.length > 0) {
        rows.push(row('Opções Recomendadas:', theme.accent));
        for (const item of entry.alertRemediation) {
          rows.push(row(`  • ${item}`, theme.muted));
        }
      }
      return rows;
    }
    case 'prompt_violation': {
      const rows: EntryRow[] = [
        row('[!] PROMPT VIOLATION DETECTED [Pre-flight Semantic Guard]', theme.error),
      ];
      if (entry.violationOperation) {
        rows.push(row(`Operação Identificada: ${entry.violationOperation}`, theme.accent));
      }
      if (entry.violationShape) {
        rows.push(row(`Violated shape: ${entry.violationShape}`, theme.warning));
      }
      if (entry.violationRule) {
        rows.push(row(`SHACL rule: ${entry.violationRule}`, theme.warning));
      }
      if (entry.violationBusinessRationale) {
        rows.push(row(`Motivo Negocial: ${entry.violationBusinessRationale}`, theme.text));
      }
      if (entry.content) {
        rows.push(row(entry.content, theme.error));
      }
      if (entry.violationRemediation && entry.violationRemediation.length > 0) {
        rows.push(row('Como Prosseguir:', theme.accent));
        entry.violationRemediation.forEach((rem, idx) => {
          rows.push(row(`  ${idx + 1}. ${rem}`, theme.muted));
        });
      }
      if (entry.waitingConfirmation) {
        rows.push(row('Press [Enter] to proceed or [Escape] / /cancel to discard', theme.warning));
      }
      return rows;
    }
    case 'implementation_receipt': return entry.receiptHasChanges
      ? [row(`[IMPLEMENTATION COMPLETED] [Modified files: ${entry.receiptFiles?.length || 0}]`, theme.success), ...files(entry.receiptFiles || []), row(`Changes saved to workspace (+${entry.receiptTotalAdded || 0} / -${entry.receiptTotalRemoved || 0} lines); promotion is separate.`, theme.success)]
      : [row('[READ / DIAGNOSTIC]', theme.accent), row('No file changes were saved in this response.', theme.muted)];
    case 'reasoning': {
      const collapsed = entry.reasoningCollapsed ?? true;
      const duration = entry.reasoningDurationMs ? ` · ${(entry.reasoningDurationMs / 1000).toFixed(1)}s` : '';
      return [row(`${collapsed ? "▼" : "▲"} [Reasoning: ~${entry.reasoningTokens ?? Math.max(1, Math.round((entry.content || '').length / 4))} tokens${duration}] [Ctrl+O ${collapsed ? 'expand' : 'collapse'}]`, theme.reasoning), ...(collapsed ? [] : [row(entry.content || '', theme.muted)])];
    }
    case 'diff_preview': return [row(`[DIFF PREVIEW] [${entry.diffFiles?.length || 0} changed files (+${entry.diffTotalAdded || 0} / -${entry.diffTotalRemoved || 0})]`, theme.accent), ...files((entry.diffFiles || []).slice(0, 8)), ...(entry.diffFiles && entry.diffFiles.length > 8 ? [row(`... and ${entry.diffFiles.length - 8} more files`, theme.muted)] : [])];
  }
}

/** Retains card and row identity as streaming payloads change. */
export function createEntryComponent(renderer: CliRenderer, id: string) {
  const component = new BoxRenderable(renderer, { id, width: '100%', flexDirection: 'column', flexShrink: 0, paddingBottom: 1, backgroundColor: theme.background });
  const texts: TextRenderable[] = [];
  return {
    component,
    update(entry: ChatEntry): void {
      const rows = rowsFor(entry);
      while (texts.length > rows.length) {
        const text = texts.pop();
        if (text) { component.remove(text); text.destroy(); }
      }
      rows.forEach((row, index) => {
        let text = texts[index];
        if (!text) {
          text = new TextRenderable(renderer, { id: `${id}-row-${index}`, width: '100%', flexShrink: 0, wrapMode: 'word', fg: row.color, bg: theme.background });
          texts.push(text);
          component.add(text);
        }
        text.fg = row.color;
        text.content = row.stats ? new StyledText([fg(theme.text)(`${row.text} (`), fg(theme.success)(`+${row.stats.linesAdded}`), fg(theme.text)(' / '), fg(theme.error)(`-${row.stats.linesRemoved}`), fg(theme.text)(')')]) : row.text;
      });
    },
  };
}
