import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { initProject, addDomain } from '../../dist/project/scaffold.js';

test('Given an empty project, when initialized and a domain is added, then distinct ontology and shape files exist', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-scaffold-'));
  try {
    await initProject(root);
    await addDomain(root, 'assets');
    const manifest = JSON.parse(await readFile(join(root, '.bsh', 'project.json'), 'utf8'));
    assert.equal(manifest.projectId.length > 0, true);
    assert.deepEqual(manifest.domains.map((item) => item.id), ['assets']);
    assert.equal(manifest.domains[0].ontology, 'domains/assets/ontology.jsonld');
    assert.equal(manifest.domains[0].shapes, 'domains/assets/shapes.ttl');
    const ontology = JSON.parse(await readFile(join(root, '.bsh', manifest.domains[0].ontology), 'utf8'));
    assert.equal(typeof ontology['@context'], 'object');
    assert.equal(Array.isArray(ontology['@graph']), true);
    const shapes = await readFile(join(root, '.bsh', manifest.domains[0].shapes), 'utf8');
    assert.match(shapes, /@prefix sh:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given an existing domain, when added again, then its files are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-scaffold-'));
  try {
    await initProject(root);
    await addDomain(root, 'assets');
    const ontologyPath = join(root, '.bsh', 'domains', 'assets', 'ontology.jsonld');
    await writeFile(ontologyPath, '{"important":"manual edit"}');
    await assert.rejects(addDomain(root, 'assets'), /já existe/);
    assert.equal(await readFile(ontologyPath, 'utf8'), '{"important":"manual edit"}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given an existing manifest, when initializing again, then its bytes are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-scaffold-'));
  try {
    await initProject(root);
    const path = join(root, '.bsh', 'project.json');
    const original = await readFile(path, 'utf8');
    await assert.rejects(initProject(root), /já existe/);
    assert.equal(await readFile(path, 'utf8'), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
