/**
 * @file instances.ts
 * @description MCP tool registrations for instance management -- listing,
 *   creating, and checking instance status.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: instance_status id->instance_id. instance_create
 *     left as-is (model vs template) -- server MCP targets chat-instances, connector targets package
 *     instances; the model/template divergence reflects two different instance concepts (baselined).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerInstancesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_instance_list', descriptionFor('aimeat_instance_list'), {}, annotationsFor('aimeat_instance_list'), async () => {
    const resp = await client.get('/v1/instances');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_instance_create', descriptionFor('aimeat_instance_create'), {
    name: z.string().describe('Instance name'),
    template: z.string().optional().describe('Template to use'),
  }, annotationsFor('aimeat_instance_create'), async ({ name, template }) => {
    const body: Record<string, unknown> = { name };
    if (template) body.template = template;
    const resp = await client.post('/v1/instances', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_instance_status', descriptionFor('aimeat_instance_status'), {
    instance_id: z.string().describe('Instance identifier'),
  }, annotationsFor('aimeat_instance_status'), async ({ instance_id }) => {
    const resp = await client.get(`/v1/instances/${encodeURIComponent(instance_id)}/status`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
