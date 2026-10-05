import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { contentHash, captureExperimentRun, loadExperimentRun, replayExperimentRun } from '../../dist/evaluation/replay.js';
import { analyzePairedRuns, summarizeTransfer } from '../../dist/evaluation/analysis.js';

function run(overrides = {}) {
  return {
    schemaVersion: 1, runId: 'run-1', batchId: 'batch', track: 'FIXED_CANDIDATE', projectId: 'p1', domain: 'synthetic', technology: 'js',
    condition: { id: 'text', context: 'TEXT_RULES', enforcement: false, policyId: 'rules', policyHash: contentHash('rules') },
    controls: { agent: 'test', agentVersion: '1', model: 'fixed', taskId: 'task', taskPrompt: 'prompt', baseHash: contentHash('base'),
      budget: { maxTokens: 100, maxTurns: 2, timeoutMs: 1000 }, technicalGates: ['check'] },
    candidate: { id: 'candidate', contentHash: contentHash('candidate'), commit: null, baseCommit: null },
    oracle: { verdict: 'VALID', reference: 'oracle', sha256: contentHash('oracle') }, status: 'ACCEPTED', promotionDecision: 'NOT_ATTEMPTED',
    promoted: false, validated: true, semanticStatus: 'CONFORMING', failureStage: null, queries: [],
    artifacts: ['base', 'candidate', 'rules'].map((content, i) => ({ id: content, role: ['BASE', 'CANDIDATE', 'POLICY'][i],
      sha256: contentHash(content), content, source: `${content}.txt` })),
    sources: [], adapterIds: [], factsHash: contentHash('facts'), expectedRuleIds: [], evaluatedRuleIds: [],
    expectedEvidenceIds: [], evaluatedEvidenceIds: [], decisionRecords: [{ id: 'd1', references: ['policy'], record: { allowed: true } }],
    explanation: null, humanReview: null, costs: [], transfer: null, limitations: [], ...overrides,
  };
}

