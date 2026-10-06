// Requirements: BSH-ONT-008, BSH-ONT-PROFILE-001, BSH-ONT-EXECUTION-001. Real SHACL engine; no mocks.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateData, SEMANTIC_VALIDATION_PROFILE } from '../../dist/ontology/validate.js';
import { parseShapes } from '../../dist/ontology/rdf.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';
import { validarOperacao } from '../../dist/enforcement/validadorSemantico.js';

const prefixes = '@prefix ex: <urn:qa:> . @prefix sh: <http://www.w3.org/ns/shacl#> .';
const sh = (term) => `http://www.w3.org/ns/shacl#${term}`;
const validate = (shapes, data) => validateData(parseShapes(`${prefixes} ${shapes}`), parseShapes(`${prefixes} ${data}`));

test('Given multiple shapes with identical messages and an absent target, When validated, Then structured source identities and real execution remain distinct', async () => {
  const result = await validate(`
    ex:First a sh:NodeShape ; sh:targetClass ex:Action ; sh:property ex:Required .
    ex:Required sh:path ex:p ; sh:minCount 1 ; sh:message "same message" .
    ex:Second a sh:NodeShape ; sh:targetClass ex:Action ; sh:property ex:Pattern .
    ex:Pattern sh:path ex:q ; sh:pattern "^ok$" ; sh:message "same message" .
    ex:Absent a sh:NodeShape ; sh:targetClass ex:Other ; sh:class ex:Other .`,
  'ex:candidate a ex:Action ; ex:q "bad" .');
  assert.equal(result.conforms, false);
  assert.deepEqual(result.results.map((item) => item.shape).sort(), ['urn:qa:Pattern', 'urn:qa:Required']);
  assert.deepEqual(result.results.map((item) => item.constraintComponent).sort(), [sh('MinCountConstraintComponent'), sh('PatternConstraintComponent')]);
  assert.ok(!result.executedShapes.includes('urn:qa:Absent'));
  assert.ok(result.executedShapes.includes('urn:qa:First'));
  assert.ok(result.executedShapes.includes('urn:qa:Second'));
  for (const item of result.executionEvidence) {
    assert.equal(item.focusNode, 'urn:qa:candidate');
    assert.ok(item.targets.some((target) => target.predicate === sh('targetClass') && target.value === 'urn:qa:Action'));
  }
});

test('Given successful and failed logical branches, When the alternative conforms, Then branch evaluation is evidence rather than a top-level violation', async () => {
  const result = await validate(`ex:Choice a sh:NodeShape ; sh:targetClass ex:Action ;
    sh:or ( [ sh:class ex:Action ] [ sh:class ex:Other ] ) .`, 'ex:candidate a ex:Action .');
  assert.equal(result.conforms, true);
  assert.deepEqual(result.results, []);
  assert.ok(result.executionEvidence.some((item) => item.constraintComponent === sh('OrConstraintComponent') && item.outcome === 'passed'));
  assert.ok(result.executionEvidence.some((item) => item.constraintComponent === sh('ClassConstraintComponent') && item.outcome === 'violation'));
});

test('Given an active root shares a property with absent and deactivated roots, When validated, Then only the root actually invoked owns the evidence', async () => {
  const result = await validate(`
    ex:Active a sh:NodeShape ; sh:targetClass ex:Action ; sh:property ex:Shared .
    ex:Absent a sh:NodeShape ; sh:targetClass ex:Missing ; sh:property ex:Shared .
    ex:Disabled a sh:NodeShape ; sh:targetClass ex:Action ; sh:deactivated true ; sh:property ex:Shared .
    ex:Shared sh:path ex:p ; sh:minCount 1 .`, 'ex:candidate a ex:Action ; ex:p "ok" .');
  assert.deepEqual(result.executedShapes, ['urn:qa:Active']);
  assert.deepEqual(result.executionEvidence[0].owningShapes, ['urn:qa:Shared', 'urn:qa:Active']);
  assert.ok(result.executionEvidence.every((item) => item.targets.every((target) => target.shape === 'urn:qa:Active')));
});

