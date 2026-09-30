import type {
  ChatMessage,
  OpenRouterModel,
  StreamChunk,
  ToolCall,
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
      context_length: m.context_length || 8192,
      pricing: m.pricing,
    }));
    this.cacheTimestamp = now;

    return this.modelsCache;
  }

  /**
   * Creates a streaming chat completion yielding incremental chunks.
   */
  async *streamChat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk, void, unknown> {
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
    if (typeof options.maxTokens === 'number') {
      body.max_tokens = options.maxTokens;
    }

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
