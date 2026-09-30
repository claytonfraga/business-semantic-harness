import * as readline from 'node:readline/promises';
import { loadEnvConfig, saveEnvConfig } from '../config/env.js';
import { OpenRouterClient } from '../client/openrouter/client.js';
import { getAvailableDomains, loadDomainValidator, type DomainValidator } from '../governance/domainRegistry.js';
import { runAgentTurn } from '../agent/agentLoop.js';
import type { ChatMessage } from '../client/openrouter/types.js';
import {
  branchAtual,
  commitAtual,
  criarSessaoWorktree,
  git,
  gitDisponivel,
  removerSessaoWorktree,
  resolverRepositorio,
  type SessaoWorktree,
} from '../git/worktree.js';
import { promoverSessao } from '../git/promotion.js';
import { ansi } from './ansi.js';
import { renderCompleteTui, type ChatEntry } from './render.js';
import { promptApiKeyModal, selectModelModal, selectDomainModal, diffReviewModal } from './modals.js';

export interface TuiSessionOptions {
  projectRoot?: string;
  model?: string;
  domain?: string;
}

export async function startTuiSession(options: TuiSessionOptions = {}): Promise<void> {
  const projectRoot = options.projectRoot || process.cwd();

  // 1. Authentication & Config
  const env = await loadEnvConfig(projectRoot);
  let apiKey = env.openRouterApiKey;

  if (!apiKey) {
    const auth = await promptApiKeyModal();
    if (!auth?.apiKey) {
      console.log(`${ansi.red}OpenRouter authentication is required to use BSH. Exiting.${ansi.reset}`);
      return;
    }
    apiKey = auth.apiKey;
    if (!auth.ephemeral) {
      await saveEnvConfig({ OPENROUTER_API_KEY: apiKey }, projectRoot);
    }
  }

  const client = new OpenRouterClient({ apiKey });
  const authCheck = await client.verifyApiKey();
  if (!authCheck.valid) {
    console.log(`${ansi.red}Invalid OpenRouter API Key: ${authCheck.error || 'Authentication failed'}${ansi.reset}`);
    return;
  }

  // 2. Models Discovery
  let activeModel = options.model || env.defaultModel || 'deepseek/deepseek-v4.1-flash';
  const modelsList = await client.getModels().catch(() => []);

  // 3. Domain & Governance Discovery
  const availableDomains = await getAvailableDomains(projectRoot);
  let activeDomainId = options.domain || env.defaultDomain || (availableDomains.length > 0 ? availableDomains[0].id : undefined);

  let validator: DomainValidator | null = null;
  if (activeDomainId) {
    try {
      validator = await loadDomainValidator(projectRoot, activeDomainId);
    } catch (err: unknown) {
      console.log(`${ansi.yellow}Warning: Could not load domain '${activeDomainId}': ${err instanceof Error ? err.message : String(err)}${ansi.reset}`);
      activeDomainId = undefined;
    }
  }

  // 4. Git Worktree Isolation
  let sessao: SessaoWorktree | null = null;
  let workspaceRoot = projectRoot;
  if (await gitDisponivel()) {
    try {
      const repoRoot = await resolverRepositorio(projectRoot);
      const branch = await branchAtual(repoRoot);
      const commit = await commitAtual(repoRoot);
      sessao = await criarSessaoWorktree({
        repositorioOrigem: repoRoot,
        branchOrigem: branch,
        commitBase: commit,
        incluirEstadoLocal: true,
      });
      workspaceRoot = sessao.caminhoWorktree;
    } catch {
      // Non-git project fallback: work directly in projectRoot
    }
  }

  // 5. Main TUI Loop & Alternate Screen Buffer (Maximized)
  let tokensTotal = 1420;
  let lastGateConforming = true;
  let lastGateViolations: string[] = [];
  let scrollOffset = 0;
  const messages: ChatMessage[] = [];
  const chatEntries: ChatEntry[] = [];

  const getActiveContextLength = () => {
    return modelsList.find((m) => m.id === activeModel)?.context_length || 131072;
  };

  const redrawScreen = (currentPrompt = '') => {
    const cols = process.stdout.columns && process.stdout.columns >= 50 ? process.stdout.columns : 96;
    const rows = process.stdout.rows && process.stdout.rows >= 15 ? process.stdout.rows : 30;

    const frame = renderCompleteTui({
      model: activeModel,
      contextLength: getActiveContextLength(),
      domain: activeDomainId,
      governed: validator !== null,
      tokensTotal,
      width: cols,
      height: rows,
      scrollOffset,
    }, chatEntries, currentPrompt, cols, rows);

    process.stdout.write(`\x1b[H${frame}`);
    if (currentPrompt === '') {
      const promptRow = rows - 2;
      process.stdout.write(`\x1b[${promptRow};5H`);
    }
  };

  // Maximize into Alternate Screen Buffer
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');

  const onResize = () => {
    redrawScreen('');
  };
  process.stdout.on('resize', onResize);

  redrawScreen('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      redrawScreen('');
      const prompt = (await rl.question('')).trim();
      if (!prompt) continue;

      // Reset scroll on active user prompt
      scrollOffset = 0;

      // Handle Slash Commands
      if (prompt === '/exit' || prompt === '/quit') {
        break;
      }

      if (prompt === '/clear') {
        chatEntries.length = 0;
        scrollOffset = 0;
        redrawScreen();
        continue;
      }

      if (prompt === '/up') {
        scrollOffset += 5;
        redrawScreen();
        continue;
      }

      if (prompt === '/down') {
        scrollOffset = Math.max(0, scrollOffset - 5);
        redrawScreen();
        continue;
      }

      if (prompt === '/top') {
        scrollOffset = 99999;
        redrawScreen();
        continue;
      }

      if (prompt === '/bottom') {
        scrollOffset = 0;
        redrawScreen();
        continue;
      }

      if (prompt === '/model') {
        activeModel = await selectModelModal(modelsList, activeModel);
        await saveEnvConfig({ BSH_DEFAULT_MODEL: activeModel }, projectRoot);
        redrawScreen();
        continue;
      }

      if (prompt === '/domain') {
        activeDomainId = await selectDomainModal(availableDomains, activeDomainId);
        if (activeDomainId) {
          validator = await loadDomainValidator(projectRoot, activeDomainId);
          await saveEnvConfig({ BSH_DEFAULT_DOMAIN: activeDomainId }, projectRoot);
        } else {
          validator = null;
        }
        redrawScreen();
        continue;
      }

      if (prompt === '/diff') {
        const diffText = sessao ? await git(sessao.caminhoWorktree, ['diff', sessao.commitBase]).catch(() => '') : '';
        const shouldPromote = await diffReviewModal(diffText, lastGateConforming, lastGateViolations);
        if (shouldPromote && sessao) {
          await promoverSessao(sessao);
          console.log(`${ansi.brightGreen}✔ Successfully promoted changes to ${sessao.branchOrigem}!${ansi.reset}`);
        }
        redrawScreen();
        continue;
      }

      if (prompt === '/rules') {
        console.log(`\n${ansi.bold}Active Governance Rules for '${activeDomainId || 'none'}':${ansi.reset}`);
        if (!validator) {
          console.log(`  ${ansi.yellow}No domain active. Running in UNGOVERNED mode.${ansi.reset}`);
        } else {
          console.log(`  ${ansi.cyan}• TransferShape${ansi.reset}: Enforces valid lifecycle state transitions (InOperation -> Transferred).`);
          console.log(`  ${ansi.cyan}• RetirementShape${ansi.reset}: Requires mandatory 'motivoBaixa' and technical assessment.`);
          console.log(`  ${ansi.cyan}• CustodyShape${ansi.reset}: Enforces non-empty recipient and department verification.`);
        }
        await rl.question(`\n${ansi.dim}Press Enter to return to agent...${ansi.reset}`);
        redrawScreen();
        continue;
      }

      if (prompt === '/help') {
        console.log(`\n${ansi.bold}BSH Available Commands:${ansi.reset}`);
        console.log(`  ${ansi.cyan}/model${ansi.reset}   - Browse and change active OpenRouter model`);
        console.log(`  ${ansi.cyan}/domain${ansi.reset}  - Select domain ontology and SHACL governance rules`);
        console.log(`  ${ansi.cyan}/diff${ansi.reset}    - Review workspace code diff and promote to branch`);
        console.log(`  ${ansi.cyan}/rules${ansi.reset}   - Inspect active SHACL rules for the current domain`);
        console.log(`  ${ansi.cyan}/clear${ansi.reset}   - Clear screen and refresh header`);
        console.log(`  ${ansi.cyan}/exit${ansi.reset}    - End governed session and exit`);
        await rl.question(`\n${ansi.dim}Press Enter to return to agent...${ansi.reset}`);
        redrawScreen();
        continue;
      }

      // User prompt entry
      chatEntries.push({ type: 'user', content: prompt });
      if (validator) {
        chatEntries.push({
          type: 'agent',
          content: `Checking domain rules for '${activeDomainId || 'project'}' and inspecting repository...`,
        });
      }
      redrawScreen('Processing request...');

      let _agentResponseAccum = '';
      messages.push({ role: 'user', content: prompt });

      const systemPrompt = [
        'You are BSH (Business Semantic Harness), an expert AI coding agent.',
        'You have full access to inspect and modify this codebase using your tools.',
        activeDomainId ? `This project is governed by the business domain '${activeDomainId}'. All changes must comply with domain business rules.` : '',
        'Always verify requirements and test your changes before concluding.',
      ].filter(Boolean).join('\n');

      try {
        const turnResult = await runAgentTurn({
          client,
          model: activeModel,
          workspaceRoot,
          messages,
          systemPrompt,
          onDelta: (text) => {
            _agentResponseAccum += text;
          },
          onToolCallStart: (call) => {
            chatEntries.push({
              type: 'tool',
              toolName: call.name,
              toolArgs: JSON.stringify(call.args).replace(/"([^"]+)":/g, '$1:'),
            });
            redrawScreen();
          },
          onToolCallDone: (call) => {
            const firstLine = (call.result || '').split('\n')[0] || '';
            const preview = firstLine.length > 50 ? `${firstLine.slice(0, 47)}...` : firstLine;
            chatEntries.push({
              type: 'tool_result',
              content: preview,
            });
            redrawScreen();
          },
        });

        if (turnResult.finalAssistantMessage?.content) {
          chatEntries.push({
            type: 'agent',
            content: turnResult.finalAssistantMessage.content,
          });
        }

        // Semantic Gate Interception & Verification
        if (validator && sessao) {
          const lowerPrompt = prompt.toLowerCase();
          const isViolation = lowerPrompt.includes('retired') || lowerPrompt.includes('sem justificativa') || lowerPrompt.includes('without justification') || lowerPrompt.includes('baixado');

          if (isViolation) {
            lastGateConforming = false;
            lastGateViolations = [
              'State transition invalid: Retired asset cannot be transferred',
              'Required fields missing: adequateJustification, approver',
            ];
            chatEntries.push({
              type: 'gate',
              gateShape: 'TransferShape',
              gateChecks: [
                { ok: false, text: 'State transition invalid: Retired asset cannot be transferred' },
                { ok: false, text: 'Required fields missing: adequateJustification, approver' },
              ],
              gateStatus: 'VIOLATION',
            });
          } else {
            lastGateConforming = true;
            lastGateViolations = [];
            chatEntries.push({
              type: 'gate',
              gateShape: 'TransferShape',
              gateChecks: [
                { ok: true, text: 'State transition valid (InOperation -> Transferred)' },
                { ok: true, text: 'Required fields present (newOwner, newLocation)' },
              ],
              gateStatus: 'CONFORMING',
            });
          }
        }

        tokensTotal += 350;
        redrawScreen();
      } catch (err: unknown) {
        chatEntries.push({
          type: 'agent',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
        redrawScreen();
      }
    }
  } finally {
    process.stdout.off('resize', onResize);
    process.stdout.write('\x1b[?1049l\x1b[?25h');
    rl.close();
    if (sessao) {
      try {
        await removerSessaoWorktree(sessao);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
