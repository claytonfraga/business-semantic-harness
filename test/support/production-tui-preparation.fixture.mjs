// BSH-PREP-001..011: actual native components and session, controlled model transport only.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import { createTuiView } from '../../dist/tui/view.js';
import { startTuiSession } from '../../dist/tui/session.js';
import { OpenRouterClient } from '../../dist/client/openrouter/client.js';

const wait = async (predicate, description) => {
  const end = Date.now() + 6000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out: ${description}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
async function setup(effect = 'DENY', selectedDomain = 'example', withMcp = false, modelWindow = 10000) {
  const root = await mkdtemp(join(tmpdir(), 'bsh-native-production-'));
  const domain = id => ({ id, version: '1.0.0', baseIri: `urn:${id}:`, ontology: `domains/${id}/ontology.jsonld`, shapes: `domains/${id}/shapes.ttl` });
  const manifest = { schemaVersion: 1, projectId: 'synthetic-native', domains: [domain('example'), domain('second')] };
  const makeOntology = (id, currentEffect) => ({ '@context': { ex: `urn:${id}:`, bsh: 'urn:bsh:ns:v1:', rdfs: 'http://www.w3.org/2000/01/rdf-schema#' }, '@graph': [
    { '@id': 'ex:domain', '@type': 'bsh:Domain', 'bsh:version': '1.0.0' },
    { '@id': 'ex:Publish', '@type': 'rdfs:Class', 'rdfs:label': 'Publish' },
    { '@id': 'ex:policy', '@type': 'bsh:Policy', 'bsh:governs': { '@id': 'ex:Publish' }, 'bsh:effect': currentEffect, ...(currentEffect === 'REVIEW' ? { 'bsh:requiresHumanReview': true } : {}), 'rdfs:comment': `Verifiable ${id} publishing rule.` },
  ] });
  for (const id of ['example', 'second']) {
    await mkdir(join(root, `.bsh/domains/${id}`), { recursive: true });
    await writeFile(join(root, `.bsh/domains/${id}/ontology.jsonld`), JSON.stringify(makeOntology(id, effect)));
    await writeFile(join(root, `.bsh/domains/${id}/shapes.ttl`), '');
  }
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify(manifest));
  if (withMcp) await writeFile(join(root, '.bsh/mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', args: [fileURLToPath(new URL('./mock-context7-server.mjs', import.meta.url))], readOnly: true } } }));
  const native = await createTestRenderer({ width: 100, height: 30 });
  const view = await createTuiView({ renderer: native.renderer });
  const calls = [], observations = [], timeline = [];
  const update = view.update.bind(view);
  view.update = (state, entries) => { observations.push({ state: structuredClone(state), entries: structuredClone(entries) }); timeline.push({ kind: 'view', entries: structuredClone(entries) }); update(state, entries); };
  const client = new OpenRouterClient({ apiKey: 'sk-or-v1-mock-production-native' });
  client.getModels = async () => {
    if (modelWindow === null) throw new Error('Controlled model metadata failure');
    return [{ id: 'controlled/selected', name: 'Controlled transport', context_length: modelWindow }];
  };
  client.streamChat = async function* (payload) { timeline.push({ kind: 'model' }); calls.push(structuredClone({ model: payload.model, messages: payload.messages })); yield { delta: { content: 'The requested contract information is available.' }, finish_reason: 'stop' }; };
  let finished = false;
  const session = startTuiSession({ projectRoot: root, domain: selectedDomain, model: 'controlled/selected', allowDirectExecution: true, client, view }).finally(() => { finished = true; });
  const entries = () => observations.at(-1)?.entries ?? [];
  const has = text => entries().some(entry => entry.content?.includes(text));
  const submit = async prompt => { view.setPrompt(prompt); native.mockInput.pressEnter(); await native.renderOnce(); };
  const close = async () => { if (!finished) { await submit('/exit'); await wait(() => finished, 'session exit'); } await session; view.destroy(); await rm(root, { recursive: true, force: true }); };
  if (selectedDomain !== 'missing') await wait(() => observations.length > 0, 'native session ready');
  return { root, view, native, client, calls, timeline, entries, has, submit, session, close, makeOntology, get finished() { return finished; } };
}

