// BSH-EVAL-005, BSH-EVAL-006, BSH-EVAL-010: deliberately invalid evidence fixtures.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
function verify(fixture) {
  mkdirSync(join(root, 'evaluation'), { recursive: true });
  const batch = mkdtempSync(join(root, 'evaluation', 'invalid-evidence-fixture-'));
  const id = batch.split('/').at(-1);
  try {
    writeFileSync(join(batch, 'manifest.json'), JSON.stringify({ batchId: id, ...fixture }));
    return spawnSync(process.execPath, ['scripts/verify-e2e-sync.mjs', id], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(batch, { recursive: true, force: true });
  }
}

test('Given a blocked recorded native journey When its evidence is verified Then the gateway rejects its claimed completion', () => {
  const result = verify({ passed: false, diagnostic: 'Native TUI did not start', checks: [] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Native TUI did not start/);
});

test('Given a caption declaring success without behavioral assertions When the batch is verified Then the gateway rejects the false pass', () => {
  const result = verify({ passed: true, checks: [{ name: 'No shell leakage', passed: true }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing successful production assertion/);
});

test('Given a claimed passed batch with a failed file comparison When its evidence is verified Then a success flag cannot override that failure', () => {
  const result = verify({ passed: true, checks: [{ name: 'Candidate matches expected implementation', passed: false }] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Every recorded behavioral assertion must pass/);
});
