import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPromptViolation,
  registerDomainPromptRule,
  clearDomainPromptRules,
} from '../../dist/enforcement/promptGuard.js';

test('BSH-GUARD-001 Given the asset domain When a retired asset transfer lacks justification Then TransferShape is flagged with rule and recognized keywords', () => {
  const result = detectPromptViolation(
    'Transfer retired asset AST-002 to Maintenance department without justification',
    'ativos'
  );

  assert.equal(result.isViolating, true);
  assert.equal(result.shape, 'TransferShape (ex:TransferenciaShape)');
  assert.match(result.rule, /Ativo baixado não pode ser transferido/);
  assert.ok(result.matchedKeywords.includes('transfer'));
  assert.ok(result.matchedKeywords.includes('sem justificativa'));
});

test('BSH-GUARD-002 Given the asset domain When a retired asset is retired again Then BaixaShape is flagged with the state rule', () => {
  const result = detectPromptViolation('Dar baixa no ativo baixado AST-005', 'ativos');

  assert.equal(result.isViolating, true);
  assert.equal(result.shape, 'BaixaShape (ex:BaixaShape)');
  assert.match(result.rule, /não pode sofrer nova baixa/);
});

test('BSH-GUARD-002 Given the asset domain When a sensitive retirement lacks justification Then the justification and distinct approver alert is raised', () => {
  const result = detectPromptViolation('Dar baixa sem justificativa', 'ativos');

  assert.equal(result.isViolating, true);
  assert.equal(result.shape, 'TransferShape / BaixaShape');
  assert.match(result.rule, /Justificativa e Aprovador Distinto/);
  assert.deepEqual(result.matchedKeywords, ['sem justificativa']);
});

test('BSH-GUARD-001 Given the asset domain When a conforming in-operation transfer is requested Then the prompt is not flagged', () => {
  const result = detectPromptViolation(
    "Add an endpoint to transfer assets in 'In Operation' state with new owner and location",
    'ativos'
  );

  assert.equal(result.isViolating, false);
});

test('BSH-GUARD-004 Given no active domain When a violating-looking prompt is evaluated Then no asset violation is invented', () => {
  const result = detectPromptViolation(
    'Transfer retired asset AST-002 to Maintenance department without justification',
    undefined
  );

  assert.equal(result.isViolating, false);
  assert.equal(result.shape, undefined);
});

test('BSH-GUARD-004 Given an asset domain When the prompt is empty Then no violation is invented', () => {
  const result = detectPromptViolation('', 'ativos');

  assert.equal(result.isViolating, false);
  assert.equal(result.shape, undefined);
});

test('BSH-GUARD-004 Given a domain without registered prompt rules When an asset-like prompt is evaluated Then no asset violation is invented', () => {
  const result = detectPromptViolation('Transfer retired asset AST-002', 'unrelated-domain');

  assert.equal(result.isViolating, false);
  assert.equal(result.shape, undefined);
});

test('BSH-GUARD-001 Given a synthetic domain rule registered at runtime When a matching prompt is evaluated Then the rule result is returned and clearing the domain removes it', () => {
  registerDomainPromptRule({
    id: 'synthetic-forbidden-op',
    domainId: 'synthetic-domain',
    check: normalized => normalized.includes('forbidden-op')
      ? {
          isViolating: true,
          mechanism: 'REGEX_INTENT_TRIAGE',
          limitations: 'synthetic',
          shape: 'SyntheticShape',
          rule: 'Synthetic rule',
        }
      : null,
  });
  try {
    const hit = detectPromptViolation('please run FORBIDDEN-OP now', 'synthetic-domain');
    assert.equal(hit.isViolating, true);
    assert.equal(hit.shape, 'SyntheticShape');
  } finally {
    clearDomainPromptRules('synthetic-domain');
  }
  assert.equal(detectPromptViolation('please run FORBIDDEN-OP now', 'synthetic-domain').isViolating, false);
});