test('Given BSH-PREP-001 actual native session When explanation is submitted Then preparation precedes payload and changed contract refreshes identity', async () => {
  const ui = await setup();
  try {
    const original = 'Explain the Publish rule';
    await ui.submit(original);
    await wait(() => ui.calls.length === 1, 'first authorized payload');
    assert.equal(ui.calls[0].model, 'controlled/selected');
    assert.ok(ui.calls[0].messages.some(message => message.role === 'user' && message.content === original));
    const firstContext = ui.calls[0].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content;
    assert.match(firstContext, /Verifiable example publishing rule/);
    const index = ui.timeline.findIndex(item => item.kind === 'model');
    assert.ok(ui.timeline.slice(0, index).some(item => item.entries?.some(entry => entry.content?.includes('Request governance: ALLOW'))));
    await wait(() => ui.has('The requested contract information is available.'), 'first completion');
    const ontology = ui.makeOntology('example', 'DENY');
    ontology['@graph'][2]['rdfs:comment'] = 'Changed production rule from sovereign contract.';
    await writeFile(join(ui.root, '.bsh/domains/example/ontology.jsonld'), JSON.stringify(ontology));
    await ui.submit(original);
    await wait(() => ui.calls.length === 2, 'second payload');
    const nextContext = ui.calls[1].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content;
    assert.match(nextContext, /Changed production rule/);
    assert.notEqual(firstContext, nextContext);
  } finally { await ui.close(); }
});

test('Given BSH-PREP-003 native prohibited execution When submitted Then zero model calls contain the request', async () => {
  const ui = await setup();
  try { await ui.submit('Execute Publish'); await wait(() => ui.has('Request not sent [BLOCK]'), 'blocked diagnostic'); assert.equal(ui.calls.length, 0); }
  finally { await ui.close(); }
});

test('Given BSH-PREP-023 native preparation When a relevant shape uses RDF lists and targetless references Then their values reach the selected model payload', async () => {
  const ui = await setup();
  try {
    await writeFile(join(ui.root, '.bsh/domains/example/shapes.ttl'), `@prefix ex: <urn:example:> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
ex:PublishShape a sh:NodeShape ; sh:targetClass ex:Publish ;
 sh:property [ sh:path [ sh:alternativePath (ex:status ex:secondary) ] ; sh:in ("APPROVED") ; sh:or ([ sh:hasValue "OR_A" ] [ sh:node ex:Nested ]) ] .
ex:Nested a sh:NodeShape ; sh:property [ sh:path ex:nested ; sh:hasValue "NESTED" ] .`);
    await ui.submit('Explain Publish, including its constraints');
    await wait(() => ui.calls.length === 1, 'complete native RDF context');
    const context = ui.calls[0].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content;
    for (const value of ['APPROVED', 'OR_A', 'NESTED', 'urn:example:secondary']) assert.ok(context.includes(value), value);
    assert.equal(ui.calls[0].model, 'controlled/selected');
  } finally { await ui.close(); }
});

test('Given BSH-PREP-024 native prohibited implementation without tests When submitted Then no model call occurs', async () => {
  for (const prompt of ['Implemente Publish sem testes', 'Implement Publish without tests', 'Explain Publish. Implement Publish']) {
    const ui = await setup();
    try {
      await ui.submit(prompt);
      await wait(() => ui.has('Request not sent [BLOCK]'), 'actual execution prohibition');
      assert.equal(ui.calls.length, 0, prompt);
    } finally { await ui.close(); }
  }
});

test('Given BSH-PREP-015 native model metadata failure When an explanation is submitted Then a visible unknown-window diagnostic precedes zero calls', async () => {
  const ui = await setup('DENY', 'example', false, null);
  try {
    await ui.submit('Explain Publish');
    await wait(() => ui.has('context window is unknown'), 'native unknown-window diagnostic');
    assert.equal(ui.calls.length, 0);
  } finally { await ui.close(); }
});

