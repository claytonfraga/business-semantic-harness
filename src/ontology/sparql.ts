import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { Writer, type Quad } from 'n3';

export type SparqlQueryStatus = 'SUCCESS' | 'EMPTY' | 'ERROR' | 'TIMEOUT' | 'LIMIT_EXCEEDED';

export interface SparqlTerm {
  termType: string;
  value: string;
  language?: string;
  datatype?: string;
}

export interface SparqlQueryRequest {
  query: string;
  quads: Iterable<Quad>;
  timeoutMs?: number;
  maxResults?: number;
}

export interface SparqlQueryOutcome {
  status: SparqlQueryStatus;
  query: string;
  graphId: string;
  graphNQuads: string;
  queryType?: 'SELECT' | 'ASK';
  bindings?: Array<Record<string, SparqlTerm>>;
  boolean?: boolean;
  error?: string;
  durationMs: number;
  timeoutMs: number;
  maxResults: number;
  complete: boolean;
  engine: '@comunica/query-sparql-rdfjs-lite@5.4.1';
}

export type SparqlWorkerResult = Pick<SparqlQueryOutcome, 'status' | 'queryType' | 'bindings' | 'boolean' | 'error' | 'complete'>;

/** Evaluate explicit local triples only. A result is query evidence, never authorization. */
export async function executeLocalSparql(request: SparqlQueryRequest): Promise<SparqlQueryOutcome> {
  const started = performance.now();
  const writer = new Writer({ format: 'N-Quads' });
  // RDF datasets are sets. Identity is byte reproducibility, not blank-node canonical equivalence.
  const graphNQuads = [...new Set([...request.quads].map((quad) => writer.quadToString(quad.subject, quad.predicate, quad.object, quad.graph)))].sort().join('');
  const graphId = `sha256:${createHash('sha256').update(graphNQuads).digest('hex')}`;
  const timeoutMs = request.timeoutMs ?? 30_000;
  const maxResults = request.maxResults ?? 1_000;
  const finish = (result: SparqlWorkerResult): SparqlQueryOutcome => ({
    ...result, query: request.query, graphId, graphNQuads, timeoutMs, maxResults,
    durationMs: performance.now() - started, engine: '@comunica/query-sparql-rdfjs-lite@5.4.1',
  });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 100_000) {
    return finish({ status: 'ERROR', error: 'Invalid query timeout or result limit', complete: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sparqlWorker.js', import.meta.url), {
        workerData: { query: request.query, graphNQuads, maxResults },
      });
    } catch (error) {
      resolve(finish({ status: 'ERROR', error: error instanceof Error ? error.message : String(error), complete: false }));
      return;
    }
    const settle = (result: SparqlWorkerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Await termination before returning: a timeout never leaves query CPU work running.
      void worker.terminate().then(() => resolve(finish(result)), () => resolve(finish(result)));
    };
    const timer = setTimeout(() => settle({ status: 'TIMEOUT', error: 'Local SPARQL execution exceeded its wall-clock limit', complete: false }), timeoutMs);
    worker.once('message', (result: SparqlWorkerResult) => settle(result));
    worker.once('error', (error: Error) => settle({ status: 'ERROR', error: error.message, complete: false }));
    worker.once('exit', (code: number) => {
      if (!settled) settle({ status: 'ERROR', error: `SPARQL worker exited without a result (${code})`, complete: false });
    });
  });
}
