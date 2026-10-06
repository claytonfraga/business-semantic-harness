import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateContextBudget, assertContextBudget, ContextBudgetError } from '../../dist/governance/contextBudget.js';

test('Given BSH-PREP-015 a known selected-model window When the prepared payload fits Then the budget is accepted', () => {
  const result = evaluateContextBudget({ contextLength: 131072, messages: [{ role: 'user', content: 'hello' }], tools: [] });
  assert.equal(result.ok, true);
  assert.equal(result.limit, 131072);
  assert.match(result.method, /character/);
  assert.ok(result.estimatedTokens > 0);
});

test('Given BSH-PREP-015 a payload beyond the known window When checked before dispatch Then it is rejected with a diagnostic and no truncation', () => {
  const input = { contextLength: 1024, messages: [{ role: 'system', content: 'x'.repeat(20000) }] };
  const result = evaluateContextBudget(input);
  assert.equal(result.ok, false);
  assert.match(result.diagnostic, /exceeds the selected model window/);
  assert.ok(result.limitations.some(item => item.includes('tokenizers')));
  assert.throws(() => assertContextBudget(input), ContextBudgetError);
});

test('Given BSH-PREP-015 an unknown model window When checked Then dispatch is denied with a diagnostic without truncation', () => {
  const result = evaluateContextBudget({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.ok, false);
  assert.equal(result.limit, undefined);
  assert.ok(result.limitations.some(item => item.includes('unknown')));
  assert.match(result.diagnostic, /unknown/);
  assert.equal(result.availableTokens, undefined);
  assert.throws(() => assertContextBudget({ messages: [{ role: 'user', content: 'x'.repeat(200000) }] }), ContextBudgetError);
});

test('Given BSH-PREP-015 system instructions tools and reserved response When estimated Then all are counted', () => {
  const base = evaluateContextBudget({ contextLength: 100000, messages: [{ role: 'user', content: 'hi' }] });
  const withExtras = evaluateContextBudget({
    contextLength: 100000,
    messages: [{ role: 'user', content: 'hi' }],
    systemPrompt: 'y'.repeat(4000),
    tools: [{ type: 'function', function: { name: 't', description: 'd'.repeat(400), parameters: { type: 'object', properties: {} } } }],
  });
  assert.ok(withExtras.estimatedTokens > base.estimatedTokens);
  assert.equal(withExtras.reservedResponseTokens, 4096);
});
