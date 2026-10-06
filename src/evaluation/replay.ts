import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { ExperimentRun, ExternalSourceSnapshot } from './types.js';

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function canonical(value: unknown): string {
  if (value === undefined) throw new Error('Undefined snapshot input');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

function safeId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) throw new Error('Invalid evaluation run identifier');
}

function inside(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix));
}

async function directory(projectRoot: string, runId: string, create = false): Promise<string> {
  safeId(runId);
  const root = await realpath(projectRoot);
  let current = root;
  // Verify each existing component before creating the next one: a symlink must
  // never cause project-owned domain bytes to be archived outside the project.
  for (const segment of ['.bsh', 'local', 'evaluation', runId]) {
    const next = join(current, segment);
    if (create) await mkdir(next, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    current = await realpath(next);
    if (!inside(root, current)) throw new Error('Evaluation archive escapes the selected project');
  }
  return current;
}

function verifyInputs(run: ExperimentRun): void {
  if (run.schemaVersion !== 1 || !run.projectId || !run.controls.taskId || !run.domain || !run.technology || !run.controls.model) {
    throw new Error('Incomplete experiment identity');
  }
  for (const asset of [...run.artifacts, ...run.sources]) {
    if (contentHash(asset.content) !== asset.sha256) throw new Error(`Snapshot hash mismatch: ${asset.id}`);
  }
  for (const source of run.sources) {
    if (!['SNAPSHOT_PINNED', 'STRICT_IMMUTABLE', 'REVALIDATE_ON_DECISION'].includes(source.consistencyPolicy)) {
      throw new Error(`Unknown source consistency policy: ${source.id}`);
    }
  }
  if (run.candidate && !run.artifacts.some((asset) => asset.role === 'CANDIDATE' && asset.sha256 === run.candidate?.contentHash)) {
    throw new Error('Candidate bytes are unavailable for reproduction');
  }
  if (!run.artifacts.some((asset) => asset.role === 'BASE' && asset.sha256 === run.controls.baseHash)) {
    throw new Error('Base bytes are unavailable for reproduction');
  }
}

interface SnapshotEnvelope { schemaVersion: 1; sha256: string; run: ExperimentRun }

/** Archives already captured inputs, only in the selected project's local directory. */
export async function captureExperimentRun(projectRoot: string, run: ExperimentRun): Promise<string> {
  verifyInputs(run);
  const root = await realpath(projectRoot);
  for (const asset of [...run.artifacts, ...run.sources]) {
    // URI sources represent external data supplied explicitly, whereas local
    // files must remain project-owned even when an adapter supplies the bytes.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(asset.source)) continue;
    const sourcePath = resolve(root, asset.source);
    if (!inside(root, sourcePath)) throw new Error(`Snapshot source escapes the selected project: ${asset.id}`);
    try {
      if (!inside(root, await realpath(sourcePath))) throw new Error(`Snapshot source escapes the selected project: ${asset.id}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const target = await directory(projectRoot, run.runId, true);
  const envelope: SnapshotEnvelope = { schemaVersion: 1, sha256: contentHash(canonical(run)), run };
  const path = join(target, 'manifest.json');
  await writeFile(path, JSON.stringify(envelope, null, 2), { flag: 'wx' });
  return path;
}

export async function loadExperimentRun(projectRoot: string, runId: string): Promise<ExperimentRun> {
  const target = await directory(projectRoot, runId);
  const manifestPath = await realpath(join(target, 'manifest.json'));
  if (!inside(target, manifestPath)) throw new Error('Manifest escapes the evaluation archive');
  const envelope = JSON.parse(await readFile(manifestPath, 'utf8')) as SnapshotEnvelope;
  if (envelope.schemaVersion !== 1 || envelope.run.runId !== runId || contentHash(canonical(envelope.run)) !== envelope.sha256) {
    throw new Error('Experiment manifest integrity mismatch');
  }
  verifyInputs(envelope.run);
  return envelope.run;
}

export interface ReplayResult<T> {
  original: ExperimentRun;
  result: T;
  revalidated: boolean;
  changedSources: Array<{ id: string; previousHash: string; currentHash: string }>;
  recordPath: string;
}

/** A hash proves identity, never authorization: the caller executes the real evaluator. */
export async function replayExperimentRun<T>(
  projectRoot: string,
  runId: string,
  evaluate: (inputs: ExperimentRun) => Promise<T>,
  readSource?: (source: ExternalSourceSnapshot) => Promise<string>,
): Promise<ReplayResult<T>> {
  const original = await loadExperimentRun(projectRoot, runId);
  const root = await realpath(projectRoot);
  const inputs = structuredClone(original);
  const changedSources: ReplayResult<T>['changedSources'] = [];
  for (const source of inputs.sources) {
    if (source.consistencyPolicy === 'SNAPSHOT_PINNED') continue;
    let content: string;
    if (readSource) content = await readSource(source);
    else {
      const path = await realpath(resolve(root, source.source));
      if (!inside(root, path)) throw new Error(`Live source escapes the selected project: ${source.id}`);
      content = await readFile(path, 'utf8');
    }
    const hash = contentHash(content);
    if (hash === source.sha256) continue;
    if (source.consistencyPolicy === 'STRICT_IMMUTABLE') throw new Error(`Immutable source changed: ${source.id}`);
    changedSources.push({ id: source.id, previousHash: source.sha256, currentHash: hash });
    source.content = content;
    source.sha256 = hash;
  }
  const result = await evaluate(inputs);
  const target = await directory(projectRoot, runId);
  const recordPath = join(target, `replay-${randomUUID()}.json`);
  await writeFile(recordPath, JSON.stringify({ schemaVersion: 1, originalRunId: runId, inputHash: contentHash(canonical(inputs)),
    sources: inputs.sources, changedSources, revalidated: changedSources.length > 0, result }, null, 2), { flag: 'wx' });
  return { original, result, revalidated: changedSources.length > 0, changedSources, recordPath };
}
