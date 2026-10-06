import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import type { GovernanceDecision } from '../enforcement/governanceDecision.js';
import { queryOntology, createOntologySnapshot, assertOntologySnapshot } from '../ontology/query.js';
import { readFile } from 'node:fs/promises';
import { resolveProjectFile } from '../project/paths.js';
import { loadManifest } from '../project/manifest.js';
import { parseOntology, parseShapes } from '../ontology/rdf.js';
import { executeLocalSparql } from '../ontology/sparql.js';
import type { Quad } from 'n3';
import type { Quad as RdfQuad } from '@rdfjs/types';
import { contentHash, captureExperimentRun } from './replay.js';
import type { ContentArtifact, CostObservation, ExperimentControls, ExperimentRun, ProductComparison, QueryObservation } from './types.js';

export interface SelectedContext { text: string; artifacts: ContentArtifact[]; queries: QueryObservation[] }
export interface CandidateEvaluation {
  decision: GovernanceDecision;
  artifacts: ContentArtifact[];
  costs: CostObservation[];
}
export interface ExperimentStages {
  selectContext: (run: ExperimentRun) => Promise<SelectedContext>;
  generate?: (input: { controls: ExperimentControls; context: string; signal: AbortSignal }) => Promise<{
    candidate: ExperimentRun['candidate']; artifacts: ContentArtifact[];
    outcome: 'COMPLETED' | 'REFUSED' | 'TECHNICAL_FAILURE' | 'TIMEOUT'; costs: CostObservation[];
  }>;
  evaluate: (candidate: NonNullable<ExperimentRun['candidate']>) => Promise<CandidateEvaluation>;
  technicalGates: (candidate: NonNullable<ExperimentRun['candidate']>, gates: readonly string[]) => Promise<{
    ok: boolean; record: unknown; costs: CostObservation[];
  }>;
}

/** Reject confounded comparisons before running either condition. */
export function assertControlledComparison(left: ExperimentRun, right: ExperimentRun): void {
  if (left.projectId !== right.projectId || left.domain !== right.domain || left.technology !== right.technology ||
    left.track !== right.track || !isDeepStrictEqual(left.controls, right.controls)) {
    throw new Error('Comparison requires equivalent project, task, agent, model, base, budget and technical gates');
  }
  if (left.track === 'FIXED_CANDIDATE' && (!left.candidate || !right.candidate ||
    left.candidate.contentHash !== right.candidate.contentHash)) throw new Error('Fixed candidates must be identical');
  if (left.condition.policyHash !== right.condition.policyHash && left.track === 'FIXED_CANDIDATE' &&
    (!left.factsHash || left.factsHash !== right.factsHash)) throw new Error('Alternative policies require equivalent extracted facts');
  const contextQueries = [left, right].map(run => run.queries.find(query => query.purpose === 'AGENT_CONTEXT'));
  if (contextQueries[0] && contextQueries[1] && contextQueries[0].mechanism !== contextQueries[1].mechanism &&
    contextQueries[0].sourceHash !== contextQueries[1].sourceHash) {
    throw new Error('Query mechanism comparisons require the same source snapshot');
  }
}

export function compareGovernedProducts(left: ProductComparison, right: ProductComparison) {
  for (const product of [left, right]) if (!product.evidenceReference || !product.governedObject || !product.executionPoints.length) {
    throw new Error('Product comparison requires governed object, execution points and evidence');
  }
  const comparable = left.governedObject === right.governedObject &&
    isDeepStrictEqual([...left.executionPoints].sort(), [...right.executionPoints].sort());
  return { comparable, products: [left, right], limitations: comparable
    ? ['Comparable scope does not establish efficacy; measure oracle outcomes and operational costs']
    : ['Different governed objects or execution points: superiority cannot be inferred'] };
}

const artifact = (id: string, role: ContentArtifact['role'], content: string, source: string): ContentArtifact =>
  ({ id, role, content, source, sha256: contentHash(content) });

