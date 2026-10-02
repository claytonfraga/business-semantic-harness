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
  onAssistantMessage?: (msg: { content: string; intermediate: boolean }) => void;
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
    '1. AUTONOMOUS END-TO-END EXECUTION: You are an autonomous coding agent, NOT a conversational Q&A bot. When the user asks you to create an endpoint, implement a feature, modify code, or perform an operation, YOU MUST COMPLETE THE TASK BY MODIFYING THE FILES IN THE WORKSPACE DIRECTLY.',
    '2. NEVER STOP WITHOUT WRITING CODE: If the user asked for an action, endpoint, or code change, DO NOT just inspect files and print code snippets in the chat. You must call `replace_file_content` or `write_file` to write the changes directly to disk.',
    '3. LOCATE TARGET FILES: Check the workspace context or use `find_files`/`list_directory` to find where endpoints, routes, controllers, or models are defined (e.g. `src/assets/infrastructure/asset-http-server.ts`, `src/server.ts`). When using `search_code`, specify concise query keywords.',
    '4. SURGICAL EDITS: Read the file with `read_file` to understand the exact context, then apply edits with `replace_file_content` or `write_file`.',
    '5. SELF-VERIFY: Run test commands with `run_bash_command` (using `/usr/bin/rtk npm test` or `/usr/bin/rtk`) to ensure your modifications compile and pass tests.',
    '6. CONCISE COMPLETION: Explain what files you modified and what endpoint/feature was implemented.'
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

    if (toolCallsList.length > 0 && assistantContent.trim()) {
      options.onAssistantMessage?.({
        content: assistantContent.trim(),
        intermediate: true,
      });
    }

    // If no tool calls in this turn
    if (toolCallsList.length === 0) {
      // Find the user's task request in conversation
      const lastUserMsg = conversation.slice().reverse().find((m) => m.role === 'user');
      const userPrompt = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';
      const isActionRequest = isActionPrompt(userPrompt);

      // If user requested an action/endpoint/code modification, but the model has not modified any files yet,
      // and we haven't exhausted turns, prompt the model to proceed with file edits rather than stopping.
      if (isActionRequest && modifiedFilesSet.size === 0 && turns < maxTurns) {
        conversation.push({
          role: 'user',
          content: 'You investigated the codebase or presented code in chat, but NO files have been modified in the workspace yet. The user explicitly requested an implementation or code change. As an autonomous coding agent, you must execute the changes directly: locate the target file (such as routes, controllers, or domain services) and call `replace_file_content` or `write_file` to apply the implementation in the code now.',
        });
        continue;
      }

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
