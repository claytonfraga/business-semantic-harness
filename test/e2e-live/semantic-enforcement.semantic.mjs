import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { after, test } from 'node:test';
import { criarSessaoWorktree } from '../../dist/git/worktree.js';
import { finalizeSession } from '../../dist/git/finalize.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { createProductionFactsExtractor } from '../../dist/enforcement/evidenceAdapters.js';

// Production-module integration, not a functional TUI/headless E2E session.
// No mocked extractor, SHACL engine, technical gate, or Git integration.
// Synthetic recognition rules are fixtures; their configured facts are not proof
// of arbitrary runtime behavior. Packaged CLI journeys supply functional evidence.
const root = mkdtempSync(join(tmpdir(), 'bsh-semantic-integration-'));
after(() => rmSync(root, { recursive: true, force: true }));
const iri = 'urn:semantic-regression:';
const approved = 'export const publish = "APPROVED";\n';
const rejected = 'export const publish = "REJECTED";\n';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

async function fixture(name, { review = false, gateFailure = false } = {}) {
  const repo = join(root, name);
  const domain = join(repo, '.bsh/domains/synthetic');
  mkdirSync(domain, { recursive: true });
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, '.gitignore'), '.bsh/local/\n');
  writeFileSync(join(repo, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: name,
    domains: [{ id: 'synthetic', version: '1.0.0', baseIri: iri,
      ontology: 'domains/synthetic/ontology.jsonld', shapes: 'domains/synthetic/shapes.ttl',
      enforcement: 'domains/synthetic/enforcement.json' }] }));
  writeFileSync(join(domain, 'ontology.jsonld'), JSON.stringify({
    '@context': { ex: iri, bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' },
    '@graph': [{ '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
      { '@id': 'ex:Publish', '@type': 'rdfs:Class' },
      ...(review ? [{ '@id': 'ex:ReviewPolicy', '@type': 'bsh:Policy',
        'bsh:governs': { '@id': 'ex:Publish' }, 'bsh:requiresHumanReview': true }] : [])] }));
  writeFileSync(join(domain, 'shapes.ttl'), `@prefix ex: <${iri}> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:PublishShape a sh:NodeShape ; sh:targetClass ex:Publish ;
  sh:property [ sh:path ex:status ; sh:minCount 1 ; sh:in ( "APPROVED" ) ] .\n`);
  writeFileSync(join(domain, 'enforcement.json'), JSON.stringify({ regras: ['APPROVED', 'REJECTED', 'UNKNOWN'].map(status => ({
    id: `publish-${status}`, operacao: 'Publish', quando: { caminho: 'src/**', adicionou: `"${status}"` },
    fatos: [{ propriedade: 'status', valor: status === 'UNKNOWN' ? null : status,
      determinacao: status === 'UNKNOWN' ? 'indeterminado' : 'observado', origem: 'synthetic-recognition-fixture' }],
    evidenciasRequeridas: [{ tipo: 'estrutural' }],
  })) }));
  writeFileSync(join(repo, 'src/publication.js'), 'export const initial = true;\n');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ type: 'module', scripts: {
    quality: 'node --check src/publication.js', test: 'node --test test/publication.test.mjs' } }));
  writeFileSync(join(repo, 'test/publication.test.mjs'), `import assert from 'node:assert/strict';
import { test } from 'node:test';
test('Given a publication module When loaded Then it exports a state', async () => {
  const publication = await import('../src/publication.js');
  assert.equal(${gateFailure ? "publication.publish, 'TECHNICALLY_APPROVED'" : "typeof publication.publish, 'string'"});
});\n`);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Semantic QA']);
  git(repo, ['config', 'user.email', 'semantic-qa@example.invalid']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'Synthetic base']);
  const base = git(repo, ['rev-parse', 'HEAD']).trim();
  const session = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'main', commitBase: base,
    diretorioBase: join(root, 'worktrees') });
  return { repo, base, session };
}

