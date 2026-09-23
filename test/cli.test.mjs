import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