test('Given class, node, subject and object targets with a nested inverse alternative path, When validated, Then actual nodes and constraints are recorded', async () => {
  const result = await validate(`
    ex:Node a sh:NodeShape ; sh:targetNode ex:a ; sh:node ex:Nested .
    ex:Nested sh:property [ sh:path [ sh:alternativePath ( ex:p [ sh:inversePath ex:q ] ) ] ; sh:minCount 1 ] .
    ex:Subjects a sh:NodeShape ; sh:targetSubjectsOf ex:p ; sh:nodeKind sh:IRI .
    ex:Objects a sh:NodeShape ; sh:targetObjectsOf ex:p ; sh:nodeKind sh:IRI .`, 'ex:a ex:p ex:b .');
  assert.equal(result.conforms, true);
  assert.ok(result.executionEvidence.some((item) => item.constraintComponent === sh('MinCountConstraintComponent')));
  assert.ok(result.executionEvidence.some((item) => item.focusNode === 'urn:qa:b' && item.targets.some((target) => target.predicate === sh('targetObjectsOf'))));
  assert.ok(result.executionEvidence.some((item) => item.focusNode === 'urn:qa:a' && item.targets.some((target) => target.predicate === sh('targetSubjectsOf'))));
});

test('Given an empty target set or deactivated shape, When the engine returns vacuous conformity, Then no executed constraint is fabricated', async () => {
  for (const shape of ['sh:targetClass ex:Missing ; sh:class ex:Missing', 'sh:targetClass ex:Action ; sh:deactivated true ; sh:class ex:Missing']) {
    const result = await validate(`ex:Shape a sh:NodeShape ; ${shape} .`, 'ex:candidate a ex:Action .');
    assert.equal(result.conforms, true);
    assert.deepEqual(result.executedShapes, []);
    assert.deepEqual(result.executionEvidence, []);
  }
});

test('Given SHACL-SPARQL accepts or rejects a candidate, When validated, Then the executed source constraint is recorded in both cases', async () => {
  const shapes = `ex:Rule a sh:NodeShape ; sh:targetClass ex:Action ; sh:sparql ex:Query .
    ex:Query sh:select "PREFIX ex: <urn:qa:> SELECT $this WHERE { $this ex:p ?v . FILTER(?v = 'bad') }" .`;
  for (const value of ['ok', 'bad']) {
    const result = await validate(shapes, `ex:candidate a ex:Action ; ex:p "${value}" .`);
    assert.equal(result.conforms, value === 'ok');
    assert.ok(result.executionEvidence.some((item) => item.constraintComponent === sh('SPARQLConstraintComponent') && item.sourceConstraints.includes('urn:qa:Query')));
    assert.equal(result.results.length, value === 'ok' ? 0 : 1);
  }
  await assert.rejects(validate(shapes.replace('SELECT $this WHERE', 'INVALID QUERY WHERE'), 'ex:candidate a ex:Action .'));
});

test('Given the semantic profile, When consulted, Then selection, completeness and inference limitations are explicit', () => {
  assert.match(SEMANTIC_VALIDATION_PROFILE.selection, /Exact.*targetClass/);
  assert.match(SEMANTIC_VALIDATION_PROFILE.completeness, /Immediate.*named-IRI.*minCount/);
  assert.match(SEMANTIC_VALIDATION_PROFILE.inference, /No RDF\/OWL/);
  assert.match(SEMANTIC_VALIDATION_PROFILE.generalSparqlQueries, /Not supported/);
});

