import { loadEnvConfig } from '../config/env.js';
import { OpenRouterClient } from '../client/openrouter/client.js';
import { getAvailableDomains } from '../governance/domainRegistry.js';
import { ApprovalBroker, type AskHuman } from '../decision/broker.js';
import { prepareGovernedRequest, assertPreparedRequestCurrent } from '../governance/requestPreparation.js';
import { ContextBudgetError } from '../governance/contextBudget.js';
import {
  branchAtual,
  commitAtual,
  criarSessaoWorktree,
  gitDisponivel,
  removerSessaoWorktree,
  resolverRepositorio,
  type SessaoWorktree,
} from '../git/worktree.js';
import { promoverSessao } from '../git/promotion.js';
import { createProductionFactsExtractor } from '../enforcement/evidenceAdapters.js';
import { inspectWorkspace } from './workspaceContext.js';
import { buildCodingAgentSystemPrompt, runAgentTurn } from './agentLoop.js';
import { evaluateWorkspaceDiffGate } from '../enforcement/diffGate.js';
import { McpClientManager } from '../mcp/clientManager.js';

export interface HeadlessOptions {
  projectRoot: string;
  prompt: string;
  model?: string;
  domain?: string;
  autoPromote?: boolean;
  allowDirectExecution?: boolean;
  /** Explicitly select execution without project governance. */
  ungoverned?: boolean;
  /** Host transport injection; preparation and dispatch remain production code. */
  client?: OpenRouterClient;
  /** A programmatic host approver; CLI requests never grant tool permission. */
  askToolApproval?: AskHuman;
  /** Selected model context window; when omitted the host resolves it when possible. */
  contextLength?: number;
}

