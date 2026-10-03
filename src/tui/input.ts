import type { KeyEvent } from '@opentui/core';
import type { TuiView } from './view.js';
import type { InputQueueManager } from './inputQueue.js';
import type { ExitGuard } from './exitGuard.js';

export interface SessionInputControllerOptions {
  view: TuiView;
  queue: InputQueueManager;
  exitGuard: ExitGuard;
  history: string[];
  isExecutingTurn: () => boolean;
  onDispatch: (prompt: string) => void;
  onAbortTurn: (reason: string) => void;
  onCancelConfirmation?: () => boolean;
  onToggleReasoning: () => void;
  onTriggerSlashMenu: () => void;
  onSaveHistory: (history: string[]) => Promise<void>;
  onExit: () => void;
  onAlertChange?: (pending: boolean) => void;
}

export class SessionInputController {
  private view: TuiView;
  private queue: InputQueueManager;
  private exitGuard: ExitGuard;
  private history: string[];
  private historyIndex = -1;
  private draft = '';
  private isExecutingTurn: () => boolean;
  private onDispatch: (prompt: string) => void;
  private onAbortTurn: (reason: string) => void;
  private onCancelConfirmation?: () => boolean;
  private onToggleReasoning: () => void;
  private onTriggerSlashMenu: () => void;
  private onSaveHistory: (history: string[]) => Promise<void>;
  private onExit: () => void;
  private onAlertChange?: (pending: boolean) => void;
  private unbindSubmit: () => void;
  private unbindKeypress: () => void;

  constructor(options: SessionInputControllerOptions) {
    this.view = options.view;
    this.queue = options.queue;
    this.exitGuard = options.exitGuard;
    this.history = [...options.history];
    this.isExecutingTurn = options.isExecutingTurn;
    this.onDispatch = options.onDispatch;
    this.onAbortTurn = options.onAbortTurn;
    this.onCancelConfirmation = options.onCancelConfirmation;
    this.onToggleReasoning = options.onToggleReasoning;
    this.onTriggerSlashMenu = options.onTriggerSlashMenu;
    this.onSaveHistory = options.onSaveHistory;
    this.onExit = options.onExit;
    this.onAlertChange = options.onAlertChange;

    this.unbindSubmit = this.view.onSubmit(text => this.handleSubmit(text));
    this.unbindKeypress = this.view.onKeypress(event => this.handleKeypress(event));
  }

  public handleKeypress(event: KeyEvent): boolean {
    if (this.view.dialogActive) {
      return false;
    }

    // Ctrl+C handling via ExitGuard
    if (event.ctrl && event.name === 'c') {
      const hasPromptText = this.view.getPrompt().length > 0;
      const decision = this.exitGuard.handleCtrlC({
        hasPromptText,
        isExecutingTurn: this.isExecutingTurn(),
      });
      if (decision === 'CLEARED_PROMPT') {
        this.view.setPrompt('');
        this.historyIndex = -1;
        this.draft = '';
        this.onAlertChange?.(false);
      } else if (decision === 'ABORTED_TURN') {
        this.onAbortTurn('Ctrl+C');
        this.onAlertChange?.(false);
      } else if (decision === 'ALERT_TRIGGERED') {
        this.onAlertChange?.(true);
      } else if (decision === 'EXIT_CONFIRMED') {
        this.onAlertChange?.(false);
        this.onExit();
      }
      return true;
    }

    // If an alert was pending and any other key is pressed, reset alert
    if (this.exitGuard.isExitPending() && !event.ctrl) {
      this.exitGuard.reset();
      this.onAlertChange?.(false);
    }

    // Ctrl+O: toggle reasoning collapse
    if (event.ctrl && event.name === 'o') {
      this.onToggleReasoning();
      return true;
    }

    // Ctrl+M: model selector (when idle)
    if (!this.isExecutingTurn() && event.ctrl && event.name === 'm') {
      this.view.setPrompt('');
      this.onDispatch('/model');
      return true;
    }

    // Ctrl+D: domain selector (when idle)
    if (!this.isExecutingTurn() && event.ctrl && event.name === 'd') {
      this.view.setPrompt('');
      this.onDispatch('/domain');
      return true;
    }

    // Ctrl+G: toggle governance (when idle)
    if (!this.isExecutingTurn() && event.ctrl && event.name === 'g') {
      this.view.setPrompt('');
      this.onDispatch('/governed');
      return true;
    }

    // Escape handling
    if (event.name === 'escape') {
      if (this.onCancelConfirmation?.()) {
        return true;
      }
      if (this.queue.handleEscape()) {
        if (this.isExecutingTurn()) {
          this.onAbortTurn('ESC ESC');
          return true;
        }
      }
      return false;
    }

    // PageUp / PageDown scrolling
    if (event.name === 'pageup') {
      this.view.scrollBy(-6);
      return true;
    }
    if (event.name === 'pagedown') {
      this.view.scrollBy(6);
      return true;
    }

    // Slash command palette trigger on "/" when prompt is empty
    if (!this.isExecutingTurn() && event.name === '/' && this.view.getPrompt().trim() === '') {
      this.onTriggerSlashMenu();
      return true;
    }

    // History navigation with Up/Down arrow
    if (event.name === 'up' && !event.ctrl && !event.shift) {
      if (this.history.length > 0 && this.historyIndex < this.history.length - 1) {
        if (this.historyIndex === -1) {
          this.draft = this.view.getPrompt();
        }
        this.historyIndex++;
        const item = this.history[this.historyIndex];
        if (item !== undefined) {
          this.view.setPrompt(item);
        }
        return true;
      }
    } else if (event.name === 'down' && !event.ctrl && !event.shift) {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        const item = this.history[this.historyIndex];
        if (item !== undefined) {
          this.view.setPrompt(item);
        }
        return true;
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1;
        this.view.setPrompt(this.draft);
        return true;
      }
    }

    return false;
  }

  public handleSubmit(rawText: string): void {
    const text = rawText.trim();
    if (!text && !this.queue.isMultiline) return;

    // Multiline handling
    const multilineResult = this.queue.processLineInput(rawText);
    if (multilineResult.isHandled) {
      if (multilineResult.completePrompt !== undefined) {
        this.dispatchCompletedPrompt(multilineResult.completePrompt);
      }
      this.view.setPrompt('');
      return;
    }

    this.dispatchCompletedPrompt(text);
    this.view.setPrompt('');
  }

  private dispatchCompletedPrompt(prompt: string): void {
    this.historyIndex = -1;
    this.draft = '';

    if (!prompt.startsWith('/')) {
      this.history.unshift(prompt);
      if (this.history.length > 1000) this.history.pop();
      this.onSaveHistory(this.history).catch(() => {});
    }

    this.onDispatch(prompt);
  }

  public getHistory(): string[] {
    return [...this.history];
  }

  public destroy(): void {
    this.unbindSubmit();
    this.unbindKeypress();
  }
}
