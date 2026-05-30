/**
 * @file apps.ts
 * @description MCP tool registrations for app/package management -- publishing,
 *   listing, retrieving, archiving versions, and version history.
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

export function registerAppsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_app_publish', descriptionFor('aimeat_app_publish'), {
    name: z.string().describe('App name'),
    description: z.string().describe('App description'),
    content: z.string().describe('App content'),
  }, annotationsFor('aimeat_app_publish'), async ({ name, description, content }) => {
    const resp = await client.post('/v1/packages', { name, description, content });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_list', descriptionFor('aimeat_app_list'), {
    query: z.string().optional().describe('Search query'),
  }, annotationsFor('aimeat_app_list'), async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/packages${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_get', descriptionFor('aimeat_app_get'), {
    group_id: z.string().describe('App group identifier'),
  }, annotationsFor('aimeat_app_get'), async ({ group_id }) => {
    const resp = await client.get(`/v1/packages/${encodeURIComponent(group_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_delete', descriptionFor('aimeat_app_delete'), {
    group_id: z.string().describe('App group identifier'),
    version: z.string().describe('Version to archive'),
  }, annotationsFor('aimeat_app_delete'), async ({ group_id, version }) => {
    const resp = await client.delete(
      `/v1/packages/${encodeURIComponent(group_id)}/versions/${encodeURIComponent(version)}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_app_versions', descriptionFor('aimeat_app_versions'), {
    group_id: z.string().describe('App group identifier'),
  }, annotationsFor('aimeat_app_versions'), async ({ group_id }) => {
    const resp = await client.get(`/v1/packages/${encodeURIComponent(group_id)}/versions`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
