import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import {
  evaluateGovernance,
  persistGovernanceDecision,
  loadGovernanceDecision,
} from '../../dist/enforcement/governanceDecision.js';
import { createProductionFactsExtractor } from '../../dist/enforcement/evidenceAdapters.js';

const run = promisify(execFile);
const PREFIX = '@prefix ex: <urn:prov:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';

async function initRepoFixture({
  rules = [],
  shapesContent = '',
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-provenance-test-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/prov'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'provenance-test',
      domains: [
        {
          id: 'prov',
          version: '1.0.0',
          baseIri: 'urn:prov:',
          ontology: 'domains/prov/ontology.jsonld',
          shapes: 'domains/prov/shapes.ttl',
          enforcement: 'domains/prov/enforcement.json',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/prov/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:prov:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:TransferAsset', '@type': 'rdfs:Class' },
        { '@id': 'ex:QueryAction', '@type': 'rdfs:Class' },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/prov/shapes.ttl'),
    shapesContent || `${PREFIX}
ex:TransferShape a sh:NodeShape ; sh:targetClass ex:TransferAsset ;
  sh:property [ sh:path ex:status ; sh:hasValue "TRANSFERRED" ] .
`
  );

  await writeFile(
    join(repo, '.bsh/domains/prov/enforcement.json'),
    JSON.stringify({
      schemaVersion: 1,
      regras: rules.length > 0 ? rules : [
        {
          id: 'rule-transfer-prov',
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

test('Given a candidate evaluated by governance When decision is inspected Then snapshot and base identity are reused and contentIdentification explicitly states isCertification false', async () => {
  const { root, session } = await initRepoFixture();
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
    await git(session.caminhoWorktree, ['commit', '-m', 'candidate change']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // 1. Reuses existing snapshot & base identity
    assert.ok(decision.evaluatingBaseIdentity.commit, 'Must record evaluating commit');
    assert.ok(decision.evaluatingBaseIdentity.ontologyHash, 'Must record evaluating ontology digest');
    assert.ok(decision.evaluatingBaseIdentity.policyHash, 'Must record evaluating policy hash');
    assert.equal(decision.evaluatingBaseIdentity.manifestProjectId, 'provenance-test');

    // 7. Hashes are presented as content identification without automatic certification claim
    assert.equal(decision.contentIdentification.identificationType, 'CONTENT_HASH');
    assert.equal(decision.contentIdentification.isCertification, false);
    assert.ok(decision.contentIdentification.ontologyHash);
    assert.ok(decision.contentIdentification.candidateGraphHash);
    assert.ok(decision.contentIdentification.candidateFingerprint);
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given evaluated evidence coverage bindings When inspected Then each evidence identifies origin method and scope', async () => {
  const { root, session } = await initRepoFixture();
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
    await git(session.caminhoWorktree, ['commit', '-m', 'candidate change']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // 2. Each evidence identifies origin, method, and scope
    assert.ok(decision.coverageBindings.length > 0, 'Must have coverage bindings');
    for (const binding of decision.coverageBindings) {
      assert.ok(binding.origin, 'Must identify origin of evidence');
      assert.ok(binding.method, 'Must identify method of obtaining evidence');
      assert.ok(binding.scope, 'Must identify scope of evidence');
      assert.ok(binding.evidence, 'Must have evidence identifier');
      assert.ok(binding.evidenceType, 'Must distinguish structural/behavioral');
      assert.equal(binding.operationName, 'TransferAsset');
    }
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a decision persisted via persistGovernanceDecision When retrieved with loadGovernanceDecision Then base identity and exact factsGraphTurtle can be recovered', async () => {
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
    await git(session.caminhoWorktree, ['commit', '-m', 'candidate change']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // 3. Persist and recover record
    const filePath = await persistGovernanceDecision(repo, session.id, decision);
    assert.ok(filePath.endsWith(`${session.id}.json`));

    const loaded = await loadGovernanceDecision(repo, session.id);
    assert.equal(loaded.validationStatus, decision.validationStatus);
    assert.equal(loaded.evaluatingBaseIdentity.commit, decision.evaluatingBaseIdentity.commit);
    assert.equal(loaded.evaluatingBaseIdentity.ontologyHash, decision.evaluatingBaseIdentity.ontologyHash);
    assert.equal(loaded.factsGraphTurtle, decision.factsGraphTurtle);
    assert.deepEqual(loaded.factsExtracted, decision.factsExtracted);

    // Verify session report was also updated
    const reportPath = join(repo, '.bsh', 'local', 'sessions', `${session.id}.report.json`);
    const sessionReport = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.ok(sessionReport.lastGovernanceDecision);
    assert.equal(sessionReport.lastGovernanceDecision.validationStatus, decision.validationStatus);
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given concrete production adapters and evaluated policies When decision is produced Then adaptersUsed policiesUsed and correspondencesUsed are completely recorded', async () => {
  const { root, session } = await initRepoFixture();
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
    await git(session.caminhoWorktree, ['commit', '-m', 'candidate change']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // 4. Policies, adapter versions, and correspondences are identified
    assert.ok(Array.isArray(decision.adaptersUsed) && decision.adaptersUsed.length > 0, 'Adapters must be recorded');
    const structuralAdapter = decision.adaptersUsed.find((a) => a.id === 'typescript-structural-adapter');
    assert.ok(structuralAdapter, 'TypeScript structural adapter must be recorded');
    assert.equal(structuralAdapter.version, '1.0.0');

    assert.ok(Array.isArray(decision.policiesUsed) && decision.policiesUsed.length > 0, 'Policies used must be identified');
    assert.ok(decision.policiesUsed.includes('rule-transfer-prov'));

    assert.ok(Array.isArray(decision.correspondencesUsed) && decision.correspondencesUsed.length > 0, 'Correspondences must be recorded');
    assert.equal(decision.correspondencesUsed[0].operation, 'TransferAsset');
    assert.equal(decision.correspondencesUsed[0].ruleId, 'rule-transfer-prov');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given SPARQL queries and SPARQL-based constraints When evaluated Then sparqlEvidences links query source results and timestamp', async () => {
  const sparqlShapes = `${PREFIX}
ex:QueryShape a sh:NodeShape ; sh:targetClass ex:QueryAction ;
  sh:sparql [
    sh:message "SPARQL constraint triggered" ;
    sh:select "PREFIX ex: <urn:prov:> SELECT $this WHERE { $this ex:disallowed 'true' }"
  ] .
`;

  const rules = [
    {
      id: 'rule-query',
      operacao: 'QueryAction',
      quando: { caminho: 'src/**', adicionou: 'queryAction' },
      fatos: [{ propriedade: 'disallowed', valor: 'false', determinacao: 'observado', origem: 'code' }],
      evidenciasRequeridas: [{ tipo: 'estrutural' }],
    },
  ];

  const { root, session } = await initRepoFixture({ rules, shapesContent: sparqlShapes });
  try {
    const code = `
export function queryAction() {
  return { disallowed: false };
}
`;
    await writeFile(join(session.caminhoWorktree, 'src/query.ts'), code);
    await git(session.caminhoWorktree, ['add', '.']);
    await git(session.caminhoWorktree, ['commit', '-m', 'sparql test candidate']);

    // Pass custom CandidateFacts with SPARQL subgraph selection to test provenance binding
    const customExtractor = async (input) => {
      const baseExtractor = createProductionFactsExtractor(session.caminhoWorktree);
      const facts = await baseExtractor(input);
      facts.subgraphSelection = {
        query: 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }',
        preservedAuthorizations: ['auth-token-1'],
        preservedStates: ['ACTIVE'],
      };
      return facts;
    };

    const decision = await evaluateGovernance(session, customExtractor);

    // 5. SPARQL query results as evidence are linked to query and source
    assert.ok(decision.sparqlEvidences.length > 0, 'Must record SPARQL evidence');
    const subgraphEv = decision.sparqlEvidences.find((s) => s.source === 'candidate_subgraph_selection');
    assert.ok(subgraphEv, 'Must link candidate subgraph selection query');
    assert.equal(subgraphEv.query, 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }');
    assert.ok(subgraphEv.executionTimestamp);
    assert.deepEqual(subgraphEv.results, {
      preservedAuthorizations: ['auth-token-1'],
      preservedStates: ['ACTIVE'],
    });
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given external domain dependencies or mutable data sources When tracked Then versionOrHash consistencyPolicy and verification are preserved', async () => {
  const rules = [
    {
      id: 'rule-cross-domain',
      operacao: 'TransferAsset',
      quando: { caminho: 'src/**', adicionou: 'transfer' },
      dependenciasDominio: ['external-domain-pkg'],
      fatos: [{ propriedade: 'status', valor: 'TRANSFERRED', determinacao: 'observado', origem: 'code' }],
      evidenciasRequeridas: [{ tipo: 'estrutural' }],
    },
  ];

  const { root, session } = await initRepoFixture({ rules });
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
    await git(session.caminhoWorktree, ['commit', '-m', 'cross domain candidate']);

    const extractor = createProductionFactsExtractor(session.caminhoWorktree);
    const decision = await evaluateGovernance(session, extractor);

    // 6. Mutable external data sources have verifiable version and consistency policy
    assert.ok(decision.externalDataSources.length > 0, 'Must track external domain dependencies');
    const ext = decision.externalDataSources.find((s) => s.source === 'domain_dependency:external-domain-pkg');
    assert.ok(ext, 'External domain dependency must be tracked');
    assert.equal(ext.consistencyPolicy, 'SNAPSHOT_PINNED');
    assert.ok(ext.versionOrHash);
    assert.equal(ext.revalidated, true);
    assert.ok(ext.verifiedAt);
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Given production promotion via promoverSessao When executed Then decision is automatically persisted in .bsh/local/enforcement and session report is updated', async () => {
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
    await git(session.caminhoWorktree, ['commit', '-m', 'promotion candidate']);

    // Calling promoverSessao
    const result = await promoverSessao(session, {
      extractCandidateFacts: createProductionFactsExtractor(session.caminhoWorktree),
      validarGates: async () => ({ ok: true, saida: 'All gates passed' }),
    });

    assert.equal(result.status, 'promovido');

    // 8. Automatic persistence in .bsh/local/enforcement
    const loaded = await loadGovernanceDecision(repo, session.id);
    assert.equal(loaded.validationStatus, 'CONFORMING');
    assert.equal(loaded.promotionDecision, 'ALLOW');
    assert.ok(loaded.evaluatingBaseIdentity.commit);
    assert.ok(loaded.coverageBindings.length > 0);

    const reportPath = join(repo, '.bsh', 'local', 'sessions', `${session.id}.report.json`);
    const sessionReport = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(sessionReport.lastGovernanceDecision.validationStatus, 'CONFORMING');
  } finally {
    await removerSessaoWorktree(session, true).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
