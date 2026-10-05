import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assessExplanation, summarizeOperationalMetrics } from '../../dist/evaluation/metrics.js';

// Synthetic observations test the requirement-derived aggregation contract, not a live agent.
function run(overrides = {}) {
  return { schemaVersion: 1, runId: 'run', batchId: 'batch', track: 'FIXED_CANDIDATE', projectId: 'synthetic',
    domain: 'synthetic', technology: 'javascript', condition: { id: 'enforced', context: 'STRUCTURED_QUERY',
      enforcement: true, policyId: 'policy', policyHash: 'hash' },
    controls: { agent: 'synthetic', agentVersion: '1', model: 'mock', taskId: 'task', taskPrompt: 'task',
      baseHash: 'hash', budget: { maxTokens: 100, maxTurns: 2, timeoutMs: 1000 }, technicalGates: ['test'] },
    candidate: { id: 'candidate', contentHash: 'hash', commit: null, baseCommit: null },
    oracle: { verdict: 'VALID', reference: 'oracle.json', sha256: 'hash' }, status: 'DENIED',
    promotionDecision: 'DENY', promoted: false, validated: true, semanticStatus: 'CONFORMING',
    failureStage: null, queries: [], artifacts: [], sources: [], adapterIds: [], factsHash: 'hash',
    expectedRuleIds: [], evaluatedRuleIds: [], expectedEvidenceIds: [], evaluatedEvidenceIds: [],
    decisionRecords: [], explanation: null, humanReview: null, costs: [],
    expectedCostPhases: [{ phase: 'VALIDATION', kind: 'RECURRING' }], transfer: null, limitations: [], ...overrides };
}
function cost(overrides = {}) {
  return { phase: 'VALIDATION', kind: 'RECURRING', durationMs: 20, tokens: 2, amount: 3, currency: 'USD', ...overrides };
}

test('Given oracle-valid candidates and other failures, When aggregating, Then only existing candidates with denied promotion count as false blocks (BSH-EXP-006)', () => {
  const records = [run(), run({ runId: 'absent', candidate: null, status: 'NO_CANDIDATE' }),
    run({ runId: 'refused', status: 'REFUSED', promotionDecision: 'NOT_ATTEMPTED' }),
    run({ runId: 'validation-only', promotionDecision: 'NOT_ATTEMPTED', semanticStatus: 'VIOLATION' }),
    run({ runId: 'unknown', oracle: { verdict: 'INDETERMINATE' } }),
    run({ runId: 'technical', status: 'TECHNICAL_FAILURE', promotionDecision: 'NOT_ATTEMPTED' }),
    run({ runId: 'evidence', status: 'MISSING_EVIDENCE', promotionDecision: 'NOT_ATTEMPTED' }),
    run({ runId: 'timeout', status: 'TIMEOUT', promotionDecision: 'NOT_ATTEMPTED' }),
    run({ runId: 'error', status: 'ERROR', promotionDecision: 'NOT_ATTEMPTED' })];
  const result = summarizeOperationalMetrics(records);
  assert.deepEqual(result.falseBlocks, { count: 1, denominator: 1, ids: ['run'], rate: 1 });
  for (const status of ['NO_CANDIDATE', 'REFUSED', 'TECHNICAL_FAILURE', 'MISSING_EVIDENCE', 'TIMEOUT', 'ERROR']) {
    assert.equal(result.statuses[status], 1);
  }
  assert.equal(result.indetermination.count, 2);
});

test('Given invalid candidates authorized or actually promoted, When aggregating, Then only actual promotions count as promoted violations (BSH-EXP-006)', () => {
  const result = summarizeOperationalMetrics([
    run({ oracle: { verdict: 'INVALID' }, promotionDecision: 'ALLOW' }),
    run({ runId: 'integrated', oracle: { verdict: 'INVALID' }, promotionDecision: 'ALLOW', promoted: true }),
  ]);
  assert.deepEqual(result.violationsPromoted, { count: 1, denominator: 1, ids: ['integrated'] });
  const unmeasured = summarizeOperationalMetrics([run({ promotionDecision: 'NOT_ATTEMPTED' })]);
  assert.equal(unmeasured.falseBlocks.count, null);
  assert.equal(unmeasured.violationsPromoted.count, null);
});

