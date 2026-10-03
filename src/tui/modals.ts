import * as readline from 'node:readline/promises';
import * as nodeReadline from 'node:readline';
import { ansi, box } from './ansi.js';
import type { OpenRouterModel } from '../client/openrouter/types.js';
import type { DomainSummary } from '../governance/domainRegistry.js';
import type { Skill } from '../skills/types.js';

import { authenticateViaWebBrowser, openBrowser } from '../client/openrouter/pkce.js';
import { saveUserAuth, getAuthFilePath } from '../config/userStore.js';

export interface AuthResult {
  apiKey: string;
  ephemeral: boolean;
}

export async function promptApiKeyModal(): Promise<AuthResult> {
  process.stdout.write('\n');
  console.log(box('BSH - Configuração de Autenticação (Primeiro Acesso)', [
    'Nenhuma credencial encontrada no ambiente ou cofre do usuário.',
    'Iniciando autenticação via navegador (OAuth/PKCE) por padrão...',
    '',
    'A credencial será salva com segurança em:',
    `  ${ansi.dim}${getAuthFilePath()}${ansi.reset}`,
    '',
    'Caso esteja em ambiente headless (SSH/terminal remoto) ou queira colar uma chave,',
    'você pode inseri-la diretamente abaixo.',
  ], 76));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let resolved = false;

  const authPromise = authenticateViaWebBrowser({
    onUrlReady: (url) => {
      console.log(`\n${ansi.bold}URL de Autorização:${ansi.reset}\n  ${ansi.cyan}${url}${ansi.reset}\n`);
      openBrowser(url);
    },
  });

  const webFlow = authPromise.then(async (result) => {
    if (!resolved) {
      resolved = true;
      await saveUserAuth({ apiKey: result.apiKey });
      console.log(`\n${ansi.brightGreen}✔ Autenticação via navegador concluída! Salva em ${getAuthFilePath()}${ansi.reset}`);
      return { apiKey: result.apiKey, ephemeral: false };
    }
    return null;
  });

  const manualFlow = rl.question(`${ansi.bold}Cole sua API Key do OpenRouter (ou autorize no navegador): ${ansi.reset}`).then(async (key) => {
    const trimmed = key.trim();
    if (trimmed && !resolved) {
      resolved = true;
      await saveUserAuth({ apiKey: trimmed });
      console.log(`\n${ansi.brightGreen}✔ Chave salva com sucesso em ${getAuthFilePath()}${ansi.reset}`);
      return { apiKey: trimmed, ephemeral: false };
    }
    return null;
  });

  try {
    const firstResult = await Promise.race([webFlow, manualFlow]);
    if (firstResult) {
      return firstResult;
    }
    // Se o usuário apertou Enter sem digitar chave, aguarda o fluxo do navegador
    const webResult = await webFlow;
    if (webResult) {
      return webResult;
    }
    throw new Error('Falha na autenticação.');
  } finally {
    rl.close();
  }
}


import {
  fuzzyScore,
  highlightMatches,
  searchModels,
  type FuzzyMatchResult,
} from './fuzzySearch.js';

export {
  fuzzyScore,
  highlightMatches,
  searchModels,
  type FuzzyMatchResult,
};

