import * as readline from 'node:readline/promises';
import { ansi, box } from './ansi.js';
import type { OpenRouterModel } from '../client/openrouter/types.js';
import type { DomainSummary } from '../governance/domainRegistry.js';

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
