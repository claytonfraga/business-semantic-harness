import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPromptViolation } from '../../dist/enforcement/promptGuard.js';

test('detectPromptViolation: "faça um endpoint pra remover um ativo nao baixado" NÃO deve violar TransferShape (negação e remoção)', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo nao baixado', 'ativos');
  assert.equal(result.isViolating, false, 'Não deve violar TransferShape');
});

test('detectPromptViolation: "faça um endpoint pra remover um ativo não baixado" (com acento) NÃO deve violar', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo não baixado', 'ativos');
  assert.equal(result.isViolating, false, 'Não deve violar com acento');
});

test('detectPromptViolation: "faça um endpoint pra remover um ativo" NÃO deve casar com "mover" nem violar', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo', 'ativos');
  assert.equal(result.isViolating, false, 'remover não pode casar com mover');
});

test('detectPromptViolation: "faça um endpoint pra remover um ativo baixado" NÃO é transferência', () => {
  const result = detectPromptViolation('faça um endpoint pra remover um ativo baixado', 'ativos');
  assert.equal(result.isViolating, false, 'Remoção de ativo baixado não é transferência');
});

test('detectPromptViolation: "transfira um ativo baixado" DEVE violar TransferShape', () => {
  const result = detectPromptViolation('transfira um ativo baixado para outro setor', 'ativos');
  assert.equal(result.isViolating, true, 'Deve violar TransferShape');
  assert.ok(result.shape?.includes('TransferShape'));
});

test('detectPromptViolation: "transfer retired asset without justification" DEVE violar TransferShape', () => {
  const result = detectPromptViolation('transfer retired asset without justification', 'asset-management');
  assert.equal(result.isViolating, true, 'Deve violar');
  assert.ok(result.shape?.includes('TransferShape'));
});

test('detectPromptViolation: "transfira um ativo em operação para a Unidade Vitória" é permitido', () => {
  const result = detectPromptViolation('transfira um ativo em operação para a Unidade Vitória', 'ativos');
  assert.equal(result.isViolating, false, 'Transferência de ativo em operação é permitida');
});

test('detectPromptViolation: "dar baixa em ativo já baixado" DEVE violar BaixaShape', () => {
  const result = detectPromptViolation('dar baixa em ativo já baixado', 'ativos');
  assert.equal(result.isViolating, true, 'Deve violar BaixaShape');
  assert.ok(result.shape?.includes('BaixaShape'));
});