export async function selectModelModal(
  models: OpenRouterModel[],
  currentModel: string,
  initialQuery?: string
): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let currentFilter = (initialQuery || '').trim();

    while (true) {
      let displayModels: OpenRouterModel[];
      let title: string;

      if (currentFilter) {
        displayModels = searchModels(models, currentFilter, 12);
        title = `Search OpenRouter Models: "${currentFilter}" (${displayModels.length} matches)`;
      } else {
        const popularIds = [
          'deepseek/deepseek-v4.1-flash',
          'deepseek/deepseek-chat',
          'deepseek/deepseek-r1',
          'anthropic/claude-3.5-sonnet',
          'openai/gpt-4o',
          'openai/gpt-4o-mini',
          'qwen/qwen-2.5-coder-32b-instruct',
          'meta-llama/llama-3.3-70b-instruct',
          'google/gemini-2.0-flash-001',
        ];
        displayModels = models.filter((m) => popularIds.includes(m.id)).slice(0, 10);
        if (displayModels.length === 0 && models.length > 0) {
          displayModels = models.slice(0, 10);
        }
        title = 'Select OpenRouter Model';
      }

      const lines: string[] = [
        currentFilter
          ? `Models matching search query '${ansi.bold}${currentFilter}${ansi.reset}':`
          : 'Popular frontier & coding models on OpenRouter:',
        '',
      ];

      if (displayModels.length === 0) {
        lines.push(`  ${ansi.yellow}No models found matching '${currentFilter}'.${ansi.reset}`);
        lines.push('');
      } else {
        for (let idx = 0; idx < displayModels.length; idx++) {
          const m = displayModels[idx];
          const isCurrent = m.id === currentModel;
          const marker = isCurrent ? ` ${ansi.brightGreen}* (current)${ansi.reset}` : '';
          const ctx = m.context_length ? ` ${ansi.dim}[${Math.round(m.context_length / 1024)}k ctx]${ansi.reset}` : '';
          const match = currentFilter ? fuzzyScore(m.id, currentFilter) : null;
          const formattedId = match ? highlightMatches(m.id, match.indices) : `${ansi.cyan}${m.id}${ansi.reset}`;
          lines.push(`  ${ansi.bold}${idx + 1}.${ansi.reset} ${formattedId}${ctx}${marker}`);
        }
        lines.push('');
      }

      lines.push(`${ansi.dim}Options:${ansi.reset}`);
      if (displayModels.length > 0) {
        lines.push(`  • Type ${ansi.bold}1-${displayModels.length}${ansi.reset} to select a model`);
      }
      lines.push(`  • Type a search query (e.g. ${ansi.cyan}gpt${ansi.reset}, ${ansi.cyan}claude${ansi.reset}) to search OpenRouter`);
      lines.push(`  • Press ${ansi.bold}Enter${ansi.reset} or type ${ansi.bold}'q'${ansi.reset} / ${ansi.bold}'cancel'${ansi.reset} to close without changing`);

      console.log(`\n${box(title, lines, 80)}`);

      const answer = (
        await rl.question(
          `\n${ansi.bold}Choice, search query, or 'q' to close [current: ${currentModel}]: ${ansi.reset}`
        )
      ).trim();

      // Cancel / Close without modifying
      if (!answer || answer.toLowerCase() === 'q' || answer.toLowerCase() === 'cancel' || answer.toLowerCase() === 'exit') {
        return currentModel;
      }

      // Check number selection
      const num = parseInt(answer, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= displayModels.length) {
        return displayModels[num - 1].id;
      }

      // Exact ID match in full models catalog
      const exactMatch = models.find((m) => m.id.toLowerCase() === answer.toLowerCase());
      if (exactMatch) {
        return exactMatch.id;
      }

      // Query OpenRouter model catalog with new search term
      currentFilter = answer;
    }
  } finally {
    rl.close();
  }
}

export async function selectDomainModal(
  domains: DomainSummary[],
  currentDomain?: string
): Promise<string | undefined> {
  if (domains.length === 0) {
    console.log(box('No Domains Available', [
      'No domains found in .bsh/domains/ for this project.',
      'BSH will run in UNGOVERNED mode (no SHACL constraints).',
      'Run `bsh domain add <name>` to initialize a business domain.',
    ], 76));
    return undefined;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const lines = [
      'Choose which business ontology & SHACL rule set will govern this session:',
      '',
      ...domains.map((d, idx) => {
        const marker = d.id === currentDomain ? `${ansi.brightGreen}* (active)${ansi.reset}` : '';
        return `  ${ansi.bold}${idx + 1}.${ansi.reset} ${ansi.cyan}${d.id}${ansi.reset} - ${d.classesCount} classes, ${d.shapesCount} SHACL shapes ${marker}`;
      }),
      '',
      `Type number (1-${domains.length}) or press Enter to keep current:`,
    ];

    console.log(`\n${box('Select Business Domain & Governance Rules', lines, 76)}`);

    const answer = (await rl.question(`\n${ansi.bold}Domain selection: ${ansi.reset}`)).trim();
    if (!answer && currentDomain) {
      return currentDomain;
    }

    const num = parseInt(answer, 10);
    if (!Number.isNaN(num) && num >= 1 && num <= domains.length) {
      return domains[num - 1].id;
    }

    const matched = domains.find((d) => d.id.toLowerCase() === answer.toLowerCase());
    return matched ? matched.id : currentDomain || domains[0].id;
  } finally {
    rl.close();
  }
}

