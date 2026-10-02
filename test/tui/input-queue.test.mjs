import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputQueueManager } from '../../dist/tui/inputQueue.js';

test('InputQueueManager: manages FIFO queue operations correctly', () => {
  const q = new InputQueueManager();
  assert.equal(q.length, 0);
  assert.equal(q.hasItems, false);

  q.enqueue('prompt-1');
  q.enqueue('prompt-2');
  assert.equal(q.length, 2);
  assert.equal(q.hasItems, true);

  assert.equal(q.dequeue(), 'prompt-1');
  assert.equal(q.length, 1);
  assert.equal(q.dequeue(), 'prompt-2');
  assert.equal(q.length, 0);
  assert.equal(q.dequeue(), undefined);

  q.enqueue('item-a');
  q.clear();
  assert.equal(q.length, 0);
  assert.equal(q.hasItems, false);
});

test('InputQueueManager: evaluates escape latch with 500ms threshold', () => {
  const q = new InputQueueManager();

  // First press
  assert.equal(q.handleEscape(1000), false);

  // Second slow press (> 500ms)
  assert.equal(q.handleEscape(1600), false);

  // Fast second press (<= 500ms from 1600)
  assert.equal(q.handleEscape(1850), true);

  // Next press resets latch
  assert.equal(q.handleEscape(1900), false);
});

test('InputQueueManager: accumulates and completes multiline blocks with triple quotes', () => {
  const q = new InputQueueManager();
  assert.equal(q.isMultiline, false);

  // Line not in multiline mode
  const res1 = q.processLineInput('regular single line');
  assert.equal(res1.isHandled, false);

  // Start multiline mode with """
  const res2 = q.processLineInput('"""');
  assert.equal(res2.isHandled, true);
  assert.equal(q.isMultiline, true);
  assert.ok(res2.hint?.includes('Modo Multilinha'));

  // Intermediate lines
  const res3 = q.processLineInput('const x = 10;');
  assert.equal(res3.isHandled, true);
  assert.equal(res3.completePrompt, undefined);

  // Closing line with """
  const res4 = q.processLineInput('"""');
  assert.equal(res4.isHandled, true);
  assert.equal(q.isMultiline, false);
  assert.equal(res4.completePrompt, 'const x = 10;');
});
