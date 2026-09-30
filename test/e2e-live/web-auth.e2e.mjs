import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { authenticateViaWebBrowser } from '../../dist/client/openrouter/pkce.js';
import { loadEnvConfig } from '../../dist/config/env.js';

test('Given a project with no API key, when user authenticates via Web OAuth, then ephemeral key is obtained and no .env file is created', async () => {
  const tempProject = mkdtempSync(join(tmpdir(), 'bsh-webauth-test-'));
  const originalFetch = globalThis.fetch;

  try {
    // 1. Initial state: no .env exists
    const initialEnv = await loadEnvConfig(tempProject);
    assert.equal(existsSync(join(tempProject, '.env')), false);

    // 2. Mock OpenRouter key exchange endpoint
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/auth/keys')) {
        return new Response(JSON.stringify({ key: 'sk-or-v1-ephemeral-session-key-999' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(url, opts);
    };

    // 3. Start ephemeral web auth
    let receivedAuthUrl = '';
    const authPromise = authenticateViaWebBrowser({
      onUrlReady: (url) => {
        receivedAuthUrl = url;
      },
    });

    // Wait for local server
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(receivedAuthUrl.includes('code_challenge='));

    const parsed = new URL(receivedAuthUrl);
    const callback = parsed.searchParams.get('callback_url');
    assert.ok(callback);

    // 4. Simulate user completing auth in browser and redirecting back
    const redirectRes = await fetch(`${callback}?code=auth_code_xyz`);
    assert.equal(redirectRes.status, 200);

    const authResult = await authPromise;
    assert.equal(authResult.apiKey, 'sk-or-v1-ephemeral-session-key-999');

    // 5. Verify invariant: NO .env or credentials stored on disk
    assert.equal(existsSync(join(tempProject, '.env')), false);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(tempProject, { recursive: true, force: true });
  }
});
