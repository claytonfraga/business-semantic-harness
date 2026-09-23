import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('CLI shows available project and ontology commands', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /oracle/);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /domain/);
  assert.match(result.stdout, /ontology/);
});

test('CLI rejects unknown commands with exit code 2', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Comando desconhecido/);
});

test('CLI initializes a selected project and adds a domain', () => {
  const root = mkdtempSync(join(tmpdir(), 'oracle-cli-'));
  const executable = resolve('dist/cli.js');
  try {
    const init = spawnSync(process.execPath, [executable, 'init', '--project', root], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const add = spawnSync(process.execPath, [executable, 'domain', 'add', 'assets', '--project', root], { encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const manifest = JSON.parse(readFileSync(join(root, '.oracle', 'project.json'), 'utf8'));
    assert.deepEqual(manifest.domains.map((item) => item.id), ['assets']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
