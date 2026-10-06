import { parentPort, workerData } from 'node:worker_threads';
import { Parser as SparqlParser } from '@traqula/parser-sparql-1-2';
import { Parser, Store } from 'n3';
import type { SparqlTerm, SparqlWorkerResult } from './sparql.js';

function rejectExternalSources(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (node.subType === 'service') throw new Error('SERVICE is not supported by the local query interface');
  if (node.type === 'datasetClauses' && Array.isArray(node.clauses) && node.clauses.length > 0) {
    throw new Error('FROM dataset sources are not supported; use the supplied local graph');
  }
  for (const item of Object.values(node)) {
    if (Array.isArray(item)) item.forEach(rejectExternalSources);
    else rejectExternalSources(item);
  }
}

async function run(): Promise<SparqlWorkerResult> {
  try {
    const { query, graphNQuads, maxResults } = workerData as { query: string; graphNQuads: string; maxResults: number };
    const ast = new SparqlParser().parse(query);
    if (ast.type !== 'query' || (ast.subType !== 'select' && ast.subType !== 'ask')) {
      throw new Error('Only read-only SELECT and ASK queries are supported');
    }
    rejectExternalSources(ast);
    const store = new Store(new Parser({ format: 'N-Quads' }).parse(graphNQuads));
    const { QueryEngine } = await import('@comunica/query-sparql-rdfjs-lite');
    const engine = new QueryEngine();
    if (ast.subType === 'ask') {
      return { status: 'SUCCESS', queryType: 'ASK', boolean: await engine.queryBoolean(query, { sources: [store] }), complete: true };
    }
    const stream = await engine.queryBindings(query, { sources: [store] });
    const bindings: Array<Record<string, SparqlTerm>> = [];
    for await (const binding of stream) {
      if (bindings.length === maxResults) {
        stream.destroy();
        return { status: 'LIMIT_EXCEEDED', queryType: 'SELECT', bindings, complete: false };
      }
      const row: Record<string, SparqlTerm> = {};
      for (const [variable, term] of binding) {
        row[variable.value] = {
          termType: term.termType, value: term.value,
          ...(term.termType === 'Literal' ? { language: term.language, datatype: term.datatype.value } : {}),
        };
      }
      bindings.push(row);
    }
    return { status: bindings.length === 0 ? 'EMPTY' : 'SUCCESS', queryType: 'SELECT', bindings, complete: true };
  } catch (error) {
    return { status: 'ERROR', error: error instanceof Error ? error.message : String(error), complete: false };
  }
}

if (parentPort) void run().then((result) => parentPort?.postMessage(result));
