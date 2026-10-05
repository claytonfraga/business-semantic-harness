import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { evaluateGovernance } from '../../dist/enforcement/governanceDecision.js';

const run = promisify(execFile);
const PREFIX = '@prefix ex: <urn:generic:> .\n@prefix ext: <urn:extension:> .\n@prefix bsh: <urn:bsh:ns:v1:> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';

async function createFixture({
  rules = [],
  crossDomain = false,
  violationShape = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-evidence-coverage-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/generic'), { recursive: true });
  await mkdir(join(repo, 'src'), { recursive: true });

  const domains = [
    {
      id: 'generic',
      version: '1.0.0',
      baseIri: 'urn:generic:',
      ontology: 'domains/generic/ontology.jsonld',
      shapes: 'domains/generic/shapes.ttl',
    },
  ];

  if (crossDomain) {
    await mkdir(join(repo, '.bsh/domains/extension'), { recursive: true });
    domains.push({
      id: 'extension',
      version: '1.0.0',
      baseIri: 'urn:extension:',
      ontology: 'domains/extension/ontology.jsonld',
      shapes: 'domains/extension/shapes.ttl',
    });
  }

  await writeFile(
    join(repo, '.bsh/project.json'),
    JSON.stringify({ schemaVersion: 1, projectId: 'generic-project', domains }),
  );

  await writeFile(
    join(repo, '.bsh/domains/generic/ontology.jsonld'),
    JSON.stringify({
      '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:generic:' },
      '@graph': [
        { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Action', '@type': 'rdfs:Class' },
        { '@id': 'ex:DependentAction', '@type': 'rdfs:Class' },
      ],
    }),
  );

  await writeFile(
    join(repo, '.bsh/domains/generic/shapes.ttl'),
    `${PREFIX}
ex:ActionShape a sh:NodeShape ; sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1${violationShape ? ' ; sh:hasValue "allowed"' : ''} ] .
`,
  );

  const defaultRules = [
    {
      id: 'rule-action',
      operacao: 'Action',
      quando: { caminho: 'src/module.js', adicionou: 'candidate-change' },
      fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
      evidenciasRequeridas: [{ tipo: 'estrutural' }],
    },
  ];

  await writeFile(
    join(repo, '.bsh/domains/generic/enforcement.json'),
    JSON.stringify({ regras: rules.length > 0 ? rules : defaultRules }),
  );

  if (crossDomain) {
    await writeFile(
      join(repo, '.bsh/domains/extension/ontology.jsonld'),
      JSON.stringify({
        '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ext: 'urn:extension:', ex: 'urn:generic:' },
        '@graph': [
          { '@id': 'ext:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
          { '@id': 'ext:ExtensionClass', '@type': 'rdfs:Class', 'rdfs:subClassOf': { '@id': 'ex:Action' } },
        ],
      }),
    );
    await writeFile(
      join(repo, '.bsh/domains/extension/shapes.ttl'),
      `${PREFIX}
ext:ExtensionShape a sh:NodeShape ; sh:targetClass ex:DependentAction ;
  sh:property [ sh:path ext:requiredDependency ; sh:hasValue "valid-ext" ] .
`,
    );
  }

  await writeFile(join(repo, 'src/module.js'), 'export const value = 1;\n');
  await writeFile(join(repo, 'src/unrelated.js'), 'export const other = 1;\n');
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

  await writeFile(join(session.caminhoWorktree, 'src/module.js'), 'export const value = 2; // candidate-change\n');
  await writeFile(join(session.caminhoWorktree, 'src/unrelated.js'), 'export const other = 2; // unrelated-change\n');
  await git(session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
  await git(session.caminhoWorktree, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'candidate']);

  const cleanup = async () => {
    await removerSessaoWorktree(session, true);
    await rm(root, { recursive: true, force: true });
  };

  return { root, repo, session, base, cleanup };
}

// BSH-SEM-026: Cada caminho coberto possui vínculo verificável com operação, regra e evidência.
test('Given BSH-SEM-026 multiple files in candidate diff, When evaluated, Then covered paths are verifiably bound to operation, rule and evidence without blanket association', async () => {
  const f = await createFixture();
  try {
    const candidateCommit = (await git(f.session.caminhoWorktree, ['rev-parse', 'HEAD'])).trim();
    const extractor = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:Action ; ex:value "ok" .\n`,
      // Extractor attempts to associate both files, but only src/module.js matches the operation's rule
      coveredPaths: ['src/module.js', 'src/unrelated.js'],
      structuralEvidence: [`${sourceCommit}:src/module.js`],
    });

    const decision = await evaluateGovernance(f.session, extractor);
    // Unrelated file is not recognized by any rule, so diff recognition demands coverage
    assert.ok(decision.coverageBindings.length > 0);
    for (const binding of decision.coverageBindings) {
      assert.equal(binding.path, 'src/module.js');
      assert.equal(binding.ruleId, 'rule-action');
      assert.equal(binding.operationName, 'Action');
      assert.equal(binding.evidenceType, 'structural');
      assert.match(binding.evidence, new RegExp(candidateCommit));
    }
    // src/unrelated.js was rejected from binding to rule-action because it doesn't match the rule pattern
    assert.equal(decision.coverageBindings.some((b) => b.path === 'src/unrelated.js'), false);
    assert.ok(decision.missingFacts.includes('src/unrelated.js'));
    assert.equal(decision.fileCoverage.coveredPaths.length, 1);
    assert.deepEqual(decision.fileCoverage.uncoveredPaths, ['src/unrelated.js']);
    assert.equal(decision.fileCoverage.ratio, 0.5);
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'FACT_EXTRACTION');
  } finally {
    await f.cleanup();
  }
});

// BSH-SEM-027: Cobertura de arquivos, cobertura de regras e suficiência das evidências são registradas separadamente.
test('Given BSH-SEM-027 conforming candidate, When evaluated, Then fileCoverage, ruleCoverage, and evidenceSufficiency are recorded separately', async () => {
  const f = await createFixture({
    rules: [
      {
        id: 'rule-action',
        operacao: 'Action',
        quando: { caminho: 'src/module.js', adicionou: 'candidate-change' },
        fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
        evidenciasRequeridas: [{ tipo: 'estrutural' }, { tipo: 'comportamental' }],
      },
      {
        id: 'rule-other',
        operacao: 'Action',
        quando: { caminho: 'src/unrelated.js', adicionou: 'unrelated-change' },
        fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
        evidenciasRequeridas: [{ tipo: 'estrutural' }],
      },
    ],
  });
  try {
    const extractor = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate1 a ex:Action ; ex:value "ok" .\nex:candidate2 a ex:Action ; ex:value "ok" .\n`,
      coveredPaths: relevantPaths,
      structuralEvidence: ['ast:module.js', 'ast:unrelated.js'],
      behavioralEvidence: ['trace:execution-test-module'],
    });

    const decision = await evaluateGovernance(f.session, extractor);
    // 1. Separate fileCoverage
    assert.ok(decision.fileCoverage);
    assert.equal(decision.fileCoverage.coveredPaths.length, 2);
    assert.equal(decision.fileCoverage.uncoveredPaths.length, 0);
    assert.equal(decision.fileCoverage.ratio, 1);

    // 2. Separate ruleCoverage
    assert.ok(decision.ruleCoverage);
    assert.deepEqual(decision.ruleCoverage.totalRules, ['rule-action', 'rule-other']);
    assert.deepEqual(decision.ruleCoverage.appliedRules, ['rule-action', 'rule-other']);
    assert.deepEqual(decision.ruleCoverage.unappliedRules, []);
    assert.deepEqual(decision.ruleCoverage.satisfiedRules, ['rule-action', 'rule-other']);

    // 3. Separate evidenceSufficiency
    assert.ok(decision.evidenceSufficiency);
    assert.equal(decision.evidenceSufficiency.sufficient, true);
    assert.equal(decision.evidenceSufficiency.details.length, 2);
    assert.equal(decision.evidenceSufficiency.details[0].status, 'SUFFICIENT');
    assert.equal(decision.evidenceSufficiency.details[1].status, 'SUFFICIENT');

    // 4. Distinct structural and behavioral evidence
    assert.deepEqual(decision.structuralEvidence, ['ast:module.js', 'ast:unrelated.js']);
    assert.deepEqual(decision.behavioralEvidence, ['trace:execution-test-module']);

    assert.equal(decision.validationStatus, 'CONFORMING');
    assert.equal(decision.promotionDecision, 'ALLOW');
  } finally {
    await f.cleanup();
  }
});

