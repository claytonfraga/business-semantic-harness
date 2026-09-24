import { constants } from 'node:fs';
import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertProjectDirectory } from '../project/paths.js';
import { resolveProjectFile } from '../project/paths.js';

export interface AuditEvent {
  time: string;
  actionId: string;
  domain: string;
  actionDigest: string;
  snapshotDigest: string;
  rules: string[];
  evaluation: string;
  confidence: string;
  decision: 'allow' | 'deny';
  actor?: string;
  reason: string;
}

function redact(value: string, secrets: readonly string[]): string {
  let result = value;
  for (const secret of secrets) {
    if (secret) result = result.replaceAll(secret, '[REDACTED]');
  }
  return result;
}

export async function appendAudit(root: string, event: AuditEvent, secrets: readonly string[] = []): Promise<void> {
  const directory = join(root, '.bsh', 'local');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertProjectDirectory(root, directory);
  await chmod(directory, 0o700);
  const path = join(directory, 'events.jsonl');
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW;
  const handle = await open(path, flags, 0o600);
  try {
    await handle.chmod(0o600);
    const clean = {
      ...event,
      actionId: redact(event.actionId, secrets),
      domain: redact(event.domain, secrets),
      rules: event.rules.map((rule) => redact(rule, secrets)),
      actor: event.actor ? redact(event.actor, secrets) : undefined,
      reason: redact(event.reason, secrets),
    };
    const line = JSON.stringify(clean) + '\n';
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readAudit(root: string, actionId?: string): Promise<AuditEvent[]> {
  let content: string;
  try {
    content = await readFile(await resolveProjectFile(root, '.bsh/local/events.jsonl'), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const events = content.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AuditEvent);
  return actionId ? events.filter((event) => event.actionId === actionId) : events;
}
