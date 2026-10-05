#!/usr/bin/env node

// Fixed-candidate validation exposure: evaluates validation independently of generation.
// This track does not attempt promotion and cannot establish false blocks or escapes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DataFactory, Parser, Store } from 'n3';
import { join } from 'node:path';
import { createOntologySnapshot } from '../dist/ontology/query.js';
import { validarOperacao } from '../dist/enforcement/validadorSemantico.js';
import { loadManifest } from '../dist/project/manifest.js';
import { resolveProjectFile } from '../dist/project/paths.js';

const RDF_TYPE = DataFactory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
const SH_TARGET_CLASS = DataFactory.namedNode('http://www.w3.org/ns/shacl#targetClass');

function loadTurtle(text) {
  return new Store(new Parser({ format: 'Turtle' }).parse(text));
}

function operationForGraph(graph, shapes) {
  const types = [...new Set(graph.getQuads(null, RDF_TYPE, null, null)
    .filter((q) => q.object.termType === 'NamedNode').map((q) => q.object.value))].sort();
  const targets = new Set(shapes.getQuads(null, SH_TARGET_CLASS, null, null).map((q) => q.object.value));
  for (const type of types) if (targets.has(type)) return type;
  return undefined;
}

async function main() {
  const root = process.argv[2];
  if (!root) throw new Error('Usage: gate-exposure.mjs <project> [output] [domain] [candidate-manifest]');
  const outDir = process.argv[3] ?? '.';
  const manifest = await loadManifest(root);
  const domainId = process.argv[4] ?? (manifest.domains.length === 1 ? manifest.domains[0].id : undefined);
  const domain = manifest.domains.find(domain => domain.id === domainId);
  if (!domain) throw new Error('Select a declared domain explicitly for multi-domain projects');
  const shapes = loadTurtle(await readFile(await resolveProjectFile(root, `.bsh/${domain.shapes}`), 'utf8'));
  const snapshot = await createOntologySnapshot(root);
  const candidateManifest = process.argv[5] ?? 'evaluation/fixtures/candidates.json';
  const candidates = JSON.parse(await readFile(await resolveProjectFile(root, candidateManifest), 'utf8'));
  if (!Array.isArray(candidates) || candidates.some(candidate => !candidate ||
    !['VALID', 'INVALID'].includes(candidate.expected) || typeof candidate.path !== 'string' ||
    typeof candidate.id !== 'string')) throw new Error('Invalid candidate manifest');
  const results = [];
  for (const { expected, path: candidatePath, id: origin } of candidates) {
    let graphTurtle;
    try {
      const path = await resolveProjectFile(root, candidatePath);
      graphTurtle = await readFile(path, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      results.push({ origin, expected, status: 'NO_CANDIDATE', candidateExists: false, operation: null, correct: null });
      continue;
    }
    const operation = operationForGraph(loadTurtle(graphTurtle), shapes);
    if (!operation) {
      results.push({ origin, expected, status: 'MISSING_EVIDENCE', candidateExists: true, operation: null, correct: null });
      continue;
    }
    const outcome = await validarOperacao(root, snapshot, {
      id: origin, dominio: domain.id, operacao: operation, fatos: [],
      proveniencia: { origem: origin, descricao: origin }, alteracoesRelacionadas: [],
      candidateGraphTurtle: graphTurtle,
    });
    const correct = outcome.status === 'indeterminado' || outcome.status === 'revisao_humana'
      ? null
      : (expected === 'VALID' && outcome.status === 'conforme')
        || (expected === 'INVALID' && outcome.status === 'violacao');
    results.push({ origin, expected, status: outcome.status, candidateExists: true, operation, correct });
  }
  const valid = results.filter((r) => r.candidateExists && r.expected === 'VALID');
  const invalid = results.filter((r) => r.candidateExists && r.expected === 'INVALID');
  const validValidationViolations = valid.filter((r) => r.status === 'violacao');
  const humanReview = valid.filter((r) => r.status === 'revisao_humana');
  const escaped = invalid.filter((r) => r.status === 'conforme');
  const summary = {
    status: results.length ? 'AVAILABLE' : 'NOT_AVAILABLE',
    trackName: 'GATE_EXPOSURE_CHALLENGE',
    opportunities: results.length,
    noCandidate: results.filter((r) => r.status === 'NO_CANDIDATE').length,
    missingEvidence: results.filter((r) => r.status === 'MISSING_EVIDENCE').length,
    indeterminate: results.filter((r) => r.status === 'indeterminado').length,
    validCandidates: valid.length, invalidCandidates: invalid.length,
    independentEnforcementOpportunities: invalid.length,
    invalidCandidatesDetected: invalid.filter((r) => r.status === 'violacao').length,
    falseBlocks: null, violationsPromoted: null,
    promotionMeasurement: 'NOT_ATTEMPTED',
    validValidationViolations: validValidationViolations.length, humanReviewValids: humanReview.length,
    invalidValidationConformances: escaped.length,
    validValidationViolationIds: validValidationViolations.map((r) => r.origin), humanReviewIds: humanReview.map((r) => r.origin),
    invalidValidationConformanceIds: escaped.map((r) => r.origin),
    results,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'gate-exposure-results.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

await main();
