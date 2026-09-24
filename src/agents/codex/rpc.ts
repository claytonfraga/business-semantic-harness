import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createStdioWire, createWebSocketWire, type Wire } from './wire.js';

type JsonRpcId = number | string;
interface RpcMessage { id?: JsonRpcId; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code: number; message: string } }

const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'execCommandApproval',
  'applyPatchApproval',
  'permissions/requestApproval',
]);

export type NativeApprovalMode = 'decline' | 'ignore';

export class CodexRpcClient extends EventEmitter {
  private readonly wire: Wire;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private finished = false;
  nativeApprovalMode: NativeApprovalMode = 'decline';

  constructor(command: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv);
  constructor(wire: Wire);
  constructor(commandOrWire: string | Wire, args: string[] = ['app-server', '--stdio'], cwd?: string, env?: NodeJS.ProcessEnv) {
    super();
    this.wire = typeof commandOrWire === 'string' ? createStdioWire(commandOrWire, args, cwd, env) : commandOrWire;
    this.wire.onStderr((text) => this.emit('stderr', text));
    this.wire.onMessage((text) => this.receive(text));
    this.wire.onClose((error) => this.failAll(error));
  }

  static connectWebSocket(url: string): CodexRpcClient {
    return new CodexRpcClient(createWebSocketWire(url));
  }

  get ready(): Promise<void> {
    return this.wire.ready;
  }

  private send(message: RpcMessage): void {
    if (this.finished) throw new Error('Conexão com Codex app-server indisponível');
    this.wire.send(JSON.stringify(message));
  }

