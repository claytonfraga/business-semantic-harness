import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { getAvailableDomains, loadDomainValidator } from '../../dist/governance/domainRegistry.js';

test('Given pilot asset-management project, when getAvailableDomains is called, then ativos domain is discovered with stats', async () => {
  const pilotRoot = resolve('pilot/asset-management');
  const domains = await getAvailableDomains(pilotRoot);
  assert.equal(domains.length, 1);
  const ativos = domains[0];
  assert.equal(ativos.id, 'ativos');
  assert.ok(ativos.classesCount > 0, 'classesCount should be greater than 0');
  assert.ok(ativos.shapesCount > 0, 'shapesCount should be greater than 0');
});

test('Given pilot asset-management project, when loadDomainValidator is called for ativos, then validator is initialized', async () => {
  const pilotRoot = resolve('pilot/asset-management');
  const validator = await loadDomainValidator(pilotRoot, 'ativos');
  assert.equal(validator.domainId, 'ativos');
  assert.ok(validator.ontologyStore.size > 0);
  assert.ok(validator.shapesStore.size > 0);
  assert.equal(typeof validator.validateChanges, 'function');
});
