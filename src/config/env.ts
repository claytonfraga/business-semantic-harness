import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadUserAuth } from './userStore.js';

export interface EnvConfig {
  openRouterApiKey?: string;
  apiKeySource?: 'env' | 'user_store' | 'file' | 'none';
  defaultModel?: string;
  defaultDomain?: string;
  confirmPromptViolations?: boolean;
}

/**
 * Parses simple KEY=VALUE format lines from a .env file.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
  }
  return result;
}

/**
 * Loads configuration from process.env, global user store (~/.config/bsh/auth.json), and optional .env in projectRoot.
 * Cascading precedence: process.env > global user store > project .env
 */
export async function loadEnvConfig(projectRoot: string = process.cwd()): Promise<EnvConfig> {
  let fileEnv: Record<string, string> = {};
  const envPath = join(projectRoot, '.env');
  try {
    const raw = await readFile(envPath, 'utf8');
    fileEnv = parseEnvContent(raw);
  } catch {
    // Project .env is optional
  }

  const userAuth = await loadUserAuth();

  let openRouterApiKey: string | undefined;
  let apiKeySource: EnvConfig['apiKeySource'] = 'none';

  if (process.env.OPENROUTER_API_KEY) {
    openRouterApiKey = process.env.OPENROUTER_API_KEY;
    apiKeySource = 'env';
  } else if (fileEnv.OPENROUTER_API_KEY) {
    openRouterApiKey = fileEnv.OPENROUTER_API_KEY;
    apiKeySource = 'file';
  } else if (userAuth.apiKey) {
    openRouterApiKey = userAuth.apiKey;
    apiKeySource = 'user_store';
  }

  const defaultModel = process.env.BSH_DEFAULT_MODEL || fileEnv.BSH_DEFAULT_MODEL;
  const defaultDomain = process.env.BSH_DEFAULT_DOMAIN || fileEnv.BSH_DEFAULT_DOMAIN;

  const rawConfirm = process.env.BSH_CONFIRM_PROMPT_VIOLATIONS ?? fileEnv.BSH_CONFIRM_PROMPT_VIOLATIONS;
  const confirmPromptViolations = rawConfirm !== undefined ? rawConfirm.toLowerCase() === 'true' : true;

  return {
    openRouterApiKey,
    apiKeySource,
    defaultModel,
    defaultDomain,
    confirmPromptViolations,
  };
}

/**
 * Updates or sets a key-value pair in .env in projectRoot, creating the file if missing.
 */
export async function saveEnvConfig(
  updates: Record<string, string>,
  projectRoot: string = process.cwd()
): Promise<void> {
  const envPath = join(projectRoot, '.env');
  let currentContent = '';
  try {
    currentContent = await readFile(envPath, 'utf8');
  } catch {
    currentContent = '';
  }

  const envMap = parseEnvContent(currentContent);
  for (const [k, v] of Object.entries(updates)) {
    envMap[k] = v;
  }

  const newLines = Object.entries(envMap).map(([k, v]) => `${k}=${v}`);
  await writeFile(envPath, `${newLines.join('\n')}\n`, { mode: 0o600 });
}
