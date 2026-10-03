import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveUserAuth } from '../../dist/config/userStore.js';
import { main } from '../../dist/cli.js';

test('Given no active credentials, When bsh auth status is called, Then it reports unauthenticated with exit code 0', async () => {
  const tempXdg = await mkdtemp(join(tmpdir(), 'bsh-cli-status-test-'));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  let stdoutData = '';
  const originalWrite = process.stdout.write;

  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.XDG_CONFIG_HOME = tempXdg;

    process.stdout.write = (chunk) => {
      stdoutData += chunk;
      return true;
    };

    const code = await main(['--project', tempXdg, 'auth', 'status']);
    assert.equal(code, 0);
    assert.match(stdoutData, /Unauthenticated/);
    assert.match(stdoutData, /bsh auth login/);
  } finally {
    process.stdout.write = originalWrite;
    if (originalApiKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await rm(tempXdg, { recursive: true, force: true });
  }
});

test('Given active credentials in user store, When bsh auth status is called, Then it reports authenticated with masked key', async () => {
  const tempXdg = await mkdtemp(join(tmpdir(), 'bsh-cli-status-auth-'));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  let stdoutData = '';
  const originalWrite = process.stdout.write;

  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.XDG_CONFIG_HOME = tempXdg;
    await saveUserAuth({ apiKey: 'sk-or-v1-my-secret-key-9999' });

    process.stdout.write = (chunk) => {
      stdoutData += chunk;
      return true;
    };

    const code = await main(['--project', tempXdg, 'auth', 'status']);
    assert.equal(code, 0);
    assert.match(stdoutData, /Authenticated/);
    assert.match(stdoutData, /User credential store/);
    assert.match(stdoutData, /sk-or-v1••••••••9999/);
    assert.doesNotMatch(stdoutData, /my-secret-key/, 'Full secret must not be exposed');
  } finally {
    process.stdout.write = originalWrite;
    if (originalApiKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await rm(tempXdg, { recursive: true, force: true });
  }
});

test('Given credentials in user store, When bsh auth logout is called, Then credentials are removed and status becomes unauthenticated', async () => {
  const tempXdg = await mkdtemp(join(tmpdir(), 'bsh-cli-logout-'));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  let stdoutData = '';
  const originalWrite = process.stdout.write;

  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.XDG_CONFIG_HOME = tempXdg;
    await saveUserAuth({ apiKey: 'sk-or-v1-removable-key-1111' });

    process.stdout.write = (chunk) => {
      stdoutData += chunk;
      return true;
    };

    const logoutCode = await main(['--project', tempXdg, 'auth', 'logout']);
    assert.equal(logoutCode, 0);
    assert.match(stdoutData, /removed from/);

    stdoutData = '';
    const statusCode = await main(['--project', tempXdg, 'auth', 'status']);
    assert.equal(statusCode, 0);
    assert.match(stdoutData, /Unauthenticated/);
  } finally {
    process.stdout.write = originalWrite;
    if (originalApiKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await rm(tempXdg, { recursive: true, force: true });
  }
});
