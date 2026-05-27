/**
 * @file flags.ts
 * @description MCP tool registration for content flagging/reporting.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

export function registerFlagsTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_flag_report', 'Report content for moderation', {
    target_type: z.string().describe('Type of content being reported'),
    target_id: z.string().describe('Identifier of the reported content'),
    reason: z.string().describe('Reason for the report'),
  }, async ({ target_type, target_id, reason }) => {
    const resp = await client.post('/v1/flags', { target_type, target_id, reason });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
