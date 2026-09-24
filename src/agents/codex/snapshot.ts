import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

const SKIP = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next', '.cache']);

function sha(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function listFiles(root: string, current = root, result = new Map<string, string>()): Promise<Map<string, string>> {
  let entries: Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    const key = relative(root, absolute).split(sep).join('/');
    if (key === '.bsh/local' || key.startsWith('.bsh/local/')) continue;
    if (entry.isDirectory()) {
      await listFiles(root, absolute, result);
    } else if (entry.isFile()) {
      result.set(key, sha(await readFile(absolute)));
    }
  }
  return result;
}

export async function createProjectBackup(root: string, backupDirectory: string): Promise<void> {
  await rm(backupDirectory, { recursive: true, force: true });
  await mkdir(backupDirectory, { recursive: true });
  await cp(root, backupDirectory, {
    recursive: true,
    filter: (source) => !SKIP.has(basename(source)),
  });
}

export interface FileChange {
  path: string;
  existedBefore: boolean;
}

export async function collectChangedPaths(root: string, backupDirectory: string): Promise<FileChange[]> {
  const [before, after] = await Promise.all([listFiles(backupDirectory), listFiles(root)]);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: FileChange[] = [];
  for (const path of paths) {
    const beforeHash = before.get(path);
    const afterHash = after.get(path);
    if (beforeHash === afterHash) continue;
    changes.push({ path, existedBefore: beforeHash !== undefined });
  }
  return changes;
}

export async function restoreFile(root: string, backupDirectory: string, change: FileChange): Promise<void> {
  const source = join(backupDirectory, change.path);
  const target = join(root, change.path);
  if (change.existedBefore) {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  } else {
    await rm(target, { force: true });
  }
}