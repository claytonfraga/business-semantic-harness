import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Helper to scaffold a real project with BSH governance structure.
 */
async function scaffoldGovernanceProject() {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-e2e-journey-'));
  const domainDir = join(root, '.bsh/domains/ativos');
  await mkdir(domainDir, { recursive: true });

  // Copy synthetic test fixtures
  await copyFile(new URL('../fixtures/ativos/ontology.jsonld', import.meta.url), join(domainDir, 'ontology.jsonld'));
  await copyFile(new URL('../fixtures/ativos/shapes.ttl', import.meta.url), join(domainDir, 'shapes.ttl'));

  // Project manifest
  await writeFile(
    join(root, '.bsh/project.json'),
    JSON.stringify({
      schemaVersion: 1,
      projectId: 'pilot-asset-management',
      domains: [
        {
          id: 'ativos',
          version: '1.0.0',
          baseIri: 'urn:pilot:ativos:',
          ontology: 'domains/ativos/ontology.jsonld',
          shapes: 'domains/ativos/shapes.ttl',
        },
      ],
    })
  );

  // Project code tokens for affinity check
  await writeFile(
    join(root, 'assetManager.ts'),
    `export interface Asset {\n  id: string;\n  patrimonio: string;\n  estadoOperacional: 'Disponivel' | 'EmOperacao' | 'Baixado';\n  responsavel: string;\n}\n`
  );

  return root;
}

test('Given an external agent connected to BSH MCP, when executing an end-to-end governance user journey, then intent, ontology, SHACL, and affinity are deterministically enforced', async () => {
  const projectRoot = await scaffoldGovernanceProject();
  const cliExecutable = resolve('dist/cli.js');

  // Spawn BSH MCP Server via stdio
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliExecutable, 'mcp', '--project', projectRoot],
  });
  const client = new Client({ name: 'external-ai-agent-e2e', version: '1.0.0' });

  try {
    await client.connect(transport);

    // =========================================================================
    // Journey Step 1: Tool Discovery
    // =========================================================================
    const tools = await client.listTools();
    const toolNames = tools.tools.map((t) => t.name);
    assert.ok(toolNames.includes('bsh_query_ontology'), 'Must expose ontology query tool');
    assert.ok(toolNames.includes('bsh_check_prompt_intent'), 'Must expose prompt guard tool');
    assert.ok(toolNames.includes('bsh_validate_shacl'), 'Must expose SHACL validation tool');
    assert.ok(toolNames.includes('bsh_check_affinity'), 'Must expose domain affinity tool');

    // =========================================================================
    // Journey Step 2: Pre-flight Prompt Intent Check (Catching Hallucinations)
    // =========================================================================
    const violatingUserPrompt = 'Transfer retired asset AST-001 to Finance department without justification';
    const intentResult = await client.callTool({
      name: 'bsh_check_prompt_intent',
      arguments: { prompt: violatingUserPrompt, domain: 'ativos' },
    });
    assert.equal(intentResult.isError, undefined);
    const parsedIntent = JSON.parse(intentResult.content[0].text);
    assert.equal(parsedIntent.isViolating, true, 'Violating intent must be caught');
    assert.ok(parsedIntent.shape?.includes('TransferShape'), 'Must identify TransferShape');
    assert.match(parsedIntent.message, /baixado/i, 'Must explain retired asset invariant');

    // =========================================================================
    // Journey Step 3: Ontology Discovery (Agent Learns Business Rules)
    // =========================================================================
    const ontologyQuery = await client.callTool({
      name: 'bsh_query_ontology',
      arguments: { domain: 'ativos', iri: 'urn:pilot:ativos:Ativo' },
    });
    assert.equal(ontologyQuery.isError, undefined);
    const parsedOntology = JSON.parse(ontologyQuery.content[0].text);
    assert.equal(parsedOntology.domain, 'ativos');
    assert.ok(parsedOntology.entries.length > 0, 'Ativo concept must have entries in ontology');
    assert.equal(parsedOntology.entries[0].iri, 'urn:pilot:ativos:Ativo');

    // =========================================================================
    // Journey Step 4: Conforming Intent Check (Developer Corrects Ask)
    // =========================================================================
    const validUserPrompt = 'Transfer available asset AST-101 to Carlos in Finance department';
    const validIntentResult = await client.callTool({
      name: 'bsh_check_prompt_intent',
      arguments: { prompt: validUserPrompt, domain: 'ativos' },
    });
    assert.equal(validIntentResult.isError, undefined);
    const parsedValidIntent = JSON.parse(validIntentResult.content[0].text);
    assert.equal(parsedValidIntent.isViolating, false, 'Conforming prompt must not be flagged');

    // =========================================================================
    // Journey Step 5: Deterministic SHACL Gate Validation
    // =========================================================================
    // 5A: Agent tries a non-conforming patch (transferring an asset in Baixado state)
    const violatingTurtleFacts = `@prefix ex: <urn:pilot:ativos:> .

ex:transfer-bad a ex:TransferenciaAtivo ;
  ex:estadoAtual ex:Baixado .
`;
    const invalidShaclResult = await client.callTool({
      name: 'bsh_validate_shacl',
      arguments: { domain: 'ativos', factsTurtle: violatingTurtleFacts },
    });
    assert.equal(invalidShaclResult.isError, undefined);
    const parsedInvalidReport = JSON.parse(invalidShaclResult.content[0].text);
    assert.equal(parsedInvalidReport.conforms, false, 'Violating candidate facts must fail SHACL');
    assert.ok(parsedInvalidReport.results.length > 0, 'Must provide detailed SHACL violations');
    assert.match(parsedInvalidReport.results[0].message, /baixado/i);

    // 5B: Agent corrects candidate facts (transferring an asset in Disponivel state)
    const conformingTurtleFacts = `@prefix ex: <urn:pilot:ativos:> .

ex:transfer-good a ex:TransferenciaAtivo ;
  ex:estadoAtual ex:Disponivel .
`;
    const validShaclResult = await client.callTool({
      name: 'bsh_validate_shacl',
      arguments: { domain: 'ativos', factsTurtle: conformingTurtleFacts },
    });
    assert.equal(validShaclResult.isError, undefined);
    const parsedValidReport = JSON.parse(validShaclResult.content[0].text);
    assert.equal(parsedValidReport.conforms, true, 'Conforming candidate facts must pass SHACL');

    // =========================================================================
    // Journey Step 6: Domain Concept Affinity Inspection
    // =========================================================================
    const affinityResult = await client.callTool({
      name: 'bsh_check_affinity',
      arguments: { domain: 'ativos' },
    });
    assert.equal(affinityResult.isError, undefined);
    const parsedAffinity = JSON.parse(affinityResult.content[0].text);
    assert.ok(['ALIGNED', 'INSUFFICIENT_DATA', 'MISMATCH'].includes(parsedAffinity.status));
  } finally {
    await client.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
});