export function createContextSelector(options: {
  projectRoot: string; domain: string; textRules: string;
  sparql?: { query: string; quads?: Iterable<Quad>; timeoutMs?: number; maxResults?: number };
}): ExperimentStages['selectContext'] {
  return async run => {
    if (run.condition.context === 'NONE') return { text: '', artifacts: [], queries: [] };
    if (run.condition.context === 'TEXT_RULES') return { text: options.textRules,
      artifacts: [artifact('text-rules', 'CONTEXT', options.textRules, 'declared-text-rules')], queries: [] };
    const start = performance.now();
    if (run.condition.context === 'STRUCTURED_QUERY') {
      const snapshot = await createOntologySnapshot(options.projectRoot);
      const result = await queryOntology(options.projectRoot, options.domain);
      const inputs = await Promise.all(snapshot.files.map(async path => artifact(`context-input:${path}`, 'CONTEXT',
        await readFile(await resolveProjectFile(options.projectRoot, `.bsh/${path}`), 'utf8'), `.bsh/${path}`)));
      const sourceContent = inputs.map((input, index) => `${snapshot.files[index]}\0${Buffer.byteLength(input.content)}\0${input.content}`).join('');
      inputs.push(artifact('ontology-snapshot-source', 'CONTEXT', sourceContent, 'project://ontology-snapshot'));
      await assertOntologySnapshot(options.projectRoot, snapshot);
      const content = JSON.stringify(result);
      return { text: content, artifacts: [...inputs, artifact('structured-context', 'CONTEXT', content, result.source)],
        queries: [{ id: 'context-query', mechanism: 'STRUCTURED', purpose: 'AGENT_CONTEXT',
          query: JSON.stringify({ domain: options.domain }), sourceHash: snapshot.digest, result,
          status: result.entries.length ? 'SUCCESS' : 'EMPTY', durationMs: performance.now() - start, tokens: null }] };
    }
    if (!options.sparql) return { text: '', artifacts: [], queries: [{ id: 'context-query', mechanism: 'SPARQL',
      purpose: 'AGENT_CONTEXT', query: '', sourceHash: '', result: null, status: 'UNSUPPORTED', durationMs: null, tokens: null }] };
    let quads = options.sparql.quads;
    let sourceHash: string | undefined;
    const inputArtifacts: ContentArtifact[] = [];
    if (!quads) {
      const snapshot = await createOntologySnapshot(options.projectRoot);
      const manifest = await loadManifest(options.projectRoot);
      const domain = manifest.domains.find(domain => domain.id === options.domain);
      if (!domain) throw new Error('SPARQL context requires a declared project domain');
      const ontology = await readFile(await resolveProjectFile(options.projectRoot, `.bsh/${domain.ontology}`), 'utf8');
      const shapes = await readFile(await resolveProjectFile(options.projectRoot, `.bsh/${domain.shapes}`), 'utf8');
      const graph = await parseOntology(ontology);
      const shapeGraph = parseShapes(shapes);
      // Preserve separate blank-node scopes when combining independently parsed documents.
      const { DataFactory } = await import('n3');
      const scope = <T extends RdfQuad['subject'] | RdfQuad['object']>(term: T, prefix: string) => term.termType === 'BlankNode' ? DataFactory.blankNode(`${prefix}${term.value}`) : term;
      quads = [...graph].map(q => DataFactory.quad(scope(q.subject, 'ontology_'), q.predicate, scope(q.object, 'ontology_'), q.graph));
      quads = [...quads, ...[...shapeGraph].map(q => DataFactory.quad(scope(q.subject, 'shape_'), q.predicate, scope(q.object, 'shape_'), q.graph))];
      for (const path of snapshot.files) inputArtifacts.push(artifact(`context-input:${path}`, 'CONTEXT',
        await readFile(await resolveProjectFile(options.projectRoot, `.bsh/${path}`), 'utf8'), `.bsh/${path}`));
      const sourceContent = inputArtifacts.map((input, index) => `${snapshot.files[index]}\0${Buffer.byteLength(input.content)}\0${input.content}`).join('');
      inputArtifacts.push(artifact('ontology-snapshot-source', 'CONTEXT', sourceContent, 'project://ontology-snapshot'));
      await assertOntologySnapshot(options.projectRoot, snapshot);
      sourceHash = snapshot.digest;
    }
    const result = await executeLocalSparql({ ...options.sparql, quads });
    return { text: result.status === 'SUCCESS' ? JSON.stringify(result) : '',
      artifacts: [...inputArtifacts, artifact('sparql-source', 'CONTEXT', result.graphNQuads, 'local-rdf-dataset'),
        artifact('sparql-result', 'QUERY_RESULT', JSON.stringify(result), 'local-sparql-engine')],
      queries: [{ id: 'context-query', mechanism: 'SPARQL', purpose: 'AGENT_CONTEXT', query: options.sparql.query,
        sourceHash: sourceHash ?? contentHash(result.graphNQuads), result, status: result.status, durationMs: result.durationMs, tokens: null }] };
  };
}

