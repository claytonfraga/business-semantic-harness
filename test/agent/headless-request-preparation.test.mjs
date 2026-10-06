// BSH-PREP-001/002/003/006/007/008/009/011. Model transport is controlled; preparation and dispatch are production code.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OpenRouterClient } from "../../dist/client/openrouter/client.js";
import { runHeadlessCodingSession } from "../../dist/agent/headless.js";

async function fixture(policy = false) {
  const root = await mkdtemp(join(tmpdir(), "bsh-request-headless-"));
  const directory = join(root, ".bsh/domains/synthetic");
  await mkdir(directory, { recursive: true });
  await writeFile(join(root, ".bsh/project.json"), JSON.stringify({ schemaVersion: 1, projectId: "dispatch-fixture", domains: [{ id: "synthetic", version: "1.0.0", baseIri: "urn:dispatch:", ontology: "domains/synthetic/ontology.jsonld", shapes: "domains/synthetic/shapes.ttl" }] }));
  const graph = [{ "@id": "ex:domain", "@type": "bsh:Domain", "bsh:version": "1.0.0" }, { "@id": "ex:Publish", "@type": "rdfs:Class", "rdfs:comment": "Publication requires an APPROVED status." }];
  if (policy) graph.push({ "@id": "ex:Review", "@type": "bsh:Policy", "bsh:governs": { "@id": "ex:Publish" }, "bsh:requiresHumanReview": true });
  await writeFile(join(directory, "ontology.jsonld"), JSON.stringify({ "@context": { ex: "urn:dispatch:", bsh: "urn:bsh:ns:v1:", rdfs: "http://www.w3.org/2000/01/rdf-schema#" }, "@graph": graph }));
  await writeFile(join(directory, "shapes.ttl"), "@prefix ex: <urn:dispatch:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\nex:PublishShape a sh:NodeShape ; sh:targetClass ex:Publish .\n");
  return { root, directory };
}

async function capture(root, prompt, extra = {}, mutateBeforeAuth, stream) {
  const calls = [];
  const client = new OpenRouterClient({ apiKey: "controlled-model-transport" });
  client.getModels = async () => { throw new Error('Controlled metadata lookup failure; no provider access'); };
  client.verifyApiKey = async () => { if (mutateBeforeAuth) await mutateBeforeAuth(); return { valid: true }; };
  client.streamChat = async function* (payload) {
    calls.push(structuredClone(payload));
    if (stream) yield* stream(calls.length);
    else yield { delta: { content: "Controlled response." } };
  };
  let diagnostic = "";
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  process.stdout.write = process.stderr.write = chunk => { diagnostic += String(chunk); return true; };
  try {
    const code = await runHeadlessCodingSession({ projectRoot: root, prompt, model: "selected/model", domain: "synthetic", allowDirectExecution: true, client, contextLength: 100000, ...extra });
    return { code, calls, diagnostic };
  } catch (error) { return { error, calls, diagnostic }; }
  finally { process.stdout.write = stdout; process.stderr.write = stderr; }
}

