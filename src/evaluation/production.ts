import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { executarGates } from '../git/promotion.js';
import { git, type SessaoWorktree } from '../git/worktree.js';
import { evaluateGovernance, type GovernanceDecision } from '../enforcement/governanceDecision.js';
import { createProductionFactsExtractor } from '../enforcement/evidenceAdapters.js';
import { loadManifest } from '../project/manifest.js';
import { resolveProjectFile } from '../project/paths.js';
import type { ContentArtifact, CostObservation } from './types.js';
import type { ExperimentStages } from './experiment.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const execFileAsync = promisify(execFile);
const artifact = (id: string, role: ContentArtifact['role'], content: string, source: string): ContentArtifact =>
  ({ id, role, content, source, sha256: hash(content) });
const cost = (phase: CostObservation['phase'], durationMs: number | null): CostObservation =>
  ({ phase, kind: 'RECURRING', durationMs, tokens: null, amount: null, currency: null });

/** Read-only identification. Caller must commit the candidate before production evaluation. */
export async function getProductionIdentity(session: SessaoWorktree): Promise<{
  candidateCommit: string; baseCommit: string; candidateHash: string; baseHash: string; artifacts: ContentArtifact[];
}> {
  const baseCommit = (await git(session.repositorioOrigem, ['rev-parse', session.branchOrigem])).trim();
  const candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
  const diff = await git(session.caminhoWorktree, ['diff', '--binary', '--full-index', '--no-ext-diff', baseCommit, candidateCommit]);
  const tree = (await git(session.repositorioOrigem, ['ls-tree', '-r', '-z', '--full-tree', baseCommit])).split('\0').filter(Boolean);
  const entries: Array<{ path: string; mode: string; type: string; objectId: string; contentBase64: string }> = [];
  for (const entry of tree) {
    const tab = entry.indexOf('\t');
    const [mode, type, objectId] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (type !== 'blob') throw new Error(`Independent base archive does not support ${type} objects (${path}); capture their source separately`);
    const blob = await execFileAsync('git', ['-C', session.repositorioOrigem, 'cat-file', 'blob', objectId],
      { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 120_000 });
    entries.push({ path, mode, type, objectId, contentBase64: blob.stdout.toString('base64') });
  }
  // Raw blobs preserve binary bytes, symlink targets and modes; git archive can apply export-ignore/export-subst.
  const baseArchive = JSON.stringify({ schemaVersion: 1, format: 'git-blob-archive', entries });
  const artifacts = [artifact('candidate-diff', 'CANDIDATE', diff, `git://${baseCommit}..${candidateCommit}`),
    artifact('base-git-archive', 'BASE', baseArchive, `git://${baseCommit}/archive.json?format=git-blob-archive`)];
  return { candidateCommit, baseCommit, candidateHash: hash(diff), baseHash: hash(baseArchive), artifacts };
}

async function captureContracts(root: string): Promise<ContentArtifact[]> {
  const manifest = await loadManifest(root);
  const files = new Map<string, ContentArtifact['role']>([['.bsh/project.json', 'CONTRACT'], ['.bsh/local/events.jsonl', 'POLICY']]);
  for (const domain of manifest.domains) {
    files.set(`.bsh/${domain.ontology}`, 'CONTRACT');
    files.set(`.bsh/${domain.shapes}`, 'CONTRACT');
    files.set(`.bsh/${domain.enforcement || `${dirname(domain.ontology)}/enforcement.json`}`, 'POLICY');
  }
  const artifacts: ContentArtifact[] = [];
  for (const [path, role] of files) {
    try {
      const file = await resolveProjectFile(root, path);
      artifacts.push(artifact(path, role, await readFile(file, 'utf8'), file));
    } catch (error) {
      if (role !== 'POLICY' || (error as { code?: string }).code !== 'ENOENT') throw error;
      artifacts.push(artifact(path, role, JSON.stringify({ status: 'MISSING' }), `project://${path}`));
    }
  }
  return artifacts;
}

/** Exercise recognition, independent extraction and SHACL through production governance. */
export async function evaluateProductionCandidate(session: SessaoWorktree): Promise<{
  decision: GovernanceDecision; artifacts: ContentArtifact[]; costs: CostObservation[];
}> {
  const identity = await getProductionIdentity(session);
  const contracts = await captureContracts(session.repositorioOrigem);
  const artifacts = [...identity.artifacts, ...contracts];
  const costs: CostObservation[] = [];
  let extractionMs = 0;
  let extractionInvocations = 0;
  const extractor = createProductionFactsExtractor(session.caminhoWorktree);
  const started = performance.now();
  const decision = await evaluateGovernance(session, async (input) => {
    const extractionStarted = performance.now();
    extractionInvocations += 1;
    try {
      const facts = await extractor(input);
      artifacts.push(artifact(`facts-${input.operation.id}`, 'FACTS', facts.graphTurtle, `production-extractor:${input.sourceCommit}`));
      artifacts.push(artifact(`evidence-${input.operation.id}`, 'FACTS', JSON.stringify(facts), `production-extractor:${input.sourceCommit}`));
      return facts;
    } finally { extractionMs += performance.now() - extractionStarted; }
  });
  // VALIDATION includes recognition, baseline checks and governance aggregation; it is not a pure SHACL microbenchmark.
  costs.push(cost('EXTRACTION', extractionInvocations ? extractionMs : null), cost('VALIDATION', performance.now() - started - extractionMs));
  const contractsAfter = await captureContracts(session.repositorioOrigem);
  if (JSON.stringify(contracts.map(a => [a.id, a.sha256])) !== JSON.stringify(contractsAfter.map(a => [a.id, a.sha256]))) {
    throw new Error('Project semantic contract changed during production evaluation');
  }
  const implementation = fileURLToPath(new URL('../enforcement/evidenceAdapters.js', import.meta.url));
  artifacts.push(artifact('production-adapters-implementation', 'ADAPTER', await readFile(implementation, 'utf8'), 'package://bsh/enforcement/evidenceAdapters.js'));
  artifacts.push(artifact('adapter-identifications', 'ADAPTER', JSON.stringify(decision.adaptersUsed), 'governance-decision:adaptersUsed'));
  artifacts.push(artifact('correspondence-bindings', 'CORRESPONDENCE', JSON.stringify(decision.correspondencesUsed), 'governance-decision:correspondencesUsed'));
  artifacts.push(artifact('policy-identifications', 'POLICY', JSON.stringify(decision.policiesUsed), 'governance-decision:policiesUsed'));
  const after = await getProductionIdentity(session);
  if (after.candidateHash !== identity.candidateHash || after.baseHash !== identity.baseHash ||
      decision.candidateCommit !== identity.candidateCommit || decision.originCommit !== identity.baseCommit) {
    throw new Error('Production candidate or base changed during experiment evaluation');
  }
  return { decision, artifacts, costs };
}

