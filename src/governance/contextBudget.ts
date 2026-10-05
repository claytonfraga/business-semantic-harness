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
const CONSERVATIVE_UNKNOWN_WINDOW = 32768;

/**
 * Size check performed before any provider call. The estimate is a documented
 * heuristic (UTF-8 characters divided by four), not a model tokenizer, so it
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
    'Context size is estimated as UTF-8 characters divided by four; provider tokenizers can differ per model.',
  ];
  const knownLimit = typeof input.contextLength === 'number' && input.contextLength > 0 ? input.contextLength : undefined;
  if (knownLimit === undefined) {
    limitations.push(`Selected model context window is unknown; the request is reported against a conservative ${CONSERVATIVE_UNKNOWN_WINDOW}-token floor without truncating rules or dependencies.`);
    return {
      ok: true,
      estimatedTokens,
      availableTokens: CONSERVATIVE_UNKNOWN_WINDOW - reservedResponseTokens,
      reservedResponseTokens,
      method: 'character/4 estimate',
      limitations,
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
