import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { evaluateAction } from '../../dist/decision/evaluate.js';
import { ApprovalBroker } from '../../dist/decision/broker.js';
import { readAudit } from '../../dist/decision/audit.js';

const source = new URL('../fixtures/ativos/', import.meta.url);
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'oracle-decision-'));
  const directory = join(root, '.oracle/domains/ativos');
  await mkdir(directory, { recursive: true });
  await copyFile(new URL('ontology.jsonld', source), join(directory, 'ontology.jsonld'));
  await copyFile(new URL('shapes.ttl', source), join(directory, 'shapes.ttl'));
  await writeFile(join(root, '.oracle/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'pilot', domains: [{ id: 'ativos', version: '1.0.0', baseIri: 'urn:pilot:ativos:', ontology: 'domains/ativos/ontology.jsonld', shapes: 'domains/ativos/shapes.ttl' }] }));
  return root;
}
const action = (factsTurtle = '@prefix ex: <urn:pilot:ativos:> . ex:transferencia-1 a ex:TransferenciaAtivo ; ex:estadoAtual ex:EmUso .') => ({
  id: 'a1', tool: 'apply_patch', arguments: { asset: 1 }, domain: 'ativos', mutates: true, intercepted: true, representation: 'complete', factsTurtle,
  consequences: ['altera transferência'],
});

test('Given a conforming represented action without human policy, when evaluated, then it is allowed with a matched rule', async () => {
  const root = await project();
  try {
    const file = join(root, '.oracle/domains/ativos/ontology.jsonld');
    const graph = JSON.parse(await readFile(file, 'utf8'));
    graph['@graph'] = graph['@graph'].filter(item => item['@type'] !== 'oracle:Policy');
    await writeFile(file, JSON.stringify(graph));
    const snapshot = await createOntologySnapshot(root);
    const evaluation = await evaluateAction(root, action(), snapshot);
    assert.equal(evaluation.status, 'allow', evaluation.reasons.join('; '));
    assert.ok(evaluation.rules.some(rule => rule.endsWith('TransferenciaShape')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a SHACL violation, when evaluated, then the action needs human review before effects', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const facts = await readFile(new URL('invalid-action.ttl', source), 'utf8');
    const evaluation = await evaluateAction(root, action(facts), snapshot);
    assert.equal(evaluation.status, 'needs-human');
    assert.equal(evaluation.shacl.conforms, false);
    assert.ok(evaluation.reasons.some(reason => reason.includes('baixado')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a textual policy, when SHACL conforms, then human review is still required', async () => {
  const root = await project();
  try {
    const evaluation = await evaluateAction(root, action(), await createOntologySnapshot(root));
    assert.equal(evaluation.shacl.conforms, true);
    assert.equal(evaluation.status, 'needs-human');
    assert.ok(evaluation.rules.some(rule => rule.endsWith('justificativa-adequada')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given missing RDF facts, when a mutable action is evaluated, then it needs human review', async () => {
  const root = await project();
  try {
    const proposed = { ...action(), factsTurtle: undefined };
    const result = await evaluateAction(root, proposed, await createOntologySnapshot(root));
    assert.equal(result.status, 'needs-human');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given only partial confidence in represented facts, when evaluated, then SHACL conformity cannot auto-allow', async () => {
  const root = await project();
  try {
    const result = await evaluateAction(root, { ...action(), representation: 'partial' }, await createOntologySnapshot(root));
    assert.equal(result.status, 'needs-human');
    assert.equal(result.confidence, 'partial');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a mutable tool without trustworthy interception, when evaluated, then it fails closed', async () => {
  const root = await project();
  try {
    const result = await evaluateAction(root, { ...action(), intercepted: false }, await createOntologySnapshot(root));
    assert.equal(result.status, 'deny-on-failure');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a reviewed action, when allowed once, then the grant is bound and consumed only once', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const proposed = action();
    const evaluation = await evaluateAction(root, proposed, snapshot);
    const broker = new ApprovalBroker(root, async question => {
      assert.deepEqual(question.choices, ['allow-once', 'deny']);
      assert.equal(question.action.domain, 'ativos');
      return { choice: 'allow-once', actor: 'tester', reason: 'revisado' };
    });
    const authorization = await broker.authorize(proposed, evaluation, snapshot);
    assert.equal(authorization.allowed, true, authorization.reason);
    assert.equal(await broker.consume(authorization.token, proposed, snapshot), true);
    assert.equal(await broker.consume(authorization.token, proposed, snapshot), false);
    assert.equal((await broker.authorize(proposed, evaluation, snapshot)).allowed, false);
    const audit = await readFile(join(root, '.oracle/local/events.jsonl'), 'utf8');
    assert.ok(audit.includes('"actor":"tester"'));
    assert.equal((await readAudit(root, 'a1')).at(-1).decision, 'deny');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given altered arguments after evaluation, when authorization is requested, then it is denied', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const proposed = action();
    const evaluation = await evaluateAction(root, proposed, snapshot);
    proposed.arguments.asset = 2;
    const broker = new ApprovalBroker(root, async () => ({ choice: 'allow-once', actor: 'tester', reason: 'okay' }));
    assert.equal((await broker.authorize(proposed, evaluation, snapshot)).allowed, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a changed ontology after authorization, when consuming the one-time grant, then execution is denied', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const proposed = action();
    const evaluation = await evaluateAction(root, proposed, snapshot);
    const broker = new ApprovalBroker(root, async () => ({ choice: 'allow-once', actor: 'tester', reason: 'okay' }));
    const grant = await broker.authorize(proposed, evaluation, snapshot);
    assert.equal(grant.allowed, true);
    const file = join(root, '.oracle/domains/ativos/shapes.ttl');
    await writeFile(file, (await readFile(file, 'utf8')) + '\n# altered\n');
    assert.equal(await broker.consume(grant.token, proposed, snapshot), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given no human answer, when the deadline expires, then the action is denied and audited', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const proposed = action();
    const evaluation = await evaluateAction(root, proposed, snapshot);
    const broker = new ApprovalBroker(root, async () => new Promise(() => {}), 10);
    const decision = await broker.authorize(proposed, evaluation, snapshot);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /Tempo limite/);
    assert.match(await readFile(join(root, '.oracle/local/events.jsonl'), 'utf8'), /"decision":"deny"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given an unavailable audit path, when approval is granted, then no execution grant is released', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const proposed = action();
    const evaluation = await evaluateAction(root, proposed, snapshot);
    await mkdir(join(root, '.oracle/local'), { recursive: true });
    await mkdir(join(root, '.oracle/local/events.jsonl'));
    const broker = new ApprovalBroker(root, async () => ({ choice: 'allow-once', actor: 'tester', reason: 'okay' }));
    const decision = await broker.authorize(proposed, evaluation, snapshot);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /auditoria/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given a known secret in a review reason, when audited, then the secret is redacted', async () => {
  const root = await project();
  try {
    const snapshot = await createOntologySnapshot(root);
    const proposed = action();
    const evaluation = await evaluateAction(root, proposed, snapshot);
    const broker = new ApprovalBroker(root, async () => ({ choice: 'deny', actor: 'tester', reason: 'token abc"123 denied' }), 100, ['abc"123']);
    await broker.authorize(proposed, evaluation, snapshot);
    const audit = await readFile(join(root, '.oracle/local/events.jsonl'), 'utf8');
    assert.ok(!audit.includes('abc'));
    assert.ok(audit.includes('[REDACTED]'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
