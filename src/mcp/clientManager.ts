import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from '../client/openrouter/types.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  readOnly?: boolean;
  disabled?: boolean;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ConnectedTool {
  serverName: string;
  originalName: string;
  scopedName: string;
  definition: ToolDefinition;
  readOnly: boolean;
}

export class McpClientManager {
  private clients: Map<string, { client: Client; transport: StdioClientTransport; config: McpServerConfig }> = new Map();
  private tools: Map<string, ConnectedTool> = new Map();

  async loadFromProject(projectRoot: string): Promise<void> {
    const configPath = join(projectRoot, '.bsh', 'mcp.json');
    try {
      const raw = await readFile(configPath, 'utf8');
      const parsed: McpConfigFile = JSON.parse(raw);
      if (parsed.mcpServers) {
        await this.initServers(parsed.mcpServers);
      }
    } catch {
      // No .bsh/mcp.json or unreadable - graceful skip
    }
  }

  async initServers(servers: Record<string, McpServerConfig>): Promise<void> {
    for (const [serverName, config] of Object.entries(servers)) {
      if (config.disabled) continue;
      try {
        const cleanEnv: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (typeof v === 'string') cleanEnv[k] = v;
        }
        if (config.env) {
          for (const [k, v] of Object.entries(config.env)) {
            if (typeof v === 'string') cleanEnv[k] = v;
          }
        }

        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: cleanEnv,
        });

        const client = new Client({
          name: `bsh-client-${serverName}`,
          version: '0.2.5-beta',
        });

        await client.connect(transport);
        this.clients.set(serverName, { client, transport, config });

        const listed = await client.listTools();
        for (const tool of listed.tools) {
          const scopedName = tool.name.startsWith(`${serverName}_`) ? tool.name : `${serverName}_${tool.name}`;
          
          const definition: ToolDefinition = {
            type: 'function',
            function: {
              name: scopedName,
              description: tool.description || `Tool '${tool.name}' from external MCP server '${serverName}'`,
              parameters: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
            },
          };

          this.tools.set(scopedName, {
            serverName,
            originalName: tool.name,
            scopedName,
            definition,
            readOnly: config.readOnly ?? false,
          });
        }
      } catch (error) {
        process.stderr.write(`[BSH MCP Client] Warning: failed to connect to MCP server '${serverName}': ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getTool(name: string): ConnectedTool | undefined {
    return this.tools.get(name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found in any connected MCP server.`);
    }

    const entry = this.clients.get(tool.serverName);
    if (!entry) {
      throw new Error(`MCP server '${tool.serverName}' is not connected.`);
    }

    const response = await entry.client.callTool({
      name: tool.originalName,
      arguments: args,
    });

    const content = Array.isArray(response.content)
      ? (response.content as Array<{ type: string; text?: string }>)
      : [];

    if (response.isError) {
      const errText = content.map((c) => c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)).join('\n') || 'Unknown MCP error';
      throw new Error(`MCP tool '${name}' execution failed: ${errText}`);
    }

    const text = content.map((c) => c.type === 'text' ? (c.text ?? '') : JSON.stringify(c)).join('\n');
    return text;
  }

  async close(): Promise<void> {
    for (const entry of this.clients.values()) {
      try {
        await entry.client.close();
      } catch {
        // Ignore errors during teardown
      }
    }
    this.clients.clear();
    this.tools.clear();
  }
}