export async function runHeadlessCodingSession(options: HeadlessOptions): Promise<number> {
  const { projectRoot, prompt, autoPromote, allowDirectExecution } = options;

  process.stdout.write(`\x1b[1m\x1b[36m[BSH Headless Coding Agent]\x1b[39m\x1b[22m Iniciando no projeto: ${projectRoot}\n`);

  // 1. Config & Auth
  const env = await loadEnvConfig(projectRoot);
  const apiKey = env.openRouterApiKey;
  if (!apiKey && !options.client) {
    process.stderr.write('Erro: OPENROUTER_API_KEY não configurada. Defina a variável de ambiente ou execute a TUI para autenticar.\n');
    return 1;
  }

  const client = options.client ?? new OpenRouterClient({ apiKey: apiKey ?? '' });

  // 2. Models & Domain
  const activeModel = options.model || env.defaultModel || 'deepseek/deepseek-v4.1-flash';
  let activeDomainId = options.domain || env.defaultDomain;
  if (!activeDomainId && !options.ungoverned) {
    // Discovery is advisory; preparation owns configuration diagnostics.
    try { activeDomainId = (await getAvailableDomains(projectRoot))[0]?.id; } catch { /* diagnosed below */ }
  }
  const { SkillRegistry } = await import('../skills/registry.js');
  const { detectSkillInvocation, detectSemanticSkillNeed } = await import('../skills/activation.js');
  const skillRegistry = new SkillRegistry(projectRoot);
  const discoveredSkills = await skillRegistry.discover();
  const invocation = detectSkillInvocation(prompt, discoveredSkills);
  let effectivePrompt = prompt;
  const activeSkillNames: string[] = [];
  if (invocation.matchedSkill) {
    activeSkillNames.push(invocation.matchedSkill.name);
    effectivePrompt = invocation.effectivePrompt;
  } else {
    const semanticMatch = detectSemanticSkillNeed(prompt, discoveredSkills);
    if (semanticMatch) activeSkillNames.push(semanticMatch.name);
  }
  const activeSkillsContext = skillRegistry.formatSkillsForPrompt(
    discoveredSkills.filter(skill => activeSkillNames.includes(skill.name)), activeSkillNames);
  const prepared = await prepareGovernedRequest({ projectRoot, domainId: activeDomainId,
    entryPoint: 'headless',
    ungoverned: options.ungoverned, originalPrompt: prompt, effectivePrompt, skillsContext: activeSkillsContext,
    skillSources: discoveredSkills.filter(skill => activeSkillNames.includes(skill.name))
      .map(skill => ({ path: skill.filePath, sha256: skill.sourceHash })) });
  process.stdout.write(`Request governance: ${prepared.status}; ${prepared.reason}\n`);
  for (const reference of prepared.references) process.stdout.write(`Contract reference: ${reference}\n`);
  if (prepared.status !== 'ALLOW') {
    process.stderr.write(`Request not sent [${prepared.diagnosticCode ?? prepared.status}]: ${prepared.reason}\n`);
    for (const line of prepared.remediation ?? []) process.stderr.write(`${line}\n`);
    return prepared.status === 'HUMAN_REVIEW' ? 2 : prepared.status === 'BLOCK' ? 3
      : prepared.status === 'INSUFFICIENT_INFORMATION' ? 4 : 5;
  }
  activeDomainId = options.ungoverned ? undefined : prepared.domainId;
  const governed = !options.ungoverned;
  const authCheck = await client.verifyApiKey();
  if (!authCheck.valid) {
    process.stderr.write(`Invalid OpenRouter credential: ${authCheck.error || 'Authentication failed'}\n`);
    return 1;
  }

  // An explicit host limit takes precedence; otherwise metadata must establish
  // the selected model window even for a controlled transport.
  let contextLength = options.contextLength;
  if (contextLength === undefined) {
    try {
      const models = await client.getModels();
      contextLength = models.find(model => model.id === activeModel)?.context_length;
    } catch {
      contextLength = undefined;
    }
  }

  // 3. Workspace Context Discovery
  const workspaceSummary = await inspectWorkspace(projectRoot);
  process.stdout.write(`\x1b[34mℹ Tecnologias detectadas: ${workspaceSummary.detectedTechnologies.join(', ') || 'Geral'}\x1b[39m\n`);

  // 4. Git Worktree Isolation
  let sessao: SessaoWorktree | null = null;
  let workspaceRoot = projectRoot;
  let commitBase = 'HEAD';
  const gitAvailable = await gitDisponivel();

  if (gitAvailable) {
    try {
      const repoRoot = await resolverRepositorio(projectRoot);
      const branch = await branchAtual(repoRoot);
      const commit = await commitAtual(repoRoot);
      commitBase = commit;
      sessao = await criarSessaoWorktree({
        repositorioOrigem: repoRoot,
        branchOrigem: branch,
        commitBase: commit,
        incluirEstadoLocal: true,
      });
      workspaceRoot = sessao.caminhoWorktree;
      process.stdout.write(`\x1b[32m✔ Sessão isolada em Git worktree temporária: ${sessao.id}\x1b[39m\n`);
    } catch (err) {
      if (governed && !allowDirectExecution) {
        process.stderr.write(`Erro: Falha ao criar worktree de isolamento no modo governado: ${err instanceof Error ? err.message : String(err)}. Execução direta exige seleção explícita (--direct).\n`);
        return 1;
      }
    }
  } else {
    if (governed && !allowDirectExecution) {
      process.stderr.write('Erro: Git indisponível para criar worktree de isolamento no modo governado. Execução direta exige seleção explícita (--direct).\n');
      return 1;
    }
  }

  if (governed && !sessao && !allowDirectExecution) {
    process.stderr.write('Erro: O modo governado não permite execução sem isolamento por worktree a menos que o modo direto seja explicitamente selecionado.\n');
    return 1;
  }

  // 5. MCP Tools
  const mcpManager = new McpClientManager();
  await mcpManager.loadFromProject(projectRoot);

  const systemPrompt = buildCodingAgentSystemPrompt({
    workspaceSummary,
    domainId: activeDomainId,
    governed,
    skillsContext: activeSkillsContext,
  });

  process.stdout.write(`\x1b[1m\x1b[97mPrompt:\x1b[39m\x1b[22m ${effectivePrompt}\n\n`);

  let promotionResult: import('../git/promotion.js').ResultadoPromocao | null = null;
  let hasWorkspaceChanges = false;
  const broker = governed ? new ApprovalBroker(projectRoot, options.askToolApproval) : undefined;
  broker?.setRequestGuard(() => assertPreparedRequestCurrent(projectRoot, prepared));

  try {
    const turnResult = await runAgentTurn({
      client,
      model: activeModel,
      workspaceRoot,
      projectRoot,
      messages: [prepared.contextMessage, { role: 'user', content: prompt }],
      broker,
      domain: activeDomainId,
      contextLength,
      beforeModelRequest: () => assertPreparedRequestCurrent(projectRoot, prepared),
      systemPrompt,
      mcpManager,
      onToolCallStart: (call) => {
        const argsStr = JSON.stringify(call.args).slice(0, 80);
        process.stdout.write(`  \x1b[33m⚡ Executando ferramenta:\x1b[39m ${call.name}(${argsStr})\n`);
      },
      onToolCallDone: (call) => {
        const preview = (call.result || '').split('\n')[0].slice(0, 70);
        process.stdout.write(`  \x1b[32m✔ Retorno:\x1b[39m ${preview}\n`);
      },
    });

    if (turnResult.finalAssistantMessage?.content) {
      process.stdout.write(`\n\x1b[1m[Narrativa do Agente (Informativa)]\x1b[22m\n${turnResult.finalAssistantMessage.content}\n\n`);
    }

    process.stdout.write(`Observed task outcome: ${turnResult.outcome}\n`);
    process.stdout.write(`Observed changed files: ${turnResult.modifiedFiles.join(', ') || '(none)'}\n`);
    for (const failure of turnResult.toolFailures) {
      process.stderr.write(`Task diagnostic [${failure.kind}] ${failure.tool}: ${failure.reason}\n`);
    }
    hasWorkspaceChanges = turnResult.modifiedFiles.length > 0;

    // 6. Diff & Gate Evaluation (Preliminary Inspection)
    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: workspaceRoot,
      commitBase,
      domainId: activeDomainId,
      projectRoot,
    });
    hasWorkspaceChanges = gateResult.hasChanges;

    process.stdout.write(`\x1b[1m\x1b[36m--- Resumo do Gate Semântico [Inspeção Preliminar] ---\x1b[39m\x1b[22m\n`);
    const statusColor = gateResult.gateStatus === 'CONFORMING' ? '\x1b[32m'
      : gateResult.gateStatus === 'VIOLATION' ? '\x1b[31m'
      : '\x1b[33m';
    process.stdout.write(`Status Preliminar: ${statusColor}${gateResult.gateStatus}\x1b[39m\n`);
    process.stdout.write(`Escopo: ${gateResult.disclaimer}\n`);
    process.stdout.write(`Modificações: ${gateResult.diffSummary}\n`);
    for (const check of gateResult.checks) {
      const ref = check.reference ? ` (ref: ${check.reference.slice(0, 10)})` : '';
      process.stdout.write(`  ${check.ok ? '\x1b[32m[+]\x1b[39m' : '\x1b[31m[-]\x1b[39m'} ${check.text}${ref}\n`);
    }

    if (gateResult.violations.length > 0) {
      for (const v of gateResult.violations) {
        process.stderr.write(`  \x1b[31m[VIOLAÇÃO]\x1b[39m ${v}\n`);
      }
    }

    if (autoPromote && sessao && turnResult.completed) {
      if (gateResult.conforming && gateResult.hasChanges) {
        promotionResult = await promoverSessao(sessao, {
          extractCandidateFacts: createProductionFactsExtractor(sessao.caminhoWorktree),
        });
        if (promotionResult.status === 'promovido') {
          process.stdout.write(`\x1b[32m✔ Modificações aprovadas e integradas pelo gate definitivo de promoção! (commit: ${promotionResult.commitIntegrado || 'OK'})\x1b[39m\n`);
        } else if (promotionResult.status === 'bloqueado') {
          process.stderr.write(`\x1b[31m✖ Bloqueado pelo gate definitivo de promoção [Etapa: ${promotionResult.etapaBloqueio || 'GOVERNANCE'}]: ${promotionResult.motivoBloqueio || promotionResult.detalhes}\x1b[39m\n`);
        } else if (promotionResult.status === 'falha-validacao') {
          process.stderr.write(`\x1b[31m✖ Falha de validação técnica na worktree: ${promotionResult.detalhes}\x1b[39m\n`);
        } else if (promotionResult.status === 'conflitado') {
          process.stderr.write(`\x1b[31m✖ Conflito na reconciliação Git com a branch de origem: ${promotionResult.detalhes}\x1b[39m\n`);
        }
      } else if (!gateResult.hasChanges) {
        process.stdout.write(`\x1b[33mℹ Nenhuma alteração detectada no workspace; promoção não realizada (origem inalterada).\x1b[39m\n`);
      } else {
        process.stderr.write(`\x1b[31m✖ Promoção bloqueada na inspeção preliminar: violações encontradas.\x1b[39m\n`);
      }
    }

    if (!turnResult.completed) {
      process.stderr.write(`Task did not complete: ${turnResult.outcome}; automatic promotion was not authorized.\n`);
      return 1;
    }

    if (autoPromote) {
      if (!gateResult.hasChanges) {
        return 0;
      }
      return promotionResult?.status === 'promovido' ? 0 : 1;
    }

    return gateResult.conforming ? 0 : 1;
  } catch (error) {
    if (error instanceof ContextBudgetError) {
      process.stderr.write(`Request not sent [CONTEXT_BUDGET]: ${error.result.diagnostic}\n`);
      return 6;
    }
    throw error;
  } finally {
    await mcpManager.close().catch(() => undefined);
    if (sessao) {
      try {
        const wasPromoted = promotionResult?.status === 'promovido';
        const hasUnpromotedCandidate = Boolean(
          (hasWorkspaceChanges || promotionResult) && !wasPromoted
        );

        if (wasPromoted) {
          // Successfully integrated; clean up worktree and branch
          await removerSessaoWorktree(sessao, true);
        } else if (hasUnpromotedCandidate) {
          // Preserve blocked/conflicted/failed candidate branch and report for review/inspection
          await removerSessaoWorktree(sessao, false);
          process.stdout.write(`BSH: Candidato não promovido preservado na branch Git '${sessao.branchSessao}' para revisão.\n`);
        } else {
          // Clean/no changes
          await removerSessaoWorktree(sessao, true);
        }
      } catch {
        // cleanup best effort
      }
    }
  }
}
