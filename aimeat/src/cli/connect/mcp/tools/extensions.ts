/**
 * @file extensions.ts
 * @description MCP tool registrations for extension lifecycle management --
 *   listing, installing, invoking actions, activating, deactivating, and deleting.
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

export function registerExtensionsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_extension_list', descriptionFor('aimeat_extension_list'), {}, annotationsFor('aimeat_extension_list'), async () => {
    const resp = await client.get('/v1/extensions');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_invoke', descriptionFor('aimeat_extension_invoke'), {
    name: z.string().describe('Extension name'),
    action_id: z.string().describe('Action identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters'),
  }, annotationsFor('aimeat_extension_invoke'), async ({ name, action_id, input }) => {
    const resp = await client.post(
      `/v1/ext/${encodeURIComponent(name)}/${encodeURIComponent(action_id)}`,
      input ?? {},
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_install', descriptionFor('aimeat_extension_install'), {
    name: z.string().describe('Extension name'),
    manifest: z.record(z.string(), z.unknown()).describe('Extension manifest object'),
  }, annotationsFor('aimeat_extension_install'), async ({ name, manifest }) => {
    const resp = await client.post('/v1/extensions', { name, manifest });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_activate', descriptionFor('aimeat_extension_activate'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_activate'), async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/activate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_deactivate', descriptionFor('aimeat_extension_deactivate'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_deactivate'), async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/deactivate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_delete', descriptionFor('aimeat_extension_delete'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_delete'), async ({ name }) => {
    const resp = await client.delete(`/v1/extensions/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_get', descriptionFor('aimeat_extension_get'), {
    name: z.string().describe('Extension name'),
  }, annotationsFor('aimeat_extension_get'), async ({ name }) => {
    const resp = await client.get(`/v1/extensions/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
