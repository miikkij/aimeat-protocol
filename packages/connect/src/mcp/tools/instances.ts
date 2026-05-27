/**
 * @file instances.ts
 * @description MCP tool registrations for instance management -- listing,
 *   creating, and checking instance status.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../lib/api-client.js';

export function registerInstancesTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_instance_list', 'List instances', {}, async () => {
    const resp = await client.get('/v1/instances');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_instance_create', 'Create a new instance', {
    name: z.string().describe('Instance name'),
    template: z.string().optional().describe('Template to use'),
  }, async ({ name, template }) => {
    const body: Record<string, unknown> = { name };
    if (template) body.template = template;
    const resp = await client.post('/v1/instances', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_instance_status', 'Get instance status', {
    id: z.string().describe('Instance identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/instances/${encodeURIComponent(id)}/status`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
