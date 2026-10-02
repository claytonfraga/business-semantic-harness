import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getUserConfigDir,
  getAuthFilePath,
  saveUserAuth,
  loadUserAuth,
  deleteUserAuth,
  maskApiKey,
} from '../../dist/config/userStore.js';
import { loadEnvConfig } from '../../dist/config/env.js';

test('Given a custom XDG_CONFIG_HOME, When getUserConfigDir is called, Then it resolves under the XDG directory', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = '/tmp/custom-xdg-config';
    const configDir = getUserConfigDir();
    assert.equal(configDir, '/tmp/custom-xdg-config/bsh');
    assert.equal(getAuthFilePath(), '/tmp/custom-xdg-config/bsh/auth.json');
  } finally {
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
  }
});

test('Given user credentials, When saveUserAuth is called, Then it persists to auth.json with 0600 permissions', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-auth-test-'));
  const originalXdg = process.env.XDG_CONFIG_HOME;

  try {
    process.env.XDG_CONFIG_HOME = tempDir;
    await saveUserAuth({ apiKey: 'sk-or-v1-test-key-123456789' });

    const authFile = getAuthFilePath();
    const loaded = await loadUserAuth();

    assert.equal(loaded.apiKey, 'sk-or-v1-test-key-123456789');
    assert.ok(loaded.updatedAt);

    // Verify POSIX permissions on non-Windows
    if (process.platform !== 'win32') {
      const fileStat = await stat(authFile);
      const modeOctal = (fileStat.mode & 0o777).toString(8);
      assert.equal(modeOctal, '600', 'auth.json must have 0600 permission mode');
    }
  } finally {
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Given an existing auth file, When deleteUserAuth is invoked, Then it removes the file and subsequent loads return empty', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-auth-del-test-'));
  const originalXdg = process.env.XDG_CONFIG_HOME;

  try {
    process.env.XDG_CONFIG_HOME = tempDir;
    await saveUserAuth({ apiKey: 'sk-or-v1-delete-me' });

    const deletedFirst = await deleteUserAuth();
    assert.equal(deletedFirst, true, 'deleteUserAuth should return true on first deletion');

    const loadedAfter = await loadUserAuth();
    assert.deepEqual(loadedAfter, {});

    // Idempotent deletion
    const deletedSecond = await deleteUserAuth();
    assert.equal(deletedSecond, false, 'deleteUserAuth should return false if file does not exist');
  } finally {
    if (originalXdg !== undefined) {
      process.env.XDG_CONFIG_HOME = originalXdg;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Given various API key formats, When maskApiKey is called, Then it redacts the middle and displays safe hints', () => {
  assert.equal(maskApiKey(undefined), '(nenhuma)');
  assert.equal(maskApiKey(''), '(nenhuma)');
  assert.equal(maskApiKey('short'), '••••••••');
  assert.equal(
    maskApiKey('sk-or-v1-abcdef1234567890'),
    'sk-or-v1••••••••7890'
  );
});

test('Given credentials in user store and project root, When loadEnvConfig is executed, Then cascading precedence is respected', async () => {
  const tempProjectDir = await mkdtemp(join(tmpdir(), 'bsh-project-test-'));
  const tempXdgDir = await mkdtemp(join(tmpdir(), 'bsh-xdg-test-'));
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  try {
    delete process.env.OPENROUTER_API_KEY;
    process.env.XDG_CONFIG_HOME = tempXdgDir;

    // Case 1: Empty everywhere
    const emptyConfig = await loadEnvConfig(tempProjectDir);
    assert.equal(emptyConfig.openRouterApiKey, undefined);
    assert.equal(emptyConfig.apiKeySource, 'none');

    // Case 2: Present in user store
    await saveUserAuth({ apiKey: 'sk-user-store-key' });
    const userStoreConfig = await loadEnvConfig(tempProjectDir);
    assert.equal(userStoreConfig.openRouterApiKey, 'sk-user-store-key');
    assert.equal(userStoreConfig.apiKeySource, 'user_store');

    // Case 3: Overridden by process.env
    process.env.OPENROUTER_API_KEY = 'sk-process-env-key';
    const envConfig = await loadEnvConfig(tempProjectDir);
    assert.equal(envConfig.openRouterApiKey, 'sk-process-env-key');
    assert.equal(envConfig.apiKeySource, 'env');
  } finally {
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
    await rm(tempProjectDir, { recursive: true, force: true });
    await rm(tempXdgDir, { recursive: true, force: true });
  }
});
