import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { readAudit } from '../../dist/decision/audit.js';
import { reviewAndApplyPatch } from '../../dist/agents/codex/patch.js';
import { collectWorkspaceChanges, synchronizeWorkspaceFile } from '../../dist/agents/codex/workspace.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'oracle-native-root-'));
  const workspace = await mkdtemp(join(tmpdir(), 'oracle-native-copy-'));
  await cp(resolve('pilot/asset-management/.oracle'), join(root, '.oracle'), { recursive: true });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'asset.ts'), 'before\n');
  await cp(root, workspace, { recursive: true, force: true });
  return { root, workspace, cleanup: async () => { await rm(root, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true }); } };
}

test('Given a governed copy, when Codex edits a source file and the user approves, then the original changes only after approval and the decision is audited', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    await writeFile(join(workspace, 'src', 'asset.ts'), 'after\n');
    const [change] = await collectWorkspaceChanges(root, workspace, 'ativos');
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'before\n');
    const result = await reviewAndApplyPatch(root, change, await createOntologySnapshot(root), async (diff, evaluation) => {
      assert.match(diff, /after/);
      assert.equal(evaluation.status, 'needs-human');
      return { choice: 'allow-once', actor: 'qa', reason: 'Mudança revisada' };
    });
    assert.equal(result.applied, true);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'after\n');
    assert.equal((await readAudit(root))[0].decision, 'allow');
  } finally { await cleanup(); }
});

test('Given a governed copy, when a native edit is denied, then the original stays intact and the next turn sees the original content', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    await writeFile(join(workspace, 'src', 'asset.ts'), 'outside-rule\n');
    const [change] = await collectWorkspaceChanges(root, workspace, 'ativos');
    const result = await reviewAndApplyPatch(root, change, await createOntologySnapshot(root), async () => ({ choice: 'deny', actor: 'qa', reason: 'Conflito' }));
    await synchronizeWorkspaceFile(root, workspace, change.files[0].path);
    assert.equal(result.applied, false);
    assert.equal(await readFile(join(root, 'src', 'asset.ts'), 'utf8'), 'before\n');
    assert.equal(await readFile(join(workspace, 'src', 'asset.ts'), 'utf8'), 'before\n');
    assert.equal((await collectWorkspaceChanges(root, workspace, 'ativos')).length, 0);
  } finally { await cleanup(); }
});

test('Given a governed copy, when Codex creates a nested source file and approval is granted, then the new path is promoted', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    await mkdir(join(workspace, 'src', 'history'));
    await writeFile(join(workspace, 'src', 'history', 'index.ts'), 'export const history = [];\n');
    const [change] = await collectWorkspaceChanges(root, workspace, 'ativos');
    const result = await reviewAndApplyPatch(root, change, await createOntologySnapshot(root), async () => ({ choice: 'allow-once', actor: 'qa', reason: 'Novo módulo revisado' }));
    assert.equal(result.applied, true);
    assert.equal(await readFile(join(root, 'src', 'history', 'index.ts'), 'utf8'), 'export const history = [];\n');
  } finally { await cleanup(); }
});

test('Given a governed copy, when Codex deletes a source file and the user denies it, then the file is restored in both trees', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    await rm(join(workspace, 'src', 'asset.ts'));
    const [change] = await collectWorkspaceChanges(root, workspace, 'ativos');
    assert.equal(change.files[0].content, null);
    const result = await reviewAndApplyPatch(root, change, await createOntologySnapshot(root), async () => ({ choice: 'deny', actor: 'qa', reason: 'Exclusão indevida' }));
    await synchronizeWorkspaceFile(root, workspace, change.files[0].path);
    assert.equal(result.applied, false);
    assert.equal(await readFile(join(workspace, 'src', 'asset.ts'), 'utf8'), 'before\n');
  } finally { await cleanup(); }
});

test('Given a governed copy, when Codex changes approved ontology files, then the broker refuses direct promotion', async () => {
  const { root, workspace, cleanup } = await fixture();
  try {
    const path = '.oracle/domains/ativos/ontology.jsonld';
    await writeFile(join(workspace, path), (await readFile(join(workspace, path), 'utf8')) + '\n');
    const [change] = await collectWorkspaceChanges(root, workspace, 'ativos');
    await assert.rejects(reviewAndApplyPatch(root, change, await createOntologySnapshot(root), async () => ({ choice: 'allow-once', actor: 'qa', reason: 'Tentativa' })), /Caminho reservado/);
    await synchronizeWorkspaceFile(root, workspace, path);
    assert.equal((await collectWorkspaceChanges(root, workspace, 'ativos')).length, 0);
  } finally { await cleanup(); }
});
