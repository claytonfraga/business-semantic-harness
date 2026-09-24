import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('Given the help flag, when the CLI runs, then project and ontology commands are shown', () => {
  const result = spawnSync(process.execPath, ['dist/cli.js', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /bsh/);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /domain/);
  assert.match(result.stdout, /ontology/);
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

test('Given a project without ontology, when doctor and codex run, then the governed session is refused before a turn', () => {
  const root = mkdtempSync(join(tmpdir(), 'bsh-doctor-'));
  const executable = resolve('dist/cli.js');
  try {
    const doctor = spawnSync(process.execPath, [executable, 'doctor', '--project', root], { encoding: 'utf8' });
    assert.equal(doctor.status, 1);
    assert.equal(JSON.parse(doctor.stdout).isolationVerified, false);
    const codex = spawnSync(process.execPath, [executable, 'codex', '--project', root], { encoding: 'utf8' });
    assert.equal(codex.status, 1);
    assert.match(codex.stderr, /Sessão governada indisponível/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
