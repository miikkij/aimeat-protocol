/**
 * @file probe-mcp.ts
 * @description One-off probe: boots an embedded node, sets up an agent, then
 *   connects an MCP client to POST /v1/mcp with the agent's Bearer JWT and lists
 *   the tool surface + schemas. Confirms a plain agent JWT authenticates over
 *   MCP and reveals the exact node tool names/args the McpAgentDriver must call.
 * @usage cd aimeat && pnpm exec tsx tools/synthtraces/src/probe-mcp.ts
 * @version-history v0.1.0 -- 2026-06-05 -- Initial probe for the MCP transport driver
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AimeatClient } from './client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = 40252;
const outDir = fileURLToPath(new URL('../out/', import.meta.url));
process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_DB = 'sqlite';
process.env.AIMEAT_DB_PATH = join(outDir, `probe-${randomBytes(4).toString('hex')}.db`);
if (!process.env.AIMEAT_ADMIN_PASSWORD) process.env.AIMEAT_ADMIN_PASSWORD = randomBytes(16).toString('base64url');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { loadConfig } = (await import('../../../src/config.js')) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { createServer } = (await import('../../../src/server.js')) as any;
const { config } = loadConfig({});
config.port = PORT;
const { app } = await createServer(config);
const server = await new Promise<{ close: (cb: () => void) => void }>((r) => {
  const s = app.listen(PORT, () => r(s));
});

const base = `http://localhost:${PORT}`;
const rest = new AimeatClient(base, 'aimeat-local-001-dev');
const creds = await rest.setup({ ownerName: `probe${Date.now()}`, agentName: 'probeagent' });
console.log('agent gaii:', creds.agentGaii);

try {
  const transport = new StreamableHTTPClientTransport(new URL(base + '/v1/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${creds.agentToken}` } },
  });
  const mcp = new Client({ name: 'synthtraces-probe', version: '0.1.0' });
  await mcp.connect(transport);
  const { tools } = await mcp.listTools();
  console.log('MCP CONNECTED. tool count:', tools.length);
  const want = /memory_write|memory_read|memory_list|task_event|task_complete|task_fail|message_send/;
  for (const t of tools) {
    if (want.test(t.name)) {
      const props = t.inputSchema && (t.inputSchema as { properties?: Record<string, unknown> }).properties;
      console.log(`\n# ${t.name}`);
      console.log('  props:', props ? Object.keys(props).join(', ') : JSON.stringify(t.inputSchema));
    }
  }
  await mcp.close();
} catch (e) {
  console.error('MCP PROBE ERROR:', (e as Error).message);
}

await new Promise<void>((r) => server.close(() => r()));
process.exit(0);