test('Given expected and observed rule and evidence identifiers, When calculating coverage, Then unexpected observations cannot inflate coverage (BSH-EXP-006)', () => {
  const result = summarizeOperationalMetrics([run({ expectedRuleIds: ['r1', 'r2'], evaluatedRuleIds: ['r1', 'extra'],
    expectedEvidenceIds: ['e1'], evaluatedEvidenceIds: [] })]);
  assert.equal(result.coverage.rules.ratio, 0.5);
  assert.deepEqual(result.coverage.rules.missing, [{ runId: 'run', id: 'r2' }]);
  assert.deepEqual(result.coverage.rules.unexpected, [{ runId: 'run', id: 'extra' }]);
  assert.equal(result.coverage.evidence.ratio, 0);
  assert.equal(summarizeOperationalMetrics([run()]).coverage.rules.ratio, null);
});

test('Given explanation claims, When matching structured records, Then identifiers references fields and values all must correspond (BSH-EXP-007)', () => {
  const content = '{"status":"deny"}';
  const result = assessExplanation(run({ artifacts: [{ id: 'report', role: 'QUERY_RESULT', source: 'report.json', content,
    sha256: createHash('sha256').update(content).digest('hex') }],
    decisionRecords: [{ id: 'decision', references: ['report.json', 'missing.json'], record: { result: { status: 'deny' } } }],
    explanation: [
      { recordId: 'decision', reference: 'report.json', fieldPath: 'result.status', expectedValue: 'deny' },
      { recordId: 'missing', reference: 'report.json', fieldPath: 'result.status', expectedValue: 'deny' },
      { recordId: 'decision', reference: 'invented.json', fieldPath: 'result.status', expectedValue: 'deny' },
      { recordId: 'decision', reference: 'report.json', fieldPath: 'absent', expectedValue: null },
      { recordId: 'decision', reference: 'report.json', fieldPath: 'result.status', expectedValue: 'allow' },
      { recordId: 'decision', reference: 'missing.json', fieldPath: 'result.status', expectedValue: 'deny' },
    ] }));
  assert.equal(result.verified, 1);
  assert.equal(result.correspondence, 1 / 6);
  assert.deepEqual(result.unsupported.map(claim => claim.reason), ['MISSING_RECORD', 'MISSING_REFERENCE', 'MISSING_FIELD', 'VALUE_MISMATCH', 'UNRECOVERABLE_REFERENCE']);
  assert.equal(assessExplanation(run()).correspondence, null);
  assert.equal(assessExplanation(run({ explanation: [] })).available, false);
});

test('Given partial human measurements, When aggregating review and work, Then missing time is not zero (BSH-EXP-007)', () => {
  const result = summarizeOperationalMetrics([run({ humanReview: { reviewMs: 100, workMs: 200, description: 'review' } }), run()]);
  assert.equal(result.human.reviewMs.total, null);
  assert.equal(result.human.reviewMs.measuredSubtotal, 100);
  assert.equal(result.human.workMs.missing, 1);
});

test('Given deployment and recurring costs in two currencies, When aggregating, Then costs stay separate and use actual accepted validated changes (BSH-EXP-008)', () => {
  const result = summarizeOperationalMetrics([run({ status: 'ACCEPTED', promotionDecision: 'ALLOW', promoted: true,
    costs: [cost(), cost({ kind: 'DEPLOYMENT', phase: 'PACKAGE_PREPARATION', amount: 12 }), cost({ currency: 'EUR', amount: 5 })] })]);
  assert.equal(result.costs.acceptedValidated, 1);
  assert.equal(result.costs.byKind.RECURRING.byCurrency.USD.total, 3);
  assert.equal(result.costs.byKind.RECURRING.byCurrency.EUR.perAcceptedValidated, 5);
  assert.equal(result.costs.byKind.DEPLOYMENT.byCurrency.USD.total, 12);
  assert.equal(result.costs.byKind.RECURRING.phases.PACKAGE_MAINTENANCE.durationMs.total, null);
  assert.equal(result.adequacy, 'NOT_ESTABLISHED_BY_TOKEN_OR_PROMOTION_REDUCTION');
});

