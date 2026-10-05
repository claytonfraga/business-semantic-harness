import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadEnvConfig, parseEnvContent, saveEnvConfig } from '../../dist/config/env.js';

test('Given a raw env string When parseEnvContent is called Then key-value pairs and quotes are parsed properly', () => {
  const raw = `
# Comment line
OPENROUTER_API_KEY=sk-or-test-key
BSH_DEFAULT_MODEL="deepseek/deepseek-chat"
BSH_DEFAULT_DOMAIN='ativos'
EMPTY_VAL=
`;
  const parsed = parseEnvContent(raw);
  assert.equal(parsed.OPENROUTER_API_KEY, 'sk-or-test-key');
  assert.equal(parsed.BSH_DEFAULT_MODEL, 'deepseek/deepseek-chat');
  assert.equal(parsed.BSH_DEFAULT_DOMAIN, 'ativos');
  assert.equal(parsed.EMPTY_VAL, '');
});

test('Given a project with .env When loadEnvConfig is called Then properties are loaded', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-env-test-'));
  try {
    writeFileSync(
      join(tempDir, '.env'),
      'OPENROUTER_API_KEY=sk-or-sample-123\nBSH_DEFAULT_MODEL=meta-llama/llama-3.1-70b-instruct\n',
      'utf8'
    );
    const config = await loadEnvConfig(tempDir);
    assert.equal(config.openRouterApiKey, 'sk-or-sample-123');
    assert.equal(config.defaultModel, 'meta-llama/llama-3.1-70b-instruct');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Given updates to config When saveEnvConfig is called Then .env is created and updated', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'bsh-env-save-'));
  try {
    await saveEnvConfig({ OPENROUTER_API_KEY: 'sk-or-updated-key', BSH_DEFAULT_DOMAIN: 'finance' }, tempDir);
    const content = readFileSync(join(tempDir, '.env'), 'utf8');
    assert.match(content, /OPENROUTER_API_KEY=sk-or-updated-key/);
    assert.match(content, /BSH_DEFAULT_DOMAIN=finance/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
