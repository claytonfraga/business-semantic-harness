import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { evaluateGovernance } from '../../dist/enforcement/governanceDecision.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { validarOperacao } from '../../dist/enforcement/validadorSemantico.js';

const run = promisify(execFile);
const gatesOk = async () => ({ ok: true, saida: 'ok' });
const PREFIX = '@prefix ex: <urn:generic:> .';
const graph = (value) => `${PREFIX}\nex:candidate a ex:Action${value === null ? '' : ` ; ex:value "${value}"`} .\n`;

async function fixture({ shapes = true, humanReview, generic = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-generic-governance-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/generic'), { recursive: true });
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1,
    projectId: 'generic', domains: [{ id: 'generic', version: '1.0.0', baseIri: 'urn:generic:',
      ontology: 'domains/generic/ontology.jsonld', shapes: 'domains/generic/shapes.ttl' }] }));
  await writeFile(join(repo, '.bsh/domains/generic/ontology.jsonld'), JSON.stringify({
    '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:generic:' },
    '@graph': [
      { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
      { '@id': 'ex:Action', '@type': 'rdfs:Class' },
      { '@id': 'ex:Other', '@type': 'rdfs:Class' },
      ...(humanReview === undefined ? [] : [{ '@id': 'ex:ReviewPolicy', '@type': 'bsh:Policy',
        'bsh:governs': { '@id': 'ex:Action' }, 'bsh:requiresHumanReview': humanReview }]),
    ],
  }));
  await writeFile(join(repo, '.bsh/domains/generic/shapes.ttl'), `${PREFIX}
@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:ActionShape a sh:NodeShape ; sh:targetClass ex:${shapes ? 'Action' : 'Other'} ;
  sh:property [ sh:path ex:value ; sh:minCount 1 ] .
`);
  await writeFile(join(repo, '.bsh/domains/generic/enforcement.json'), JSON.stringify({ regras: [{
    id: 'generic-rule', operacao: 'Action', quando: { caminho: 'src/**', adicionou: 'candidate-change' },
    fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
  }] }));
  await writeFile(join(repo, 'src/module.js'), 'export const value = 1;\n');
  if (generic) await rm(join(repo, '.bsh'), { recursive: true });
  await run('/usr/bin/rtk', ['git', 'init', '-q', '-b', 'master', repo]);
  await git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
  await git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base']);
  const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const session = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase: base,
    diretorioBase: join(root, 'worktrees') });
  await writeFile(join(session.caminhoWorktree, 'src/module.js'), 'export const value = 2; // candidate-change\n');
  await git(session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
  await git(session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'candidate']);
  const cleanup = async () => { await removerSessaoWorktree(session, true); await rm(root, { recursive: true, force: true }); };
  return { root, repo, session, base, cleanup };
}

function extractor(value, options = {}) {
  return async ({ sourceCommit, relevantPaths }) => ({
    sourceCommit: options.sourceCommit ?? sourceCommit,
    graphTurtle: options.graphTurtle ?? graph(value),
    coveredPaths: options.coveredPaths ?? relevantPaths,
  });
}

const operation = { id: 'action', dominio: 'generic', operacao: 'Action', fatos: [],
  proveniencia: { origem: 'host', descricao: 'Synthetic operation' }, alteracoesRelacionadas: ['src/module.js'] };

