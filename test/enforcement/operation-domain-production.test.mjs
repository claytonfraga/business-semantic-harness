// BSH-EXTRACT-DOMAIN-001: model transport and host approval are controlled;
// extraction, RDF, SHACL, tools, worktrees, technical gates and Git are production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createProductionFactsExtractor, TypeScriptStructuralAdapter } from '../../dist/enforcement/evidenceAdapters.js';
import { resolveOperationDomain } from '../../dist/enforcement/identidadeOperacao.js';
import { parseShapes } from '../../dist/ontology/rdf.js';
import { DataFactory } from 'n3';
import { OpenRouterClient } from '../../dist/client/openrouter/client.js';
import { runHeadlessCodingSession } from '../../dist/agent/headless.js';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
async function fixture(reverse = false, review = false) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-operation-domain-'));
  const domains = ['pedidos', 'financeiro'].map(id => ({ id, version: '1.0.0', baseIri: `urn:delivery:${id}:`, ontology: `domains/${id}/ontology.jsonld`, shapes: `domains/${id}/shapes.ttl`, enforcement: `domains/${id}/enforcement.json` }));
  await mkdir(join(root, 'src'), { recursive: true });
  for (const domain of domains) {
    const dir = join(root, '.bsh/domains', domain.id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ontology.jsonld'), JSON.stringify({ '@context': { ex: domain.baseIri, bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' }, '@graph': [
      { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
      { '@id': 'ex:AutorizarEstorno', '@type': 'rdfs:Class' },
      { '@id': 'ex:Policy', '@type': 'bsh:Policy', 'bsh:governs': { '@id': 'ex:AutorizarEstorno' }, 'bsh:requiresHumanReview': review && domain.id === 'financeiro' },
    ] }));
    await writeFile(join(dir, 'shapes.ttl'), `@prefix ex: <${domain.baseIri}> . @prefix sh: <http://www.w3.org/ns/shacl#> . ex:Shape a sh:NodeShape; sh:targetClass ex:AutorizarEstorno; sh:property [sh:path ex:status; sh:minCount 1; sh:in ("${domain.id === 'financeiro' ? 'APPROVED' : 'ORDER_ONLY'}")] .`);
    await writeFile(join(dir, 'enforcement.json'), JSON.stringify({ schemaVersion: 1, regras: domain.id === 'financeiro' ? [{ id: 'finance-operation', operacao: 'AutorizarEstorno', quando: { caminho: 'src/finance.js', adicionou: 'AutorizarEstorno' }, fatos: [{ propriedade: 'status', valor: 'APPROVED', determinacao: 'observado', origem: 'required-property' }], evidenciasRequeridas: [{ tipo: 'estrutural' }] }] : [] }));
  }
  const manifest = { schemaVersion: 1, projectId: 'operation-domain', domains: reverse ? [...domains].reverse() : domains };
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  await writeFile(join(root, '.gitignore'), '.bsh/local/\n');
  await writeFile(join(root, 'src/finance.js'), 'export const initial = true;\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { quality: 'node --check src/finance.js', test: 'node --check src/finance.js' } }));
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.name', 'Domain QA'); git(root, 'config', 'user.email', 'qa@example.invalid'); git(root, 'config', 'commit.gpgsign', 'false'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'Synthetic domain baseline');
  const operation = { id: 'op', dominio: 'financeiro', operacao: 'AutorizarEstorno', fatos: [{ propriedade: 'status', valor: 'APPROVED', determinacao: 'observado', origem: 'configured' }], proveniencia: { origem: 'synthetic', descricao: 'domain test' }, alteracoesRelacionadas: ['src/finance.js'] };
  return { root, manifest, operation };
}

