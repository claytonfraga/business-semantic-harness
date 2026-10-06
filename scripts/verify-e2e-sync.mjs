#!/usr/bin/env node
// BSH-EVAL-005..013: verify the current batch's observed assertions and artifacts.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const evaluation = join(root, 'evaluation');
const downloads = '/mnt/c/Users/clayt/Downloads/bsh';
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const requiredChecks = [
  'Installed version matches local package',
  'Sovereign ontology validates before first turn',
  'Production creates exactly one isolated repository workspace',
  'Actual request preparation decision is presented',
  'Decision identifies actual project contract references',
  'Candidate contains exactly the planned comment and unchanged implementation',
  'Only the planned application file changed',
  'Host broker authorizes and records real mutation execution',
  'Conflicting cancelled request leaves candidate unchanged',
  'Conflicting operation receives contract review or block',
  'Conflicting cancelled request executes no audited tool',
  'No candidate promotion modifies origin',
];

try {
  const explicit = process.argv[2] ?? process.env.BSH_E2E_BATCH_ID;
  const batches = readdirSync(evaluation, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(evaluation, entry.name, 'manifest.json')))
    .map(entry => ({ id: entry.name, path: join(evaluation, entry.name, 'manifest.json') }))
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
  const selected = explicit ? batches.find(batch => batch.id === explicit) : batches[0];
  assert.ok(selected, 'A production E2E batch manifest must exist');
  assert.ok(Date.now() - statSync(selected.path).mtimeMs < 60 * 60 * 1000,
    'The production batch must have completed in the last hour');
  const manifest = JSON.parse(readFileSync(selected.path, 'utf8'));
  assert.equal(manifest.batchId, selected.id);
  assert.equal(manifest.passed, true, `Production assertions failed: ${manifest.diagnostic ?? 'inspect manifest checks'}`);
  assert.ok(Array.isArray(manifest.checks) && manifest.checks.length > 0);
  assert.ok(manifest.checks.every(check => check.passed === true), 'Every recorded behavioral assertion must pass');
  for (const name of requiredChecks) {
    assert.ok(manifest.checks.some(check => check.name === name && check.passed === true),
      `Missing successful production assertion: ${name}`);
  }
  assert.equal(manifest.projectRoot, join(root, 'pilot/asset-management'));
  assert.equal(manifest.metrics.status, 'UNAVAILABLE');
  assert.equal(manifest.metrics.harnessTokensAbsolute, null);
  assert.equal(manifest.metrics.harnessTokensPercent, null);
  assert.equal(manifest.scenarios.length, 2);
  assert.ok(manifest.artifacts.some(artifact => artifact.path.endsWith('.mp4')));
  assert.ok(manifest.artifacts.filter(artifact => artifact.path.endsWith('.png')).length >= 4);
  for (const artifact of manifest.artifacts) {
    const path = resolve(root, artifact.path);
    assert.ok(path.startsWith(`${join(evaluation, selected.id)}${sep}`), 'Artifacts must belong to the selected batch');
    assert.ok(basename(path).includes(selected.id), 'Artifact names must include the batch identifier');
    assert.ok(statSync(path).size > 0, `Empty artifact: ${artifact.path}`);
    assert.equal(digest(path), artifact.sha256, `Local artifact hash differs: ${artifact.path}`);
    if (existsSync('/mnt/c/Users/clayt/Downloads')) {
      const copy = join(downloads, basename(path));
      assert.ok(existsSync(copy), `Missing Downloads copy: ${copy}`);
      assert.equal(digest(copy), artifact.sha256, `Downloads hash differs: ${copy}`);
    }
  }
  const report = join(root, 'pilot/asset-management/evaluation', `production-governance-${selected.id}.md`);
  assert.ok(existsSync(report), 'A dated production report must exist');
  if (existsSync('/mnt/c/Users/clayt/Downloads')) {
    assert.equal(digest(report), digest(join(downloads, basename(report))), 'Production report copy differs');
    assert.equal(digest(selected.path), digest(join(downloads, `manifest-${selected.id}.json`)), 'Manifest copy differs');
  }
  console.log(`PASS: production batch ${selected.id}, ${manifest.checks.length} observed assertions, artifact hashes and synchronization verified.`);
  console.log('Harness token overhead is explicitly unavailable in absolute and percentage values.');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