// BSH-SEM-022 / R7
for (const evidence of [undefined, extractor('ok')]) {
  test(`Given R7 human review without shapes ${evidence ? 'with' : 'without'} facts, When governance evaluates it, Then it never automatically allows promotion`, async () => {
    const f = await fixture({ shapes: false, humanReview: true });
    try {
      const decision = await evaluateGovernance(f.session, evidence);
      assert.equal(decision.validationStatus, 'INDETERMINATE');
      assert.equal(decision.failureStage, 'POLICY');
      assert.equal(decision.policyDecision, 'DENY');
      assert.equal(decision.promotionDecision, 'DENY');
      assert.equal(decision.validationExecuted, false);
      assert.equal(decision.validationComplete, false);
      assert.deepEqual(decision.selectedShapes, []);
      assert.deepEqual(decision.executedShapes, []);
      assert.deepEqual(decision.results[0].politicas, ['urn:generic:ReviewPolicy']);
      assert.equal(decision.results[0].requerRevisaoHumana, true);
      assert.equal(decision.results[0].status, 'revisao_humana');
      assert.equal(decision.results[0].validationExecuted, false);
      assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
    } finally { await f.cleanup(); }
  });
}

// BSH-SEM-023: existing action audit does not bind a candidate commit.
test('Given conforming SHACL and an action approval or approval of another candidate, When human policy is evaluated, Then promotion stays denied', async () => {
  const f = await fixture({ humanReview: true });
  try {
    await mkdir(join(f.repo, '.bsh/local'), { recursive: true });
    await writeFile(join(f.repo, '.bsh/local/events.jsonl'), JSON.stringify({
      time: new Date().toISOString(), actionId: 'different-action', domain: 'generic',
      actionDigest: 'action-only', snapshotDigest: (await createOntologySnapshot(f.repo)).digest,
      rules: ['urn:generic:ReviewPolicy'], evaluation: 'needs-human', confidence: 'complete',
      decision: 'allow', actor: 'human', reason: 'Approved another candidate', candidateCommit: f.base,
    }) + '\n');
    const decision = await evaluateGovernance(f.session, extractor('ok'));
    assert.equal(decision.promotionDecision, 'DENY');
    assert.equal(decision.policyDecision, 'DENY');
    assert.equal(decision.failureStage, 'POLICY');
    assert.equal(decision.validationExecuted, true);
    assert.equal(decision.validationComplete, true);
    assert.deepEqual(decision.executedShapes, ['urn:generic:ActionShape']);
    assert.equal(decision.results[0].status, 'revisao_humana');
    assert.match(decision.reason, /bound to this candidate/);
  } finally { await f.cleanup(); }
});

test('Given conforming SHACL and a human decision bound to the evaluated candidate, When human policy is evaluated, Then promotion is allowed', async () => {
  const f = await fixture({ humanReview: true });
  try {
    const candidateCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    await mkdir(join(f.repo, '.bsh/local'), { recursive: true });
    await writeFile(join(f.repo, '.bsh/local/events.jsonl'), JSON.stringify({
      time: new Date().toISOString(), actionId: 'approved-candidate-action', domain: 'generic',
      actionDigest: 'action-only', snapshotDigest: (await createOntologySnapshot(f.repo)).digest,
      rules: ['urn:generic:ReviewPolicy'], evaluation: 'needs-human', confidence: 'complete',
      decision: 'allow', actor: 'human', reason: 'Human decision bound to candidate', candidateCommit,
    }) + '\n');
    const decision = await evaluateGovernance(f.session, extractor('ok'));
    assert.equal(decision.validationStatus, 'CONFORMING');
    assert.equal(decision.policyDecision, 'ALLOW');
    assert.equal(decision.promotionDecision, 'ALLOW');
    assert.equal(decision.validationExecuted, true);
    assert.equal(decision.validationComplete, true);
    assert.deepEqual(decision.executedShapes, ['urn:generic:ActionShape']);
    assert.equal(decision.results[0].requerRevisaoHumana, true);
    assert.equal(decision.results[0].decisaoHumanaVinculada, true);
    assert.equal(decision.results[0].status, 'conforme');
  } finally { await f.cleanup(); }
});

