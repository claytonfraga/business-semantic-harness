import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODEX_DIRECTORY = join(homedir(), '.codex');
const DISABLED_FEATURES = [
  'apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'plugins', 'remote_plugin', 'multi_agent', 'code_mode',
];

export interface GovernedAppServer {
  url: string;
  port: number;
  project: string;
  stateDirectory: string;
  process: ChildProcess;
  dispose(): Promise<void>;
}

function buildGovernedInstructions(domains: string[]): string {
  const list = domains.length > 0 ? domains.join(', ') : 'nao declarados';
  return [
    '# Sessao governada pelo Oracle',
    '',
    'Este projeto e governado pelo Oracle. O Codex opera normalmente no projeto real.',
    'Sempre comece consultando a ontologia do dominio com a ferramenta MCP `oracle_query_ontology`, mesmo que o pedido pareca simples, e antes de implementar qualquer mudanca.',
    `Dominios declarados: ${list}.`,
    'Se um pedido contrariar a ontologia, chame `oracle_report_conflict` e aguarde a decisao humana; nao contorne essa decisao.',
    'O Oracle mede os tokens gastos na verificacao ontologica e alerta o humano em caso de violacao.',
    '',
  ].join('\n');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => port > 0 ? resolve(port) : reject(new Error('Não foi possível reservar porta local para o Codex')));
    });
  });
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function buildConfig(project: string, mcpEntrypoint: string, model?: string, reasoningEffort?: string): string {
  const lines = [
    'web_search = "disabled"',
    'approval_policy = "on-request"',
    'sandbox_mode = "danger-full-access"',
  ];
  if (model) lines.push(`model = ${tomlString(model)}`);
  if (reasoningEffort) lines.push(`model_reasoning_effort = ${tomlString(reasoningEffort)}`);
  lines.push(
    '',
    '[mcp_servers.oracle]',
    `command = ${tomlString(process.execPath)}`,
    `args = [${tomlString(mcpEntrypoint)}, ${tomlString(project)}, "governed"]`,
    'required = true',
    'enabled = true',
    '',
    '[mcp_servers.oracle.tools.oracle_query_ontology]',
    'approval_mode = "auto"',
    '[mcp_servers.oracle.tools.oracle_propose_patch]',
    'approval_mode = "auto"',
    '[mcp_servers.oracle.tools.oracle_report_conflict]',
    'approval_mode = "auto"',
    '',
    '[features]',
  );
  for (const feature of DISABLED_FEATURES) lines.push(`${feature} = false`);
  return `${lines.join('\n')}\n`;
}

async function waitUntilReady(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Codex app-server encerrou antes de aceitar conexões');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return;
    } catch {
      // Ainda inicializando.
    }
    if (Date.now() > deadline) throw new Error('Codex app-server não ficou pronto no tempo esperado');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function startGovernedAppServer(root: string, domains: string[]): Promise<GovernedAppServer> {
  const project = root;
  const stateDirectory = await mkdtemp(join(homedir(), '.oracle-codex-state-'));
  await chmod(stateDirectory, 0o700);
  const mcpEntrypoint = fileURLToPath(new URL('../../mcp/server.js', import.meta.url));
  try {
    for (const filename of ['auth.json', '.credentials.json']) {
      try {
        await copyFile(join(CODEX_DIRECTORY, filename), join(stateDirectory, filename));
        await chmod(join(stateDirectory, filename), 0o600);
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
    }
    await writeFile(join(stateDirectory, 'config.toml'), buildConfig(project, mcpEntrypoint, process.env.ORACLE_CODEX_MODEL, process.env.ORACLE_CODEX_REASONING_EFFORT), { mode: 0o600 });
    await writeFile(join(stateDirectory, 'AGENTS.md'), buildGovernedInstructions(domains), { mode: 0o600 });

    const port = await freePort();
    const url = `ws://127.0.0.1:${port}`;
    const args = [
      ...DISABLED_FEATURES.flatMap((feature) => ['-c', `features.${feature}=false`]),
      '-c', 'web_search="disabled"',
      'app-server', '--listen', url,
    ];
    const environment = { ...process.env, CODEX_HOME: stateDirectory, ORACLE_SESSION_DIR: stateDirectory };
    const child = spawn('codex', args, { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk.toString('utf8')));
    await waitUntilReady(port, child);

    let disposed = false;
    const signalTree = (signal: NodeJS.Signals): void => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch { try { child.kill(signal); } catch { /* já encerrado */ } }
    };
    return {
      url, port, project, stateDirectory, process: child,
      async dispose() {
        if (disposed) return;
        disposed = true;
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          signalTree('SIGTERM');
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(() => { signalTree('SIGKILL'); resolve(); }, 5_000); })]);
          if (timer) clearTimeout(timer);
        }
        await rm(stateDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(stateDirectory, { recursive: true, force: true });
    throw error;
  }
}