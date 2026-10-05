// Only provider authentication and model streaming are mocked. Headless execution,
// native tools, extraction, SHACL, technical gates, worktrees and Git are real.
// Requirements: BSH-AGENT-010/013, BSH-SEM-036, REQ-AGENT-OBSERVED-OUTCOME.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OpenRouterClient } from '../../dist/client/openrouter/client.js';
import { runHeadlessCodingSession } from '../../dist/agent/headless.js';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

async function session(status, fn) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-headless-semantic-'));
  const repo = join(root, 'project');
  const domain = join(repo, '.bsh/domains/synthetic');
  await mkdir(domain, { recursive: true });
  await mkdir(join(repo, 'src'));
  await mkdir(join(repo, 'test'));
  const baseIri = 'urn:headless-qa:';
  await writeFile(join(repo, '.gitignore'), '.bsh/local/\n');
  await writeFile(join(repo, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'headless-qa',
    domains: [{ id: 'synthetic', version: '1.0.0', baseIri, ontology: 'domains/synthetic/ontology.jsonld',
      shapes: 'domains/synthetic/shapes.ttl', enforcement: 'domains/synthetic/enforcement.json' }] }));
  await writeFile(join(domain, 'ontology.jsonld'), JSON.stringify({
    '@context': { ex: baseIri, bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' },
    '@graph': [{ '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
      { '@id': 'ex:Publish', '@type': 'rdfs:Class' }] }));
  await writeFile(join(domain, 'shapes.ttl'), `@prefix ex: <${baseIri}> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:PublishShape a sh:NodeShape ; sh:targetClass ex:Publish ;
  sh:property [ sh:path ex:status ; sh:minCount 1 ; sh:in ( "APPROVED" ) ] .\n`);
  await writeFile(join(domain, 'enforcement.json'), JSON.stringify({ regras: ['APPROVED', 'REJECTED'].map(value => ({
    id: `publish-${value}`, operacao: 'Publish', quando: { caminho: 'src/**', adicionou: `"${value}"` },
    fatos: [{ propriedade: 'status', valor: value, determinacao: 'observado', origem: 'synthetic-fixture' }],
    evidenciasRequeridas: [{ tipo: 'estrutural' }],
  })) }));
  await writeFile(join(repo, 'src/publication.js'), 'export const initial = true;\n');
  await writeFile(join(repo, 'package.json'), JSON.stringify({ type: 'module', scripts: {
    quality: 'node --check src/publication.js', test: 'node --test test/publication.test.mjs' } }));
  await writeFile(join(repo, 'test/publication.test.mjs'), `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('Given a candidate When loaded Then publication state exists', async () => {
  assert.equal(typeof (await import('../src/publication.js')).publish, 'string');
});\n`);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Headless QA');
  git(repo, 'config', 'user.email', 'qa@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Synthetic baseline');
  const before = git(repo, 'rev-parse', 'HEAD');
  const verify = OpenRouterClient.prototype.verifyApiKey;
  const stream = OpenRouterClient.prototype.streamChat;
  const writeOut = process.stdout.write;
  const writeErr = process.stderr.write;
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousTrees = process.env.BSH_WORKTREES_DIR;
  let output = '';
  let calls = 0;
  process.env.OPENROUTER_API_KEY = 'identified-provider-fixture';
  process.env.BSH_WORKTREES_DIR = join(root, 'worktrees');
  process.stdout.write = process.stderr.write = chunk => { output += String(chunk); return true; };
  OpenRouterClient.prototype.verifyApiKey = async () => ({ valid: true });
  OpenRouterClient.prototype.streamChat = async function* () {
    calls++;
    if (calls === 1) {
      const name = status === 'RULE_BLOCKED' ? 'report_task_outcome' : status === 'TOOL_ERROR' ? 'replace_file_content' : 'write_file';
      const args = status === 'RULE_BLOCKED' ? { outcome: 'rule_blocked', ruleId: 'PublishShape', reason: 'Rejected by business rule' }
        : status === 'TOOL_ERROR' ? { path: 'src/publication.js', target_content: 'absent', replacement_content: 'invalid' }
        : { path: 'src/publication.js', content: `export const publish = "${status}";\n` };
      yield { delta: { tool_calls: [{ index: 0, id: 'qa-call', function: { name, arguments: JSON.stringify(args) } }] } };
    } else yield { delta: { content: 'Provider fixture finished.' } };
  };
  try {
    const exitCode = await runHeadlessCodingSession({ projectRoot: repo, model: 'provider-fixture', domain: 'synthetic',
      prompt: 'Implement publication according to the active rule', autoPromote: true });
    await fn({ exitCode, output, repo, before, calls });
  } finally {
    OpenRouterClient.prototype.verifyApiKey = verify;
    OpenRouterClient.prototype.streamChat = stream;
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousTrees === undefined) delete process.env.BSH_WORKTREES_DIR; else process.env.BSH_WORKTREES_DIR = previousTrees;
    await rm(root, { recursive: true, force: true });
  }
}

test('Given conforming candidate facts When production headless executes and promotes Then the observed files and authorized commit match origin', async () => {
  await session('APPROVED', async ({ exitCode, output, repo, before }) => {
    assert.equal(exitCode, 0, output);
    assert.match(output, /Observed task outcome: completed/);
    assert.match(output, /Observed changed files: src\/publication.js/);
    assert.notEqual(git(repo, 'rev-parse', 'HEAD'), before);
    assert.equal(await readFile(join(repo, 'src/publication.js'), 'utf8'), 'export const publish = "APPROVED";\n');
    assert.match(output, /commit:/);
  });
});

test('Given violating candidate facts When production headless executes Then SHACL blocks promotion and origin remains intact', async () => {
  await session('REJECTED', async ({ exitCode, output, repo, before }) => {
    assert.equal(exitCode, 1, output);
    assert.match(output, /VIOLATION/);
    assert.match(output, /Observed changed files: src\/publication.js/);
    assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
    assert.equal(await readFile(join(repo, 'src/publication.js'), 'utf8'), 'export const initial = true;\n');
  });
});

for (const [status, outcome] of [['RULE_BLOCKED', 'rule_blocked'], ['TOOL_ERROR', 'tool_error']]) {
  test(`Given ${outcome} without changes When headless finishes Then exit is failure and no mutation retry or promotion occurs`, async () => {
    await session(status, async ({ exitCode, output, repo, before, calls }) => {
      assert.equal(exitCode, 1, output);
      assert.equal(calls, 2, 'No automatic mutation retry');
      assert.match(output, new RegExp(`Observed task outcome: ${outcome}`));
      assert.match(output, /Observed changed files: \(none\)/);
      assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
    });
  });
}
