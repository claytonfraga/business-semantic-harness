import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

type JsonRpcId = number | string;
interface RpcMessage { id?: JsonRpcId; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }

export class CodexRpcClient extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;

  constructor(command = 'codex', args: string[] = ['app-server', '--stdio'], cwd?: string) {
    super();
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', (chunk: Buffer) => this.emit('stderr', chunk.toString('utf8')));
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
    this.child.on('error', (error) => this.failAll(error));
    this.child.on('exit', (code) => this.failAll(new Error(`Codex app-server encerrou com código ${String(code)}`)));
  }

  private send(message: RpcMessage): void {
    if (this.closed || !this.child.stdin.writable) throw new Error('Conexão com Codex app-server indisponível');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private receive(line: string): void {
    let message: RpcMessage;
    try { message = JSON.parse(line) as RpcMessage; }
    catch { this.emit('protocolError', new Error('Linha JSON-RPC inválida do Codex')); return; }
    if (message.id !== undefined && message.method) {
      if (message.method === 'item/commandExecution/requestApproval' || message.method === 'item/fileChange/requestApproval') {
        this.respond(message.id, { decision: 'decline' });
        this.emit('nativeApprovalDenied', message);
      } else if (this.listenerCount('serverRequest') > 0) {
        this.emit('serverRequest', message);
      } else {
        this.respondError(message.id, -32601, 'Solicitação não suportada pelo Oracle');
      }
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`Codex RPC ${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit('notification', message);
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.emit('closed', error);
  }

  request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tempo limite em Codex RPC: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: unknown = {}): void { this.send({ method, params }); }

  respond(id: JsonRpcId, result: unknown): void { this.send({ id, result }); }

  respondError(id: JsonRpcId, code: number, message: string): void { this.send({ id, error: { code, message } }); }

  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'oracle', title: 'Oracle ontology harness', version: '0.1.0' } });
    this.notify('initialized');
  }

  async startReadOnlyThread(cwd: string): Promise<string> {
    const mcpEntrypoint = fileURLToPath(new URL('../../mcp/server.js', import.meta.url));
    const response = await this.request('thread/start', {
      cwd, sandbox: 'read-only', approvalPolicy: 'on-request', serviceName: 'oracle',
      config: { mcp_servers: { oracle: { command: process.execPath, args: [mcpEntrypoint, cwd], required: true, enabled: true } } },
    });
    if (!response || typeof response !== 'object' || !('thread' in response)) throw new Error('Resposta thread/start inválida');
    const thread = response.thread;
    if (!thread || typeof thread !== 'object' || !('id' in thread) || typeof thread.id !== 'string') throw new Error('Thread sem identificador');
    return thread.id;
  }

  startTurn(threadId: string, text: string): Promise<unknown> {
    return this.request('turn/start', { threadId, input: [{ type: 'text', text }], approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } });
  }

  interrupt(threadId: string, turnId: string): Promise<unknown> { return this.request('turn/interrupt', { threadId, turnId }); }

  close(): void {
    this.closed = true;
    this.child.kill();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Conexão encerrada')); }
    this.pending.clear();
  }
}
