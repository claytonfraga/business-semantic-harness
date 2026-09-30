import type { OpenRouterClient } from '../client/openrouter/client.js';
import type { ChatMessage, ToolCall } from '../client/openrouter/types.js';
import { AGENT_TOOLS, WorkspaceToolExecutor } from './tools.js';

export interface AgentLoopOptions {
  client: OpenRouterClient;
  model: string;
  workspaceRoot: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onToolCallStart?: (call: { name: string; args: Record<string, unknown> }) => void;
  onToolCallDone?: (call: { name: string; result: string }) => void;
}

export interface AgentTurnResult {
  completed: boolean;
  finalAssistantMessage: ChatMessage;
  turnsExecuted: number;
}

export async function runAgentTurn(options: AgentLoopOptions): Promise<AgentTurnResult> {
  const executor = new WorkspaceToolExecutor(options.workspaceRoot);
  const maxTurns = options.maxTurns ?? 10;
  let turns = 0;

  const conversation: ChatMessage[] = [];
  if (options.systemPrompt && !options.messages.some((m) => m.role === 'system')) {
    conversation.push({ role: 'system', content: options.systemPrompt });
  }
  conversation.push(...options.messages);

  while (turns < maxTurns) {
    turns++;
    if (options.signal?.aborted) {
      throw new Error('Agent execution aborted by user.');
    }

    let assistantContent = '';
    const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

    for await (const chunk of options.client.streamChat({
      model: options.model,
      messages: conversation,
      tools: AGENT_TOOLS,
      signal: options.signal,
    })) {
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

    // If no tool calls, model finished its response
    if (toolCallsList.length === 0) {
      return {
        completed: true,
        finalAssistantMessage: assistantMsg,
        turnsExecuted: turns,
      };
    }

    // Execute each tool call and append tool responses to conversation
    for (const tc of toolCallsList) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      options.onToolCallStart?.({ name: tc.function.name, args: parsedArgs });

      let resultText = '';
      try {
        resultText = await executor.executeTool(tc.function.name, parsedArgs);
      } catch (err: unknown) {
        resultText = `Error executing ${tc.function.name}: ${err instanceof Error ? err.message : String(err)}`;
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
    finalAssistantMessage: conversation[conversation.length - 1],
    turnsExecuted: turns,
  };
}
