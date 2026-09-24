import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildConfig } from '../../dist/agents/codex/launcher.js';

test('Given default settings, when building the session config, then the sandbox is workspace-write rooted at the worktree', () => {
  delete process.env.BSH_CODEX_SANDBOX;
  const config = buildConfig('/repo', '/repo-worktree', '/mcp/server.js');
  assert.match(config, /sandbox_mode = "workspace-write"/);
  assert.match(config, /writable_roots = \["\/repo-worktree"\]/);
  assert.match(config, /"\/repo"/);
});

test('Given the explicit override, when building the session config, then the sandbox is danger-full-access', () => {
  process.env.BSH_CODEX_SANDBOX = 'danger-full-access';
  try {
    const config = buildConfig('/repo', '/repo-worktree', '/mcp/server.js');
    assert.match(config, /sandbox_mode = "danger-full-access"/);
  } finally {
    delete process.env.BSH_CODEX_SANDBOX;
  }
});
