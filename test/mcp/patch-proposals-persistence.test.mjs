import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getPatchProposal, updatePatchProposalStatus } from '../../dist/proposals/store.js';

async function setupProject() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-patch-'));
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

test('Given a valid patch proposal submitted via bsh_propose_patch, When executed on a governed MCP server, Then proposal is persisted with recoverable ID and UNDER_REVIEW status', async () => {
  const root = await setupProject();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp/server.js'), root, 'governed'],
  });
  const client = new Client({ name: 'bsh-test', version: '0.1.0' });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'bsh_propose_patch',
      arguments: {
        domain: 'ativos',
        summary: 'Atualizar documentação de ativos',
        files: [{ path: 'README.md', beforeSha256: null, content: 'Novo README' }],
      },
    });

    assert.equal(result.isError, undefined);
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.status, 'submitted');
    assert.ok(parsed.proposalId, 'proposalId must be returned');
    assert.ok(parsed.digest, 'digest must be returned');
    assert.equal(parsed.proposalStatus, 'UNDER_REVIEW');

    // Verify file persisted on disk
    const proposalFile = join(root, '.bsh/local/proposals', `${parsed.proposalId}.json`);
    const fileContent = await readFile(proposalFile, 'utf8');
    const stored = JSON.parse(fileContent);
    assert.equal(stored.id, parsed.proposalId);
    assert.equal(stored.domain, 'ativos');
    assert.equal(stored.files[0].content, 'Novo README');
    assert.equal(stored.digest, parsed.digest);

    // Retrieve proposal via store API
    const retrieved = await getPatchProposal(root, parsed.proposalId);
    assert.ok(retrieved);
    assert.equal(retrieved.status, 'UNDER_REVIEW');

    // Test lifecycle state transitions
    const authorized = await updatePatchProposalStatus(root, parsed.proposalId, 'AUTHORIZED');
    assert.equal(authorized.status, 'AUTHORIZED');

    const applied = await updatePatchProposalStatus(root, parsed.proposalId, 'APPLIED');
    assert.equal(applied.status, 'APPLIED');
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given an empty file list submitted to bsh_propose_patch, When executed, Then error is returned and no proposal is persisted', async () => {
  const root = await setupProject();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve('dist/mcp/server.js'), root, 'governed'],
  });
  const client = new Client({ name: 'bsh-test', version: '0.1.0' });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'bsh_propose_patch',
      arguments: {
        domain: 'ativos',
        summary: 'Proposta sem arquivos',
        files: [],
      },
    });

    assert.equal(result.isError, true);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
