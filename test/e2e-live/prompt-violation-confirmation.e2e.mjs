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

test('Given a user prompt requesting to remove an active (non-retired) asset, when prompt guard evaluates it, then it conforms and does not trigger false positive violation', async () => {
  const prompt = 'faça um endpoint pra remover um ativo nao baixado';
  const domain = 'ativos';

  // When evaluated
  const violation = detectPromptViolation(prompt, domain);

  // Then it must NOT flag violation
  assert.equal(violation.isViolating, false, 'Non-retired asset removal must not trigger violation');
  assert.equal(violation.shape, undefined);

  // And when rendered in TUI, it must display normally without violation badge
  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 120,
      width: 90,
      height: 22,
    },
    [{ type: 'user', content: prompt, isViolating: false }],
    '>',
    90,
    22
  );

  assert.ok(!tui.includes('[!] VIOLATION DETECTED'), 'Must not display violation detected badge');
  assert.ok(!tui.includes('[PROMPT VIOLATION DETECTED]'), 'Must not display prompt violation warning');
});

test('Given a user prompt explicitly transferring a retired asset, when prompt guard evaluates it, then it detects TransferShape violation', async () => {
  const prompt = 'faça um endpoint pra transferir um ativo baixado';
  const domain = 'ativos';

  const violation = detectPromptViolation(prompt, domain);

  assert.equal(violation.isViolating, true, 'Transferring a retired asset must trigger violation');
  assert.ok(violation.shape?.includes('TransferShape'));
  assert.ok(violation.rule?.includes('Ativo baixado'));
});

test('Given prompt history navigation and confirmation banners, when rendered, then the prompt input line is strictly 1 single line and maintains exact terminal height', async () => {
  const width = 88;
  const height = 24;

  const longPrompt = 'faça um endpoint pra remover um ativo nao baixado com critérios adicionais de validação organizacional';

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 340,
      width,
      height,
    },
    [
      { type: 'user', content: 'Primeiro prompt de consulta', isViolating: false },
      { type: 'agent', content: 'Resposta do agente com análise de código.' },
    ],
    `[Enter para prosseguir /cancel para abortar] > ${longPrompt}`,
    width,
    height
  );

  const lines = tui.split('\n');
  assert.equal(lines.length, height, `TUI height must strictly equal ${height}`);

  // The prompt input line is line index 20 (height - 4 in 24-line layout)
  // Check that the prompt input appears in only 1 line
  const promptLines = lines.filter((l) => l.includes('[Enter para prosseguir'));
  assert.equal(promptLines.length, 1, 'Prompt input with prefix must appear on exactly 1 line');
});

test('Given a conforming preliminary inspection When its gate is rendered Then it discloses that final promotion authorization is still required', async () => {
  const prompt = 'faça um endpoint pra remover um ativo nao baixado';
  const domain = 'ativos';

  const violation = detectPromptViolation(prompt, domain);
  assert.equal(violation.isViolating, false);

  const checks = [
    { ok: true, text: 'Modificações concretas aplicadas (7 arquivos, +154 / -4 linhas)' },
    { ok: true, text: 'Transição de código e propriedades semânticas válidas' },
  ];

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 1770,
      width: 90,
      height: 24,
    },
    [
      { type: 'user', content: prompt, isViolating: false },
      {
        type: 'gate',
        gateShape: 'AtivosGovernanceShape',
        gateChecks: checks,
        gateStatus: 'CONFORMING',
      },
    ],
    '>',
    90,
    24
  );

  assert.ok(tui.includes('[OK] CONFORMING'), 'Gate must display [OK] CONFORMING');
  assert.ok(tui.includes('Status: CONFORMING (Preliminary inspection; subject to promotion gate)'), 'Gate must disclose preliminary scope');
  assert.ok(!tui.includes('Ready to promote'), 'Preliminary inspection cannot promise promotion');
  assert.ok(!tui.includes('[X] VIOLATION'), 'Gate must NOT display [X] VIOLATION');
  assert.ok(!tui.includes('Promotion blocked'), 'Gate must NOT display Promotion blocked');
});

test('Given a session with violation status, when gate renders, then it strictly contains [X] failing checks and never contradicts itself with only [+] checks', async () => {
  const checksWithFailure = [
    { ok: true, text: 'Modificações concretas aplicadas (3 arquivos, +42 / -2 linhas)' },
    { ok: false, text: 'TransferShape: Invariante de Ciclo de Vida: Ativo baixado não pode ser transferido.' },
  ];

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      contextLength: 1048576,
      domain: 'ativos',
      governed: true,
      tokensTotal: 1200,
      width: 90,
      height: 24,
    },
    [
      {
        type: 'gate',
        gateShape: 'TransferShape',
        gateChecks: checksWithFailure,
        gateStatus: 'VIOLATION',
      },
    ],
    '>',
    90,
    24
  );

  assert.ok(tui.includes('[X] VIOLATION'), 'Must display [X] VIOLATION');
  assert.ok(tui.includes('Status: VIOLATION (Promotion blocked)'), 'Must display Promotion blocked');
  assert.ok(tui.includes('[X]'), 'Must display failing check [X] icon');
  assert.ok(tui.includes('TransferShape: Invariante de Ciclo de Vida'), 'Must display failing check explanation');
});

