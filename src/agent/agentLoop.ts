import type { OpenRouterClient } from '../client/openrouter/client.js';
import type { ChatMessage, ToolCall, StreamUsage } from '../client/openrouter/types.js';
import { AGENT_TOOLS, WorkspaceToolExecutor } from './tools.js';
import type { McpClientManager } from '../mcp/clientManager.js';
import type { WorkspaceSummary } from './workspaceContext.js';
import type { ApprovalBroker } from '../decision/broker.js';
import { BrokerAuthorizationError } from '../decision/broker.js';
import { assertContextBudget } from '../governance/contextBudget.js';
import { captureWorkspaceSnapshot, observedChangedFiles } from './workspaceChanges.js';

export interface TelemetryUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  status: 'MEASURED' | 'ESTIMATED' | 'UNAVAILABLE';
  providerReported: boolean;
}

export interface AgentLoopOptions {
  client: OpenRouterClient;
  model: string;
  workspaceRoot: string;
  projectRoot?: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTurns?: number;
  /** Maximum output tokens requested per model turn. */
  maxTokens?: number;
  /** Selected model context window; when provided, every dispatch is bounded by it. */
  contextLength?: number;
  signal?: AbortSignal;
  mcpManager?: McpClientManager;
  broker?: ApprovalBroker;
  beforeModelRequest?: () => Promise<void>;
  domain?: string;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onAssistantMessage?: (msg: { content: string; intermediate: boolean }) => void;
  onToolCallStart?: (call: { name: string; args: Record<string, unknown> }) => void;
  onToolCallDone?: (call: { name: string; result: string }) => void;
}

export type AgentOutcome = 'completed' | 'rule_blocked' | 'tool_error' | 'turn_limit';

export interface AgentToolFailure {
  tool: string;
  callId: string;
  kind: 'rule_blocked' | 'tool_error';
  reason: string;
  evidence?: 'approval_broker' | 'agent_declared' | 'tool_execution';
  ruleId?: string;
}

export interface AgentTurnResult {
  outcome: AgentOutcome;
  toolFailures: AgentToolFailure[];
  completed: boolean;
  finalAssistantMessage: ChatMessage;
  turnsExecuted: number;
  allMessages: ChatMessage[];
  modifiedFiles: string[];
  toolCallsExecuted: number;
  telemetry?: TelemetryUsage;
}

export function isActionPrompt(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const p = prompt.trim().toLowerCase();
  if (!p) return false;

  const imperativeKeywords = [
    /\b(faça|faca|crie|adicione|implemente|altere|modifique|transfira|remova|delete|deletar|corrija|ajuste|atualize|escreva|coloque|insira)\b/i,
    /\b(make|create|add|implement|modify|change|remove|delete|fix|update|write|put|insert)\b/i,
  ];
  const hasImperative = imperativeKeywords.some((r) => r.test(p));

  const codingTargetKeywords = [
    /\b(endpoint|rota|route|função|funcao|handler|controller|service|api)\b/i,
  ];
  const hasCodingTarget = codingTargetKeywords.some((r) => r.test(p));

  const isQuestion = /^(como|onde|qual|quais|o que|por que|porque|quantos|quantas|what|where|how|why|which)\b/i.test(p) || p.endsWith('?');
  if (isQuestion && !hasImperative) {
    return false;
  }

  return hasImperative || hasCodingTarget;
}

export function buildCodingAgentSystemPrompt(options: {
  workspaceSummary?: WorkspaceSummary;
  domainId?: string;
  governed?: boolean;
  skillsContext?: string;
}): string {
  const parts: string[] = [
    'You are BSH (Business Semantic Harness), an autonomous AI pair programming assistant and expert software engineer.',
    'You are equipped with workspace tools: `search_code`, `find_files`, `read_file`, `write_file`, `replace_file_content`, `list_directory`, `run_bash_command`.',
  ];

  if (options.domainId && options.governed !== false) {
    parts.push(
      `GOVERNANCE: This project is strictly governed by the business domain '${options.domainId}'. All changes, state transitions, and properties must comply with the domain ontology and SHACL shapes.`
    );
  }

  parts.push(
    '',
    'MANDATORY CODING METHODOLOGY & AUTONOMOUS ACTION LOOP:',
    '1. AUTONOMOUS END-TO-END EXECUTION: You are an autonomous coding agent, NOT a conversational Q&A bot. When the user asks you to create an endpoint, implement a feature, modify code, or perform an operation, complete authorized tasks using workspace tools and respect business rules and tool failures.',
    '2. RESPECT OUTCOMES: Apply authorized changes when needed. If a business rule forbids the request, a tool fails, or the requested state already exists, explain the observed outcome. Never mutate merely to satisfy an action classification or bypass a refusal.',
    '3. LOCATE TARGET FILES: Check the workspace context or use `find_files`/`list_directory` to find the actual endpoints, routes, controllers, or models in this project. When using `search_code`, specify concise query keywords.',
    '4. SURGICAL EDITS: Read the file with `read_file` to understand the exact context, then apply edits with `replace_file_content` or `write_file`.',
    '5. SELF-VERIFY: Run test commands with `run_bash_command` (using `/usr/bin/rtk npm test` or `/usr/bin/rtk`) to ensure your modifications compile and pass tests.',
    '6. CONCISE COMPLETION: Explain the files actually changed and the observed outcome. For a business-rule refusal, call `report_task_outcome` with outcome `rule_blocked`, the rule identifier and reason; this records an agent-declared refusal, not validator proof.'
  );

  if (options.workspaceSummary?.formattedContext) {
    parts.push('', options.workspaceSummary.formattedContext);
  }

  if (options.skillsContext) {
    parts.push('', options.skillsContext);
  }

  return parts.join('\n');
}

