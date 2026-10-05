import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// A local distribution pipeline: no registry publication, Git push or E2E runner.
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const environment = { ...process.env };
delete environment.NODE_TEST_CONTEXT;
const run = async (args, inherit = false) => {
  const result = await exec('npm', args, { cwd: root, env: environment, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000 });
  if (inherit) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.stdout;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = join(root, '.bsh/local/packages');
await mkdir(directory, { recursive: true });
const preparedPath = join(directory, 'prepared-install.json');
const installPrepared = process.argv.includes('--install-prepared');
let prepared;
if (installPrepared) {
  prepared = JSON.parse(await readFile(preparedPath, 'utf8'));
  if (hash(await readFile(prepared.tarball)) !== prepared.tarballSha256) throw new Error('Prepared local tarball integrity mismatch');
} else {
  await run(['test'], true); // Includes quality, build, unit and module integration tests.
  const [packed] = JSON.parse(await run(['pack', '--ignore-scripts', '--json', '--pack-destination', directory]));
  const tarball = join(directory, packed.filename);
  const expectedFiles = [];
  for (const file of packed.files.filter(file => file.path.startsWith('dist/'))) {
    expectedFiles.push([file.path, hash(await readFile(join(root, file.path)))]);
  }
  prepared = { packed, tarball, tarballSha256: hash(await readFile(tarball)), expectedFiles };
  await writeFile(preparedPath, `${JSON.stringify(prepared, null, 2)}\n`);
}
const { packed, tarball, tarballSha256 } = prepared;
const expectedFiles = new Map(prepared.expectedFiles);
if (process.argv.includes('--prepare-only')) {
  console.log(JSON.stringify({ name: packed.name, version: packed.version, tarball, tarballSha256, preparedPath }, null, 2));
  process.exit(0);
}
await run(['install', '--global', '--offline', '--no-audit', '--no-fund', tarball], true);
const globalRoot = (await run(['root', '--global'])).trim();
const installedRoot = join(globalRoot, packed.name);
const manifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
if (manifest.name !== packed.name || manifest.version !== packed.version) throw new Error('Installed local package identity mismatch');
for (const [path, expected] of expectedFiles) {
  if (hash(await readFile(join(installedRoot, path))) !== expected) throw new Error(`Installed distribution differs from the local package: ${path}`);
}
const record = { schemaVersion: 1, installedAt: new Date().toISOString(), name: packed.name, version: packed.version,
  tarball, tarballSha256, installedRoot, verifiedDistributionFiles: expectedFiles.size,
  checks: ['quality', 'build', 'unit tests', 'module integration tests', 'installed distribution SHA-256'],
  source: 'LOCAL_TARBALL', registryPublication: false, e2eExecuted: false };
const receipt = join(directory, 'last-install.json');
await writeFile(receipt, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ ...record, receipt }, null, 2));
