// Requirements: BSH-EXP-001/002/003/009. Real Git, extractor, SHACL and npm gates; native-generation case mocks only model transport explicitly.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCommand as exec } from '../support/command-runner.mjs';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { evaluateProductionCandidate, getProductionIdentity, runProductionGates, createProductionStages } from '../../dist/evaluation/production.js';
import { createNativeGeneration } from '../../dist/evaluation/generation.js';
import { executeAndCaptureRun } from '../../dist/evaluation/experiment.js';
import { loadExperimentRun, replayExperimentRun } from '../../dist/evaluation/replay.js';
import { parseShapes } from '../../dist/ontology/rdf.js';
import { validateData } from '../../dist/ontology/validate.js';

const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, candidate = 'valid') {
  const root = await mkdtemp(join(tmpdir(), 'bsh-controlled-production-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/synthetic'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'synthetic-production', domains: [{ id: 'synthetic', version: '1.0.0', baseIri: 'urn:experiment:', ontology: 'domains/synthetic/ontology.jsonld', shapes: 'domains/synthetic/shapes.ttl', enforcement: 'domains/synthetic/enforcement.json' }] }));
  await writeFile(join(repo, '.bsh/domains/synthetic/ontology.jsonld'), JSON.stringify({ '@context': { ex: 'urn:experiment:', bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' }, '@graph': [{ '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' }, { '@id': 'ex:ModifyRecord', '@type': 'rdfs:Class' }] }));
  await writeFile(join(repo, '.bsh/domains/synthetic/shapes.ttl'), '@prefix ex: <urn:experiment:> . @prefix sh: <http://www.w3.org/ns/shacl#> . ex:Change a sh:NodeShape ; sh:targetClass ex:ModifyRecord ; sh:property [ sh:path ex:status ; sh:hasValue "READY" ] .');
  await writeFile(join(repo, '.bsh/domains/synthetic/enforcement.json'), JSON.stringify({ schemaVersion: 1, regras: ['valid', 'invalid'].map(kind => ({ id: `rule-${kind}`, operacao: 'ModifyRecord', quando: { caminho: 'src/**', adicionou: `change_${kind}` }, fatos: [{ propriedade: 'status', valor: kind === 'valid' ? 'READY' : 'BLOCKED', determinacao: 'observado', origem: 'candidate-code' }], evidenciasRequeridas: [{ tipo: 'estrutural' }] })) }));
  await writeFile(join(repo, 'package.json'), JSON.stringify({ type: 'module', scripts: { quality: 'npm run check', check: 'node --check src/change.js', pretest: 'node --check src/change.js', test: 'node --test gates.test.mjs' } }));
  await writeFile(join(repo, 'gates.test.mjs'), `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { observed } from './src/change.js'; import { mkdir,writeFile } from 'node:fs/promises'; test('candidate capability',async()=>{assert.equal(observed,'READY'); await mkdir('.bsh/local',{recursive:true});await writeFile('.bsh/local/gates-ran','ran');});`);
  await writeFile(join(repo, 'src/change.js'), 'export const observed = "READY";\n');
  await writeFile(join(repo, '.gitattributes'), 'ignored.bin export-ignore\nsubstituted.txt export-subst\n');
  await writeFile(join(repo, 'ignored.bin'), Buffer.from([0, 128, 255, 10, 0]));
  await writeFile(join(repo, 'substituted.txt'), '$Format:%H$\n');
  for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'QA'], ['config', 'user.email', 'qa@local.invalid'], ['add', '.'], ['commit', '-m', 'Synthetic baseline']]) {
    await exec('git', ['-C', repo, ...args]);
  }
  const baseCommit = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const session = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'main', commitBase: baseCommit, diretorioBase: join(root, 'worktrees') });
  t.after(async () => { await removerSessaoWorktree(session, true); await rm(root, { recursive: true, force: true }); });
  if (candidate === null) return { session, repo };
  await writeFile(join(session.caminhoWorktree, 'src/change.js'), `export const status = "${candidate === 'valid' ? 'READY' : 'BLOCKED'}";\nexport const observed = status;\nexport function change_${candidate}(){ return observed; }\n`);
  await exec('git', ['-C', session.caminhoWorktree, 'add', '.']);
  await exec('git', ['-C', session.caminhoWorktree, 'commit', '-m', 'Synthetic candidate']);
  return { session, repo };
}

