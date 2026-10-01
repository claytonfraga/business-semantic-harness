import test from 'node:test';
import assert from 'node:assert/strict';
import { searchModels } from '../../dist/tui/modals.js';

test('searchModels filters by model ID case-insensitively', () => {
  const models = [
    { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000 },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', context_length: 128000 },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context_length: 200000 },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', context_length: 64000 },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', context_length: 1048576 },
  ];

  const gptMatches = searchModels(models, 'gpt');
  assert.equal(gptMatches.length, 2);
  assert.equal(gptMatches[0].id, 'openai/gpt-4o');
  assert.equal(gptMatches[1].id, 'openai/gpt-4o-mini');

  const claudeMatches = searchModels(models, 'CLAUDE');
  assert.equal(claudeMatches.length, 1);
  assert.equal(claudeMatches[0].id, 'anthropic/claude-3.5-sonnet');
});

test('searchModels filters by model description and name', () => {
  const models = [
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Meta open weights reasoning' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Open reasoning model' },
  ];

  const reasoningMatches = searchModels(models, 'reasoning');
  assert.equal(reasoningMatches.length, 2);
});

test('searchModels returns empty array on empty query', () => {
  const models = [{ id: 'openai/gpt-4o' }];
  assert.deepEqual(searchModels(models, ''), []);
  assert.deepEqual(searchModels(models, '   '), []);
});
