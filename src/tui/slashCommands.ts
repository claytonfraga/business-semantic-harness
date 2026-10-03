import { ansi, stripAnsi } from './ansi.js';
import { highlightMatches } from './fuzzySearch.js';
import { githubDarkDimmedTheme as theme } from './theme.js';
import { fuzzyScore } from './fuzzySearch.js';

export interface SlashCommandDef {
  name: string;
  description: string;
  shortcut?: string;
  category: 'System' | 'Governance' | 'Config' | 'Skills' | 'UI';
  activeColor: string;
  activeColorName: string;
}

export const DEFAULT_SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: '/model',
    description: 'Switch active LLM model via fuzzy search',
    shortcut: 'Ctrl+M',
    category: 'Config',
    activeColor: theme.commands['/model'],
    activeColorName: 'Magenta',
  },
  {
    name: '/domain',
    description: 'Select domain ontology & SHACL rules',
    shortcut: 'Ctrl+D',
    category: 'Governance',
    activeColor: theme.commands['/domain'],
    activeColorName: 'Emerald Green',
  },
  {
    name: '/skills',
    description: 'Manage & execute operational skills',
    category: 'Skills',
    activeColor: theme.commands['/skills'],
    activeColorName: 'Electric Cyan',
  },
  {
    name: '/diff',
    description: 'Review workspace diff & promote changes',
    category: 'System',
    activeColor: theme.commands['/diff'],
    activeColorName: 'Golden Yellow',
  },
  {
    name: '/rules',
    description: 'Inspect active SHACL shapes & rules',
    category: 'Governance',
    activeColor: theme.commands['/rules'],
    activeColorName: 'Sky Blue',
  },
  {
    name: '/settings',
    description: 'Configure session & prompt preferences',
    category: 'Config',
    activeColor: theme.commands['/settings'],
    activeColorName: 'Peach Orange',
  },
  {
    name: '/affinity',
    description: 'Check semantic ontology affinity',
    category: 'Governance',
    activeColor: theme.commands['/affinity'],
    activeColorName: 'Turquoise',
  },
  {
    name: '/mcp',
    description: 'Manage Model Context Protocol tools',
    category: 'System',
    activeColor: theme.commands['/mcp'],
    activeColorName: 'Violet',
  },
  {
    name: '/clear',
    description: 'Clear screen & reset message viewport',
    category: 'UI',
    activeColor: theme.commands['/clear'],
    activeColorName: 'Bright Silver',
  },
  {
    name: '/done',
    description: 'Finalize skill loop & save deliverables',
    category: 'Skills',
    activeColor: theme.commands['/done'],
    activeColorName: 'Lime Green',
  },
  {
    name: '/help',
    description: 'Display available commands & shortcuts',
    category: 'UI',
    activeColor: theme.commands['/help'],
    activeColorName: 'Royal Blue',
  },
  {
    name: '/ungoverned',
    description: 'Bypass SHACL semantic governance',
    category: 'Governance',
    activeColor: theme.commands['/ungoverned'],
    activeColorName: 'Warm Amber',
  },
  {
    name: '/governed',
    description: 'Enforce strict SHACL domain rules',
    category: 'Governance',
    activeColor: theme.commands['/governed'],
    activeColorName: 'Mint Green',
  },
  {
    name: '/verbose',
    description: 'Toggle verbose tool & RPC debug output',
    category: 'UI',
    activeColor: theme.commands['/verbose'],
    activeColorName: 'Lavender Purple',
  },
  {
    name: '/exit',
    description: 'Safely exit BSH and restore terminal',
    category: 'System',
    activeColor: theme.commands['/exit'],
    activeColorName: 'Crimson',
  },
];

export interface ScoredSlashCommand {
  command: SlashCommandDef;
  score: number;
  indices: number[];
}

