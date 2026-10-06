import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkDomainAffinity, AFFINITY_LIMITATIONS } from '../../dist/governance/domainAffinity.js';

test('Given an empty project directory with insufficient code files, When checkDomainAffinity is calculated, Then status is INSUFFICIENT_DATA with score 0.0 and explicit limitations', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-insufficient-'));
  try {
    const ontPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/ontology.jsonld');
    const shPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/shapes.ttl');

    const result = await checkDomainAffinity(tempDir, ontPath, shPath, 'ativos');

    assert.equal(result.status, 'INSUFFICIENT_DATA');
    assert.equal(result.score, 0.0);
    assert.notEqual(result.score, 1.0);
    assert.equal(result.indicatorType, 'SAMPLED_LEXICAL_OVERLAP');
    assert.equal(result.sampledFilesCount, 0);
    assert.ok(result.limitations.includes('Não comprova conformidade semântica'));
    assert.ok(result.summary.includes('Ausência de dados não constitui afinidade'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Given a project with domain-aligned source code, When checkDomainAffinity is calculated, Then status is ALIGNED with sampled lexical overlap and non-authorizing limitations', async () => {
  const projectRoot = join(process.cwd(), 'pilot/asset-management');
  const ontPath = join(projectRoot, '.bsh/domains/ativos/ontology.jsonld');
  const shPath = join(projectRoot, '.bsh/domains/ativos/shapes.ttl');

  const result = await checkDomainAffinity(projectRoot, ontPath, shPath, 'ativos');

  assert.equal(result.status, 'ALIGNED');
  assert.ok(result.score > 0);
  assert.equal(result.indicatorType, 'SAMPLED_LEXICAL_OVERLAP');
  assert.ok(result.sampledFilesCount > 0);
  assert.ok(result.totalTokensAnalyzed > 0);
  assert.equal(result.limitations, AFFINITY_LIMITATIONS);
  assert.ok(result.limitations.includes('Não comprova conformidade semântica'));
});

test('Given a project with divergent domain vocabulary, When checkDomainAffinity is calculated, Then status is MISMATCH with sampling report and remediation guidance', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-mismatch-vocab-'));
  try {
    const srcDir = join(tempDir, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'astronomy.ts'), `
      export interface CelestialBody { name: string; massKg: number; orbitPeriodDays: number; }
      export class SolarSystem {
        findPlanets(): CelestialBody[] { return []; }
      }
    `);

    const ontPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/ontology.jsonld');
    const shPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/shapes.ttl');

    const result = await checkDomainAffinity(tempDir, ontPath, shPath, 'ativos');

    assert.equal(result.status, 'MISMATCH');
    assert.ok(result.score < 0.15);
    assert.equal(result.indicatorType, 'SAMPLED_LEXICAL_OVERLAP');
    assert.ok(result.missingTerms.length > 0);
    assert.ok(result.recommendation?.includes('[Ctrl+D]'));
    assert.ok(result.limitations.includes('substitui validação SHACL'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Given project code sharing surface tokens with divergent semantics, When checkDomainAffinity is evaluated, Then lexical overlap does not grant semantic authorization', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-surface-tokens-'));
  try {
    const srcDir = join(tempDir, 'src');
    await mkdir(srcDir, { recursive: true });
    // Surface overlap on 'status' and 'location', but totally different domain (weather station)
    await writeFile(join(srcDir, 'weather.ts'), `
      export interface WeatherStation {
        stationLocation: string;
        currentStatus: 'ONLINE' | 'OFFLINE';
        temperatureCelsius: number;
        precipitationMm: number;
      }
    `);

    const ontPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/ontology.jsonld');
    const shPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/shapes.ttl');

    const result = await checkDomainAffinity(tempDir, ontPath, shPath, 'ativos');

    assert.equal(result.indicatorType, 'SAMPLED_LEXICAL_OVERLAP');
    assert.ok(result.limitations.includes('Não comprova conformidade semântica nem substitui validação SHACL'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
