import { chmod, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

await chmod(fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 0o755);
// The runtime entry is shipped with dist; Bun is resolved locally at launch time.
await chmod(fileURLToPath(new URL('../dist/tui/runtime.js', import.meta.url)), 0o755);
const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
await writeFile(new URL('../dist/build-info.json', import.meta.url), `${JSON.stringify({ name: pkg.name, version: pkg.version, sourceCommit, sourceDirty }, null, 2)}\n`);