/** Context is supplied only to generation; authorization always extracts independent candidate evidence. */
export async function executeControlledRun(seed: ExperimentRun, stages: ExperimentStages): Promise<ExperimentRun> {
  const run = structuredClone(seed);
  run.promoted = false;
  run.promotionDecision = 'NOT_ATTEMPTED';
  run.validated = false;
  run.semanticStatus = null;
  run.failureStage = null;
  run.factsHash = null;
  run.adapterIds = [];
  run.evaluatedRuleIds = [];
  run.evaluatedEvidenceIds = [];
  run.queries = [];
  run.decisionRecords = [];
  run.explanation = null;
  run.costs = run.costs.filter(cost => cost.kind === 'DEPLOYMENT' || cost.phase === 'PACKAGE_MAINTENANCE');
  if (run.track === 'AGENT_GENERATION') run.candidate = null;
  delete run.governanceDecision;
  if (run.controls.budget.maxTokens <= 0 || run.controls.budget.maxTurns <= 0 || run.controls.budget.timeoutMs <= 0) {
    throw new Error('A positive token, turn and time budget is required');
  }
  run.limitations.push('This experiment observes acceptance decisions; it does not integrate commits or establish empirical adequacy');
  try {
    const context = await stages.selectContext(run);
    run.artifacts.push(...context.artifacts);
    run.queries.push(...context.queries);
    for (const query of context.queries) run.costs.push({ phase: 'QUERY', kind: 'RECURRING',
      durationMs: query.durationMs, tokens: query.tokens, amount: null, currency: null });
    const queryFailure = context.queries.find(query => ['ERROR', 'TIMEOUT', 'LIMIT_EXCEEDED', 'UNSUPPORTED'].includes(query.status));
    if (queryFailure) {
      run.status = queryFailure.status === 'TIMEOUT' ? 'TIMEOUT' : queryFailure.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'ERROR';
      run.failureStage = 'CONTEXT_QUERY';
      return run;
    }
    if (run.track === 'AGENT_GENERATION') {
      run.failureStage = 'GENERATION';
      if (!stages.generate) throw new Error('Agent generation adapter is required');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let generated: Awaited<ReturnType<NonNullable<ExperimentStages['generate']>>>;
      try {
        generated = await Promise.race([stages.generate({ controls: run.controls, context: context.text, signal: controller.signal }),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new Error('EXPERIMENT_GENERATION_TIMEOUT'));
          }, run.controls.budget.timeoutMs); })]);
      } finally { clearTimeout(timer); }
      run.candidate = generated.candidate;
      run.artifacts.push(...generated.artifacts);
      run.costs.push(...generated.costs);
      if (generated.outcome !== 'COMPLETED') {
        run.status = generated.outcome;
        run.failureStage = 'GENERATION';
        return run;
      }
    }
    if (!run.candidate) { run.status = 'NO_CANDIDATE'; run.failureStage = 'GENERATION'; return run; }
    const candidate = run.candidate;
    run.failureStage = 'CANDIDATE_EVALUATION';
    const evaluated = await stages.evaluate(candidate);
    const decision = evaluated.decision;
    run.governanceDecision = decision;
    run.artifacts.push(...evaluated.artifacts);
    run.costs.push(...evaluated.costs);
    run.factsHash = decision.candidateGraphHash;
    run.semanticStatus = decision.validationStatus;
    run.validated = decision.validationExecuted && decision.validationComplete;
    run.failureStage = decision.failureStage;
    run.expectedRuleIds = decision.ruleCoverage.totalRules;
    run.evaluatedRuleIds = decision.ruleCoverage.appliedRules;
    run.expectedEvidenceIds = decision.evidenceSufficiency.details.flatMap(detail => detail.requiredEvidenceTypes.map(type => `${detail.ruleId}:${type}`));
    run.evaluatedEvidenceIds = decision.evidenceSufficiency.details.flatMap(detail => detail.providedEvidenceTypes.map(type => `${detail.ruleId}:${type}`));
    run.adapterIds = decision.adaptersUsed.map(adapter => ({ id: adapter.id, version: adapter.version,
      sha256: contentHash(JSON.stringify(adapter)) }));
    run.decisionRecords.push({ id: 'semantic-decision', references: [candidate.id], record: decision });
    if (run.condition.enforcement) {
      run.promotionDecision = decision.promotionDecision;
      if (decision.promotionDecision !== 'ALLOW') {
        run.status = decision.validationStatus === 'VALIDATION_ERROR' ? 'ERROR' :
          decision.failureStage === 'FACT_EXTRACTION' ? 'MISSING_EVIDENCE' : 'DENIED';
        return run;
      }
    }
    run.failureStage = 'TECHNICAL_GATES';
    const gates = await stages.technicalGates(candidate, run.controls.technicalGates);
    run.costs.push(...gates.costs);
    run.decisionRecords.push({ id: 'technical-gates', references: [candidate.id], record: gates.record });
    if (!gates.ok) { run.status = 'TECHNICAL_FAILURE'; run.failureStage = 'TECHNICAL_GATES';
      run.promotionDecision = 'DENY'; return run; }
    run.status = 'ACCEPTED';
    run.failureStage = null;
    run.promotionDecision = 'ALLOW';
    return run;
  } catch (error) {
    run.promotionDecision = 'NOT_ATTEMPTED';
    run.status = error instanceof Error && error.message === 'EXPERIMENT_GENERATION_TIMEOUT' ? 'TIMEOUT' : 'ERROR';
    run.failureStage ??= run.status === 'TIMEOUT' ? 'GENERATION' : 'EXPERIMENT';
    run.decisionRecords.push({ id: 'experiment-error', references: [], record: { error: error instanceof Error ? error.message : String(error) } });
    return run;
  }
}

