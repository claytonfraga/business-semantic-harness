import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface EnvConfig {
  openRouterApiKey?: string;
  defaultModel?: string;
  defaultDomain?: string;
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
 * Loads configuration from process.env and optional .env in projectRoot.
 */
export async function loadEnvConfig(projectRoot: string = process.cwd()): Promise<EnvConfig> {
  let fileEnv: Record<string, string> = {};
  const envPath = join(projectRoot, '.env');
  try {
    const raw = await readFile(envPath, 'utf8');
    fileEnv = parseEnvContent(raw);
  } catch {
    // If not found in projectRoot, try process.cwd() as fallback
    if (projectRoot !== process.cwd()) {
      try {
        const cwdRaw = await readFile(join(process.cwd(), '.env'), 'utf8');
        fileEnv = parseEnvContent(cwdRaw);
      } catch {
        // Ignore missing fallback
      }
    }
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY || fileEnv.OPENROUTER_API_KEY;
  const defaultModel = process.env.BSH_DEFAULT_MODEL || fileEnv.BSH_DEFAULT_MODEL;
  const defaultDomain = process.env.BSH_DEFAULT_DOMAIN || fileEnv.BSH_DEFAULT_DOMAIN;

  return {
    openRouterApiKey,
    defaultModel,
    defaultDomain,
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
