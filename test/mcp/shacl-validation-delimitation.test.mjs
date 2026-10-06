import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function setupProject() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-shacl-'));
  const directory = join(root, '.bsh/domains/ativos');
  await mkdir(directory, { recursive: true });
  await copyFile(new URL('../fixtures/ativos/ontology.jsonld', import.meta.url), join(directory, 'ontology.jsonld'));
  await copyFile(new URL('../fixtures/ativos/shapes.ttl', import.meta.url), join(directory, 'shapes.ttl'));
  await writeFile(join(root, 'README.md'), 'Projeto de teste.\n');
  await writeFile(
    join(root, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'pilot',
      domains: [{ id: 'ativos', version: '1.0.0', baseIri: 'urn:pilot:ativos:', ontology: 'domains/ativos/ontology.jsonld', shapes: 'domains/ativos/shapes.ttl' }],
    })
  );
  return root;
}

test('Given valid Turtle facts sent to bsh_validate_shacl, When executed via MCP, Then response explicitly delimits consultative role and declares that it does not authorize promotion', async () => {
  const root = await setupProject();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp/server.js'), root],
  });
  const client = new Client({ name: 'bsh-test', version: '0.1.0' });

  try {
    await client.connect(transport);
    const validTurtle = `
      @prefix ex: <urn:pilot:ativos:> .

      ex:Transf1 a ex:TransferenciaAtivo ;
        ex:estadoAtual ex:Disponivel .
    `;

    const result = await client.callTool({
      name: 'bsh_validate_shacl',
      arguments: {
        domain: 'ativos',
        factsTurtle: validTurtle,
      },
    });

    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.conforms, true);
    assert.equal(parsed.role, 'CONSULTATIVE');
    assert.equal(parsed.isSelfDeclaredPayload, true);
    assert.equal(parsed.authorizesPromotion, false);
    assert.ok(parsed.limitations.includes('Validação consultiva'));
    assert.ok(parsed.limitations.includes('extração de evidências'));
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given violating Turtle facts sent to bsh_validate_shacl, When executed via MCP, Then violations are reported alongside consultative non-authorizing status', async () => {
  const root = await setupProject();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp/server.js'), root],
  });
  const client = new Client({ name: 'bsh-test', version: '0.1.0' });

  try {
    await client.connect(transport);
    // Violating turtle: Transfer of a retired asset violates sh:in (ex:Disponivel ex:EmUso)
    const violatingTurtle = `
      @prefix ex: <urn:pilot:ativos:> .

      ex:Transf2 a ex:TransferenciaAtivo ;
        ex:estadoAtual ex:Baixado .
    `;

    const result = await client.callTool({
      name: 'bsh_validate_shacl',
      arguments: {
        domain: 'ativos',
        factsTurtle: violatingTurtle,
      },
    });

    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.conforms, false);
    assert.ok(parsed.results.length > 0);
    assert.equal(parsed.role, 'CONSULTATIVE');
    assert.equal(parsed.authorizesPromotion, false);
    assert.ok(parsed.limitations.includes('Validação consultiva'));
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
