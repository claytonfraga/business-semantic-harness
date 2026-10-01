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
}

export async function runHeadlessCodingSession(options: HeadlessOptions): Promise<number> {
  const { projectRoot, prompt, autoPromote } = options;

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
  if (await gitDisponivel()) {
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
    } catch {
      // Direct directory fallback
    }
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
      process.stdout.write(`\x1b[32m✔ Consulta prévia à ontologia e SHACL: Prompt em conformidade inicial com '${activeDomainId}'\x1b[39m\n`);
    }
  }

  const systemPrompt = buildCodingAgentSystemPrompt({
    workspaceSummary,
    domainId: activeDomainId,
    governed,
  });

  process.stdout.write(`\x1b[1m\x1b[97mPrompt:\x1b[39m\x1b[22m ${prompt}\n\n`);

  try {
    const turnResult = await runAgentTurn({
      client,
      model: activeModel,
      workspaceRoot,
      messages: [{ role: 'user', content: prompt }],
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
      process.stdout.write(`\n\x1b[1m[Agente BSH]\x1b[22m\n${turnResult.finalAssistantMessage.content}\n\n`);
    }

    // 6. Diff & Gate Evaluation
    const gateResult = await evaluateWorkspaceDiffGate({
      worktree: workspaceRoot,
      commitBase,
      domainId: activeDomainId,
      projectRoot,
    });

    process.stdout.write(`\x1b[1m\x1b[36m--- Resumo do Gate Semântico ---\x1b[39m\x1b[22m\n`);
    process.stdout.write(`Status: ${gateResult.conforming ? '\x1b[32mCONFORME\x1b[39m' : '\x1b[31mVIOLAÇÃO\x1b[39m'}\n`);
    process.stdout.write(`Modificações: ${gateResult.diffSummary}\n`);
    for (const check of gateResult.checks) {
      process.stdout.write(`  ${check.ok ? '\x1b[32m[+]\x1b[39m' : '\x1b[31m[-]\x1b[39m'} ${check.text}\n`);
    }

    if (gateResult.violations.length > 0) {
      for (const v of gateResult.violations) {
        process.stderr.write(`  \x1b[31m[VIOLAÇÃO]\x1b[39m ${v}\n`);
      }
    }

    if (gateResult.conforming && gateResult.hasChanges && autoPromote && sessao) {
      await promoverSessao(sessao);
      process.stdout.write(`\x1b[32m✔ Modificações promovidas automaticamente para a branch original!\x1b[39m\n`);
    }

    return gateResult.conforming ? 0 : 1;
  } finally {
    await mcpManager.close().catch(() => undefined);
    if (sessao) {
      try {
        await removerSessaoWorktree(sessao);
      } catch {
        // cleanup best effort
      }
    }
  }
}
