import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'oracle-mcp-'));
  const directory = join(root, '.oracle/domains/ativos');
  await mkdir(directory, { recursive: true });
  await copyFile(new URL('../fixtures/ativos/ontology.jsonld', import.meta.url), join(directory, 'ontology.jsonld'));
  await copyFile(new URL('../fixtures/ativos/shapes.ttl', import.meta.url), join(directory, 'shapes.ttl'));
  await writeFile(join(root, 'README.md'), 'O ativo possui um responsável.\n');
  await writeFile(join(root, '.oracle/project.json'), JSON.stringify({ schemaVersion: 1, projectId: 'pilot', domains: [{ id: 'ativos', version: '1.0.0', baseIri: 'urn:pilot:ativos:', ontology: 'domains/ativos/ontology.jsonld', shapes: 'domains/ativos/shapes.ttl' }] }));
  return root;
}

test('Given a complete project, when the MCP server starts, then ontology can be queried with provenance', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'oracle-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'oracle_query_ontology'));
    const result = await client.callTool({ name: 'oracle_query_ontology', arguments: { domain: 'ativos', iri: 'urn:pilot:ativos:Ativo' } });
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
  const client = new Client({ name: 'oracle-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const before = await readFile(join(root, '.oracle/domains/ativos/ontology.jsonld'), 'utf8');
    const result = await client.callTool({ name: 'oracle_propose_observation', arguments: {
      domain: 'ativos', iri: 'urn:pilot:ativos:temResponsavel', candidate: { '@id': 'urn:pilot:ativos:temResponsavel' },
      evidenceFile: 'README.md', evidenceExcerpt: 'O ativo possui um responsável.',
    } });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /pending/);
    assert.equal(await readFile(join(root, '.oracle/domains/ativos/ontology.jsonld'), 'utf8'), before);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given unverifiable evidence, when an MCP proposal is submitted, then it is rejected', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'oracle-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'oracle_propose_observation', arguments: {
      domain: 'ativos', iri: 'urn:pilot:ativos:ausente', candidate: { '@id': 'urn:pilot:ativos:ausente' },
      evidenceFile: 'README.md', evidenceExcerpt: 'algo inexistente',
    } });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
