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
    const code = await runHeadlessCodingSession({ projectRoot: root, prompt, model: "selected/model", domain: "synthetic", allowDirectExecution: true, client, ...extra });
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
