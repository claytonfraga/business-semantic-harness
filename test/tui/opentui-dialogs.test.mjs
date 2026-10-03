import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('Given BSH-OPENTUI-005/009/017 When native dialog component scenarios run Then focus, selection, responsive layout and secrets are safe', () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(fileURLToPath(new URL('../../node_modules/bun/bin/bun.exe', import.meta.url)), ['test', fileURLToPath(new URL('../support/opentui-dialogs.fixture.mjs', import.meta.url))], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
});
