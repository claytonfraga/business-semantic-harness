/**
 * InputQueue & Keyboard Shortcut State Machine
 *
 * Responsabilidade Única (SRP):
 * - Gerenciar a fila concorrente FIFO de comandos do usuário.
 * - Manter o estado do acumulador multilinha (""").
 * - Processar a máquina de estados de duplo escape (latch de 500ms).
 */

export class InputQueueManager {
  private readonly queue: string[] = [];
  private lastEscTime = 0;
  private inMultilineMode = false;
  private readonly multilineBuffer: string[] = [];

  /**
   * Enqueues a prompt to the FIFO queue.
   */
  enqueue(prompt: string): void {
    if (prompt) {
      this.queue.push(prompt);
    }
  }

  /**
   * Dequeues the next prompt in FIFO order.
   */
  dequeue(): string | undefined {
    return this.queue.shift();
  }

  /**
   * Current number of queued prompts.
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * Checks whether the queue has pending prompts.
   */
  get hasItems(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Clears all items in the queue.
   */
  clear(): void {
    this.queue.length = 0;
  }

  /**
   * Evaluates escape keypress against the 500ms latch threshold.
   * Returns true if double escape was detected within the time window.
   */
  handleEscape(currentTime = Date.now()): boolean {
    if (currentTime - this.lastEscTime <= 500) {
      this.lastEscTime = 0;
      return true;
    }
    this.lastEscTime = currentTime;
    return false;
  }

  /**
   * Resets the escape latch timer.
   */
  resetEscapeLatch(): void {
    this.lastEscTime = 0;
  }

  /**
   * Checks if currently in multiline input mode.
   */
  get isMultiline(): boolean {
    return this.inMultilineMode;
  }

  /**
   * Processes a line for multiline block handling (""").
   * Returns complete prompt if block just finished, or null if accumulating.
   */
  processLineInput(line: string): {
    isHandled: boolean;
    completePrompt?: string;
    hint?: string;
  } {
    const trimmed = line.trim();

    // Start multiline mode
    if (trimmed.startsWith('"""') && !this.inMultilineMode) {
      this.inMultilineMode = true;
      const initial = trimmed.slice(3);
      if (initial) this.multilineBuffer.push(initial);
      return {
        isHandled: true,
        hint: '... [Modo Multilinha: digite """ para submeter]',
      };
    }

    // Accumulating inside multiline mode
    if (this.inMultilineMode) {
      if (trimmed.endsWith('"""')) {
        const finalPart = trimmed.slice(0, -3);
        if (finalPart) this.multilineBuffer.push(finalPart);
        const completePrompt = this.multilineBuffer.join('\n').trim();
        this.inMultilineMode = false;
        this.multilineBuffer.length = 0;
        return {
          isHandled: true,
          completePrompt,
        };
      }
      this.multilineBuffer.push(line);
      return {
        isHandled: true,
        hint: '... [Modo Multilinha: digite """ para submeter]',
      };
    }

    return { isHandled: false };
  }

  /**
   * Cancels multiline mode and clears its buffer.
   * Returns true if multiline was active and got cancelled.
   */
  cancelMultiline(): boolean {
    if (this.inMultilineMode) {
      this.inMultilineMode = false;
      this.multilineBuffer.length = 0;
      return true;
    }
    return false;
  }
}
