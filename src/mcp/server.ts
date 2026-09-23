#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { queryOntology } from '../ontology/query.js';
import { validateProject } from '../ontology/validate.js';
import { createProposal } from '../proposals/store.js';

export function createOracleMcpServer(root: string): McpServer {
  const server = new McpServer(
    { name: 'oracle', version: '0.1.0' },
    { instructions: 'Consulte a ontologia do domínio antes de propor alterações. Declare descobertas como propostas com evidência. As propostas não alteram a ontologia aprovada.' },
  );
  server.registerTool('oracle_query_ontology', {
    description: 'Consulta conceitos, relações, shapes e regras de um domínio com origem verificável.',
    inputSchema: { domain: z.string(), iri: z.string().optional() },
  }, async ({ domain, iri }) => {
    try {
      const result = await queryOntology(root, domain, iri);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  server.registerTool('oracle_propose_observation', {
    description: 'Registra uma proposta pendente com evidência em arquivo do projeto; não altera ontologias aprovadas.',
    inputSchema: {
      domain: z.string(), iri: z.string(), candidate: z.record(z.string(), z.unknown()),
      evidenceFile: z.string(), evidenceExcerpt: z.string(),
    },
  }, async ({ domain, iri, candidate, evidenceFile, evidenceExcerpt }) => {
    try {
      const proposal = await createProposal(root, { domain, iri, candidate, evidence: { file: evidenceFile, excerpt: evidenceExcerpt } });
      return { content: [{ type: 'text', text: JSON.stringify({ id: proposal.id, status: proposal.status, ontologyDigest: proposal.ontologyDigest }) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  return server;
}

export async function main(root: string): Promise<void> {
  const report = await validateProject(root);
  if (!report.ready) throw new Error(`Ontologia não pronta: ${report.issues.map((issue) => issue.message).join('; ')}`);
  await createOracleMcpServer(root).connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main(process.argv[2] ?? process.cwd()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
