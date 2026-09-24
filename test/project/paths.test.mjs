import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveProjectFile } from '../../dist/project/paths.js';

test('Given a file inside the project, when resolved, then its canonical path is returned', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-path-'));
  try {
    await mkdir(join(root, 'domains', 'assets'), { recursive: true });
    await writeFile(join(root, 'domains', 'assets', 'shapes.ttl'), '');
    assert.equal(await resolveProjectFile(root, 'domains/assets/shapes.ttl'), join(root, 'domains', 'assets', 'shapes.ttl'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given parent traversal, when resolving a file, then access is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-path-'));
  try {
    await assert.rejects(resolveProjectFile(root, '../outside.jsonld'), /fora do projeto/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a symlink leaving the project, when resolving it, then access is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-path-'));
  const outside = await mkdtemp(join(tmpdir(), 'bsh-outside-'));
  try {
    await writeFile(join(outside, 'ontology.jsonld'), '{}');
    await symlink(join(outside, 'ontology.jsonld'), join(root, 'ontology.jsonld'));
    await assert.rejects(resolveProjectFile(root, 'ontology.jsonld'), /fora do projeto/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
