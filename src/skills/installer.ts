import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface InstallSkillOptions {
  skill?: string;
  global?: boolean;
  projectRoot?: string;
  agent?: string;
}

export interface InstallSkillResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
}

export async function installSkillPackage(
  source: string,
  options?: InstallSkillOptions
): Promise<InstallSkillResult> {
  const cwd = options?.projectRoot || process.cwd();
  const args: string[] = ['skills@latest', 'add', source, '-y'];

  if (options?.skill) {
    args.push(`--skill=${options.skill}`);
  }
  if (options?.global) {
    args.push('-g');
  }
  if (options?.agent) {
    args.push(`--agent=${options.agent}`);
  }

  const rtkBin = '/usr/bin/rtk';
  const executable = existsSync(rtkBin) ? rtkBin : 'npx';
  const commandArgs = existsSync(rtkBin) ? ['npx', ...args] : args;

  return new Promise((resolve) => {
    let stdoutData = '';
    let stderrData = '';

    const child = spawn(executable, commandArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d) => {
      stdoutData += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderrData += d.toString();
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        exitCode: 1,
        output: stdoutData,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code ?? 0,
        output: stdoutData + (stderrData ? `\n${stderrData}` : ''),
        error: code !== 0 ? stderrData : undefined,
      });
    });
  });
}