test('Given a valid fixed candidate, When real production recognition extraction validation and gates execute, Then reproducible artifacts support the observed acceptance without promotion', async t => {
  const { session, repo } = await fixture(t);
  const identity = await getProductionIdentity(session);
  const archive = JSON.parse(identity.artifacts.find(a => a.id === 'base-git-archive').content);
  assert.deepEqual(Buffer.from(archive.entries.find(a => a.path === 'ignored.bin').contentBase64, 'base64'), Buffer.from([0, 128, 255, 10, 0]));
  assert.equal(Buffer.from(archive.entries.find(a => a.path === 'substituted.txt').contentBase64, 'base64').toString(), '$Format:%H$\n');
  assert.equal(archive.entries.find(a => a.path === 'src/change.js').mode, '100644');
  const result = await evaluateProductionCandidate(session);
  assert.equal(result.decision.validationStatus, 'CONFORMING', result.decision.reason);
  assert.equal(result.decision.promotionDecision, 'ALLOW');
  assert.ok(result.decision.recognizedOperation.length);
  assert.ok(result.decision.validationExecuted && result.decision.validationComplete);
  assert.ok(result.artifacts.some(a => a.role === 'FACTS' && a.content.includes('READY')));
  assert.ok(result.artifacts.some(a => a.role === 'ADAPTER' && a.id === 'production-adapters-implementation'));
  assert.ok(result.artifacts.some(a => a.role === 'CORRESPONDENCE'));
  for (const artifact of result.artifacts) assert.equal(artifact.sha256, hash(artifact.content));
  assert.equal(result.artifacts.find(a => a.role === 'CANDIDATE').sha256, identity.candidateHash);
  assert.ok(result.costs.find(c => c.phase === 'EXTRACTION').durationMs > 0);
  const gates = await runProductionGates(session, ['npm run quality', 'npm test']);
  assert.equal(gates.ok, true, JSON.stringify(gates.record));
  assert.equal(gates.record.candidateUnchanged, true);
  assert.equal(await readFile(join(session.caminhoWorktree, '.bsh/local/gates-ran'), 'utf8'), 'ran');
  assert.equal((await git(repo, ['rev-parse', 'HEAD'])).trim(), session.commitBase);
  assert.equal((await getProductionIdentity(session)).candidateHash, identity.candidateHash);
});

