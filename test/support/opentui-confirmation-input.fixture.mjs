// BSH-GUARD-007: real production view and input controller; no renderer or API mocks.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createTestRenderer } from '@opentui/core/testing';
import { createTuiView } from '../../dist/tui/view.js';
import { SessionInputController } from '../../dist/tui/input.js';
import { InputQueueManager } from '../../dist/tui/inputQueue.js';
import { ExitGuard } from '../../dist/tui/exitGuard.js';

test('Given a pending confirmation When native Enter submits an empty field Then confirmation resolves without adding a task or history entry', async () => {
  const fixture = await createTestRenderer({ width: 80, height: 24 });
  const view = await createTuiView({ renderer: fixture.renderer });
  const queue = new InputQueueManager();
  const responses = [];
  const saved = [];
  let awaiting = false;
  const controller = new SessionInputController({ view, queue, exitGuard: new ExitGuard(),
    history: ['previous request'], isExecutingTurn: () => false,
    isAwaitingConfirmation: () => awaiting,
    onDispatch: value => { responses.push(value); awaiting = false; },
    onAbortTurn: () => {}, onToggleReasoning: () => {}, onTriggerSlashMenu: () => {},
    onSaveHistory: async history => saved.push(history), onExit: () => {},
  });
  try {
    fixture.mockInput.pressEnter();
    await fixture.renderOnce();
    assert.deepEqual(responses, []);
    awaiting = true;
    fixture.mockInput.pressEnter();
    await fixture.renderOnce();
    assert.deepEqual(responses, ['']);
    assert.equal(awaiting, false);
    assert.equal(queue.length, 0);
    assert.deepEqual(controller.getHistory(), ['previous request']);
    assert.deepEqual(saved, []);
    fixture.mockInput.pressEnter();
    await fixture.renderOnce();
    assert.deepEqual(responses, ['']);
    awaiting = true;
    await fixture.mockInput.typeText('/cancel');
    fixture.mockInput.pressEnter();
    await fixture.renderOnce();
    assert.deepEqual(responses, ['', '/cancel']);
    assert.equal(view.getPrompt(), '');
    assert.deepEqual(controller.getHistory(), ['previous request']);
  } finally { controller.destroy(); view.destroy(); }
});
