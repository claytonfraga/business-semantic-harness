import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PatchProposal } from './patch.js';

const SKIP = new Set(['.git', 'node_modules', 'dist', 'coverage', '.next', '.cache']);
const decoder = new TextDecoder('utf-8', { fatal: true });

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function metadata(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function collectFiles(root: string, relative = '', result = new Set<string>()): Promise<Set<string>> {
  const directory = join(root, relative);
  const info = await metadata(directory);
  if (!info) return result;
  if (!info.isDirectory()) { result.add(relative); return result; }
  for (const name of await readdir(directory)) {
    if (!relative && SKIP.has(name)) continue;
    if (relative === '.oracle' && name === 'local') continue;
    await collectFiles(root, relative ? `${relative}/${name}` : name, result);
  }
  return result;
}

export async function collectWorkspaceChanges(root: string, workspace: string, domain: string): Promise<PatchProposal[]> {
  const [source, staged] = await Promise.all([collectFiles(root), collectFiles(workspace)]);
  const paths = [...new Set([...source, ...staged])].sort();
  const changes: PatchProposal[] = [];
  for (const path of paths) {
    const original = join(root, path);
    const edited = join(workspace, path);
    const [beforeType, afterType] = await Promise.all([metadata(original), metadata(edited)]);
    if (beforeType?.isSymbolicLink() || afterType?.isSymbolicLink()) {
      if (beforeType?.isSymbolicLink() && afterType?.isSymbolicLink() && await readlink(original) === await readlink(edited)) continue;
      throw new Error(`Link simbólico alterado na cópia: ${path}`);
    }
    if (beforeType && !beforeType.isFile() || afterType && !afterType.isFile()) throw new Error(`Tipo de arquivo alterado na cópia: ${path}`);
    const [before, after] = await Promise.all([beforeType ? readFile(original) : null, afterType ? readFile(edited) : null]);
    if (before?.equals(after ?? Buffer.alloc(0)) && after !== null) continue;
    if (before === null && after === null) continue;
    if ((before?.length ?? 0) > 262_144 || (after?.length ?? 0) > 262_144) throw new Error(`Arquivo alterado excede 256 KiB: ${path}`);
    const content = after === null ? null : decoder.decode(after);
    changes.push({ domain, summary: `Mudança nativa do Codex em ${path}`, files: [{ path, beforeSha256: before === null ? null : sha(before), content }] });
  }
  return changes;
}

export async function synchronizeWorkspaceFile(root: string, workspace: string, path: string): Promise<void> {
  const source = join(root, path);
  const target = join(workspace, path);
  const sourceType = await metadata(source);
  await rm(target, { force: true });
  if (sourceType?.isFile()) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}
