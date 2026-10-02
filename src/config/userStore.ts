import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

export interface UserAuthConfig {
  apiKey?: string;
  updatedAt?: string;
}

/**
 * Resolves the configuration directory for the current user following OS standards
 * (XDG on Linux/WSL, Application Support on macOS, %APPDATA% on Windows).
 */
export function getUserConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'bsh');
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    return join(xdg, 'bsh');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'bsh');
  }
  return join(homedir(), '.config', 'bsh');
}

/**
 * Returns the absolute path to the user credentials file.
 */
export function getAuthFilePath(): string {
  return join(getUserConfigDir(), 'auth.json');
}

/**
 * Safely persists user authentication credentials to the global OS user store.
 * Enforces directory mode 0700 and file mode 0600.
 */
export async function saveUserAuth(data: UserAuthConfig): Promise<void> {
  const dir = getUserConfigDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const payload: UserAuthConfig = {
    ...data,
    updatedAt: data.updatedAt || new Date().toISOString(),
  };
  await writeFile(getAuthFilePath(), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Loads user authentication credentials from the global OS user store.
 * Returns empty object if file does not exist or cannot be parsed.
 */
export async function loadUserAuth(): Promise<UserAuthConfig> {
  try {
    const raw = await readFile(getAuthFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as UserAuthConfig;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Deletes user credentials from the global OS user store.
 * Idempotent: returns true if file was deleted, false if file did not exist.
 */
export async function deleteUserAuth(): Promise<boolean> {
  try {
    await unlink(getAuthFilePath());
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

/**
 * Masks an API key for safe terminal display, showing only prefix and trailing characters.
 * E.g., "sk-or-v1-abcdef1234567890" -> "sk-or-v1-••••••••7890"
 */
export function maskApiKey(apiKey?: string): string {
  if (!apiKey) return '(nenhuma)';
  if (apiKey.length <= 12) {
    return '••••••••';
  }
  const prefix = apiKey.slice(0, 8);
  const suffix = apiKey.slice(-4);
  return `${prefix}••••••••${suffix}`;
}
