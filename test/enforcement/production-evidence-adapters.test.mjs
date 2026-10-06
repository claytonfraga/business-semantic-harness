import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { evaluateGovernance } from '../../dist/enforcement/governanceDecision.js';
import {
  TypeScriptStructuralAdapter,
  TemporalSequenceAdapter,
  ConcurrencyVerificationAdapter,
  createProductionFactsExtractor,
  defaultEvidenceAdapters,
} from '../../dist/enforcement/evidenceAdapters.js';

const run = promisify(execFile);
const PREFIX = '@prefix ex: <urn:adapters:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';

async function initRepoFixture({
  rules = [],
  shapesContent = '',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-evidence-adapters-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/adapt'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'evidence-adapters-test',
      domains: [
        {
          id: 'adapt',
          version: '1.0.0',
          baseIri: 'urn:adapters:',
          ontology: 'domains/adapt/ontology.jsonld',
          shapes: 'domains/adapt/shapes.ttl',
          enforcement: 'domains/adapt/enforcement.json',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/adapt/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:adapters:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:TransferAsset', '@type': 'rdfs:Class' },
        { '@id': 'ex:StateTransition', '@type': 'rdfs:Class' },
        { '@id': 'ex:ConcurrentBalanceUpdate', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/adapt/shapes.ttl'),
    shapesContent || `${PREFIX}
ex:TransferShape a sh:NodeShape ; sh:targetClass ex:TransferAsset ;
  sh:property [ sh:path ex:status ; sh:hasValue "TRANSFERRED" ] .
`
  );

  await writeFile(
    join(repo, '.bsh/domains/adapt/enforcement.json'),
    JSON.stringify({
      schemaVersion: 1,
      regras: rules.length > 0 ? rules : [
        {
          id: 'rule-transfer',
          operacao: 'TransferAsset',
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

test('Given concrete evidence adapters When metadata is inspected Then language technology supportedOperations and limitations are declared', () => {
  for (const adapter of defaultEvidenceAdapters) {
    const meta = adapter.metadata;
    assert.ok(meta.id, 'Adapter must have an id');
    assert.ok(meta.name, 'Adapter must have a name');
    assert.ok(meta.language, 'Adapter must declare language');
    assert.ok(meta.technology, 'Adapter must declare technology');
    assert.ok(Array.isArray(meta.supportedOperations) && meta.supportedOperations.length > 0, 'Must declare supported operations');
    assert.ok(Array.isArray(meta.limitations) && meta.limitations.length > 0, 'Must document limitations');
  }
});

test('Given code where authorization function exists but is NOT executed before persistence When extracted Then missing requirement is flagged and promotion denied', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    // Code has an authorization function declaration, but calls save() directly without calling authorize() first!
    const vulnerableCode = `
function authorize(userId: string): boolean {
  return true;
}

export function transfer(assetId: string) {
  // Persistence called directly without preceding authorize() invocation!
  save({ assetId, status: "TRANSFERRED" });
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/transfer.ts'), vulnerableCode);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'candidate change']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // Decision must detect missing requirement: locating auth is not executing before persistence
    assert.equal(decision.evidenceSufficiency.sufficient, false);
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'FACT_EXTRACTION');
    assert.equal(decision.promotionDecision, 'DENY');

    const authMissingDetail = decision.evidenceSufficiency.details.find((d) =>
      d.missingRequirements.some((m) => m.includes('Localizar uma função de autorização não equivale a demonstrar sua execução antes da persistência'))
    );
    assert.ok(authMissingDetail, 'Must flag that locating auth does not prove execution before persistence');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given code where authorization is verifiably invoked before persistence When extracted Then authorization invariant is satisfied', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    // Code calls authorize() BEFORE save()
    const compliantCode = `
function authorize(userId: string): boolean {
  return true;
}

export function transfer(assetId: string, userId: string) {
  authorize(userId);
  save({ assetId, status: "TRANSFERRED" });
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/transfer.ts'), compliantCode);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'compliant candidate']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // No authorization-before-persistence failure
    const authFailed = decision.evidenceSufficiency.details.some((d) =>
      d.missingRequirements.some((m) => m.includes('Localizar uma função de autorização'))
    );
    assert.equal(authFailed, false, 'Compliant authorization before persistence must not fail');
    assert.equal(decision.validationStatus, 'CONFORMING');
    assert.equal(decision.promotionDecision, 'ALLOW');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a temporal sequence rule without causal event trace When extracted Then temporal sequence missing requirement produces INDETERMINATE', async () => {
  const rules = [
    {
      id: 'rule-temporal',
      operacao: 'StateTransition',
      quando: { caminho: 'src/**', adicionou: 'transition' },
      fatos: [
        { propriedade: 'previousState', valor: 'AVAILABLE', determinacao: 'observado', origem: 'code' },
        { propriedade: 'currentState', valor: 'IN_USE', determinacao: 'observado', origem: 'code' },
      ],
      evidenciasRequeridas: [{ tipo: 'estrutural' }],
    },
  ];

  const shapes = `${PREFIX}
ex:TransitionShape a sh:NodeShape ; sh:targetClass ex:StateTransition ;
  sh:property [ sh:path ex:currentState ; sh:hasValue "IN_USE" ] .
`;

  const { root, session } = await initRepoFixture({ rules, shapesContent: shapes });
  try {
    // Code without sequence/lifecycle evidence
    const codeNoSequence = `
export function transition() {
  return "just a simple stub";
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/transition.ts'), codeNoSequence);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'temporal candidate without trace']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'FACT_EXTRACTION');
    const hasTemporalReq = decision.evidenceSufficiency.details.some((d) =>
      d.missingRequirements.some((m) => m.includes('Regras temporais exigem evidências da sequência de eventos'))
    );
    assert.ok(hasTemporalReq, 'Must require temporal sequence evidence for sequence rule');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a concurrency-dependent rule without concurrency test or lock protocol When extracted Then concurrency requirement produces INDETERMINATE', async () => {
  const rules = [
    {
      id: 'rule-concurrency',
      operacao: 'ConcurrentBalanceUpdate',
      quando: { caminho: 'src/**', adicionou: 'atomic' },
      fatos: [{ propriedade: 'status', valor: 'UPDATED', determinacao: 'observado', origem: 'code' }],
      evidenciasRequeridas: [{ tipo: 'estrutural' }],
    },
  ];

  const shapes = `${PREFIX}
ex:ConcurrentShape a sh:NodeShape ; sh:targetClass ex:ConcurrentBalanceUpdate ;
  sh:property [ sh:path ex:status ; sh:hasValue "UPDATED" ] .
`;

  const { root, session } = await initRepoFixture({ rules, shapesContent: shapes });
  try {
    // Code with naked mutation without mutex/lock/version token
    const codeNoLock = `
let balance = 100;
export function atomicUpdate(amount: number) {
  balance += amount; // Race condition without concurrency protection!
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/concurrent.ts'), codeNoLock);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'concurrency candidate without protocol']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'FACT_EXTRACTION');
    const hasConcurrencyReq = decision.evidenceSufficiency.details.some((d) =>
      d.missingRequirements.some((m) => m.includes('Regras dependentes de concorrência exigem evidências apropriadas'))
    );
    assert.ok(hasConcurrencyReq, 'Must require concurrency verification or protocol evidence');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given production promoverSessao invocation with connected production facts extractor When promoted Then candidate is successfully validated and promoted', async () => {
  const { root, repo, session } = await initRepoFixture();
  try {
    const compliantCode = `
function authorize(userId: string): boolean {
  return true;
}

export function transfer(assetId: string, userId: string) {
  authorize(userId);
  save({ assetId, status: "TRANSFERRED" });
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/transfer.ts'), compliantCode);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'production promotion test']);

    // Calling promoverSessao connecting production facts extractor (as wired in TUI & headless)
    const promotionResult = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
      validarGates: async () => ({ ok: true, saida: 'All gates passed' }),
    });

    assert.equal(promotionResult.status, 'promovido');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
