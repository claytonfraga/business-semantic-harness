import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { evaluateWorkspaceDiffGate } from '../../dist/enforcement/diffGate.js';
import { evaluateGovernance } from '../../dist/enforcement/governanceDecision.js';
import { runCommand as run } from '../support/command-runner.mjs';
const PREFIX = '@prefix ex: <urn:reconciled:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';
const graph = (value) => `${PREFIX}\nex:candidate a ex:Item${value === null ? '' : ` ; ex:val "${value}"`} .\n`;

async function fixture({
  shapes = true,
  requireHuman = false,
  rules = true,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-reconciled-decision-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/rec'), { recursive: true });
  await mkdir(join(repo, 'src'));

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'reconciled-project',
      domains: [
        {
          id: 'rec',
          version: '1.0.0',
          baseIri: 'urn:reconciled:',
          ontology: 'domains/rec/ontology.jsonld',
          shapes: 'domains/rec/shapes.ttl',
        },
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/rec/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:reconciled:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Item', '@type': 'rdfs:Class' },
        ...(requireHuman
          ? [
              {
                '@id': 'ex:HumanReviewPolicy',
                '@type': 'bsh:Policy',
                'bsh:governs': { '@id': 'ex:Item' },
                'bsh:requiresHumanReview': 'true',
              },
            ]
          : []),
      ],
    })
  );

  await writeFile(
    join(repo, '.bsh/domains/rec/shapes.ttl'),
    `${PREFIX}
ex:ItemShape a sh:NodeShape ;
  sh:targetClass ex:${shapes ? 'Item' : 'Unrelated'} ;
  sh:property [ sh:path ex:val ; sh:minCount 1 ] .
`
  );

  if (rules) {
    await writeFile(
      join(repo, '.bsh/domains/rec/enforcement.json'),
      JSON.stringify({
        regras: [
          {
            id: 'rule-item',
            operacao: 'Item',
            quando: { caminho: 'src/**', adicionou: 'candidate-token' },
            fatos: [{ propriedade: 'val', valor: 'valid-val', determinacao: 'observado', origem: 'code' }],
            evidenciasRequeridas: [{ tipo: 'estrutural', propriedade: 'val', obrigatoria: true }],
          },
        ],
      })
    );
  }

  await writeFile(join(repo, 'src/app.js'), 'export const val = 1;\n');

  await run('git', ['init', '-q', '-b', 'master', repo]);
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

test('Given equivalent candidate and configuration, When evaluated by diff gate and governance, Then decisions are equivalent', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'candidate']);

    // 1. Evaluate via preliminary diff gate
    const diffGateResult = await evaluateWorkspaceDiffGate({
      worktree: f.session.caminhoWorktree,
      commitBase: f.base,
      domainId: 'rec',
      projectRoot: f.repo,
    });

    // 2. Evaluate via governance promotion gate
    const candCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    const govResult = await evaluateGovernance(f.session, async ({ relevantPaths }) => ({
      graphTurtle: graph('valid-val'),
      coveredPaths: [...relevantPaths],
      sourceCommit: candCommit,
    }));

    // Acceptance criteria 1: Same candidate, snapshot, and rules produce equivalent decision
    assert.equal(diffGateResult.conforming, true);
    assert.equal(diffGateResult.semanticStatus, 'CONFORMING');
    assert.equal(govResult.validationStatus, 'CONFORMING');
    assert.equal(govResult.policyDecision, 'ALLOW');
    assert.equal(govResult.promotionDecision, 'ALLOW');
    assert.deepEqual(diffGateResult.operations, govResult.recognizedOperation);
  } finally {
    await f.cleanup();
  }
});

test('Given a preliminary diff inspection, When evaluated, Then it declares its scope and refuses definitive authorization', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
    await git(f.session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'candidate']);

    const result = await evaluateWorkspaceDiffGate({
      worktree: f.session.caminhoWorktree,
      commitBase: f.base,
      domainId: 'rec',
      projectRoot: f.repo,
    });

    // Acceptance criteria 2:
    // Preliminary inspection states scope and does not issue definitive authorization
    assert.equal(result.isPreliminary, true);
    assert.equal(result.scope, 'preliminary_workspace_diff');
    assert.equal(result.definitiveAuthorization, false);
    assert.ok(result.disclaimer.includes('Não constitui autorização definitiva de promoção'));
  } finally {
    await f.cleanup();
  }
});

