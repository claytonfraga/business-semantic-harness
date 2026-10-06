import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import type { CostObservation, CostPhase, ExperimentRun, QueryObservation } from './types.js';

const costPhases: CostPhase[] = ['QUERY', 'EXTRACTION', 'VALIDATION', 'PACKAGE_PREPARATION',
  'PACKAGE_MAINTENANCE', 'GENERATION', 'TECHNICAL_GATES', 'HUMAN_REVIEW'];
const queryStatuses: QueryObservation['status'][] = ['SUCCESS', 'EMPTY', 'ERROR', 'TIMEOUT', 'LIMIT_EXCEEDED', 'UNSUPPORTED'];

function measured(values: Array<number | null>, expected = values.length) {
  if (values.some(value => value !== null && (!Number.isFinite(value) || value < 0))) {
    throw new Error('Measurements must be finite and nonnegative');
  }
  const observed = values.filter((value): value is number => value !== null);
  const measuredSubtotal = observed.length ? observed.reduce((sum, value) => sum + value, 0) : null;
  return { total: expected > 0 && observed.length === expected ? measuredSubtotal : null,
    measuredSubtotal, measured: observed.length, expected, missing: expected - observed.length };
}

function coverage(expected: string[], evaluated: string[]) {
  const denominator = new Set(expected);
  const observations = new Set(evaluated);
  const covered = [...denominator].filter(id => observations.has(id));
  return { expected: denominator.size, evaluated: observations.size, covered: covered.length,
    ratio: denominator.size ? covered.length / denominator.size : null,
    missing: [...denominator].filter(id => !observations.has(id)).sort(),
    unexpected: [...observations].filter(id => !denominator.has(id)).sort() };
}

