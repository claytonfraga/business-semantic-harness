import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenRouterClient } from '../../dist/client/openrouter/client.js';

test('Given an OpenRouterClient with apiKey, when verifyApiKey is called and server returns 200, then returns valid true', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.match(String(url), /\/auth\/key$/);
      assert.equal(opts.headers.Authorization, 'Bearer sk-or-test');
      return new Response(JSON.stringify({ data: { label: 'my-test-key', usage: 10, limit: 100 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new OpenRouterClient({ apiKey: 'sk-or-test' });
    const res = await client.verifyApiKey();
    assert.equal(res.valid, true);
    assert.equal(res.label, 'my-test-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Given an OpenRouterClient, when getModels is called, then models list is returned and cached', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  try {
    globalThis.fetch = async (url) => {
      fetchCount++;
      return new Response(
        JSON.stringify({
          data: [
            { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', context_length: 64000 },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context_length: 200000 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new OpenRouterClient({ apiKey: 'sk-or-test' });
    const models1 = await client.getModels();
    assert.equal(models1.length, 2);
    assert.equal(models1[0].id, 'deepseek/deepseek-chat');

    // Second call should use cache
    const models2 = await client.getModels();
    assert.equal(models2.length, 2);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Given an OpenRouterClient, when streamChat is called, then SSE stream chunks are yielded', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      'data: {"choices":[{"delta":{"content":" world!"}}]}',
      'data: [DONE]',
    ].join('\n\n') + '\n\n';

    globalThis.fetch = async () => {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseBody));
          controller.close();
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      });
    };

    const client = new OpenRouterClient({ apiKey: 'sk-or-test' });
    const chunks = [];
    for await (const chunk of client.streamChat({
      model: 'deepseek/deepseek-chat',
      messages: [{ role: 'user', content: 'Hi' }],
    })) {
      if (chunk.delta?.content) {
        chunks.push(chunk.delta.content);
      }
    }

    assert.deepEqual(chunks, ['Hello', ' world!']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
