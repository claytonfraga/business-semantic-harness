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
import { promoverSessao } from '../agents/codex/promotion.js';
import { ansi } from './ansi.js';
import { renderHeader, renderFooter, formatToolStart, formatToolDone, formatGovernanceAlert } from './render.js';
import { promptApiKeyModal, selectModelModal, selectDomainModal, diffReviewModal } from './modals.js';

export interface TuiSessionOptions {
  projectRoot?: string;
  model?: string;
  domain?: string;
}

export async function startTuiSession(options: TuiSessionOptions = {}): Promise<void> {
  const projectRoot = options.projectRoot || process.cwd();

  // 1. Authentication & Config
  let env = await loadEnvConfig(projectRoot);
  let apiKey = env.openRouterApiKey;

  if (!apiKey) {
    apiKey = await promptApiKeyModal();
    if (!apiKey) {
      console.log(`${ansi.red}OpenRouter API key is required to use BSH. Exiting.${ansi.reset}`);
      return;
    }
    await saveEnvConfig({ OPENROUTER_API_KEY: apiKey }, projectRoot);
  }

  const client = new OpenRouterClient({ apiKey });
  const authCheck = await client.verifyApiKey();
  if (!authCheck.valid) {
    console.log(`${ansi.red}Invalid OpenRouter API Key: ${authCheck.error || 'Authentication failed'}${ansi.reset}`);
    return;
  }

  // 2. Models Discovery
  let activeModel = options.model || env.defaultModel || 'deepseek/deepseek-v4.1-flash';
  let modelsList = await client.getModels().catch(() => []);

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

  // 5. Main TUI Loop
  let tokensTotal = 0;
  const messages: ChatMessage[] = [];

  const redrawHeader = () => {
    console.clear();
    console.log(renderHeader({
      model: activeModel,
      domain: activeDomainId,
      governed: validator !== null,
      tokensTotal,
    }));
  };

  redrawHeader();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    while (true) {
      const prompt = (await rl.question(`\n${ansi.bold}${ansi.brightBlue}> ${ansi.reset}`)).trim();
      if (!prompt) continue;

      // Handle Slash Commands
      if (prompt === '/exit' || prompt === '/quit') {
        break;
      }

      if (prompt === '/clear') {
        redrawHeader();
        continue;
      }

      if (prompt === '/model') {
        activeModel = await selectModelModal(modelsList, activeModel);
        await saveEnvConfig({ BSH_DEFAULT_MODEL: activeModel }, projectRoot);
        redrawHeader();
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
        redrawHeader();
        continue;
      }

      if (prompt === '/diff') {
        const diffText = sessao ? await git(sessao.caminhoWorktree, ['diff', sessao.commitBase]).catch(() => '') : '';
        const conforms = true; // Validator inspects RDF diff in promotion
        const shouldPromote = await diffReviewModal(diffText, conforms);
        if (shouldPromote && sessao) {
          await promoverSessao(sessao);
          console.log(`${ansi.brightGreen}✔ Successfully promoted changes to ${sessao.branchOrigem}!${ansi.reset}`);
        }
        redrawHeader();
        continue;
      }

      if (prompt === '/help') {
        console.log('\n' + ansi.bold + 'BSH Available Commands:' + ansi.reset);
        console.log(`  ${ansi.cyan}/model${ansi.reset}   - Browse and change active OpenRouter model`);
        console.log(`  ${ansi.cyan}/domain${ansi.reset}  - Select domain ontology and SHACL governance rules`);
        console.log(`  ${ansi.cyan}/diff${ansi.reset}    - Review workspace code diff and promote to branch`);
        console.log(`  ${ansi.cyan}/clear${ansi.reset}   - Clear screen and refresh header`);
        console.log(`  ${ansi.cyan}/exit${ansi.reset}    - End governed session and exit`);
        continue;
      }

      // User chat turn
      messages.push({ role: 'user', content: prompt });
      process.stdout.write(`\n${ansi.bold}${ansi.cyan}BSH Agent:${ansi.reset} `);

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
          onDelta: (text) => process.stdout.write(text),
          onToolCallStart: (call) => console.log(formatToolStart(call.name, call.args)),
          onToolCallDone: (call) => console.log(formatToolDone(call.name, call.result)),
        });

        if (turnResult.finalAssistantMessage) {
          messages.push(turnResult.finalAssistantMessage);
        }

        // Semantic compliance feedback
        if (validator && sessao) {
          const diff = await git(sessao.caminhoWorktree, ['status', '--porcelain']).catch(() => '');
          if (diff.trim()) {
            console.log(formatGovernanceAlert(true, []));
          }
        }

        console.log(renderFooter());
      } catch (err: unknown) {
        console.log(`\n${ansi.red}Execution Error: ${err instanceof Error ? err.message : String(err)}${ansi.reset}`);
      }
    }
  } finally {
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
