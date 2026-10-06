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

test('Given a complete project When the MCP server starts Then ontology can be queried with provenance', async () => {
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

test('Given verifiable evidence When an MCP proposal is submitted Then only a pending local proposal is written', async () => {
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

test('Given unverifiable evidence When an MCP proposal is submitted Then it is rejected', async () => {
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

test('Given a governed BSH session When the agent queries and reports a conflict Then MCP records no project mutation', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root, 'governed'] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
      'bsh_check_affinity',
      'bsh_check_prompt_intent',
      'bsh_propose_patch',
      'bsh_query_ontology',
      'bsh_report_conflict',
      'bsh_validate_shacl',
    ]);
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

test('Given a prompt with violating intent When bsh_check_prompt_intent is called via MCP Then violation is reported', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'bsh_check_prompt_intent',
      arguments: { prompt: 'transferir ativo baixado sem justificativa', domain: 'ativos' },
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.isViolating, true);
    assert.match(parsed.message, /baixado/i);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given candidate facts in Turtle When bsh_validate_shacl is called via MCP Then validation report is returned', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/server.js'), root] });
  const client = new Client({ name: 'bsh-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const turtle = `@prefix ex: <urn:pilot:ativos:> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

ex:asset-99 a ex:Ativo ;
  ex:estadoOperacional ex:Baixado .

ex:transfer-99 a ex:Transferencia ;
  ex:ativoTransferido ex:asset-99 ;
  ex:departamentoDestino "TI" .
`;
    const result = await client.callTool({
      name: 'bsh_validate_shacl',
      arguments: { domain: 'ativos', factsTurtle: turtle },
    });
    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(typeof parsed.conforms, 'boolean');
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given bsh CLI with mcp subcommand When invoked Then MCP server connects via stdio and responds to tool listing', async () => {
  const root = await project();
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.js'), 'mcp', '--project', root] });
  const client = new Client({ name: 'bsh-cli-quality', version: '0.1.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'bsh_query_ontology'));
    assert.ok(listed.tools.some(tool => tool.name === 'bsh_check_prompt_intent'));
    assert.ok(listed.tools.some(tool => tool.name === 'bsh_validate_shacl'));
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
