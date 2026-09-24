import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import * as z from 'zod/v4';
import { ApprovalBroker, type HumanAnswer } from '../../decision/broker.js';
import { evaluateAction, type ActionEvaluation, type ProposedAction } from '../../decision/evaluate.js';
import { assertOntologySnapshot, type OntologySnapshot } from '../../ontology/query.js';

const execFileAsync = promisify(execFile);
const FileSchema = z.object({
  path: z.string().min(1), beforeSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  content: z.string().max(262_144).nullable(),
});
export const PatchSchema = z.object({
  domain: z.string().min(1), summary: z.string().min(1), factsTurtle: z.string().optional(),
  files: z.array(FileSchema).length(1),
});
export type PatchProposal = z.infer<typeof PatchSchema>;

interface StagedFile { path: string; target: string; staged: string | null; beforeSha256: string | null; }
export interface PreparedPatch { files: StagedFile[]; diff: string; cleanup(): Promise<void>; }

function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function safeTarget(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Caminho inválido no patch: ${path}`);
  }
  if (['.bsh', '.git', 'node_modules'].includes(path.split('/')[0])) throw new Error(`Caminho reservado no patch: ${path}`);
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) throw new Error(`Caminho fora do projeto: ${path}`);
  const parts = relative(root, dirname(target)).split(sep).filter(Boolean);
  let current = resolve(root);
  let missing = false;
  for (const part of parts) {
    current = join(current, part);
    if (missing) continue;
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Diretório não confiável no patch: ${path}`);
    } catch (error) {
      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      missing = true;
    }
  }
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Arquivo não confiável no patch: ${path}`);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  return target;
}

export async function preparePatch(root: string, raw: unknown): Promise<PreparedPatch> {
  const proposal = PatchSchema.parse(raw);
  const paths = new Set<string>();
  const stage = await mkdtemp(join(tmpdir(), 'bsh-patch-'));
  const files: StagedFile[] = [];
  const diffs: string[] = [];
  try {
    for (const file of proposal.files) {
      if (paths.has(file.path)) throw new Error(`Arquivo repetido no patch: ${file.path}`);
      paths.add(file.path);
      const target = await safeTarget(root, file.path);
      let before: Buffer | null = null;
      try { before = await readFile(target); }
      catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
      if ((before ? sha(before) : null) !== file.beforeSha256) throw new Error(`Hash anterior divergente: ${file.path}`);
      if (!before && file.content === null) throw new Error(`Exclusão de arquivo inexistente: ${file.path}`);
      const staged = file.content === null ? null : join(stage, file.path);
      if (staged && file.content !== null) {
        await mkdir(dirname(staged), { recursive: true });
        await writeFile(staged, file.content, { mode: 0o600 });
      }
      files.push({ path: file.path, target, staged, beforeSha256: file.beforeSha256 });
      try {
        await execFileAsync('git', ['diff', '--no-index', '--', before ? target : '/dev/null', staged ?? '/dev/null'], { maxBuffer: 1_000_000 });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 1 && 'stdout' in error) {
          diffs.push(String(error.stdout));
        } else throw error;
      }
    }
    return { files, diff: diffs.join('\n'), cleanup: () => rm(stage, { recursive: true, force: true }) };
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export async function reviewAndApplyPatch(
  root: string, raw: unknown, snapshot: OntologySnapshot,
  ask: (diff: string, evaluation: ActionEvaluation) => Promise<HumanAnswer>,
): Promise<{ applied: boolean; reason: string }> {
  const proposal = PatchSchema.parse(raw);
  const prepared = await preparePatch(root, proposal);
  try {
    const action: ProposedAction = {
      id: randomUUID(), tool: 'bsh_propose_patch', domain: proposal.domain,
      arguments: { summary: proposal.summary, files: proposal.files.map((file) => ({ path: file.path, beforeSha256: file.beforeSha256, afterSha256: file.content === null ? null : sha(Buffer.from(file.content)) })) },
      mutates: true, intercepted: true, representation: 'partial', factsTurtle: proposal.factsTurtle,
    };
    const evaluation = await evaluateAction(root, action, snapshot);
    const broker = new ApprovalBroker(root, (question) => ask(prepared.diff, question.evaluation), 300_000);
    const authorization = await broker.authorize(action, evaluation, snapshot);
    if (!authorization.allowed || !authorization.token) return { applied: false, reason: authorization.reason };
    if (!await broker.consume(authorization.token, action, snapshot)) return { applied: false, reason: 'Aprovação expirada ou ontologia alterada' };
    await assertOntologySnapshot(root, snapshot);
    for (const file of prepared.files) {
      await safeTarget(root, file.path);
      let current: Buffer | null = null;
      try { current = await readFile(file.target); }
      catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
      if ((current ? sha(current) : null) !== file.beforeSha256) return { applied: false, reason: `Arquivo alterado após aprovação: ${file.path}` };
    }
    for (const file of prepared.files) {
      if (file.staged === null) { await unlink(file.target); continue; }
      await mkdir(dirname(file.target), { recursive: true });
      await safeTarget(root, file.path);
      const adjacent = join(dirname(file.target), `.bsh-patch-${randomUUID()}`);
      try {
        const mode = file.beforeSha256 ? (await stat(file.target)).mode & 0o777 : 0o600;
        await writeFile(adjacent, await readFile(file.staged), { flag: 'wx', mode });
        await rename(adjacent, file.target);
      } finally {
        await rm(adjacent, { force: true });
      }
    }
    return { applied: true, reason: 'Patch aprovado e aplicado' };
  } finally {
    await prepared.cleanup();
  }
}
