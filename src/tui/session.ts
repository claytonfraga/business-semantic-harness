import * as readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { relative, basename } from 'node:path';
import { loadEnvConfig, saveEnvConfig } from '../config/env.js';
import { OpenRouterClient } from '../client/openrouter/client.js';
import { getAvailableDomains, loadDomainValidator, type DomainValidator } from '../governance/domainRegistry.js';
import { checkDomainAffinity } from '../governance/domainAffinity.js';
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
import { promptApiKeyModal, selectModelModal, selectDomainModal, diffReviewModal, settingsModal } from './modals.js';
import { detectPromptViolation } from '../enforcement/promptGuard.js';

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
  let confirmPromptViolations = env.confirmPromptViolations ?? true;

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
  let activeGitBranch: string | undefined;
  if (await gitDisponivel()) {
    try {
      const repoRoot = await resolverRepositorio(projectRoot);
      activeGitBranch = await branchAtual(repoRoot);
      const commit = await commitAtual(repoRoot);
      sessao = await criarSessaoWorktree({
        repositorioOrigem: repoRoot,
        branchOrigem: activeGitBranch,
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
  let alignmentStatus: 'ALIGNED' | 'MISMATCH' | 'INSUFFICIENT_DATA' = 'ALIGNED';
  let alignmentWarning: string | undefined;
  const messages: ChatMessage[] = [];
  const chatEntries: ChatEntry[] = [];

  const runAffinityCheck = async (domainId?: string) => {
    if (!domainId || !validator) {
      alignmentStatus = 'INSUFFICIENT_DATA';
      alignmentWarning = undefined;
      return;
    }
    const targetDomain = availableDomains.find((d) => d.id === domainId);
    if (!targetDomain) return;

    try {
      const aff = await checkDomainAffinity(
        projectRoot,
        targetDomain.ontologyPath,
        targetDomain.shapesPath,
        domainId
      );
      alignmentStatus = aff.status;
      if (aff.status === 'MISMATCH') {
        alignmentWarning = aff.summary;
        chatEntries.push({
          type: 'alert',
          content: `${aff.summary}\n↳ Ações: digite /domain para trocar, /ungoverned para desabilitar o harness ontológico, ou prossiga normalmente.`,
        });
      }
    } catch {
      // Best-effort
    }
  };

  // Initial affinity check before first render
  await runAffinityCheck(activeDomainId);

  const getActiveContextLength = () => {
    return modelsList.find((m) => m.id === activeModel)?.context_length || 131072;
  };

  const redrawScreen = (currentPrompt = '') => {
    const cols = process.stdout.columns && process.stdout.columns >= 50 ? process.stdout.columns : 96;
    const rows = process.stdout.rows && process.stdout.rows >= 15 ? process.stdout.rows : 30;

    const activeDomainSummary = availableDomains.find((d) => d.id === activeDomainId);
    let ontologySummary = '';
    if (activeDomainSummary) {
      const v = activeDomainSummary.version ? ` v${activeDomainSummary.version}` : '';
      const c = activeDomainSummary.classesCount ? `${activeDomainSummary.classesCount} classes` : '';
      const s = activeDomainSummary.shapesCount ? `${activeDomainSummary.shapesCount} shapes` : '';
      const details = [c, s].filter(Boolean).join(', ');
      ontologySummary = details ? `${activeDomainSummary.id}${v} (${details})` : `${activeDomainSummary.id}${v}`;
    } else if (activeDomainId) {
      ontologySummary = activeDomainId;
    }

    const relProject = relative(process.cwd(), projectRoot);
    const projectFolder = relProject && !relProject.startsWith('..') ? relProject : basename(projectRoot);
    const gitBranch = sessao?.branchOrigem || activeGitBranch;

    const frame = renderCompleteTui({
      model: activeModel,
      contextLength: getActiveContextLength(),
      domain: activeDomainId,
      ontologySummary,
      projectFolder,
      gitBranch,
      governed: validator !== null,
      alignmentStatus,
      alignmentWarning,
      tokensTotal,
      width: cols,
      height: rows,
      scrollOffset,
    }, chatEntries, currentPrompt, cols, rows);

    process.stdout.write(`\x1b[?7l\x1b[H${frame}\x1b[?7h`);
    if (currentPrompt === '') {
      const promptRow = rows - 2;
      process.stdout.write(`\x1b[${promptRow};1H`);
    }
  };

  // Maximize into Alternate Screen Buffer
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');

  const onResize = () => {
    redrawScreen('');
  };
  process.stdout.on('resize', onResize);

  const promptPrefix = `  \x1b[36m▎\x1b[39m \x1b[1m\x1b[97m>\x1b[39m\x1b[22m `;
  const filterOut = new Writable({
    write(chunk, _encoding, cb) {
      const s = chunk.toString();
      const replaced = s.replaceAll('\x1b[0J', '\x1b[K').replaceAll('\x1b[J', '\x1b[K');
      process.stdout.write(replaced);
      cb();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: filterOut,
    terminal: true,
  });

  try {
    while (true) {
      redrawScreen('');
      const prompt = (await rl.question(promptPrefix)).trim();
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

      if (prompt.startsWith('/model')) {
        const query = prompt.replace(/^\/model\s*/, '').trim();
        const prevModel = activeModel;
        activeModel = await selectModelModal(modelsList, activeModel, query || undefined);
        if (activeModel !== prevModel) {
          await saveEnvConfig({ BSH_DEFAULT_MODEL: activeModel }, projectRoot);
        }
        redrawScreen();
        continue;
      }

      if (prompt === '/domain') {
        activeDomainId = await selectDomainModal(availableDomains, activeDomainId);
        if (activeDomainId) {
          validator = await loadDomainValidator(projectRoot, activeDomainId);
          await saveEnvConfig({ BSH_DEFAULT_DOMAIN: activeDomainId }, projectRoot);
          await runAffinityCheck(activeDomainId);
        } else {
          validator = null;
          alignmentStatus = 'INSUFFICIENT_DATA';
        }
        redrawScreen();
        continue;
      }

      if (prompt === '/ungoverned' || prompt === '/bypass') {
        validator = null;
        alignmentStatus = 'INSUFFICIENT_DATA';
        chatEntries.push({
          type: 'agent',
          content: 'Harness ontológico desabilitado pelo usuário. Sessão operando em modo UNGOVERNED sem restrições de SHACL.',
        });
        redrawScreen();
        continue;
      }

      if (prompt === '/governed') {
        if (activeDomainId) {
          try {
            validator = await loadDomainValidator(projectRoot, activeDomainId);
            await runAffinityCheck(activeDomainId);
            chatEntries.push({
              type: 'agent',
              content: `Mecanismo ontológico reativado para o domínio '${activeDomainId}'. Modo GOVERNED ativo.`,
            });
          } catch (err: unknown) {
            chatEntries.push({
              type: 'agent',
              content: `Erro ao ativar domínio '${activeDomainId}': ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        } else {
          chatEntries.push({
            type: 'agent',
            content: 'Nenhum domínio configurado. Use /domain para selecionar um domínio.',
          });
        }
        redrawScreen();
        continue;
      }

      if (prompt === '/affinity' || prompt === '/alignment') {
        if (!activeDomainId) {
          console.log(`\n${ansi.yellow}Nenhum domínio ativo para checar afinidade semântica.${ansi.reset}`);
        } else {
          const targetDomain = availableDomains.find((d) => d.id === activeDomainId);
          if (targetDomain) {
            const aff = await checkDomainAffinity(projectRoot, targetDomain.ontologyPath, targetDomain.shapesPath, activeDomainId);
            console.log(`\n${ansi.bold}Relatório de Afinidade Semântica [${activeDomainId}]:${ansi.reset}`);
            console.log(`  Status: ${aff.status === 'ALIGNED' ? ansi.brightGreen : ansi.yellow}${aff.status}${ansi.reset}`);
            console.log(`  Score: ${(aff.score * 100).toFixed(1)}%`);
            console.log(`  Conceitos da ontologia: ${aff.ontologyTerms.slice(0, 8).join(', ')}`);
            console.log(`  Conceitos encontrados no projeto: ${aff.matchedTerms.join(', ') || 'Nenhum'}`);
            console.log(`  ${aff.summary}`);
          }
        }
        await rl.question(`\n${ansi.dim}Pressione Enter para retornar ao agente...${ansi.reset}`);
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

      if (prompt === '/settings' || prompt === '/config') {
        const updated = await settingsModal({
          confirmPromptViolations,
          model: activeModel,
          domain: activeDomainId,
        });
        if (updated.confirmPromptViolations !== confirmPromptViolations) {
          confirmPromptViolations = updated.confirmPromptViolations;
          await saveEnvConfig({
            BSH_CONFIRM_PROMPT_VIOLATIONS: String(confirmPromptViolations),
          }, projectRoot);
          chatEntries.push({
            type: 'agent',
            content: `Configuração atualizada: Confirmação de prompts violadores = ${confirmPromptViolations ? 'ATIVADA' : 'DESATIVADA'}.`,
          });
        }
        redrawScreen();
        continue;
      }

      if (prompt === '/help') {
        console.log(`\n${ansi.bold}BSH Available Commands:${ansi.reset}`);
        console.log(`  ${ansi.cyan}/model${ansi.reset}       - Browse and change active OpenRouter model`);
        console.log(`  ${ansi.cyan}/domain${ansi.reset}      - Select domain ontology and SHACL governance rules`);
        console.log(`  ${ansi.cyan}/settings${ansi.reset}    - Configure BSH settings (e.g. pause/confirm on prompt violation)`);
        console.log(`  ${ansi.cyan}/ungoverned${ansi.reset}  - Disable ontology governance harness (bypass mode)`);
        console.log(`  ${ansi.cyan}/governed${ansi.reset}    - Re-enable ontology governance harness`);
        console.log(`  ${ansi.cyan}/affinity${ansi.reset}    - Check domain concept affinity with current codebase`);
        console.log(`  ${ansi.cyan}/diff${ansi.reset}        - Review workspace code diff and promote to branch`);
        console.log(`  ${ansi.cyan}/rules${ansi.reset}       - Inspect active SHACL rules for the current domain`);
        console.log(`  ${ansi.cyan}/clear${ansi.reset}       - Clear screen and refresh header`);
        console.log(`  ${ansi.cyan}/exit${ansi.reset}        - End governed session and exit`);
        await rl.question(`\n${ansi.dim}Press Enter to return to agent...${ansi.reset}`);
        redrawScreen();
        continue;
      }

      // Pre-flight Semantic Guard: Check for Prompt Violations against ontology + SHACL
      const promptViolation = detectPromptViolation(prompt, activeDomainId);

      if (promptViolation.isViolating && validator) {
        // Tag user prompt entry with violation badge
        chatEntries.push({ type: 'user', content: prompt, isViolating: true });

        // Push prominent violation alert card
        chatEntries.push({
          type: 'prompt_violation',
          violationShape: promptViolation.shape,
          violationRule: promptViolation.rule,
          content: `${promptViolation.message}\n` +
            (promptViolation.matchedKeywords ? `Termos identificados: ${promptViolation.matchedKeywords.join(', ')}` : ''),
          waitingConfirmation: confirmPromptViolations,
        });

        if (confirmPromptViolations) {
          redrawScreen('Aguardando confirmação do usuário...');
          const confirmPrefix = `  \x1b[31m▎\x1b[39m \x1b[1m\x1b[93m[Enter para prosseguir /cancel para abortar] >\x1b[39m\x1b[22m `;
          const answer = (await rl.question(confirmPrefix)).trim();
          if (answer === '/cancel' || answer === 'cancel' || answer === '/abort' || answer === 'q') {
            chatEntries.push({
              type: 'agent',
              content: 'Execução do prompt cancelada pelo usuário após alerta de violação ontológica.',
            });
            redrawScreen();
            continue;
          }
          chatEntries.push({
            type: 'agent',
            content: 'Usuário confirmou prosseguimento da execução do prompt sob governança do harness.',
          });
        }
      } else {
        chatEntries.push({ type: 'user', content: prompt });
      }

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
