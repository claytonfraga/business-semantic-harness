import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { diagnoseCodex } from '../../dist/agents/codex/doctor.js';

test('Given a valid pilot and supported local Codex, when the BSH doctor checks capabilities, then read-only isolation and only the BSH MCP are verified', async () => {
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('bsh-codex-state-')));
  const report = await diagnoseCodex(resolve('pilot/asset-management'));
  assert.equal(report.ontologyReady, true);
  assert.equal(report.isolationVerified, true, report.reasons.join('; '));
  assert.equal(report.ready, true, report.reasons.join('; '));
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith('bsh-codex-state-'));
  assert.deepEqual(after.filter((name) => !before.has(name)), [], 'estado privado com credenciais precisa ser removido ao encerrar o doctor');
});