  private receive(text: string): void {
    let message: RpcMessage;
    try { message = JSON.parse(text) as RpcMessage; }
    catch { this.emit('protocolError', new Error('Linha JSON-RPC inválida do Codex')); return; }
    if (message.id !== undefined && message.method) {
      if (APPROVAL_METHODS.has(message.method)) {
        if (this.nativeApprovalMode === 'decline') {
          this.respond(message.id, { decision: 'decline' });
          this.emit('nativeApprovalDenied', message);
        } else {
          this.emitServerRequest(message);
        }
      } else {
        this.emitServerRequest(message);
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

  private emitServerRequest(message: RpcMessage): void {
    if (this.listenerCount('serverRequest') > 0) this.emit('serverRequest', message);
    else if (this.nativeApprovalMode === 'ignore') this.emit('ignoredServerRequest', message);
    else if (message.id !== undefined) this.respondError(message.id, -32601, 'Solicitação não suportada pelo BSH');
  }

  private failAll(error: Error): void {
    if (this.finished) return;
    this.finished = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.emit('closed', error);
  }

  async request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<unknown> {
    await this.wire.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tempo limite em Codex RPC: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params: params as Record<string, unknown> }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: unknown = {}): void { this.send({ method, params: params as Record<string, unknown> }); }

  respond(id: JsonRpcId, result: unknown): void { this.send({ id, result }); }

  respondError(id: JsonRpcId, code: number, message: string): void { this.send({ id, error: { code, message } }); }

  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'bsh', title: 'Business Semantic Harness', version: '0.2.0' } });
    this.notify('initialized');
  }

  async verifyCleanConfiguration(cwd: string): Promise<void> {
    const response = await this.request('config/read', { cwd });
    if (!response || typeof response !== 'object' || !('config' in response)) throw new Error('Configuração efetiva do Codex indisponível');
    const config = response.config as Record<string, unknown>;
    const servers = config.mcp_servers;
    if (servers && typeof servers === 'object') {
      const externos = Object.keys(servers).filter((name) => name !== 'bsh');
      if (externos.length > 0) throw new Error(`MCP externo herdado: ${externos.join(', ')}`);
    }
    const features = config.features as Record<string, unknown> | undefined;
    for (const name of ['apps', 'browser_use', 'browser_use_external', 'computer_use', 'plugins', 'remote_plugin', 'multi_agent']) {
      if (features?.[name] !== false) throw new Error(`Recurso externo não desabilitado: ${name}`);
    }
    if (config.web_search !== 'disabled') throw new Error('Busca web não desabilitada');
    const hooks = config.hooks;
    if (hooks && typeof hooks === 'object' && Object.keys(hooks).length > 0) throw new Error('Hooks externos herdados');
  }

  async startReadOnlyThread(cwd: string): Promise<string> { return this.startThread(cwd, false); }

  async startWorkspaceThread(cwd: string): Promise<string> { return this.startThread(cwd, true); }

  private async startThread(cwd: string, writable: boolean): Promise<string> {
    const mcpEntrypoint = fileURLToPath(new URL('../../mcp/server.js', import.meta.url));
    const response = await this.request('thread/start', {
      cwd, sandbox: writable ? 'workspace-write' : 'read-only', approvalPolicy: 'on-request', serviceName: 'bsh',
      developerInstructions: writable
        ? 'Este projeto é governado pelo BSH. Consulte bsh_query_ontology antes de mudar regras. Você pode usar suas ferramentas normais para editar e testar nesta cópia isolada. O BSH revisará as diferenças antes de aplicá-las ao projeto original. Se o pedido contrariar a ontologia, chame bsh_report_conflict e aguarde a pergunta humana. Não contorne essa decisão. A permissão para preparar uma exceção não aplica o patch.'
        : 'Este projeto é governado pelo BSH. Antes de mudanças, consulte bsh_query_ontology. Nunca escreva diretamente. Envie um arquivo por vez em bsh_propose_patch. Se o pedido contrariar a ontologia, chame bsh_report_conflict e aguarde a pergunta humana; não encerre apenas com recusa. A permissão para preparar uma exceção não permite aplicar o patch.',
      config: { mcp_servers: { bsh: {
        command: process.execPath, args: [mcpEntrypoint, cwd, 'governed'], required: true, enabled: true,
        tools: {
          bsh_query_ontology: { approval_mode: 'auto' },
          bsh_propose_patch: { approval_mode: 'auto' },
          bsh_report_conflict: { approval_mode: 'auto' },
        },
      } } },
    });
    if (!response || typeof response !== 'object' || !('thread' in response)) throw new Error('Resposta thread/start inválida');
    const thread = response.thread;
    if (!thread || typeof thread !== 'object' || !('id' in thread) || typeof thread.id !== 'string') throw new Error('Thread sem identificador');
    return thread.id;
  }

  async verifyBSHMcp(threadId: string): Promise<void> {
    const response = await this.request('mcpServerStatus/list', { threadId });
    if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray(response.data)) {
      throw new Error('Inventário MCP indisponível');
    }
    const names = response.data.map((entry: unknown) => entry && typeof entry === 'object' && 'name' in entry ? entry.name : undefined);
    if (names.length !== 1 || names[0] !== 'bsh') throw new Error(`Inventário MCP inesperado: ${names.join(', ')}`);
    const bsh = response.data[0] as Record<string, unknown>;
    if (bsh.runtimeStatus !== 'connected') throw new Error(`MCP BSH não conectado: ${String(bsh.runtimeStatus)}`);
    const tools = bsh.tools;
    if (!tools || typeof tools !== 'object' || Object.keys(tools).sort().join(',') !== 'bsh_propose_patch,bsh_query_ontology,bsh_report_conflict') {
      throw new Error(`Ferramentas BSH inesperadas: ${tools && typeof tools === 'object' ? Object.keys(tools).join(', ') : 'indisponíveis'}`);
    }
  }

  async unsubscribeThread(threadId: string): Promise<void> {
    await this.request('thread/unsubscribe', { threadId });
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.request('thread/resume', { threadId });
  }

  async listThreads(params: Record<string, unknown> = {}): Promise<Record<string, unknown>[]> {
    const response = await this.request('thread/list', params);
    if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray(response.data)) {
      throw new Error('Listagem de threads indisponível');
    }
    return response.data as Record<string, unknown>[];
  }

  async readThread(threadId: string, includeTurns = true): Promise<Record<string, unknown>> {
    const response = await this.request('thread/read', { threadId, includeTurns });
    if (!response || typeof response !== 'object' || !('thread' in response)) throw new Error('Leitura de thread indisponível');
    return response.thread as Record<string, unknown>;
  }

  startTurn(threadId: string, text: string, workspace?: string): Promise<unknown> {
    return this.request('turn/start', { threadId, input: [{ type: 'text', text }], approvalPolicy: 'on-request', sandboxPolicy: workspace
      ? { type: 'workspaceWrite', writableRoots: [workspace], networkAccess: false }
      : { type: 'readOnly', networkAccess: false } });
  }

  interrupt(threadId: string, turnId: string): Promise<unknown> { return this.request('turn/interrupt', { threadId, turnId }); }

  close(): void {
    if (this.finished) return;
    this.wire.close();
  }

  async closeAndWait(): Promise<void> {
    if (this.finished) return;
    const closed = new Promise<void>((resolve) => this.once('closed', () => resolve()));
    this.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      closed,
      new Promise<void>((resolve) => { timer = setTimeout(() => { this.failAll(new Error('Conexão encerrada')); resolve(); }, 5_000); }),
    ]);
    if (timer) clearTimeout(timer);
  }
}