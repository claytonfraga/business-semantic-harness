import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPromptViolation } from '../../dist/enforcement/promptGuard.js';

test('Given a prompt requesting creation of automated tests for a forbidden operation, When detectPromptViolation is evaluated, Then it is recognized as a test instruction and not flagged as a violation', () => {
  const prompt = 'Escreva um teste unitário para garantir que a transferência de ativo baixado seja bloqueada';
  const result = detectPromptViolation(prompt, 'ativos');

  assert.equal(result.isViolating, false);
  assert.equal(result.isTestInstruction, true);
  assert.equal(result.mechanism, 'REGEX_INTENT_TRIAGE');
  assert.ok(result.limitations.toLowerCase().includes('heurística'));
});

test('Given a prompt containing a local clause negation of a prohibited action, When detectPromptViolation is evaluated, Then the prompt is not misclassified as a violation', () => {
  const prompt = 'Não transfira o ativo baixado, apenas liste os seus dados cadastrais no console';
  const result = detectPromptViolation(prompt, 'ativos');

  assert.equal(result.isViolating, false);
  assert.equal(result.mechanism, 'REGEX_INTENT_TRIAGE');
  assert.ok(result.limitations.length > 0);
});

test('Given a prompt directly demanding execution of a prohibited domain action, When detectPromptViolation is evaluated, Then it flags the violation and reports metadata', () => {
  const prompt = 'Transfira o ativo baixado AST-999 para o departamento financeiro agora';
  const result = detectPromptViolation(prompt, 'ativos');

  assert.equal(result.isViolating, true);
  assert.equal(result.mechanism, 'REGEX_INTENT_TRIAGE');
  assert.ok(result.shape.includes('TransferenciaShape'));
  assert.ok(result.limitations.toLowerCase().includes('shacl'));
});

test('Given an ambiguous prompt with multiple clauses, When detectPromptViolation is evaluated, Then triage records the heuristic mechanism and its limitations', () => {
  const prompt = 'Verifique o status do ativo e, se estiver ativo, transfira; se estiver baixado, não transfira';
  const result = detectPromptViolation(prompt, 'ativos');

  // Because of local negation 'não transfira', it does not falsely treat it as an unmitigated violation
  assert.equal(result.isViolating, false);
  assert.equal(result.mechanism, 'REGEX_INTENT_TRIAGE');
  assert.ok(result.limitations.toLowerCase().includes('heurística'));
});
