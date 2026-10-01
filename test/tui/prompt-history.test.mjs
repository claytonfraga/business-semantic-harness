import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPromptHistory, savePromptHistory } from '../../dist/tui/history.js';

test('Prompt history: returns empty array when history file does not exist', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'bsh-hist-test-'));
  try {
    const history = await loadPromptHistory(tmp);
    assert.deepEqual(history, []);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Prompt history: saves and loads prompts per project preserving newest-first order for readline', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'bsh-hist-test-'));
  try {
    // Readline maintains history with newest first: ['third prompt', 'second prompt', 'first prompt']
    const readlineHistory = ['third prompt', 'second prompt', 'first prompt'];
    await savePromptHistory(tmp, readlineHistory);

    // Check disk storage format: must be chronological [first, second, third]
    const raw = await readFile(join(tmp, '.bsh', 'history.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, ['first prompt', 'second prompt', 'third prompt']);

    // Loading back should return in newest-first order
    const loaded = await loadPromptHistory(tmp);
    assert.deepEqual(loaded, ['third prompt', 'second prompt', 'first prompt']);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Prompt history: filters out empty prompts and limits to 1000 items', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'bsh-hist-test-'));
  try {
    const largeList = [];
    for (let i = 0; i < 1100; i++) {
      largeList.push(`prompt ${i}`);
    }
    largeList.push('');
    largeList.push('   ');

    await savePromptHistory(tmp, largeList);
    const loaded = await loadPromptHistory(tmp);
    assert.equal(loaded.length, 1000);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