test('Given unavailable costs or no accepted validated changes, When computing unit cost, Then no invented zero estimate is emitted (BSH-EXP-008)', () => {
  const partial = summarizeOperationalMetrics([run({ costs: [cost({ amount: null, durationMs: null })] })]);
  assert.equal(partial.costs.byKind.RECURRING.byCurrency.USD.total, null);
  assert.equal(partial.costs.byKind.RECURRING.byCurrency.USD.perAcceptedValidated, null);
  const zero = summarizeOperationalMetrics([run({ costs: [cost()] })]);
  assert.equal(zero.costs.byKind.RECURRING.byCurrency.USD.perAcceptedValidated, null);
  const missingRun = summarizeOperationalMetrics([run({ costs: [cost()] }), run({ runId: 'unmeasured' })]);
  assert.equal(missingRun.costs.byKind.RECURRING.byCurrency.USD.total, null);
  assert.deepEqual(missingRun.costs.missingRunMeasurements, ['unmeasured']);
  assert.throws(() => summarizeOperationalMetrics([run({ costs: [cost({ amount: -1 })] })]), /finite and nonnegative/);
});

test('Given queries with different mechanisms and purposes, When aggregating cost and outcomes, Then context selection remains separate from authorization evidence (BSH-EXP-004)', () => {
  const query = { id: 'q', mechanism: 'SPARQL', purpose: 'AGENT_CONTEXT', query: 'ASK {}', sourceHash: 'hash',
    result: false, status: 'SUCCESS', durationMs: 10, tokens: null };
  const result = summarizeOperationalMetrics([run({ queries: [query,
    { ...query, id: 'q2', purpose: 'AUTHORIZATION_EVIDENCE', status: 'TIMEOUT', durationMs: 20 },
    { ...query, id: 'q3', mechanism: 'STRUCTURED', status: 'EMPTY' }] })]);
  assert.equal(result.queries.SPARQL.AGENT_CONTEXT.count, 1);
  assert.equal(result.queries.SPARQL.AUTHORIZATION_EVIDENCE.statuses.TIMEOUT, 1);
  assert.equal(result.queries.STRUCTURED.AGENT_CONTEXT.statuses.EMPTY, 1);
  assert.equal(result.queries.SPARQL.AGENT_CONTEXT.tokens.total, null);
});

test('Given repeated rule expectations and incomplete declared cost phases, When aggregating, Then one successful trial cannot cover another trial or hide unmeasured costs (BSH-EXP-006 BSH-EXP-008)', () => {
  const records = [run({ expectedRuleIds: ['r'], evaluatedRuleIds: ['r'], costs: [cost()],
    expectedCostPhases: [{ phase: 'EXTRACTION', kind: 'RECURRING' }, { phase: 'VALIDATION', kind: 'RECURRING' }] }),
    run({ runId: 'other', expectedRuleIds: ['r'], costs: [cost()], expectedCostPhases: undefined })];
  const result = summarizeOperationalMetrics(records);
  assert.equal(result.coverage.rules.ratio, 0.5);
  assert.equal(result.coverage.uniqueRules.ratio, 1);
  assert.equal(result.costs.byKind.RECURRING.byCurrency.USD.total, null);
  assert.equal(result.costs.byKind.RECURRING.byCurrency.USD.measuredSubtotal, 6);
  assert.deepEqual(result.costs.missingPhases, [{ runId: 'run', phase: 'EXTRACTION', kind: 'RECURRING' }]);
  assert.deepEqual(result.costs.missingApplicabilityDeclarations, ['other']);
});
