import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, copyFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CodexRpcClient } from './rpc.js';

const execFileAsync = promisify(execFile);
const CODEX_DIRECTORY = join(homedir(), '.codex');
const DISABLED_FEATURES = [
  'apps', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
  'computer_use', 'plugins', 'remote_plugin', 'multi_agent', 'code_mode',
];

export async function verifyReadOnlyMount(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bsh-isolation-'));
  const probe = join(directory, 'write-check');
  const mounts = [
    '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc',
    '--tmpfs', '/tmp', '--ro-bind', directory, directory,
  ];
  try {
    const health = await execFileAsync('bwrap', [...mounts, '--', '/usr/bin/printf', 'ready'], { timeout: 5_000 });
    if (health.stdout !== 'ready') throw new Error('Isolamento Linux não iniciou corretamente');
    let writeBlocked = false;
    try { await execFileAsync('bwrap', [...mounts, '--', '/usr/bin/touch', probe], { timeout: 5_000 }); }
    catch { writeBlocked = true; }
    if (!writeBlocked) throw new Error('Isolamento Linux não bloqueou escrita nativa');
    try { await access(probe); throw new Error('Isolamento Linux escreveu fora da área isolada'); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Isolamento Linux escreveu')) throw error;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export interface IsolatedCodex {
  client: CodexRpcClient;
  workspace: string;
  dispose(): Promise<void>;
}

export async function verifyWorkspaceMount(project: string, workspace: string): Promise<void> {
  const originalProbe = join(project, `.bsh-readonly-probe-${randomUUID()}`);
  const workspaceProbe = join(workspace, `.bsh-workspace-probe-${randomUUID()}`);
  const mounts = [
    '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
    '--ro-bind', project, project, '--bind', workspace, workspace,
  ];
  try {
    try { await execFileAsync('bwrap', [...mounts, '--', '/usr/bin/touch', originalProbe], { timeout: 5_000 }); }
    catch { /* A árvore original precisa recusar escrita. */ }
    try { await access(originalProbe); throw new Error('Isolamento permitiu escrita na árvore original'); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith('Isolamento permitiu')) throw error;
    }
    await execFileAsync('bwrap', [...mounts, '--', '/usr/bin/touch', workspaceProbe], { timeout: 5_000 });
    await access(workspaceProbe);
  } finally {
    await rm(workspaceProbe, { force: true });
  }
}

export async function createIsolatedCodex(cwd: string, writableWorkspace = false): Promise<IsolatedCodex> {
  await access(CODEX_DIRECTORY);
  const project = await realpath(cwd);
  const state = await mkdtemp(join(tmpdir(), 'bsh-codex-state-'));
  const workspace = writableWorkspace ? await mkdtemp(join(tmpdir(), 'bsh-codex-workspace-')) : project;
  await chmod(state, 0o700);
  try {
    if (writableWorkspace) {
      await chmod(workspace, 0o700);
      await execFileAsync('cp', ['-a', '--reflink=auto', `${project}/.`, workspace], { timeout: 120_000 });
    }
    for (const filename of ['auth.json', '.credentials.json']) {
      try {
        await copyFile(join(CODEX_DIRECTORY, filename), join(state, filename));
        await chmod(join(state, filename), 0o600);
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error;
      }
    }
    const args = [
      '--ro-bind', '/', '/', '--dev-bind', '/dev', '/dev', '--proc', '/proc',
      '--tmpfs', '/tmp', '--ro-bind', project, project,
      ...(writableWorkspace ? ['--bind', workspace, workspace] : []),
      '--bind', state, CODEX_DIRECTORY,
      '--', 'codex',
      ...DISABLED_FEATURES.flatMap((feature) => ['-c', `features.${feature}=false`]),
      '-c', 'web_search="disabled"', 'app-server', '--stdio',
    ];
    const environment = { ...process.env };
    delete environment.CODEX_HOME;
    const client = new CodexRpcClient('bwrap', args, workspace, environment);
    client.once('closed', () => {
      void rm(state, { recursive: true, force: true });
      if (writableWorkspace) void rm(workspace, { recursive: true, force: true });
    });
    return {
      client, workspace,
      async dispose() {
        await client.closeAndWait();
        await rm(state, { recursive: true, force: true });
        if (writableWorkspace) await rm(workspace, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(state, { recursive: true, force: true });
    if (writableWorkspace) await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