export async function diffReviewModal(
  diffText: string,
  conforms: boolean,
  violations: string[] = []
): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n${ansi.bold}=== Workspace Diff & Semantic Review ===${ansi.reset}`);
    if (!diffText.trim()) {
      console.log(`${ansi.dim}No modified files detected in session workspace.${ansi.reset}`);
      return false;
    }

    // Colorize diff lines
    for (const line of diffText.split('\n').slice(0, 50)) {
      if (line.startsWith('+')) {
        console.log(`${ansi.green}${line}${ansi.reset}`);
      } else if (line.startsWith('-')) {
        console.log(`${ansi.red}${line}${ansi.reset}`);
      } else if (line.startsWith('@@')) {
        console.log(`${ansi.cyan}${line}${ansi.reset}`);
      } else {
        console.log(line);
      }
    }

    if (diffText.split('\n').length > 50) {
      console.log(`${ansi.dim}... [remaining diff truncated for review]${ansi.reset}`);
    }

    console.log('');
    if (!conforms) {
      console.log(`${ansi.bgGray}${ansi.brightRed} ✖ BLOCKED BY SEMANTIC GATE: VIOLATIONS DETECTED ${ansi.reset}`);
      for (const v of violations) {
        console.log(`  ${ansi.red}• ${v}${ansi.reset}`);
      }
      console.log(`${ansi.yellow}\nCannot promote to primary branch while domain rules are violated.${ansi.reset}`);
      await rl.question(`\n${ansi.dim}Press Enter to return to agent...${ansi.reset}`);
      return false;
    }

    console.log(`${ansi.bgBlue}${ansi.brightGreen} ✔ SEMANTIC GATE PASSED: ALL RULES SATISFIED ${ansi.reset}`);
    const answer = (await rl.question(`\n${ansi.bold}Promote this change to primary branch? [y/N]: ${ansi.reset}`)).trim();
    return answer.toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

export interface SettingsState {
  confirmPromptViolations: boolean;
  model: string;
  domain?: string;
}

export async function settingsModal(
  currentSettings: SettingsState
): Promise<SettingsState> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\n');
    const statusText = currentSettings.confirmPromptViolations
      ? `${ansi.brightGreen}[ENABLED] (Pausar e solicitar Enter ao detectar violações no prompt)${ansi.reset}`
      : `${ansi.yellow}[DISABLED] (Executar diretamente sem pausa)${ansi.reset}`;

    console.log(box('BSH Settings & Preferences', [
      `1. Confirmar Prompts Violadores: ${statusText}`,
      `   Modelo Ativo: ${ansi.cyan}${currentSettings.model}${ansi.reset}`,
      `   Domínio Ativo: ${ansi.magenta}${currentSettings.domain || 'none'}${ansi.reset}`,
      '',
      'Ações disponíveis:',
      '  [1] Alternar confirmação de prompts violadores (Toggle ON/OFF)',
      '  [q/Enter] Salvar e retornar à sessão',
    ], 76));

    const answer = (await rl.question(`\n${ansi.bold}Escolha uma opção [1 / Enter para sair]: ${ansi.reset}`)).trim();
    if (answer === '1') {
      const updated = {
        ...currentSettings,
        confirmPromptViolations: !currentSettings.confirmPromptViolations,
      };
      const newStatus = updated.confirmPromptViolations ? `${ansi.brightGreen}ATIVADA${ansi.reset}` : `${ansi.yellow}DESATIVADA${ansi.reset}`;
      console.log(`\n✔ Confirmação de prompts violadores alterada para: ${newStatus}`);
      await rl.question(`\n${ansi.dim}Pressione Enter para continuar...${ansi.reset}`);
      return updated;
    }

    return currentSettings;
  } finally {
    rl.close();
  }
}

export async function selectSkillModal(
  skills: Skill[],
  activeSkills: string[] = [],
  initialQuery?: string
): Promise<{ selectedSkillName?: string; action: 'toggle' | 'show' | 'close' }> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let query = (initialQuery || '').trim();

  try {
    while (true) {
      let scored = skills.map((s) => {
        const match = fuzzyScore(s.name, query);
        return { skill: s, score: match ? match.score : -1, indices: match ? match.indices : [] };
      });

      if (query) {
        scored = scored.filter((item) => item.score >= 0);
        scored.sort((a, b) => b.score - a.score);
      }

      const visibleItems = scored.slice(0, 15);
      const lines: string[] = [
        'Skills fornecem diretivas operacionais especializadas para o agente BSH.',
        'Digite um termo para filtrar ou o número para alternar a ativação da skill.',
        '',
        `Busca atual: ${query ? `${ansi.yellow}${query}${ansi.reset}` : `${ansi.dim}(todas as skills)${ansi.reset}`}`,
        '',
      ];

      if (visibleItems.length === 0) {
        lines.push(`  ${ansi.red}Nenhuma skill encontrada para o termo "${query}".${ansi.reset}`);
      } else {
        for (let i = 0; i < visibleItems.length; i++) {
          const { skill, indices } = visibleItems[i];
          const isActive = activeSkills.includes(skill.name);
          const activeMarker = isActive ? ` ${ansi.brightGreen}[ATIVA]${ansi.reset}` : '';
          const scopeMarker = skill.scope === 'project' ? `${ansi.cyan}[project]${ansi.reset}` : `${ansi.dim}[global]${ansi.reset}`;
          const highlightedName = query && indices.length > 0 ? highlightMatches(skill.name, indices) : skill.name;
          const desc = skill.description.length > 55 ? `${skill.description.slice(0, 52)}...` : skill.description;
          lines.push(`  ${ansi.bold}${i + 1}.${ansi.reset} ${highlightedName} ${scopeMarker}${activeMarker} - ${ansi.dim}${desc}${ansi.reset}`);
        }
      }

      lines.push('');
      lines.push(`Total de skills: ${skills.length} | Ativas: ${activeSkills.length}`);
      lines.push(`Comandos: [1-${visibleItems.length}] alternar ativação | /show <N> ver detalhes | q ou Enter sair`);

      console.log(`\n${box('Gerenciador de Skills do BSH', lines, 78)}`);

      const answer = (await rl.question(`\n${ansi.bold}Ação ou busca [q/Enter para voltar]: ${ansi.reset}`)).trim();
      if (!answer || answer.toLowerCase() === 'q') {
        return { action: 'close' };
      }

      if (answer.startsWith('/show ')) {
        const num = parseInt(answer.replace('/show ', '').trim(), 10);
        if (!Number.isNaN(num) && num >= 1 && num <= visibleItems.length) {
          return { selectedSkillName: visibleItems[num - 1].skill.name, action: 'show' };
        }
      }

      const num = parseInt(answer, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= visibleItems.length) {
        return { selectedSkillName: visibleItems[num - 1].skill.name, action: 'toggle' };
      }

      // Otherwise update search query
      query = answer;
    }
  } finally {
    rl.close();
    process.stdin.resume();
  }
}

import {
  DEFAULT_SLASH_COMMANDS,
  filterSlashCommands,
  renderSlashMenuBox,
  type SlashCommandDef,
} from './slashCommands.js';

async function runInteractiveSlashMenu(
  commands: SlashCommandDef[],
  initialQuery: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let query = (initialQuery || '').trim();
    let selectedIndex = 0;
    let scrollOffset = 0;

    const render = () => {
      const scored = filterSlashCommands(query, commands);
      const total = scored.length;
      if (selectedIndex >= total) {
        selectedIndex = Math.max(0, total - 1);
      }

      const boxLines = renderSlashMenuBox(
        { selectedIndex, scrollOffset, pageSize: 6, query },
        72,
        commands
      );

      process.stdout.write('\x1b[2J\x1b[H\n');
      for (const line of boxLines) {
        process.stdout.write(`  ${line}\n`);
      }
      process.stdout.write(`\n  ${ansi.bold}Search or navigate: ${ansi.reset}/${query}`);
    };

    nodeReadline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    render();

    const cleanup = (result: string | null) => {
      process.stdin.removeListener('keypress', onKey);
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(wasRaw || false);
      }
      resolve(result);
    };

    const onKey = (_str: string, key: nodeReadline.Key) => {
      if (!key) return;

      const scored = filterSlashCommands(query, commands);
      const total = scored.length;

      // Cancel / Dismiss
      if (key.name === 'escape' || (key.ctrl && key.name === 'c') || (key.name === 'q' && !query)) {
        cleanup(null);
        return;
      }

      // Up arrow or 'k' when no query
      if (key.name === 'up' || (key.name === 'k' && !query)) {
        if (total > 0) {
          selectedIndex = (selectedIndex - 1 + total) % total;
          if (selectedIndex < scrollOffset) {
            scrollOffset = selectedIndex;
          } else if (selectedIndex >= scrollOffset + 6) {
            scrollOffset = selectedIndex - 6 + 1;
          }
          render();
        }
        return;
      }

      // Down arrow or 'j' when no query or tab
      if (key.name === 'down' || (key.name === 'j' && !query) || key.name === 'tab') {
        if (total > 0) {
          selectedIndex = (selectedIndex + 1) % total;
          if (selectedIndex >= scrollOffset + 6) {
            scrollOffset = selectedIndex - 6 + 1;
          } else if (selectedIndex < scrollOffset) {
            scrollOffset = selectedIndex;
          }
          render();
        }
        return;
      }

      // Enter / Return
      if (key.name === 'return' || key.name === 'enter') {
        if (total > 0 && scored[selectedIndex]) {
          cleanup(scored[selectedIndex].command.name);
        } else {
          cleanup(null);
        }
        return;
      }

      // Direct number selection '1' to '9' when query is empty
      if (!query && /^[1-9]$/.test(key.name || '')) {
        const num = parseInt(key.name || '', 10);
        if (num >= 1 && num <= total) {
          cleanup(scored[num - 1].command.name);
          return;
        }
      }

      // Backspace
      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          selectedIndex = 0;
          scrollOffset = 0;
          render();
        }
        return;
      }

      // Printable characters for search filter
      if (_str && _str.length === 1 && !key.ctrl && !key.meta) {
        query += _str;
        selectedIndex = 0;
        scrollOffset = 0;
        render();
      }
    };

    process.stdin.on('keypress', onKey);
  });
}

async function runFallbackSlashMenu(
  commands: SlashCommandDef[],
  initialQuery: string
): Promise<string | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let query = (initialQuery || '').trim();
  let selectedIndex = 0;
  const scrollOffset = 0;

  try {
    while (true) {
      const scored = filterSlashCommands(query, commands);
      const total = scored.length;

      const boxLines = renderSlashMenuBox(
        { selectedIndex, scrollOffset, pageSize: 6, query },
        72,
        commands
      );

      console.log(`\n${boxLines.map((l) => `  ${l}`).join('\n')}`);

      const answer = (await rl.question(`\n${ansi.bold}Choice [1-${Math.min(total, 6)} / search / q to close]: ${ansi.reset}`)).trim();
      if (!answer || answer.toLowerCase() === 'q') {
        return null;
      }

      // Check direct number selection
      const num = parseInt(answer, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= scored.length) {
        return scored[num - 1].command.name;
      }

      // Check if user typed an exact command name like "/exit" or "exit"
      const normalizedAnswer = answer.startsWith('/') ? answer.toLowerCase() : `/${answer.toLowerCase()}`;
      const exactMatch = commands.find((c) => c.name.toLowerCase() === normalizedAnswer);
      if (exactMatch) {
        return exactMatch.name;
      }

      // If user typed a search term that narrows to exactly 1 result and pressed Enter
      if (scored.length === 1 && answer.length >= 2) {
        return scored[0].command.name;
      }

      // Otherwise update search query
      query = answer;
      selectedIndex = 0;
    }
  } finally {
    rl.close();
    process.stdin.resume();
  }
}

export async function selectSlashCommandModal(
  commands: SlashCommandDef[] = DEFAULT_SLASH_COMMANDS,
  initialQuery = ''
): Promise<string | null> {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    return runInteractiveSlashMenu(commands, initialQuery);
  }
  return runFallbackSlashMenu(commands, initialQuery);
}

