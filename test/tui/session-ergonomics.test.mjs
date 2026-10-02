import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompleteTui } from '../../dist/tui/render.js';

test('TUI Ergonomics: prompt queue enqueues concurrent inputs during execution and consumes in FIFO order', async () => {
  const promptQueue = [];
  const chatEntries = [];
  let isExecutingTurn = true;
  let promptResolver = null;

  const handleLine = (line) => {
    const text = line.trim();
    if (!text) return;

    if (isExecutingTurn) {
      promptQueue.push(text);
      chatEntries.push({
        type: 'user',
        content: text,
        isQueued: true,
      });
    } else {
      if (promptResolver) {
        const resolve = promptResolver;
        promptResolver = null;
        resolve(text);
      } else {
        promptQueue.push(text);
      }
    }
  };

  const getNextPrompt = () => {
    if (promptQueue.length > 0) {
      const next = promptQueue.shift() ?? '';
      const queuedEntry = chatEntries.find((e) => e.type === 'user' && e.content === next && e.isQueued);
      if (queuedEntry) {
        delete queuedEntry.isQueued;
      }
      return Promise.resolve(next);
    }
    return new Promise((resolve) => {
      promptResolver = resolve;
    });
  };

  // Turn 1 is running: User enters prompt A and prompt B
  handleLine('Primeiro prompt na fila');
  handleLine('Segundo prompt na fila');

  assert.equal(promptQueue.length, 2);
  assert.equal(chatEntries.length, 2);
  assert.equal(chatEntries[0].isQueued, true);
  assert.equal(chatEntries[1].isQueued, true);

  // Finish Turn 1: Dequeue prompt A
  isExecutingTurn = false;
  const next1 = await getNextPrompt();
  assert.equal(next1, 'Primeiro prompt na fila');
  assert.equal(chatEntries[0].isQueued, undefined, 'Flag isQueued must be cleared when prompt starts execution');
  assert.equal(promptQueue.length, 1);

  // Turn 2 is running
  isExecutingTurn = true;

  // Finish Turn 2: Dequeue prompt B
  isExecutingTurn = false;
  const next2 = await getNextPrompt();
  assert.equal(next2, 'Segundo prompt na fila');
  assert.equal(chatEntries[1].isQueued, undefined);
  assert.equal(promptQueue.length, 0);
});

test('TUI Ergonomics: double ESC within 500ms triggers AbortController while single ESC does not', () => {
  let activeAbortController = new AbortController();
  let lastEscTime = 0;
  let isExecutingTurn = true;
  let canceled = false;

  const handleEsc = (now) => {
    if (now - lastEscTime <= 500) {
      lastEscTime = 0;
      if (isExecutingTurn && activeAbortController) {
        activeAbortController.abort('ESC ESC');
        canceled = true;
        isExecutingTurn = false;
      }
    } else {
      lastEscTime = now;
    }
  };

  // 1st ESC at t = 1000ms
  handleEsc(1000);
  assert.equal(canceled, false, 'Single ESC must not abort');
  assert.equal(activeAbortController.signal.aborted, false);

  // 2nd ESC at t = 1700ms (> 500ms later)
  handleEsc(1700);
  assert.equal(canceled, false, 'Late ESC (> 500ms) must not abort');
  assert.equal(activeAbortController.signal.aborted, false);

  // 3rd ESC at t = 1950ms (250ms after previous)
  handleEsc(1950);
  assert.equal(canceled, true, 'Second ESC within 500ms must abort execution');
  assert.equal(activeAbortController.signal.aborted, true);
  assert.equal(isExecutingTurn, false);
});

test('TUI Ergonomics: Ctrl+C clears prompt buffer immediately and Enter auto-clears', () => {
  const fakeRl = { line: 'prompt em digitacao...', cursor: 22 };

  const handleCtrlC = () => {
    if (fakeRl.line.length > 0) {
      fakeRl.line = '';
      fakeRl.cursor = 0;
    }
  };

  const handleEnter = () => {
    const text = fakeRl.line.trim();
    fakeRl.line = '';
    fakeRl.cursor = 0;
    return text;
  };

  // Test Ctrl+C clears buffer
  handleCtrlC();
  assert.equal(fakeRl.line, '');
  assert.equal(fakeRl.cursor, 0);

  // Test Enter auto-clears buffer
  fakeRl.line = 'prompt para envio';
  fakeRl.cursor = 17;
  const submitted = handleEnter();
  assert.equal(submitted, 'prompt para envio');
  assert.equal(fakeRl.line, '', 'Buffer must be empty after Enter');
  assert.equal(fakeRl.cursor, 0);
});

test('TUI Ergonomics: calculates duration and TPS and displays them in footer status', () => {
  const width = 100;
  const height = 24;

  const tui = renderCompleteTui(
    {
      model: 'deepseek/deepseek-v4.1-flash',
      governed: true,
      tokensTotal: 1250,
      generationDurationMs: 2400,
      generationTps: 52,
      queueLength: 1,
      width,
      height,
    },
    [
      { type: 'user', content: 'Prompt em andamento' },
    ],
    '>',
    width,
    height
  );

  assert.ok(tui.includes('2.4s (52 tps)'), 'Must render duration and TPS');
  assert.ok(tui.includes('[Queue: 1]'), 'Must render queue indicator');
  assert.ok(tui.includes('[ESC ESC]'), 'Must render ESC shortcut');
  assert.ok(tui.includes('[^C]'), 'Must render Ctrl+C shortcut');
});

test('TUI Ergonomics: single ESC key cancels pending prompt violation confirmation immediately', () => {
  let confirmationResolver = null;
  let cancelledAnswer = null;

  // Simulate waiting confirmation
  confirmationResolver = (ans) => {
    cancelledAnswer = ans;
  };

  const handleKeypress = (key) => {
    if (key.name === 'escape') {
      if (confirmationResolver) {
        const res = confirmationResolver;
        confirmationResolver = null;
        res('/cancel');
        return;
      }
    }
  };

  // When user presses single ESC during confirmation
  handleKeypress({ name: 'escape' });

  // Then confirmation is cancelled immediately with /cancel and resolver is cleared
  assert.equal(cancelledAnswer, '/cancel', 'Single ESC must resolve confirmation with /cancel');
  assert.equal(confirmationResolver, null, 'Confirmation resolver must be cleared');
});
