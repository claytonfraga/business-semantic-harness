import test from 'node:test';
import assert from 'node:assert/strict';
import { ExitGuard, cleanExitTerminal } from '../../dist/tui/exitGuard.js';
import { renderCompleteTui } from '../../dist/tui/render.js';

test('Given ExitGuard and a prompt with text, When Ctrl+C is pressed, Then it returns CLEARED_PROMPT and does not trigger exit alert', () => {
  const guard = new ExitGuard({ windowMs: 1500 });
  const decision = guard.handleCtrlC({
    hasPromptText: true,
    isExecutingTurn: false,
    now: 1000,
  });

  assert.equal(decision, 'CLEARED_PROMPT');
  assert.equal(guard.isExitPending(1000), false);
});

test('Given ExitGuard while executing turn, When Ctrl+C is pressed, Then it returns ABORTED_TURN and does not trigger exit alert', () => {
  const guard = new ExitGuard({ windowMs: 1500 });
  const decision = guard.handleCtrlC({
    hasPromptText: false,
    isExecutingTurn: true,
    now: 1000,
  });

  assert.equal(decision, 'ABORTED_TURN');
  assert.equal(guard.isExitPending(1000), false);
});

test('Given ExitGuard idle with empty prompt, When Ctrl+C is pressed once, Then it triggers ALERT_TRIGGERED and activates isExitPending for 1500ms', () => {
  const guard = new ExitGuard({ windowMs: 1500 });
  const decision = guard.handleCtrlC({
    hasPromptText: false,
    isExecutingTurn: false,
    now: 1000,
  });

  assert.equal(decision, 'ALERT_TRIGGERED');
  assert.equal(guard.isExitPending(1000), true);
  assert.equal(guard.isExitPending(2000), true); // 1000ms later, still within 1500ms window
  assert.equal(guard.isExitPending(2501), false); // 1501ms later, expired
});

test('Given ExitGuard with alert active, When second Ctrl+C occurs within 1500ms, Then it confirms EXIT_CONFIRMED and resets', () => {
  const guard = new ExitGuard({ windowMs: 1500 });
  
  // First Ctrl+C at t=1000
  const first = guard.handleCtrlC({
    hasPromptText: false,
    isExecutingTurn: false,
    now: 1000,
  });
  assert.equal(first, 'ALERT_TRIGGERED');

  // Second Ctrl+C at t=1800 (within 1500ms)
  const second = guard.handleCtrlC({
    hasPromptText: false,
    isExecutingTurn: false,
    now: 1800,
  });
  assert.equal(second, 'EXIT_CONFIRMED');
  assert.equal(guard.isExitPending(1801), false);
});

test('Given ExitGuard with expired alert (>1500ms), When Ctrl+C is pressed, Then it re-triggers ALERT_TRIGGERED instead of exiting', () => {
  const guard = new ExitGuard({ windowMs: 1500 });

  guard.handleCtrlC({
    hasPromptText: false,
    isExecutingTurn: false,
    now: 1000,
  });

  // Second Ctrl+C arrives at t=2600 (>1500ms elapsed)
  const third = guard.handleCtrlC({
    hasPromptText: false,
    isExecutingTurn: false,
    now: 2600,
  });
  assert.equal(third, 'ALERT_TRIGGERED');
  assert.equal(guard.isExitPending(2600), true);
});

test('Given renderCompleteTui with ctrlCExitAlert true, When rendered, Then separator above prompt displays exit warning while preserving height invariant', () => {
  const width = 80;
  const height = 24;

  const normalTui = renderCompleteTui({
    model: 'test/model',
    governed: true,
    tokensTotal: 100,
    width,
    height,
    ctrlCExitAlert: false,
  }, [], '', width, height);

  const alertTui = renderCompleteTui({
    model: 'test/model',
    governed: true,
    tokensTotal: 100,
    width,
    height,
    ctrlCExitAlert: true,
  }, [], '', width, height);

  const normalLines = normalTui.split('\n');
  const alertLines = alertTui.split('\n');

  // Height invariant: both must have identical line counts
  assert.equal(normalLines.length, height);
  assert.equal(alertLines.length, height);

  // Separator above prompt (row: height - 4)
  const alertSeparator = alertLines[height - 4];
  assert.match(alertSeparator, /Pressione Ctrl\+C novamente para fechar o BSH/);
});

test('Given cleanExitTerminal, When invoked, Then it writes full alternate buffer exit and screen clearing VT100 sequences', () => {
  let output = '';
  const mockStdout = {
    write(str) {
      output += str;
      return true;
    },
  };

  cleanExitTerminal(mockStdout);

  assert.ok(output.includes('\x1b[?1049l'), 'Must disable alternate screen buffer');
  assert.ok(output.includes('\x1b[2J'), 'Must clear visible screen');
  assert.ok(output.includes('\x1b[3J'), 'Must clear scrollback buffer');
  assert.ok(output.includes('\x1b[H'), 'Must position cursor at home (1,1)');
  assert.ok(output.includes('\x1b[?25h'), 'Must ensure cursor is visible');
});
