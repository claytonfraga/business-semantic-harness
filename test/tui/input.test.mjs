import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionInputController } from '../../dist/tui/input.js';
import { InputQueueManager } from '../../dist/tui/inputQueue.js';
import { ExitGuard } from '../../dist/tui/exitGuard.js';

function createMockView() {
  let promptText = '';
  let activeDialog = false;
  let scrollDelta = 0;
  const submitListeners = new Set();
  const keyListeners = new Set();

  return {
    getPrompt: () => promptText,
    setPrompt: (val) => { promptText = val; },
    get dialogActive() { return activeDialog; },
    setDialogActive: (val) => { activeDialog = val; },
    scrollBy: (delta) => { scrollDelta += delta; },
    getScrollDelta: () => scrollDelta,
    focusPrompt: () => {},
    onSubmit: (fn) => { submitListeners.add(fn); return () => submitListeners.delete(fn); },
    onKeypress: (fn) => { keyListeners.add(fn); return () => keyListeners.delete(fn); },
    emitSubmit: (val) => { for (const fn of submitListeners) fn(val); },
    emitKey: (event) => { for (const fn of keyListeners) fn(event); },
  };
}

test('Given SessionInputController When text is submitted during active turn Then it is enqueued', () => {
  const view = createMockView();
  const queue = new InputQueueManager();
  const exitGuard = new ExitGuard();
  const dispatched = [];
  let executing = true;

  const controller = new SessionInputController({
    view,
    queue,
    exitGuard,
    history: [],
    isExecutingTurn: () => executing,
    onDispatch: (p) => dispatched.push(p),
    onAbortTurn: () => {},
    onToggleReasoning: () => {},
    onTriggerSlashMenu: () => {},
    onSaveHistory: async () => {},
    onExit: () => {},
  });

  view.setPrompt('First prompt while executing');
  view.emitSubmit('First prompt while executing');

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0], 'First prompt while executing');
  controller.destroy();
});

test('Given SessionInputController When Ctrl+C is pressed with prompt text Then prompt is cleared without exit', () => {
  const view = createMockView();
  const queue = new InputQueueManager();
  const exitGuard = new ExitGuard();
  let exitCalled = false;

  const controller = new SessionInputController({
    view,
    queue,
    exitGuard,
    history: [],
    isExecutingTurn: () => false,
    onDispatch: () => {},
    onAbortTurn: () => {},
    onToggleReasoning: () => {},
    onTriggerSlashMenu: () => {},
    onSaveHistory: async () => {},
    onExit: () => { exitCalled = true; },
  });

  view.setPrompt('Draft text');
  view.emitKey({ name: 'c', ctrl: true });

  assert.equal(view.getPrompt(), '');
  assert.equal(exitCalled, false);
  controller.destroy();
});

test('Given SessionInputController When Ctrl+C is pressed twice within 1500ms on empty prompt Then exit is confirmed', () => {
  const view = createMockView();
  const queue = new InputQueueManager();
  const exitGuard = new ExitGuard();
  let exitCalled = false;

  const controller = new SessionInputController({
    view,
    queue,
    exitGuard,
    history: [],
    isExecutingTurn: () => false,
    onDispatch: () => {},
    onAbortTurn: () => {},
    onToggleReasoning: () => {},
    onTriggerSlashMenu: () => {},
    onSaveHistory: async () => {},
    onExit: () => { exitCalled = true; },
  });

  view.setPrompt('');
  view.emitKey({ name: 'c', ctrl: true });
  assert.equal(exitCalled, false);

  view.emitKey({ name: 'c', ctrl: true });
  assert.equal(exitCalled, true);
  controller.destroy();
});

test('Given SessionInputController When slash is typed on empty prompt Then slash menu is triggered', () => {
  const view = createMockView();
  const queue = new InputQueueManager();
  const exitGuard = new ExitGuard();
  let menuTriggered = false;

  const controller = new SessionInputController({
    view,
    queue,
    exitGuard,
    history: [],
    isExecutingTurn: () => false,
    onDispatch: () => {},
    onAbortTurn: () => {},
    onToggleReasoning: () => {},
    onTriggerSlashMenu: () => { menuTriggered = true; },
    onSaveHistory: async () => {},
    onExit: () => {},
  });

  view.setPrompt('');
  view.emitKey({ name: '/' });
  assert.equal(menuTriggered, true);
  controller.destroy();
});

test('Given SessionInputController When history navigation occurs with Up and Down arrows Then prompt cycles correctly', () => {
  const view = createMockView();
  const queue = new InputQueueManager();
  const exitGuard = new ExitGuard();

  const controller = new SessionInputController({
    view,
    queue,
    exitGuard,
    history: ['prompt-newest', 'prompt-older'],
    isExecutingTurn: () => false,
    onDispatch: () => {},
    onAbortTurn: () => {},
    onToggleReasoning: () => {},
    onTriggerSlashMenu: () => {},
    onSaveHistory: async () => {},
    onExit: () => {},
  });

  view.setPrompt('');
  view.emitKey({ name: 'up' });
  assert.equal(view.getPrompt(), 'prompt-newest');

  view.emitKey({ name: 'up' });
  assert.equal(view.getPrompt(), 'prompt-older');

  view.emitKey({ name: 'down' });
  assert.equal(view.getPrompt(), 'prompt-newest');

  view.emitKey({ name: 'down' });
  assert.equal(view.getPrompt(), '');
  controller.destroy();
});

test('Given SessionInputController When multiline input is submitted Then it accumulates until closing delimiter', () => {
  const view = createMockView();
  const queue = new InputQueueManager();
  const exitGuard = new ExitGuard();
  const dispatched = [];

  const controller = new SessionInputController({
    view,
    queue,
    exitGuard,
    history: [],
    isExecutingTurn: () => false,
    onDispatch: (p) => dispatched.push(p),
    onAbortTurn: () => {},
    onToggleReasoning: () => {},
    onTriggerSlashMenu: () => {},
    onSaveHistory: async () => {},
    onExit: () => {},
  });

  view.emitSubmit('"""First line');
  assert.equal(dispatched.length, 0);

  view.emitSubmit('Second line');
  assert.equal(dispatched.length, 0);

  view.emitSubmit('Third line"""');
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0], 'First line\nSecond line\nThird line');
  controller.destroy();
});
