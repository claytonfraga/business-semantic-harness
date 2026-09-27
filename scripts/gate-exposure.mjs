#!/usr/bin/env node

// Ensaio do gate independente (Frente 3): submete candidatos conformes e incompatíveis ao
// validador semântico real (dist/enforcement/validadorSemantico.js), sem depender do agente.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DataFactory, Parser, Store } from 'n3';
import { createOntologySnapshot } from '../dist/ontology/query.js';
import { validarOperacao } from '../dist/enforcement/validadorSemantico.js';

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
  const root = process.argv[2] ?? 'pilot/asset-management';
  const outDir = process.argv[3] ?? '.';
  const base = `${root}/.bsh/domains/ativos`;
  const shapes = loadTurtle(await readFile(`${base}/shapes.ttl`, 'utf8'));
  const snapshot = await createOntologySnapshot(root);
  const fixtures = `${root}/evaluation/fixtures`;
  const candidates = [
    ['VALID', `${fixtures}/transfer-valid.ttl`, 'valid-transfer'],
    ['INVALID', `${fixtures}/transfer-retired.ttl`, 'invalid-retired'],
    ['INVALID', `${fixtures}/transfer-no-responsible.ttl`, 'invalid-no-responsible'],
  ];
  const results = [];
  for (const [expected, path, origin] of candidates) {
    let graphTurtle;
    try {
      graphTurtle = await readFile(path, 'utf8');
    } catch {
      results.push({ origin, expected, status: 'MISSING', operation: null, correct: null });
      continue;
    }
    const operation = operationForGraph(loadTurtle(graphTurtle), shapes);
    if (!operation) {
      results.push({ origin, expected, status: 'NO_OPERATION', operation: null, correct: null });
      continue;
    }
    const outcome = await validarOperacao(root, snapshot, {
      id: origin, dominio: 'ativos', operacao: operation, fatos: [],
      proveniencia: { origem: origin, descricao: origin }, alteracoesRelacionadas: [],
      candidateGraphTurtle: graphTurtle,
    });
    const correct = (expected === 'VALID' && outcome.status === 'conforme')
      || (expected === 'INVALID' && outcome.status !== 'conforme');
    results.push({ origin, expected, status: outcome.status, operation, correct });
  }
  const valid = results.filter((r) => r.expected === 'VALID');
  const invalid = results.filter((r) => r.expected === 'INVALID');
  const falseBlocks = valid.filter((r) => r.status !== 'conforme');
  const escaped = invalid.filter((r) => r.status === 'conforme');
  const summary = {
    status: results.length ? 'AVAILABLE' : 'NOT_AVAILABLE',
    trackName: 'GATE_EXPOSURE_CHALLENGE',
    opportunities: results.length,
    validCandidates: valid.length, invalidCandidates: invalid.length,
    independentEnforcementOpportunities: invalid.length,
    independentEnforcementActivated: invalid.filter((r) => r.status !== 'conforme').length,
    falseBlocks: falseBlocks.length, escapedIncompatible: escaped.length,
    falseBlockIds: falseBlocks.map((r) => r.origin), escapedIds: escaped.map((r) => r.origin),
    results,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/gate-exposure-results.json`, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

await main();