function readField(record: unknown, fieldPath: string): { found: boolean; value: unknown } {
  if (!fieldPath) return { found: true, value: record };
  let value: unknown = record;
  for (const segment of fieldPath.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) {
      return { found: false, value: undefined };
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return { found: true, value };
}

function recoverableReference(run: ExperimentRun, reference: string): boolean {
  const snapshots = [...run.artifacts, ...run.sources];
  if (snapshots.some(snapshot => [snapshot.id, snapshot.source, snapshot.sha256].includes(reference) &&
    createHash('sha256').update(snapshot.content).digest('hex') === snapshot.sha256)) return true;
  return run.queries.some(query => query.id === reference && query.result !== undefined &&
    snapshots.some(snapshot => snapshot.sha256 === query.sourceHash &&
      createHash('sha256').update(snapshot.content).digest('hex') === snapshot.sha256));
}

export function assessExplanation(run: ExperimentRun) {
  if (run.explanation === null || run.explanation.length === 0) {
    return { available: false, claims: 0, verified: 0, unsupported: [], correspondence: null };
  }
  const unsupported: Array<{ index: number; reason: string }> = [];
  for (const [index, claim] of run.explanation.entries()) {
    const record = run.decisionRecords.find(record => record.id === claim.recordId);
    if (!record) { unsupported.push({ index, reason: 'MISSING_RECORD' }); continue; }
    if (!record.references.includes(claim.reference)) {
      unsupported.push({ index, reason: 'MISSING_REFERENCE' }); continue;
    }
    if (!recoverableReference(run, claim.reference)) {
      unsupported.push({ index, reason: 'UNRECOVERABLE_REFERENCE' }); continue;
    }
    const field = readField(record.record, claim.fieldPath);
    if (!field.found) { unsupported.push({ index, reason: 'MISSING_FIELD' }); continue; }
    if (!isDeepStrictEqual(field.value, claim.expectedValue)) {
      unsupported.push({ index, reason: 'VALUE_MISMATCH' });
    }
  }
  const verified = run.explanation.length - unsupported.length;
  return { available: true, claims: run.explanation.length, verified, unsupported,
    correspondence: verified / run.explanation.length };
}

function costSummary(costs: CostObservation[], acceptedValidated: number, missingRuns = 0) {
  const currencies = [...new Set(costs.flatMap(cost => cost.currency ? [cost.currency] : []))].sort();
  const unassigned = costs.filter(cost => cost.currency === null);
  const byCurrency = Object.fromEntries(currencies.map(currency => {
    const currencyCosts = costs.filter(cost => cost.currency === currency);
    const amounts = measured(currencyCosts.map(cost => cost.amount));
    const total = unassigned.length || missingRuns ? null : amounts.total;
    return [currency, { ...amounts, total,
      perAcceptedValidated: total !== null && acceptedValidated ? total / acceptedValidated : null }];
  }));
  return { observations: costs.length, durationMs: measured(costs.map(cost => cost.durationMs), costs.length + missingRuns),
    tokens: measured(costs.map(cost => cost.tokens), costs.length + missingRuns), byCurrency, unassignedCurrency: unassigned.length };
}

/** Summarize recorded observations; never infer authorization or effectiveness from token savings. */
export function summarizeOperationalMetrics(runs: ExperimentRun[]) {
  const decided = runs.filter(run => run.candidate !== null &&
    (run.promotionDecision === 'ALLOW' || run.promotionDecision === 'DENY'));
  const validDecided = decided.filter(run => run.oracle.verdict === 'VALID');
  const falseBlocks = validDecided.filter(run => run.promotionDecision === 'DENY');
  const promoted = runs.filter(run => run.candidate !== null && run.promoted);
  const violations = promoted.filter(run => run.oracle.verdict === 'INVALID');
  const acceptedValidated = runs.filter(run => run.candidate !== null && run.promoted &&
    run.promotionDecision === 'ALLOW' && run.validated && run.semanticStatus === 'CONFORMING');
  const indeterminate = runs.filter(run => run.oracle.verdict === 'INDETERMINATE' ||
    run.semanticStatus === 'INDETERMINATE' || run.status === 'MISSING_EVIDENCE' ||
    run.promotionDecision === 'REVALIDATION_REQUIRED');
  const costs = runs.flatMap(run => run.costs);
  const missingCostRuns = runs.filter(run => run.costs.length === 0);
  const missingCostDeclarations = runs.filter(run => run.expectedCostPhases === undefined);
  const missingPhases = runs.flatMap(run => (run.expectedCostPhases ?? []).filter(expected =>
    !run.costs.some(cost => cost.kind === expected.kind && cost.phase === expected.phase))
    .map(expected => ({ runId: run.runId, ...expected })));
  const statuses = ['ACCEPTED', 'DENIED', 'REFUSED', 'NO_CANDIDATE', 'TECHNICAL_FAILURE',
    'MISSING_EVIDENCE', 'TIMEOUT', 'ERROR', 'UNSUPPORTED'] as const;
  const allQueries = runs.flatMap(run => run.queries);
  const queries = Object.fromEntries(['STRUCTURED', 'SPARQL', 'SHACL_SPARQL'].map(mechanism => [mechanism,
    Object.fromEntries(['AGENT_CONTEXT', 'AUTHORIZATION_EVIDENCE'].map(purpose => {
      const observations = allQueries.filter(query => query.mechanism === mechanism && query.purpose === purpose);
      return [purpose, { count: observations.length,
        statuses: Object.fromEntries(queryStatuses.map(status => [status, observations.filter(query => query.status === status).length])),
        durationMs: measured(observations.map(query => query.durationMs)),
        tokens: measured(observations.map(query => query.tokens)) }];
    }))]));
  const byKind = Object.fromEntries(['DEPLOYMENT', 'RECURRING'].map(kind => [kind,
    { ...costSummary(costs.filter(cost => cost.kind === kind), acceptedValidated.length,
      missingCostDeclarations.length + missingPhases.filter(phase => phase.kind === kind).length),
      phases: Object.fromEntries(costPhases.map(phase => [phase,
        costSummary(costs.filter(cost => cost.kind === kind && cost.phase === phase), acceptedValidated.length,
          missingCostDeclarations.length + missingPhases.filter(expected => expected.kind === kind && expected.phase === phase).length)])) }]));
  const explanations = runs.map(run => ({ runId: run.runId, ...assessExplanation(run) }));
  const claims = explanations.reduce((sum, explanation) => sum + explanation.claims, 0);
  const verified = explanations.reduce((sum, explanation) => sum + explanation.verified, 0);
  const coverageByRun = runs.map(run => ({ runId: run.runId,
    rules: coverage(run.expectedRuleIds, run.evaluatedRuleIds),
    evidence: coverage(run.expectedEvidenceIds, run.evaluatedEvidenceIds) }));
  const instanceCoverage = (dimension: 'rules' | 'evidence') => {
    const expected = coverageByRun.reduce((sum, run) => sum + run[dimension].expected, 0);
    const covered = coverageByRun.reduce((sum, run) => sum + run[dimension].covered, 0);
    const evaluated = coverageByRun.reduce((sum, run) => sum + run[dimension].evaluated, 0);
    return { expected, covered, evaluated, ratio: expected ? covered / expected : null,
      missing: coverageByRun.flatMap(run => run[dimension].missing.map(id => ({ runId: run.runId, id }))),
      unexpected: coverageByRun.flatMap(run => run[dimension].unexpected.map(id => ({ runId: run.runId, id }))) };
  };
  return {
    runs: runs.length,
    statuses: Object.fromEntries(statuses.map(status => [status, runs.filter(run => run.status === status).length])),
    candidateCount: runs.filter(run => run.candidate !== null).length,
    falseBlocks: { count: validDecided.length ? falseBlocks.length : null,
      denominator: validDecided.length, ids: falseBlocks.map(run => run.runId),
      rate: validDecided.length ? falseBlocks.length / validDecided.length : null },
    violationsPromoted: { count: decided.length || promoted.length ? violations.length : null,
      denominator: promoted.filter(run => run.oracle.verdict !== 'INDETERMINATE').length,
      ids: violations.map(run => run.runId) },
    indetermination: { count: indeterminate.length, denominator: runs.length,
      rate: runs.length ? indeterminate.length / runs.length : null, ids: indeterminate.map(run => run.runId) },
    coverage: {
      rules: instanceCoverage('rules'), evidence: instanceCoverage('evidence'),
      uniqueRules: coverage(runs.flatMap(run => run.expectedRuleIds), runs.flatMap(run => run.evaluatedRuleIds)),
      uniqueEvidence: coverage(runs.flatMap(run => run.expectedEvidenceIds), runs.flatMap(run => run.evaluatedEvidenceIds)),
      byRun: coverageByRun,
    },
    explanation: { availableRuns: explanations.filter(explanation => explanation.available).length,
      missingRuns: explanations.filter(explanation => !explanation.available).length,
      claims, verified, correspondence: claims ? verified / claims : null, byRun: explanations },
    human: { reviewMs: measured(runs.map(run => run.humanReview?.reviewMs ?? null)),
      workMs: measured(runs.map(run => run.humanReview?.workMs ?? null)),
      observations: runs.map(run => ({ runId: run.runId, ...run.humanReview })) },
    costs: { acceptedValidated: acceptedValidated.length, byKind,
      missingRunMeasurements: missingCostRuns.map(run => run.runId),
      missingApplicabilityDeclarations: missingCostDeclarations.map(run => run.runId), missingPhases },
    queries,
    adequacy: 'NOT_ESTABLISHED_BY_TOKEN_OR_PROMOTION_REDUCTION' as const,
  };
}
