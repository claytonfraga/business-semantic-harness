import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { evaluateGovernance } from '../../dist/enforcement/governanceDecision.js';
import { ApprovalBroker } from '../../dist/decision/broker.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';

const run = promisify(execFile);
const gatesOk = async () => ({ ok: true, saida: 'ok' });
const PREFIX = '@prefix ex: <urn:generic:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';
const graph = (value) => `${PREFIX}\nex:candidate a ex:Action${value === null ? '' : ` ; ex:value "${value}"`} .\n`;

async function fixture({
  shapeContent,
  policyContent,
  queryContent,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-contract-gov-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/generic/queries'), { recursive: true });
  await mkdir(join(repo, 'src'));

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'generic',
      domains: [
        {
          id: 'generic',
          version: '1.0.0',
          baseIri: 'urn:generic:',
          ontology: 'domains/generic/ontology.jsonld',
          shapes: 'domains/generic/shapes.ttl',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/generic/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:generic:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Action', '@type': 'rdfs:Class' },
        { '@id': 'ex:Other', '@type': 'rdfs:Class' },
      ],
    })
  );

  const defaultShapes = `${PREFIX}
ex:ActionShape a sh:NodeShape ;
  sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1 ] .
`;
  await writeFile(join(repo, '.bsh/domains/generic/shapes.ttl'), shapeContent ?? defaultShapes);

  const defaultPolicies = {
    regras: [
      {
        id: 'generic-rule',
        operacao: 'Action',
        quando: { caminho: 'src/**', adicionou: 'candidate-change' },
        fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
        evidenciasRequeridas: [{ tipo: 'estrutural', propriedade: 'value', obrigatoria: true }],
      },
    ],
  };
  await writeFile(join(repo, '.bsh/domains/generic/enforcement.json'), JSON.stringify(policyContent ?? defaultPolicies));

  const defaultQuery = `SELECT ?action ?value WHERE { ?action a ex:Action ; ex:value ?value . }\n`;
  await writeFile(join(repo, '.bsh/domains/generic/queries/evidence.rq'), queryContent ?? defaultQuery);

  await writeFile(join(repo, 'src/module.js'), 'export const value = 1;\n');

  await run('/usr/bin/rtk', ['git', 'init', '-q', '-b', 'master', repo]);
  await git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
  await git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base']);
  const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();

  const session = await criarSessaoWorktree({
    repositorioOrigem: repo,
    branchOrigem: 'master',
    commitBase: base,
    diretorioBase: join(root, 'worktrees'),
  });

  const cleanup = async () => {
    await removerSessaoWorktree(session, true);
    await rm(root, { recursive: true, force: true });
  };

  return { root, repo, session, base, cleanup };
}

test('Given functional and contract changes, When evaluated, Then distinct approval decisions are generated', async () => {
  const f = await fixture();
  try {
    // Modify functional file AND contract file in candidate worktree
    await writeFile(join(f.session.caminhoWorktree, 'src/module.js'), 'export const value = 2; // candidate-change\n');
    await writeFile(
      join(f.session.caminhoWorktree, '.bsh/domains/generic/shapes.ttl'),
      `${PREFIX}
ex:ActionShape a sh:NodeShape ;
  sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:extra ; sh:minCount 0 ] .
`
    );
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'mixed candidate']);

    const candCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    const decision = await evaluateGovernance(f.session, async ({ relevantPaths }) => ({
      graphTurtle: graph('ok'),
      coveredPaths: [...relevantPaths],
      sourceCommit: candCommit,
    }));

    // Acceptance criteria 1:
    // Functional changes and contract changes have distinct decisions
    assert.equal(decision.isContractChange, true);
    assert.equal(decision.isFunctionalChange, true);
    assert.ok(decision.contractPaths.length > 0);
    assert.ok(decision.functionalPaths.length > 0);
    assert.equal(decision.contractApprovalDecision, 'DENY');
    // Pure functional conformance is not enough to promote unapproved contract change
    assert.equal(decision.promotionDecision, 'DENY');
  } finally {
    await f.cleanup();
  }
});

test('Given a candidate that weakens shapes, When evaluated, Then weakening is detected and self-authorization is blocked', async () => {
  const baseShapes = `${PREFIX}
ex:ActionShape a sh:NodeShape ;
  sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:auth ; sh:minCount 1 ] .
`;
  const f = await fixture({ shapeContent: baseShapes });
  try {
    // Candidate weakens shapes: lowers sh:minCount for auth from 1 to 0
    await writeFile(
      join(f.session.caminhoWorktree, '.bsh/domains/generic/shapes.ttl'),
      `${PREFIX}
ex:ActionShape a sh:NodeShape ;
  sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:auth ; sh:minCount 0 ] .
`
    );
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'weakened shape']);

    const candCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    const decision = await evaluateGovernance(f.session);

    // Acceptance criteria 2:
    // Agent cannot use weakened restriction to authorize itself
    assert.equal(decision.isContractChange, true);
    assert.equal(decision.contractWeakeningDetected, true);
    assert.equal(decision.contractApprovalDecision, 'DENY');
    assert.equal(decision.promotionDecision, 'DENY');
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'POLICY');
    assert.match(decision.reason, /Enfraquecimento de restrições/);
  } finally {
    await f.cleanup();
  }
});

