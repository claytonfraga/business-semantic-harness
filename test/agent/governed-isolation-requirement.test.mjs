import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { git } from '../../dist/git/worktree.js';
import { runHeadlessCodingSession } from '../../dist/agent/headless.js';

const run = promisify(execFile);

async function initRepoFixture() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-isolation-test-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/iso'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'iso-test',
      domains: [
        {
          id: 'iso',
          version: '1.0.0',
          baseIri: 'urn:iso:',
          ontology: 'domains/iso/ontology.jsonld',
          shapes: 'domains/iso/shapes.ttl',
          enforcement: 'domains/iso/enforcement.json',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/iso/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:iso:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Action', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/iso/shapes.ttl'),
    `@prefix ex: <urn:iso:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\nex:ActionShape a sh:NodeShape ; sh:targetClass ex:Action .\n`
  );

  await writeFile(
    join(repo, '.bsh/domains/iso/enforcement.json'),
    JSON.stringify({
      schemaVersion: 1,
      regras: [],
    })
  );

  await run('git', ['init', '-b', 'main'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Tester'], { cwd: repo });
  await run('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
  await writeFile(join(repo, 'src/main.ts'), 'export const pristine = true;\n');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-m', 'initial commit'], { cwd: repo });

  return { root, repo };
}

test('Given governed execution When worktree creation fails Then execution interrupts immediately without mutating main checkout', async () => {
  const { root, repo } = await initRepoFixture();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { label: 'mock-key', limit: 100 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    // Write fake .env so API key check passes
    await writeFile(join(repo, '.env'), 'OPENROUTER_API_KEY=mock-key-123\n');

    // Force git worktree failure by pointing worktrees dir to a file
    const invalidDir = join(root, 'invalid-worktrees-file');
    await writeFile(invalidDir, 'cannot mkdir inside a file');
    process.env.BSH_WORKTREES_DIR = invalidDir;

    let stderrOutput = '';
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });

    let exitCode = 0;
    try {
      exitCode = await runHeadlessCodingSession({
        projectRoot: repo,
        prompt: 'modify Action in main.ts',
        domain: 'iso',
        allowDirectExecution: false,
      });
    } finally {
      process.stderr.write = originalStderrWrite;
      delete process.env.BSH_WORKTREES_DIR;
    }

    // 1. Must exit with error
    assert.equal(exitCode, 1, 'Headless must return exit code 1 when worktree creation fails in governed mode');

    // 2. Must produce diagnostic
    assert.ok(
      stderrOutput.includes('Falha ao criar worktree') || stderrOutput.includes('modo governado'),
      'Must produce clear diagnostic about isolation requirement in governed mode'
    );

    // 3. Checkout principal remains pristine
    const content = await readFile(join(repo, 'src/main.ts'), 'utf8');
    assert.equal(content, 'export const pristine = true;\n', 'Main checkout must remain strictly pristine');
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('Given governed execution When direct execution is explicitly allowed Then session does not block on worktree isolation error', async () => {
  const { root, repo } = await initRepoFixture();
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: { label: 'mock-key', limit: 100 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await writeFile(join(repo, '.env'), 'OPENROUTER_API_KEY=mock-key-123\n');

    // Force worktree failure by pointing worktrees dir to a file
    const invalidDir = join(root, 'invalid-worktrees-file-2');
    await writeFile(invalidDir, 'cannot mkdir inside a file');
    process.env.BSH_WORKTREES_DIR = invalidDir;

    const originalStderrWrite = process.stderr.write;
    let stderrOutput = '';
    process.stderr.write = ((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });

    try {
      await runHeadlessCodingSession({
        projectRoot: repo,
        prompt: 'Inspect Action in direct mode',
        domain: 'iso',
        allowDirectExecution: true,
      }).catch(() => {});

      // Verification that it did not block on worktree creation requirement
      assert.ok(!stderrOutput.includes('Execução direta exige seleção explícita'));
    } finally {
      process.stderr.write = originalStderrWrite;
      delete process.env.BSH_WORKTREES_DIR;
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