test('Given project-local snapshots, When decisions are replayed, Then verified inputs and structured records are recovered independently of UI text', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-replay-'));
  try {
    const input = run();
    const path = await captureExperimentRun(root, input);
    assert.ok(path.startsWith(join(root, '.bsh/local/evaluation/run-1')));
    assert.deepEqual(await loadExperimentRun(root, 'run-1'), input);
    let calls = 0;
    const replay = await replayExperimentRun(root, 'run-1', async (verified) => {
      calls++;
      assert.equal(verified.artifacts.find((a) => a.role === 'CANDIDATE').content, 'candidate');
      return verified.decisionRecords[0].record;
    });
    assert.equal(calls, 1);
    assert.deepEqual(replay.result, { allowed: true });
    assert.equal(replay.revalidated, false);
    assert.equal(JSON.parse(await readFile(replay.recordPath, 'utf8')).originalRunId, 'run-1');
    await assert.rejects(captureExperimentRun(root, input), /EEXIST/);
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.run.status = 'DENIED';
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(replayExperimentRun(root, 'run-1', async () => { calls++; }), /integrity/);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given changing data sources, When replay applies each recorded consistency policy, Then pinned bytes persist, strict drift blocks and revalidation records new facts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-consistency-'));
  try {
    await writeFile(join(root, 'context.txt'), 'old');
    for (const consistencyPolicy of ['SNAPSHOT_PINNED', 'STRICT_IMMUTABLE', 'REVALIDATE_ON_DECISION']) {
      const input = run({ runId: consistencyPolicy, sources: [{ id: 'context', source: 'context.txt', content: 'old', sha256: contentHash('old'), consistencyPolicy }] });
      await captureExperimentRun(root, input);
    }
    await writeFile(join(root, 'context.txt'), 'new');
    const callback = async (input) => ({ used: input.sources[0].content });
    assert.deepEqual((await replayExperimentRun(root, 'SNAPSHOT_PINNED', callback)).result, { used: 'old' });
    await assert.rejects(replayExperimentRun(root, 'STRICT_IMMUTABLE', callback), /Immutable source changed/);
    const updated = await replayExperimentRun(root, 'REVALIDATE_ON_DECISION', callback);
    assert.equal(updated.revalidated, true);
    assert.deepEqual(updated.result, { used: 'new' });
    assert.equal(updated.changedSources[0].currentHash, contentHash('new'));
    const record = JSON.parse(await readFile(updated.recordPath, 'utf8'));
    assert.equal(record.sources[0].content, 'new');
    assert.equal((await loadExperimentRun(root, 'REVALIDATE_ON_DECISION')).sources[0].content, 'old');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given sovereign project data, When archives or live sources escape the project, Then no domain bytes are copied outside it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-sovereign-'));
  const fresh = await mkdtemp(join(tmpdir(), 'bsh-live-source-'));
  const elsewhere = await mkdtemp(join(tmpdir(), 'bsh-other-'));
  try {
    await symlink(elsewhere, join(root, '.bsh'));
    await assert.rejects(captureExperimentRun(root, run()), /escapes/);
    await assert.rejects(readFile(join(elsewhere, 'local/evaluation/run-1/manifest.json')), /ENOENT/);
    await assert.rejects(captureExperimentRun(root, run({ runId: '../outside' })), /identifier/);
    await assert.rejects(captureExperimentRun(root, run({ artifacts: [] })), /Candidate bytes/);
    await writeFile(join(elsewhere, 'outside.txt'), 'private');
    await assert.rejects(captureExperimentRun(fresh, run({ sources: [{ id: 'external', source: join(elsewhere, 'outside.txt'),
      content: 'private', sha256: contentHash('private'), consistencyPolicy: 'STRICT_IMMUTABLE' }] })), /escapes/);
    await writeFile(join(fresh, 'context.txt'), 'private');
    await captureExperimentRun(fresh, run({ sources: [{ id: 'external', source: 'context.txt',
      content: 'private', sha256: contentHash('private'), consistencyPolicy: 'STRICT_IMMUTABLE' }] }));
    await rm(join(fresh, 'context.txt'));
    await symlink(join(elsewhere, 'outside.txt'), join(fresh, 'context.txt'));
    let called = false;
    await assert.rejects(replayExperimentRun(fresh, 'run-1', async () => { called = true; }), /escapes/);
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true }); await rm(elsewhere, { recursive: true, force: true });
    await rm(fresh, { recursive: true, force: true });
  }
});

test('Given paired tasks nested in projects, When effects are estimated, Then clustered confidence intervals and strata are deterministic', () => {
  const runs = [];
  for (let p = 0; p < 3; p++) for (let t = 0; t < 2; t++) {
    const a = run({ projectId: `project-${p}` });
    a.controls.taskId = `task-${t}`;
    a.score = 1;
    const b = structuredClone(a);
    b.condition.id = 'semantic';
    b.score = 2 + p + t;
    runs.push(a, b);
  }
  const estimate = analyzePairedRuns(runs, 'text', 'semantic', (r) => r.score, { seed: 31, resamples: 500 });
  assert.equal(estimate.pairs, 6);
  assert.equal(estimate.projects, 3);
  assert.equal(estimate.tasks, 6);
  assert.equal(estimate.meanDifference, 2.5);
  assert.ok(estimate.standardizedEffect > 0);
  assert.ok(estimate.confidenceInterval[0] <= 2.5 && estimate.confidenceInterval[1] >= 2.5);
  assert.deepEqual(estimate, analyzePairedRuns(runs, 'text', 'semantic', (r) => r.score, { seed: 31, resamples: 500 }));
  assert.equal(estimate.strata.length, 2);
  assert.equal(estimate.strata[0].runs, 6);
});