test('Given a candidate that modifies policies, When evaluated, Then policy weakening is detected and blocked', async () => {
  const f = await fixture();
  try {
    // Candidate removes rules or required evidence in enforcement.json
    await writeFile(
      join(f.session.caminhoWorktree, '.bsh/domains/generic/enforcement.json'),
      JSON.stringify({ regras: [] })
    );
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'weakened policy']);

    const decision = await evaluateGovernance(f.session);

    assert.equal(decision.isContractChange, true);
    assert.equal(decision.contractWeakeningDetected, true);
    assert.equal(decision.contractApprovalDecision, 'DENY');
    assert.equal(decision.promotionDecision, 'DENY');
    assert.match(decision.reason, /Enfraquecimento de restrições/);
  } finally {
    await f.cleanup();
  }
});

test('Given a candidate modifying SPARQL queries altering evidence selection, When evaluated, Then meaning review is required', async () => {
  const f = await fixture();
  try {
    // Candidate modifies the evidence selection query
    await writeFile(
      join(f.session.caminhoWorktree, '.bsh/domains/generic/queries/evidence.rq'),
      `SELECT ?action WHERE { ?action a ex:Action . }\n`
    );
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'query modified']);

    const decision = await evaluateGovernance(f.session);

    // Acceptance criteria 4:
    // Changes in queries that alter evidence selection are submitted to meaning review
    assert.equal(decision.isContractChange, true);
    assert.equal(decision.requiresMeaningReview, true);
    assert.equal(decision.meaningReviewCompleted, false);
    assert.equal(decision.contractApprovalDecision, 'DENY');
    assert.equal(decision.promotionDecision, 'DENY');
    assert.match(decision.reason, /revisão de significado/);
  } finally {
    await f.cleanup();
  }
});

test('Given a valid contract approval with responsible, justification, version, and commit, When evaluated, Then contract change is authorized', async () => {
  const f = await fixture();
  try {
    // Evolve contract legitimately
    await writeFile(
      join(f.session.caminhoWorktree, '.bsh/domains/generic/shapes.ttl'),
      `${PREFIX}
ex:ActionShape a sh:NodeShape ;
  sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1 ] ;
  sh:property [ sh:path ex:description ; sh:minCount 0 ] .
`
    );
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'evolve shapes']);

    const candCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();

    // Register formal human contract approval via broker
    const broker = new ApprovalBroker(f.repo);
    await broker.approveContractChange({
      domain: 'generic',
      version: '1.0.0',
      candidateCommit: candCommit,
      responsible: 'Security Architect <sec@example.com>',
      justification: 'Approved shape extension for optional description attribute',
    });

    const decision = await evaluateGovernance(f.session);

    // Acceptance criteria 5:
    // Approval registers responsible, justification, version, commit
    assert.equal(decision.isContractChange, true);
    assert.equal(decision.contractApprovalDecision, 'ALLOW');
    assert.ok(decision.contractApproval);
    assert.equal(decision.contractApproval.responsible, 'Security Architect <sec@example.com>');
    assert.equal(decision.contractApproval.justification, 'Approved shape extension for optional description attribute');
    assert.equal(decision.contractApproval.version, '1.0.0');
    assert.equal(decision.contractApproval.commit, candCommit);
    assert.equal(decision.validationStatus, 'CONFORMING');
    assert.equal(decision.promotionDecision, 'ALLOW');

    // Promotion gate integrates smoothly
    const promotion = await promoverSessao(f.session, { validarGates: gatesOk });
    assert.equal(promotion.status, 'promovido');
  } finally {
    await f.cleanup();
  }
});

test('Given missing responsible or justification in broker contract approval, When attempted, Then it is rejected', async () => {
  const f = await fixture();
  try {
    const broker = new ApprovalBroker(f.repo);
    // Missing responsible
    await assert.rejects(
      broker.approveContractChange({
        domain: 'generic',
        version: '1.0.0',
        candidateCommit: 'abcdef',
        responsible: '',
        justification: 'Some justification',
      }),
      /Responsável obrigatório/
    );

    // Missing justification
    await assert.rejects(
      broker.approveContractChange({
        domain: 'generic',
        version: '1.0.0',
        candidateCommit: 'abcdef',
        responsible: 'Dev Lead',
        justification: '   ',
      }),
      /Justificativa obrigatória/
    );

    // Missing candidate commit
    await assert.rejects(
      broker.approveContractChange({
        domain: 'generic',
        version: '1.0.0',
        candidateCommit: '',
        responsible: 'Dev Lead',
        justification: 'Justification',
      }),
      /Commit do candidato obrigatório/
    );
  } finally {
    await f.cleanup();
  }
});

test('Given governance decision, When inspected, Then evaluatingBaseIdentity preserves exact base commit, ontology hash, and policy hash', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/module.js'), 'export const value = 2; // candidate-change\n');
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'code change']);

    const candCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    const snapshot = await createOntologySnapshot(f.repo);

    const decision = await evaluateGovernance(f.session, async ({ relevantPaths }) => ({
      graphTurtle: graph('ok'),
      coveredPaths: [...relevantPaths],
      sourceCommit: candCommit,
    }));

    // Acceptance criteria 3:
    // Decision preserves base identity that actually evaluated the candidate
    assert.ok(decision.evaluatingBaseIdentity);
    assert.equal(decision.evaluatingBaseIdentity.commit, f.base);
    assert.equal(decision.evaluatingBaseIdentity.ontologyHash, snapshot.digest);
    assert.equal(decision.evaluatingBaseIdentity.manifestProjectId, 'generic');
    assert.ok(decision.evaluatingBaseIdentity.policyHash);
    assert.ok(decision.evaluatingBaseIdentity.evaluatingTimestamp);
  } finally {
    await f.cleanup();
  }
});
