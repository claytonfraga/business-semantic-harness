import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface Wire {
  readonly ready: Promise<void>;
  send(text: string): void;
  close(): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: (error: Error) => void): void;
  onStderr(listener: (text: string) => void): void;
}

export function createStdioWire(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Wire {
  const child: ChildProcessWithoutNullStreams = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const messageListeners: ((text: string) => void)[] = [];
  const closeListeners: ((error: Error) => void)[] = [];
  const stderrListeners: ((text: string) => void)[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    for (const listener of messageListeners) listener(line);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    for (const listener of stderrListeners) listener(chunk.toString('utf8'));
  });
  const fail = (error: Error) => {
    for (const listener of closeListeners) listener(error);
  };
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(`Codex app-server encerrou com código ${String(code)}`)));
  return {
    ready: Promise.resolve(),
    send(text) {
      if (!child.stdin.writable) throw new Error('Conexão com Codex app-server indisponível');
      child.stdin.write(text + '\n');
    },
    close() {
      child.kill();
    },
    onMessage(listener) {
      messageListeners.push(listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
    },
    onStderr(listener) {
      stderrListeners.push(listener);
    },
  };
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown; message?: string }) => void): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export function createWebSocketWire(url: string): Wire {
  const WebSocketClass = (globalThis as unknown as { WebSocket?: WebSocketConstructor }).WebSocket;
  if (!WebSocketClass) throw new Error('WebSocket indisponível neste runtime Node.js');
  const socket = new WebSocketClass(url);
  const messageListeners: ((text: string) => void)[] = [];
  const closeListeners: ((error: Error) => void)[] = [];
  let opened = false;
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => {
      opened = true;
      resolve();
    });
    socket.addEventListener('error', (event) => {
      const message = event.message ?? 'Falha ao conectar ao Codex app-server via WebSocket';
      reject(new Error(message));
      if (!opened) {
        for (const listener of closeListeners) listener(new Error(message));
      }
    });
  });
  socket.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : String(event.data);
    for (const listener of messageListeners) listener(text);
  });
  socket.addEventListener('close', () => {
    for (const listener of closeListeners) listener(new Error('Conexão WebSocket com o Codex encerrada'));
  });
  return {
    ready,
    send(text) {
      socket.send(text);
    },
    close() {
      socket.close();
    },
    onMessage(listener) {
      messageListeners.push(listener);
    },
    onClose(listener) {
      closeListeners.push(listener);
    },
    onStderr() {},
  };
}