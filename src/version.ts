import { readFileSync } from 'node:fs';

/** Installed package metadata is authoritative for CLI and MCP identities. */
export function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0-unknown';
  } catch { return '0.0.0-unknown'; }
}
