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
import { createProductionFactsExtractor } from '../enforcement/evidenceAdapters.js';
import { ansi } from './ansi.js';
import type { ChatEntry, RenderState } from './state.js';
import { promptApiKeyModal, selectModelModal, selectDomainModal, diffReviewModal, settingsModal, selectSkillModal, selectSlashCommandModal } from './modals.js';
import { DEFAULT_SLASH_COMMANDS } from './slashCommands.js';
import { SkillRegistry } from '../skills/registry.js';
import { installSkillPackage } from '../skills/installer.js';
import { detectSkillInvocation, detectSemanticSkillNeed } from '../skills/activation.js';
import { prepareGovernedRequest, approvePreparedRequest, assertPreparedRequestCurrent } from '../governance/requestPreparation.js';
import { ApprovalBroker } from '../decision/broker.js';
import { McpClientManager } from '../mcp/clientManager.js';
import { loadPromptHistory, savePromptHistory } from './history.js';
import { InputQueueManager } from './inputQueue.js';
import { ExitGuard } from './exitGuard.js';
import { createTuiView, type TuiView } from './view.js';
import { SessionInputController } from './input.js';

export interface TuiSessionOptions {
  projectRoot?: string;
  model?: string;
  domain?: string;
  view?: TuiView;
  allowDirectExecution?: boolean;
  ungoverned?: boolean;
  /** Controlled model transport; the production preparation and dispatch remain unchanged. */
  client?: OpenRouterClient;
}