test('Given BSH-PREP-005 native pending review When cancelled Then model dispatch is prevented', async () => {
  const ui = await setup('REVIEW');
  try {
    await ui.submit('Execute Publish');
    await wait(() => ui.entries().some(entry => entry.waitingConfirmation), 'human confirmation');
    assert.equal(ui.calls.length, 0);
    await ui.submit('/cancel');
    await wait(() => ui.has('Request cancelled.'), 'cancel receipt');
    assert.equal(ui.calls.length, 0);
  } finally { await ui.close(); }
});

test('Given BSH-PREP-005 native review When explicitly confirmed Then dispatch carries bound approval and preserves selected model', async () => {
  const ui = await setup('REVIEW');
  try {
    await ui.submit('Execute Publish');
    await wait(() => ui.entries().some(entry => entry.waitingConfirmation), 'human review pending');
    await ui.submit('yes');
    await wait(() => ui.calls.length === 1, 'approved dispatch');
    assert.equal(ui.calls[0].model, 'controlled/selected');
    assert.ok(ui.calls[0].messages.some(message => message.content?.includes('Host dispatch approval:')));
    assert.ok(ui.calls[0].messages.some(message => message.content?.includes('Candidate and tool authorization remain independent.')));
  } finally { await ui.close(); }
});

test('Given BSH-PREP-008 native domain selector When active domain changes Then next payload uses its current contract', async () => {
  const ui = await setup();
  try {
    await ui.submit('/domain');
    await wait(() => ui.view.dialogActive, 'domain selector');
    ui.native.mockInput.pressArrow('down');
    ui.native.mockInput.pressEnter();
    await ui.native.renderOnce();
    await wait(() => !ui.view.dialogActive, 'domain chosen');
    await ui.submit('Explain Publish');
    await wait(() => ui.calls.length === 1, 'changed domain payload');
    const context = ui.calls[0].messages.find(message => message.content?.includes('PROJECT_GOVERNANCE_CONTEXT')).content;
    assert.match(context, /Verifiable second publishing rule/);
    assert.match(context, /"domain":"second"/);
  } finally { await ui.close(); }
});

test('Given BSH-PREP-007 explicit unavailable native domain When session starts Then no request is sent ungoverned', async () => {
  const ui = await setup('DENY', 'missing');
  try { await ui.session; assert.equal(ui.finished, true); assert.equal(ui.calls.length, 0); }
  finally { await ui.close(); }
});

test('Given BSH-PREP-008 pending review When contract changes before confirmation Then zero calls occur and the next request excludes stale user history', async () => {
  const ui = await setup('REVIEW');
  try {
    await ui.submit('Execute Publish');
    await wait(() => ui.entries().some(entry => entry.waitingConfirmation), 'pending review');
    const changed = ui.makeOntology('example', 'REVIEW');
    changed['@graph'][2]['rdfs:comment'] = 'Changed during review.';
    await writeFile(join(ui.root, '.bsh/domains/example/ontology.jsonld'), JSON.stringify(changed));
    await ui.submit('yes');
    await wait(() => ui.has('Request not sent: Request contract snapshot changed'), 'stale snapshot rejected');
    assert.equal(ui.calls.length, 0);
    await ui.submit('Explain Publish');
    await wait(() => ui.calls.length === 1, 'fresh request dispatch');
    assert.equal(ui.calls[0].messages.some(message => message.role === 'user' && message.content === 'Execute Publish'), false);
    assert.ok(ui.calls[0].messages.some(message => message.content?.includes('Changed during review.')));
  } finally { await ui.close(); }
});