/** Compose real production stages without allowing a claimed candidate identity to substitute for Git state. */
export function createProductionStages(
  session: SessaoWorktree,
  selectContext: ExperimentStages['selectContext'],
  generate?: ExperimentStages['generate'],
): ExperimentStages {
  let expectedPolicyHash: string | undefined;
  let expectedBaseHash: string | undefined;
  const assertCandidate = async (candidate: NonNullable<Parameters<ExperimentStages['evaluate']>[0]>) => {
    const identity = await getProductionIdentity(session);
    if (expectedBaseHash && identity.baseHash !== expectedBaseHash) throw new Error('Controlled base changed during experiment execution');
    if (candidate.contentHash !== identity.candidateHash ||
        (candidate.commit !== null && candidate.commit !== identity.candidateCommit) ||
        (candidate.baseCommit !== null && candidate.baseCommit !== identity.baseCommit)) {
      throw new Error('Recorded candidate identity differs from the production Git candidate');
    }
  };
  return {
    selectContext: async run => {
      const identity = await getProductionIdentity(session);
      if (run.controls.baseHash !== identity.baseHash) throw new Error('Experiment base control differs from production Git base');
      expectedBaseHash = run.controls.baseHash;
      expectedPolicyHash = run.condition.policyHash;
      return selectContext(run);
    },
    generate,
    evaluate: async candidate => {
      await assertCandidate(candidate);
      const evaluated = await evaluateProductionCandidate(session);
      if (expectedPolicyHash && evaluated.decision.policyHash !== expectedPolicyHash) {
        throw new Error('Recorded policy identity differs from production governance policy');
      }
      return evaluated;
    },
    technicalGates: async (candidate, gates) => { await assertCandidate(candidate); return runProductionGates(session, gates); },
  };
}

/** Gates execute the declared production commands, with clean-state and identity checks. */
export async function runProductionGates(session: SessaoWorktree, expectedGates: readonly string[]): Promise<{
  ok: boolean; record: Record<string, unknown>; costs: CostObservation[];
}> {
  const started = performance.now();
  const before = await getProductionIdentity(session);
  const clean = async () => !(await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim();
  if (!(await clean())) throw new Error('Technical gates require an unchanged committed candidate');
  const packageFile = await resolveProjectFile(session.caminhoWorktree, 'package.json');
  const packageContent = await readFile(packageFile, 'utf8');
  const pkg = JSON.parse(packageContent) as { scripts?: Record<string, string> };
  const basePackage = JSON.parse(await git(session.repositorioOrigem, ['show', `${session.commitBase}:package.json`])) as { scripts?: Record<string, string> };
  const scriptsIdentity = (scripts: Record<string, string> = {}) => JSON.stringify(Object.entries(scripts).sort(([a], [b]) => a.localeCompare(b)));
  if (scriptsIdentity(pkg.scripts) !== scriptsIdentity(basePackage.scripts)) {
    throw new Error('Technical gate implementation changed from the controlled base: npm scripts');
  }
  // npm lifecycle scripts can change what the named gate executes.
  for (const name of ['quality', 'test', 'prequality', 'postquality', 'pretest', 'posttest']) {
    if (pkg.scripts?.[name] !== basePackage.scripts?.[name]) throw new Error(`Technical gate implementation changed from the controlled base: ${name}`);
  }
  const commands = [...(pkg.scripts?.quality ? ['npm run quality'] : []), ...(pkg.scripts?.test ? ['npm test'] : [])];
  if (JSON.stringify(commands) !== JSON.stringify(expectedGates)) {
    throw new Error(`Technical gate controls differ: expected ${JSON.stringify(expectedGates)}, declared ${JSON.stringify(commands)}`);
  }
  const gates = await executarGates(session.caminhoWorktree);
  const after = await getProductionIdentity(session);
  const unchanged = before.candidateCommit === after.candidateCommit && before.baseCommit === after.baseCommit &&
    before.candidateHash === after.candidateHash && before.baseHash === after.baseHash && await clean();
  return {
    ok: gates.ok && unchanged,
    record: { commands, scripts: pkg.scripts ?? {}, packageHash: hash(packageContent), output: gates.saida,
      gatesPassed: gates.ok, candidateUnchanged: unchanged, candidateCommit: before.candidateCommit },
    costs: [cost('TECHNICAL_GATES', performance.now() - started)],
  };
}
