import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadManifest } from '../../dist/project/manifest.js';

async function projectWith(manifest) {
  const root = await mkdtemp(join(tmpdir(), 'oracle-manifest-'));
  await mkdir(join(root, '.oracle'));
  await writeFile(join(root, '.oracle', 'project.json'), JSON.stringify(manifest));
  return root;
}

const domain = (id) => ({
  id,
  version: '1.0.0',
  baseIri: `urn:example:${id}:`,
  ontology: `domains/${id}/ontology.jsonld`,
  shapes: `domains/${id}/shapes.ttl`,
});

test('loads two declared domains with their distinct ontology paths', async () => {
  const root = await projectWith({ schemaVersion: 1, projectId: 'inventory', domains: [domain('assets'), domain('contracts')] });
  try {
    const manifest = await loadManifest(root);
    assert.equal(manifest.projectId, 'inventory');
    assert.deepEqual(manifest.domains.map((item) => item.id), ['assets', 'contracts']);
    assert.equal(manifest.domains[1].shapes, 'domains/contracts/shapes.ttl');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports a missing project manifest before starting a session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oracle-manifest-'));
  try {
    await assert.rejects(loadManifest(root), /Manifesto.*ausente/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects duplicate domain identifiers', async () => {
  const root = await projectWith({ schemaVersion: 1, projectId: 'inventory', domains: [domain('assets'), domain('assets')] });
  try {
    await assert.rejects(loadManifest(root), /Domínio duplicado: assets/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a format version newer than the CLI supports', async () => {
  const root = await projectWith({ schemaVersion: 99, projectId: 'inventory', domains: [domain('assets')] });
  try {
    await assert.rejects(loadManifest(root), /versão.*99/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
