import type { OpenRouterClient } from '../client/openrouter/client.js';
import type { ChatMessage, ToolCall } from '../client/openrouter/types.js';
import { AGENT_TOOLS, WorkspaceToolExecutor } from './tools.js';
import type { McpClientManager } from '../mcp/clientManager.js';
import type { WorkspaceSummary } from './workspaceContext.js';

export interface AgentLoopOptions {
  client: OpenRouterClient;
  model: string;
  workspaceRoot: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  mcpManager?: McpClientManager;
  onDelta?: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onToolCallStart?: (call: { name: string; args: Record<string, unknown> }) => void;
  onToolCallDone?: (call: { name: string; result: string }) => void;
}

export interface AgentTurnResult {
  completed: boolean;
  finalAssistantMessage: ChatMessage;
  turnsExecuted: number;
  allMessages: ChatMessage[];
  modifiedFiles: string[];
  toolCallsExecuted: number;
}

export function buildCodingAgentSystemPrompt(options: {
  workspaceSummary?: WorkspaceSummary;
  domainId?: string;
  governed?: boolean;
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
    'MANDATORY CODING METHODOLOGY & AUTONOMOUS LOOP:',
    '1. DISCOVER & LOCATE: Use `search_code` or `find_files` to find relevant files, symbols, functions, or shapes. Do not make blind assumptions about paths.',
    '2. READ & UNDERSTAND: Use `read_file` to inspect code and surrounding context before editing.',
    '3. SURGICAL EDIT: Modify code directly using `replace_file_content` (for precision edits) or `write_file` (for new files or full rewrites).',
    '4. SELF-VERIFY (RUN TESTS): After editing files, ALWAYS verify your work! Use `run_bash_command` to execute the project tests or quality checks (always invoke commands via `/usr/bin/rtk`, e.g. `/usr/bin/rtk npm test` or `/usr/bin/rtk pytest`) to ensure the changes compile and pass.',
    '5. ACTION OVER THEORY: When asked to implement, fix, refactor, or perform domain operations (such as asset transfer or retirement), YOU MUST MODIFY THE CODE IN THE WORKSPACE. Never stop at theoretical explanations or recitation of shapes without applying the requested code changes.',
    '6. CONCISE DELIVERY: Present a concise explanation of what was modified, the test results, and reference the git diff.'
  );

  if (options.workspaceSummary?.formattedContext) {
    parts.push('', options.workspaceSummary.formattedContext);
  }

  return parts.join('\n');
}

export async function runAgentTurn(options: AgentLoopOptions): Promise<AgentTurnResult> {
  const executor = new WorkspaceToolExecutor(options.workspaceRoot);
  const maxTurns = options.maxTurns ?? 10;
  let turns = 0;
  let toolCallsExecuted = 0;
  const modifiedFilesSet = new Set<string>();

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

    const tools = [
      ...AGENT_TOOLS,
      ...(options.mcpManager ? options.mcpManager.getToolDefinitions() : []),
    ];

    for await (const chunk of options.client.streamChat({
      model: options.model,
      messages: conversation,
      tools,
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
        allMessages: conversation.filter((m) => m.role !== 'system'),
        modifiedFiles: Array.from(modifiedFilesSet),
        toolCallsExecuted,
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

      if (tc.function.name === 'write_file' || tc.function.name === 'replace_file_content') {
        if (parsedArgs.path) {
          modifiedFilesSet.add(String(parsedArgs.path));
        }
      }

      options.onToolCallStart?.({ name: tc.function.name, args: parsedArgs });

      let resultText = '';
      try {
        if (options.mcpManager?.hasTool(tc.function.name)) {
          resultText = await options.mcpManager.callTool(tc.function.name, parsedArgs);
        } else {
          resultText = await executor.executeTool(tc.function.name, parsedArgs);
        }
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
    allMessages: conversation.filter((m) => m.role !== 'system'),
    modifiedFiles: Array.from(modifiedFilesSet),
    toolCallsExecuted,
  };
}
