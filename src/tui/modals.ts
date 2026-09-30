import * as readline from 'node:readline/promises';
import { ansi, box } from './ansi.js';
import type { OpenRouterModel } from '../client/openrouter/types.js';
import type { DomainSummary } from '../governance/domainRegistry.js';

export async function promptApiKeyModal(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\n');
    console.log(box('OpenRouter Authentication Required', [
      'No OPENROUTER_API_KEY found in environment or .env file.',
      '',
      'Please enter your OpenRouter API Key (e.g. sk-or-v1-...):',
      'The key will be verified and securely saved to your local .env file.',
    ], 76));

    const key = await rl.question(`\n${ansi.bold}OpenRouter API Key: ${ansi.reset}`);
    return key.trim();
  } finally {
    rl.close();
  }
}

export async function selectModelModal(
  models: OpenRouterModel[],
  currentModel: string
): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // Filter to top popular / coding models for fast selection, plus manual input
    const popularIds = [
      'deepseek/deepseek-chat',
      'deepseek/deepseek-r1',
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'qwen/qwen-2.5-coder-32b-instruct',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-001',
    ];

    const displayModels = models
      .filter((m) => popularIds.includes(m.id))
      .slice(0, 10);

    const lines = [
      'Select a model from the list below or type any model ID:',
      '',
      ...displayModels.map((m, idx) => {
        const marker = m.id === currentModel ? `${ansi.brightGreen}* (current)${ansi.reset}` : '';
        const ctx = m.context_length ? ` [${Math.round(m.context_length / 1024)}k ctx]` : '';
        return `  ${ansi.bold}${idx + 1}.${ansi.reset} ${ansi.cyan}${m.id}${ansi.reset}${ctx} ${marker}`;
      }),
      '',
      `Type number (1-${displayModels.length}), a model name to search, or press Enter to keep current.`,
    ];

    console.log('\n' + box('Select OpenRouter Model', lines, 76));

    const answer = (await rl.question(`\n${ansi.bold}Model choice or ID [${currentModel}]: ${ansi.reset}`)).trim();
    if (!answer) {
      return currentModel;
    }

    const num = parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= displayModels.length) {
      return displayModels[num - 1].id;
    }

    // Direct match or search
    const found = models.find((m) => m.id.toLowerCase() === answer.toLowerCase());
    if (found) return found.id;

    // Custom model ID entered by user
    return answer;
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

    console.log('\n' + box('Select Business Domain & Governance Rules', lines, 76));

    const answer = (await rl.question(`\n${ansi.bold}Domain selection: ${ansi.reset}`)).trim();
    if (!answer && currentDomain) {
      return currentDomain;
    }

    const num = parseInt(answer, 10);
    if (!isNaN(num) && num >= 1 && num <= domains.length) {
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
    console.log('\n' + ansi.bold + '=== Workspace Diff & Semantic Review ===' + ansi.reset);
    if (!diffText.trim()) {
      console.log(ansi.dim + 'No modified files detected in session workspace.' + ansi.reset);
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
      console.log(ansi.dim + '... [remaining diff truncated for review]' + ansi.reset);
    }

    console.log('');
    if (!conforms) {
      console.log(`${ansi.bgGray}${ansi.brightRed} ✖ BLOCKED BY SEMANTIC GATE: VIOLATIONS DETECTED ${ansi.reset}`);
      for (const v of violations) {
        console.log(`  ${ansi.red}• ${v}${ansi.reset}`);
      }
      console.log(ansi.yellow + '\nCannot promote to primary branch while domain rules are violated.' + ansi.reset);
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
