import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { detectPromptViolation } from '../../dist/enforcement/promptGuard.js';
import { loadEnvConfig, saveEnvConfig } from '../../dist/config/env.js';
import { renderCompleteTui } from '../../dist/tui/render.js';

test('Given a project with active domain ativos, when a violating prompt is captured, then detectPromptViolation detects the violation and renders the warning banner', async () => {
  const prompt = 'Transfer retired asset AST-002 to Maintenance department without justification';
  const domain = 'ativos';

  // When prompt is evaluated
  const violation = detectPromptViolation(prompt, domain);

  // Then it must flag violation against TransferShape
  assert.equal(violation.isViolating, true);
  assert.ok(violation.shape?.includes('TransferShape'));
  assert.ok(violation.rule?.includes('Ativo baixado'));

  // And when rendered in the TUI, it must display the alert badge and confirmation prompt
  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 500,
      width: 96,
      height: 24,
    },
    [
      { type: 'user', content: prompt, isViolating: true },
      {
        type: 'prompt_violation',
        violationShape: violation.shape,
        violationRule: violation.rule,
        content: violation.message,
        waitingConfirmation: true,
      },
    ],
    '[Enter para prosseguir /cancel para abortar] >',
    96,
    24
  );

  assert.ok(tui.includes('[!] VIOLATION DETECTED'));
  assert.ok(tui.includes('[!] [PROMPT VIOLATION DETECTED]'));
  assert.ok(tui.includes('TransferShape'));
  assert.ok(tui.includes('Pressione [Enter] para prosseguir'));
});

test('Given project settings, when user toggles confirmPromptViolations, then the updated setting is saved and reloaded accurately', async () => {
  const tempProject = mkdtempSync(join(tmpdir(), 'bsh-settings-test-'));

  try {
    // 1. Initial default state: confirmPromptViolations is true by default
    const initialConfig = await loadEnvConfig(tempProject);
    assert.equal(initialConfig.confirmPromptViolations, true);

    // 2. Toggle setting to false (disabled)
    await saveEnvConfig({ BSH_CONFIRM_PROMPT_VIOLATIONS: 'false' }, tempProject);
    const updatedConfig1 = await loadEnvConfig(tempProject);
    assert.equal(updatedConfig1.confirmPromptViolations, false);

    // 3. Toggle setting back to true (enabled)
    await saveEnvConfig({ BSH_CONFIRM_PROMPT_VIOLATIONS: 'true' }, tempProject);
    const updatedConfig2 = await loadEnvConfig(tempProject);
    assert.equal(updatedConfig2.confirmPromptViolations, true);
  } finally {
    rmSync(tempProject, { recursive: true, force: true });
  }
});
