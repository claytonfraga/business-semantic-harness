import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import test from 'node:test';
import { resolvePackageBun } from '../../dist/tui/runtime.js';

const subprocessEnv = { ...process.env };
delete subprocessEnv.NODE_TEST_CONTEXT;

// Derived after implementation from BSH-OPENTUI-011/012 and BSH-DIST-002.
test('Given Node 22 When help or init runs Then OpenTUI is not loaded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bsh-cli-runtime-'));
  try {
    const loader = join(directory, 'loader.mjs');
    await writeFile(loader, 'export async function resolve(s,c,n) { if (s.includes("opentui") || s.includes("tui/session")) throw Error("renderer loaded"); return n(s,c); }');
    for (const args of [['--help'], ['--project', directory, 'init']]) {
      const result = spawnSync(process.execPath, ['--loader', loader, resolve('dist/cli.js'), ...args], { encoding: 'utf8', env: subprocessEnv });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Given a package-local Bun runtime When the TUI launches Then options environment cwd and terminal streams reach the child and exit status is preserved', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bsh-tui-runtime-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await copyFile(resolve('dist/tui/runtime.js'), join(directory, 'runtime.js'));
    await mkdir(join(directory, 'node_modules/bun/bin'), { recursive: true });
    await writeFile(join(directory, 'node_modules/bun/package.json'), '{"name":"bun","version":"1.4.2"}');
    await copyFile(resolvePackageBun(), join(directory, 'node_modules/bun/bin/bun.exe'));
    await writeFile(join(directory, 'session.js'), 'import {readFileSync} from "node:fs"; export async function startTuiSession(options) { console.log(JSON.stringify({options,cwd:process.cwd(),marker:process.env.BSH_TEST_MARKER,stdin:readFileSync(0,"utf8")})); console.error("child stderr"); process.exitCode=7; }');
    const options = { projectRoot: '/selected/project', model: 'test/model', domain: 'assets' };
    await writeFile(join(directory, 'stdin.txt'), 'terminal input');
    const inputFd = openSync(join(directory, 'stdin.txt'), 'r');
    const runner = `import {launchTui} from ${JSON.stringify(join(directory, 'runtime.js'))}; await launchTui(${JSON.stringify(options)});`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], { cwd: directory, env: { ...subprocessEnv, BSH_TEST_MARKER: 'preserved' }, stdio: [inputFd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 });
    closeSync(inputFd);
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { options, cwd: directory, marker: 'preserved', stdin: 'terminal input' });
    assert.match(result.stderr, /child stderr/);
    const cliSource = await (await import('node:fs/promises')).readFile(resolve('dist/cli.js'), 'utf8');
    // Exercise the real CLI routing and final exitCode assignment with only service imports redirected.
    await mkdir(join(directory, 'tui'));
    await copyFile(join(directory, 'runtime.js'), join(directory, 'tui/runtime.js'));
    await copyFile(join(directory, 'session.js'), join(directory, 'tui/session.js'));
    const routedCli = cliSource.replace(/from '(\.\/[^']+)'/g, (_, path) => `from ${JSON.stringify(new URL(path, new URL(`file://${resolve('dist/cli.js')}`)).href)}`);
    await writeFile(join(directory, 'cli.js'), routedCli);
    const cliFd = openSync(join(directory, 'stdin.txt'), 'r');
    const cli = spawnSync(process.execPath, [join(directory, 'cli.js'), 'tui', '--project', options.projectRoot, '--model', options.model, '--domain', options.domain], { cwd: directory, env: { ...subprocessEnv, BSH_TEST_MARKER: 'preserved' }, stdio: [cliFd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 });
    closeSync(cliFd);
    assert.equal(cli.status, 7, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout).options, options);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Given an unavailable native runtime When the TUI launches Then an actionable English diagnostic is returned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bsh-missing-runtime-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await copyFile(resolve('dist/tui/runtime.js'), join(directory, 'runtime.js'));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {launchTui} from ${JSON.stringify(join(directory, 'runtime.js'))}; await launchTui({});`], { encoding: 'utf8', env: subprocessEnv });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package-local Bun runtime is unavailable/);
    assert.match(result.stderr, /--include=optional/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
