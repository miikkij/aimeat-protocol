/**
 * @file cortex.ts
 * @description MCP tool registrations for cortex model lifecycle -- listing,
 *   installing, activating, deactivating, and deleting cortex models.
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

export function registerCortexTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_cortex_list', descriptionFor('aimeat_cortex_list'), {}, annotationsFor('aimeat_cortex_list'), async () => {
    const resp = await client.get('/v1/cortex');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_install', descriptionFor('aimeat_cortex_install'), {
    name: z.string().describe('Cortex name'),
    manifest: z.record(z.string(), z.unknown()).describe('Cortex manifest object'),
  }, annotationsFor('aimeat_cortex_install'), async ({ name, manifest }) => {
    const resp = await client.post('/v1/cortex', { name, manifest });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_activate', descriptionFor('aimeat_cortex_activate'), {
    name: z.string().describe('Cortex name'),
  }, annotationsFor('aimeat_cortex_activate'), async ({ name }) => {
    const resp = await client.post(`/v1/cortex/${encodeURIComponent(name)}/activate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_deactivate', descriptionFor('aimeat_cortex_deactivate'), {
    name: z.string().describe('Cortex name'),
  }, annotationsFor('aimeat_cortex_deactivate'), async ({ name }) => {
    const resp = await client.post(`/v1/cortex/${encodeURIComponent(name)}/deactivate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_delete', descriptionFor('aimeat_cortex_delete'), {
    name: z.string().describe('Cortex name'),
  }, annotationsFor('aimeat_cortex_delete'), async ({ name }) => {
    const resp = await client.delete(`/v1/cortex/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
