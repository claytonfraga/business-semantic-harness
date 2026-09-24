import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-'));
  const directory = join(root, '.bsh/domains/ativos');
  await mkdir(directory, { recursive: true });
  await copyFile(new URL('../fixtures/ativos/ontology.jsonld', import.meta.url), join(directory, 'ontology.jsonld'));
  await copyFile(new URL('../fixtures/ativos/shapes.ttl', import.meta.url), join(directory, 'shapes.ttl'));
  await writeFile(join(root, 'README.md'), 'O ativo possui um responsável.\n');
  await writeFile(join(root, '.bsh/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'pilot', domains: [{ id: 'ativos', version: '1.0.0', baseIri: 'urn:pilot:ativos:', ontology: 'domains/ativos/ontology.jsonld', shapes: 'domains/ativos/shapes.ttl' }] }));
  return root;
}

test('Given a complete project, when the MCP server starts, then ontology can be queried with provenance', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'bsh_query_ontology'));
    const result = await client.callTool({ name: 'bsh_query_ontology', arguments: { domain: 'ativos', iri: 'urn:pilot:ativos:Ativo' } });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /domains\/ativos\/ontology.jsonld/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given verifiable evidence, when an MCP proposal is submitted, then only a pending local proposal is written', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const before = await readFile(join(root, '.bsh/domains/ativos/ontology.jsonld'), 'utf8');
    const result = await client.callTool({ name: 'bsh_propose_observation', arguments: {
      domain: 'ativos', iri: 'urn:pilot:ativos:temResponsavel', candidate: { '@id': 'urn:pilot:ativos:temResponsavel' },
      evidenceFile: 'README.md', evidenceExcerpt: 'O ativo possui um responsável.',
    } });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /pending/);
    assert.equal(await readFile(join(root, '.bsh/domains/ativos/ontology.jsonld'), 'utf8'), before);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given unverifiable evidence, when an MCP proposal is submitted, then it is rejected', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'bsh_propose_observation', arguments: {
      domain: 'ativos', iri: 'urn:pilot:ativos:ausente', candidate: { '@id': 'urn:pilot:ativos:ausente' },
      evidenceFile: 'README.md', evidenceExcerpt: 'algo inexistente',
    } });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given a governed Codex session, when the agent queries and reports a conflict, then MCP records no project mutation', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root, 'governed'] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), ['bsh_propose_patch', 'bsh_query_ontology', 'bsh_report_conflict']);
    const before = await readFile(join(root, 'README.md'), 'utf8');
    const query = await client.callTool({ name: 'bsh_query_ontology', arguments: { domain: 'ativos' } });
    assert.equal(query.isError, undefined);
    const conflict = await client.callTool({ name: 'bsh_report_conflict', arguments: {
      domain: 'ativos', request: 'Permitir violação', conflictingRules: ['regra de transferência'], reason: 'Conflito observado',
    } });
    assert.equal(JSON.parse(conflict.content[0].text).status, 'submitted');
    const patch = await client.callTool({ name: 'bsh_propose_patch', arguments: {
      domain: 'ativos', summary: 'Trocar texto', files: [{ path: 'README.md', beforeSha256: 'a'.repeat(64), content: 'alterado' }],
    } });
    assert.equal(JSON.parse(patch.content[0].text).status, 'submitted');
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), before);
    await assert.rejects(readFile(join(root, '.bsh/local/events.jsonl')), /ENOENT/);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