// BSH-SEM-027 (Evidence insufficiency): Missing required behavioral evidence marks evidenceSufficiency as false and denies promotion.
test('Given a rule requiring behavioral evidence and only structural evidence provided, When evaluated, Then evidenceSufficiency is insufficient and blocks with INDETERMINATE', async () => {
  const f = await createFixture({
    rules: [
      {
        id: 'rule-action',
        operacao: 'Action',
        quando: { caminho: 'src/**', adicionou: 'change' },
        fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
        evidenciasRequeridas: [{ tipo: 'comportamental' }],
      },
    ],
  });
  try {
    const extractor = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:Action ; ex:value "ok" .\n`,
      coveredPaths: relevantPaths,
      structuralEvidence: ['ast:module.js'],
      behavioralEvidence: [], // Missing required behavioral evidence
    });

    const decision = await evaluateGovernance(f.session, extractor);
    assert.equal(decision.evidenceSufficiency.sufficient, false);
    assert.equal(decision.evidenceSufficiency.details[0].status, 'INSUFFICIENT');
    assert.match(decision.evidenceSufficiency.details[0].missingRequirements[0], /comportamental/);
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'FACT_EXTRACTION');
    assert.equal(decision.promotionDecision, 'DENY');
  } finally {
    await f.cleanup();
  }
});

// BSH-SEM-024 / Ausência de informação vs Violação demonstrada
test('Given missing information, Then status is INDETERMINATE; But given a demonstrated violation, Then status receives distinct VIOLATION classification', async () => {
  const fMissing = await createFixture();
  const fViolation = await createFixture({ violationShape: true });
  try {
    // 1. Missing evidence produces INDETERMINATE with failureStage FACT_EXTRACTION
    const decisionMissing = await evaluateGovernance(fMissing.session);
    assert.equal(decisionMissing.validationStatus, 'INDETERMINATE');
    assert.equal(decisionMissing.failureStage, 'FACT_EXTRACTION');
    assert.equal(decisionMissing.violations.length, 0);

    // 2. Demonstrated violation produces VIOLATION with null failureStage
    const extractorBad = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:Action ; ex:value "disallowed-value" .\n`,
      coveredPaths: relevantPaths,
    });
    const decisionViolation = await evaluateGovernance(fViolation.session, extractorBad);
    assert.equal(decisionViolation.validationStatus, 'VIOLATION');
    assert.equal(decisionViolation.failureStage, null);
    assert.ok(decisionViolation.violations.length > 0);
  } finally {
    await fMissing.cleanup();
    await fViolation.cleanup();
  }
});

