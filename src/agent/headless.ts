import { loadEnvConfig } from '../config/env.js';
import { OpenRouterClient } from '../client/openrouter/client.js';
import { getAvailableDomains, loadDomainValidator } from '../governance/domainRegistry.js';
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
}

export async function runHeadlessCodingSession(options: HeadlessOptions): Promise<number> {
  const { projectRoot, prompt, autoPromote, allowDirectExecution } = options;

  process.stdout.write(`\x1b[1m\x1b[36m[BSH Headless Coding Agent]\x1b[39m\x1b[22m Iniciando no projeto: ${projectRoot}\n`);

  // 1. Config & Auth
  const env = await loadEnvConfig(projectRoot);
  const apiKey = env.openRouterApiKey;
  if (!apiKey) {
    process.stderr.write('Erro: OPENROUTER_API_KEY não configurada. Defina a variável de ambiente ou execute a TUI para autenticar.\n');
    return 1;
  }

  const client = new OpenRouterClient({ apiKey });
  const authCheck = await client.verifyApiKey();
  if (!authCheck.valid) {
    process.stderr.write(`Erro: Chave OpenRouter inválida: ${authCheck.error || 'Autenticação falhou'}\n`);
    return 1;
  }

  // 2. Models & Domain
  const activeModel = options.model || env.defaultModel || 'deepseek/deepseek-v4.1-flash';
  const availableDomains = await getAvailableDomains(projectRoot);
  let activeDomainId = options.domain || env.defaultDomain || (availableDomains.length > 0 ? availableDomains[0].id : undefined);

  let governed = false;
  if (activeDomainId) {
    try {
      await loadDomainValidator(projectRoot, activeDomainId);
      governed = true;
      process.stdout.write(`\x1b[32m✔ Governança ontológica ativa para o domínio: ${activeDomainId}\x1b[39m\n`);
    } catch {
      activeDomainId = undefined;
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

  // 6. Pre-flight Semantic Guard: Consulta à ontologia e SHACL antes de chamar o agente
  if (activeDomainId && governed) {
    const { detectPromptViolation } = await import('../enforcement/promptGuard.js');
    const promptViolation = detectPromptViolation(prompt, activeDomainId);
    if (promptViolation.isViolating) {
      process.stderr.write(`\x1b[31m[ALERTA DE VIOLAÇÃO PRÉVIA - ${promptViolation.shape}]\x1b[39m ${promptViolation.message}\n`);
    } else {
      process.stdout.write(`\x1b[32m✔ Triagem prévia de prompt (heurística de intenção): Prompt em conformidade inicial com '${activeDomainId}' (não substitui validação SHACL)\x1b[39m\n`);
    }
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
    process.stdout.write(`\x1b[35m✔ Invocação de Skill detectada: [${invocation.matchedSkill.name}]\x1b[39m\n`);
  } else {
    const semanticMatch = detectSemanticSkillNeed(prompt, discoveredSkills);
    if (semanticMatch) {
      activeSkillNames.push(semanticMatch.name);
      process.stdout.write(`\x1b[35mℹ Diretivas da skill recomendada ativadas: [${semanticMatch.name}]\x1b[39m\n`);
    }
  }

  const skillsContext = skillRegistry.formatSkillsForPrompt(discoveredSkills, activeSkillNames);

  const systemPrompt = buildCodingAgentSystemPrompt({
    workspaceSummary,
    domainId: activeDomainId,
    governed,
    skillsContext,
  });

  process.stdout.write(`\x1b[1m\x1b[97mPrompt:\x1b[39m\x1b[22m ${effectivePrompt}\n\n`);

  let promotionResult: import('../git/promotion.js').ResultadoPromocao | null = null;
  let hasWorkspaceChanges = false;

  try {
    const turnResult = await runAgentTurn({
      client,
      model: activeModel,
      workspaceRoot,
      projectRoot,
      messages: [{ role: 'user', content: effectivePrompt }],
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
