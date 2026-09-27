#!/usr/bin/env node

/**
 * Gate de qualidade escopado ao agente de codificação selecionado.
 *
 * Garante que os testes executados antes de iniciar o benchmark pertençam apenas ao
 * agente escolhido (ex.: opencode), além dos testes do núcleo independentes de agente.
 * Testes específicos de outros agentes (arquivos prefixados `codex-*`, `agy-*`,
 * `opencode-*`) NÃO são executados.
 *
 * Uso:
 *   node scripts/agent-quality-gate.mjs [--agent=<id>] [--include-core-e2e]
 *
 * O agente é resolvido, nesta ordem: `--agent`, variável `BSH_AGENT`, `agent.id` de
 * `benchmark/config.yaml`. O padrão é `codex`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const KNOWN_AGENTS = ['codex', 'agy', 'opencode'];
const args = process.argv.slice(2);
const includeCoreE2e = args.includes('--include-core-e2e');

function resolveAgent() {
  const explicit = args.find((value) => value.startsWith('--agent='));
  if (explicit) return explicit.slice('--agent='.length).toLowerCase();
  if (process.env.BSH_AGENT) return process.env.BSH_AGENT.toLowerCase();
  try {
    const lines = readFileSync('benchmark/config.yaml', 'utf8').split('\n');
    const start = lines.findIndex((line) => /^agent:\s*$/.test(line));
    if (start >= 0) {
      for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\S/.test(line)) break;
        const match = /^\s+id:\s*([\w-]+)/.exec(line);
        if (match) return match[1].toLowerCase();
      }
    }
  } catch {
    // configuração ausente; usa o padrão
  }
  return 'codex';
}

function scopeOf(file) {
  const name = basename(file);
  for (const agent of KNOWN_AGENTS) {
    if (name.startsWith(`${agent}-`)) return agent;
  }
  return 'core';
}

function listFiles(directory, suffix) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => `${directory}/${name}`)
    .sort();
}

function run(command, commandArgs) {
  process.stdout.write(`\n$ ${command} ${commandArgs.join(' ')}\n`);
  execFileSync(command, commandArgs, { stdio: 'inherit' });
}

const agent = resolveAgent();
const unitFiles = [...listFiles('test', '.test.mjs'), ...listFiles('test/agents', '.test.mjs'),
  ...listFiles('test/enforcement', '.test.mjs'), ...listFiles('test/project', '.test.mjs'),
  ...listFiles('test/ontology', '.test.mjs'), ...listFiles('test/mcp', '.test.mjs'),
  ...listFiles('test/decision', '.test.mjs'), ...listFiles('test/package', '.test.mjs'),
  ...listFiles('test/pilot', '.test.mjs')];
const uniqueUnits = [...new Set(unitFiles)];
const scopedUnits = uniqueUnits.filter((file) => {
  const scope = scopeOf(file);
  return scope === 'core' || scope === agent;
});
const excludedUnits = uniqueUnits.filter((file) => scopeOf(file) !== 'core' && scopeOf(file) !== agent);

const e2eFiles = [...listFiles('test/e2e-live', '.e2e.mjs'), ...listFiles('test/e2e-live', '.semantic.mjs')];
const scopedE2e = e2eFiles.filter((file) => {
  const scope = scopeOf(file);
  if (scope === agent) return true;
  return scope === 'core' && includeCoreE2e;
});

process.stdout.write(`Gate de qualidade escopado ao agente: ${agent}\n`);
process.stdout.write(`Testes de núcleo + ${agent}: ${scopedUnits.length} arquivo(s)\n`);
if (excludedUnits.length > 0) {
  process.stdout.write(`Excluídos (outros agentes): ${excludedUnits.join(', ')}\n`);
}
process.stdout.write(`E2E do agente: ${scopedE2e.length} arquivo(s)${scopedE2e.length ? '' : ' (nenhum)'}\n`);

run('npm', ['run', 'quality']);
if (scopedUnits.length > 0) run('node', ['--test', ...scopedUnits]);
if (scopedE2e.length > 0) run('node', ['--test', '--experimental-test-isolation=none', ...scopedE2e]);

process.stdout.write(`\nGate de qualidade aprovado para o agente ${agent}.\n`);
