import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertControlledComparison, executeControlledRun, executeControlledBatch, executeAndCaptureRun, compareGovernedProducts, createContextSelector } from '../../dist/evaluation/experiment.js';
import { contentHash, loadExperimentRun } from '../../dist/evaluation/replay.js';

// Explicit stage doubles isolate experiment orchestration. Production SHACL/Git
// integration is exercised by separate tests; these doubles never promote commits.
const asset = (id, role, content) => ({ id, role, content, source: `${id}.txt`, sha256: contentHash(content) });
function seed(overrides = {}) {
  return { schemaVersion: 1, runId: 'controlled', batchId: 'batch', track: 'FIXED_CANDIDATE', projectId: 'synthetic-project', domain: 'synthetic', technology: 'js',
    condition: { id: 'semantic', context: 'STRUCTURED_QUERY', enforcement: true, policyId: 'rules', policyHash: contentHash('rules') },
    controls: { agent: 'fixture-agent', agentVersion: '1', model: 'fixture-model', taskId: 'task', taskPrompt: 'Change code', baseHash: contentHash('base'),
      budget: { maxTokens: 100, maxTurns: 2, timeoutMs: 50 }, technicalGates: ['check'] },
    candidate: { id: 'candidate', contentHash: contentHash('candidate'), commit: null, baseCommit: null },
    oracle: { verdict: 'VALID', reference: 'independent-oracle', sha256: contentHash('oracle') },
    status: 'NO_CANDIDATE', promotionDecision: 'NOT_ATTEMPTED', promoted: false, validated: false, semanticStatus: null,
    failureStage: null, queries: [], artifacts: [asset('base', 'BASE', 'base'), asset('candidate', 'CANDIDATE', 'candidate'), asset('rules', 'POLICY', 'rules')],
    sources: [], adapterIds: [], factsHash: null, expectedRuleIds: [], evaluatedRuleIds: [], expectedEvidenceIds: [], evaluatedEvidenceIds: [],
    decisionRecords: [], explanation: null, humanReview: null, costs: [], transfer: null, limitations: ['MOCK stage adapters; no actual promotion'], ...overrides };
}
function decision(overrides = {}) {
  return { candidateGraphHash: contentHash('facts'), validationStatus: 'CONFORMING', validationExecuted: true, validationComplete: true,
    promotionDecision: 'ALLOW', failureStage: null, ruleCoverage: { totalRules: ['r1'], appliedRules: ['r1'] },
    evidenceSufficiency: { details: [{ ruleId: 'r1', requiredEvidenceTypes: ['structural'], providedEvidenceTypes: ['structural'] }] },
    adaptersUsed: [{ id: 'fixture', version: '1', name: 'Fixture', technology: 'js', supportedOperations: ['change'] }], ...overrides };
}
function stages(overrides = {}) {
  return { selectContext: async () => ({ text: 'agent-only context', artifacts: [asset('context', 'CONTEXT', 'agent-only context')], queries: [] }),
    generate: async () => ({ candidate: seed().candidate, artifacts: [], outcome: 'COMPLETED', costs: [] }),
    evaluate: async () => ({ decision: decision(), artifacts: [asset('facts', 'FACTS', 'facts')], costs: [] }),
    technicalGates: async () => ({ ok: true, record: { checked: true }, costs: [] }), ...overrides };
}

test('Given a fixed candidate, When recognition extraction and decisions run, Then generation is never called and acceptance never invents promotion', async () => {
  let generation = 0; let evaluation = 0; let gates = 0;
  const result = await executeControlledRun(seed(), stages({ generate: async () => { generation++; throw new Error('Generation forbidden'); },
    evaluate: async (candidate) => { evaluation++; assert.equal(candidate.contentHash, contentHash('candidate')); return { decision: decision(), artifacts: [], costs: [] }; },
    technicalGates: async () => { gates++; return { ok: true, record: { checked: true }, costs: [] }; } }));
  assert.equal(generation, 0); assert.equal(evaluation, 1); assert.equal(gates, 1);
  assert.equal(result.status, 'ACCEPTED'); assert.equal(result.promoted, false); assert.equal(result.validated, true);
  assert.deepEqual(result.expectedRuleIds, ['r1']);
});

