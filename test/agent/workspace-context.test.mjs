import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectWorkspace } from '../../dist/agent/workspaceContext.js';

test('inspectWorkspace extracts technology and structure summary from project folder', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-workspace-test-'));
  try {
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await mkdir(join(tempDir, 'test'), { recursive: true });
    await writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'sample-project',
        description: 'A test project for BSH context inspection',
        scripts: { test: 'node --test', build: 'tsc' },
      })
    );
    await writeFile(join(tempDir, 'tsconfig.json'), '{}');

    const summary = await inspectWorkspace(tempDir);
    assert.ok(summary.detectedTechnologies.includes('Node.js / npm'));
    assert.ok(summary.detectedTechnologies.includes('TypeScript'));
    assert.equal(summary.projectDescription, 'A test project for BSH context inspection');
    assert.ok(summary.manifests.includes('package.json'));
    assert.ok(summary.manifests.includes('tsconfig.json'));
    assert.ok(summary.formattedContext.includes('## Workspace Context'));
    assert.ok(summary.formattedContext.includes('Node.js / npm'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
