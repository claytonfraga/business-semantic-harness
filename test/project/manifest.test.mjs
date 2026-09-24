import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadManifest } from '../../dist/project/manifest.js';

async function projectWith(manifest) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-manifest-'));
  await mkdir(join(root, '.bsh'));
  await writeFile(join(root, '.bsh', 'project.json'), JSON.stringify(manifest));
  return root;
}

const domain = (id) => ({
  id,
  version: '1.0.0',
  baseIri: `urn:example:${id}:`,
  ontology: `domains/${id}/ontology.jsonld`,
  shapes: `domains/${id}/shapes.ttl`,
});

test('Given two declared domains, when loading the manifest, then both distinct paths are retained', async () => {
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

test('Given no manifest, when loading the project, then an explicit error is reported', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-manifest-'));
  try {
    await assert.rejects(loadManifest(root), /Manifesto.*ausente/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given duplicate domain IDs, when loading the manifest, then it is rejected', async () => {
  const root = await projectWith({ schemaVersion: 1, projectId: 'inventory', domains: [domain('assets'), domain('assets')] });
  try {
    await assert.rejects(loadManifest(root), /Domínio duplicado: assets/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a future format version, when loading the manifest, then it is rejected', async () => {
  const root = await projectWith({ schemaVersion: 99, projectId: 'inventory', domains: [domain('assets')] });
  try {
    await assert.rejects(loadManifest(root), /versão.*99/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