test('Given diverse candidate outcomes, When evaluated, Then error, indeterminacy, human review, violation, and conforming remain distinct', async () => {
  // 1. Violation
  const fViolation = await fixture();
  try {
    await writeFile(join(fViolation.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    // Change rules to provide missing/invalid facts violating minCount
    await writeFile(
      join(fViolation.repo, '.bsh/domains/rec/enforcement.json'),
      JSON.stringify({
        regras: [
          {
            id: 'rule-item',
            operacao: 'Item',
            quando: { caminho: 'src/**', adicionou: 'candidate-token' },
            fatos: [], // missing ex:val -> will violate minCount 1
          },
        ],
      })
    );
    const resultViolation = await evaluateWorkspaceDiffGate({
      worktree: fViolation.session.caminhoWorktree,
      commitBase: fViolation.base,
      domainId: 'rec',
      projectRoot: fViolation.repo,
    });
    assert.equal(resultViolation.gateStatus, 'VIOLATION');
    assert.equal(resultViolation.conforming, false);
    assert.ok(resultViolation.violations.length > 0);
  } finally {
    await fViolation.cleanup();
  }

  // 2. Human Review Required
  const fHuman = await fixture({ requireHuman: true });
  try {
    await writeFile(join(fHuman.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    const resultHuman = await evaluateWorkspaceDiffGate({
      worktree: fHuman.session.caminhoWorktree,
      commitBase: fHuman.base,
      domainId: 'rec',
      projectRoot: fHuman.repo,
    });
    assert.equal(resultHuman.gateStatus, 'HUMAN_REVIEW_REQUIRED');
    assert.equal(resultHuman.requiresHumanReview, true);
    assert.equal(resultHuman.conforming, false);
  } finally {
    await fHuman.cleanup();
  }

  // 3. Indeterminate (Unrecognized changes)
  const fIndet = await fixture({ rules: false });
  try {
    await writeFile(join(fIndet.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // unrecognized\n');
    const resultIndet = await evaluateWorkspaceDiffGate({
      worktree: fIndet.session.caminhoWorktree,
      commitBase: fIndet.base,
      domainId: 'rec',
      projectRoot: fIndet.repo,
    });
    assert.equal(resultIndet.gateStatus, 'INDETERMINATE');
    assert.equal(resultIndet.conforming, false);
    assert.equal(resultIndet.validationExecuted, false);
  } finally {
    await fIndet.cleanup();
  }

  // 4. No changes
  const fNoChanges = await fixture();
  try {
    const resultNoChanges = await evaluateWorkspaceDiffGate({
      worktree: fNoChanges.session.caminhoWorktree,
      commitBase: fNoChanges.base,
      domainId: 'rec',
      projectRoot: fNoChanges.repo,
    });
    assert.equal(resultNoChanges.gateStatus, 'NO_CHANGES');
    assert.equal(resultNoChanges.hasChanges, false);
  } finally {
    await fNoChanges.cleanup();
  }
});

test('Given diff gate inspection, When queried, Then operations, restrictions, evidences, and reasons are available', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    const result = await evaluateWorkspaceDiffGate({
      worktree: f.session.caminhoWorktree,
      commitBase: f.base,
      domainId: 'rec',
      projectRoot: f.repo,
    });

    // Acceptance criteria 4:
    // Interface allows querying operations, restrictions, evidences, coverage, and registered reasons
    assert.ok(Array.isArray(result.operations));
    assert.ok(result.operations.includes('Item'));
    assert.ok(Array.isArray(result.restrictions));
    assert.ok(Array.isArray(result.evidences));
    assert.ok(Array.isArray(result.reasons));
    assert.ok(result.reasons.length > 0);
  } finally {
    await f.cleanup();
  }
});

test('Given gate explanations, When checks are produced, Then they contain recoverable references', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    const result = await evaluateWorkspaceDiffGate({
      worktree: f.session.caminhoWorktree,
      commitBase: f.base,
      domainId: 'rec',
      projectRoot: f.repo,
    });

    // Acceptance criteria 5:
    // Explanation uses recoverable references (base commit, ontology digest, rule evaluation)
    assert.ok(result.references.ontologyDigest);
    assert.ok(result.references.evaluatingBaseCommit);
    assert.ok(result.checks.some((c) => c.reference === result.references.ontologyDigest));
  } finally {
    await f.cleanup();
  }
});

test('Given R3, When no shapes or rules are executed, Then semantic validity is NOT claimed', async () => {
  // Setup without applicable shapes (shapes=false)
  const f = await fixture({ shapes: false });
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    const result = await evaluateWorkspaceDiffGate({
      worktree: f.session.caminhoWorktree,
      commitBase: f.base,
      domainId: 'rec',
      projectRoot: f.repo,
    });

    // Acceptance criteria 7 (R3):
    // R3 ceases to present semantic validity without demonstrated execution
    assert.equal(result.validationExecuted, false);
    assert.equal(result.conforming, false);
    assert.equal(result.gateStatus, 'INDETERMINATE');
    // None of the checks should claim "propriedades semânticas válidas" without execution
    assert.ok(!result.checks.some((c) => c.text.includes('propriedades semânticas válidas')));
    assert.ok(result.checks.some((c) => c.text.includes('validade semântica não demonstrada')));
  } finally {
    await f.cleanup();
  }
});

test('Given LLM narrative in turn, When evaluated, Then model claims do not grant authorization', async () => {
  const f = await fixture();
  try {
    // Model output claims "The change is authorized and conforms"
    const modelNarrative = 'I have reviewed the changes and confirmed they are 100% compliant. Status: ALLOW.';

    // But candidate has violations or missing required attributes in actual code
    await writeFile(join(f.session.caminhoWorktree, 'src/app.js'), 'export const val = 2; // candidate-token\n');
    await writeFile(
      join(f.repo, '.bsh/domains/rec/enforcement.json'),
      JSON.stringify({
        regras: [
          {
            id: 'rule-item',
            operacao: 'Item',
            quando: { caminho: 'src/**', adicionou: 'candidate-token' },
            fatos: [], // missing mandatory property -> violation
          },
        ],
      })
    );

    const result = await evaluateWorkspaceDiffGate({
      worktree: f.session.caminhoWorktree,
      commitBase: f.base,
      domainId: 'rec',
      projectRoot: f.repo,
    });

    // Acceptance criteria 6:
    // Narrative remains separated from authorization authority; model text cannot override gate
    assert.ok(modelNarrative.includes('ALLOW'));
    assert.equal(result.conforming, false);
    assert.equal(result.gateStatus, 'VIOLATION');
    assert.ok(result.violations.length > 0);
  } finally {
    await f.cleanup();
  }
});
