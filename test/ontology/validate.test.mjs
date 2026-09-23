import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateProject, validateData } from '../../dist/ontology/validate.js';
import { parseShapes } from '../../dist/ontology/rdf.js';

const fixture = new URL('../fixtures/ativos/', import.meta.url);
async function project(ids = ['ativos']) {
  const root = await mkdtemp(join(tmpdir(), 'oracle-validate-'));
  await mkdir(join(root, '.oracle'), { recursive: true });
  const domains = [];
  for (const id of ids) {
    const dir = join(root, '.oracle', 'domains', id);
    await mkdir(dir, { recursive: true });
    await copyFile(new URL('ontology.jsonld', fixture), join(dir, 'ontology.jsonld'));
    await copyFile(new URL('shapes.ttl', fixture), join(dir, 'shapes.ttl'));
    domains.push({ id, version: '1.0.0', baseIri: 'urn:pilot:ativos:', ontology: `domains/${id}/ontology.jsonld`, shapes: `domains/${id}/shapes.ttl` });
  }
  await writeFile(join(root, '.oracle', 'project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'pilot', domains }));
  return root;
}

test('complete project with distinct domains is ready', async () => {
  const root = await project(['ativos', 'contratos']);
  try {
    const second = join(root, '.oracle/domains/contratos/ontology.jsonld');
    await writeFile(second, (await readFile(second, 'utf8')).replaceAll('urn:pilot:ativos:', 'urn:pilot:contratos:'));
    const shape = join(root, '.oracle/domains/contratos/shapes.ttl');
    await writeFile(shape, (await readFile(shape, 'utf8')).replaceAll('urn:pilot:ativos:', 'urn:pilot:contratos:'));
    const manifestPath = join(root, '.oracle/project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.domains[1].baseIri = 'urn:pilot:contratos:';
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await validateProject(root);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.ready, true, JSON.stringify(result.issues));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('reports a missing domain file with domain and path', async () => {
  const root = await project();
  try {
    await rm(join(root, '.oracle/domains/ativos/shapes.ttl'));
    const result = await validateProject(root);
    assert.equal(result.ready, false);
    assert.ok(result.issues.some(issue => issue.domain === 'ativos' && issue.file.endsWith('shapes.ttl')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('draft without concept and active shape is not ready', async () => {
  const root = await project();
  try {
    const file = join(root, '.oracle/domains/ativos/ontology.jsonld');
    await writeFile(file, JSON.stringify({ '@context': { oracle: 'urn:oracle:ns:v1:' }, '@graph': [{ '@id': 'urn:draft:ontology', '@type': 'oracle:Domain', 'oracle:version': '1.0.0' }] }));
    await writeFile(join(root, '.oracle/domains/ativos/shapes.ttl'), '@prefix sh: <http://www.w3.org/ns/shacl#> .');
    const result = await validateProject(root);
    assert.equal(result.ready, false);
    assert.ok(result.issues.some(issue => issue.rule === 'business-concept'));
    assert.ok(result.issues.some(issue => issue.rule === 'active-shape'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('incompatible IRI definitions identify both domain files', async () => {
  const root = await project(['ativos', 'contratos']);
  try {
    const file = join(root, '.oracle/domains/contratos/ontology.jsonld');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"Ativo"', '"Ativo divergente"'));
    const result = await validateProject(root);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some(issue => issue.rule === 'duplicate-iri' && issue.message.includes('ativos') && issue.message.includes('contratos')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('future ontology format version is rejected without rewrite', async () => {
  const root = await project();
  try {
    const file = join(root, '.oracle/domains/ativos/ontology.jsonld');
    const source = (await readFile(file, 'utf8')).replace('"oracle:version": "1.0.0"', '"oracle:version": "99.0.0"');
    await writeFile(file, source);
    const result = await validateProject(root);
    assert.equal(result.ready, false);
    assert.ok(result.issues.some(issue => issue.rule === 'ontology-version'));
    assert.equal(await readFile(file, 'utf8'), source);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('SHACL reports violating action and accepts conforming action', async () => {
  const shapes = parseShapes(await readFile(new URL('shapes.ttl', fixture), 'utf8'));
  const good = parseShapes(await readFile(new URL('valid-action.ttl', fixture), 'utf8'));
  const bad = parseShapes(await readFile(new URL('invalid-action.ttl', fixture), 'utf8'));
  assert.equal((await validateData(shapes, good)).conforms, true);
  const result = await validateData(shapes, bad);
  assert.equal(result.conforms, false);
  assert.ok(result.results.some(item => item.focusNode.includes('transferencia-1') && item.shape && item.severity));
});
