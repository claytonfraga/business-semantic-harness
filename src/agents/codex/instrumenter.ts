import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodexRpcClient } from './rpc.js';
import type { ConflictAlert } from './alerts.js';
import { parseLastTotalTokens, parseTokenTotals, type TokenTotals } from './usage.js';

interface RpcNotification { method?: string; params?: Record<string, unknown> }

export interface SessionInstrumentation {
  logPath: string;
  tokenTotals(): TokenTotals | undefined;
  ontologyQueries(): number;
  harnessTokens(): number;
  conflicts(): ConflictAlert[];
  dispose(): void;
}

function timestampName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseConflict(argumentsValue: unknown): ConflictAlert | undefined {
  if (!argumentsValue || typeof argumentsValue !== 'object') return undefined;
  const source = argumentsValue as Record<string, unknown>;
  const rules = Array.isArray(source.conflictingRules)
    ? source.conflictingRules.filter((rule): rule is string => typeof rule === 'string')
    : [];
  if (typeof source.domain !== 'string' || typeof source.reason !== 'string') return undefined;
  return {
    domain: source.domain,
    request: typeof source.request === 'string' ? source.request : '',
    conflictingRules: rules,
    reason: source.reason,
  };
}

export async function instrumentSession(
  client: CodexRpcClient,
  root: string,
  project: string,
): Promise<SessionInstrumentation> {
  const directory = join(root, '.oracle', 'local');
  await mkdir(directory, { recursive: true });
  const logPath = join(directory, `session-${timestampName()}.jsonl`);
  let subscribedThreadId: string | undefined;
  let totals: TokenTotals | undefined;
  let queries = 0;
  let harnessTokens = 0;
  let turnUsesOracle = false;
  let lastTurnTokens = 0;
  let currentTurnId: string | undefined;
  const conflicts: ConflictAlert[] = [];
  let disposed = false;

  const record = (entry: Record<string, unknown>): void => {
    if (disposed) return;
    const line = JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n';
    appendFile(logPath, line, { mode: 0o600 }).catch(() => undefined);
  };

  const subscribe = async (): Promise<void> => {
    if (disposed || subscribedThreadId !== undefined) return;
    try {
      const threads = await client.listThreads({});
      for (const thread of threads) {
        const environments = thread.environments as Record<string, unknown>[] | undefined;
        const threadId = thread.id;
        if (typeof threadId === 'string' && environments?.[0]?.cwd === project) {
          try {
            await client.resumeThread(threadId);
            subscribedThreadId = threadId;
            record({ event: 'thread-subscribed', threadId });
            return;
          } catch {
            // Rollout ainda não disponível; tenta novamente no próximo ciclo.
          }
        }
      }
    } catch {
      // app-server momentaneamente indisponível; tenta novamente.
    }
  };

  const poll = setInterval(() => { void subscribe(); }, 1_500);
  void subscribe();

  const listener = (message: RpcNotification): void => {
    const params = message.params ?? {};
    if (typeof params.threadId !== 'string' || params.threadId !== subscribedThreadId) return;
    if (message.method === 'turn/started') {
      const turn = params.turn as Record<string, unknown> | undefined;
      if (typeof turn?.id === 'string') currentTurnId = turn.id;
      turnUsesOracle = false;
    } else if (message.method === 'thread/tokenUsage/updated') {
      const parsed = parseTokenTotals(params.tokenUsage);
      if (parsed) { totals = parsed; record({ event: 'token-usage', threadId: params.threadId, ...parsed }); }
      lastTurnTokens = parseLastTotalTokens(params.tokenUsage);
    } else if (message.method === 'turn/completed') {
      const turn = params.turn as Record<string, unknown> | undefined;
      if (turnUsesOracle) harnessTokens += lastTurnTokens;
      turnUsesOracle = false;
      currentTurnId = undefined;
      record({ event: 'turn-completed', threadId: params.threadId, turnId: turn?.id, status: turn?.status });
    } else if (message.method === 'item/completed') {
      const item = params.item as Record<string, unknown> | undefined;
      const itemType = item?.type;
      const entry: Record<string, unknown> = { event: 'item-completed', threadId: params.threadId, itemType };
      if (itemType === 'fileChange' && Array.isArray(item?.changes)) {
        entry.paths = (item.changes as Record<string, unknown>[]).map((change) => change.path);
      }
      if (itemType === 'mcpToolCall') {
        const tool = item?.tool;
        entry.tool = tool;
        if (tool === 'oracle_query_ontology') queries += 1;
        if (typeof tool === 'string' && tool.startsWith('oracle_')) turnUsesOracle = true;
        if (tool === 'oracle_report_conflict' && item?.status === 'completed') {
          const conflict = parseConflict(item?.arguments);
          if (conflict) {
            conflicts.push(conflict);
            entry.conflict = true;
            if (subscribedThreadId !== undefined && currentTurnId !== undefined) {
              client.interrupt(subscribedThreadId, currentTurnId)
                .then(() => record({ event: 'turn-interrupted-after-conflict', threadId: subscribedThreadId, turnId: currentTurnId }))
                .catch(() => undefined);
            }
          }
        }
      }
      record(entry);
    }
  };

  client.on('notification', listener);
  return {
    logPath,
    tokenTotals: () => totals,
    ontologyQueries: () => queries,
    harnessTokens: () => harnessTokens,
    conflicts: () => [...conflicts],
    dispose() {
      disposed = true;
      clearInterval(poll);
      client.off('notification', listener);
    },
  };
}