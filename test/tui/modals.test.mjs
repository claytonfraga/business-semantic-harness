import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchModels, fuzzyScore, highlightMatches } from '../../dist/tui/modals.js';

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

test('fuzzyScore calculates scores, boundary bonuses, and matching character indices', () => {
  const match = fuzzyScore('anthropic/claude-3.5-sonnet', 'claude sonnet');
  assert.ok(match !== null, 'Should match multiple tokens');
  assert.ok(match.score > 50, 'Score should reflect word boundaries and matches');
  assert.ok(match.indices.length >= 12, 'Should capture character indices of matched tokens');

  const noMatch = fuzzyScore('openai/gpt-4o', 'gemini');
  assert.equal(noMatch, null, 'Should return null for non-matching patterns');
});

test('Given matching indices When a plain textual indication is requested Then matches are indicated without terminal escapes', () => {
  assert.equal(highlightMatches('deepseek', [0, 4]), '[d]eep[s]eek');
});

test('searchModels supports fuzzy subsequence search across reordered tokens', () => {
  const models = [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek Flash' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini Flash' },
  ];

  const matches = searchModels(models, 'sonnet 3.5');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'anthropic/claude-3.5-sonnet');

  const flashMatches = searchModels(models, 'flash deepseek');
  assert.equal(flashMatches.length, 1);
  assert.equal(flashMatches[0].id, 'deepseek/deepseek-v4.1-flash');
});


test('Given BSH-MENU-011 a non-TTY selector When piped search and numeric lines are supplied Then the selection returns without frames or renderer initialization', () => {
  const code = `import { selectSlashCommandModal } from './dist/tui/modals.js'; console.log('RESULT', await selectSlashCommandModal());`;
  const result = spawnSync(process.execPath,['--input-type=module','-e',code],{ cwd: process.cwd(), input: 'ex\n1\n',encoding:'utf8' });
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/RESULT \/exit/);
  assert.doesNotMatch(result.stdout,/\x1b|┌|└/);
});
