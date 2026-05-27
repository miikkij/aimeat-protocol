/**
 * @file apps.ts
 * @description MCP tool registrations for app/package management -- publishing,
 *   listing, retrieving, archiving versions, and version history.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerAppsTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_app_publish', 'Publish an app package', {
    name: z.string().describe('App name'),
    description: z.string().describe('App description'),
    content: z.string().describe('App content'),
  }, async ({ name, description, content }) => {
    const resp = await client.post('/v1/packages', { name, description, content });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_list', 'List available apps', {
    query: z.string().optional().describe('Search query'),
  }, async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/packages${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_get', 'Get app detail by group ID', {
    group_id: z.string().describe('App group identifier'),
  }, async ({ group_id }) => {
    const resp = await client.get(`/v1/packages/${encodeURIComponent(group_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_delete', 'Archive an app version', {
    group_id: z.string().describe('App group identifier'),
    version: z.string().describe('Version to archive'),
  }, async ({ group_id, version }) => {
    const resp = await client.delete(
      `/v1/packages/${encodeURIComponent(group_id)}/versions/${encodeURIComponent(version)}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_versions', 'List app version history', {
    group_id: z.string().describe('App group identifier'),
  }, async ({ group_id }) => {
    const resp = await client.get(`/v1/packages/${encodeURIComponent(group_id)}/versions`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
