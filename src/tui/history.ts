import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Loads project-specific prompt history from `<projectRoot>/.bsh/history.json`.
 * Returns array ordered newest-first (suitable for Node.js readline).
 */
export async function loadPromptHistory(projectRoot: string): Promise<string[]> {
  try {
    const historyPath = join(projectRoot, '.bsh', 'history.json');
    const raw = await readFile(historyPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      // In history.json prompts are stored chronologically: [oldest, ..., newest].
      // Readline expects newest first: [newest, ..., oldest].
      return valid.reverse();
    }
  } catch {
    // File missing or unreadable - start with empty history
  }
  return [];
}

/**
 * Persists prompt history to `<projectRoot>/.bsh/history.json`.
 * Accepts array in readline format (newest first) and saves in chronological order.
 */
export async function savePromptHistory(projectRoot: string, historyNewestFirst: string[]): Promise<void> {
  try {
    const bshDir = join(projectRoot, '.bsh');
    await mkdir(bshDir, { recursive: true });
    const historyPath = join(bshDir, 'history.json');

    const clean = historyNewestFirst.filter((item) => typeof item === 'string' && item.trim().length > 0);
    // Reverse to store chronologically: [oldest, ..., newest]
    const chronological = [...clean].reverse();
    // Clamp to last 1000 prompts
    const clamped = chronological.slice(-1000);

    await writeFile(historyPath, JSON.stringify(clamped, null, 2), 'utf8');
  } catch {
    // Best-effort persistence
  }
}
