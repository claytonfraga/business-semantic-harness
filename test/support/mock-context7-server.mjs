#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const server = new McpServer(
  { name: 'context7-docs', version: '1.0.0' },
  { instructions: 'Documentation lookup server for libraries and frameworks.' }
);

server.registerTool('search_docs', {
  description: 'Search documentation for a library or API topic.',
  annotations: { readOnlyHint: true },
  inputSchema: { query: z.string(), library: z.string().optional() },
}, async ({ query, library }) => {
  if (query.includes('shacl') || query.includes('ontology')) {
    return {
      content: [{
        type: 'text',
        text: 'Context7 Docs: W3C SHACL Core defines NodeShape and PropertyShape constraints such as sh:in, sh:minCount, and sh:targetClass.',
      }],
    };
  }
  return {
    content: [{
      type: 'text',
      text: `Context7 Docs: Results for ${query}${library ? ` in ${library}` : ''}`,
    }],
  };
});

await server.connect(new StdioServerTransport());