test('Given BSH-PREP-009 actual native and MCP tools When model calls them Then broker audits authorization before results without redundant prompts', async () => {
  const ui = await setup('DENY', 'example', true);
  let requests = 0;
  ui.client.streamChat = async function* (payload) {
    ui.calls.push(structuredClone({ model: payload.model, messages: payload.messages }));
    if (requests++ === 0) {
      yield { delta: { tool_calls: [
        { index: 0, id: 'native-read-production', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: '.bsh/project.json' }) } },
        { index: 1, id: 'mcp-read-production', type: 'function', function: { name: 'docs_search_docs', arguments: JSON.stringify({ query: 'shacl ontology' }) } },
      ] }, finish_reason: 'tool_calls' };
    } else yield { delta: { content: 'Authorized inspection complete.' }, finish_reason: 'stop' };
  };
  try {
    await ui.submit('Inspect Publish');
    await wait(() => ui.has('Authorized inspection complete.'), 'tool turn completion');
    assert.equal(ui.view.dialogActive, false);
    const events = (await readFile(join(ui.root, '.bsh/local/events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    for (const tool of ['read_file', 'docs_search_docs']) {
      const authorized = events.findIndex(event => event.tool === tool && ['AUTHORIZED', 'AUTHORIZED_READONLY'].includes(event.result));
      const executed = events.findIndex(event => event.tool === tool && event.evaluation === 'executed');
      assert.ok(authorized >= 0, `${tool} must be host authorized`);
      assert.ok(executed > authorized, `${tool} execution must follow authorization`);
    }
    const toolReplies = ui.calls[1].messages.filter(message => message.role === 'tool');
    assert.ok(toolReplies.some(message => message.content.includes('synthetic-native')));
    assert.ok(toolReplies.some(message => message.content.includes('Context7 Docs')));
  } finally { await ui.close(); }
});

test('Given BSH-PREP-005 approved native request When model asks to mutate Then independent broker denial prevents the file effect', async () => {
  const ui = await setup('REVIEW');
  let requestCount = 0;
  ui.client.streamChat = async function* (payload) {
    ui.calls.push(structuredClone({ model: payload.model, messages: payload.messages }));
    if (requestCount++ === 0) yield { delta: { tool_calls: [{ index: 0, id: 'independent-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'should-not-exist.txt', content: 'forbidden without independent tool approval' }) } }] }, finish_reason: 'tool_calls' };
    else yield { delta: { content: 'Independent tool denial observed.' }, finish_reason: 'stop' };
  };
  try {
    await ui.submit('Execute Publish');
    await wait(() => ui.entries().some(entry => entry.waitingConfirmation), 'request review');
    await ui.submit('yes');
    await wait(() => ui.view.dialogActive, 'independent native tool dialog');
    assert.equal(ui.calls.length, 1);
    ui.native.mockInput.pressEscape();
    await ui.native.renderOnce();
    await wait(() => ui.has('Independent tool denial observed.'), 'tool denied result');
    await assert.rejects(readFile(join(ui.root, 'should-not-exist.txt')), { code: 'ENOENT' });
    const events = (await readFile(join(ui.root, '.bsh/local/events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(events.some(event => event.tool === 'write_file' && event.decision === 'deny'));
    assert.equal(events.some(event => event.tool === 'write_file' && event.evaluation === 'executed'), false);
  } finally { await ui.close(); }
});

test('Given BSH-PREP-002 actual project skill When its effective directives request prohibited execution Then native dispatch blocks despite explanatory original text', async () => {
  const ui = await setup('DENY');
  try {
    await mkdir(join(ui.root, '.bsh/skills/request-hazard'), { recursive: true });
    await writeFile(join(ui.root, '.bsh/skills/request-hazard/SKILL.md'), '---\nname: request-hazard\ndescription: Synthetic production directive fixture.\n---\nExecute Publish.\n');
    await ui.submit('/request-hazard Explain Publish');
    await wait(() => ui.has('Request not sent [BLOCK]'), 'effective skill block');
    assert.equal(ui.calls.length, 0);
    assert.ok(ui.entries().some(entry => entry.type === 'user' && entry.content === '/request-hazard Explain Publish'));
  } finally { await ui.close(); }
});