test('Given semantic authorization allows a candidate, When the technical gate throws, Then final authorization remains unattempted and the failure stage identifies the gate (BSH-EXP-002 BSH-EXP-006)', async () => {
  const result = await executeControlledRun(seed(), stages({
    technicalGates: async () => { throw new Error('Gate process failed before completion'); },
  }));
  assert.equal(result.status, 'ERROR');
  assert.equal(result.failureStage, 'TECHNICAL_GATES');
  assert.equal(result.promotionDecision, 'NOT_ATTEMPTED');
  assert.equal(result.promoted, false);
  assert.equal(result.governanceDecision.promotionDecision, 'ALLOW');
  assert.equal(result.validated, true);
  assert.equal(result.decisionRecords.some(record => record.id === 'technical-gates'), false);
  assert.match(result.decisionRecords.find(record => record.id === 'experiment-error').record.error, /Gate process failed/);
});

test('Given agent generation conditions, When controls differ, Then confounded comparisons are rejected before any execution', () => {
  const a = seed({ track: 'AGENT_GENERATION', candidate: null });
  const b = structuredClone(a); b.condition.id = 'text'; b.condition.context = 'TEXT_RULES';
  assert.doesNotThrow(() => assertControlledComparison(a, b));
  for (const field of ['agent', 'agentVersion', 'model', 'taskId', 'taskPrompt', 'baseHash', 'budget', 'technicalGates']) {
    const changed = structuredClone(b);
    changed.controls[field] = field === 'budget' ? { ...changed.controls.budget, maxTokens: 99 }
      : field === 'technicalGates' ? ['different'] : 'different';
    assert.throws(() => assertControlledComparison(a, changed), /equivalent/);
  }
});

test('Given selected context, When a candidate is generated and authorized, Then context reaches generation and only candidate identity reaches the independent evaluator', async () => {
  let generationInput; let evaluationArguments;
  const result = await executeControlledRun(seed({ track: 'AGENT_GENERATION', candidate: null }), stages({
    generate: async (input) => { generationInput = input; return { candidate: seed().candidate, artifacts: [], outcome: 'COMPLETED', costs: [] }; },
    evaluate: async (...args) => { evaluationArguments = args; return { decision: decision(), artifacts: [], costs: [] }; },
  }));
  assert.equal(generationInput.context, 'agent-only context');
  assert.deepEqual(generationInput.controls, result.controls);
  assert.deepEqual(evaluationArguments, [seed().candidate]);
  assert.equal(result.status, 'ACCEPTED');
});

test('Given equivalent facts and a semantic violation, When consultation and enforcement are separated, Then consultation accepts observationally while enforcement denies', async () => {
  const evaluate = async () => ({ decision: decision({ promotionDecision: 'DENY', validationStatus: 'VIOLATION' }), artifacts: [], costs: [] });
  const enforced = await executeControlledRun(seed(), stages({ evaluate }));
  const observationalSeed = seed(); observationalSeed.condition.enforcement = false;
  const observational = await executeControlledRun(observationalSeed, stages({ evaluate }));
  assert.equal(enforced.status, 'DENIED'); assert.equal(enforced.promotionDecision, 'DENY');
  assert.equal(observational.status, 'ACCEPTED'); assert.equal(observational.governanceDecision.promotionDecision, 'DENY');
  assert.equal(observational.semanticStatus, 'VIOLATION'); assert.equal(observational.factsHash, enforced.factsHash);
  assert.equal(observational.promoted, false);
  const policyAlternative = structuredClone(observational); policyAlternative.condition.policyHash = contentHash('other-policy');
  assert.doesNotThrow(() => assertControlledComparison(observational, policyAlternative));
  policyAlternative.factsHash = contentHash('different-facts');
  assert.throws(() => assertControlledComparison(observational, policyAlternative), /equivalent extracted facts/);
});

