#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { McpClientManager } from '../../dist/mcp/clientManager.js';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mockServerScript = resolve('test/support/mock-context7-server.mjs');

console.log('\x1b[38;5;38m─── BSH Agent with MCP Client Integration ─────────────────── [*] GOVERNED ───\x1b[0m\n');

const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-client-demo-'));
const bshDir = join(root, '.bsh');
await mkdir(bshDir, { recursive: true });

await writeFile(
  join(bshDir, 'mcp.json'),
  JSON.stringify({
    mcpServers: {
      context7: {
        command: process.execPath,
        args: [mockServerScript],
        readOnly: true,
      },
    },
  }, null, 2)
);

console.log('\x1b[90m[+] Loading external MCP server configuration from .bsh/mcp.json...\x1b[0m');
await sleep(1500);

const manager = new McpClientManager();

try {
  await manager.loadFromProject(root);
  console.log('\x1b[32m[✔] Connected to external MCP server: "context7" via stdio transport\x1b[0m\n');
  await sleep(1500);

  // Discover tools
  console.log('\x1b[33m>_ [MCP Client] Inspecting available tools from Context7...\x1b[0m');
  const toolDefs = manager.getToolDefinitions();
  await sleep(1000);
  for (const t of toolDefs) {
    console.log(`    \x1b[36m• ${t.function.name}\x1b[0m: ${t.function.description}`);
  }
  console.log();
  await sleep(2000);

  // Run agent turn with mock model
  const userAsk = 'What does SHACL define according to documentation?';
  console.log(`\x1b[38;5;38m> [User]:\x1b[0m "${userAsk}"\n`);
  await sleep(1500);

  let turnCount = 0;
  const mockClient = {
    async *streamChat() {
      turnCount++;
      if (turnCount === 1) {
        yield {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_context7_docs_1',
                type: 'function',
                function: {
                  name: 'context7_search_docs',
                  arguments: JSON.stringify({ query: 'shacl shapes' }),
                },
              },
            ],
          },
        };
      } else {
        yield {
          delta: {
            content: 'De acordo com a documentação oficial consultada via Context7, o SHACL (Shapes Constraint Language) define NodeShapes e PropertyShapes para validar grafos RDF e dados semânticos contra restrições de negócio e condições de integridade estrutural.',
          },
        };
      }
    },
  };

  console.log('\x1b[38;5;177m[BSH Agent]\x1b[0m Identificando conhecimento técnico... despachando chamada ao MCP Context7.');
  await sleep(1000);

  const result = await runAgentTurn({
    client: mockClient,
    model: 'deepseek/deepseek-v4.1-flash',
    workspaceRoot: root,
    messages: [{ role: 'user', content: userAsk }],
    mcpManager: manager,
    onToolCallStart: (call) => {
      console.log(`\x1b[33m>_ Tool: ${call.name}(${JSON.stringify(call.args)})\x1b[0m`);
    },
    onToolCallDone: (call) => {
      console.log(`\x1b[32m-> Resposta do servidor context7:\x1b[0m`);
      console.log(`   ${call.result.trim()}\n`);
    },
  });

  await sleep(2000);
  console.log(`\x1b[38;5;177m[BSH Agent]\x1b[0m Resposta fundamentada:`);
  console.log(`  ${result.finalAssistantMessage.content}\n`);
  await sleep(2500);

  console.log('\x1b[38;5;38m─── MCP Client Execution Finished: External Tool Consumed via stdio ───\x1b[0m');
} finally {
  await manager.close();
  await rm(root, { recursive: true, force: true });
}
