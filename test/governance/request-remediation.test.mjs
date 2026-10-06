import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestRemediation, closestGovernedOperation } from '../../dist/governance/requestRemediation.js';

const operations = [
  { iri: 'urn:synthetic:TransferWidget', name: 'Transfer widget', terms: ['transfer', 'widget'] },
  { iri: 'urn:synthetic:RetireWidget', name: 'Retire widget', terms: ['retire', 'widget'] },
];

test('Given BSH-PREP-018 configuration diagnostic categories When local remediation is built Then specific repairs and interface exits are deterministic without changing the decision', () => {
  for (const [diagnosticCode, repair] of [['DOMAIN_NOT_FOUND', 'Select a domain declared'], ['INVALID_CONFIGURATION', 'Repair the reported'], ['READ_ERROR', 'Restore the contract file'], ['DEPENDENCY_UNAVAILABLE', 'Restore or declare the dependency']]) {
    for (const entryPoint of ['tui', 'headless']) {
      const input = { status: 'CONFIGURATION_ERROR', diagnosticCode, entryPoint, reason: 'Controlled cause', domainId: 'synthetic', requestText: 'Explain Publish', selectedConcepts: [], governedOperations: [], policyReferences: [] };
      const before = structuredClone(input);
      const result = buildRequestRemediation(input);
      assert.deepEqual(result, buildRequestRemediation(input));
      assert.deepEqual(input, before);
      assert.ok(result.join('\n').includes(repair));
      assert.ok(result.join('\n').includes('Controlled cause'));
      assert.ok(result.join('\n').includes(entryPoint === 'tui' ? '/domain' : '--domain'));
    }
  }
});

test('Given BSH-PREP-018 human review When guidance is built Then authorized approval cancellation rephrasing and domain selection remain distinct from tool approval', () => {
  for (const entryPoint of ['tui', 'headless']) {
    const text = buildRequestRemediation({ status: 'HUMAN_REVIEW', entryPoint, reason: 'Required review', requestText: 'Implement Publish', selectedConcepts: [], governedOperations: [], policyReferences: ['urn:review'] }).join('\n');
    for (const expected of ['urn:review', 'Required review', 'Cancel', 'rephrase', 'snapshot', 'promotion remain independent']) assert.ok(text.includes(expected), expected);
    assert.ok(text.includes(entryPoint === 'tui' ? '/domain' : '--domain'));
    if (entryPoint === 'headless') assert.match(text, /no interactive request approver/);
  }
});

test('Given BSH-PREP-016 an unrecognized request When remediation is built Then it explains the mentions and never asserts conformity', () => {
  const lines = buildRequestRemediation({
    status: 'INSUFFICIENT_INFORMATION', domainId: 'synthetic', requestText: 'Move a widget',
    selectedConcepts: ['Widget'], governedOperations: operations, policyReferences: [],
  });
  assert.ok(lines.some(line => line.includes('No governed operation was recognized')));
  assert.ok(lines.some(line => line.includes('Widget')));
  assert.ok(lines.every(line => !/conform/iu.test(line)));
});

test('Given BSH-PREP-017 governed operations When no operation is recognized Then the closest one is suggested and the others remain available', () => {
  const input = {
    status: 'INSUFFICIENT_INFORMATION', domainId: 'synthetic', requestText: 'transfer a widget',
    selectedConcepts: [], governedOperations: operations, policyReferences: [],
  };
  const closest = closestGovernedOperation(input);
  assert.equal(closest?.iri, 'urn:synthetic:TransferWidget');
  const lines = buildRequestRemediation(input);
  assert.ok(lines.some(line => line.includes('Did you mean Transfer widget?')));
  assert.ok(lines.some(line => line.includes('Governed operations in this domain: Transfer widget, Retire widget.')));
});

test('Given BSH-PREP-019 a domain without governed operations When remediation is built Then the gap and the domain switch are reported', () => {
  const lines = buildRequestRemediation({
    status: 'INSUFFICIENT_INFORMATION', domainId: 'synthetic', requestText: 'do something',
    selectedConcepts: [], governedOperations: [], policyReferences: [],
  });
  assert.ok(lines.some(line => line.includes("declares no governed operations")));
  assert.ok(lines.some(line => line.includes('/domain')));
});

test('Given BSH-PREP-018 a blocked request When remediation is built Then applicable rules and actionable exits are listed', () => {
  const lines = buildRequestRemediation({
    status: 'BLOCK', domainId: 'synthetic', requestText: 'transfer a widget',
    selectedConcepts: [], governedOperations: operations, policyReferences: ['freeze-policy'],
  });
  assert.ok(lines.some(line => line.includes('prohibits')));
  assert.ok(lines.some(line => line.includes('freeze-policy')));
  assert.ok(lines.some(line => line.includes('/ungoverned')));
});

test('Given BSH-PREP-020 an authorized request When remediation is built Then no provider-facing orientation is produced', () => {
  assert.deepEqual(buildRequestRemediation({
    status: 'ALLOW', domainId: 'synthetic', requestText: 'explain', selectedConcepts: [], governedOperations: operations, policyReferences: [],
  }), []);
});
