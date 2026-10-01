import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('Given the help flag, when the CLI runs, then project, ontology, and mcp commands are shown', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /bsh/);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /domain/);
  assert.match(result.stdout, /ontology/);
  assert.match(result.stdout, /mcp/);
});

test('Given an unknown command, when the CLI runs, then it exits with code 2', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Comando desconhecido/);
});

test('Given a selected project, when init and domain add run, then the domain is created', () => {
  const root = mkdtempSync(join(tmpdir(), 'bsh-cli-'));
  const executable = resolve('dist/cli.js');
  try {
    const init = spawnSync(process.execPath, [executable, 'init', '--project', root], { encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const add = spawnSync(process.execPath, [executable, 'domain', 'add', 'assets', '--project', root], { encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const manifest = JSON.parse(readFileSync(join(root, '.bsh', 'project.json'), 'utf8'));
    assert.deepEqual(manifest.domains.map((item) => item.id), ['assets']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Given a project without ontology, when ontology validate runs, then it returns exit code 1', () => {
  const root = mkdtempSync(join(tmpdir(), 'bsh-validate-'));
  const executable = resolve('dist/cli.js');
  try {
    const val = spawnSync(process.execPath, [executable, 'ontology', 'validate', '--project', root], { encoding: 'utf8' });
    assert.equal(val.status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Given a project without ready ontology, when bsh mcp runs, then it exits with non-zero code and reports error on stderr', () => {
  const root = mkdtempSync(join(tmpdir(), 'bsh-mcp-unready-'));
  const executable = resolve('dist/cli.js');
  try {
    const val = spawnSync(process.execPath, [executable, 'mcp', '--project', root], { encoding: 'utf8' });
    assert.notEqual(val.status, 0);
    assert.match(val.stderr, /Ontologia/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
