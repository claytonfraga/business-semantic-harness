import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { criarSessaoWorktree, git, removerSessaoWorktree } from '../../dist/git/worktree.js';
import { promoverSessao } from '../../dist/git/promotion.js';
import { finalizeSession } from '../../dist/git/finalize.js';
import { evaluateGovernance } from '../../dist/enforcement/governanceDecision.js';
import { avaliarOperacoes } from '../../dist/enforcement/motorEnforcement.js';

const run = promisify(execFile);
const gatesOk = async () => ({ ok: true, saida: 'ok' });
const PREFIX = '@prefix ex: <urn:generic:> .';
const graph = (value) => `${PREFIX}\nex:candidate a ex:Action${value === null ? '' : ` ; ex:value "${value}"`} .\n`;

async function fixture({ sparql = false, coreValue = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-generic-governance-'));
  const repo = join(root, 'repository');
  await mkdir(join(repo, '.bsh/domains/generic'), { recursive: true });
  await mkdir(join(repo, 'src'));
  await writeFile(join(repo, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1,
    projectId: 'generic', domains: [{ id: 'generic', version: '1.0.0', baseIri: 'urn:generic:',
      ontology: 'domains/generic/ontology.jsonld', shapes: 'domains/generic/shapes.ttl' }] }));
  await writeFile(join(repo, '.bsh/domains/generic/ontology.jsonld'), JSON.stringify({
    '@context': { bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:generic:' },
    '@graph': [
      { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
      { '@id': 'ex:Action', '@type': 'rdfs:Class' },
    ],
  }));
  await writeFile(join(repo, '.bsh/domains/generic/shapes.ttl'), `${PREFIX}
@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:ActionShape a sh:NodeShape ; sh:targetClass ex:Action ;
  sh:property [ sh:path ex:value ; sh:minCount 1${coreValue ? ' ; sh:hasValue "ok"' : ''} ]${sparql ? ` ;
  sh:sparql [ sh:message "value rejected" ; sh:select "PREFIX ex: <urn:generic:> SELECT $this WHERE { $this ex:value ?value . FILTER(?value = 'bad') }" ]` : ''} .
`);
  await writeFile(join(repo, '.bsh/domains/generic/enforcement.json'), JSON.stringify({ regras: [{
    id: 'generic-rule', operacao: 'Action', quando: { caminho: 'src/**', adicionou: 'candidate-change' },
    fatos: [{ propriedade: 'value', valor: 'ok', determinacao: 'observado', origem: 'config' }],
  }] }));
  await writeFile(join(repo, 'src/module.js'), 'export const value = 1;\n');
  await run('git', ['init', '-q', '-b', 'master', repo]);
  await git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'add', '-A']);
  await git(repo, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base']);
  const base = (await git(repo, ['rev-parse', 'HEAD'])).trim();
  const session = await criarSessaoWorktree({ repositorioOrigem: repo, branchOrigem: 'master', commitBase: base,
    diretorioBase: join(root, 'worktrees') });
  await writeFile(join(session.caminhoWorktree, 'src/module.js'), 'export const value = 2; // candidate-change\n');
  const cleanup = async () => { await removerSessaoWorktree(session, true); await rm(root, { recursive: true, force: true }); };
  return { root, repo, session, base, cleanup };
}

function extractor(value, options = {}) {
  return async ({ sourceCommit, relevantPaths }) => ({
    sourceCommit: options.sourceCommit ?? sourceCommit,
    graphTurtle: options.graphTurtle ?? graph(value),
    coveredPaths: options.coveredPaths ?? relevantPaths,
  });
}

test('Given no recognized operations, When legacy aggregation runs, Then empty results are indeterminate', async () => {
  const result = await avaliarOperacoes('/unused', { projectId: 'unused', digest: 'unused', files: [] }, []);
  assert.equal(result.status, 'indeterminado');
  assert.equal(result.bloquear, true);
});

test('Given a fully represented conforming candidate, When promoted, Then the exact commit is accepted', async () => {
  const f = await fixture();
  try {
    let recorded;
    const result = await promoverSessao(f.session, { validarGates: gatesOk, extractCandidateFacts: extractor('ok'),
      onGovernanceDecision: async (decision) => { recorded = decision; } });
    assert.equal(result.status, 'promovido', result.detalhes);
    assert.equal(recorded.validationStatus, 'CONFORMING');
    assert.equal(recorded.policyDecision, 'ALLOW');
    assert.equal(recorded.originChanged, true);
    assert.deepEqual(recorded.selectedShapes, recorded.executedShapes);
    assert.notEqual((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a Core violation, When promotion is attempted, Then it is retained and origin stays unchanged', async () => {
  const f = await fixture({ coreValue: true });
  try {
    let decision;
    const result = await promoverSessao(f.session, { validarGates: gatesOk, extractCandidateFacts: extractor('bad'),
      onGovernanceDecision: async (item) => { decision = item; } });
    assert.equal(result.status, 'bloqueado');
    assert.equal(decision.validationStatus, 'VIOLATION', decision.reason);
    assert.ok(decision.results[0].validationResults.some(item => item.mechanism === 'SHACL_CORE'));
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a SPARQL violation, When promotion is attempted, Then it is retained by aggregation', async () => {
  const f = await fixture({ sparql: true });
  try {
    let decision;
    const result = await promoverSessao(f.session, { validarGates: gatesOk, extractCandidateFacts: extractor('bad'),
      onGovernanceDecision: async (item) => { decision = item; } });
    assert.equal(result.status, 'bloqueado');
    assert.equal(decision.validationStatus, 'VIOLATION', decision.reason);
    assert.ok(decision.results[0].validationResults.some(item => item.mechanism === 'SHACL_SPARQL'));
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given no trusted candidate facts, When promotion is attempted, Then static rule facts cannot authorize it', async () => {
  const f = await fixture();
  try {
    let decision;
    assert.equal((await promoverSessao(f.session, { validarGates: gatesOk,
      onGovernanceDecision: async (item) => { decision = item; } })).status, 'bloqueado');
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.selectedShapes.length, 1);
    assert.equal(decision.executedShapes.length, 0);
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a required fact absent from the candidate graph, When validated, Then it remains indeterminate', async () => {
  const f = await fixture();
  try {
    let decision;
    const result = await promoverSessao(f.session, { validarGates: gatesOk, extractCandidateFacts: extractor(null),
      onGovernanceDecision: async (item) => { decision = item; } });
    assert.equal(result.status, 'bloqueado');
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.ok(decision.missingFacts.length > 0);
  } finally { await f.cleanup(); }
});

test('Given an extractor error, When promotion is attempted, Then validation error denies promotion', async () => {
  const f = await fixture();
  try {
    const result = await promoverSessao(f.session, { validarGates: gatesOk,
      extractCandidateFacts: async () => { throw new Error('extractor unavailable'); } });
    assert.equal(result.status, 'bloqueado');
    assert.match(result.detalhes, /VALIDATION_ERROR/);
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a stale graph attestation, When promotion is attempted, Then the candidate is indeterminate', async () => {
  const f = await fixture();
  try {
    const result = await promoverSessao(f.session, { validarGates: gatesOk,
      extractCandidateFacts: extractor('ok', { sourceCommit: f.base }) });
    assert.equal(result.status, 'bloqueado');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a mutable audit callback, When it changes a denial, Then promotion still fails', async () => {
  const f = await fixture();
  try {
    const result = await promoverSessao(f.session, { validarGates: gatesOk,
      onGovernanceDecision: async (decision) => {
        decision.policyDecision = 'ALLOW';
        decision.promotionDecision = 'ALLOW';
      } });
    assert.equal(result.status, 'bloqueado');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given an enforcement disable environment flag, When promotion is attempted, Then the gate remains active', async () => {
  const f = await fixture();
  const before = process.env.BSH_ENFORCEMENT;
  process.env.BSH_ENFORCEMENT = 'off';
  try {
    const result = await promoverSessao(f.session, { validarGates: gatesOk });
    assert.equal(result.status, 'bloqueado');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally {
    if (before === undefined) delete process.env.BSH_ENFORCEMENT;
    else process.env.BSH_ENFORCEMENT = before;
    await f.cleanup();
  }
});

test('Given consultative condition, When finalized, Then no semantic enforcement decision is created', async () => {
  const f = await fixture();
  try {
    const result = await finalizeSession({
      sessao: f.session, domain: 'generic', snapshot: { digest: 'fixture' },
      alerts: [], tokenTotals: undefined, ontologyQueries: 0, harnessTokens: 0,
      validarGates: gatesOk, consultative: true,
    });
    assert.equal(result.status, 'promovido');
    assert.notEqual((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
    const report = JSON.parse(await readFile(join(f.repo, '.bsh/local/sessions', `${f.session.id}.report.json`), 'utf8'));
    assert.equal(report.sessionMode, 'CONSULTATIVE');
    assert.equal(report.enforcementExecutado, false);
    assert.equal(report.promovido, true);
    assert.equal(report.origemAlterada, true);
    await assert.rejects(readFile(join(f.repo, '.bsh/local/enforcement', `${f.session.id}.json`), 'utf8'));
  } finally { await f.cleanup(); }
});

test('Given incomplete coverage, When promotion is attempted, Then relevant diff is not silently ignored', async () => {
  const f = await fixture();
  try {
    const result = await promoverSessao(f.session, { validarGates: gatesOk,
      extractCandidateFacts: extractor('ok', { coveredPaths: [] }) });
    assert.equal(result.status, 'bloqueado');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a changed file without a recognized rule, When promotion is attempted, Then recognition fails closed', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.caminhoWorktree, 'src/module.js'), 'export const value = 2;\n');
    let decision;
    const result = await promoverSessao(f.session, { validarGates: gatesOk,
      extractCandidateFacts: extractor('ok'), onGovernanceDecision: async (item) => { decision = item; } });
    assert.equal(result.status, 'bloqueado');
    assert.equal(decision.validationStatus, 'INDETERMINATE');
    assert.equal(decision.failureStage, 'RECOGNITION');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a changed worktree during technical gates, When merge begins, Then revalidation is required', async () => {
  const f = await fixture();
  try {
    let lastDecision;
    const result = await promoverSessao(f.session, { extractCandidateFacts: extractor('ok'),
      onGovernanceDecision: async (decision) => { lastDecision = decision; },
      validarGates: async (workspace) => {
        await writeFile(join(workspace, 'src/module.js'), 'export const value = 3; // candidate-change\n');
        return gatesOk();
      } });
    assert.equal(result.status, 'bloqueado');
    assert.match(result.detalhes, /REVALIDATION_REQUIRED/);
    assert.equal(lastDecision.promotionDecision, 'REVALIDATION_REQUIRED');
    assert.equal(lastDecision.failureStage, 'TOCTOU');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given the origin checkout changes branch, When merge begins, Then promotion is blocked', async () => {
  const f = await fixture();
  try {
    const result = await promoverSessao(f.session, { extractCandidateFacts: extractor('ok'),
      validarGates: async () => {
        await git(f.repo, ['switch', '-q', '-c', 'other']);
        return gatesOk();
      } });
    assert.equal(result.status, 'bloqueado');
    assert.match(result.detalhes, /REVALIDATION_REQUIRED/);
    assert.equal((await git(f.repo, ['rev-parse', 'master'])).trim(), f.base);
    assert.equal((await git(f.repo, ['rev-parse', 'other'])).trim(), f.base);
  } finally { await f.cleanup(); }
});

test('Given a direct promotion call without facts, When the gate executes, Then bypass fails', async () => {
  const f = await fixture();
  try {
    const result = await promoverSessao(f.session, { validarGates: gatesOk });
    assert.equal(result.status, 'bloqueado');
    assert.equal((await git(f.repo, ['rev-parse', 'HEAD'])).trim(), f.base);
  } finally { await f.cleanup(); }
});