test('Given empty failed or timed out context queries, When runs execute, Then empty context is not authorization and failures remain explicit', async () => {
  for (const status of ['EMPTY', 'ERROR', 'TIMEOUT', 'UNSUPPORTED', 'LIMIT_EXCEEDED']) {
    let evaluated = 0;
    const result = await executeControlledRun(seed(), stages({ selectContext: async () => ({ text: '', artifacts: [], queries: [{
      id: 'q', mechanism: 'SPARQL', purpose: 'AGENT_CONTEXT', query: 'SELECT ?s WHERE {?s ?p ?o}', sourceHash: contentHash('graph'),
      result: status === 'EMPTY' ? [] : null, status, durationMs: 1, tokens: null }] }),
      evaluate: async () => { evaluated++; return { decision: decision({ validationStatus: 'INDETERMINATE', promotionDecision: 'DENY', failureStage: 'FACT_EXTRACTION' }), artifacts: [], costs: [] }; } }));
    assert.equal(evaluated, status === 'EMPTY' ? 1 : 0);
    assert.equal(result.status, status === 'EMPTY' ? 'MISSING_EVIDENCE' : status === 'TIMEOUT' ? 'TIMEOUT' : status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'ERROR');
    assert.equal(result.promoted, false);
  }
});

test('Given a generator ignoring cancellation, When the time budget expires, Then the run times out without waiting for the generator or evaluating a candidate', async () => {
  let signal; let evaluated = 0;
  const result = await executeControlledRun(seed({ track: 'AGENT_GENERATION', candidate: null }), stages({
    generate: async (input) => { signal = input.signal; return new Promise(() => {}); },
    evaluate: async () => { evaluated++; throw new Error('Not reached'); },
  }));
  assert.equal(result.status, 'TIMEOUT'); assert.equal(result.failureStage, 'GENERATION');
  assert.equal(signal.aborted, true); assert.equal(evaluated, 0); assert.equal(result.candidate, null);
});

test('Given no candidate refusal generation failure or failed technical gates, When runs execute, Then failure categories stay distinct', async () => {
  for (const [outcome, expected] of [['COMPLETED', 'NO_CANDIDATE'], ['REFUSED', 'REFUSED'], ['TECHNICAL_FAILURE', 'TECHNICAL_FAILURE'], ['TIMEOUT', 'TIMEOUT']]) {
    const result = await executeControlledRun(seed({ track: 'AGENT_GENERATION', candidate: null }), stages({
      generate: async () => ({ candidate: null, artifacts: [], outcome, costs: [] }),
    }));
    assert.equal(result.status, expected); assert.equal(result.failureStage, 'GENERATION');
  }
  const technical = await executeControlledRun(seed(), stages({ technicalGates: async () => ({ ok: false, record: { checked: false }, costs: [] }) }));
  assert.equal(technical.status, 'TECHNICAL_FAILURE'); assert.equal(technical.failureStage, 'TECHNICAL_GATES');
  assert.equal(technical.promotionDecision, 'DENY'); assert.equal(technical.promoted, false);
});

test('Given a completed controlled run, When captured in its project, Then canonical snapshots contain recoverable structured decisions without undefined values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-controlled-'));
  try {
    const captured = await executeAndCaptureRun(root, seed(), stages());
    assert.deepEqual(await loadExperimentRun(root, 'controlled'), captured.run);
    assert.equal(captured.run.decisionRecords[0].record.candidateGraphHash, contentHash('facts'));
    assert.equal(captured.run.promoted, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given products with different governed objects or execution points, When compared, Then direct superiority remains unsupported', () => {
  const a = { product: 'fixture-a', governedObject: 'candidate commit', executionPoints: ['promotion'], evidenceReference: 'fixture-reference' };
  const b = { ...a, product: 'fixture-b', governedObject: 'tool call' };
  assert.equal(compareGovernedProducts(a, b).comparable, false);
  assert.equal(compareGovernedProducts(a, { ...b, governedObject: a.governedObject }).comparable, true);
  assert.throws(() => compareGovernedProducts(a, { ...b, evidenceReference: '' }), /requires/);
});

