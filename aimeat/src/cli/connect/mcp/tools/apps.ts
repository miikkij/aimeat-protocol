/**
 * @file apps.ts
 * @description MCP tool registrations for app/package management -- publishing,
 *   listing, retrieving, archiving versions, version history, sanctioned forks, and drafts (staging).
 * @version-history
 *   v1.2.0 -- 2026-07-19 -- Connector reachability: add aimeat_app_fork + app draft save/publish/discard
 *     (thin proxies to /v1/apps/:owner/:filename/fork | /draft | /publish-draft).
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
  const { client, owner } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

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

  // → POST /v1/apps/:owner/:filename/fork — sanctioned, provenance-recording fork (behind the forkable/paid gates).
  mcp.tool('aimeat_app_fork', descriptionFor('aimeat_app_fork'), {
    owner: z.string().describe('Owner name of the source app.'),
    filename: z.string().describe('Filename of the source app.'),
    new_filename: z.string().describe('Filename for the fork in your catalogue.'),
    version: z.number().int().positive().optional().describe('Source version to fork (default: latest).'),
  }, annotationsFor('aimeat_app_fork'), async ({ owner: srcOwner, filename, new_filename, version }) => {
    const body: Record<string, unknown> = { new_filename };
    if (version !== undefined) body.version = version;
    return out(await client.post(`/v1/apps/${encodeURIComponent(srcOwner)}/${encodeURIComponent(filename)}/fork`, body));
  });

  // → PUT /v1/apps/:owner/:filename/draft — stage the next version (owner resolved server-side).
  mcp.tool('aimeat_app_draft_save', descriptionFor('aimeat_app_draft_save'), {
    filename: z.string().describe('App filename, e.g. "shop.html".'),
    content: z.string().describe('Base64-encoded HTML of the draft.'),
    name: z.string().optional().describe('Display name (defaults to the live app\'s).'),
    description: z.string().optional().describe('Description (defaults to the live app\'s).'),
    category: z.string().optional().describe('Category (defaults to the live app\'s).'),
    tags: z.array(z.string()).optional().describe('Tags (default: the live app\'s).'),
    icon: z.string().optional().describe('Emoji icon (defaults to the live app\'s).'),
  }, annotationsFor('aimeat_app_draft_save'), async ({ filename, content, name, description, category, tags, icon }) => {
    const body: Record<string, unknown> = { content };
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    if (category) body.category = category;
    if (tags) body.tags = tags;
    if (icon) body.icon = icon;
    return out(await client.put(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft`, body));
  });

  // → POST /v1/apps/:owner/:filename/publish-draft — promote the draft to a new live version.
  mcp.tool('aimeat_app_draft_publish', descriptionFor('aimeat_app_draft_publish'), {
    filename: z.string().describe('App filename whose draft to publish.'),
  }, annotationsFor('aimeat_app_draft_publish'), async ({ filename }) => {
    return out(await client.post(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/publish-draft`));
  });

  // → DELETE /v1/apps/:owner/:filename/draft — discard the draft (live app untouched).
  mcp.tool('aimeat_app_draft_discard', descriptionFor('aimeat_app_draft_discard'), {
    filename: z.string().describe('App filename whose draft to discard.'),
  }, annotationsFor('aimeat_app_draft_discard'), async ({ filename }) => {
    return out(await client.delete(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft`));
  });
}
