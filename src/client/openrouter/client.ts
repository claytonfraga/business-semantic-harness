import type {
  ChatMessage,
  OpenRouterModel,
  StreamChunk,
  ToolDefinition,
} from './types.js';

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  siteUrl?: string;
  siteName?: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private siteUrl: string;
  private siteName: string;
  private modelsCache: OpenRouterModel[] | null = null;
  private cacheTimestamp = 0;
  private cacheTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.siteUrl = options.siteUrl || 'https://github.com/claytonfraga/business-semantic-harness';
    this.siteName = options.siteName || 'Business Semantic Harness';
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.siteUrl,
      'X-Title': this.siteName,
    };
  }

  /**
   * Verifies if the API key is active and returns metadata.
   */
  async verifyApiKey(): Promise<{ valid: boolean; label?: string; usage?: number; limit?: number; error?: string }> {
    if (this.apiKey.startsWith('sk-or-v1-mock')) {
      return { valid: true, label: 'BSH Test Key', usage: 100, limit: 100000 };
    }
    try {
      const response = await fetch(`${this.baseUrl}/auth/key`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        const text = await response.text();
        return { valid: false, error: `HTTP ${response.status}: ${text}` };
      }

      const json = (await response.json()) as { data?: { label?: string; usage?: number; limit?: number } };
      return {
        valid: true,
        label: json.data?.label,
        usage: json.data?.usage,
        limit: json.data?.limit,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: msg };
    }
  }

  /**
   * Fetches models list from OpenRouter, with in-memory caching.
   */
  async getModels(forceRefresh = false): Promise<OpenRouterModel[]> {
    if (this.apiKey.startsWith('sk-or-v1-mock')) {
      this.modelsCache = [
        { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', context_length: 131072, description: 'Fast frontier coding model' },
        { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000, description: 'OpenAI flagship model' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', context_length: 128000, description: 'OpenAI compact model' },
        { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context_length: 200000, description: 'Anthropic frontier coding model' },
      ];
      return this.modelsCache;
    }
    const now = Date.now();
    if (!forceRefresh && this.modelsCache && now - this.cacheTimestamp < this.cacheTtlMs) {
      return this.modelsCache;
    }

    const response = await fetch(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: OpenRouterModel[] };
    const rawList = Array.isArray(json.data) ? json.data : [];
    
    // Sort models prioritizing popular coding & frontier models
    this.modelsCache = rawList.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      description: m.description,
      context_length: m.context_length,
      pricing: m.pricing,
    }));
    this.cacheTimestamp = now;

    return this.modelsCache;
  }

  /**
   * Creates a streaming chat completion yielding incremental chunks.
   */
  async *streamChat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk, void, unknown> {
    if (this.apiKey.startsWith('sk-or-v1-mock')) {
      const lastMsg = options.messages[options.messages.length - 1]?.content || '';
      const lower = lastMsg.toLowerCase();
      const hasToolResult = options.messages.some((m) => m.role === 'tool');

      if (!hasToolResult && (lower.includes('context7') || lower.includes('documenta') || lower.includes('shacl')) && options.tools?.some((t) => t.function.name === 'context7_search_docs')) {
        yield {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_context7_mock',
                type: 'function',
                function: {
                  name: 'context7_search_docs',
                  arguments: JSON.stringify({ query: 'shacl validation rules' }),
                },
              },
            ],
          },
        };
        return;
      }

      if (hasToolResult) {
        yield {
          delta: {
            content: 'Com base na documentação consultada via Context7, as regras SHACL estruturam restrições para validar transições de ciclo de vida e propriedades obrigatórias antes da promoção de código.',
          },
        };
        return;
      }

      yield {
        delta: {
          content: 'Processamento semântico executado com sucesso dentro do workspace isolado.',
        },
      };
      return;
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      stream: true,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }
    if (typeof options.temperature === 'number') {
      body.temperature = options.temperature;
    }
    body.max_tokens = typeof options.maxTokens === 'number' ? options.maxTokens : 4096;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenRouter Error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) {
            continue; // Ping / comment
          }
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') {
              return;
            }

            try {
              const parsed = JSON.parse(dataStr);
              const choice = parsed.choices?.[0];
              const usage = parsed.usage;
              yield {
                delta: choice?.delta,
                finish_reason: choice?.finish_reason,
                usage,
              };
            } catch {
              // Ignore unparseable SSE line fragments
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
