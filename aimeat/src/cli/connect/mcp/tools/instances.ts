/**
 * @file instances.ts
 * @description MCP tool registrations for instance management -- listing,
 *   creating, and checking instance status.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerInstancesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_instance_list', 'List instances', {}, annotationsFor('aimeat_instance_list'), async () => {
    const resp = await client.get('/v1/instances');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_instance_create', 'Create a new instance', {
    name: z.string().describe('Instance name'),
    template: z.string().optional().describe('Template to use'),
  }, annotationsFor('aimeat_instance_create'), async ({ name, template }) => {
    const body: Record<string, unknown> = { name };
    if (template) body.template = template;
    const resp = await client.post('/v1/instances', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_instance_status', 'Get instance status', {
    id: z.string().describe('Instance identifier'),
  }, annotationsFor('aimeat_instance_status'), async ({ id }) => {
    const resp = await client.get(`/v1/instances/${encodeURIComponent(id)}/status`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
