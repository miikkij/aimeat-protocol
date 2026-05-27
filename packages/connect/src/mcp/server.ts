/**
 * @file server.ts
 * @description MCP server entry point. Registers all tools and resources, starts transport.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AimeatClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { startPoller } from './poller.js';

export async function runServe(_flags: Record<string, string>): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('Not configured. Run: npx @aimeat/connect');
    process.exit(1);
  }

  const client = await AimeatClient.fromConfig();

  const mcp = new McpServer({
    name: 'aimeat-connect',
    version: '0.1.0',
  });

  registerAllTools(mcp, client, config.agent);
  registerResources(mcp, client);

  startPoller(client, config);

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error(`AIMEAT MCP server running (agent: ${config.agent}, node: ${config.node_url})`);
}
