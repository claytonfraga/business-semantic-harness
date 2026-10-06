import type { ChatMessage, ToolDefinition } from '../client/openrouter/types.js';

export interface ContextBudgetInput {
  /** Selected model context window when known; omitted when the host cannot resolve it. */
  contextLength?: number;
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  reservedResponseTokens?: number;
}

export interface ContextBudgetResult {
  ok: boolean;
  limit?: number;
  estimatedTokens: number;
  availableTokens?: number;
  reservedResponseTokens: number;
  method: string;
  limitations: string[];
  diagnostic?: string;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_RESERVED_RESPONSE_TOKENS = 4096;

/**
 * Size check performed before any provider call. The estimate is a documented
 * heuristic (JavaScript UTF-16 code units divided by four), not a model tokenizer, so it
 * only ever guards the boundary: it never truncates rules or dependencies and
 * never substitutes the user-selected model.
 */
export function evaluateContextBudget(input: ContextBudgetInput): ContextBudgetResult {
  const reservedResponseTokens = input.reservedResponseTokens ?? DEFAULT_RESERVED_RESPONSE_TOKENS;
  let characters = input.systemPrompt?.length ?? 0;
  characters += JSON.stringify(input.messages).length;
  if (input.tools && input.tools.length > 0) characters += JSON.stringify(input.tools).length;
  const estimatedTokens = Math.ceil(characters / CHARS_PER_TOKEN);
  const limitations = [
    'Context size is estimated as JavaScript UTF-16 code units divided by four; provider tokenizers and framing can differ per model.',
  ];
  const knownLimit = typeof input.contextLength === 'number' && Number.isFinite(input.contextLength) && input.contextLength > 0 ? input.contextLength : undefined;
  if (knownLimit === undefined) {
    limitations.push('The selected model window is unknown; dispatch is denied by default.');
    return {
      ok: false,
      estimatedTokens,
      reservedResponseTokens,
      method: 'character/4 estimate',
      limitations,
      diagnostic: 'Selected model context window is unknown. Request not sent; restore model metadata or supply an explicit positive contextLength through the host. The selected model and all rules remain unchanged.',
    };
  }
  const availableTokens = knownLimit - reservedResponseTokens;
  if (estimatedTokens > availableTokens) {
    return {
      ok: false,
      limit: knownLimit,
      estimatedTokens,
      availableTokens,
      reservedResponseTokens,
      method: 'character/4 estimate',
      limitations,
      diagnostic: `Prepared context of ~${estimatedTokens} tokens exceeds the selected model window (${knownLimit} tokens, ${reservedResponseTokens} reserved for the response) before any provider call. No rule or dependency was truncated; select a larger model or reduce the request scope.`,
    };
  }
  return {
    ok: true,
    limit: knownLimit,
    estimatedTokens,
    availableTokens,
    reservedResponseTokens,
    method: 'character/4 estimate',
    limitations,
  };
}

export class ContextBudgetError extends Error {
  constructor(public readonly result: ContextBudgetResult) {
    super(result.diagnostic ?? 'Prepared context exceeds the selected model window before dispatch.');
    this.name = 'ContextBudgetError';
  }
}

export function assertContextBudget(input: ContextBudgetInput): ContextBudgetResult {
  const result = evaluateContextBudget(input);
  if (!result.ok) throw new ContextBudgetError(result);
  return result;
}
