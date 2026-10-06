#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const rootDir = resolve(import.meta.dirname, '..');

function run(cmd, args, description) {
  console.log(`\n>>> [E2E PIPELINE] ${description} (${cmd} ${args.join(' ')})`);
  const res = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`\n✖ [FAILURE] ${description} exited with code ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

// Preserve prior batches: evidence must never be deleted by a verification run.
run('node', ['--test', '--experimental-test-isolation=none', 'test/e2e-live/semantic-enforcement.semantic.mjs'],
  'Production semantic integration (no mocked extraction, validator, gates, or Git)');

// Run interaction and worktree isolation suites after semantic integration.
run(
  'node',
  ['--test', '--experimental-test-isolation=none', 'test/e2e-live/ux-ergonomics-adversarial.e2e.mjs', 'test/e2e-live/worktree-adversarial.e2e.mjs', 'test/e2e-live/worktree-isolation.e2e.mjs', 'test/e2e-live/tui-scrollbar-and-history.e2e.mjs', 'test/e2e-live/prompt-violation-confirmation.e2e.mjs', 'test/e2e-live/autonomous-coding-agent.e2e.mjs', 'test/e2e-live/mcp-server-user-journey.e2e.mjs', 'test/e2e-live/mcp-client-third-party.e2e.mjs', 'test/e2e-live/web-auth.e2e.mjs'],
  'Live interaction and worktree integration suites'
);

// Record the functional journeys in the local evaluation environment.
const isCI = Boolean(process.env.CI);

if (!isCI) {
  run(
    'python3',
    ['scripts/run_all_e2e_journeys.py'],
    'Continuous journey recordings with objectives and verdicts'
  );

  run(
    'node',
    ['scripts/verify-e2e-sync.mjs'],
    'Video integrity and WSL synchronization verification'
  );
} else {
  console.log('\n[CI] Journey recordings and WSL synchronization require the local functional evaluation environment.');
}

console.log('\n✔ [SUCCESS] E2E pipeline completed.');
