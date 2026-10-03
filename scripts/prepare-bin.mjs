import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

await chmod(fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 0o755);
// The runtime entry is shipped with dist; Bun is resolved locally at launch time.
await chmod(fileURLToPath(new URL('../dist/tui/runtime.js', import.meta.url)), 0o755);
