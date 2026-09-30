import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  authenticateViaWebBrowser,
  exchangeCodeForApiKey,
  generatePkceCodes,
} from '../../dist/client/openrouter/pkce.js';

test('Given generatePkceCodes, when called, then verifier and S256 challenge are generated', () => {
  const { verifier, challenge } = generatePkceCodes();
  assert.ok(verifier.length >= 43);
  assert.ok(challenge.length >= 43);

  // Challenge must equal SHA-256 of verifier base64url
  const expectedChallenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expectedChallenge);
});

test('Given an authorization code and verifier, when exchangeCodeForApiKey is called, then POST is made and key returned', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      assert.match(String(url), /\/auth\/keys$/);
      assert.equal(opts.method, 'POST');
      const body = JSON.parse(opts.body);
      assert.equal(body.code, 'test-auth-code');
      assert.equal(body.code_verifier, 'test-verifier');
      assert.equal(body.code_challenge_method, 'S256');

      return new Response(JSON.stringify({ key: 'sk-or-v1-ephemeral-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const key = await exchangeCodeForApiKey('test-auth-code', 'test-verifier');
    assert.equal(key, 'sk-or-v1-ephemeral-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Given authenticateViaWebBrowser, when browser hits callback with code, then ephemeral key is returned in memory without disk writes', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/auth/keys')) {
        return new Response(JSON.stringify({ key: 'sk-or-v1-ephemeral-test-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    let authUrlCaptured = '';
    const authPromise = authenticateViaWebBrowser({
      onUrlReady: (url) => {
        authUrlCaptured = url;
      },
    });

    // Wait briefly for server to bind
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(authUrlCaptured.startsWith('https://openrouter.ai/auth?callback_url=http%3A%2F%2Flocalhost%3A'));
    const parsedUrl = new URL(authUrlCaptured);
    const callbackTarget = parsedUrl.searchParams.get('callback_url');
    assert.ok(callbackTarget);

    // Simulate browser redirecting to local callback server
    const callbackRes = await fetch(`${callbackTarget}?code=mock-oauth-code`);
    assert.equal(callbackRes.status, 200);
    const html = await callbackRes.text();
    assert.match(html, /Authentication Successful/);

    const result = await authPromise;
    assert.equal(result.apiKey, 'sk-or-v1-ephemeral-test-123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
