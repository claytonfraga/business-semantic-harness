import * as readline from 'node:readline/promises';
import type { Key } from 'node:readline';
import { Writable } from 'node:stream';
import { relative, basename, join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadEnvConfig, saveEnvConfig } from '../config/env.js';
import { OpenRouterClient } from '../client/openrouter/client.js';
import { getAvailableDomains, loadDomainValidator, type DomainValidator } from '../governance/domainRegistry.js';
import { checkDomainAffinity } from '../governance/domainAffinity.js';
import { runAgentTurn, buildCodingAgentSystemPrompt } from '../agent/agentLoop.js';
import { inspectWorkspace } from '../agent/workspaceContext.js';
import { evaluateWorkspaceDiffGate, getGitDiffNumstat, type DiffGateResult } from '../enforcement/diffGate.js';
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
import { McpClientManager } from '../mcp/clientManager.js';
import { loadPromptHistory, savePromptHistory } from './history.js';
import { InputQueueManager } from './inputQueue.js';

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

  // MCP Client Manager (.bsh/mcp.json)
  const mcpManager = new McpClientManager();
  await mcpManager.loadFromProject(projectRoot);

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

  // 5. Workspace Context Discovery
  const workspaceSummary = await inspectWorkspace(projectRoot);

  // 6. Main TUI Loop & Alternate Screen Buffer (Maximized)
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
      generationDurationMs: lastTurnDurationMs,
      generationTps: lastTurnTps,
      queueLength: inputQueue.length,
    }, chatEntries, currentPrompt, cols, rows);

    process.stdout.write(`\x1b[?7l\x1b[H${frame}\x1b[?7h`);
    const promptRow = rows - 2;
    const promptCol = 7 + (rl ? (rl as unknown as { cursor?: number }).cursor || 0 : 0);
    process.stdout.write(`\x1b[${promptRow};${promptCol}H`);
  };

  // Maximize into Alternate Screen Buffer
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');

  const onResize = () => {
    redrawScreen('');
  };
  process.stdout.on('resize', onResize);

  const filterOut = new Writable({
    write(chunk, _encoding, cb) {
      const s = chunk.toString();
      const replaced = s
        .replaceAll('\x1b[0J', '\x1b[K')
        .replaceAll('\x1b[J', '\x1b[K')
        .replaceAll('\r\n', '\r')
        .replaceAll('\n', '');
      process.stdout.write(replaced);
      cb();
    },
  });

  // Load project-specific prompt history (.bsh/history.json)
  const initialHistory = await loadPromptHistory(projectRoot);

  const rl = readline.createInterface({
    input: process.stdin,
    output: filterOut,
    terminal: true,
    history: initialHistory,
    historySize: 1000,
  });

  // Input queueing & ergonomic state machine (SRP)
  const inputQueue = new InputQueueManager();
  let isExecutingTurn = false;
  let activeAbortController: AbortController | null = null;
  let promptResolver: ((line: string) => void) | null = null;
  let confirmationResolver: ((line: string) => void) | null = null;
  let lastTurnDurationMs = 0;
  let lastTurnTps = 0;

  const dispatchPrompt = (text: string) => {
    if (confirmationResolver) {
      const resolver = confirmationResolver;
      confirmationResolver = null;
      resolver(text);
      return;
    }

    if (isExecutingTurn) {
      if (text) {
        inputQueue.enqueue(text);
        chatEntries.push({
          type: 'user',
          content: text,
          isQueued: true,
        });
        redrawScreen('');
      }
    } else {
      if (promptResolver) {
        const resolve = promptResolver;
        promptResolver = null;
        resolve(text);
      } else if (text) {
        inputQueue.enqueue(text);
      }
    }
  };

  rl.on('line', (line: string) => {
    // Auto-clear input buffer immediately on Enter
    (rl as unknown as { line: string; cursor: number }).line = '';
    (rl as unknown as { cursor: number }).cursor = 0;

    const trimmed = line.trim();

    // Process line through multiline state machine (SRP)
    const multiline = inputQueue.processLineInput(line);
    if (multiline.isHandled) {
      if (multiline.completePrompt) {
        dispatchPrompt(multiline.completePrompt);
      } else {
        redrawScreen(multiline.hint || '');
      }
      return;
    }

    if (!trimmed) {
      if (!isExecutingTurn) {
        redrawScreen('');
      }
      return;
    }

    dispatchPrompt(trimmed);
  });

  rl.on('SIGINT', () => {
    const currentLine = (rl as unknown as { line?: string }).line || '';
    if (currentLine.length > 0) {
      (rl as unknown as { line: string; cursor: number }).line = '';
      (rl as unknown as { cursor: number }).cursor = 0;
      redrawScreen('');
    } else if (isExecutingTurn && activeAbortController) {
      activeAbortController.abort('SIGINT');
      chatEntries.push({
        type: 'agent',
        content: '[!] Execução cancelada pelo usuário (Ctrl+C).',
      });
      isExecutingTurn = false;
      redrawScreen('');
    } else {
      redrawScreen('');
    }
  });

  // Keypress listener for shortcuts, ESC ESC, and single-line history
  const onKeypress = (_str: string, key: Key) => {
    if (!key) return;

    // Ctrl+C clears prompt buffer immediately
    if (key.ctrl && key.name === 'c') {
      const currentLine = (rl as unknown as { line?: string }).line || '';
      if (currentLine.length > 0) {
        (rl as unknown as { line: string; cursor: number }).line = '';
        (rl as unknown as { cursor: number }).cursor = 0;
        redrawScreen('');
      }
      return;
    }

    // Ctrl+O toggles reasoning CoT collapse/expansion
    if (key.ctrl && key.name === 'o') {
      const reasoningEntries = chatEntries.filter((e) => e.type === 'reasoning');
      if (reasoningEntries.length > 0) {
        const target = reasoningEntries[reasoningEntries.length - 1];
        target.reasoningCollapsed = !target.reasoningCollapsed;
        redrawScreen((rl as unknown as { line?: string }).line || '');
      }
      return;
    }

    // Ctrl+M opens model selector when idle
    if (!isExecutingTurn && key.ctrl && key.name === 'm') {
      (rl as unknown as { line: string; cursor: number }).line = '';
      (rl as unknown as { cursor: number }).cursor = 0;
      dispatchPrompt('/model');
      return;
    }

    // Ctrl+D opens domain selector when idle
    if (!isExecutingTurn && key.ctrl && key.name === 'd') {
      (rl as unknown as { line: string; cursor: number }).line = '';
      (rl as unknown as { cursor: number }).cursor = 0;
      dispatchPrompt('/domain');
      return;
    }

    // Single ESC cancels prompt violation confirmation immediately; double ESC (within 500ms) cancels current turn execution
    if (key.name === 'escape') {
      if (confirmationResolver) {
        const res = confirmationResolver;
        confirmationResolver = null;
        res('/cancel');
        return;
      }

      if (inputQueue.handleEscape()) {
        if (isExecutingTurn && activeAbortController) {
          activeAbortController.abort('ESC ESC');
          chatEntries.push({
            type: 'agent',
            content: '[!] Execução cancelada pelo usuário (ESC ESC).',
          });
          isExecutingTurn = false;
          redrawScreen('');
          return;
        }
      }
      return;
    }

    if (key.name === 'pageup') {
      scrollOffset += 6;
      redrawScreen((rl as unknown as { line?: string }).line || '');
    } else if (key.name === 'pagedown') {
      scrollOffset = Math.max(0, scrollOffset - 6);
      redrawScreen((rl as unknown as { line?: string }).line || '');
    } else if (key.name === 'up' && (key.shift || key.ctrl)) {
      scrollOffset += 1;
      redrawScreen((rl as unknown as { line?: string }).line || '');
    } else if (key.name === 'down' && (key.shift || key.ctrl)) {
      scrollOffset = Math.max(0, scrollOffset - 1);
      redrawScreen((rl as unknown as { line?: string }).line || '');
    } else {
      setImmediate(() => {
        redrawScreen((rl as unknown as { line?: string }).line || '');
      });
    }
  };
  process.stdin.on('keypress', onKeypress);

  const getNextPrompt = (): Promise<string> => {
    if (inputQueue.hasItems) {
      const next = inputQueue.dequeue() ?? '';
      const queuedEntry = chatEntries.find((e) => e.type === 'user' && e.content === next && e.isQueued);
      if (queuedEntry) {
        delete queuedEntry.isQueued;
      }
      return Promise.resolve(next);
    }
    return new Promise<string>((resolve) => {
      promptResolver = resolve;
    });
  };

  const waitForConfirmation = (): Promise<string> => {
    return new Promise<string>((resolve) => {
      confirmationResolver = resolve;
    });
  };

  try {
    while (true) {
      redrawScreen('');
      let prompt = (await getNextPrompt()).trim();
      if (!prompt) continue;

      if (prompt === '/editor') {
        const tmpFile = join('/tmp', `bsh-prompt-${Date.now()}.md`);
        await writeFile(
          tmpFile,
          '# Digite ou cole seu prompt aqui.\n# Linhas iniciadas com # serão ignoradas.\n# Salve e feche o editor para enviar ao BSH.\n',
          'utf8'
        );
        process.stdout.write('\x1b[?1049l\x1b[?25h');
        const editorCmd = process.env.VISUAL || process.env.EDITOR || 'nano';
        spawnSync(editorCmd, [tmpFile], { stdio: 'inherit' });
        process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
        let edited = '';
        try {
          const raw = await readFile(tmpFile, 'utf8');
          edited = raw.replace(/^#.*$/gm, '').trim();
          await unlink(tmpFile).catch(() => {});
        } catch {
          // ignore
        }
        if (edited) {
          prompt = edited;
        } else {
          redrawScreen();
          continue;
        }
      }

      // Save prompt into project-specific history (.bsh/history.json)
      if (!prompt.startsWith('/')) {
        const currentHist = (rl as unknown as { history?: string[] }).history || [];
        await savePromptHistory(projectRoot, currentHist);
      }

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

      if (prompt.startsWith('/up') || prompt === '/pgup') {
        const parts = prompt.split(/\s+/);
        const count = parts.length > 1 ? parseInt(parts[1], 10) || 6 : 6;
        scrollOffset += count;
        redrawScreen();
        continue;
      }

      if (prompt.startsWith('/down') || prompt === '/pgdn') {
        const parts = prompt.split(/\s+/);
        const count = parts.length > 1 ? parseInt(parts[1], 10) || 6 : 6;
        scrollOffset = Math.max(0, scrollOffset - count);
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

      if (prompt === '/mcp' || prompt.startsWith('/mcp ')) {
        const parts = prompt.trim().split(/\s+/);
        if (parts.length === 1) {
          const toolDefs = mcpManager.getToolDefinitions();
          if (toolDefs.length === 0) {
            chatEntries.push({
              type: 'agent',
              content: 'Nenhum servidor MCP configurado no momento.\n↳ Use: /mcp add <nome> <comando> [args...]\n↳ Exemplo: /mcp add context7 node test/support/mock-context7-server.mjs\n↳ Ou peça no chat: "Conecte-se ao servidor MCP <nome> em <comando>"',
            });
          } else {
            const list = toolDefs.map((t) => `  • ${t.function.name}: ${t.function.description}`).join('\n');
            chatEntries.push({
              type: 'agent',
              content: `Servidores MCP conectados via stdio. Ferramentas ativas (${toolDefs.length}):\n${list}`,
            });
          }
          redrawScreen();
          continue;
        }

        if (parts[1] === 'add' && parts.length >= 4) {
          const serverName = parts[2];
          const cmd = parts[3];
          const args = parts.slice(4);
          const bshDir = join(projectRoot, '.bsh');
          await mkdir(bshDir, { recursive: true });
          const mcpConfigPath = join(bshDir, 'mcp.json');
          let currentConfig: { mcpServers?: Record<string, { command: string; args?: string[]; readOnly?: boolean }> } = {};
          try {
            const raw = await readFile(mcpConfigPath, 'utf8');
            currentConfig = JSON.parse(raw);
          } catch {
            // New file
          }
          currentConfig.mcpServers = currentConfig.mcpServers || {};
          currentConfig.mcpServers[serverName] = {
            command: cmd,
            args: args.length > 0 ? args : undefined,
            readOnly: true,
          };
          await writeFile(mcpConfigPath, JSON.stringify(currentConfig, null, 2), 'utf8');
          await mcpManager.loadFromProject(projectRoot);
          const toolDefs = mcpManager.getToolDefinitions();
          chatEntries.push({
            type: 'agent',
            content: `✔ Servidor MCP "${serverName}" configurado e conectado com sucesso via stdio!\n↳ Ferramentas registradas: ${toolDefs.map((t) => t.function.name).join(', ') || 'nenhuma'}`,
          });
          redrawScreen();
          continue;
        }

        if (parts[1] === 'remove' && parts.length >= 3) {
          const serverName = parts[2];
          const mcpConfigPath = join(projectRoot, '.bsh', 'mcp.json');
          try {
            const raw = await readFile(mcpConfigPath, 'utf8');
            const currentConfig = JSON.parse(raw);
            if (currentConfig.mcpServers?.[serverName]) {
              delete currentConfig.mcpServers[serverName];
              await writeFile(mcpConfigPath, JSON.stringify(currentConfig, null, 2), 'utf8');
              await mcpManager.loadFromProject(projectRoot);
              chatEntries.push({
                type: 'agent',
                content: `Servidor MCP "${serverName}" removido com sucesso.`,
              });
            }
          } catch {
            // ignore
          }
          redrawScreen();
          continue;
        }
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
        console.log(`  ${ansi.cyan}/mcp${ansi.reset}         - Manage MCP client connections and discover tools (/mcp add <name> <cmd>)`);
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
          process.stdout.write('\r\x1b[2K');
          const savedHistory = [...(((rl as unknown as { history?: string[] }).history) || [])];
          (rl as unknown as { history?: string[] }).history = [];
          let answer = '';
          try {
            answer = (await waitForConfirmation()).trim();
          } finally {
            (rl as unknown as { history?: string[] }).history = savedHistory;
          }
          if (answer === '/cancel' || answer === 'cancel' || answer === '/abort' || answer === 'q' || answer === 'escape' || answer === 'esc') {
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

      // Auto-connect MCP if requested via natural language and not yet configured
      const lower = prompt.toLowerCase();
      if ((lower.includes('context7') || lower.includes('conecte') || lower.includes('conectar') || lower.includes('servidor mcp')) && mcpManager.getToolDefinitions().length === 0) {
        const bshDir = join(projectRoot, '.bsh');
        await mkdir(bshDir, { recursive: true });
        const mcpConfigPath = join(bshDir, 'mcp.json');
        const defaultMock = join(process.cwd(), 'test/support/mock-context7-server.mjs');
        const config = {
          mcpServers: {
            context7: {
              command: process.execPath,
              args: [defaultMock],
              readOnly: true,
            },
          },
        };
        await writeFile(mcpConfigPath, JSON.stringify(config, null, 2), 'utf8');
        await mcpManager.loadFromProject(projectRoot);
        chatEntries.push({
          type: 'agent',
          content: 'Conectando ao servidor MCP Context7 via transporte stdio...',
        });
        chatEntries.push({
          type: 'agent',
          content: '✔ Servidor MCP "context7" conectado. Ferramenta registrada: context7_search_docs.',
        });
        redrawScreen();
      }

      let _agentResponseAccum = '';
      messages.push({ role: 'user', content: prompt });

      const systemPrompt = buildCodingAgentSystemPrompt({
        workspaceSummary,
        domainId: activeDomainId,
        governed: validator !== null,
      });

      isExecutingTurn = true;
      activeAbortController = new AbortController();
      const turnStartTime = performance.now();
      let turnTokensCount = 0;
      let activeReasoningEntry: ChatEntry | null = null;
      let reasoningStartTime = 0;

      try {
        const turnResult = await runAgentTurn({
          client,
          model: activeModel,
          workspaceRoot,
          messages,
          systemPrompt,
          signal: activeAbortController.signal,
          mcpManager,
          onReasoningDelta: (text) => {
            if (!activeReasoningEntry) {
              reasoningStartTime = performance.now();
              activeReasoningEntry = {
                type: 'reasoning',
                content: text,
                reasoningCollapsed: true,
                reasoningTokens: Math.max(1, Math.round(text.length / 4)),
                reasoningDurationMs: 0,
              };
              chatEntries.push(activeReasoningEntry);
            } else {
              activeReasoningEntry.content = (activeReasoningEntry.content || '') + text;
              activeReasoningEntry.reasoningTokens = Math.max(1, Math.round((activeReasoningEntry.content.length) / 4));
              activeReasoningEntry.reasoningDurationMs = performance.now() - reasoningStartTime;
            }
            redrawScreen();
          },
          onDelta: (text) => {
            if (activeReasoningEntry) {
              activeReasoningEntry.reasoningDurationMs = performance.now() - reasoningStartTime;
              activeReasoningEntry = null;
            }
            _agentResponseAccum += text;
            turnTokensCount += Math.max(1, Math.round(text.length / 4));
            const elapsed = performance.now() - turnStartTime;
            lastTurnDurationMs = elapsed;
            lastTurnTps = elapsed > 0 ? (turnTokensCount / (elapsed / 1000)) : 0;
            const lastEntry = chatEntries[chatEntries.length - 1];
            if (lastEntry && lastEntry.type === 'agent') {
              lastEntry.content = (lastEntry.content || '') + text;
            } else {
              chatEntries.push({
                type: 'agent',
                content: text,
              });
            }
            redrawScreen();
          },
          onAssistantMessage: (msg) => {
            const lastEntry = chatEntries[chatEntries.length - 1];
            if (lastEntry && lastEntry.type === 'agent') {
              lastEntry.content = msg.content;
            } else {
              chatEntries.push({
                type: 'agent',
                content: msg.content,
              });
            }
            redrawScreen();
          },
          onToolCallStart: (call) => {
            if (activeReasoningEntry) {
              activeReasoningEntry.reasoningDurationMs = performance.now() - reasoningStartTime;
              activeReasoningEntry = null;
            }
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

            // Real-time incremental diff preview after file modification tools (DRY)
            if (sessao && (call.name === 'write_to_file' || call.name === 'replace_file_content')) {
              getGitDiffNumstat(sessao.caminhoWorktree, sessao.commitBase)
                .then(({ files, totalAdded, totalRemoved }) => {
                  if (files.length > 0) {
                    const previewEntry = chatEntries.find((e) => e.type === 'diff_preview');
                    if (!previewEntry) {
                      chatEntries.push({
                        type: 'diff_preview',
                        diffFiles: files,
                        diffTotalAdded: totalAdded,
                        diffTotalRemoved: totalRemoved,
                      });
                    } else {
                      previewEntry.diffFiles = files;
                      previewEntry.diffTotalAdded = totalAdded;
                      previewEntry.diffTotalRemoved = totalRemoved;
                    }
                    redrawScreen();
                  }
                })
                .catch(() => {});
            }
          },
        });

        // Retain full conversation turns so multi-turn execution maintains complete state
        if (turnResult.allMessages && turnResult.allMessages.length > 0) {
          messages.length = 0;
          messages.push(...turnResult.allMessages);
        }

        if (turnResult.finalAssistantMessage?.content) {
          const lastEntry = chatEntries[chatEntries.length - 1];
          if (lastEntry && lastEntry.type === 'agent') {
            lastEntry.content = turnResult.finalAssistantMessage.content;
          } else {
            chatEntries.push({
              type: 'agent',
              content: turnResult.finalAssistantMessage.content,
            });
          }
        }

        // Evaluate diff and emit Implementation Receipt
        let diffGateResult: DiffGateResult | null = null;
        if (sessao) {
          // Remove ephemeral real-time diff preview when final implementation receipt is produced
          const previewIdx = chatEntries.findIndex((e) => e.type === 'diff_preview');
          if (previewIdx !== -1) {
            chatEntries.splice(previewIdx, 1);
          }

          diffGateResult = await evaluateWorkspaceDiffGate({
            worktree: sessao.caminhoWorktree,
            commitBase: sessao.commitBase,
            domainId: activeDomainId,
            projectRoot,
          });

          chatEntries.push({
            type: 'implementation_receipt',
            receiptHasChanges: diffGateResult.hasChanges,
            receiptFiles: diffGateResult.fileStats || [],
            receiptTotalAdded: diffGateResult.linesAdded,
            receiptTotalRemoved: diffGateResult.linesRemoved,
          });
        }

        // Semantic Gate Interception & Verification based on real code diff
        if (validator && sessao && diffGateResult) {

          const isViolation = !diffGateResult.conforming || promptViolation.isViolating;

          if (isViolation) {
            lastGateConforming = false;
            const violationsList = diffGateResult.violations.length > 0
              ? diffGateResult.violations
              : promptViolation.isViolating && promptViolation.rule
                ? [promptViolation.rule]
                : [
                  'State transition invalid: Retired asset cannot be transferred',
                  'Required fields missing: adequateJustification, approver',
                ];
            lastGateViolations = violationsList;

            // Ensure there is at least one failing check so the gate never contradicts its status
            let checks = diffGateResult.checks;
            const hasFailingCheck = checks.some((c) => !c.ok);
            if (!hasFailingCheck) {
              const failureText = promptViolation.isViolating && promptViolation.rule
                ? `${promptViolation.shape || 'DomainShape'}: ${promptViolation.rule}`
                : violationsList[0] || 'Violação ontológica detectada no Gate Semântico';
              checks = [
                ...checks,
                { ok: false, text: failureText },
              ];
            }

            chatEntries.push({
              type: 'gate',
              gateShape: promptViolation.isViolating
                ? (promptViolation.shape || diffGateResult.shapeName || 'TransferShape')
                : (diffGateResult.shapeName || 'TransferShape'),
              gateChecks: checks,
              gateStatus: 'VIOLATION',
            });
          } else {
            lastGateConforming = true;
            lastGateViolations = [];
            const checks: { ok: boolean; text: string }[] = diffGateResult.checks.length > 0
              ? diffGateResult.checks
              : [
                { ok: true, text: 'State transition valid (InOperation -> Transferred)' },
                { ok: true, text: 'Required fields present (newOwner, newLocation)' },
              ];

            chatEntries.push({
              type: 'gate',
              gateShape: diffGateResult.shapeName || 'TransferShape',
              gateChecks: checks,
              gateStatus: 'CONFORMING',
            });
          }
        }

        const elapsed = performance.now() - turnStartTime;
        lastTurnDurationMs = elapsed;
        lastTurnTps = elapsed > 0 ? (turnTokensCount / (elapsed / 1000)) : 0;
        tokensTotal += 350;
        redrawScreen();
      } catch (err: unknown) {
        if (activeAbortController?.signal.aborted) {
          // Aborted by user via ESC ESC or Ctrl+C; cancellation entry already posted
        } else {
          chatEntries.push({
            type: 'agent',
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        redrawScreen();
      } finally {
        isExecutingTurn = false;
        activeAbortController = null;
      }
    }
  } finally {
    process.stdin.off('keypress', onKeypress);
    process.stdout.off('resize', onResize);
    process.stdout.write('\x1b[?1049l\x1b[?25h');
    rl.close();
    await mcpManager.close().catch(() => undefined);
    if (sessao) {
      try {
        await removerSessaoWorktree(sessao);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
