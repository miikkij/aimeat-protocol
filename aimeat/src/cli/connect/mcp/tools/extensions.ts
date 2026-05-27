/**
 * @file extensions.ts
 * @description MCP tool registrations for extension lifecycle management --
 *   listing, installing, invoking actions, activating, deactivating, and deleting.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerExtensionsTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_extension_list', 'List installed extensions', {}, async () => {
    const resp = await client.get('/v1/extensions');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_invoke', 'Invoke an extension action', {
    name: z.string().describe('Extension name'),
    action_id: z.string().describe('Action identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters'),
  }, async ({ name, action_id, input }) => {
    const resp = await client.post(
      `/v1/ext/${encodeURIComponent(name)}/${encodeURIComponent(action_id)}`,
      input ?? {},
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_install', 'Install an extension from a manifest', {
    name: z.string().describe('Extension name'),
    manifest: z.record(z.string(), z.unknown()).describe('Extension manifest object'),
  }, async ({ name, manifest }) => {
    const resp = await client.post('/v1/extensions', { name, manifest });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_activate', 'Activate an installed extension', {
    name: z.string().describe('Extension name'),
  }, async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/activate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_deactivate', 'Deactivate an extension', {
    name: z.string().describe('Extension name'),
  }, async ({ name }) => {
    const resp = await client.post(`/v1/extensions/${encodeURIComponent(name)}/deactivate`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_delete', 'Uninstall an extension', {
    name: z.string().describe('Extension name'),
  }, async ({ name }) => {
    const resp = await client.delete(`/v1/extensions/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_extension_get', 'Get extension details', {
    name: z.string().describe('Extension name'),
  }, async ({ name }) => {
    const resp = await client.get(`/v1/extensions/${encodeURIComponent(name)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
