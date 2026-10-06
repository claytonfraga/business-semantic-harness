import type { ExperimentRun, TransferObservation } from './types.js';

export interface PairedAnalysis {
  pairs: number;
  projects: number;
  tasks: number;
  meanDifference: number | null;
  standardizedEffect: number | null;
  confidenceInterval: [number, number] | null;
  method: 'HIERARCHICAL_PAIRED_PERCENTILE_BOOTSTRAP';
  seed: number;
  resamples: number;
  confidenceLevel: number;
  diagnostics: string[];
  strata: Array<{ domain: string; technology: string; model: string; failureStage: string | null; condition: string; runs: number }>;
}

function mean(values: number[]): number { return values.reduce((sum, item) => sum + item, 0) / values.length; }
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
}
function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/** Raw differences retain outcome units. Standardized effect is paired Cohen dz. */
export function analyzePairedRuns(
  runs: ExperimentRun[], baseline: string, comparison: string,
  measure: (run: ExperimentRun) => number | null,
  options: { seed?: number; resamples?: number; confidence?: number } = {},
): PairedAnalysis {
  const seed = options.seed ?? 1729;
  const resamples = options.resamples ?? 2000;
  const confidence = options.confidence ?? 0.95;
  if (baseline === comparison || !Number.isInteger(seed) || !Number.isInteger(resamples) || resamples < 100 ||
      !Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
    throw new Error('Invalid paired analysis configuration');
  }
  const grouped = new Map<string, ExperimentRun[]>();
  const strata = new Map<string, PairedAnalysis['strata'][number]>();
  for (const run of runs) {
    const key = JSON.stringify([run.projectId, run.controls.taskId, run.track, run.replicateId ?? 'single']);
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
    const stratum = { domain: run.domain, technology: run.technology, model: run.controls.model,
      failureStage: run.failureStage, condition: run.condition.id, runs: 0 };
    const stratumKey = JSON.stringify(stratum);
    const stored = strata.get(stratumKey) ?? stratum;
    stored.runs++;
    strata.set(stratumKey, stored);
  }
  const diagnostics: string[] = [];
  const projects = new Map<string, Map<string, number[]>>();
  for (const [key, group] of grouped) {
    const left = group.filter((run) => run.condition.id === baseline);
    const right = group.filter((run) => run.condition.id === comparison);
    if (!left.length && !right.length) continue;
    if (left.length !== 1 || right.length !== 1) { diagnostics.push(`Incomplete or ambiguous pair: ${key}`); continue; }
    const a = left[0]; const b = right[0];
    if (stable(a.controls) !== stable(b.controls) || a.track !== b.track || a.domain !== b.domain || a.technology !== b.technology) {
      diagnostics.push(`Divergent controls: ${key}`); continue;
    }
    if (a.track === 'FIXED_CANDIDATE' && (a.candidate?.contentHash !== b.candidate?.contentHash ||
      (a.condition.policyHash !== b.condition.policyHash && (!a.factsHash || a.factsHash !== b.factsHash)))) {
      diagnostics.push(`Non-equivalent candidate or policy facts: ${key}`); continue;
    }
    const contextQueries = [a, b].map((run) => run.queries.find((query) => query.purpose === 'AGENT_CONTEXT'));
    if (contextQueries[0] && contextQueries[1] && contextQueries[0].mechanism !== contextQueries[1].mechanism &&
      contextQueries[0].sourceHash !== contextQueries[1].sourceHash) {
      diagnostics.push(`Different query source snapshots: ${key}`); continue;
    }
    const av = measure(a); const bv = measure(b);
    if (av === null || bv === null || !Number.isFinite(av) || !Number.isFinite(bv)) {
      diagnostics.push(`Unavailable measurement: ${key}`); continue;
    }
    const tasks = projects.get(a.projectId) ?? new Map<string, number[]>();
    tasks.set(a.controls.taskId, [...(tasks.get(a.controls.taskId) ?? []), bv - av]);
    projects.set(a.projectId, tasks);
  }
  const differences = [...projects.values()].flatMap((tasks) => [...tasks.values()].flat());
  const tasks = [...projects.values()].reduce((sum, item) => sum + item.size, 0);
  const average = differences.length ? mean(differences) : null;
  const deviation = differences.length > 1 ? Math.sqrt(differences.reduce((sum, value) => sum + (value - (average ?? 0)) ** 2, 0) / (differences.length - 1)) : 0;
  let confidenceInterval: [number, number] | null = null;
  if (projects.size >= 2 && tasks >= 2 && differences.length >= 2) {
    let state = seed >>> 0;
    const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const projectItems = [...projects.values()];
    const distribution: number[] = [];
    for (let index = 0; index < resamples; index++) {
      const sample: number[] = [];
      for (let projectIndex = 0; projectIndex < projectItems.length; projectIndex++) {
        const taskItems = [...pick(projectItems).values()];
        for (let taskIndex = 0; taskIndex < taskItems.length; taskIndex++) {
          const pairedItems = pick(taskItems);
          for (let pairIndex = 0; pairIndex < pairedItems.length; pairIndex++) sample.push(pick(pairedItems));
        }
      }
      distribution.push(mean(sample));
    }
    distribution.sort((a, b) => a - b);
    confidenceInterval = [quantile(distribution, (1 - confidence) / 2), quantile(distribution, 1 - (1 - confidence) / 2)];
    if (projects.size < 10) diagnostics.push('Few project clusters: confidence interval is exploratory; generalization is limited');
  } else diagnostics.push('Insufficient independent project/task clusters for a confidence interval');
  return { pairs: differences.length, projects: projects.size, tasks, meanDifference: average,
    standardizedEffect: deviation > 0 && average !== null ? average / deviation : null,
    confidenceInterval, method: 'HIERARCHICAL_PAIRED_PERCENTILE_BOOTSTRAP', seed, resamples, confidenceLevel: confidence,
    diagnostics, strata: [...strata.values()] };
}

