import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPromptViolation } from '../../dist/enforcement/promptGuard.js';

test('detectPromptViolation flags transfer of retired asset in domain ativos', () => {
  const result = detectPromptViolation(
    'Transfer retired asset AST-002 to Maintenance department without justification',
    'ativos'
  );

  assert.equal(result.isViolating, true);
  assert.equal(result.shape, 'TransferShape (ex:TransferenciaShape)');
  assert.match(result.rule, /Ativo baixado não pode ser transferido/);
  assert.ok(result.matchedKeywords.includes('transfer'));
});

test('detectPromptViolation flags double retirement in domain ativos', () => {
  const result = detectPromptViolation(
    'Dar baixa no ativo baixado AST-005',
    'ativos'
  );

  assert.equal(result.isViolating, true);
  assert.equal(result.shape, 'BaixaShape (ex:BaixaShape)');
  assert.match(result.rule, /não pode sofrer nova baixa/);
});

test('detectPromptViolation passes conforming transfer in domain ativos', () => {
  const result = detectPromptViolation(
    "Add an endpoint to transfer assets in 'In Operation' state with new owner and location",
    'ativos'
  );

  assert.equal(result.isViolating, false);
});

test('detectPromptViolation does not flag when domain is undefined or inactive', () => {
  const result = detectPromptViolation(
    'Transfer retired asset AST-002 to Maintenance department without justification',
    undefined
  );

  assert.equal(result.isViolating, false);
});
