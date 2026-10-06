import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { McpClientManager } from '../../dist/mcp/clientManager.js';
import { runAgentTurn } from '../../dist/agent/agentLoop.js';

const mockServerScript = resolve('test/support/mock-context7-server.mjs');

test('Given a project with third-party MCP configuration, when McpClientManager loads, then tools are discovered and executable over stdio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-client-e2e-'));
  const bshDir = join(root, '.bsh');
  await mkdir(bshDir, { recursive: true });

  // Write .bsh/mcp.json pointing to mock Context7 server
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
    })
  );

  const manager = new McpClientManager();
  try {
    await manager.loadFromProject(root);

    // 1. Tool discovery
    const toolDefs = manager.getToolDefinitions();
    assert.ok(toolDefs.length > 0, 'Must discover tools from context7');
    const docTool = toolDefs.find((t) => t.function.name === 'context7_search_docs');
    assert.ok(docTool, 'context7_search_docs must be registered');
    assert.equal(docTool.type, 'function');
    assert.match(docTool.function.description, /Search documentation/i);

    // 2. Tool invocation over stdio
    const response = await manager.callTool('context7_search_docs', {
      query: 'shacl validation rules',
    });
    assert.match(response, /Context7 Docs/);
    assert.match(response, /NodeShape/);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Given runAgentTurn with configured McpClientManager, when the model invokes a third-party MCP tool, then the tool is executed and result returned to conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-mcp-agent-turn-e2e-'));
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
    })
  );

  const manager = new McpClientManager();
  await manager.loadFromProject(root);

  // Mock OpenRouterClient that calls the third-party tool on turn 1 and finishes on turn 2
  let turnCount = 0;
  const mockClient = {
    async *streamChat({ tools }) {
      turnCount++;
      assert.ok(tools.some((t) => t.function.name === 'context7_search_docs'), 'Third-party tool must be available to model');

      if (turnCount === 1) {
        // Model requests context7 doc lookup
        yield {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_context7_123',
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
        // Model responds using retrieved documentation
        yield {
          delta: {
            content: 'Based on Context7 documentation, SHACL NodeShapes validate target classes.',
          },
        };
      }
    },
  };

  const toolStarts = [];
  const toolDones = [];

  try {
    const result = await runAgentTurn({ contextLength: 131072,
      client: mockClient,
      model: 'deepseek/deepseek-v4.1-flash',
      workspaceRoot: root,
      messages: [{ role: 'user', content: 'What does SHACL define according to documentation?' }],
      mcpManager: manager,
      onToolCallStart: (call) => toolStarts.push(call),
      onToolCallDone: (call) => toolDones.push(call),
    });

    assert.equal(result.completed, true);
    assert.match(result.finalAssistantMessage.content, /SHACL NodeShapes validate/);
    assert.equal(toolStarts.length, 1);
    assert.equal(toolStarts[0].name, 'context7_search_docs');
    assert.equal(toolDones.length, 1);
    assert.match(toolDones[0].result, /Context7 Docs/);
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
});
