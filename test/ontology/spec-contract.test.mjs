import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { parseOntology } from '../../dist/ontology/rdf.js';
import { validateProject } from '../../dist/ontology/validate.js';
import { assertOntologySnapshot, createOntologySnapshot, queryOntology } from '../../dist/ontology/query.js';

const source = new URL('../fixtures/ativos/', import.meta.url);
const cli = resolve('dist/cli.js');

async function fixtureProject() {
  const root = await mkdtemp(join(tmpdir(), 'oracle-spec-contract-'));
  const directory = join(root, '.oracle/domains/ativos');
  await mkdir(directory, { recursive: true });
  await copyFile(new URL('ontology.jsonld', source), join(directory, 'ontology.jsonld'));
  await copyFile(new URL('shapes.ttl', source), join(directory, 'shapes.ttl'));
  await writeFile(join(root, '.oracle/project.json'), JSON.stringify({
    schemaVersion: 1,
    projectId: 'pilot',
    domains: [{ id: 'ativos', version: '1.0.0', baseIri: 'urn:pilot:ativos:', ontology: 'domains/ativos/ontology.jsonld', shapes: 'domains/ativos/shapes.ttl' }],
  }));
  return root;
}

test('Given malformed JSON-LD, when parsed, then it fails with a format diagnosis', async () => {
  await assert.rejects(parseOntology('{ broken'), /JSON-LD inválido/);
});

test('Given a local policy reference without a target, when validated, then readiness is denied', async () => {
  const root = await fixtureProject();
  try {
    const file = join(root, '.oracle/domains/ativos/ontology.jsonld');
    const graph = JSON.parse(await readFile(file, 'utf8'));
    graph['@graph'].find(item => item['@type'] === 'oracle:Policy')['oracle:governs'] = { '@id': 'ex:Ausente' };
    await writeFile(file, JSON.stringify(graph));
    const report = await validateProject(root);
    assert.equal(report.ready, false);
    assert.ok(report.issues.some(issue => issue.rule === 'unresolved-reference' && issue.message.includes('Ausente')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a human review policy without SHACL restrictions, when validated, then the domain is ready', async () => {
  const root = await fixtureProject();
  try {
    await writeFile(join(root, '.oracle/domains/ativos/shapes.ttl'), '@prefix sh: <http://www.w3.org/ns/shacl#> .');
    const report = await validateProject(root);
    assert.equal(report.ready, true, JSON.stringify(report.issues));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a malformed shape graph, when validated, then the shape file is identified', async () => {
  const root = await fixtureProject();
  try {
    await writeFile(join(root, '.oracle/domains/ativos/shapes.ttl'), 'this is not Turtle !!!');
    const report = await validateProject(root);
    assert.equal(report.ready, false);
    assert.ok(report.issues.some(issue => issue.rule === 'shapes-load' && issue.file.endsWith('shapes.ttl')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a parseable shape without a path, when validated, then it is rejected as invalid', async () => {
  const root = await fixtureProject();
  try {
    await writeFile(join(root, '.oracle/domains/ativos/shapes.ttl'), '@prefix ex: <urn:pilot:ativos:> . @prefix sh: <http://www.w3.org/ns/shacl#> . ex:S a sh:NodeShape ; sh:targetClass ex:Ativo ; sh:property [ sh:minCount 1 ] .');
    const report = await validateProject(root);
    assert.equal(report.ready, false);
    assert.ok(report.issues.some(issue => issue.rule === 'invalid-shape'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given domains sharing a base IRI, when validated, then their namespace conflict is reported', async () => {
  const root = await fixtureProject();
  try {
    const manifestPath = join(root, '.oracle/project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.domains.push({ ...manifest.domains[0], id: 'contratos' });
    await writeFile(manifestPath, JSON.stringify(manifest));
    const report = await validateProject(root);
    assert.ok(report.issues.some(issue => issue.rule === 'duplicate-base-iri' && issue.message.includes('ativos') && issue.message.includes('contratos')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given an external symlink at the Oracle directory, when initializing, then no external manifest is written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oracle-boundary-'));
  const outside = await mkdtemp(join(tmpdir(), 'oracle-external-'));
  try {
    await symlink(outside, join(root, '.oracle'));
    const run = spawnSync(process.execPath, [cli, 'init', '--project', root], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /fora do projeto/);
    await assert.rejects(readFile(join(outside, 'project.json')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('Given a concept IRI, when queried, then its source, definition and governing policy are returned', async () => {
  const root = await fixtureProject();
  try {
    const result = await queryOntology(root, 'ativos', 'urn:pilot:ativos:TransferenciaAtivo');
    assert.equal(result.entries[0].source, 'domains/ativos/ontology.jsonld');
    assert.ok(result.entries[0].statements.some(item => item.value === 'Transferência de ativo'));
    assert.ok(result.entries[0].governedBy.some(item => item.requiresHumanReview && item.description.includes('justificativa')));
    assert.ok(result.shapes.some(item => item.target === 'urn:pilot:ativos:TransferenciaAtivo' && item.source.endsWith('shapes.ttl')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given an unknown IRI, when queried, then absence is explicit', async () => {
  const root = await fixtureProject();
  try {
    await assert.rejects(queryOntology(root, 'ativos', 'urn:pilot:ativos:Inexistente'), /IRI não encontrado/);
    await assert.rejects(queryOntology(root, 'inexistente'), /Domínio não declarado/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given an ontology snapshot, when an approved file changes, then stale decisions are rejected', async () => {
  const root = await fixtureProject();
  try {
    const snapshot = await createOntologySnapshot(root);
    await assertOntologySnapshot(root, snapshot);
    const file = join(root, '.oracle/domains/ativos/shapes.ttl');
    await writeFile(file, (await readFile(file, 'utf8')) + '\n# changed\n');
    await assert.rejects(assertOntologySnapshot(root, snapshot), /Retrato ontológico alterado/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a complete project, when CLI validates and shows an IRI, then commands exit successfully with provenance', async () => {
  const root = await fixtureProject();
  try {
    const validate = spawnSync(process.execPath, [cli, 'ontology', 'validate', '--project', root], { encoding: 'utf8' });
    assert.equal(validate.status, 0, validate.stderr);
    const show = spawnSync(process.execPath, [cli, 'ontology', 'show', 'ativos', 'urn:pilot:ativos:Ativo', '--project', root], { encoding: 'utf8' });
    assert.equal(show.status, 0, show.stderr);
    assert.match(show.stdout, /domains\/ativos\/ontology.jsonld/);
    assert.match(show.stdout, /urn:pilot:ativos:Ativo/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a draft project, when CLI validates it, then it exits with a nonzero code and a reason', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oracle-spec-draft-'));
  try {
    assert.equal(spawnSync(process.execPath, [cli, 'init', '--project', root], { encoding: 'utf8' }).status, 0);
    const report = spawnSync(process.execPath, [cli, 'ontology', 'validate', '--project', root], { encoding: 'utf8' });
    assert.equal(report.status, 1);
    assert.match(report.stderr, /sem domínios/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
