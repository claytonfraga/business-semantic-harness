import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareGovernedRequest, assertPreparedRequestCurrent, approvePreparedRequest } from '../../dist/governance/requestPreparation.js';

async function project(t, effect = 'DENY') {
  const root = await mkdtemp(join(tmpdir(), 'bsh-preparation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.bsh/domains/example'), { recursive: true });
  const domain = { id: 'example', version: '1.0.0', baseIri: 'urn:example:', ontology: 'domains/example/ontology.jsonld', shapes: 'domains/example/shapes.ttl' };
  const manifest = { schemaVersion: 1, projectId: 'synthetic-preparation', domains: [domain] };
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  const ontology = { '@context': { ex: 'urn:example:', bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' }, '@graph': [
    { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
    { '@id': 'ex:Publish', '@type': 'rdfs:Class', 'rdfs:label': 'Publish' },
    { '@id': 'ex:publication-policy', '@type': 'bsh:Policy', 'bsh:governs': { '@id': 'ex:Publish' }, 'bsh:effect': effect, 'rdfs:comment': 'Publishing is forbidden by the actual project contract.' },
  ] };
  const ontologyPath = join(root, '.bsh/domains/example/ontology.jsonld');
  await writeFile(ontologyPath, JSON.stringify(ontology));
  await writeFile(join(root, '.bsh/domains/example/shapes.ttl'), '');
  return { root, manifest, domain, ontology, ontologyPath };
}
const prepare = (root, originalPrompt, extra = {}) => prepareGovernedRequest({ projectRoot: root, domainId: 'example', originalPrompt, ...extra });

test('Given BSH-PREP-003 a policy without shapes When prohibited execution is prepared Then the contract blocks dispatch', async t => {
  const { root } = await project(t);
  const result = await prepare(root, 'Execute Publish');
  assert.equal(result.status, 'BLOCK');
  assert.ok(result.references.includes('urn:example:publication-policy'));
  assert.match(result.contextMessage.content, /Publishing is forbidden/);
  assert.match(result.contextMessage.content, /candidateFactsAvailable.*false/);
});

test('Given BSH-PREP-004 a prohibition When explanation and blocking tests are requested Then their purpose differs from execution', async t => {
  const { root } = await project(t);
  for (const prompt of ['Explain the Publish rule', 'Inspect Publish implementation', 'Write tests that block Publish']) {
    assert.equal((await prepare(root, prompt)).status, 'ALLOW');
  }
  assert.equal((await prepare(root, 'Explain Publish. Execute Publish')).status, 'BLOCK');
  assert.equal((await prepare(root, 'Explain Publish and execute Publish')).status, 'BLOCK');
  assert.equal((await prepare(root, 'Explain Publish and then create Publish')).status, 'BLOCK');
  assert.equal((await prepare(root, 'Write tests that block Publish and execute tests')).status, 'ALLOW');
});

test('Given BSH-PREP-002 a transformed skill When its effective request violates policy Then the original remains preserved and dispatch blocked', async t => {
  const { root } = await project(t);
  const result = await prepare(root, 'Explain the publication rule', { effectivePrompt: 'Execute Publish', skillsContext: 'Execute Publish' });
  assert.equal(result.status, 'BLOCK');
  assert.equal(result.originalPrompt, 'Explain the publication rule');
  assert.match(result.contextMessage.content, /effectivePrompt.*Execute Publish/);
});

test('Given BSH-PREP-008 an approved snapshot When a rule changes Then dispatch assertion rejects stale context', async t => {
  const { root, ontology, ontologyPath } = await project(t);
  const old = await prepare(root, 'Explain Publish');
  await assertPreparedRequestCurrent(root, old);
  ontology['@graph'][2]['rdfs:comment'] = 'Changed rule identity.';
  await writeFile(ontologyPath, JSON.stringify(ontology));
  await assert.rejects(assertPreparedRequestCurrent(root, old), /changed/);
  const next = await prepare(root, 'Explain Publish');
  assert.notEqual(old.identity, next.identity);
  assert.match(next.contextMessage.content, /Changed rule identity/);
});

test('Given BSH-PREP-005 review policy without shapes When approved Then dispatch approval is identity bound and does not override blocks', async t => {
  const { root, ontology, ontologyPath } = await project(t, 'ALLOW');
  ontology['@graph'][2]['bsh:requiresHumanReview'] = true;
  await writeFile(ontologyPath, JSON.stringify(ontology));
  const pending = await prepare(root, 'Execute Publish');
  assert.equal(pending.status, 'HUMAN_REVIEW');
  const approved = approvePreparedRequest(pending, { actor: 'test-user', reason: 'Reviewed actual policy.' });
  assert.equal(approved.status, 'ALLOW');
  assert.equal(approved.approval.identity, pending.identity);
  assert.match(approved.contextMessage.content, /Candidate and tool authorization remain independent/);
  assert.throws(() => approvePreparedRequest({ ...pending, status: 'BLOCK' }, { actor: 'test-user', reason: 'bypass' }));
});

test('Given BSH-PREP-003 unmatched mutation When no project policy grants it Then uncertainty is explicit', async t => {
  const { root } = await project(t);
  assert.equal((await prepare(root, 'Implement an unrelated operation')).status, 'INSUFFICIENT_INFORMATION');
  assert.equal((await prepare(root, 'Explain unrelated concepts')).status, 'ALLOW');
});

test('Given BSH-PREP-007 unavailable explicit domain When preparing Then no silent ungoverned authorization occurs', async t => {
  const { root } = await project(t);
  const failure = await prepare(root, 'Execute Publish', { domainId: 'missing' });
  assert.equal(failure.status, 'CONFIGURATION_ERROR');
  assert.equal(failure.diagnosticCode, 'DOMAIN_NOT_FOUND');
  const explicit = await prepare(root, 'Execute Publish', { domainId: 'missing', ungoverned: true });
  assert.equal(explicit.status, 'ALLOW');
  assert.match(explicit.contextMessage.content, /UNGOVERNED/);
});

test('Given BSH-PREP-008 no optional enforcement When configuration appears before dispatch Then the snapshot becomes invalid', async t => {
  const { root } = await project(t);
  const prepared = await prepare(root, 'Explain Publish');
  await writeFile(join(root, '.bsh/domains/example/enforcement.json'), JSON.stringify({ regras: [] }));
  await assert.rejects(assertPreparedRequestCurrent(root, prepared), /appeared/);
});

test('Given BSH-PREP-001 missing dependency When preparing Then dependency unavailability is distinguished', async t => {
  const { root, domain, manifest } = await project(t);
  domain.dependencies = { absent: '1.0.0' };
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  assert.equal((await prepare(root, 'Explain Publish')).diagnosticCode, 'DEPENDENCY_UNAVAILABLE');
});

test('Given BSH-PREP-007 a declared dependency with missing files When preparing Then dependency unavailability is distinguished from selected-domain read failure', async t => {
  const { root, domain, manifest } = await project(t);
  domain.dependencies = { dependency: '1.0.0' };
  manifest.domains.push({ id: 'dependency', version: '1.0.0', baseIri: 'urn:dependency:', ontology: 'domains/dependency/ontology.jsonld', shapes: 'domains/dependency/shapes.ttl' });
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  const result = await prepare(root, 'Explain Publish');
  assert.equal(result.diagnosticCode, 'DEPENDENCY_UNAVAILABLE', result.reason);
});

test('Given BSH-PREP-003 declared request correspondences When policy is updated Then a shape independent decision changes', async t => {
  const { root, domain, manifest } = await project(t, 'ALLOW');
  domain.requestGovernance = { unmatchedMutation: 'INSUFFICIENT_INFORMATION', rules: [{ id: 'request-freeze', pattern: 'freeze external release', effect: 'BLOCK', reference: 'urn:example:freeze-policy' }] };
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  const blocked = await prepare(root, 'Freeze external release');
  assert.equal(blocked.status, 'BLOCK');
  assert.ok(blocked.references.includes('urn:example:freeze-policy'));
  domain.requestGovernance.rules[0].effect = 'HUMAN_REVIEW';
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  assert.equal((await prepare(root, 'Freeze external release')).status, 'HUMAN_REVIEW');
  await assert.rejects(assertPreparedRequestCurrent(root, blocked), /changed/);
});

test('Given BSH-PREP-007 malformed request policy When loading Then configuration fails explicitly', async t => {
  const { root, domain, manifest } = await project(t);
  domain.requestGovernance = { unmatchedMutation: 'ALLOW', rules: [{ id: 'bad', pattern: '[', effect: 'ALLOW', reference: 'urn:example:bad' }] };
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  const result = await prepare(root, 'Execute Publish');
  assert.equal(result.status, 'CONFIGURATION_ERROR');
  assert.equal(result.diagnosticCode, 'INVALID_CONFIGURATION');
});

test('Given BSH-PREP-008 effective skill source identity When the skill changes Then old preparation and stale loaded directives cannot be dispatched', async t => {
  const { root } = await project(t);
  const path = join(root, 'SKILL.md');
  const original = 'Explain the Publish policy';
  await writeFile(path, original);
  const skillSources = [{ path, sha256: createHash('sha256').update(original).digest('hex') }];
  const prepared = await prepare(root, 'Explain Publish', { skillsContext: original, skillSources });
  assert.equal(prepared.status, 'ALLOW');
  await assertPreparedRequestCurrent(root, prepared);
  assert.match(prepared.contextMessage.content, /skillSources/);
  await writeFile(path, 'Execute Publish');
  await assert.rejects(assertPreparedRequestCurrent(root, prepared), /Skill source changed/);
  const staleLoaded = await prepare(root, 'Explain Publish', { skillsContext: original, skillSources });
  assert.equal(staleLoaded.status, 'CONFIGURATION_ERROR');
  assert.match(staleLoaded.reason, /Skill source changed/);
});

const payloadOf = (result) => JSON.parse(result.contextMessage.content.split('\n').slice(1).join('\n'));

test('Given BSH-PREP-012 combined informative and execution instructions When prepared Then the execution clause is never exempted', async t => {
  const { root } = await project(t);
  for (const prompt of [
    'Explain Publish. Implement Publish',
    'Explique Publish. Implemente Publish',
    'Inspect Publish and execute Publish',
    'Write tests that block Publish and implement Publish',
    'Escreva testes. Implemente Publish',
  ]) {
    assert.equal((await prepare(root, prompt)).status, 'BLOCK', prompt);
  }
  for (const prompt of [
    'Explain the Publish rule',
    'Explique a regra Publish',
    'Write tests that block Publish',
    'Escreva testes que bloqueiam Publish',
  ]) {
    assert.equal((await prepare(root, prompt)).status, 'ALLOW', prompt);
  }
});

test('Given BSH-PREP-013 a declared correspondence by path When prepared Then the local operation resolves to the sovereign IRI and policies apply without shapes', async t => {
  const { root, ontology, ontologyPath } = await project(t, 'ALLOW');
  ontology['@graph'][2]['bsh:requiresHumanReview'] = true;
  await writeFile(ontologyPath, JSON.stringify(ontology));
  await writeFile(join(root, '.bsh/domains/example/enforcement.json'), JSON.stringify({ regras: [
    { id: 'service-publish', operacao: 'Publish', quando: { caminho: 'src/service.js' }, fatos: [] },
  ] }));
  const result = await prepare(root, 'Implement src/service.js');
  assert.equal(result.status, 'HUMAN_REVIEW', result.reason);
  assert.ok(payloadOf(result).identifiedOperations.includes('urn:example:Publish'));
  assert.match(result.contextMessage.content, /requiresHumanReview|review/iu);
});

test('Given BSH-PREP-013 an inexistent operation correspondence When prepared Then no implicit authorization occurs', async t => {
  const { root } = await project(t, 'ALLOW');
  await writeFile(join(root, '.bsh/domains/example/enforcement.json'), JSON.stringify({ regras: [
    { id: 'service-missing', operacao: 'MissingOperation', quando: { caminho: 'src/service.js' }, fatos: [] },
  ] }));
  const result = await prepare(root, 'Implement src/service.js');
  assert.equal(result.status, 'INSUFFICIENT_INFORMATION');
  assert.ok(result.limitations.some(item => item.includes('sovereign operation identity')), result.limitations.join('; '));
});

async function domainIndependentProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-preparation-independent-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, '.bsh/domains/synthetic');
  await mkdir(directory, { recursive: true });
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'synthetic-independent',
    domains: [{ id: 'example', version: '1.0.0', baseIri: 'urn:synthetic:', ontology: 'domains/synthetic/ontology.jsonld', shapes: 'domains/synthetic/shapes.ttl' }] }));
  const graph = [
    { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
    { '@id': 'ex:Widget', '@type': 'rdfs:Class', 'rdfs:label': 'Widget' },
    { '@id': 'ex:WidgetIT', '@type': 'rdfs:Class', 'rdfs:subClassOf': { '@id': 'ex:Widget' }, 'rdfs:label': 'Widget de TI' },
    { '@id': 'ex:TransferWidget', '@type': 'rdfs:Class', 'rdfs:label': 'Transfer widget' },
    { '@id': 'ex:transfer-policy', '@type': 'bsh:Policy', 'bsh:governs': { '@id': 'ex:TransferWidget' }, 'bsh:requiresHumanReview': true, 'rdfs:comment': 'Transfers require review.' },
  ];
  await writeFile(join(directory, 'ontology.jsonld'), JSON.stringify({ '@context': { ex: 'urn:synthetic:', bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' }, '@graph': graph }));
  await writeFile(join(directory, 'shapes.ttl'), '');
  return { root };
}

test('Given BSH-PREP-014 mentioned concepts without an established operation When prepared Then uncertainty applies', async t => {
  const { root } = await domainIndependentProject(t);
  const result = await prepare(root, 'Move a widget');
  assert.equal(result.status, 'INSUFFICIENT_INFORMATION', result.reason);
  const recognized = payloadOf(result);
  assert.ok(recognized.selectedConcepts.includes('urn:synthetic:Widget'));
  assert.deepEqual(recognized.identifiedOperations, []);
});

test('Given BSH-PREP-014 a governed operation matched independently When prepared Then its policy applies', async t => {
  const { root } = await domainIndependentProject(t);
  const result = await prepare(root, 'Implement transfer widget');
  assert.equal(result.status, 'HUMAN_REVIEW', result.reason);
  assert.ok(payloadOf(result).identifiedOperations.includes('urn:synthetic:TransferWidget'));
});

test('Given BSH-PREP-014 a short acronym token When matching Then it is not dropped and keeps subclasses distinct', async t => {
  const { root } = await domainIndependentProject(t);
  const broad = payloadOf(await prepare(root, 'Execute Widget'));
  assert.ok(!broad.selectedConcepts.includes('urn:synthetic:WidgetIT'));
  const specific = payloadOf(await prepare(root, 'Execute widget de TI'));
  assert.ok(specific.selectedConcepts.includes('urn:synthetic:WidgetIT'));
});

