import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { getPackageVersion } from '../../dist/version.js';

test('Given BSH-DIST-006 and BSH-DIST-007 a built distribution When CLI and protocol identity are inspected Then package version and source commit are verifiable', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const build = JSON.parse(await readFile(new URL('../../dist/build-info.json', import.meta.url), 'utf8'));
  assert.equal(getPackageVersion(), pkg.version);
  assert.equal(execFileSync(process.execPath, ['dist/cli.js', '--version'], { encoding: 'utf8' }).trim(), pkg.version);
  assert.equal(build.version, pkg.version);
  assert.equal(build.name, pkg.name);
  assert.equal(build.sourceCommit, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  assert.equal(typeof build.sourceDirty, 'boolean');
});
