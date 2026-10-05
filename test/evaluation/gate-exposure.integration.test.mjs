import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCommand as exec } from '../support/command-runner.mjs';

test('Given fixed synthetic conforming violating and absent candidates, When the production validation exposure runs, Then it separates validation outcomes from unobserved promotion metrics (BSH-EXP-001 BSH-EXP-006)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-exposure-integration-'));
  try {
    await mkdir(join(root, '.bsh/domains/synthetic'), { recursive: true });
    await mkdir(join(root, 'evaluation/fixtures'), { recursive: true });
    await writeFile(join(root, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'synthetic',
      domains: [{ id: 'synthetic', version: '1.0.0', baseIri: 'urn:synthetic:',
        ontology: 'domains/synthetic/ontology.jsonld', shapes: 'domains/synthetic/shapes.ttl' }] }));
    await writeFile(join(root, '.bsh/domains/synthetic/ontology.jsonld'), JSON.stringify({ '@context': {
      bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#', ex: 'urn:synthetic:' },
      '@graph': [{ '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
        { '@id': 'ex:Action', '@type': 'rdfs:Class' }] }));
    await writeFile(join(root, '.bsh/domains/synthetic/shapes.ttl'), `@prefix ex: <urn:synthetic:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:Shape a sh:NodeShape ; sh:targetClass ex:Action ; sh:property [ sh:path ex:value ; sh:minCount 1 ; sh:in ("ok") ] .`);
    await writeFile(join(root, 'evaluation/fixtures/valid.ttl'), '@prefix ex: <urn:synthetic:> . ex:a a ex:Action ; ex:value "ok" .');
    await writeFile(join(root, 'evaluation/fixtures/invalid.ttl'), '@prefix ex: <urn:synthetic:> . ex:a a ex:Action ; ex:value "wrong" .');
    await writeFile(join(root, 'evaluation/fixtures/unrecognized.ttl'), '@prefix ex: <urn:synthetic:> . ex:a a ex:Unrecognized .');
    await writeFile(join(root, 'evaluation/fixtures/candidates.json'), JSON.stringify([
      { id: 'valid', expected: 'VALID', path: 'evaluation/fixtures/valid.ttl' },
      { id: 'invalid', expected: 'INVALID', path: 'evaluation/fixtures/invalid.ttl' },
      { id: 'absent', expected: 'VALID', path: 'evaluation/fixtures/absent.ttl' },
      { id: 'unrecognized', expected: 'INVALID', path: 'evaluation/fixtures/unrecognized.ttl' },
    ]));
    // Module integration, not a CLI/TUI E2E or an agent session. No validator mock.
    await exec('node', [resolve('scripts/gate-exposure.mjs'), root, join(root, 'output')]);
    const result = JSON.parse(await readFile(join(root, 'output/gate-exposure-results.json'), 'utf8'));
    assert.equal(result.falseBlocks, null);
    assert.equal(result.violationsPromoted, null);
    assert.equal(result.promotionMeasurement, 'NOT_ATTEMPTED');
    assert.equal(result.validCandidates, 1);
    assert.equal(result.invalidCandidatesDetected, 1);
    assert.equal(result.noCandidate, 1);
    assert.equal(result.missingEvidence, 1);
    assert.equal(result.results.find(row => row.origin === 'valid').status, 'conforme');
    assert.equal(result.results.find(row => row.origin === 'invalid').status, 'violacao');
    assert.equal(result.results.find(row => row.origin === 'unrecognized').correct, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
