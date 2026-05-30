/**
 * @file cortex.ts
 * @description MCP tool registrations for cortex model lifecycle -- listing,
 *   installing, activating, deactivating, and deleting cortex models.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: cortex_install now takes manifest (YAML string) + libs
 *     map to match REST (connector was sending name + manifest object the route rejects).
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
    manifest: z.string().describe('Cortex manifest in YAML format'),
    libs: z.record(z.string(), z.string()).optional().describe('Map of filename to JavaScript source code for lib files'),
  }, annotationsFor('aimeat_cortex_install'), async ({ manifest, libs }) => {
    const body: Record<string, unknown> = { manifest };
    if (libs) body.libs = libs;
    const resp = await client.post('/v1/cortex', body);
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
