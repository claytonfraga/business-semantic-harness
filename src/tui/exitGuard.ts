/**
 * Decision resulting from a Ctrl+C key event handled by ExitGuard.
 */
export type CtrlCDecision =
  | 'CLEARED_PROMPT'
  | 'ABORTED_TURN'
  | 'ALERT_TRIGGERED'
  | 'EXIT_CONFIRMED';

export interface ExitGuardOptions {
  windowMs?: number;
}

/**
 * Manages the double Ctrl+C exit guard state machine.
 * Follows Single Responsibility Principle (SRP) with zero TUI coupling.
 */
export class ExitGuard {
  private readonly windowMs: number;
  private lastCtrlCTime = 0;

  constructor(options: ExitGuardOptions = {}) {
    this.windowMs = options.windowMs ?? 1500;
  }

  /**
   * Processes a Ctrl+C key event and returns the appropriate action.
   */
  public handleCtrlC(options: {
    hasPromptText: boolean;
    isExecutingTurn: boolean;
    now?: number;
  }): CtrlCDecision {
    const now = options.now ?? Date.now();

    // Priority 1: If there is text in the prompt buffer, clear the text without triggering exit
    if (options.hasPromptText) {
      this.reset();
      return 'CLEARED_PROMPT';
    }

    // Priority 2: If a model turn is executing, abort the turn without exiting the session
    if (options.isExecutingTurn) {
      this.reset();
      return 'ABORTED_TURN';
    }

    // Priority 3: When idle with empty prompt, check if this is the second Ctrl+C within the latch window
    if (this.lastCtrlCTime > 0 && now - this.lastCtrlCTime <= this.windowMs) {
      this.reset();
      return 'EXIT_CONFIRMED';
    }

    // Otherwise, this is the first Ctrl+C: latch the exit confirmation and trigger the alert
    this.lastCtrlCTime = now;
    return 'ALERT_TRIGGERED';
  }

  /**
   * Checks whether the exit confirmation alert is currently active.
   */
  public isExitPending(now = Date.now()): boolean {
    return this.lastCtrlCTime > 0 && now - this.lastCtrlCTime <= this.windowMs;
  }

  /**
   * Resets the exit guard state.
   */
  public reset(): void {
    this.lastCtrlCTime = 0;
  }
}

/**
 * Sends POSIX/VT100 escape sequences to restore the terminal, disable alternate buffer,
 * clear screen and scrollback, and position the cursor at line 1.
 */
export function cleanExitTerminal(output: { write(str: string): unknown } = process.stdout): void {
  // \x1b[?1049l : disable alternate screen buffer
  // \x1b[2J     : clear entire visible screen
  // \x1b[3J     : clear scrollback buffer
  // \x1b[H      : move cursor to top-left (1,1)
  // \x1b[?25h   : show cursor
  output.write('\x1b[?1049l\x1b[2J\x1b[3J\x1b[H\x1b[?25h');
}