export async function executeAndCaptureRun(projectRoot: string, seed: ExperimentRun, stages: ExperimentStages) {
  const run = await executeControlledRun(seed, stages);
  const snapshot = await captureExperimentRun(projectRoot, run);
  return { run, snapshot };
}

/** Run a matched block sequentially, then verify actual fact/source equivalence. */
export async function executeControlledBatch(entries: Array<{ seed: ExperimentRun; stages: ExperimentStages }>) {
  if (!entries.length) throw new Error('Controlled batch requires at least one condition');
  const reference = entries[0].seed;
  const conditionIds = new Set<string>();
  for (const { seed } of entries) {
    if (conditionIds.has(seed.condition.id)) throw new Error('Duplicate condition in a matched experimental block');
    conditionIds.add(seed.condition.id);
    if (!isDeepStrictEqual(reference.controls, seed.controls) || reference.projectId !== seed.projectId ||
      reference.domain !== seed.domain || reference.technology !== seed.technology || reference.track !== seed.track) {
      throw new Error('Controlled batch requires equivalent controls before execution');
    }
    if (seed.track === 'FIXED_CANDIDATE' && reference.candidate?.contentHash !== seed.candidate?.contentHash) {
      throw new Error('Fixed candidates must be identical before execution');
    }
  }
  const runs: ExperimentRun[] = [];
  for (const entry of entries) runs.push(await executeControlledRun(entry.seed, entry.stages));
  const diagnostics: string[] = [];
  for (const run of runs.slice(1)) {
    try { assertControlledComparison(runs[0], run); }
    catch (error) { diagnostics.push(`${run.runId}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { runs, comparable: diagnostics.length === 0, diagnostics };
}
