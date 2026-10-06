import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateWorkspaceDiffGate } from '../../dist/enforcement/diffGate.js';

test('Given BSH-SEM-017 a workspace without modifications When evaluateWorkspaceDiffGate is executed Then it returns NO_CHANGES with hasChanges false', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-gate-test-'));
  try {
    spawnSync('git', ['init'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
    await writeFile(join(tempDir, 'file.txt'), 'Initial');
    spawnSync('git', ['add', '.'], { cwd: tempDir });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: tempDir });

    const result = await evaluateWorkspaceDiffGate({
      worktree: tempDir,
      projectRoot: tempDir,
    });

    assert.equal(result.hasChanges, false);
    assert.equal(result.gateStatus, 'NO_CHANGES');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Given BSH-SEM-013 a workspace with valid modifications When evaluateWorkspaceDiffGate is executed Then it returns CONFORMING with conforming true and lists changed files', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-gate-diff-'));
  try {
    spawnSync('git', ['init'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir });
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir });
    await writeFile(join(tempDir, 'file.txt'), 'Initial\n');
    spawnSync('git', ['add', '.'], { cwd: tempDir });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: tempDir });

    await writeFile(join(tempDir, 'file.txt'), 'Initial\nModified line\n');

    const result = await evaluateWorkspaceDiffGate({
      worktree: tempDir,
      projectRoot: tempDir,
    });

    assert.equal(result.hasChanges, true);
    assert.equal(result.conforming, true);
    assert.equal(result.gateStatus, 'CONFORMING');
    assert.ok(result.filesChanged.includes('file.txt'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