test('Given a human decision bound to the evaluated candidate but no shapes, When evaluated, Then missing shapes stay blocked at SHAPE_SELECTION', async () => {
  const f = await fixture({ shapes: false, humanReview: true });
  try {
    const candidateCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    await mkdir(join(f.repo, '.bsh/local'), { recursive: true });
    await writeFile(join(f.repo, '.bsh/local/events.jsonl'), JSON.stringify({
      time: new Date().toISOString(), actionId: 'approved-candidate-action', domain: 'generic',
      actionDigest: 'action-only', snapshotDigest: (await createOntologySnapshot(f.repo)).digest,
      rules: ['urn:generic:ReviewPolicy'], evaluation: 'needs-human', confidence: 'complete',
      decision: 'allow', actor: 'human', reason: 'Human decision bound to candidate', candidateCommit,
    }) + '\n');
    const decision = await evaluateGovernance(f.session, extractor('ok'));
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'SHAPE_SELECTION');
    assert.equal(decision.policyDecision, 'DENY');
    assert.equal(decision.promotionDecision, 'DENY');
    assert.equal(decision.validationExecuted, false);
    assert.deepEqual(decision.executedShapes, []);
    assert.equal(decision.results[0].requerRevisaoHumana, true);
    assert.equal(decision.results[0].decisaoHumanaVinculada, true);
  } finally { await f.cleanup(); }
});

// BSH-SEM-024 / 025
for (const humanReview of [undefined, false]) {
  test(`Given ${humanReview === false ? 'a nonreview policy' : 'no policy'} and no applicable shapes, When evaluated with facts, Then missing shapes stay distinct from human review`, async () => {
    const f = await fixture({ shapes: false, humanReview });
    try {
      const decision = await evaluateGovernance(f.session, extractor('ok'));
      assert.equal(decision.validationStatus, 'INDETERMINATE');
      assert.equal(decision.failureStage, 'SHAPE_SELECTION');
      assert.equal(decision.promotionDecision, 'DENY');
      assert.deepEqual(decision.missingFacts, []);
      assert.equal(decision.results[0].requerRevisaoHumana, false);
      assert.deepEqual(decision.results[0].politicas, humanReview === false ? ['urn:generic:ReviewPolicy'] : []);
      assert.equal(decision.validationExecuted, false);
      assert.deepEqual(decision.executedShapes, []);
    } finally { await f.cleanup(); }
  });
}

test('Given no applicable policy and conforming evidence, When shapes execute, Then promotion is allowed without fabricated policies', async () => {
  const f = await fixture();
  try {
    const decision = await evaluateGovernance(f.session, extractor('ok'));
    assert.equal(decision.validationStatus, 'CONFORMING');
    assert.equal(decision.promotionDecision, 'ALLOW');
    assert.equal(decision.policyDecision, 'ALLOW');
    assert.equal(decision.validationExecuted, true);
    assert.equal(decision.validationComplete, true);
    assert.deepEqual(decision.results[0].politicas, []);
    assert.equal(decision.results[0].requerRevisaoHumana, false);
    assert.deepEqual(decision.executedShapes, ['urn:generic:ActionShape']);
  } finally { await f.cleanup(); }
});

test('Given shapes but no independent evidence, When governance evaluates them, Then missing evidence denies without claiming execution', async () => {
  const f = await fixture();
  try {
    const decision = await evaluateGovernance(f.session);
    assert.equal(decision.failureStage, 'FACT_EXTRACTION');
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.promotionDecision, 'DENY');
    assert.equal(decision.validationExecuted, false);
    assert.equal(decision.validationComplete, false);
    assert.deepEqual(decision.executedShapes, []);
    assert.deepEqual(decision.selectedShapes, ['urn:generic:ActionShape']);
    assert.ok(decision.missingFacts.includes('src/module.js'));
  } finally { await f.cleanup(); }
});

