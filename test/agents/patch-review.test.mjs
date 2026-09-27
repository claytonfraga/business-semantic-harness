import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { preparePatch, reviewAndApplyPatch } from '../../dist/agents/codex/patch.js';

const hash = (text) => createHash('sha256').update(text).digest('hex');
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-patch-test-'));
  await cp(resolve('pilot/asset-management/.bsh'), join(root, '.bsh'), { recursive: true });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'asset.ts'), 'old\n');
  return root;
}
function proposal(path = 'src/asset.ts', beforeSha256 = hash('old\n'), content = 'new\n') {
  return { domain: 'ativos', summary: 'Atualizar ativo', files: [{ path, beforeSha256, content }] };
}

test('Given a governed code change, When the user approves a direct patch, Then the promotion gate still blocks it', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const result = await reviewAndApplyPatch(root, proposal(), snapshot, async () => ({ choice: 'allow-once', actor: 'qa', reason: 'Diff revisado' }));
    assert.equal(result.applied, false);
    assert.match(result.reason, /GOVERNANCE_GATE_REQUIRED/);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a conflicting code change, when the user denies it, then the file stays unchanged and denial is audited', async () => {
  const root = await project();
  try {
    const result = await reviewAndApplyPatch(root, proposal(), await createOntologySnapshot(root), async () => ({ choice: 'deny', actor: 'qa', reason: 'Contraria a regra' }));
    assert.equal(result.applied, false);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
    assert.match(result.reason, /GOVERNANCE_GATE_REQUIRED/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a path escaping the codebase, when a patch is prepared, then it is rejected before any outside write', async () => {
  const root = await project();
  try {
    await assert.rejects(preparePatch(root, proposal('../outside.txt', null, 'escape')), /Caminho inválido/);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a symlink to an external file, when a patch is prepared, then the link target stays untouched', async () => {
  const root = await project();
  const outside = join(tmpdir(), `bsh-patch-outside-${process.pid}`);
  try {
    await writeFile(outside, 'outside\n');
    await symlink(outside, join(root, 'src', 'link.txt'));
    await assert.rejects(preparePatch(root, proposal('src/link.txt', hash('outside\n'), 'changed')), /Arquivo não confiável/);
    assert.equal(await readFile(outside, 'utf8'), 'outside\n');
  } finally { await rm(outside, { force: true }); await rm(root, { recursive: true, force: true }); }
});

test('Given a stale file hash, when a patch is prepared, then the file is not overwritten', async () => {
  const root = await project();
  try {
    await assert.rejects(preparePatch(root, proposal('src/asset.ts', hash('other'), 'new')), /Hash anterior divergente/);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given an ontology change during review, when approval is answered, then the code change is denied', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const result = await reviewAndApplyPatch(root, proposal(), snapshot, async () => {
      const ontology = join(root, '.bsh', 'domains', 'ativos', 'ontology.jsonld');
      await writeFile(ontology, (await readFile(ontology, 'utf8')) + '\n');
      return { choice: 'allow-once', actor: 'qa', reason: 'Aceito' };
    });
    assert.equal(result.applied, false);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a file changed during review, when the user approves stale content, then the newer file is preserved', async () => {
  const root = await project();
  try {
    const result = await reviewAndApplyPatch(root, proposal(), await createOntologySnapshot(root), async () => {
      await writeFile(join(root, 'src', 'asset.ts'), 'concurrent\n');
      return { choice: 'allow-once', actor: 'qa', reason: 'Aceito' };
    });
    assert.equal(result.applied, false);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given multiple files in one proposal, when prepared, then atomicity is preserved by refusing the batch', async () => {
  const root = await project();
  try {
    const batch = proposal();
    batch.files.push({ path: 'src/other.ts', beforeSha256: null, content: 'other' });
    await assert.rejects(preparePatch(root, batch));
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
