import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkDomainAffinity } from '../../dist/governance/domainAffinity.js';

test('domainAffinity: detects alignment on asset-management pilot project', async () => {
  const projectRoot = join(process.cwd(), 'pilot/asset-management');
  const ontPath = join(projectRoot, '.bsh/domains/ativos/ontology.jsonld');
  const shPath = join(projectRoot, '.bsh/domains/ativos/shapes.ttl');

  const result = await checkDomainAffinity(projectRoot, ontPath, shPath, 'ativos');
  assert.equal(result.status, 'ALIGNED');
  assert.ok(result.score > 0);
  assert.ok(result.matchedTerms.length >= 2);
});

test('domainAffinity: detects MISMATCH on unrelated project code', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-mismatch-test-'));
  try {
    const srcDir = join(tempDir, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'calculator.ts'), `
      export function sum(a: number, b: number): number { return a + b; }
      export function multiply(a: number, b: number): number { return a * b; }
      export function divide(a: number, b: number): number { return a / b; }
    `);
    await writeFile(join(srcDir, 'math-engine.ts'), `
      export class MathEngine {
        calculateFactorial(n: number): number { return n <= 1 ? 1 : n * this.calculateFactorial(n - 1); }
      }
    `);

    const pilotOntPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/ontology.jsonld');
    const pilotShPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/shapes.ttl');

    const result = await checkDomainAffinity(tempDir, pilotOntPath, pilotShPath, 'ativos');
    assert.equal(result.status, 'MISMATCH');
    assert.ok(result.summary.includes('Baixa afinidade semântica'));
    assert.ok(result.recommendation?.includes('[Ctrl+D]'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('domainAffinity: returns INSUFFICIENT_DATA on empty directory', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'bsh-empty-test-'));
  try {
    const pilotOntPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/ontology.jsonld');
    const pilotShPath = join(process.cwd(), 'pilot/asset-management/.bsh/domains/ativos/shapes.ttl');

    const result = await checkDomainAffinity(tempDir, pilotOntPath, pilotShPath, 'ativos');
    assert.equal(result.status, 'INSUFFICIENT_DATA');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