for (const evidence of [undefined, extractor('ok', { sourceCommit: 'unrelated' })]) {
  test(`Given human policy with ${evidence ? 'stale' : 'missing'} candidate evidence, When governance evaluates it, Then policy remains visible and blocked`, async () => {
    const f = await fixture({ humanReview: true });
    try {
      const decision = await evaluateGovernance(f.session, evidence);
      assert.equal(decision.failureStage, 'POLICY');
      assert.equal(decision.promotionDecision, 'DENY');
      assert.equal(decision.validationExecuted, false);
      assert.equal(decision.results[0].requerRevisaoHumana, true);
      assert.deepEqual(decision.results[0].politicas, ['urn:generic:ReviewPolicy']);
      assert.deepEqual(decision.executedShapes, []);
    } finally { await f.cleanup(); }
  });
}

// Direct semantic-validator unit coverage, independent of the promotion coordinator.
test('Given a human policy without shapes, When the semantic validator is called directly, Then review is required without SHACL execution', async () => {
  const f = await fixture({ shapes: false, humanReview: true });
  try {
    const result = await validarOperacao(f.repo, await createOntologySnapshot(f.repo), operation);
    assert.equal(result.status, 'revisao_humana');
    assert.equal(result.requerRevisaoHumana, true);
    assert.deepEqual(result.politicas, ['urn:generic:ReviewPolicy']);
    assert.equal(result.validationExecuted, false);
    assert.equal(result.validationComplete, false);
    assert.deepEqual(result.executedShapes, []);
  } finally { await f.cleanup(); }
});

test('Given a generic repository without BSH, When its stable candidate is promoted, Then generic Git remains supported without claiming semantic execution', async () => {
  const f = await fixture({ generic: true });
  try {
    let decision;
    const result = await promoverSessao(f.session, { validarGates: gatesOk,
      onGovernanceDecision: async item => { decision = item; } });
    assert.equal(result.status, 'promovido', result.detalhes);
    assert.equal(decision.validationExecuted, false);
    assert.deepEqual(decision.executedShapes, []);
    assert.equal(decision.originChanged, true);
  } finally { await f.cleanup(); }
});

test('Given an empty governed diff, When evaluated, Then it cannot fabricate validation execution', async () => {
  const f = await fixture();
  try {
    await git(f.session.caminhoWorktree, ['reset', '--hard', f.base]);
    const decision = await evaluateGovernance(f.session);
    assert.equal(decision.validationExecuted, false);
    assert.deepEqual(decision.executedShapes, []);
    assert.equal(decision.promotionDecision, 'DENY');
  } finally { await f.cleanup(); }
});

for (const scenario of [
  { shapes: true, humanReview: true, evidence: undefined, expected: 'revisao_humana', executed: false },
  { shapes: false, humanReview: undefined, evidence: graph('ok'), expected: 'indeterminado', executed: false },
  { shapes: true, humanReview: undefined, evidence: graph('ok'), expected: 'conforme', executed: true },
]) {
  test(`Given ${scenario.shapes ? 'applicable' : 'no'} shapes and ${scenario.humanReview ? 'human' : 'no'} policy, When the validator receives ${scenario.evidence ? 'independent' : 'no'} evidence, Then it reports ${scenario.expected} and real execution`, async () => {
    const f = await fixture(scenario);
    try {
      const result = await validarOperacao(f.repo, await createOntologySnapshot(f.repo),
        { ...operation, candidateGraphTurtle: scenario.evidence }, { requireCandidateEvidence: true });
      assert.equal(result.status, scenario.expected);
      assert.equal(result.validationExecuted, scenario.executed);
      assert.equal(result.validationComplete, scenario.executed);
      assert.equal(result.requerRevisaoHumana, scenario.humanReview === true);
      assert.deepEqual(result.executedShapes, scenario.executed ? ['urn:generic:ActionShape'] : []);
      assert.deepEqual(result.politicas, scenario.humanReview ? ['urn:generic:ReviewPolicy'] : []);
      if (scenario.evidence === undefined) assert.deepEqual(result.missingFacts, ['Independent candidate evidence is missing']);
    } finally { await f.cleanup(); }
  });
}