test("Given a pertinent contract When production headless sends the request Then its recovered rule and identity precede the unchanged selected-model payload", async () => {
  const { root, directory } = await fixture();
  try {
    const prompt = "Explain Publish rule";
    const first = await capture(root, prompt);
    assert.equal(first.calls.length, 1, first.diagnostic);
    assert.equal(first.calls[0].model, "selected/model");
    assert.deepEqual(first.calls[0].messages.filter(message => message.role === "user"), [{ role: "user", content: prompt }]);
    const context = first.calls[0].messages.filter(message => message.role === "system").map(message => message.content).join("\n");
    assert.match(context, /Publication requires an APPROVED status/);
    assert.match(context, /requestIdentity/);
    assert.match(context, /urn:dispatch:Publish/);
    const ontology = join(directory, "ontology.jsonld");
    await writeFile(ontology, (await readFile(ontology, "utf8")).replace("APPROVED", "REVIEWED"));
    const second = await capture(root, prompt);
    assert.equal(second.calls.length, 1);
    const newer = second.calls[0].messages.filter(message => message.role === "system").map(message => message.content).join("\n");
    assert.match(newer, /REVIEWED status/);
    assert.notEqual(context, newer);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-024 a RDF prohibition When implementation omits tests or queries contain punctuation Then headless applies the actual instruction purpose before dispatch", async () => {
  const { root, directory } = await fixture();
  try {
    const path = join(directory, 'ontology.jsonld');
    const ontology = JSON.parse(await readFile(path, 'utf8'));
    ontology['@graph'].push({ '@id': 'ex:deny', '@type': 'bsh:Policy', 'bsh:governs': { '@id': 'ex:Publish' }, 'bsh:effect': 'DENY' });
    await writeFile(path, JSON.stringify(ontology));
    for (const prompt of ['Implemente Publish sem testes', 'Implement Publish without tests', 'Explain Publish. Implement Publish', 'Explain Publish, implement Publish', 'Inspect Publish and execute Publish', 'Write tests that block Publish; implement Publish', 'Do not implement Publish but implement Publish']) {
      const result = await capture(root, prompt);
      assert.equal(result.code, 3, `${prompt}: ${result.diagnostic}`);
      assert.equal(result.calls.length, 0, prompt);
    }
    for (const prompt of ['Inspect Publish in src/service.js', 'Explain Publish, including its constraints', 'Write tests that block Publish', 'Escreva testes que bloqueiam Publish', 'Explain Publish; do not implement Publish', 'Explique Publish; nao implemente Publish']) {
      const result = await capture(root, prompt);
      assert.equal(result.calls.length, 1, `${prompt}: ${result.diagnostic}`);
      assert.equal(result.calls[0].model, 'selected/model');
    }
    ontology['@graph'].push({ '@id': 'ex:Archive', '@type': 'rdfs:Class' });
    await writeFile(path, JSON.stringify(ontology));
    await writeFile(join(directory, 'enforcement.json'), JSON.stringify({ schemaVersion: 1, regras: [{ id: 'archive-operation', operacao: 'Archive', quando: { caminho: 'src/archive.js' }, fatos: [] }] }));
    const mixed = await capture(root, 'Explain Publish; implement Archive');
    assert.equal(mixed.calls.length, 1, mixed.diagnostic);
    // Mentioning a prohibited operation only in explanation does not make Archive prohibited.
    assert.match(mixed.calls[0].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content, /urn:dispatch:Archive/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-023 a targetless shape owned by a declared dependency When headless prepares Then its closure retains the dependency origin and hash", async () => {
  const { root, directory } = await fixture();
  try {
    const path = join(root, '.bsh/project.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.domains[0].dependencies = { dependency: '1.0.0' };
    manifest.domains.push({ id: 'dependency', version: '1.0.0', baseIri: 'urn:dependency:', ontology: 'domains/dependency/ontology.jsonld', shapes: 'domains/dependency/shapes.ttl' });
    await writeFile(path, JSON.stringify(manifest));
    const dependency = join(root, '.bsh/domains/dependency');
    await mkdir(dependency);
    await writeFile(join(dependency, 'ontology.jsonld'), JSON.stringify({ '@context': { ex: 'urn:dependency:', bsh: 'urn:bsh:ns:v1:' }, '@graph': [{ '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' }] }));
    await writeFile(join(dependency, 'shapes.ttl'), '@prefix ex: <urn:dependency:> . @prefix sh: <http://www.w3.org/ns/shacl#> . ex:Shared a sh:NodeShape ; sh:message "DEPENDENCY_RESTRICTION" .');
    await writeFile(join(directory, 'shapes.ttl'), '@prefix ex: <urn:dispatch:> . @prefix sh: <http://www.w3.org/ns/shacl#> . [] a sh:NodeShape ; sh:targetClass ex:Publish ; sh:node <urn:dependency:Shared> .');
    const result = await capture(root, 'Explain Publish');
    assert.equal(result.calls.length, 1, result.diagnostic);
    const payload = JSON.parse(result.calls[0].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content.split('\n').slice(1).join('\n'));
    const recovered = payload.queries.find(query => query.domain === 'dependency');
    assert.equal(recovered.shapesSource, 'domains/dependency/shapes.ttl');
    assert.match(recovered.shapesHash, /^[a-f0-9]{64}$/);
    assert.ok(recovered.shapeGraph.some(triple => triple.object.value === 'DEPENDENCY_RESTRICTION'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-023 nested SHACL lists paths shared references and cycles When headless sends Then the complete relevant RDF closure precedes independent candidate validation", async () => {
  const { root, directory } = await fixture();
  try {
    const ontologyPath = join(directory, 'ontology.jsonld');
    const ontology = JSON.parse(await readFile(ontologyPath, 'utf8'));
    delete ontology['@graph'][1]['rdfs:comment'];
    ontology['@graph'].push({ '@id': 'ex:Unrelated', '@type': 'rdfs:Class', 'rdfs:comment': 'UNRELATED_ONTOLOGY_SENTINEL' });
    await writeFile(ontologyPath, JSON.stringify(ontology));
    const prefixes = '@prefix ex: <urn:dispatch:> .\n@prefix sh: <http://www.w3.org/ns/shacl#> .\n';
    const shapes = prefixes + `
ex:PublishShape a sh:NodeShape ; sh:targetClass ex:Publish ;
 sh:property [ sh:path ex:status ; sh:in ("APPROVED") ] ;
 sh:property [ sh:path [ sh:alternativePath (ex:status ex:secondary) ] ;
   sh:or ([ sh:hasValue "OR_A" ] [ sh:node ex:Nested ]) ] ;
 sh:node ex:Shared ; sh:not ex:Cycle .
ex:Nested a sh:NodeShape ; sh:property [ sh:path ex:nested ; sh:hasValue "NESTED" ] ; sh:node ex:Shared .
ex:Shared a sh:NodeShape ; sh:message "SHARED"@en .
ex:Cycle a sh:NodeShape ; sh:node ex:PublishShape .
ex:UnrelatedShape a sh:NodeShape ; sh:targetClass ex:Unrelated ; sh:message "UNRELATED_SHAPE_SENTINEL" .
`;
    await writeFile(join(directory, 'shapes.ttl'), shapes);
    const result = await capture(root, 'Explain Publish');
    assert.equal(result.calls.length, 1, result.diagnostic);
    const context = result.calls[0].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content;
    const payload = JSON.parse(context.split('\n').slice(1).join('\n'));
    const query = payload.queries[0];
    for (const value of ['APPROVED', 'OR_A', 'NESTED', 'urn:dispatch:secondary']) assert.ok(query.shapeGraph.some(triple => triple.object.value === value), value);
    assert.equal(query.shapeGraph.filter(triple => triple.subject.value === 'urn:dispatch:Shared' && triple.predicate.endsWith('#message')).length, 1);
    const shared = query.shapeGraph.find(triple => triple.object.value === 'SHARED');
    assert.equal(shared.object.language, 'en');
    assert.ok(shared.object.datatype);
    assert.equal(new Set(query.shapeGraph.map(triple => JSON.stringify(triple))).size, query.shapeGraph.length);
    assert.equal(context.includes('UNRELATED_ONTOLOGY_SENTINEL'), false);
    assert.equal(context.includes('UNRELATED_SHAPE_SENTINEL'), false);
    assert.match(query.shapesHash, /^[a-f0-9]{64}$/);
    assert.equal(payload.contractReferences.find(file => file.path.endsWith('shapes.ttl')).sha256, query.shapesHash);
    const { queryOntology } = await import('../../dist/ontology/query.js');
    const directReference = await queryOntology(root, 'synthetic', 'urn:dispatch:Nested');
    assert.ok(directReference.shapeGraph.some(triple => triple.object.value === 'NESTED'));
    // Promotion's validator reads the complete sovereign graph independently of model context.
    await writeFile(join(directory, 'shapes.ttl'), prefixes + 'ex:PublishShape a sh:NodeShape ; sh:targetClass ex:Publish ; sh:property [ sh:path ex:status ; sh:minCount 1 ; sh:in ("APPROVED") ] .');
    const { loadDomainValidator } = await import('../../dist/governance/domainRegistry.js');
    const { parseShapes } = await import('../../dist/ontology/rdf.js');
    const validator = await loadDomainValidator(root, 'synthetic');
    for (const [value, expected] of [['APPROVED', true], ['REJECTED', false]]) {
      const validation = await validator.validateChanges(parseShapes(prefixes + `ex:candidate a ex:Publish ; ex:status "${value}" .`));
      assert.equal(validation.conforms, expected);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-015 unavailable metadata When headless lacks a host window Then it diagnoses and sends zero calls while an explicit sufficient window allows dispatch", async () => {
  const { root } = await fixture();
  try {
    const unknown = await capture(root, 'Explain Publish', { contextLength: undefined });
    assert.equal(unknown.code, 6, unknown.diagnostic);
    assert.equal(unknown.calls.length, 0);
    assert.match(unknown.diagnostic, /CONTEXT_BUDGET.*unknown/);
    const allowed = await capture(root, 'Explain Publish', { contextLength: 100000 });
    assert.equal(allowed.calls.length, 1);
    assert.equal(allowed.calls[0].model, 'selected/model');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a policy requiring review When headless processes an execution Then it exits without sending while explanation may proceed", async () => {
  const { root } = await fixture(true);
  try {
    const pending = await capture(root, "Execute Publish");
    assert.equal(pending.code, 2, pending.diagnostic);
    assert.equal(pending.calls.length, 0);
    const explanation = await capture(root, "Explain Publish rule");
    assert.equal(explanation.calls.length, 1, explanation.diagnostic);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given an explicit missing domain When headless prepares Then no request is silently sent without governance", async () => {
  const { root } = await fixture();
  try {
    const result = await capture(root, "Explain Publish rule", { domain: "absent" });
    assert.equal(result.code, 5);
    assert.equal(result.calls.length, 0);
    assert.match(result.diagnostic, /DOMAIN_NOT_FOUND/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a project prohibition or unmatched execution When headless prepares Then blocked and insufficient requests produce no model calls", async () => {
  const { root } = await fixture();
  try {
    const unknown = await capture(root, "Implement unrelated behavior");
    assert.equal(unknown.code, 4, unknown.diagnostic);
    assert.equal(unknown.calls.length, 0);
    const file = join(root, ".bsh/project.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.domains[0].requestGovernance = { unmatchedMutation: "INSUFFICIENT_INFORMATION", rules: [{ id: "no-publish", reference: "urn:dispatch:no-publish",
      pattern: "Execute Publish", effect: "BLOCK", purposes: ["EXECUTION"] }] };
    await writeFile(file, JSON.stringify(manifest));
    const blocked = await capture(root, "Execute Publish");
    assert.equal(blocked.code, 3, blocked.diagnostic);
    assert.equal(blocked.calls.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given explicit ungoverned selection When a selected domain is absent Then headless declares that selection in the model context", async () => {
  const { root } = await fixture();
  try {
    const result = await capture(root, "Explain the repository", { domain: "absent", ungoverned: true });
    assert.equal(result.calls.length, 1, result.diagnostic);
    assert.ok(result.calls[0].messages.some(message => message.role === "system" && message.content.includes('"governance":"UNGOVERNED"')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a skill adding prohibited execution to an explanatory request When production headless prepares Then its effective directives block all model calls", async () => {
  const { root } = await fixture();
  try {
    const skill = join(root, ".bsh/skills/unsafe-publication");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: unsafe-publication\ndescription: Controlled conflicting fixture\n---\nExecute Publish.\n");
    const file = join(root, ".bsh/project.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.domains[0].requestGovernance = { unmatchedMutation: "INSUFFICIENT_INFORMATION", rules: [{ id: "no-publish", reference: "urn:dispatch:no-publish",
      pattern: "Execute Publish", effect: "BLOCK", purposes: ["EXECUTION"] }] };
    await writeFile(file, JSON.stringify(manifest));
    const result = await capture(root, "/unsafe-publication Explain Publish rule");
    assert.equal(result.code, 3, result.diagnostic);
    assert.equal(result.calls.length, 0);
    assert.match(result.diagnostic, /urn:dispatch:no-publish/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a changed contract after preparation When headless reaches transport Then the stale request cannot be dispatched", async () => {
  const { root, directory } = await fixture();
  try {
    const result = await capture(root, "Explain Publish rule", {}, async () => {
      const path = join(directory, "shapes.ttl");
      await writeFile(path, (await readFile(path, "utf8")) + "\n# changed after preparation\n");
    });
    assert.equal(result.calls.length, 0);
    assert.match(result.error?.message ?? result.diagnostic, /changed before dispatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-015 a selected-model window too small When headless prepares Then no provider call occurs and a budget diagnostic is produced", async () => {
  const { root } = await fixture();
  try {
    const result = await capture(root, "Explain Publish rule", { contextLength: 1024 });
    assert.equal(result.code, 6, result.diagnostic);
    assert.equal(result.calls.length, 0);
    assert.match(result.diagnostic, /CONTEXT_BUDGET/);
    assert.match(result.diagnostic, /exceeds the selected model window/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-015 a sufficient selected-model window When headless prepares Then the representative request is dispatched once", async () => {
  const { root } = await fixture();
  try {
    const result = await capture(root, "Explain Publish rule", { contextLength: 1000000 });
    assert.equal(result.calls.length, 1, result.diagnostic);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given BSH-PREP-020/022 an unrecognized execution in a governed domain When headless prepares Then it emits the deterministic remediation without any provider call", async () => {
  const { root, directory } = await fixture();
  try {
    const ontology = JSON.parse(await readFile(join(directory, "ontology.jsonld"), "utf8"));
    ontology["@graph"].push(
      { "@id": "ex:Archive", "@type": "rdfs:Class", "rdfs:label": "Archive" },
      { "@id": "ex:archive-policy", "@type": "bsh:Policy", "bsh:governs": { "@id": "ex:Archive" }, "bsh:requiresHumanReview": true },
    );
    await writeFile(join(directory, "ontology.jsonld"), JSON.stringify(ontology));
    const result = await capture(root, "Implement unrelated behavior");
    assert.equal(result.code, 4, result.diagnostic);
    assert.equal(result.calls.length, 0);
    assert.match(result.diagnostic, /No governed operation was recognized/);
    assert.match(result.diagnostic, /\/domain/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a governed native mutation without a host approval When headless dispatches Then the broker denies before effects and records the decision", async () => {
  const { root } = await fixture();
  try {
    const result = await capture(root, "Execute Publish", {}, undefined, async function* (turn) {
      if (turn === 1) yield { delta: { tool_calls: [{ index: 0, id: "write-publication", function: {
        name: "write_file", arguments: JSON.stringify({ path: "publication.js", content: "forbidden mutation" })
      } }] } };
      else yield { delta: { content: "Tool was denied." } };
    });
    assert.equal(result.calls.length, 2, result.diagnostic);
    assert.equal(result.code, 1);
    await assert.rejects(readFile(join(root, "publication.js")), { code: "ENOENT" });
    assert.match(result.calls[1].messages.find(message => message.role === "tool").content, /denied by approval broker/);
    assert.match(await readFile(join(root, ".bsh/local/events.jsonl"), "utf8"), /"decision":"deny"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Given a real configured MCP mutation When production headless dispatches without host approval Then its broker prevents remote effects", async () => {
  const { root } = await fixture();
  try {
    const server = join(root, "controlled-mcp.mjs");
    const marker = join(root, "mcp-effect.txt");
    await writeFile(server, `import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
const input = createInterface({ input: process.stdin });
input.on('line', async line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'identified-controlled-server', version: '1.0.0' } };
  else if (message.method === 'tools/list') result = { tools: [{ name: 'write_publication', description: 'Controlled remote mutation', inputSchema: { type: 'object', properties: {} } }] };
  else if (message.method === 'tools/call') { await writeFile(${JSON.stringify(marker)}, 'executed'); result = { content: [{ type: 'text', text: 'Remote effect applied' }] }; }
  else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n');
});\n`);
    await writeFile(join(root, ".bsh/mcp.json"), JSON.stringify({ mcpServers: { synthetic: { command: process.execPath, args: [server], readOnly: false } } }));
    const result = await capture(root, "Execute Publish", {}, undefined, async function* (turn) {
      if (turn === 1) yield { delta: { tool_calls: [{ index: 0, id: "remote-publication", function: {
        name: "synthetic_write_publication", arguments: "{}"
      } }] } };
      else yield { delta: { content: "Remote tool was denied." } };
    });
    assert.equal(result.calls.length, 2, result.diagnostic);
    assert.ok(result.calls[0].tools.some(tool => tool.function.name === "synthetic_write_publication"), "Configured MCP manager actually connected and listed the tool");
    assert.equal(result.code, 1);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    const toolResponse = result.calls[1].messages.find(message => message.role === "tool");
    assert.match(toolResponse.content, /denied by approval broker/);
    const audit = await readFile(join(root, ".bsh/local/events.jsonl"), "utf8");
    assert.match(audit, /synthetic_write_publication/);
    assert.match(audit, /"decision":"deny"/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
