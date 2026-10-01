import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ConflictAlert {
  domain: string;
  request: string;
  conflictingRules: string[];
  reason: string;
}

function parseAlert(line: string): ConflictAlert | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    const rules = Array.isArray(value.conflictingRules) ? value.conflictingRules.filter((rule): rule is string => typeof rule === 'string') : [];
    if (typeof value.domain !== 'string' || typeof value.reason !== 'string') return undefined;
    return {
      domain: value.domain,
      request: typeof value.request === 'string' ? value.request : '',
      conflictingRules: rules,
      reason: value.reason,
    };
  } catch {
    return undefined;
  }
}

export async function readConflictAlerts(alertsFile: string): Promise<ConflictAlert[]> {
  let content: string;
  try { content = await readFile(alertsFile, 'utf8'); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const alerts: ConflictAlert[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const alert = parseAlert(line);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

export async function countLines(file: string): Promise<number> {
  try {
    const content = await readFile(file, 'utf8');
    return content.split('\n').filter((line) => line.trim().length > 0).length;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}

export async function writeAlerts(root: string, sessionId: string, alerts: ConflictAlert[]): Promise<string> {
  const directory = join(root, '.bsh', 'local');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'alerts.jsonl');
  const lines = alerts
    .map((alert) => JSON.stringify({ time: new Date().toISOString(), sessionId, severity: 'ALERTA', ...alert }))
    .join('\n');
  if (lines.length > 0) await appendFile(file, `${lines}\n`, { mode: 0o600 });
  return file;
}