async function execute(name, code, options = {}) {
  const f = await fixture(name, options);
  writeFileSync(join(f.session.caminhoWorktree, 'src/publication.js'), code);
  if (options.advance) {
    writeFileSync(join(f.repo, 'origin.txt'), 'Origin advance retained\n');
    git(f.repo, ['add', 'origin.txt']); git(f.repo, ['commit', '-q', '-m', 'Origin advance']);
  }
  if (options.conflict) {
    writeFileSync(join(f.repo, 'src/publication.js'), rejected);
    git(f.repo, ['add', '-A']); git(f.repo, ['commit', '-q', '-m', 'Conflicting origin']);
  }
  const originBefore = git(f.repo, ['rev-parse', 'HEAD']).trim();
  let confirmationCalls = 0;
  const result = await finalizeSession({ sessao: f.session, domain: 'synthetic',
    snapshot: await createOntologySnapshot(f.repo), alerts: options.alerts ?? [],
    ontologyQueries: 0, harnessTokens: 0, confirmar: async () => { confirmationCalls++; return options.confirm ?? true; },
    ...(!options.noExtractor ? { extractCandidateFacts: createProductionFactsExtractor(f.session.caminhoWorktree) } : {}) });
  const evidencePath = join(f.repo, '.bsh/local/enforcement', `${f.session.id}.json`);
  const decision = result.status === 'conflitado' ? null : JSON.parse(readFileSync(evidencePath, 'utf8'));
  return { ...f, result, decision, originBefore, confirmationCalls,
    originAfter: git(f.repo, ['rev-parse', 'HEAD']).trim(), content: readFileSync(join(f.repo, 'src/publication.js'), 'utf8') };
}

function unchanged(r) {
  assert.equal(r.originAfter, r.originBefore);
  assert.equal(git(r.repo, ['status', '--porcelain']).trim(), '');
}

test('Given independent conforming evidence When finalized with real technical gates Then only the authorized commit is integrated', async () => {
  const r = await execute('conforming', approved);
  assert.equal(r.result.status, 'promovido');
  assert.equal(r.content, approved);
  assert.equal(r.originAfter, r.decision.candidateCommit);
  assert.equal(r.decision.originChanged, true);
  assert.equal(r.decision.validationStatus, 'CONFORMING');
  assert.equal(r.decision.validationExecuted, true);
  assert.equal(r.decision.validationComplete, true);
  assert.equal(r.decision.promotionDecision, 'ALLOW');
  assert.deepEqual(r.decision.coveredPaths, ['src/publication.js']);
  assert.ok(r.decision.adaptersUsed.some(a => a.id === 'typescript-structural-adapter'));
  const report = JSON.parse(readFileSync(join(r.repo, '.bsh/local/sessions', `${r.session.id}.report.json`), 'utf8'));
  assert.equal(report.gatesAprovados, true);
  assert.equal(report.origemHeadDepois, r.decision.candidateCommit);
});

test('Given a SHACL violation without an agent conflict report When finalized Then semantic enforcement denies it and preserves origin', async () => {
  const r = await execute('violation', rejected);
  assert.equal(r.result.status, 'bloqueado');
  assert.equal(r.decision.validationStatus, 'VIOLATION');
  assert.ok(r.decision.violations.length > 0);
  unchanged(r);
});

test('Given real passing technical tests and a violating candidate When finalized Then technical success cannot override SHACL', async () => {
  const r = await execute('violation-technical-pass', rejected);
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  execFileSync('npm', ['test'], { cwd: r.session.caminhoWorktree, env: environment, stdio: 'pipe' });
  assert.equal(r.decision.promotionDecision, 'DENY');
  assert.equal(r.decision.validationStatus, 'VIOLATION');
  unchanged(r);
});

test('Given a human-review policy When ordinary confirmation is available Then it cannot substitute a candidate-bound review', async () => {
  const r = await execute('human-policy', approved, { review: true });
  assert.equal(r.result.status, 'bloqueado');
  assert.equal(r.decision.failureStage, 'POLICY');
  assert.equal(r.decision.policyDecision, 'DENY');
  assert.equal(r.confirmationCalls, 0);
  unchanged(r);
});

