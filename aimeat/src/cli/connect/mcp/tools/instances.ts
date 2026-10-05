/**
 * @file instances.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for instance management -- listing,
 *   creating, and checking instance status.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: instance_status id->instance_id. instance_create
 *     left as-is (model vs template) -- server MCP targets chat-instances, connector targets package
 *     instances; the model/template divergence reflects two different instance concepts (baselined).
 *   v1.3.0 -- 2026-09-06 -- All three point at /v1/chat-instances, the resource their own published
 *     description names. The baseline above called the split intentional; it was the aimeat_app_*
 *     failure again -- one tool NAME, two backends. `POST /v1/instances` does not exist on any node,
 *     so instance_create had been a 404 since it was written, and instance_list/instance_status read
 *     package instances under a description promising chat sessions.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { envelopeResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerInstancesTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_instance_list', descriptionFor('aimeat_instance_list'), zodShapeFor('aimeat_instance_list'), annotationsFor('aimeat_instance_list'), async () => {
    const resp = await client.get('/v1/chat-instances');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_instance_create', descriptionFor('aimeat_instance_create'), zodShapeFor('aimeat_instance_create'), annotationsFor('aimeat_instance_create'), async ({ name, model }) => {
    // Same derivation as the node MCP tool: the parameter is a model id, the record's platform is
    // its vendor segment.
    const platform = model ? model.split('-')[0] ?? 'unknown' : 'unknown';
    const resp = await client.post('/v1/chat-instances', { platform, app_name: name });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_instance_status', descriptionFor('aimeat_instance_status'), zodShapeFor('aimeat_instance_status'), annotationsFor('aimeat_instance_status'), async ({ instance_id }) => {
    const resp = await client.get(`/v1/chat-instances/${encodeURIComponent(instance_id)}`);
    return envelopeResult(resp);
  });
}
