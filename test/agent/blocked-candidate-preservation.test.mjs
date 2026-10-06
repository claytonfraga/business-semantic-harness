import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree, descartarSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { createProductionFactsExtractor } from '../../dist/enforcement/evidenceAdapters.js';

const run = promisify(execFile);
const PREFIX = '@prefix ex: <urn:pres:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';

async function initRepoFixture({ rules = [], shapesContent = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-pres-test-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/pres'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'pres-test',
      domains: [
        {
          id: 'pres',
          version: '1.0.0',
          baseIri: 'urn:pres:',
          ontology: 'domains/pres/ontology.jsonld',
          shapes: 'domains/pres/shapes.ttl',
          enforcement: 'domains/pres/enforcement.json',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/pres/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:pres:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:TransferAction', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/pres/shapes.ttl'),
    shapesContent || `${PREFIX}
ex:TransferShape a sh:NodeShape ; sh:targetClass ex:TransferAction ;
  sh:property [ sh:path ex:status ; sh:hasValue "TRANSFERRED" ] .
`
  );

  await writeFile(
    join(repo, '.bsh/domains/pres/enforcement.json'),
    JSON.stringify({
      schemaVersion: 1,
      regras: rules.length > 0 ? rules : [
        {
          id: 'rule-transfer',
          operacao: 'TransferAction',
          quando: { caminho: 'src/**', adicionou: 'transfer' },
          fatos: [{ propriedade: 'status', valor: 'TRANSFERRED', determinacao: 'observado', origem: 'code' }],
          evidenciasRequeridas: [{ tipo: 'estrutural' }],
        },
      ],
    })
  );

  await run('git', ['init', '-b', 'main'], { cwd: repo });
  await run('git', ['config', 'user.name', 'Tester'], { cwd: repo });
  await run('git', ['config', 'user.email', 'test@test.local'], { cwd: repo });
  await writeFile(join(repo, 'src/initial.ts'), 'export const initial = true;\n');
  await run('git', ['add', '.'], { cwd: repo });
  await run('git', ['commit', '-m', 'initial commit'], { cwd: repo });
  const baseCommit = (await git(repo, ['rev-parse', 'HEAD'])).trim();

  const session = await criarSessaoWorktree({
    repositorioOrigem: repo,
    branchOrigem: 'main',
    commitBase: baseCommit,
    diretorioBase: join(root, 'worktrees'),
  });

  return { root, repo, session, baseCommit };
}

test('Given a candidate session blocked by governance When default cleanup occurs Then Git branch, commit, diff, and report are preserved for inspection', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    const code = `export function unapprovedModification() { return false; }`;
    await writeFile(join(session.caminhoWorktree, 'src/unapproved.ts'), code);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'unapproved change']);

    const candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
    });
    assert.equal(result.status, 'bloqueado');

    // Default session cleanup preserves branch
    await removerSessaoWorktree(session, false);

    // 1. Branch ref is preserved in repository
    const branchRef = (await git(repo, ['rev-parse', session.branchSessao])).trim();
    assert.equal(branchRef, candidateCommit, 'Candidate branch must point to candidate commit');

    // 2. Commit log and tree are preserved
    const commitLog = await git(repo, ['log', '-1', session.branchSessao, '--pretty=%s']);
    assert.equal(commitLog.trim(), 'unapproved change');

    // 3. Diff can still be produced against main
    const diff = await git(repo, ['diff', 'main', session.branchSessao]);
    assert.ok(diff.includes('unapprovedModification'));

    // 4. Persistence report is retrievable
    const reportPath = join(repo, '.bsh/local/sessions', `${session.id}.report.json`);
    const rawReport = await readFile(reportPath, 'utf8');
    const parsed = JSON.parse(rawReport);
    assert.equal(parsed.lastGovernanceDecision.promotionDecision, 'DENY');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a candidate session with validation failure When cleaned up Then candidate branch is not removed', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    const code = `
function authorize(userId: string) { return true; }
export function transfer(assetId: string) {
  authorize("user-1");
  save({ assetId, status: "TRANSFERRED" });
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/transfer.ts'), code);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'candidate transfer']);

    const candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
      validarGates: async () => ({ ok: false, saida: 'lint errors' }),
    });
    assert.equal(result.status, 'falha-validacao');

    await removerSessaoWorktree(session, false);

    const branchRef = (await git(repo, ['rev-parse', session.branchSessao])).trim();
    assert.equal(branchRef, candidateCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a candidate session with rebase conflict When cleaned up Then candidate branch is preserved', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    await writeFile(join(session.caminhoWorktree, 'src/initial.ts'), 'export const val = 1;');
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'session edit']);
    const candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();

    await writeFile(join(repo, 'src/initial.ts'), 'export const val = 2;');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'origin edit']);

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
    });
    assert.equal(result.status, 'conflitado');

    await removerSessaoWorktree(session, false);

    const branchRef = (await git(repo, ['rev-parse', session.branchSessao])).trim();
    assert.equal(branchRef, candidateCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given explicit discard action via descartarSessaoWorktree When invoked Then session branch is removed', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    await writeFile(join(session.caminhoWorktree, 'src/temp.ts'), 'export const temp = true;');
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'temp commit']);

    // Explicit discard
    await descartarSessaoWorktree(session);

    // Branch must be eliminated
    const branches = await git(repo, ['branch', '--list', session.branchSessao]);
    assert.equal(branches.trim(), '', 'Session branch must be completely deleted upon explicit discard');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
