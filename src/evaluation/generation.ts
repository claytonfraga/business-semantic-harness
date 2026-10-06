import type { OpenRouterClient } from '../client/openrouter/client.js';
import type { ApprovalBroker } from '../decision/broker.js';
import { runAgentTurn } from '../agent/agentLoop.js';
import { commitSeNecessario, git, type SessaoWorktree } from '../git/worktree.js';
import { getProductionIdentity } from './production.js';
import { contentHash } from './replay.js';
import { readFile } from 'node:fs/promises';
import type { ExperimentStages } from './experiment.js';

/** Native agent adapter. Each condition requires a fresh isolated session from the same base. */
export function createNativeGeneration(session: SessaoWorktree, options: {
  client: OpenRouterClient; agentVersion: string; systemPrompt: string; broker?: ApprovalBroker;
  contextLength?: number;
}): NonNullable<ExperimentStages['generate']> {
  return async ({ controls, context, signal }) => {
    const packageManifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    if (controls.agent !== 'bsh-native' || controls.agentVersion !== options.agentVersion || options.agentVersion !== packageManifest.version) {
      throw new Error('Generation controls do not identify this native agent version');
    }
    if (controls.systemPromptHash !== contentHash(options.systemPrompt)) {
      throw new Error('Generation system prompt differs from the controlled prompt identity');
    }
    const startingIdentity = await getProductionIdentity(session);
    if (startingIdentity.baseCommit !== session.commitBase || startingIdentity.baseHash !== controls.baseHash) {
      throw new Error('Generation starting base differs from the controlled Git base');
    }
    if ((await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim() !== session.commitBase ||
      (await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
      throw new Error('Generation requires a fresh clean session at the controlled base');
    }
    const start = performance.now();
    const systemPrompt = `${options.systemPrompt}${context ? `\n\nExperiment context:\n${context}` : ''}`;
    const prompts = JSON.stringify({ systemPrompt, userPrompt: controls.taskPrompt });
    const artifacts = [{ id: 'generation-prompts', role: 'CONTEXT' as const, content: prompts,
      sha256: contentHash(prompts), source: 'native-generation:prompts' }];
    try {
      const result = await runAgentTurn({ client: options.client, workspaceRoot: session.caminhoWorktree,
        contextLength: options.contextLength,
        projectRoot: session.repositorioOrigem, model: controls.model, systemPrompt,
        messages: [{ role: 'user', content: controls.taskPrompt }], maxTurns: controls.budget.maxTurns,
        maxTokens: controls.budget.maxTokens, signal, broker: options.broker });
      const observation = JSON.stringify({ outcome: result.outcome, toolFailures: result.toolFailures,
        turnsExecuted: result.turnsExecuted, modifiedFiles: result.modifiedFiles, telemetry: result.telemetry ?? null });
      artifacts.push({ id: 'generation-observation', role: 'CONTEXT', content: observation,
        sha256: contentHash(observation), source: 'native-generation:observed-state' });
      const costs = [{ phase: 'GENERATION' as const, kind: 'RECURRING' as const, durationMs: performance.now() - start,
        tokens: result.telemetry?.status === 'MEASURED' ? result.telemetry.totalTokens : null, amount: null, currency: null }];
      if (signal.aborted) return { candidate: null, artifacts, outcome: 'TIMEOUT', costs };
      if (result.outcome === 'rule_blocked') return { candidate: null, artifacts, outcome: 'REFUSED', costs };
      if (result.outcome !== 'completed') return { candidate: null, artifacts, outcome: 'TECHNICAL_FAILURE', costs };
      if (!result.modifiedFiles.length) return { candidate: null, artifacts, outcome: 'COMPLETED', costs };
      await commitSeNecessario(session);
      const identity = await getProductionIdentity(session);
      return { candidate: { id: identity.candidateCommit, contentHash: identity.candidateHash,
        commit: identity.candidateCommit, baseCommit: identity.baseCommit },
        artifacts: [...artifacts, ...identity.artifacts], outcome: 'COMPLETED', costs };
    } catch (error) {
      if (!signal.aborted) throw error;
      return { candidate: null, artifacts, outcome: 'TIMEOUT', costs: [{ phase: 'GENERATION', kind: 'RECURRING',
        durationMs: performance.now() - start, tokens: null, amount: null, currency: null }] };
    }
  };
}