export async function startTuiSession(options: TuiSessionOptions = {}): Promise<void> {
  const projectRoot = options.projectRoot || process.cwd();

  // 1. Authentication & Config
  const env = await loadEnvConfig(projectRoot);
  let apiKey = env.openRouterApiKey;
  let confirmPromptViolations = env.confirmPromptViolations ?? true;

  if (!apiKey && !options.client) {
    const auth = await promptApiKeyModal(options.view);
    if (!auth?.apiKey) {
      console.log(`${ansi.red}OpenRouter authentication is required to use BSH. Exiting.${ansi.reset}`);
      return;
    }
    apiKey = auth.apiKey;
  }

  const client = options.client ?? new OpenRouterClient({ apiKey: apiKey ?? '' });
  const authCheck = await client.verifyApiKey();
  if (!authCheck.valid) {
    console.log(`${ansi.red}Invalid OpenRouter API Key: ${authCheck.error || 'Authentication failed'}${ansi.reset}`);
    return;
  }

  // 2. Models Discovery
  let activeModel = options.model || env.defaultModel || 'deepseek/deepseek-v4.1-flash';
  const modelsList = await client.getModels().catch(() => []);

  // 3. Domain & Governance Discovery
  let availableDomains = await getAvailableDomains(projectRoot);
  let activeDomainId = options.domain || env.defaultDomain || (availableDomains.length > 0 ? availableDomains[0].id : undefined);
  let explicitlyUngoverned = options.ungoverned === true;

  let validator: DomainValidator | null = null;
  if (!explicitlyUngoverned) {
    const readiness = await prepareGovernedRequest({ projectRoot, domainId: activeDomainId, originalPrompt: 'Inspect the project contract.' });
    if (readiness.status === 'CONFIGURATION_ERROR') {
      console.error(`Governed session stopped: ${readiness.diagnosticCode}: ${readiness.reason}`);
      return;
    }
  }
  if (activeDomainId && !explicitlyUngoverned) {
    try {
      validator = await loadDomainValidator(projectRoot, activeDomainId);
    } catch (err: unknown) {
      console.error(`Governed session stopped: could not load '${activeDomainId}': ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  // MCP Client Manager (.bsh/mcp.json)
  const mcpManager = new McpClientManager();

  // 4. Git Worktree Isolation
  let sessao: SessaoWorktree | null = null;
  let workspaceRoot = projectRoot;
  let activeGitBranch: string | undefined;
  const gitAvailable = await gitDisponivel();

  if (gitAvailable) {
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
    } catch (err) {
      if (!explicitlyUngoverned && !options.allowDirectExecution) {
        console.log(`${ansi.red}Erro: Falha ao criar worktree de isolamento no modo governado: ${err instanceof Error ? err.message : String(err)}. Execução direta exige seleção explícita.${ansi.reset}`);
        return;
      }
    }
  } else {
    if (!explicitlyUngoverned && !options.allowDirectExecution) {
      console.log(`${ansi.red}Erro: Git indisponível para criar worktree de isolamento no modo governado. Execução direta exige seleção explícita.${ansi.reset}`);
      return;
    }
  }

  if (!explicitlyUngoverned && !sessao && !options.allowDirectExecution) {
    console.log(`${ansi.red}Erro: O modo governado exige isolamento por worktree. Para operar diretamente no repositório, selecione explicitamente o modo direto ou desative a governança (/ungoverned).${ansi.reset}`);
    return;
  }
  await mcpManager.loadFromProject(projectRoot);

  // 5. Workspace Context Discovery
  const workspaceSummary = await inspectWorkspace(projectRoot);

  // 6. View & Component State
  let tokensTotal = 0;
  let tokensPrompt = 0;
  let tokensCompletion = 0;
  let tokensCached = 0;
  let tokensReasoning = 0;
  let telemetryStatus: 'MEASURED' | 'ESTIMATED' | 'UNAVAILABLE' = 'MEASURED';
  let lastGateConforming = true;
  let lastGateViolations: string[] = [];
  let alignmentStatus: 'ALIGNED' | 'MISMATCH' | 'INSUFFICIENT_DATA' = 'ALIGNED';
  let alignmentWarning: string | undefined;
  const messages: ChatMessage[] = [];
  const chatEntries: ChatEntry[] = [];
  let lastTurnDurationMs = 0;
  let lastTurnTps = 0;

  const view = options.view ?? await createTuiView();

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
          alertDiagnostic: `O vocabulário do projeto possui baixa afinidade com os conceitos formais da ontologia '${domainId}'. Operar com domínio desalinhado pode gerar código sem validação de regras de negócio.`,
          alertRemediation: [
            '/domain ou [Ctrl+D] - Selecionar o domínio ontológico correspondente',
            '/ungoverned ou [Ctrl+G] - Operar como agente geral sem validação SHACL',
            'Prosseguir normalmente se a solicitação for intencional',
          ],
        });
      }
    } catch {
      // Best-effort
    }
  };

  await runAffinityCheck(activeDomainId);

  const skillRegistry = new SkillRegistry(projectRoot);
  const activeSkillNames: string[] = [];

  const getActiveContextLength = () => {
    return modelsList.find((m) => m.id === activeModel)?.context_length || 131072;
  };

  const exitGuard = new ExitGuard({ windowMs: 1500 });
  const inputQueue = new InputQueueManager();
  let isExecutingTurn = false;
  let exitRequested = false;
  let activeAbortController: AbortController | null = null;
  let promptResolver: ((line: string) => void) | null = null;
  let confirmationResolver: ((line: string) => void) | null = null;
  let verboseMode = false;

  const updateView = (patch: Partial<RenderState> = {}) => {
    const relProject = relative(process.cwd(), projectRoot);
    const projectFolder = relProject && !relProject.startsWith('..') ? relProject : basename(projectRoot);
    const gitBranch = sessao?.branchOrigem || activeGitBranch;

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

    view.update({
      model: activeModel,
      contextLength: getActiveContextLength(),
      domain: activeDomainId,
      ontologySummary,
      projectFolder,
      gitBranch,
      governed: !explicitlyUngoverned,
      alignmentStatus,
      alignmentWarning,
      tokensTotal,
      tokensPrompt,
      tokensCompletion,
      tokensCached,
      tokensReasoning,
      telemetryStatus,
      generationDurationMs: lastTurnDurationMs,
      generationTps: lastTurnTps,
      queueLength: inputQueue.length,
      ctrlCExitAlert: exitGuard.isExitPending(),
      activeSkill: activeSkillNames.length > 0 ? activeSkillNames.join(', ') : undefined,
      ...patch,
    }, chatEntries);
  };

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
        updateView();
      }
    } else {
      if (promptResolver) {
        const resolve = promptResolver;
        promptResolver = null;
        resolve(text);
      } else if (text) {
        inputQueue.enqueue(text);
        updateView();
      }
    }
  };

  const initialHistory = await loadPromptHistory(projectRoot);

  const inputController = new SessionInputController({
    view,
    queue: inputQueue,
    exitGuard,
    history: initialHistory,
    isExecutingTurn: () => isExecutingTurn,
    isAwaitingConfirmation: () => confirmationResolver !== null,
    onDispatch: (prompt) => dispatchPrompt(prompt),
    onAbortTurn: (reason) => {
      if (activeAbortController) {
        activeAbortController.abort(reason);
        chatEntries.push({
          type: 'agent',
          content: `[!] Execução cancelada pelo usuário (${reason}).`,
        });
        isExecutingTurn = false;
        updateView();
      }
    },
    onCancelConfirmation: () => {
      if (confirmationResolver) {
        const res = confirmationResolver;
        confirmationResolver = null;
        res('/cancel');
        return true;
      }
      return false;
    },
    onToggleReasoning: () => {
      const reasoningEntries = chatEntries.filter((e) => e.type === 'reasoning');
      if (reasoningEntries.length > 0) {
        const target = reasoningEntries[reasoningEntries.length - 1];
        target.reasoningCollapsed = !target.reasoningCollapsed;
        updateView();
      }
    },
    onTriggerSlashMenu: () => {
      void (async () => {
        const selected = await selectSlashCommandModal(DEFAULT_SLASH_COMMANDS, '', view);
        if (selected) {
          dispatchPrompt(selected);
        } else {
          view.focusPrompt();
          updateView();
        }
      })();
    },
    onSaveHistory: (hist) => savePromptHistory(projectRoot, hist),
    onExit: () => {
      exitRequested = true;
      if (promptResolver) {
        const res = promptResolver;
        promptResolver = null;
        res('/exit');
      }
      if (confirmationResolver) {
        const res = confirmationResolver;
        confirmationResolver = null;
        res('/cancel');
      }
    },
    onAlertChange: () => updateView(),
  });

  const getNextPrompt = (): Promise<string> => {
    if (inputQueue.hasItems) {
      const next = inputQueue.dequeue() ?? '';
      const queuedEntry = chatEntries.find((e) => e.type === 'user' && e.content === next && e.isQueued);
      if (queuedEntry) {
        delete queuedEntry.isQueued;
      }
      updateView();
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
    updateView();

    while (true) {
      updateView();
      let originalPrompt = await getNextPrompt();
      let prompt = originalPrompt.trim();
      if (!prompt) continue;

      if (prompt === '/editor') {
        const tmpFile = join('/tmp', `bsh-prompt-${Date.now()}.md`);
        await writeFile(
          tmpFile,
          '# Digite ou cole seu prompt aqui.\n# Linhas iniciadas com # serão ignoradas.\n# Salve e feche o editor para enviar ao BSH.\n',
          'utf8'
        );
        view.suspend();
        const editorCmd = process.env.VISUAL || process.env.EDITOR || 'nano';
        try {
          spawnSync(editorCmd, [tmpFile], { stdio: 'inherit' });
        } finally {
          view.resume();
        }
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
          originalPrompt = edited;
        } else {
          updateView();
          continue;
        }
      }

      // Handle Slash Commands
      if (prompt === '/' || prompt === '/menu') {
        const selected = await selectSlashCommandModal(DEFAULT_SLASH_COMMANDS, '', view);
        if (selected) {
          prompt = selected;
        } else {
          updateView();
          continue;
        }
      }

      if (exitRequested || prompt === '/exit' || prompt === '/quit') {
        break;
      }

      if (prompt === '/clear') {
        chatEntries.length = 0;
        view.scrollTo('top');
        updateView();
        continue;
      }

      if (prompt.startsWith('/up') || prompt === '/pgup') {
        const parts = prompt.split(/\s+/);
        const count = parts.length > 1 ? parseInt(parts[1], 10) || 6 : 6;
        view.scrollBy(-count);
        updateView();
        continue;
      }

      if (prompt.startsWith('/down') || prompt === '/pgdn') {
        const parts = prompt.split(/\s+/);
        const count = parts.length > 1 ? parseInt(parts[1], 10) || 6 : 6;
        view.scrollBy(count);
        updateView();
        continue;
      }

      if (prompt === '/top') {
        view.scrollTo('top');
        updateView();
        continue;
      }

      if (prompt === '/bottom') {
        view.scrollTo('bottom');
        updateView();
        continue;
      }

      if (prompt.startsWith('/model')) {
        const query = prompt.replace(/^\/model\s*/, '').trim();
        const prevModel = activeModel;
        activeModel = await selectModelModal(modelsList, activeModel, query || undefined, view);
        if (activeModel !== prevModel) {
          await saveEnvConfig({ BSH_DEFAULT_MODEL: activeModel }, projectRoot);
        }
        updateView();
        continue;
      }

      if (prompt === '/domain') {
        availableDomains = await getAvailableDomains(projectRoot);
        activeDomainId = await selectDomainModal(availableDomains, activeDomainId, view);
        if (activeDomainId) {
          explicitlyUngoverned = false;
          try {
            validator = await loadDomainValidator(projectRoot, activeDomainId);
            await saveEnvConfig({ BSH_DEFAULT_DOMAIN: activeDomainId }, projectRoot);
            await runAffinityCheck(activeDomainId);
          } catch (error) {
            validator = null;
            chatEntries.push({ type: 'alert', content: `Domain unavailable: ${error instanceof Error ? error.message : String(error)}. Governed requests remain disabled until the contract is repaired.` });
          }
        } else {
          validator = null;
          alignmentStatus = 'INSUFFICIENT_DATA';
        }
        updateView();
        continue;
      }

      if (prompt === '/ungoverned' || prompt === '/bypass') {
        explicitlyUngoverned = true;
        validator = null;
        alignmentStatus = 'INSUFFICIENT_DATA';
        chatEntries.push({
          type: 'agent',
          content: 'Ontology governance explicitly disabled by the user. Session is UNGOVERNED.',
        });
        updateView();
        continue;
      }

      if (prompt === '/governed') {
        explicitlyUngoverned = false;
        validator = null;
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
        updateView();
        continue;
      }

      if (prompt === '/skills' || prompt.startsWith('/skills ') || prompt === '/skill' || prompt.startsWith('/skill ')) {
        const parts = prompt.trim().split(/\s+/);
        const isSubCommand = ['show', 'add', 'activate', 'deactivate'].includes(parts[1]);
        if (parts.length === 1 || !isSubCommand) {
          const query = parts.length === 1
            ? undefined
            : (parts[1] === 'list' || parts[1] === 'search')
              ? parts.slice(2).join(' ')
              : parts.slice(1).join(' ');
          const allSkills = await skillRegistry.discover();
          const modalRes = await selectSkillModal(allSkills, activeSkillNames, query, view);
          if (modalRes.action === 'toggle' && modalRes.selectedSkillName) {
            const idx = activeSkillNames.indexOf(modalRes.selectedSkillName);
            if (idx >= 0) {
              activeSkillNames.splice(idx, 1);
              chatEntries.push({
                type: 'agent',
                content: `Skill desativada: ${modalRes.selectedSkillName}`,
              });
            } else {
              activeSkillNames.push(modalRes.selectedSkillName);
              chatEntries.push({
                type: 'agent',
                content: `✔ Skill ativada para a sessão: ${modalRes.selectedSkillName}`,
              });
            }
          } else if (modalRes.action === 'show' && modalRes.selectedSkillName) {
            const s = await skillRegistry.get(modalRes.selectedSkillName);
            if (s) {
              chatEntries.push({
                type: 'agent',
                content: `[Skill: ${s.name} (${s.scope})]\n${s.description}\n\n${s.body.slice(0, 300)}...`,
              });
            }
          }
          updateView();
          continue;
        }

        if (parts[1] === 'show' && parts[2]) {
          const s = await skillRegistry.get(parts[2]);
          if (s) {
            chatEntries.push({
              type: 'agent',
              content: `[Skill: ${s.name} (${s.scope})]\n${s.description}\nArquivo: ${s.filePath}\n\n${s.body}`,
            });
          } else {
            chatEntries.push({
              type: 'agent',
              content: `Skill '${parts[2]}' não encontrada.`,
            });
          }
          updateView();
          continue;
        }

        if (parts[1] === 'add' && parts[2]) {
          const source = parts[2];
          chatEntries.push({
            type: 'agent',
            content: `Instalando skill '${source}'...`,
          });
          updateView();
          const res = await installSkillPackage(source, { projectRoot });
          if (res.success) {
            skillRegistry.clearCache();
            chatEntries.push({
              type: 'agent',
              content: `✔ Skill instalada com sucesso a partir de ${source}.`,
            });
          } else {
            chatEntries.push({
              type: 'agent',
              content: `Erro ao instalar skill: ${res.error || res.output}`,
            });
          }
          updateView();
          continue;
        }

        if (parts[1] === 'activate' && parts[2]) {
          const s = await skillRegistry.get(parts[2]);
          if (s) {
            if (!activeSkillNames.includes(s.name)) activeSkillNames.push(s.name);
            chatEntries.push({
              type: 'agent',
              content: `✔ Skill ativada para esta sessão: ${s.name}`,
            });
          } else {
            chatEntries.push({
              type: 'agent',
              content: `Skill '${parts[2]}' não encontrada.`,
            });
          }
          updateView();
          continue;
        }

        if (parts[1] === 'deactivate' && parts[2]) {
          const idx = activeSkillNames.indexOf(parts[2]);
          if (idx >= 0) {
            activeSkillNames.splice(idx, 1);
            chatEntries.push({
              type: 'agent',
              content: `Skill desativada: ${parts[2]}`,
            });
          } else {
            chatEntries.push({
              type: 'agent',
              content: `Skill '${parts[2]}' não estava ativa.`,
            });
          }
          updateView();
          continue;
        }

        if (parts[1] === 'done' || parts[1] === 'finish' || parts[1] === 'close') {
          if (activeSkillNames.length === 0) {
            chatEntries.push({
              type: 'agent',
              content: 'Nenhuma skill ativa no momento para concluir.',
            });
          } else {
            const closedSkills = activeSkillNames.splice(0, activeSkillNames.length);
            chatEntries.push({
              type: 'agent',
              content: `✔ Loop da skill [${closedSkills.join(', ')}] concluído com sucesso. Diretivas da skill finalizadas.`,
            });
          }
          updateView();
          continue;
        }
      }

      if (prompt === '/done' || prompt === '/finish') {
        if (activeSkillNames.length > 0) {
          const closedSkills = activeSkillNames.splice(0, activeSkillNames.length);
          chatEntries.push({
            type: 'agent',
            content: `✔ Loop da skill [${closedSkills.join(', ')}] concluído com sucesso. Diretivas da skill finalizadas.`,
          });
          updateView();
          continue;
        }
      }

      if (prompt === '/mcp' || prompt.startsWith('/mcp ')) {
        const parts = prompt.trim().split(/\s+/);
        if (parts.length === 1) {
          const toolDefs = mcpManager.getToolDefinitions();
          if (toolDefs.length === 0) {
            chatEntries.push({
              type: 'agent',
              content: 'No MCP server is configured.\nUse: /mcp add <name> <command> [args...]\nOnly project-configured servers are connected. Governed tool execution requires host authorization.',
            });
          } else {
            const list = toolDefs.map((t) => `  • ${t.function.name}: ${t.function.description}`).join('\n');
            chatEntries.push({
              type: 'agent',
              content: `Servidores MCP conectados via stdio. Ferramentas ativas (${toolDefs.length}):\n${list}`,
            });
          }
          updateView();
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
          updateView();
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
          updateView();
          continue;
        }
      }

      if (prompt === '/affinity' || prompt === '/alignment') {
        if (!activeDomainId) {
          chatEntries.push({
            type: 'agent',
            content: 'Nenhum domínio ativo para checar afinidade semântica.',
          });
        } else {
          const targetDomain = availableDomains.find((d) => d.id === activeDomainId);
          if (targetDomain) {
            const aff = await checkDomainAffinity(projectRoot, targetDomain.ontologyPath, targetDomain.shapesPath, activeDomainId);
            chatEntries.push({
              type: 'agent',
              content: `Relatório de Afinidade Semântica [${activeDomainId}]:\n  Status: ${aff.status}\n  Score: ${(aff.score * 100).toFixed(1)}%\n  Conceitos da ontologia: ${aff.ontologyTerms.slice(0, 8).join(', ')}\n  Conceitos encontrados no projeto: ${aff.matchedTerms.join(', ') || 'Nenhum'}\n  ${aff.summary}`,
            });
          }
        }
        updateView();
        continue;
      }

      if (prompt === '/diff') {
        const diffText = sessao ? await git(sessao.caminhoWorktree, ['diff', sessao.commitBase]).catch(() => '') : '';
        const shouldPromote = await diffReviewModal(diffText, lastGateConforming, lastGateViolations, view);
        if (shouldPromote && sessao) {
          const promotion = await promoverSessao(sessao, {
            extractCandidateFacts: createProductionFactsExtractor(sessao.caminhoWorktree),
          });
          if (promotion.status === 'promovido') {
            chatEntries.push({
              type: 'agent',
              content: `✔ Mudanças promovidas com sucesso para ${sessao.branchOrigem}! (commit: ${promotion.commitIntegrado?.slice(0, 8) || 'OK'})`,
            });
          } else if (promotion.status === 'bloqueado') {
            chatEntries.push({
              type: 'agent',
              content: `✖ Promoção bloqueada na etapa [${promotion.etapaBloqueio || 'GOVERNANCE'}]: ${promotion.motivoBloqueio || promotion.detalhes}`,
            });
          } else if (promotion.status === 'falha-validacao') {
            chatEntries.push({
              type: 'agent',
              content: `✖ Falha de validação técnica na worktree: ${promotion.detalhes}`,
            });
          } else if (promotion.status === 'conflitado') {
            chatEntries.push({
              type: 'agent',
              content: `✖ Conflito na reconciliação Git com a branch de origem: ${promotion.detalhes}`,
            });
          }
        }
        updateView();
        continue;
      }

      if (prompt === '/discard') {
        if (!sessao) {
          chatEntries.push({
            type: 'agent',
            content: 'Nenhuma sessão em worktree ativa para descartar.',
          });
        } else {
          await removerSessaoWorktree(sessao, true);
          chatEntries.push({
            type: 'agent',
            content: `✔ Candidato e branch da sessão '${sessao.branchSessao}' foram descartados permanentemente.`,
          });
        }
        updateView();
        continue;
      }

      if (prompt === '/rules') {
        if (!validator) {
          chatEntries.push({
            type: 'agent',
            content: `Regras de governança ativas para '${activeDomainId || 'none'}':\n  Nenhum domínio ativo. Rodando em modo UNGOVERNED.`,
          });
        } else {
          chatEntries.push({
            type: 'agent',
            content: `Regras de governança ativas para '${activeDomainId || 'none'}':\n  • TransferShape: Aplica transições de ciclo de vida válidas (InOperation -> Transferred).\n  • RetirementShape: Exige 'motivoBaixa' obrigatório e avaliação técnica.\n  • CustodyShape: Valida recebedor não-nulo e departamento ativo.`,
          });
        }
        updateView();
        continue;
      }

      if (prompt === '/settings' || prompt === '/config') {
        const updated = await settingsModal({
          confirmPromptViolations,
          model: activeModel,
          domain: activeDomainId,
        }, view);
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
        updateView();
        continue;
      }

      if (prompt === '/help') {
        chatEntries.push({
          type: 'agent',
          content: `BSH Available Commands:
  /model       - Browse and change active OpenRouter model
  /domain      - Select domain ontology and SHACL governance rules
  /settings    - Configure BSH settings (e.g. pause/confirm on prompt violation)
  /ungoverned  - Disable ontology governance harness (bypass mode)
  /governed    - Re-enable ontology governance harness
  /affinity    - Check domain concept affinity with current codebase
  /mcp         - Manage MCP client connections and discover tools (/mcp add <name> <cmd>)
  /diff        - Review workspace code diff and promote to branch
  /rules       - Inspect active SHACL rules for the current domain
  /verbose     - Toggle verbose tool and RPC debug output
  /clear       - Clear screen and refresh header
  /exit        - End governed session and exit`,
        });
        updateView();
        continue;
      }

      if (prompt === '/verbose') {
        verboseMode = !verboseMode;
        chatEntries.push({
          type: 'agent',
          content: verboseMode
            ? '✔ Modo verboso ATIVADO: exibindo payloads literais de ferramentas e saídas completas.'
            : '✔ Modo verboso DESATIVADO: exibindo ações concisas e recibos consolidados.',
        });
        updateView();
        continue;
      }

      // Dynamic Skill Invocation
      skillRegistry.clearCache();
      const allDiscoveredSkillsForPrompt = await skillRegistry.discover();
      const skillInvocation = detectSkillInvocation(prompt, allDiscoveredSkillsForPrompt);
      if (skillInvocation.isSlashCommand && skillInvocation.matchedSkill) {
        if (!activeSkillNames.includes(skillInvocation.matchedSkill.name)) {
          activeSkillNames.push(skillInvocation.matchedSkill.name);
        }
        chatEntries.push({
          type: 'agent',
          content: `✔ Skill ativada: [${skillInvocation.matchedSkill.name}] (${skillInvocation.matchedSkill.scope})\n↳ Diretrizes e diretivas incorporadas ao raciocínio do agente.`,
        });
        prompt = skillInvocation.effectivePrompt;
      } else {
        const semanticSkill = detectSemanticSkillNeed(prompt, allDiscoveredSkillsForPrompt);
        if (semanticSkill && !activeSkillNames.includes(semanticSkill.name)) {
          activeSkillNames.push(semanticSkill.name);
          chatEntries.push({
            type: 'agent',
            content: `ℹ Diretivas da skill recomendada ativadas: [${semanticSkill.name}]`,
          });
        }
      }

      // BSH-PREP-001..009: retrieve the actual contract before dispatching each request.
      const allDiscoveredSkills = await skillRegistry.discover();
      const skillsContext = skillRegistry.formatSkillsForPrompt(allDiscoveredSkills, activeSkillNames);
      const activeSkillsContext = skillRegistry.formatSkillsForPrompt(
        allDiscoveredSkills.filter(skill => activeSkillNames.includes(skill.name)), activeSkillNames);
      let prepared = await prepareGovernedRequest({
        projectRoot, domainId: activeDomainId, ungoverned: explicitlyUngoverned,
        originalPrompt, effectivePrompt: prompt, skillsContext: activeSkillsContext,
        skillSources: allDiscoveredSkills.filter(skill => activeSkillNames.includes(skill.name))
          .map(skill => ({ path: skill.filePath, sha256: skill.sourceHash })),
      });
      chatEntries.push({ type: 'user', content: originalPrompt, isViolating: prepared.status === 'BLOCK' });
      chatEntries.push({ type: 'agent', content: `Request governance: ${prepared.status}. ${prepared.reason}\nReferences: ${prepared.references.join(', ') || '(none)'}\nIdentity: ${prepared.identity}` });
      if (prepared.status === 'HUMAN_REVIEW') {
        chatEntries.push({ type: 'prompt_violation', requestDecision: 'HUMAN_REVIEW', violationRule: prepared.references.join(', '),
          violationBusinessRationale: prepared.reason,
          violationRemediation: ['Confirm request dispatch only, or cancel.', 'Tool execution and candidate promotion require independent authorization.'],
          content: 'Project contract requires human review before model dispatch.', waitingConfirmation: true });
        updateView();
        const answer = (await waitForConfirmation()).trim().toLowerCase();
        const pending = chatEntries.at(-1);
        if (pending) pending.waitingConfirmation = false;
        if (!['', 'yes', 'y', 'confirm', 'approve'].includes(answer) || exitRequested) {
          chatEntries.push({ type: 'agent', content: 'Request cancelled. No request was sent to the model.' });
          updateView();
          if (exitRequested) break;
          continue;
        }
        prepared = approvePreparedRequest(prepared, { actor: 'interactive-user', reason: 'Explicit confirmation in the governed TUI.' });
      }
      if (prepared.status !== 'ALLOW') {
        chatEntries.push({ type: 'alert', content: `Request not sent [${prepared.diagnosticCode ?? prepared.status}]: ${prepared.reason}` });
        updateView();
        continue;
      }
      try {
        await assertPreparedRequestCurrent(projectRoot, prepared);
        validator = explicitlyUngoverned ? null : await loadDomainValidator(projectRoot, activeDomainId ?? '');
      } catch (error) {
        chatEntries.push({ type: 'alert', content: `Request not sent: ${error instanceof Error ? error.message : String(error)}` });
        updateView();
        continue;
      }
      updateView();
      let _agentResponseAccum = '';
      const broker = explicitlyUngoverned ? undefined : new ApprovalBroker(projectRoot, async question => {
        const answer = await view.question({ title: 'Tool authorization',
          message: `Tool: ${question.action.tool}\nArguments: ${JSON.stringify(question.action.arguments)}\n${question.evaluation.reasons.join('\n')}\nType allow-once to authorize this action; any other answer denies it.`,
          signal: activeAbortController?.signal });
        return { choice: answer?.trim().toLowerCase() === 'allow-once' ? 'allow-once' : 'deny',
          actor: 'interactive-user', reason: 'Explicit host tool authorization in the TUI.' };
      }, 30_000, apiKey ? [apiKey] : []);
      broker?.setRequestGuard(() => assertPreparedRequestCurrent(projectRoot, prepared));

      const systemPrompt = buildCodingAgentSystemPrompt({
        workspaceSummary,
        domainId: activeDomainId,
        governed: !explicitlyUngoverned,
        skillsContext,
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
          projectRoot,
          messages: [prepared.contextMessage, ...messages, { role: 'user', content: originalPrompt }],
          systemPrompt,
          broker,
          domain: activeDomainId,
          beforeModelRequest: () => assertPreparedRequestCurrent(projectRoot, prepared),
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
            updateView();
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
            updateView();
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
            updateView();
          },
          onToolCallStart: (call) => {
            if (activeReasoningEntry) {
              activeReasoningEntry.reasoningDurationMs = performance.now() - reasoningStartTime;
              activeReasoningEntry = null;
            }
            chatEntries.push({
              type: 'tool',
              toolName: call.name,
              toolArgs: call.args,
              verbose: verboseMode,
            });
            updateView();
          },
          onToolCallDone: (call) => {
            const firstLine = (call.result || '').split('\n')[0] || '';
            const preview = firstLine.length > 50 ? `${firstLine.slice(0, 47)}...` : firstLine;
            const isError = (call.result || '').startsWith('Error executing ');

            if (verboseMode) {
              chatEntries.push({
                type: 'tool_result',
                content: preview,
                verbose: true,
                isError,
              });
              updateView();
            } else if (isError) {
              chatEntries.push({
                type: 'tool_result',
                content: preview,
                verbose: false,
                isError: true,
              });
              updateView();
            } else if (call.name === 'run_bash_command' && preview.trim()) {
              chatEntries.push({
                type: 'tool_result',
                content: preview,
                verbose: false,
                isError: false,
              });
              updateView();
            }
            // Quiet tools in concise mode do not push a separate tool_result entry

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
                    updateView();
                  }
                })
                .catch(() => {});
            }
          },
        });

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

        let diffGateResult: DiffGateResult | null = null;
        if (sessao) {
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

        }

        const receiptFiles = turnResult.modifiedFiles.map(path =>
          diffGateResult?.fileStats?.find(file => file.path === path)
          ?? { path, linesAdded: 0, linesRemoved: 0 });
        chatEntries.push({
          type: 'implementation_receipt',
          receiptHasChanges: receiptFiles.length > 0,
          receiptFiles,
          receiptTotalAdded: receiptFiles.reduce((total, file) => total + file.linesAdded, 0),
          receiptTotalRemoved: receiptFiles.reduce((total, file) => total + file.linesRemoved, 0),
          receiptOutcome: turnResult.outcome,
          receiptDiagnostics: turnResult.toolFailures.map(failure => `${failure.tool}: ${failure.reason}`),
        });

        if (validator && sessao && diffGateResult) {
          // Prompt triage is shown separately; it is not executed SHACL evidence.
          const isViolation = diffGateResult.gateStatus === 'VIOLATION';

          if (isViolation) {
            lastGateConforming = false;
            const violationsList = diffGateResult.violations.length > 0
              ? diffGateResult.violations
              : ['Semantic validation reported a violation'];
            lastGateViolations = violationsList;

            let checks = diffGateResult.checks;
            const hasFailingCheck = checks.some((c) => !c.ok);
            if (!hasFailingCheck) {
              const failureText = violationsList[0] || 'Semantic validation reported a violation';
              checks = [
                ...checks,
                { ok: false, text: failureText },
              ];
            }

            chatEntries.push({
              type: 'gate',
              gateShape: diffGateResult.shapeName,
              gateChecks: checks,
              gateStatus: 'VIOLATION',
              gateScope: diffGateResult.scope,
              gateIsPreliminary: diffGateResult.isPreliminary,
              gateDisclaimer: diffGateResult.disclaimer,
              gateOperations: diffGateResult.operations,
              gateRestrictions: diffGateResult.restrictions,
              gateEvidences: diffGateResult.evidences,
              gateReasons: diffGateResult.reasons,
              gateReferences: diffGateResult.references,
            });
          } else {
            lastGateConforming = diffGateResult.conforming;
            lastGateViolations = [];
            chatEntries.push({
              type: 'gate',
              gateShape: diffGateResult.shapeName,
              gateChecks: diffGateResult.checks,
              gateStatus: diffGateResult.gateStatus,
              gateScope: diffGateResult.scope,
              gateIsPreliminary: diffGateResult.isPreliminary,
              gateDisclaimer: diffGateResult.disclaimer,
              gateOperations: diffGateResult.operations,
              gateRestrictions: diffGateResult.restrictions,
              gateEvidences: diffGateResult.evidences,
              gateReasons: diffGateResult.reasons,
              gateReferences: diffGateResult.references,
            });
          }
        }

        if (turnResult.telemetry) {
          telemetryStatus = turnResult.telemetry.status;
          if (turnResult.telemetry.status === 'MEASURED') {
            tokensTotal += turnResult.telemetry.totalTokens;
            tokensPrompt += turnResult.telemetry.promptTokens;
            tokensCompletion += turnResult.telemetry.completionTokens;
            if (turnResult.telemetry.cachedTokens) tokensCached += turnResult.telemetry.cachedTokens;
            if (turnResult.telemetry.reasoningTokens) tokensReasoning += turnResult.telemetry.reasoningTokens;
          } else if (turnResult.telemetry.status === 'ESTIMATED') {
            tokensTotal += turnResult.telemetry.totalTokens;
            tokensPrompt += turnResult.telemetry.promptTokens;
            tokensCompletion += turnResult.telemetry.completionTokens;
          }
        }

        const elapsed = performance.now() - turnStartTime;
        lastTurnDurationMs = elapsed;
        const turnTokens = turnResult.telemetry?.totalTokens ?? turnTokensCount;
        lastTurnTps = elapsed > 0 ? (turnTokens / (elapsed / 1000)) : 0;
        updateView();
      } catch (err: unknown) {
        if (activeAbortController?.signal.aborted) {
          // Aborted by user
        } else {
          chatEntries.push({
            type: 'agent',
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        updateView();
      } finally {
        isExecutingTurn = false;
        activeAbortController = null;
      }
    }
  } finally {
    inputController.destroy();
    view.destroy();
    await mcpManager.close().catch(() => undefined);
    if (sessao) {
      try {
        await removerSessaoWorktree(sessao, false);
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