test('Given controlled native generation with an explicitly mocked model transport, When real tools Git extraction validation gates and snapshots execute, Then observed acceptance and reproducible inputs remain independent of interface prose', async t => {
  const { session, repo } = await fixture(t, null);
  const base = await getProductionIdentity(session);
  const baseEvaluation = await evaluateProductionCandidate(session);
  const requests = [];
  const transport = { async *streamChat(request) {
    requests.push(request);
    if (requests.length === 1) yield { delta: { tool_calls: [{ index: 0, id: 'fixture-write', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/change.js', content: 'export const status = "READY";\nexport const observed = status;\nexport function change_valid(){return observed;}\n' }) } }] } };
    else yield { delta: { content: 'Fixture transport completion; assertions rely on files and records.' } };
  } };
  const seed = {
    schemaVersion: 1, runId: 'native-generation-integration', batchId: 'unit-integration', track: 'AGENT_GENERATION',
    projectId: 'synthetic-production', domain: 'synthetic', technology: 'JavaScript',
    condition: { id: 'text-with-enforcement', context: 'TEXT_RULES', enforcement: true, policyId: 'production', policyHash: baseEvaluation.decision.policyHash },
    controls: { agent: 'bsh-native', agentVersion: JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version, systemPromptHash: hash('Use native file tools to implement the requested change.'), model: 'mock-transport-explicit', taskId: 'change', taskPrompt: 'Implement the valid change in src/change.js', baseHash: base.baseHash, budget: { maxTokens: 500, maxTurns: 3, timeoutMs: 30_000 }, technicalGates: ['npm run quality', 'npm test'] },
    candidate: null, oracle: { verdict: 'VALID', reference: 'synthetic-oracle://ready', sha256: hash('READY') },
    status: 'NO_CANDIDATE', promotionDecision: 'NOT_ATTEMPTED', promoted: false, validated: false,
    semanticStatus: null, failureStage: null, queries: [], artifacts: [], sources: [], adapterIds: [], factsHash: null,
    expectedRuleIds: [], evaluatedRuleIds: [], expectedEvidenceIds: [], evaluatedEvidenceIds: [], decisionRecords: [],
    explanation: null, humanReview: null, costs: [], transfer: null, limitations: ['Only model transport is mocked; all production mechanisms are real']
  };
  const generate = createNativeGeneration(session, { client: transport, contextLength: 131072, agentVersion: seed.controls.agentVersion, systemPrompt: 'Use native file tools to implement the requested change.' });
  await assert.rejects(generate({ controls: { ...seed.controls, systemPromptHash: hash('different instructions') }, context: '', signal: new AbortController().signal }), /controlled prompt identity/);
  await assert.rejects(generate({ controls: { ...seed.controls, agentVersion: 'invented-version' }, context: '', signal: new AbortController().signal }), /native agent version/);
  assert.equal(requests.length, 0);
  const stages = createProductionStages(session, async () => ({ text: 'Status must be READY.', artifacts: [], queries: [] }), generate);
  const { run, snapshot } = await executeAndCaptureRun(repo, seed, stages);
  assert.equal(run.status, 'ACCEPTED', JSON.stringify(run.decisionRecords));
  assert.equal(run.validated, true);
  assert.equal(run.promoted, false);
  assert.equal(run.promotionDecision, 'ALLOW');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.model === seed.controls.model && request.maxTokens === 500));
  assert.match(run.artifacts.find(a => a.id === 'generation-prompts').content, /Status must be READY/);
  assert.ok(run.artifacts.some(a => a.id.startsWith('facts-') && a.content.includes('READY')));
  assert.ok(run.costs.some(c => c.phase === 'GENERATION'));
  assert.match(snapshot, /\.bsh\/local\/evaluation/);
  const replay = await loadExperimentRun(repo, seed.runId);
  assert.equal(replay.governanceDecision.validationStatus, 'CONFORMING');
  assert.equal(replay.candidate.contentHash, (await getProductionIdentity(session)).candidateHash);
  assert.ok(replay.artifacts.some(a => a.id === '.bsh/local/events.jsonl'));
  const reproduced = await replayExperimentRun(repo, seed.runId, async recovered => {
    // Actual validator consumes recovered bytes in memory; interface prose is never an input.
    const shapes = recovered.artifacts.find(a => a.id.endsWith('/shapes.ttl')).content;
    const facts = recovered.artifacts.filter(a => a.id.startsWith('facts-')).map(a => a.content).join('\n');
    const validation = await validateData(parseShapes(shapes), parseShapes(facts));
    const current = await evaluateProductionCandidate(session);
    for (const original of recovered.artifacts.filter(a => ['CONTRACT', 'POLICY'].includes(a.role))) {
      const same = current.artifacts.find(a => a.id === original.id);
      assert.equal(same.sha256, original.sha256);
    }
    return { conforms: validation.conforms, executedShapes: validation.executedShapes,
      promotionDecision: current.decision.promotionDecision, validationStatus: current.decision.validationStatus };
  });
  assert.equal(reproduced.result.conforms, true);
  assert.equal(reproduced.result.promotionDecision, run.promotionDecision);
  assert.equal(reproduced.result.validationStatus, run.semanticStatus);
  assert.deepEqual(reproduced.result.executedShapes, run.governanceDecision.executedShapes);
  assert.equal((await git(repo, ['rev-parse', 'HEAD'])).trim(), session.commitBase);
});

test('Given an oracle-violating candidate, When the production adapter extracts observed facts, Then the real SHACL violation is recorded against its constraint', async t => {
  const { session } = await fixture(t, 'invalid');
  const result = await evaluateProductionCandidate(session);
  assert.equal(result.decision.validationStatus, 'VIOLATION', result.decision.reason);
  assert.equal(result.decision.promotionDecision, 'DENY');
  assert.ok(result.artifacts.some(a => a.role === 'FACTS' && a.content.includes('BLOCKED')));
  assert.ok(result.decision.executedShapes.includes('urn:experiment:Change'));
  assert.ok(result.decision.results.some(r => r.validationResults.some(v => v.constraintComponent.endsWith('HasValueConstraintComponent'))));
});

test('Given different technical controls or a dirty candidate, When gates are requested, Then execution rejects the confounded state before invoking project gates', async t => {
  const { session } = await fixture(t);
  await assert.rejects(runProductionGates(session, ['npm test']), /controls differ/);
  await writeFile(join(session.caminhoWorktree, 'src/uncommitted.js'), 'export const dirty = true;\n');
  await assert.rejects(runProductionGates(session, ['npm run quality', 'npm test']), /unchanged committed candidate/);
});

for (const script of ['quality', 'test', 'pretest', 'check']) {
  test(`Given a committed candidate that weakens ${script} while preserving gate command names, When production gates run, Then the controlled base mismatch prevents execution (BSH-EXP-002)`, async t => {
    const { session } = await fixture(t);
    const packagePath = join(session.caminhoWorktree, 'package.json');
    const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
    packageManifest.scripts[script] = 'true';
    await writeFile(packagePath, JSON.stringify(packageManifest));
    await exec('git', ['-C', session.caminhoWorktree, 'add', 'package.json']);
    await exec('git', ['-C', session.caminhoWorktree, 'commit', '-m', `Weaken ${script} gate for negative regression`]);
    assert.equal((await git(session.caminhoWorktree, ['status', '--porcelain', '--untracked-files=all'])).trim(), '');
    await assert.rejects(runProductionGates(session, ['npm run quality', 'npm test']),
      /gate implementation changed/);
    await assert.rejects(readFile(join(session.caminhoWorktree, '.bsh/local/gates-ran'), 'utf8'), { code: 'ENOENT' });
  });
}

async function advanceOrigin(repo) {
  await writeFile(join(repo, 'src/advanced-base.js'), 'export const baselineRevision = 2;\n');
  await exec('git', ['-C', repo, 'add', 'src/advanced-base.js']);
  await exec('git', ['-C', repo, 'commit', '-m', 'Advance controlled origin for negative regression']);
}

test('Given an origin advanced after the fresh worktree was created, When native generation receives a recalculated origin base hash, Then it rejects the stale starting base before model requests (BSH-EXP-002)', async t => {
  const { session, repo } = await fixture(t, null);
  await advanceOrigin(repo);
  const advanced = await getProductionIdentity(session);
  assert.notEqual(advanced.baseCommit, session.commitBase);
  let requests = 0;
  const transport = { async *streamChat() { requests++; yield { delta: { content: 'Should not be called' } }; } };
  const version = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const prompt = 'Make the controlled change.';
  const generate = createNativeGeneration(session, { client: transport, agentVersion: version, systemPrompt: prompt });
  await assert.rejects(generate({ controls: { agent: 'bsh-native', agentVersion: version, systemPromptHash: hash(prompt),
    model: 'mock-transport-explicit', taskId: 'change', taskPrompt: 'Change source', baseHash: advanced.baseHash,
    budget: { maxTokens: 100, maxTurns: 2, timeoutMs: 1000 }, technicalGates: ['npm run quality', 'npm test'] },
    context: '', signal: new AbortController().signal }), /starting base differs/);
  assert.equal(requests, 0);
});

test('Given production stages selected a controlled baseline, When the origin changes before evaluation or gates, Then both reject the changed base without stale acceptance (BSH-EXP-002 BSH-EXP-010)', async t => {
  const { session, repo } = await fixture(t);
  const before = await getProductionIdentity(session);
  const stages = createProductionStages(session, async () => ({ text: '', artifacts: [], queries: [] }));
  await stages.selectContext({ controls: { baseHash: before.baseHash }, condition: { policyHash: 'observational-placeholder' } });
  await advanceOrigin(repo);
  const candidate = { id: before.candidateCommit, contentHash: before.candidateHash,
    commit: before.candidateCommit, baseCommit: before.baseCommit };
  await assert.rejects(stages.evaluate(candidate), /Controlled base changed/);
  await assert.rejects(stages.technicalGates(candidate, ['npm run quality', 'npm test']), /Controlled base changed/);
  await assert.rejects(readFile(join(session.caminhoWorktree, '.bsh/local/gates-ran'), 'utf8'), { code: 'ENOENT' });
});

test('Given a claimed candidate or base that differs from Git, When composed production stages run, Then provenance mismatch prevents evaluation', async t => {
  const { session } = await fixture(t);
  const stages = createProductionStages(session, async () => ({ text: '', artifacts: [], queries: [] }));
  await assert.rejects(stages.evaluate({ id: 'wrong', contentHash: 'incorrect', commit: null, baseCommit: null }), /identity differs/);
  await assert.rejects(stages.selectContext({ controls: { baseHash: 'incorrect' } }), /base control differs/);
});
