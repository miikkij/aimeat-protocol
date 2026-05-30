/**
 * @file flags.ts
 * @description MCP tool registration for content flagging/reporting.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerFlagsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_flag_report', descriptionFor('aimeat_flag_report'), {
    target_type: z.string().describe('Type of content being reported'),
    target_id: z.string().describe('Identifier of the reported content'),
    reason: z.string().describe('Reason for the report'),
  }, annotationsFor('aimeat_flag_report'), async ({ target_type, target_id, reason }) => {
    const resp = await client.post('/v1/flags', { target_type, target_id, reason });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
