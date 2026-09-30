import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

export interface PkceCodes {
  verifier: string;
  challenge: string;
}

export interface EphemeralAuthResult {
  apiKey: string;
}

/**
 * Generates high-entropy PKCE code verifier and code challenge.
 */
export function generatePkceCodes(): PkceCodes {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Exchanges the authorization code received from callback for an OpenRouter API key.
 */
export async function exchangeCodeForApiKey(
  code: string,
  verifier: string,
  baseUrl = 'https://openrouter.ai/api/v1'
): Promise<string> {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${cleanBase}/auth/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      code_challenge_method: 'S256',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter key exchange failed (${response.status}): ${errorText}`);
  }

  const json = (await response.json()) as { key?: string };
  if (!json.key) {
    throw new Error('OpenRouter response did not contain an API key');
  }

  return json.key;
}

export interface WebAuthServerOptions {
  port?: number;
  timeoutMs?: number;
  openRouterAuthUrl?: string;
  onUrlReady?: (url: string) => void;
}

/**
 * Starts an ephemeral local HTTP server and waits for OpenRouter OAuth callback.
 * Does not write any credentials to disk; returns the API key strictly in-memory.
 */
export async function authenticateViaWebBrowser(
  options: WebAuthServerOptions = {}
): Promise<EphemeralAuthResult> {
  const { verifier, challenge } = generatePkceCodes();
  const timeoutMs = options.timeoutMs ?? 120_000; // 2 minutes timeout
  const authEndpoint = options.openRouterAuthUrl || 'https://openrouter.ai/auth';

  return new Promise<EphemeralAuthResult>((resolve, reject) => {
    let server: Server | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (server) {
        server.close();
        server = null;
      }
    };

    server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (reqUrl.pathname === '/callback') {
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f87171;">
                  <h2>Authentication Failed</h2>
                  <p>${error}</p>
                  <p style="color: #94a3b8;">You may close this tab and try again in the terminal.</p>
                </body>
              </html>
            `);
            cleanup();
            reject(new Error(`OAuth error received from OpenRouter: ${error}`));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing code parameter');
            return;
          }

          // Send immediate friendly feedback to browser
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #0f172a; color: #f8fafc;">
                <h2 style="color: #38bdf8;">Authentication Successful!</h2>
                <p>BSH has received your temporary authorization.</p>
                <p style="color: #94a3b8;">You can close this tab and return to your terminal.</p>
              </body>
            </html>
          `);

          cleanup();

          // Exchange code for API key
          try {
            const apiKey = await exchangeCodeForApiKey(code, verifier);
            resolve({ apiKey });
          } catch (exchangeErr) {
            reject(exchangeErr);
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    server.listen(options.port || 0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr === 'string') {
        cleanup();
        reject(new Error('Failed to bind local callback server'));
        return;
      }

      const callbackUrl = `http://localhost:${addr.port}/callback`;
      const authUrl = `${authEndpoint}?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${challenge}&code_challenge_method=S256`;

      options.onUrlReady?.(authUrl);

      timeoutTimer = setTimeout(() => {
        cleanup();
        reject(new Error('Authentication timed out waiting for browser callback.'));
      }, timeoutMs);
    });

    server.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}
