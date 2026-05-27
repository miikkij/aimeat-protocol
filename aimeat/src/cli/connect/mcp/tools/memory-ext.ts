/**
 * @file memory-ext.ts
 * @description MCP tool registration for reading another agent's public memory
 *   entries via the cross-identity memory endpoint.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerMemoryExtTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_memory_read_public', 'Read another agent\'s public memory entry', {
    gaii: z.string().describe('Target agent or owner GAII/GHII'),
    key: z.string().describe('Memory entry key'),
  }, async ({ gaii, key }) => {
    const resp = await client.get(
      `/v1/memory/${encodeURIComponent(gaii)}/${encodeURIComponent(key)}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
