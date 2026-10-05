// Requirements: BSH-EXP-004, BSH-EXP-SPARQL-001. Real Comunica engine; no mocks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Parser } from 'n3';
import { executeLocalSparql } from '../../dist/ontology/sparql.js';

const graph = () => new Parser().parse(`
  @prefix ex: <urn:qa:> .
  ex:a ex:next ex:b ; ex:name "Ada"@en ; ex:score 7 .
  ex:b ex:next ex:c ; ex:score 3 .
  ex:c ex:score 12 .
`);
const run = (query, options = {}) => executeLocalSparql({ query, quads: graph(), ...options });

test('Given equivalent local facts, When SELECT joins and filters a property path, Then typed results and replay inputs identify actual answers', async () => {
  const query = 'SELECT ?target ?score WHERE { <urn:qa:a> <urn:qa:next>+ ?target . ?target <urn:qa:score> ?score FILTER (?score > 5) }';
  const result = await run(query);
  assert.equal(result.status, 'SUCCESS', result.error);
  assert.equal(result.complete, true);
  assert.equal(result.queryType, 'SELECT');
  assert.equal(result.query, query);
  assert.match(result.graphId, /^sha256:[0-9a-f]{64}$/);
  assert.ok(result.graphNQuads.includes('<urn:qa:c>'));
  assert.deepEqual(result.bindings, [{ target: { termType: 'NamedNode', value: 'urn:qa:c' }, score: { termType: 'Literal', value: '12', language: '', datatype: 'http://www.w3.org/2001/XMLSchema#integer' } }]);
  const replay = await executeLocalSparql({ query, quads: new Parser({ format: 'N-Quads' }).parse(result.graphNQuads) });
  assert.equal(replay.graphId, result.graphId);
  assert.deepEqual(replay.bindings, result.bindings);
  assert.ok(result.durationMs > 0);
});

test('Given no matching triples, When SELECT and ASK execute, Then empty bindings and false answers remain distinct from errors and authorization', async () => {
  const empty = await run('SELECT ?s WHERE { ?s <urn:qa:absent> ?o }');
  assert.equal(empty.status, 'EMPTY');
  assert.deepEqual(empty.bindings, []);
  assert.equal(empty.complete, true);
  const negative = await run('ASK { ?s <urn:qa:absent> ?o }');
  assert.equal(negative.status, 'SUCCESS');
  assert.equal(negative.boolean, false);
  assert.equal(negative.queryType, 'ASK');
  assert.equal(Object.hasOwn(negative, 'authorized'), false);
  const positive = await run('ASK { <urn:qa:a> <urn:qa:next> <urn:qa:b> }');
  assert.equal(positive.boolean, true);
});

test('Given more answers than the operational bound, When SELECT executes, Then truncated evidence has an explicit incomplete limit outcome', async () => {
  const result = await run('SELECT ?s WHERE { ?s <urn:qa:score> ?score } ORDER BY ?s', { maxResults: 2 });
  assert.equal(result.status, 'LIMIT_EXCEEDED');
  assert.equal(result.complete, false);
  assert.equal(result.bindings.length, 2);
  const exact = await run('SELECT ?s WHERE { ?s <urn:qa:score> ?score } LIMIT 2', { maxResults: 2 });
  assert.equal(exact.status, 'SUCCESS');
  assert.equal(exact.complete, true);
});

test('Given malformed syntax, When parsing runs, Then a recoverable ERROR cannot become an empty successful answer', async () => {
  const query = 'SELECT WHERE {';
  const result = await run(query);
  assert.equal(result.status, 'ERROR');
  assert.equal(result.query, query);
  assert.ok(result.error);
  assert.equal(result.complete, false);
  assert.equal(result.bindings, undefined);
});

test('Given updates or remote source constructs including nested SERVICE, When the local adapter runs, Then AST policy rejects them without mutating the snapshot', async () => {
  const queries = [
    'DELETE WHERE { ?s ?p ?o }',
    'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    'SELECT * WHERE { SERVICE <http://127.0.0.1:9/> { ?s ?p ?o } }',
    'ASK { { SELECT * WHERE { SERVICE SILENT <http://127.0.0.1:9/> { ?s ?p ?o } } } }',
    'SELECT * FROM <http://127.0.0.1:9/> WHERE { ?s ?p ?o }',
  ];
  const before = graph();
  for (const query of queries) {
    const result = await executeLocalSparql({ query, quads: before });
    assert.equal(result.status, 'ERROR', query);
    assert.match(result.error, /Only read-only|SERVICE|FROM/);
    assert.equal(result.complete, false);
  }
  assert.deepEqual(before, graph());
});

test('Given a string containing SERVICE and FROM, When SELECT runs, Then literal data is not mistaken for a remote operator', async () => {
  const result = await run('SELECT ("SERVICE FROM" AS ?text) WHERE {}');
  assert.equal(result.status, 'SUCCESS', result.error);
  assert.equal(result.bindings[0].text.value, 'SERVICE FROM');
});

test('Given a strict deadline, When a real worker cannot complete, Then execution terminates with TIMEOUT and the next query still runs', async () => {
  const result = await run('SELECT * WHERE { ?s ?p ?o }', { timeoutMs: 1 });
  assert.equal(result.status, 'TIMEOUT');
  assert.equal(result.complete, false);
  assert.equal(result.bindings, undefined);
  assert.ok(result.durationMs < 2_000);
  const next = await run('ASK { <urn:qa:a> <urn:qa:next> <urn:qa:b> }');
  assert.equal(next.boolean, true, next.error);
});

test('Given reordered or duplicated triples and invalid bounds, When execution is requested, Then graph set identity is stable and invalid configuration is explicit', async () => {
  const quads = graph();
  const first = await executeLocalSparql({ query: 'ASK {}', quads, timeoutMs: 0 });
  const reordered = await executeLocalSparql({ query: 'ASK {}', quads: [...quads].reverse().concat(quads[0]), maxResults: -1 });
  assert.equal(first.graphId, reordered.graphId);
  assert.equal(first.status, 'ERROR');
  assert.equal(reordered.status, 'ERROR');
  assert.match(first.error, /Invalid query/);
});