test('Given subclass axioms in candidate data or in shapes, When class validation runs, Then only the declared shapes-graph resolution applies', async () => {
  const rule = 'ex:Rule a sh:NodeShape ; sh:targetNode ex:candidate ; sh:class ex:Parent .';
  const subclass = 'ex:Child <http://www.w3.org/2000/01/rdf-schema#subClassOf> ex:Parent .';
  const dataOnly = await validate(rule, `ex:candidate a ex:Child . ${subclass}`);
  assert.equal(dataOnly.conforms, false);
  assert.equal(dataOnly.results[0].constraintComponent, sh('ClassConstraintComponent'));
  const shapesAxiom = await validate(`${rule} ${subclass}`, 'ex:candidate a ex:Child .');
  assert.equal(shapesAxiom.conforms, true);
});

async function operationFixture(shapes, graph) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-semantic-execution-'));
  await mkdir(join(root, '.bsh/domains/qa'), { recursive: true });
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'qa', domains: [{ id: 'qa', version: '1.0.0', baseIri: 'urn:qa:', ontology: 'domains/qa/ontology.jsonld', shapes: 'domains/qa/shapes.ttl' }] }));
  await writeFile(join(root, '.bsh/domains/qa/ontology.jsonld'), JSON.stringify({ '@id': 'urn:qa:Action', '@type': 'http://www.w3.org/2000/01/rdf-schema#Class' }));
  await writeFile(join(root, '.bsh/domains/qa/shapes.ttl'), `${prefixes} ${shapes}`);
  try {
    return await validarOperacao(root, await createOntologySnapshot(root), { id: 'candidate', dominio: 'qa', operacao: 'Action', fatos: [], alteracoesRelacionadas: ['src/module.js'], proveniencia: { origem: 'independent-extractor', descricao: 'QA candidate' }, candidateGraphTurtle: `${prefixes} ${graph}` }, { requireCandidateEvidence: true });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('Given selected but deactivated constraints, When operation enforcement runs, Then validation is indeterminate and unexecuted', async () => {
  const result = await operationFixture('ex:Disabled a sh:NodeShape ; sh:targetClass ex:Action ; sh:deactivated true ; sh:class ex:Other .', 'ex:candidate a ex:Action .');
  assert.deepEqual(result.selectedShapes, ['urn:qa:Disabled']);
  assert.deepEqual(result.executedShapes, []);
  assert.equal(result.validationExecuted, false);
  assert.equal(result.validationComplete, false);
  assert.equal(result.status, 'indeterminado');
});

test('Given a missing required fact and then a nested complex path, When enforcement runs, Then unknown direct evidence blocks while the engine handles complex paths', async () => {
  const missing = await operationFixture('ex:Rule a sh:NodeShape ; sh:targetClass ex:Action ; sh:property [ sh:path ex:p ; sh:minCount 1 ] .', 'ex:candidate a ex:Action .');
  assert.equal(missing.status, 'indeterminado');
  assert.deepEqual(missing.missingFacts, ['urn:qa:p']);
  assert.equal(missing.validationExecuted, false);
  const complex = await operationFixture('ex:Rule a sh:NodeShape ; sh:targetClass ex:Action ; sh:property [ sh:path ( ex:p ex:q ) ; sh:minCount 1 ] .', 'ex:candidate a ex:Action ; ex:p ex:b . ex:b ex:q "ok" .');
  assert.equal(complex.status, 'conforme', complex.evidencia.join('; '));
  assert.equal(complex.validationComplete, true);
});

test('Given two selected shapes with repeated messages, When only the second violates, Then enforcement identifies the second structured owner', async () => {
  const result = await operationFixture(`ex:First a sh:NodeShape ; sh:targetClass ex:Action ; sh:property [ sh:path ex:p ; sh:hasValue "ok" ; sh:message "same" ] .
    ex:Second a sh:NodeShape ; sh:targetClass ex:Action ; sh:property [ sh:path ex:q ; sh:hasValue "ok" ; sh:message "same" ] .`, 'ex:candidate a ex:Action ; ex:p "ok" ; ex:q "bad" .');
  assert.equal(result.status, 'violacao');
  assert.equal(result.shape, 'urn:qa:Second');
  assert.equal(result.validationResults[0].constraintComponent, sh('HasValueConstraintComponent'));
});
