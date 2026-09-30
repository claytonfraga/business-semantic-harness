export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing?: {
    prompt: string;
    completion: string;
    request?: string;
    image?: string;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface StreamDelta {
  content?: string;
  reasoning?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface StreamChunk {
  delta?: StreamDelta;
  finish_reason?: string | null;
  usage?: StreamUsage;
}