export async function runAgentTurn(options: AgentLoopOptions): Promise<AgentTurnResult> {
  const executor = new WorkspaceToolExecutor(options.workspaceRoot, options.projectRoot);
  if (options.broker) {
    executor.setBroker(options.broker);
  }
  options.mcpManager?.setBroker(options.broker);
  const maxTurns = options.maxTurns ?? 10;
  let turns = 0;
  let toolCallsExecuted = 0;
  const initialWorkspace = await captureWorkspaceSnapshot(options.workspaceRoot);
  const toolFailures: AgentToolFailure[] = [];
  const observedFiles = async () => observedChangedFiles(initialWorkspace, await captureWorkspaceSnapshot(options.workspaceRoot));

  const conversation: ChatMessage[] = [];
  if (options.systemPrompt && !options.messages.some((m) => m.role === 'system' && m.content === options.systemPrompt)) {
    conversation.push({ role: 'system', content: options.systemPrompt });
  }
  conversation.push(...options.messages);

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTotalTokens = 0;
  let totalCachedTokens = 0;
  let totalReasoningTokens = 0;
  let anyProviderReported = false;
  let totalEstimatedPromptTokens = 0;
  let totalEstimatedCompletionTokens = 0;

  const getTelemetry = (): TelemetryUsage => {
    if (anyProviderReported) {
      return {
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalTotalTokens,
        cachedTokens: totalCachedTokens > 0 ? totalCachedTokens : undefined,
        reasoningTokens: totalReasoningTokens > 0 ? totalReasoningTokens : undefined,
        status: 'MEASURED',
        providerReported: true,
      };
    }
    if (totalEstimatedPromptTokens + totalEstimatedCompletionTokens > 0) {
      return {
        promptTokens: totalEstimatedPromptTokens,
        completionTokens: totalEstimatedCompletionTokens,
        totalTokens: totalEstimatedPromptTokens + totalEstimatedCompletionTokens,
        status: 'ESTIMATED',
        providerReported: false,
      };
    }
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'UNAVAILABLE',
      providerReported: false,
    };
  };

  while (turns < maxTurns) {
    turns++;
    if (options.signal?.aborted) {
      throw new Error('Agent execution aborted by user.');
    }

    let assistantContent = '';
    let turnUsage: StreamUsage | undefined;
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    const tools = [
      ...AGENT_TOOLS,
      {
        type: 'function' as const,
        function: {
          name: 'report_task_outcome',
          description: 'Record an agent-declared business-rule refusal without modifying the workspace. This is not independent validation evidence.',
          parameters: {
            type: 'object',
            properties: {
              outcome: { type: 'string', enum: ['rule_blocked'] },
              ruleId: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['outcome', 'ruleId', 'reason'],
          },
        },
      },
      ...(options.mcpManager ? options.mcpManager.getToolDefinitions() : []),
    ];

    await options.beforeModelRequest?.();
    assertContextBudget({
      contextLength: options.contextLength,
      messages: conversation,
      tools,
      reservedResponseTokens: options.maxTokens ?? 4096,
    });
    for await (const chunk of options.client.streamChat({
      model: options.model,
      maxTokens: options.maxTokens ?? 4096,
      messages: conversation,
      tools,
      signal: options.signal,
    })) {
      if (chunk.usage) {
        turnUsage = chunk.usage;
      }

      if (chunk.delta?.content) {
        assistantContent += chunk.delta.content;
        options.onDelta?.(chunk.delta.content);
      }

      if (chunk.delta?.reasoning) {
        options.onReasoningDelta?.(chunk.delta.reasoning);
      }

      if (chunk.delta?.tool_calls) {
        for (const tc of chunk.delta.tool_calls) {
          const idx = tc.index ?? 0;
          let entry = pendingToolCalls.get(idx);
          if (!entry) {
            entry = { id: tc.id || `call_${Date.now()}_${idx}`, name: '', arguments: '' };
            pendingToolCalls.set(idx, entry);
          }
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name += tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;
        }
      }
    }

    if (turnUsage) {
      anyProviderReported = true;
      const promptTok = turnUsage.prompt_tokens ?? 0;
      const compTok = turnUsage.completion_tokens ?? 0;
      const totTok = turnUsage.total_tokens ?? (promptTok + compTok);
      const cachedTok = turnUsage.prompt_tokens_details?.cached_tokens ?? turnUsage.cached_tokens ?? 0;
      const reasoningTok = turnUsage.completion_tokens_details?.reasoning_tokens ?? turnUsage.reasoning_tokens ?? 0;

      totalPromptTokens += promptTok;
      totalCompletionTokens += compTok;
      totalTotalTokens += totTok;
      totalCachedTokens += cachedTok;
      totalReasoningTokens += reasoningTok;
    } else {
      const estPrompt = Math.ceil(JSON.stringify(conversation).length / 4);
      const estComp = Math.ceil(assistantContent.length / 4);
      totalEstimatedPromptTokens += estPrompt;
      totalEstimatedCompletionTokens += estComp;
    }

    const toolCallsList: ToolCall[] = Array.from(pendingToolCalls.values()).map((p) => ({
      id: p.id,
      type: 'function',
      function: {
        name: p.name,
        arguments: p.arguments,
      },
    }));

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: toolCallsList.length > 0 ? toolCallsList : undefined,
    };
    conversation.push(assistantMsg);

    if (toolCallsList.length > 0 && assistantContent.trim()) {
      options.onAssistantMessage?.({
        content: assistantContent.trim(),
        intermediate: true,
      });
    }

    // If no tool calls in this turn
    if (toolCallsList.length === 0) {
      const outcome: AgentOutcome = toolFailures.some((failure) => failure.kind === 'rule_blocked')
        ? 'rule_blocked'
        : toolFailures.length > 0 ? 'tool_error' : 'completed';
      return {
        completed: outcome === 'completed',
        outcome,
        toolFailures,
        finalAssistantMessage: assistantMsg,
        turnsExecuted: turns,
        allMessages: conversation.filter((m) => m.role !== 'system'),
        modifiedFiles: await observedFiles(),
        toolCallsExecuted,
        telemetry: getTelemetry(),
      };
    }

    // Execute each tool call and append tool responses to conversation
    for (const tc of toolCallsList) {
      toolCallsExecuted++;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      options.onToolCallStart?.({ name: tc.function.name, args: parsedArgs });

      let resultText = '';
      let nativeExecutionCompleted = false;

      if (tc.function.name === 'report_task_outcome') {
        if (parsedArgs.outcome === 'rule_blocked' && typeof parsedArgs.ruleId === 'string' && parsedArgs.ruleId.trim()
          && typeof parsedArgs.reason === 'string' && parsedArgs.reason.trim()) {
          toolFailures.push({ tool: tc.function.name, callId: tc.id, kind: 'rule_blocked',
            reason: parsedArgs.reason, ruleId: parsedArgs.ruleId, evidence: 'agent_declared' });
          resultText = `Agent-declared business-rule refusal recorded: ${parsedArgs.ruleId}: ${parsedArgs.reason}`;
        } else {
          resultText = 'Invalid outcome report: rule_blocked requires a nonempty ruleId and reason.';
          toolFailures.push({ tool: tc.function.name, callId: tc.id, kind: 'tool_error', reason: resultText, evidence: 'tool_execution' });
        }
        options.onToolCallDone?.({ name: tc.function.name, result: resultText });
        conversation.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: resultText });
        continue;
      }

      try {
        if (options.mcpManager?.hasTool(tc.function.name)) {
          resultText = await options.mcpManager.callTool(tc.function.name, parsedArgs, undefined, tc.id, options.domain);
        } else {
          resultText = await executor.executeTool(tc.function.name, parsedArgs, tc.id, options.domain);
          nativeExecutionCompleted = true;
        }
      } catch (err: unknown) {
        resultText = `Error executing ${tc.function.name}: ${err instanceof Error ? err.message : String(err)}`;
        toolFailures.push({ tool: tc.function.name, callId: tc.id, kind: err instanceof BrokerAuthorizationError ? 'rule_blocked' : 'tool_error',
          reason: resultText, evidence: err instanceof BrokerAuthorizationError ? 'approval_broker' : 'tool_execution' });
      }

      if (tc.function.name === 'run_bash_command' && /^(?:Exit code: (?!0(?:\n|$))|Command timed out|Process error:)/.test(resultText)) {
        toolFailures.push({ tool: tc.function.name, callId: tc.id, kind: 'tool_error', reason: resultText });
      }

      if (options.broker && nativeExecutionCompleted) {
        await options.broker.recordToolResult(tc.id, tc.function.name, resultText, options.domain || 'default').catch(() => undefined);
      }

      options.onToolCallDone?.({ name: tc.function.name, result: resultText });

      conversation.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.function.name,
        content: resultText,
      });
    }
  }

  return {
    completed: false,
    outcome: 'turn_limit',
    toolFailures,
    finalAssistantMessage: conversation[conversation.length - 1],
    turnsExecuted: turns,
    allMessages: conversation.filter((m) => m.role !== 'system'),
    modifiedFiles: await observedFiles(),
    toolCallsExecuted,
    telemetry: getTelemetry(),
  };
}