export function filterSlashCommands(
  query: string,
  commands: SlashCommandDef[] = DEFAULT_SLASH_COMMANDS
): ScoredSlashCommand[] {
  const cleanQuery = query.trim().replace(/^\//, '').toLowerCase();

  if (!cleanQuery) {
    return commands.map((c) => ({ command: c, score: 0, indices: [] }));
  }

  const results: ScoredSlashCommand[] = [];

  for (const cmd of commands) {
    const rawCmdName = cmd.name.replace(/^\//, '').toLowerCase();

    // Exact prefix match gets highest priority
    if (rawCmdName.startsWith(cleanQuery)) {
      results.push({
        command: cmd,
        score: 1000 + (10 - rawCmdName.length),
        indices: Array.from({ length: cleanQuery.length }, (_, i) => i + 1), // skip '/'
      });
      continue;
    }

    // Fuzzy match on command name
    const nameMatch = fuzzyScore(cmd.name, query.startsWith('/') ? query : `/${query}`);
    if (nameMatch) {
      results.push({
        command: cmd,
        score: 500 + nameMatch.score,
        indices: nameMatch.indices,
      });
      continue;
    }

    // Fuzzy match on description (lower priority)
    const descMatch = fuzzyScore(cmd.description, cleanQuery);
    if (descMatch) {
      results.push({
        command: cmd,
        score: Math.min(100, descMatch.score * 0.2),
        indices: [],
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

export function getSlashCommandActiveColor(name: string): string {
  const normalized = name.startsWith('/') ? name.toLowerCase() : `/${name.toLowerCase()}`;
  const found = DEFAULT_SLASH_COMMANDS.find((c) => c.name.toLowerCase() === normalized);
  return found?.activeColor || theme.accent;
}

export interface SlashMenuOverlayState {
  selectedIndex: number;
  scrollOffset: number;
  pageSize: number;
  query: string;
}


/** @deprecated Temporary legacy session bridge; task 4 removes it. */
export function formatSlashCommandLine(
  command: SlashCommandDef,
  index: number,
  isActive: boolean,
  highlightedName?: string
): string {
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const magenta = '\x1b[35m';

  const pointer = isActive ? `${command.activeColor}❯${reset} ` : '  ';
  const numBadge = `${bold}${index + 1}.${reset}`;
  const nameStr = isActive
    ? `${command.activeColor}${command.name}${reset}`
    : (highlightedName || `${dim}${command.name}${reset}`);
  const shortcutBadge = command.shortcut ? ` ${dim}[${command.shortcut}]${reset}` : '';
  const categoryBadge = isActive
    ? ` ${command.activeColor}(${command.category})${reset}`
    : ` ${magenta}(${command.category})${reset}`;
  const descStr = isActive ? `${bold}${command.description}${reset}` : `${dim}${command.description}${reset}`;

  return `${pointer}${numBadge} ${nameStr}${shortcutBadge}${categoryBadge} - ${descStr}`;
}

/**
 * Renders the compact OpenTUI-style floating command palette box.
 * Responsive, bounded width (<= 72 chars), scrollable viewport window.
 */
export function renderSlashMenuBox(
  state: SlashMenuOverlayState,
  maxWidth = 72,
  commands: SlashCommandDef[] = DEFAULT_SLASH_COMMANDS
): string[] {
  const scored = filterSlashCommands(state.query, commands);
  const total = scored.length;
  const pageSize = state.pageSize || 5;
  const boxWidth = Math.min(maxWidth, 72);
  const innerWidth = boxWidth - 4; // between "│ " and " │"

  // Ensure scrollOffset keeps selectedIndex visible
  let scrollOffset = state.scrollOffset;
  if (state.selectedIndex < scrollOffset) {
    scrollOffset = state.selectedIndex;
  } else if (state.selectedIndex >= scrollOffset + pageSize) {
    scrollOffset = state.selectedIndex - pageSize + 1;
  }
  scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, total - pageSize)));

  const visibleItems = scored.slice(scrollOffset, scrollOffset + pageSize);

  // Header line
  let headerTitle: string;
  let headerRight: string;
  if (total === 0) {
    headerTitle = 'Slash Commands';
    headerRight = 'No match';
  } else if (state.query) {
    headerTitle = `Commands (${total} found)`;
    headerRight = `Filter: "${state.query}"`;
  } else {
    const rangeEnd = Math.min(total, scrollOffset + pageSize);
    headerTitle = `Commands (${scrollOffset + 1}-${rangeEnd} of ${total})`;
    headerRight = '↑/↓ scroll';
  }

  const leftHeader = `┌─ ${headerTitle} `;
  const rightHeader = ` ${headerRight} ─┐`;
  const midDashLen = Math.max(2, boxWidth - stripAnsi(leftHeader).length - stripAnsi(rightHeader).length);
  const topBorder = `${ansi.dim}${leftHeader}${'─'.repeat(midDashLen)}${rightHeader}${ansi.reset}`;

  const rows: string[] = [topBorder];

  if (visibleItems.length === 0) {
    const emptyMsg = `  No commands matching "${state.query}"`;
    const padded = emptyMsg.padEnd(innerWidth);
    rows.push(`${ansi.dim}│${ansi.reset} ${ansi.red}${padded}${ansi.reset} ${ansi.dim}│${ansi.reset}`);
  } else {
    for (let i = 0; i < visibleItems.length; i++) {
      const globalIndex = scrollOffset + i;
      const { command, indices } = visibleItems[i];
      const isActive = globalIndex === state.selectedIndex;

      const pointer = isActive ? `${command.activeColor}❯${ansi.reset} ` : '  ';
      const cmdFormatted = isActive
        ? `${command.activeColor}${command.name.padEnd(12)}${ansi.reset}`
        : (state.query && indices.length > 0
            ? highlightMatches(command.name.padEnd(12), indices)
            : `${ansi.dim}${command.name.padEnd(12)}${ansi.reset}`);

      const shortcutStr = command.shortcut ? `[${command.shortcut}]` : '';
      const shortcutFormatted = `${ansi.dim}${shortcutStr.padEnd(8)}${ansi.reset}`;

      // Calculate remaining space for description
      const descBudget = Math.max(10, innerWidth - 25);
      let descText = command.description;
      if (descText.length > descBudget) {
        descText = `${descText.slice(0, descBudget - 2)}..`;
      }
      const descFormatted = isActive
        ? `${ansi.bold}${descText.padEnd(descBudget)}${ansi.reset}`
        : `${ansi.dim}${descText.padEnd(descBudget)}${ansi.reset}`;

      const content = `${pointer}${cmdFormatted} ${shortcutFormatted} ${descFormatted}`;
      const visibleLen = stripAnsi(content).length;
      const extraPad = Math.max(0, innerWidth - visibleLen);

      rows.push(`${ansi.dim}│${ansi.reset} ${content}${' '.repeat(extraPad)} ${ansi.dim}│${ansi.reset}`);
    }
  }

  // Footer line: exact boxWidth characters
  const footerLeft = '└─ [Enter] Select  [Esc] Dismiss ';
  const footerRight = ' Type to filter ─┘';
  const footerDashLen = Math.max(2, boxWidth - footerLeft.length - footerRight.length);
  const bottomBorder = `${ansi.dim}${footerLeft}${'─'.repeat(footerDashLen)}${footerRight}${ansi.reset}`;
  rows.push(bottomBorder);

  return rows;
}