export function summarizeTransfer(records: TransferObservation[]) {
  for (const record of records) {
    if (!record.sourceProject || !record.targetProject || !record.description) throw new Error('Incomplete transfer identity');
    for (const value of [record.adaptationMs, record.reviewMs, record.humanWorkMs]) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error('Transfer effort must be finite and nonnegative');
    }
    if (record.reusedArtifacts.some((asset) => !asset.id || !asset.source || !/^[a-f0-9]{64}$/.test(asset.sha256)) ||
      record.adaptedArtifacts.some((asset) => !asset.id || !/^[a-f0-9]{64}$/.test(asset.beforeHash) || !/^[a-f0-9]{64}$/.test(asset.afterHash))) {
      throw new Error('Transfer knowledge identity is unverifiable');
    }
  }
  const sumKnown = (field: 'adaptationMs' | 'reviewMs' | 'humanWorkMs') => ({
    measured: records.filter((record) => record[field] !== null).length,
    missing: records.filter((record) => record[field] === null).length,
    measuredSubtotalMs: records.some((record) => record[field] !== null)
      ? records.reduce((sum, record) => sum + (record[field] ?? 0), 0) : null,
    totalMs: records.length > 0 && records.every((record) => record[field] !== null)
      ? records.reduce((sum, record) => sum + (record[field] ?? 0), 0) : null,
  });
  return { transfers: records.length, reusedArtifacts: records.flatMap((record) => record.reusedArtifacts),
    adaptedArtifacts: records.flatMap((record) => record.adaptedArtifacts), adaptation: sumKnown('adaptationMs'),
    review: sumKnown('reviewMs'), humanWork: sumKnown('humanWorkMs'), costs: records.flatMap((record) => record.costs),
    limitations: ['Artifact identity records reuse; it does not prove the destination project is configured or authorize domain copying'] };
}
