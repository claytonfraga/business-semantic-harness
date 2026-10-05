import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectChangedPaths, createProjectBackup, restoreFile } from '../../dist/git/snapshot.js';

async function projectWith(files) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-snapshot-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

test('Given a project backup When a file is added, edited and removed Then all three changes are detected', async () => {
  const root = await projectWith({ 'src/keep.ts': 'export const keep = 1;\n', 'src/edit.ts': 'versao original\n', 'src/remove.ts': 'para remover\n' });
  const backup = await mkdtemp(join(tmpdir(), 'bsh-backup-'));
  try {
    await createProjectBackup(root, backup);
    await writeFile(join(root, 'src/keep.ts'), 'export const keep = 2;\n');
    await writeFile(join(root, 'src/novo.ts'), 'novo arquivo\n');
    await rm(join(root, 'src/remove.ts'));
    const changes = await collectChangedPaths(root, backup);
    const paths = changes.map((change) => change.path).sort();
    assert.deepEqual(paths, ['src/keep.ts', 'src/novo.ts', 'src/remove.ts']);
    const removed = changes.find((change) => change.path === 'src/remove.ts');
    assert.equal(removed.existedBefore, true);
    const added = changes.find((change) => change.path === 'src/novo.ts');
    assert.equal(added.existedBefore, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  }
});

test('Given changes against a backup When reverted Then the project returns to the backed up content', async () => {
  const root = await projectWith({ 'src/edit.ts': 'versao original\n' });
  const backup = await mkdtemp(join(tmpdir(), 'bsh-backup-'));
  try {
    await createProjectBackup(root, backup);
    await writeFile(join(root, 'src/edit.ts'), 'versao alterada\n');
    await writeFile(join(root, 'src/novo.ts'), 'novo arquivo\n');
    const changes = await collectChangedPaths(root, backup);
    for (const change of changes) await restoreFile(root, backup, change);
    assert.equal(await readFile(join(root, 'src/edit.ts'), 'utf8'), 'versao original\n');
    const after = await collectChangedPaths(root, backup);
    assert.deepEqual(after.map((change) => change.path), []);
    await assert.rejects(() => readFile(join(root, 'src/novo.ts')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });
  }
});