test('Given a reused run seed with stale evidence, When generation times out, Then previous candidate decisions and validation evidence cannot be reported as current observations', async () => {
  const stale = seed({ track: 'AGENT_GENERATION', failureStage: 'FACT_EXTRACTION', factsHash: contentHash('old-facts'),
    expectedRuleIds: ['old-rule'], evaluatedRuleIds: ['old-rule'], evaluatedEvidenceIds: ['old-evidence'],
    adapterIds: [{ id: 'old-adapter', version: '1', sha256: contentHash('old') }],
    queries: [{ id: 'old-query', status: 'SUCCESS' }], decisionRecords: [{ id: 'old-decision', references: [], record: { allow: true } }],
    explanation: [{ recordId: 'old-decision', reference: 'old', fieldPath: 'allow', expectedValue: true }] });
  const result = await executeControlledRun(stale, stages({ generate: async () => new Promise(() => {}) }));
  assert.equal(result.status, 'TIMEOUT'); assert.equal(result.failureStage, 'GENERATION');
  assert.equal(result.candidate, null); assert.equal(result.factsHash, null);
  assert.deepEqual(result.evaluatedRuleIds, []); assert.deepEqual(result.evaluatedEvidenceIds, []);
  assert.deepEqual(result.adapterIds, []); assert.deepEqual(result.queries, []);
  assert.equal(result.explanation, null);
  assert.ok(!result.decisionRecords.some((record) => record.id === 'old-decision'));
});

async function syntheticContextProject() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-context-engine-'));
  const domainPath = join(root, '.bsh/domains/synthetic');
  await mkdir(domainPath, { recursive: true });
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'synthetic-project', domains: [{
    id: 'synthetic', version: '1.0.0', baseIri: 'urn:qa:context:', ontology: 'domains/synthetic/ontology.jsonld', shapes: 'domains/synthetic/shapes.ttl',
  }] }));
  await writeFile(join(domainPath, 'ontology.jsonld'), JSON.stringify({ '@context': { ex: 'urn:qa:context:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' },
    '@graph': [{ '@id': 'ex:Thing', '@type': 'rdfs:Class', 'rdfs:label': 'Synthetic thing' }] }));
  await writeFile(join(domainPath, 'shapes.ttl'), '@prefix ex: <urn:qa:context:> . @prefix sh: <http://www.w3.org/ns/shacl#> . ex:Shape a sh:NodeShape; sh:targetClass ex:Thing; sh:property [ sh:path ex:name; sh:minCount 1 ] .');
  return root;
}

