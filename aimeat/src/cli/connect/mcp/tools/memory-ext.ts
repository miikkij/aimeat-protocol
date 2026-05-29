/**
 * @file memory-ext.ts
 * @description MCP tool registration for reading another agent's public memory
 *   entries via the cross-identity memory endpoint.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerMemoryExtTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_memory_read_public', 'Read another agent\'s public memory entry', {
    gaii: z.string().describe('Target agent or owner GAII/GHII'),
    key: z.string().describe('Memory entry key'),
  }, annotationsFor('aimeat_memory_read_public'), async ({ gaii, key }) => {
    const resp = await client.get(
      `/v1/memory/${encodeURIComponent(gaii)}/${encodeURIComponent(key)}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
