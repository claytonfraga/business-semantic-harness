import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

// The BSH engineering policy routes terminal commands through the local rtk proxy
// when it is installed. CI runners do not ship it, so the command runs directly.
const RTK_BINARY = process.env.BSH_RTK_BINARY ?? '/usr/bin/rtk';
const execFileAsync = promisify(execFile);

export function runCommand(command, args = [], options = {}) {
  if (existsSync(RTK_BINARY)) {
    return execFileAsync(RTK_BINARY, [command, ...args], options);
  }
  return execFileAsync(command, args, options);
}
