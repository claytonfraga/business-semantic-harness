import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { createProductionFactsExtractor } from '../../dist/enforcement/evidenceAdapters.js';

const run = promisify(execFile);
const PREFIX = '@prefix ex: <urn:promo:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';

async function initRepoFixture({ rules = [], shapesContent = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-promo-test-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/promo'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'promo-test',
      domains: [
        {
          id: 'promo',
          version: '1.0.0',
          baseIri: 'urn:promo:',
          ontology: 'domains/promo/ontology.jsonld',
          shapes: 'domains/promo/shapes.ttl',
          enforcement: 'domains/promo/enforcement.json',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/promo/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:promo:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:TransferAction', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/promo/shapes.ttl'),
    shapesContent || `${PREFIX}
ex:TransferShape a sh:NodeShape ; sh:targetClass ex:TransferAction ;
  sh:property [ sh:path ex:status ; sh:hasValue "TRANSFERRED" ] .
`
  );

  await writeFile(
    join(repo, '.bsh/domains/promo/enforcement.json'),
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

test('Given a candidate promoted in promoverSessao When integrated Then commitIntegrado matches candidateCommit and status is promovido', async () => {
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
    await git(session.caminhoWorktree, ['commit', '-m', 'valid transfer candidate']);

    const candidateCommit = (await git(session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
      validarGates: async () => ({ ok: true, saida: 'Gates passed' }),
    });

    assert.equal(result.status, 'promovido');
    assert.equal(result.commitIntegrado, candidateCommit);
    assert.equal(result.candidatoAutorizado, candidateCommit);

    const originHead = (await git(repo, ['rev-parse', 'main'])).trim();
    assert.equal(originHead, candidateCommit);
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a candidate blocked by governance in promoverSessao When evaluated Then status is bloqueado with explicit etapaBloqueio and motivoBloqueio and R8 leaves origin unchanged', async () => {
  const { root, repo, session, baseCommit } = await initRepoFixture();
  try {
    // Unrecognized or violating candidate
    const code = `
export function rogueCode() {
  console.log("unrecognized modification");
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/rogue.ts'), code);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'unrecognized code']);

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
    });

    assert.equal(result.status, 'bloqueado');
    assert.ok(result.etapaBloqueio, 'Must report exact failure stage');
    assert.ok(result.motivoBloqueio, 'Must report exact failure reason');

    // Origin remains strictly unchanged
    const originHead = (await git(repo, ['rev-parse', 'main'])).trim();
    assert.equal(originHead, baseCommit, 'Origin must remain completely unchanged when blocked');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given technical gates failure When promoverSessao is executed Then status is falha-validacao with etapaBloqueio TECHNICAL_GATES', async () => {
  const { root, repo, session, baseCommit } = await initRepoFixture();
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

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
      validarGates: async () => ({ ok: false, saida: 'npm test failed with 2 errors' }),
    });

    assert.equal(result.status, 'falha-validacao');
    assert.equal(result.etapaBloqueio, 'TECHNICAL_GATES');
    assert.ok(result.detalhes.includes('npm test failed'));

    // Origin not changed
    const originHead = (await git(repo, ['rev-parse', 'main'])).trim();
    assert.equal(originHead, baseCommit);
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given rebase conflict with origin When promoverSessao is executed Then status is conflitado with etapaBloqueio RECONCILIATION and conflict files listed', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    // Worktree changes initial.ts
    await writeFile(join(session.caminhoWorktree, 'src/initial.ts'), 'export const conflict = "worktree";\n');
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'worktree change']);

    // Origin changes initial.ts differently
    await writeFile(join(repo, 'src/initial.ts'), 'export const conflict = "origin";\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'origin change']);

    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
    });

    assert.equal(result.status, 'conflitado');
    assert.equal(result.etapaBloqueio, 'RECONCILIATION');
    assert.ok(result.arquivosConflito.includes('src/initial.ts'));
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
