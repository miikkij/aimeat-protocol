/**
 * @file apps.ts
 * @description MCP tool registrations for app/package management -- publishing,
 *   listing, retrieving, archiving versions, version history, sanctioned forks, and drafts (staging).
 * @version-history
 *   v1.4.0 -- 2026-08-01 -- TARGET-058 Phase 11b: aimeat_app_get folds meta.provenance.
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_app_publish / aimeat_app_draft_publish
 *     carry `ai_provenance` / `ai_provenance_id` and echo what was recorded.
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
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult, readPayloadWithProvenance } from '../../ai-provenance-carry.js';

export function registerAppsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, owner } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_app_publish', descriptionFor('aimeat_app_publish'), {
    name: z.string().describe('App name'),
    description: z.string().describe('App description'),
    content: z.string().describe('App content'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_app_publish'), async ({ name, description, content, ai_provenance, ai_provenance_id }) => {
    const resp = await client.post('/v1/packages', { name, description, content });
    return provenanceEchoedResult(client,
      { tool: 'aimeat_app_publish', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
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
    // The app detail read serves its record on meta.provenance — see core.ts memory_read.
    return { content: [{ type: 'text' as const, text: JSON.stringify(readPayloadWithProvenance(resp), null, 2) }] };
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

  // → POST /v1/apps/:owner/:filename/draft/write — append a piece of the draft, or replace it.
  //   Plain text rather than base64: the caller is composing HTML, not moving a file.
  mcp.tool('aimeat_app_draft_write', descriptionFor('aimeat_app_draft_write'), {
    filename: z.string().describe('App filename this draft stages (e.g. "pong.html").'),
    content: z.string().describe('The text to write. Plain UTF-8, not base64.'),
    mode: z.enum(['append', 'replace']).optional().describe('append (default) adds to the end; replace overwrites the whole draft.'),
    expected_size_bytes: z.number().int().nonnegative().optional().describe('Refuse unless the draft is currently this many bytes.'),
    name: z.string().optional().describe('Display name (defaults to the live app\'s, or the draft\'s once set).'),
    description: z.string().optional().describe('Description (defaults to the live app\'s, or the draft\'s once set).'),
  }, annotationsFor('aimeat_app_draft_write'), async ({ filename, content, mode, expected_size_bytes, name, description }) => {
    const body: Record<string, unknown> = { content };
    if (mode) body.mode = mode;
    if (expected_size_bytes !== undefined) body.expected_size_bytes = expected_size_bytes;
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    return out(await client.post(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/write`, body));
  });

  // → POST /v1/apps/:owner/:filename/draft/replace — exact old → new inside the draft.
  mcp.tool('aimeat_app_draft_replace', descriptionFor('aimeat_app_draft_replace'), {
    filename: z.string().describe('App filename whose draft to edit.'),
    old_string: z.string().describe('The exact text to replace, including indentation.'),
    new_string: z.string().describe('What to put there instead.'),
    replace_all: z.boolean().optional().describe('Replace every occurrence instead of requiring exactly one. Default false.'),
  }, annotationsFor('aimeat_app_draft_replace'), async ({ filename, old_string, new_string, replace_all }) => {
    const body: Record<string, unknown> = { old_string, new_string };
    if (replace_all) body.replace_all = true;
    return out(await client.post(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/replace`, body));
  });

  // → GET /v1/apps/:owner/:filename/draft/lines — a line range, not the whole slot.
  mcp.tool('aimeat_app_draft_read', descriptionFor('aimeat_app_draft_read'), {
    filename: z.string().describe('App filename whose draft to read.'),
    offset: z.number().int().min(1).optional().describe('First line to return, 1-based. Default 1.'),
    limit: z.number().int().min(1).optional().describe('How many lines to return. Default 400, maximum 2000.'),
  }, annotationsFor('aimeat_app_draft_read'), async ({ filename, offset, limit }) => {
    const qs = new URLSearchParams();
    if (offset !== undefined) qs.set('offset', String(offset));
    if (limit !== undefined) qs.set('limit', String(limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return out(await client.get(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/lines${query}`));
  });

  // → POST /v1/apps/:owner/:filename/draft/seed — copy a published version into the slot.
  mcp.tool('aimeat_app_draft_seed', descriptionFor('aimeat_app_draft_seed'), {
    filename: z.string().describe('The draft slot to write into.'),
    from_filename: z.string().optional().describe('The published app to copy from. Defaults to filename.'),
    version: z.number().int().min(1).optional().describe('Which published version. Defaults to the newest.'),
  }, annotationsFor('aimeat_app_draft_seed'), async ({ filename, from_filename, version }) => {
    const body: Record<string, unknown> = {};
    if (from_filename) body.from_filename = from_filename;
    if (version !== undefined) body.version = version;
    return out(await client.post(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft/seed`, body));
  });

  // → POST /v1/apps/:owner/:filename/publish-draft — promote the draft to a new live version.
  mcp.tool('aimeat_app_draft_publish', descriptionFor('aimeat_app_draft_publish'), {
    filename: z.string().describe('App filename whose draft to publish.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_app_draft_publish'), async ({ filename, ai_provenance, ai_provenance_id }) => {
    const resp = await client.post(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/publish-draft`);
    if (resp.ok === false) return out(resp);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_app_draft_publish', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  // → DELETE /v1/apps/:owner/:filename/draft — discard the draft (live app untouched).
  mcp.tool('aimeat_app_draft_discard', descriptionFor('aimeat_app_draft_discard'), {
    filename: z.string().describe('App filename whose draft to discard.'),
  }, annotationsFor('aimeat_app_draft_discard'), async ({ filename }) => {
    return out(await client.delete(`/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}/draft`));
  });
}