test('Given BSH-EXTRACT-DOMAIN-001 homonymous operations in reordered domains When real adapters extract Then financial IRIs and actual candidate values remain equivalent', async () => {
  for (const reverse of [false, true]) {
    const { root, operation } = await fixture(reverse);
    try {
      await writeFile(join(root, 'src/finance.js'), 'export const status = "REJECTED"; export const AutorizarEstorno = status;');
      for (const name of ['AutorizarEstorno', 'urn:delivery:financeiro:AutorizarEstorno']) {
        const input = { workspace: root, sourceCommit: 'candidate', originCommit: 'base', operation: { ...operation, operacao: name }, relevantPaths: ['src/finance.js'] };
        for (const facts of [await new TypeScriptStructuralAdapter().extract(input), await createProductionFactsExtractor(root)(input)]) {
          const graph = parseShapes(facts.graphTurtle);
          assert.equal(graph.getQuads(null, DataFactory.namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), DataFactory.namedNode('urn:delivery:financeiro:AutorizarEstorno'), null).length, 1);
          assert.equal(graph.getQuads(null, DataFactory.namedNode('urn:delivery:financeiro:status'), null, null)[0].object.value, 'REJECTED');
          assert.ok(!facts.graphTurtle.includes('urn:delivery:pedidos:'));
        }
      }
      assert.equal((await resolveOperationDomain(root, { ...operation, dominio: 'pedidos' })).iri, 'urn:delivery:pedidos:AutorizarEstorno');
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('Given BSH-EXTRACT-DOMAIN-001 dependencies missing or ambiguous identities When extraction resolves Then only declared unique owners proceed', async () => {
  const { root, manifest, operation } = await fixture();
  try {
    await assert.rejects(resolveOperationDomain(root, { ...operation, dominio: '' }), /OPERATION_DOMAIN_MISSING/);
    await assert.rejects(resolveOperationDomain(root, { ...operation, operacao: 'Missing' }), /OPERATION_IDENTITY_MISSING/);
    await assert.rejects(resolveOperationDomain(root, { ...operation, dependenciasDominio: ['pedidos'] }), /OPERATION_DEPENDENCY_UNDECLARED/);
    manifest.domains[0].dependencies = { financeiro: '1.0.0' };
    await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
    assert.equal((await resolveOperationDomain(root, { ...operation, dominio: 'pedidos', operacao: 'urn:delivery:financeiro:AutorizarEstorno' })).domain.id, 'financeiro');
    const path = join(root, '.bsh/domains/pedidos/ontology.jsonld');
    const ontology = JSON.parse(await readFile(path, 'utf8'));
    ontology['@graph'].push({ '@id': 'urn:delivery:financeiro:AutorizarEstorno', '@type': 'rdfs:Class' });
    await writeFile(path, JSON.stringify(ontology));
    await assert.rejects(createProductionFactsExtractor(root)({ sourceCommit: 'candidate', originCommit: 'base', operation: { ...operation, dominio: 'pedidos', operacao: 'urn:delivery:financeiro:AutorizarEstorno' }, relevantPaths: ['src/finance.js'] }), /OPERATION_IDENTITY_AMBIGUOUS/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given BSH-EXTRACT-DOMAIN-001 configured facts without unique candidate literals When adapters extract Then missing evidence cannot be replaced by approved rule values', async () => {
  const { root, operation } = await fixture();
  try {
    for (const code of ['export const AutorizarEstorno = true;', 'export const status = "APPROVED"; const other = { status: "REJECTED" };']) {
      await writeFile(join(root, 'src/finance.js'), code);
      const facts = await createProductionFactsExtractor(root)({ sourceCommit: 'candidate', originCommit: 'base', operation, relevantPaths: ['src/finance.js'] });
      assert.ok(facts.missingRequirements.some(message => message.includes('status')));
      assert.equal(parseShapes(facts.graphTurtle).getQuads(null, DataFactory.namedNode('urn:delivery:financeiro:status'), null, null).length, 0);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Given BSH-EXTRACT-DOMAIN-001 production headless with reordered domains When financial candidates run Then correct contract precedes transport and only conforming code is promoted', async () => {
  for (const reverse of [false, true]) for (const status of ['APPROVED', 'REJECTED']) {
    const { root } = await fixture(reverse);
    const before = git(root, 'rev-parse', 'HEAD');
    const client = new OpenRouterClient({ apiKey: 'controlled-transport' });
    const calls = []; client.verifyApiKey = async () => ({ valid: true });
    client.streamChat = async function* (payload) {
      calls.push(structuredClone(payload));
      if (calls.length === 1) yield { delta: { tool_calls: [{ index: 0, id: 'candidate-write', function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/finance.js', content: `export const status = "${status}"; export const AutorizarEstorno = status;\n` }) } }] } };
      else yield { delta: { content: 'Controlled coding response.' } };
    };
    let output = ''; const stdout = process.stdout.write, stderr = process.stderr.write;
    process.stdout.write = process.stderr.write = chunk => { output += String(chunk); return true; };
    try {
      const code = await runHeadlessCodingSession({ projectRoot: root, domain: 'financeiro', prompt: 'Implement AutorizarEstorno in src/finance.js', model: 'controlled/selected', contextLength: 50000, client, autoPromote: true, askToolApproval: async () => ({ choice: 'allow-once', actor: 'QA host', reason: 'Exact synthetic write' }) });
      assert.equal(calls.length, 2, output);
      assert.equal(calls[0].model, 'controlled/selected');
      const context = calls[0].messages.find(m => m.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content;
      assert.match(context, /urn:delivery:financeiro:/); assert.match(context, /APPROVED/);
      assert.equal(calls[0].messages.at(-1).content, 'Implement AutorizarEstorno in src/finance.js');
      if (status === 'APPROVED') { assert.equal(code, 0, output); assert.notEqual(git(root, 'rev-parse', 'HEAD'), before); assert.match(await readFile(join(root, 'src/finance.js'), 'utf8'), /APPROVED/); }
      else { assert.equal(code, 1, output); assert.equal(git(root, 'rev-parse', 'HEAD'), before); assert.match(output, /Violação encontrada na validação semântica/); }
    } finally { process.stdout.write = stdout; process.stderr.write = stderr; await rm(root, { recursive: true, force: true }); }
  }
});

test('Given BSH-EXTRACT-DOMAIN-001 financial review policy When headless prepares Then pending policy blocks all transport despite a tool approver', async () => {
  const { root } = await fixture(false, true);
  const client = new OpenRouterClient({ apiKey: 'controlled' }); let calls = 0;
  client.streamChat = async function* () { calls++; yield { delta: { content: 'Unexpected' } }; };
  try {
    const code = await runHeadlessCodingSession({ projectRoot: root, domain: 'financeiro', prompt: 'Implement AutorizarEstorno in src/finance.js', model: 'controlled/selected', contextLength: 50000, client, askToolApproval: async () => ({ choice: 'allow-once', actor: 'QA', reason: 'Tool only' }) });
    assert.equal(code, 2); assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
