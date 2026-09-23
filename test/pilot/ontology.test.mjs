import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseShapes } from '../../dist/ontology/rdf.js';
import { validateData } from '../../dist/ontology/validate.js';

const pilot = new URL('../../pilot/asset-management/', import.meta.url);
async function graph(path) { return parseShapes(await readFile(new URL(path, pilot), 'utf8')); }

test('Given the pilot transfer shape, when a valid transfer graph is checked, then it conforms', async () => {
  const report = await validateData(await graph('.oracle/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-valid.ttl'));
  assert.equal(report.conforms, true);
});

test('Given a retired asset, when its transfer graph is checked, then SHACL rejects its state', async () => {
  const report = await validateData(await graph('.oracle/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-retired.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('baixado')));
});

test('Given no new responsible, when a transfer graph is checked, then SHACL reports the missing fact', async () => {
  const report = await validateData(await graph('.oracle/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-no-responsible.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});
