/**
 * @file cortex.ts
 * @description MCP tool registrations for cortex model lifecycle -- listing,
 *   installing, activating, deactivating, and deleting cortex models.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerCortexTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_cortex_list', 'List installed cortex models', {}, async () => {
    const resp = await client.get('/v1/cortex');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_install', 'Install a cortex model from a manifest', {
    name: z.string().describe('Cortex name'),
    manifest: z.record(z.string(), z.unknown()).describe('Cortex manifest object'),
  }, async ({ name, manifest }) => {
    const resp = await client.post('/v1/cortex', { name, manifest });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_activate', 'Activate a cortex model', {
    name: z.string().describe('Cortex name'),
  }, async ({ name }) => {
    const resp = await client.post(`/v1/cortex/${encodeURIComponent(name)}/activate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_deactivate', 'Deactivate a cortex model', {
    name: z.string().describe('Cortex name'),
  }, async ({ name }) => {
    const resp = await client.post(`/v1/cortex/${encodeURIComponent(name)}/deactivate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_cortex_delete', 'Delete a cortex model', {
    name: z.string().describe('Cortex name'),
  }, async ({ name }) => {
    const resp = await client.delete(`/v1/cortex/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
