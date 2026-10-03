import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { TuiSessionOptions } from './session.js';

/** Resolve from this package, never from PATH or a global Bun installation. */
export function resolvePackageBun(): string {
  try {
    const require = createRequire(import.meta.url);
    const binary = resolve(dirname(require.resolve('bun/package.json')), 'bin/bun.exe');
    if (existsSync(binary)) return binary;
  } catch {
    // Present the same actionable diagnostic for a missing package or native artifact.
  }
  throw new Error('The package-local Bun runtime is unavailable. Reinstall business-semantic-harness with optional dependencies enabled on a supported platform (npm install --include=optional).');
}

export async function launchTui(options: TuiSessionOptions): Promise<void> {
  if ('Bun' in globalThis) {
    const { startTuiSession } = await import('./session.js');
    await startTuiSession(options);
    return;
  }
  const binary = resolvePackageBun();
  const child = spawn(binary, [fileURLToPath(import.meta.url), JSON.stringify(options)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map((signal) => {
    const handler = () => { child.kill(signal); };
    process.on(signal, handler);
    return { signal, handler };
  });
  try {
    await new Promise<void>((accept, reject) => {
      child.once('error', (error) => reject(new Error(`Unable to start the package-local Bun runtime: ${error.message}. Reinstall business-semantic-harness with optional dependencies enabled.`)));
      child.once('exit', (code, signal) => {
        process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
        accept();
      });
    });
  } finally {
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  }
}

export async function launchAuth(manual: boolean): Promise<number> {
  const child = spawn(resolvePackageBun(), [fileURLToPath(import.meta.url), '--auth', ...(manual ? ['--manual'] : [])], { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  return await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
}

if ('Bun' in globalThis && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--auth') {
    const { handleAuthCommand } = await import('../cli/authCommand.js');
    process.exitCode = await handleAuthCommand(['login', ...process.argv.slice(3)]);
  } else {
    await launchTui(JSON.parse(process.argv[2] ?? '{}') as TuiSessionOptions);
  }
}
