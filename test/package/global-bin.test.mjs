import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

test('Given a Linux bin symlink and an external codebase, when BSH runs there, then it initializes that project', () => {
  const temp = mkdtempSync(join(tmpdir(), 'bsh-installed-'));
  const project = join(temp, 'codebase');
  mkdirSync(project);
  const executable = join(temp, 'bsh');
  symlinkSync(resolve('dist/cli.js'), executable);
  try {
    const help = spawnSync(executable, ['--help'], { cwd: project, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    const init = spawnSync(executable, ['init'], { cwd: project, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    const add = spawnSync(executable, ['domain', 'add', 'ativos'], { cwd: project, encoding: 'utf8' });
    assert.equal(add.status, 0, add.stderr);
    const codex = spawnSync(executable, ['code', 'base'], { cwd: project, encoding: 'utf8' });
    assert.equal(codex.status, 1);
    assert.match(codex.stderr, /Sessão governada indisponível/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