test('Given an undetermined required fact When finalized Then absence cannot become conformance', async () => {
  const r = await execute('unknown-fact', 'export const publish = "UNKNOWN";\n');
  assert.equal(r.result.status, 'bloqueado');
  assert.equal(r.decision.validationStatus, 'INDETERMINATE');
  assert.equal(r.decision.validationComplete, false);
  unchanged(r);
});

test('Given an unrecognized change When finalized Then missing coverage blocks without fabricating a violation', async () => {
  const r = await execute('outside-knowledge', 'export const neutral = true;\n');
  assert.equal(r.result.status, 'bloqueado');
  assert.equal(r.decision.validationStatus, 'INDETERMINATE');
  assert.equal(r.decision.validationExecuted, false);
  unchanged(r);
});

test('Given an applicable shape without an extractor When finalized Then evidence absence is explicit and cannot approve', async () => {
  const r = await execute('missing-extractor', approved, { noExtractor: true });
  assert.equal(r.result.status, 'bloqueado');
  assert.equal(r.decision.failureStage, 'FACT_EXTRACTION');
  assert.equal(r.decision.validationExecuted, false);
  unchanged(r);
});

test('Given conforming semantic evidence and a real failing technical gate When finalized Then origin stays intact', async () => {
  const r = await execute('technical-failure', approved, { gateFailure: true });
  assert.equal(r.result.status, 'falha-validacao');
  assert.equal(r.decision.validationStatus, 'CONFORMING');
  unchanged(r);
});

test('Given origin advances When conforming candidate is finalized Then reconciled evidence retains both commits', async () => {
  const r = await execute('origin-advance', approved, { advance: true });
  assert.equal(r.result.status, 'promovido');
  assert.equal(r.content, approved);
  assert.equal(readFileSync(join(r.repo, 'origin.txt'), 'utf8'), 'Origin advance retained\n');
  assert.equal(r.originAfter, r.decision.candidateCommit);
});

test('Given a reconciliation conflict When finalized Then conflict is isolated and origin is preserved', async () => {
  const r = await execute('origin-conflict', approved, { conflict: true });
  assert.equal(r.result.status, 'conflitado');
  assert.equal(r.content, rejected);
  unchanged(r);
  git(r.session.caminhoWorktree, ['rebase', '--abort']);
});

test('Given a conforming candidate with an agent alert When user refuses exception Then nothing is promoted', async () => {
  const r = await execute('agent-alert', approved, { confirm: false, alerts: [{ domain: 'synthetic',
    request: 'Publish', reason: 'Reported concern', conflictingRules: [`${iri}PublishShape`] }] });
  assert.equal(r.result.status, 'descartado');
  assert.equal(r.confirmationCalls, 1);
  unchanged(r);
});

test('Given all public promotion call sites When the static architecture inventory is inspected Then headless and TUI both use the independent governance gate', () => {
  // Architecture inventory supplements behavioral integration; it cannot prove
  // runtime authorization by itself and intentionally includes the headless path.
  const src = resolve('src');
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.ts')) files.push(path);
    }
  }
  visit(src);
  const callers = files.filter(path => /promoverSessao\(|integrar\(|reconciliar\(/.test(readFileSync(path, 'utf8')))
    .map(path => relative(src, path).replaceAll('\\', '/')).sort();
  assert.deepEqual(callers, ['agent/headless.ts', 'git/finalize.ts', 'git/promotion.ts', 'tui/session.ts']);
  for (const caller of ['agent/headless.ts', 'tui/session.ts']) {
    assert.match(readFileSync(join(src, caller), 'utf8'), /promoverSessao\(sessao,\s*\{\s*extractCandidateFacts:\s*createProductionFactsExtractor\(sessao\.caminhoWorktree\)/);
  }
});
