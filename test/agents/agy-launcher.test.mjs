import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extrairTokens } from '../../dist/agents/agy/launcher.js';

test('agy: Given the agy JSON output, when extracting tokens, then input/output/thinking/cache/total are parsed', () => {
  const saida = JSON.stringify({
    conversation_id: 'x', status: 'SUCCESS', response: 'ok',
    usage: { input_tokens: 120, output_tokens: 30, thinking_tokens: 7, cache_read_tokens: 12, total_tokens: 150 },
  });
  const tokens = extrairTokens(saida);
  assert.deepEqual(tokens, { entrada: 120, saida: 30, cache: 12, raciocinio: 7, totais: 150 });
});

test('agy: Given an interrupted output with zero usage, when extracting tokens, then it returns undefined instead of zero', () => {
  const saida = JSON.stringify({ status: 'ERROR', error: 'interrupted', usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 } });
  assert.equal(extrairTokens(saida), undefined);
});

test('agy: Given output without usage, when extracting tokens, then it returns undefined', () => {
  assert.equal(extrairTokens('linha qualquer\n{"status":"SUCCESS"}'), undefined);
});

test('agy: Given output that is not JSON, when extracting tokens, then it returns undefined', () => {
  assert.equal(extrairTokens('nao e json'), undefined);
});
