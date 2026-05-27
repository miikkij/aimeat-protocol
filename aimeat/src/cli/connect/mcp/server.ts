/**
 * @file server.ts
 * @description MCP server entry point. Registers all tools and resources, starts transport.
 * @structure Loads connector credentials, registers MCP tools/resources, starts polling, and connects stdio transport.
 * @usage Called by `aimeat connect serve`.
 * @version-history v1.9.4 — 2026-05-28 — Update connector guidance and fail missing credentials without a stack trace.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AimeatClient } from '../api-client.js';
import { loadConfig } from '../config.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { startPoller } from './poller.js';

export async function runServe(_flags: Record<string, string>): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error('Not configured. Run: npx aimeat connect');
    process.exit(1);
  }

  let client: AimeatClient;
  try {
    client = await AimeatClient.fromConfig();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

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