test('Given one sovereign synthetic project snapshot, When real structured and Comunica SPARQL context selectors execute, Then both mechanisms expose the same provenance and recoverable facts', async () => {
  const root = await syntheticContextProject();
  try {
    const selector = createContextSelector({ projectRoot: root, domain: 'synthetic', textRules: 'A name is required',
      sparql: { query: 'SELECT ?shape ?target WHERE { ?shape <http://www.w3.org/ns/shacl#targetClass> ?target }' } });
    const structuredSeed = seed();
    const sparqlSeed = seed(); sparqlSeed.condition.context = 'SPARQL_QUERY'; sparqlSeed.condition.id = 'sparql';
    const structured = await selector(structuredSeed);
    const sparql = await selector(sparqlSeed);
    assert.equal(structured.queries[0].mechanism, 'STRUCTURED');
    assert.equal(sparql.queries[0].mechanism, 'SPARQL');
    assert.equal(structured.queries[0].sourceHash, sparql.queries[0].sourceHash);
    assert.equal(sparql.queries[0].status, 'SUCCESS', JSON.stringify(sparql.queries[0].result));
    assert.deepEqual(sparql.queries[0].result.bindings, [{ shape: { termType: 'NamedNode', value: 'urn:qa:context:Shape' },
      target: { termType: 'NamedNode', value: 'urn:qa:context:Thing' } }]);
    const inputs = (context) => context.artifacts.filter((artifact) => artifact.id.startsWith('context-input:')).map(({ id, sha256, content }) => ({ id, sha256, content }));
    assert.deepEqual(inputs(structured), inputs(sparql));
    assert.ok(sparql.artifacts.some((artifact) => artifact.id === 'sparql-source' && artifact.content.includes('<urn:qa:context:Shape>')));
    assert.ok(sparql.queries.every((query) => query.purpose === 'AGENT_CONTEXT'));
    structuredSeed.queries = structured.queries; sparqlSeed.queries = sparql.queries;
    assert.doesNotThrow(() => assertControlledComparison(structuredSeed, sparqlSeed));
    sparqlSeed.queries[0].sourceHash = contentHash('different-source');
    assert.throws(() => assertControlledComparison(structuredSeed, sparqlSeed), /same source snapshot/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a real SPARQL ASK false answer, When context is consumed by a controlled run, Then the typed answer cannot authorize a candidate lacking independent evidence', async () => {
  const root = await syntheticContextProject();
  try {
    const selector = createContextSelector({ projectRoot: root, domain: 'synthetic', textRules: '',
      sparql: { query: 'ASK { ?s <urn:qa:context:absent> ?o }' } });
    const input = seed(); input.condition.context = 'SPARQL_QUERY';
    const context = await selector(input);
    assert.equal(context.queries[0].status, 'SUCCESS');
    assert.equal(context.queries[0].result.queryType, 'ASK');
    assert.equal(context.queries[0].result.boolean, false);
    assert.equal(Object.hasOwn(context.queries[0].result, 'authorized'), false);
    let evaluationArguments;
    const result = await executeControlledRun(input, stages({ selectContext: selector,
      evaluate: async (...args) => { evaluationArguments = args; return { decision: decision({ validationStatus: 'INDETERMINATE',
        validationComplete: false, promotionDecision: 'DENY', failureStage: 'FACT_EXTRACTION' }), artifacts: [], costs: [] }; } }));
    assert.deepEqual(evaluationArguments, [input.candidate]);
    assert.equal(result.status, 'MISSING_EVIDENCE');
    assert.equal(result.promotionDecision, 'DENY');
    assert.equal(result.promoted, false);
    assert.equal(result.queries[0].purpose, 'AGENT_CONTEXT');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given matched experimental blocks, When batch controls or actual alternative-policy facts diverge, Then callbacks do not run for confounded controls and unequal facts prevent comparison', async () => {
  const first = seed();
  const second = seed({ runId: 'alternative' }); second.condition.id = 'alternative'; second.condition.policyHash = contentHash('alternative-policy');
  let calls = 0;
  const counting = stages({ selectContext: async () => { calls++; return { text: '', artifacts: [], queries: [] }; } });
  const confounded = structuredClone(second); confounded.controls.model = 'different';
  await assert.rejects(executeControlledBatch([{ seed: first, stages: counting }, { seed: confounded, stages: counting }]), /equivalent controls/);
  assert.equal(calls, 0);
  await assert.rejects(executeControlledBatch([{ seed: first, stages: counting }, { seed: structuredClone(first), stages: counting }]), /Duplicate/);
  assert.equal(calls, 0);
  const equivalent = await executeControlledBatch([{ seed: first, stages: stages() }, { seed: second, stages: stages() }]);
  assert.equal(equivalent.comparable, true); assert.deepEqual(equivalent.diagnostics, []);
  const unequal = await executeControlledBatch([{ seed: first, stages: stages() }, { seed: second, stages: stages({ evaluate: async () => ({
    decision: decision({ candidateGraphHash: contentHash('changed-facts') }), artifacts: [], costs: [],
  }) }) }]);
  assert.equal(unequal.comparable, false); assert.match(unequal.diagnostics.join(' '), /equivalent extracted facts/);
});
