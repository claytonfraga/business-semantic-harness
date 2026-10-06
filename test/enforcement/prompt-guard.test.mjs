import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPromptViolation } from '../../dist/enforcement/promptGuard.js';

test('BSH-GUARD-003 Given the asset domain When the prompt asks to remove an asset "nao baixado" Then no TransferShape violation is reported', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo nao baixado', 'ativos');
  assert.equal(result.isViolating, false);
  assert.equal(result.shape, undefined);
});

test('BSH-GUARD-003 Given the asset domain When the prompt asks to remove an asset "não baixado" with accent Then no violation is reported', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo não baixado', 'ativos');
  assert.equal(result.isViolating, false);
});

test('BSH-GUARD-003 Given the asset domain When the prompt says "remover um ativo" Then "remover" is not matched as "mover" and no violation is reported', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo', 'ativos');
  assert.equal(result.isViolating, false);
  assert.equal(result.matchedKeywords, undefined);
});

test('BSH-GUARD-003 Given the asset domain When the prompt asks to remove a retired asset Then removal is not treated as a transfer', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo baixado', 'ativos');
  assert.equal(result.isViolating, false);
  assert.equal(result.shape, undefined);
});

test('BSH-GUARD-003 Given the asset domain When the prompt transfers an asset "not retired" in English Then the negated state prevents a false positive', () => {
  const result = detectPromptViolation('transfer asset not retired to another department', 'ativos');
  assert.equal(result.isViolating, false);
});

test('BSH-GUARD-001 Given the asset domain When the user asks to transfer a "baixado" asset Then TransferShape is violated with rule, explanation and recognized terms', () => {
  const result = detectPromptViolation('transfira um ativo baixado para outro setor', 'ativos');
  assert.equal(result.isViolating, true);
  assert.ok(result.shape?.includes('TransferShape'));
  assert.match(result.rule, /Ativo baixado não pode ser transferido/);
  assert.ok(result.businessRationale.length > 0);
  assert.ok(result.matchedKeywords.includes('retired/baixado'));
});

test('BSH-GUARD-001 Given the asset-management domain alias When the user asks to transfer a retired asset in English Then TransferShape is violated', () => {
  const result = detectPromptViolation('transfer retired asset without justification', 'asset-management');
  assert.equal(result.isViolating, true);
  assert.ok(result.shape?.includes('TransferShape'));
});

test('BSH-GUARD-001 Given the asset domain When an in-operation asset is transferred Then the conforming request is permitted', () => {
  const result = detectPromptViolation('transfira um ativo em operação para a Unidade Vitória', 'ativos');
  assert.equal(result.isViolating, false);
});

test('BSH-GUARD-002 Given the asset domain When the user asks to retire an already retired asset Then BaixaShape is violated', () => {
  const result = detectPromptViolation('dar baixa em ativo já baixado', 'ativos');
  assert.equal(result.isViolating, true);
  assert.ok(result.shape?.includes('BaixaShape'));
});
