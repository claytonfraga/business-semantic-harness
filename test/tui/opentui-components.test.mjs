import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Given component scenarios run under the supported package runtime Then native renderer checks pass', () => {
  const runtime = fileURLToPath(new URL('../../node_modules/bun/bin/bun.exe', import.meta.url));
  const fixture = fileURLToPath(new URL('../support/opentui-components.fixture.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(runtime, ['test', fixture], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
});