// BSH-SEM-028: Operações que atravessam domínios são avaliadas com suas dependências, sem presumir conformidade pela validação isolada de cada pacote.
test('Given BSH-SEM-028 an operation with cross-domain dependencies, When evaluated, Then dependent domain shapes are evaluated together and fail if cross-domain constraints are unmet', async () => {
  const f = await createFixture({
    crossDomain: true,
    rules: [
      {
        id: 'rule-cross-domain',
        operacao: 'DependentAction',
        dominio: 'generic',
        dependenciasDominio: ['extension'],
        quando: { caminho: 'src/**', adicionou: 'change' },
        fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
      },
    ],
  });
  try {
    // Graph provides invalid dependency value, violating the extension shape
    const extractorWithoutDep = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:DependentAction ; ex:value "ok" ; ext:requiredDependency "invalid-ext" .\n`,
      coveredPaths: relevantPaths,
    });

    const decisionFail = await evaluateGovernance(f.session, extractorWithoutDep);
    // Because extension shapes were loaded, ext:ExtensionShape caught the invalid dependency!
    assert.ok(decisionFail.selectedShapes.includes('urn:extension:ExtensionShape'));
    assert.equal(decisionFail.validationStatus, 'VIOLATION');
    assert.equal(decisionFail.promotionDecision, 'DENY');

    // When the valid dependent property is provided, it conforms
    const extractorWithDep = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:DependentAction ; ex:value "ok" ; ext:requiredDependency "valid-ext" .\n`,
      coveredPaths: relevantPaths,
    });

    const decisionPass = await evaluateGovernance(f.session, extractorWithDep);
    assert.equal(decisionPass.validationStatus, 'CONFORMING');
    assert.equal(decisionPass.promotionDecision, 'ALLOW');
    assert.ok(decisionPass.executedShapes.includes('urn:extension:ExtensionShape'));
  } finally {
    await f.cleanup();
  }
});