test('Given incomplete pairs, drifting controls and unequal policy facts, When analysis runs, Then invalid pairs have diagnostics rather than fabricated effects', () => {
  const a = run();
  const b = structuredClone(a);
  b.condition.id = 'semantic';
  b.controls.model = 'different';
  let analysis = analyzePairedRuns([a, b], 'text', 'semantic', () => 1);
  assert.equal(analysis.pairs, 0);
  assert.match(analysis.diagnostics.join(' '), /Divergent controls/);
  b.controls = structuredClone(a.controls);
  b.condition.policyHash = contentHash('alternative');
  b.factsHash = contentHash('different facts');
  analysis = analyzePairedRuns([a, b], 'text', 'semantic', () => 1);
  assert.match(analysis.diagnostics.join(' '), /Non-equivalent/);
  analysis = analyzePairedRuns([a], 'text', 'semantic', () => 1);
  assert.equal(analysis.confidenceInterval, null);
  assert.equal(analysis.meanDifference, null);
  assert.match(analysis.diagnostics.join(' '), /Incomplete/);
  b.factsHash = a.factsHash;
  analysis = analyzePairedRuns([a, b], 'text', 'semantic', () => null);
  assert.match(analysis.diagnostics.join(' '), /Unavailable measurement/);
});

test('Given transfer records without human measurements, When effort is summarized, Then unknown work remains missing and reused knowledge retains identity', () => {
  const transfer = { sourceProject: 'a', targetProject: 'b', reusedArtifacts: [{ id: 'adapter', sha256: contentHash('adapter'), source: 'a/adapter' }],
    adaptedArtifacts: [], adaptationMs: null, reviewMs: 300, humanWorkMs: null, description: 'Reuse adapter configuration', costs: [] };
  const summary = summarizeTransfer([transfer]);
  assert.equal(summary.adaptation.totalMs, null);
  assert.equal(summary.adaptation.missing, 1);
  assert.equal(summary.review.totalMs, 300);
  assert.deepEqual(summary.reusedArtifacts, transfer.reusedArtifacts);
  const partial = summarizeTransfer([transfer, { ...transfer, reviewMs: null }]);
  assert.equal(partial.review.totalMs, null);
  assert.equal(partial.review.measuredSubtotalMs, 300);
  assert.throws(() => summarizeTransfer([{ ...transfer, adaptationMs: -1 }]), /nonnegative/);
  assert.throws(() => summarizeTransfer([{ ...transfer, reusedArtifacts: [{ id: 'adapter', source: '', sha256: 'unknown' }] }]), /unverifiable/);
});

test('Given repeated paired replicates within tasks and projects, When clustered analysis runs, Then all explicit replicate pairs participate without becoming independent project clusters', () => {
  const runs = [];
  for (const projectId of ['p1', 'p2']) for (const replicateId of ['r1', 'r2']) {
    const a = run({ projectId, replicateId });
    const b = structuredClone(a);
    b.condition.id = 'semantic';
    a.score = 1;
    b.score = replicateId === 'r1' ? 2 : 4;
    runs.push(a, b);
  }
  const estimate = analyzePairedRuns(runs, 'text', 'semantic', (r) => r.score);
  assert.equal(estimate.pairs, 4);
  assert.equal(estimate.projects, 2);
  assert.equal(estimate.tasks, 2);
  assert.equal(estimate.meanDifference, 2);
  assert.ok(estimate.confidenceInterval);
});

test('Given structured and SPARQL observations over different sources, When paired effects are analyzed, Then source-confounded pairs are excluded with a diagnostic', () => {
  const a = run(); const b = structuredClone(a); b.condition.id = 'sparql';
  a.queries = [{ id: 'q1', mechanism: 'STRUCTURED', purpose: 'AGENT_CONTEXT', sourceHash: contentHash('source-a') }];
  b.queries = [{ id: 'q2', mechanism: 'SPARQL', purpose: 'AGENT_CONTEXT', sourceHash: contentHash('source-b') }];
  const invalid = analyzePairedRuns([a, b], 'text', 'sparql', () => 1);
  assert.equal(invalid.pairs, 0); assert.match(invalid.diagnostics.join(' '), /Different query source snapshots/);
  b.queries[0].sourceHash = a.queries[0].sourceHash;
  assert.equal(analyzePairedRuns([a, b], 'text', 'sparql', () => 1).pairs, 1);
});