// BSH-SEM-029: Se houver seleção de subgrafos por SPARQL, o recorte preserva as informações exigidas pela decisão, incluindo autorizações e estados relacionados.
test('Given BSH-SEM-029 SPARQL subgraph selection, When it omits required authorizations or states, Then evidence sufficiency fails and denies promotion; When preserved, Then promotion is allowed', async () => {
  const f = await createFixture({
    rules: [
      {
        id: 'rule-action',
        operacao: 'Action',
        quando: { caminho: 'src/**', adicionou: 'change' },
        fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
      },
    ],
  });
  try {
    // 1. Subgraph omitted authorizations
    const extractorOmitted = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:Action ; ex:value "ok" .\n`,
      coveredPaths: relevantPaths,
      subgraphSelection: {
        query: 'CONSTRUCT WHERE { ?s ?p ?o }',
        omitsAuthorizations: true,
      },
    });

    const decisionOmitted = await evaluateGovernance(f.session, extractorOmitted);
    assert.equal(decisionOmitted.evidenceSufficiency.sufficient, false);
    assert.match(decisionOmitted.evidenceSufficiency.details[0].missingRequirements[0], /autorizações/);
    assert.equal(decisionOmitted.validationStatus, 'INDETERMINATE');
    assert.equal(decisionOmitted.failureStage, 'FACT_EXTRACTION');
    assert.equal(decisionOmitted.promotionDecision, 'DENY');

    // 2. Subgraph preserved authorizations and related states
    const extractorPreserved = async ({ sourceCommit, relevantPaths }) => ({
      sourceCommit,
      graphTurtle: `${PREFIX}ex:candidate a ex:Action ; ex:value "ok" .\n`,
      coveredPaths: relevantPaths,
      subgraphSelection: {
        query: 'CONSTRUCT WHERE { ?s ?p ?o }',
        preservedAuthorizations: ['auth:manager-role'],
        preservedStates: ['state:approved'],
        omitsAuthorizations: false,
        omitsRelatedStates: false,
      },
    });

    const decisionPreserved = await evaluateGovernance(f.session, extractorPreserved);
    assert.equal(decisionPreserved.evidenceSufficiency.sufficient, true);
    assert.equal(decisionPreserved.validationStatus, 'CONFORMING');
    assert.equal(decisionPreserved.promotionDecision, 'ALLOW');
  } finally {
    await f.cleanup();
  }
});
