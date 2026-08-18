/**
 * @file core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Core MCP tool registrations for memory, catalogue, work, wallet,
 *   boards, storage, and admin endpoints. These cover the most commonly used
 *   AIMEAT API surface.
 * @structure
 *   - registerCoreTools() -- Registers core REST-backed connector MCP tools
 * @version-history
 *   v1.10.0 -- 2026-08-16 -- owner_scope on memory_read and memory_write, limit on memory_search.
 *     All three existed on the server MCP tool and on the REST route and were undeclared here, so
 *     zod dropped them. Measured cost: a crew's public mirror read only its own namespace for weeks
 *     while its job was to copy six agents' writes, and every connector write landed under the agent
 *     however the caller meant it. A dropped permission flag comes back as NOT_FOUND, which is the
 *     one shape nobody debugs by looking for a missing scope.
 *   v1.9.0 -- 2026-08-15 -- aimeat_storage_delete, so the connector surface does not lag the node.
 *   v1.0.0 -- 2026-05-28 -- Initial connector MCP core tools
 *   v1.1.0 -- 2026-05-28 -- Add memory tags and owner-scope listing support
 *   v1.2.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.3.0 -- 2026-05-29 -- Per-call agent routing via pickAgent (was: always primary
 *     agent's client at module scope). Fixes AUTH_REQUIRED for multi-agent installs
 *     where the LLM passes agent_name="company-crew" but core tools silently routed
 *     through whoever the connector picked as primary at startup.
 *   v1.4.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.5.0 -- 2026-05-30 -- MCP audit Phase 1 (F5): read tools (memory_read/list, catalogue_search,
 *     work_inbox, board_read) accept response_format and shape REST payloads via shared shapeResponse().
 *   v1.6.0 -- 2026-05-30 -- F10 drift reconciliation: align connector core tool inputs with server MCP +
 *     REST (catalogue_search search/category; memory_write group_id+ttl_hours; memory_search visibility;
 *     board read/post/create/subscribe filters; work_deliver output; message_send content; storage_upload).
 *   v1.8.0 -- 2026-08-01 -- TARGET-058 Phase 11b: aimeat_memory_read folds meta.provenance, so a
 *     crew reading its own content back gets the record and not just an id it cannot resolve.
 *   v1.7.0 -- 2026-08-01 -- TARGET-058 Phase 11: memory_write and board_post carry `ai_provenance` /
 *     `ai_provenance_id`. The catalog had advertised both since Phase 4 while these shapes stripped
 *     them as unknown keys, so a crew's declaration vanished behind an ok:true.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema } from '../../../../mcp/catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { carrierAttach, provenanceEchoedResult, readPayloadWithProvenance } from '../../ai-provenance-carry.js';
import { agentNameSchema, pickAgent } from './_registry.js';

export function registerCoreTools(mcp: McpServer, registry: AgentRegistry): void {
  // ── Memory ──────────────────────────────────────────────────────────

  mcp.tool('aimeat_memory_read', descriptionFor('aimeat_memory_read'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Memory entry key'),
    // MEASURED IN PRODUCTION BEFORE THIS EXISTED. A crew's public mirror, whose whole job was to
    // copy six agents' writes, had only ever seen its own namespace: aimeat_memory_read came back
    // NOT_FOUND while GET /v1/memory/<key>?owner_scope=true returned 455 kB of the same record. The
    // route had honoured the flag all along; this surface had no way to send it, and a dropped
    // permission parameter looks exactly like a missing key, so nobody thinks to check a scope.
    owner_scope: z.boolean().optional().describe("Also look in the OWNER's namespace and your sibling agents', not only your own. The node decides whether you may: this only asks."),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_memory_read'), async ({ agent_name, key, owner_scope, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/memory/${encodeURIComponent(key)}${owner_scope ? '?owner_scope=true' : ''}`);
    // readPayloadWithProvenance, not `resp.data ?? resp`: this route serves the record on the
    // ENVELOPE carrier (meta.provenance), and the plain unwrap threw the envelope away — so a crew
    // reading its own content back got the id and no statement. TARGET-058 Phase 11b.
    return jsonContent(shapeResponse('aimeat_memory_read', response_format, readPayloadWithProvenance(resp)));
  });

  mcp.tool('aimeat_memory_write', descriptionFor('aimeat_memory_write'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Memory entry key'),
    value: z.unknown().describe('Value to store'),
    visibility: z.string().optional().describe('Visibility level (default: private)'),
    group_id: z.string().optional().describe('ID of sharing group (required for group visibility)'),
    tags: z.array(z.string()).optional().describe('Optional tags for filtering/shared areas'),
    ttl_hours: z.number().optional().describe('Time-to-live in hours'),
    // The write half of the same hole. Without this every write through the connector landed in the
    // AGENT's namespace, whatever the caller meant, and the owner's own tools then could not see it.
    // Requires the memory:write-as-owner scope, which the owner grants per agent and the ROUTE
    // enforces — resolveWriteTarget() refuses without it, so sending the flag can only ask.
    owner_scope: z.boolean().optional().describe("Write under the OWNER instead of yourself, so the owner's own tools read it as theirs. Needs the memory:write-as-owner scope. Without this the write lands in your own namespace, as before. Separate from `visibility`: where a record lives and who may read it are different questions."),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_memory_write'), async ({ agent_name, key, value, visibility, group_id, tags, ttl_hours, owner_scope, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { key, value };
    if (visibility) body.visibility = visibility;
    if (group_id) body.group_id = group_id;
    if (tags) body.tags = tags;
    if (ttl_hours !== undefined) body.ttl_hours = ttl_hours;
    if (owner_scope) body.owner_scope = true;
    // An id the node already minted travels in the write body itself — POST /v1/memory takes
    // `ai_provenance_id` and checks it belongs to this owner. An inline DECLARATION cannot: the
    // route has no field for it, so it is recorded after the write, against this key, by
    // carryDeclaration(). See ai-provenance-carry.ts for why that order and not the other one.
    if (ai_provenance_id) body.ai_provenance_id = ai_provenance_id;
    const resp = await client.post('/v1/memory', body);
    if (!resp.ok) return { content: [{ type: 'text' as const, text: JSON.stringify(resp, null, 2) }] };
    return provenanceEchoedResult(client, {
      tool: 'aimeat_memory_write',
      declared: ai_provenance,
      declaredId: ai_provenance_id,
      attach: carrierAttach('aimeat_memory_write', { key, value }),
    }, resp);
  });

  mcp.tool('aimeat_memory_list', descriptionFor('aimeat_memory_list'), {
    agent_name: agentNameSchema,
    prefix: z.string().optional().describe('Key prefix filter'),
    visibility: z.string().optional().describe('Optional visibility filter'),
    tags: z.array(z.string()).optional().describe('Optional tag filters'),
    owner_scope: z.boolean().optional().describe('When true, list same-owner GHII and agent memory'),
    limit: z.number().optional().describe('Maximum entries to return'),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_memory_list'), async ({ agent_name, prefix, visibility, tags, owner_scope, limit, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (visibility) params.set('visibility', visibility);
    if (tags?.length) params.set('tags', tags.join(','));
    if (owner_scope) params.set('owner_scope', 'true');
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const resp = await client.get(`/v1/memory${qs ? `?${qs}` : ''}`);
    return jsonContent(shapeResponse('aimeat_memory_list', response_format, resp.data ?? resp));
  });

  mcp.tool('aimeat_memory_search', descriptionFor('aimeat_memory_search'), {
    agent_name: agentNameSchema,
    query: z.string().describe('Search query'),
    visibility: z.string().optional().describe('Optional visibility filter'),
    limit: z.number().optional().describe('Max hits to return (default 50, cap 200).'),
  }, annotationsFor('aimeat_memory_search'), async ({ agent_name, query, visibility, limit }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams({ q: query });
    if (visibility) params.set('visibility', visibility);
    if (limit !== undefined) params.set('limit', String(limit));
    const resp = await client.get(`/v1/memory/search?${params.toString()}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Catalogue ───────────────────────────────────────────────────────

  mcp.tool('aimeat_catalogue_search', descriptionFor('aimeat_catalogue_search'), {
    agent_name: agentNameSchema,
    search: z.string().optional().describe('Free-text search (name/description/GAII)'),
    category: z.string().optional().describe('Filter by capability category'),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_catalogue_search'), async ({ agent_name, search, category, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/catalogue${qs}`);
    return jsonContent(shapeResponse('aimeat_catalogue_search', response_format, resp.data ?? resp));
  });

  // ── Master directory (cross-domain discovery) ───────────────────────

  mcp.tool('aimeat_discover', descriptionFor('aimeat_discover'), {
    agent_name: agentNameSchema,
    mode: z.enum(['map', 'find']).optional().describe('"find" (default) returns entries; "map" returns only facet counts'),
    q: z.string().optional().describe('Free-text query; omit to browse by filters'),
    type: z.string().optional().describe('CSV of types to include'),
    tags: z.string().optional().describe('CSV of tags; an entry must carry ALL'),
    segment: z.string().optional().describe('CSV of segments to include'),
    scope: z.enum(['own', 'public', 'shared']).optional().describe('own (default), public, or shared'),
    limit: z.number().optional().describe('Max entries (default 20, max 100)'),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_discover'), async ({ agent_name, mode, q, type, tags, segment, scope, limit, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (type) params.set('type', type);
    if (tags) params.set('tags', tags);
    if (segment) params.set('segment', segment);
    if (scope) params.set('scope', scope);
    if (typeof limit === 'number') params.set('per_page', String(limit));
    const qs2 = params.toString() ? `?${params.toString()}` : '';
    if (mode === 'map') {
      const resp = await client.get(`/v1/discover/facets${qs2}`);
      return jsonContent(resp.data ?? resp);
    }
    const resp = await client.get(`/v1/discover${qs2}`);
    return jsonContent(shapeResponse('aimeat_discover', response_format, resp.data ?? resp));
  });

  // ── Agent profile ──────────────────────────────────────────────────

  mcp.tool(
    'aimeat_agents_list',
    descriptionFor('aimeat_agents_list'),
    {
      agent_name: agentNameSchema,
    },
    annotationsFor('aimeat_agents_list'),
    async ({ agent_name }) => {
      const { client } = pickAgent(registry, agent_name);
      const resp = await client.get('/v1/agents');
      return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
    },
  );

  mcp.tool('aimeat_agent_profile', descriptionFor('aimeat_agent_profile'), {
    agent_name: agentNameSchema,
    gaii: z.string().describe('Agent GAII identifier'),
  }, annotationsFor('aimeat_agent_profile'), async ({ agent_name, gaii }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/agents/${encodeURIComponent(gaii)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Work ────────────────────────────────────────────────────────────

  mcp.tool('aimeat_action_execute', descriptionFor('aimeat_action_execute'), {
    agent_name: agentNameSchema,
    action_id: z.string().describe('Action identifier'),
    provider_gaii: z.string().describe('GAII of the provider offering this action (required to route + escrow)'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters for the action'),
    ttl_hours: z.number().optional().describe('Hours before the work request expires (default 24)'),
  }, annotationsFor('aimeat_action_execute'), async ({ agent_name, action_id, provider_gaii, input, ttl_hours }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { action_id, provider_gaii, input: input ?? {} };
    if (ttl_hours !== undefined) body.ttl_hours = ttl_hours;
    const resp = await client.post('/v1/work/request', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_work_inbox', descriptionFor('aimeat_work_inbox'), {
    agent_name: agentNameSchema,
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_work_inbox'), async ({ agent_name, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/work/inbox');
    return jsonContent(shapeResponse('aimeat_work_inbox', response_format, resp.data ?? resp));
  });

  mcp.tool('aimeat_work_accept', descriptionFor('aimeat_work_accept'), {
    agent_name: agentNameSchema,
    tracking_code: z.string().describe('Work item tracking code'),
  }, annotationsFor('aimeat_work_accept'), async ({ agent_name, tracking_code }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.post(`/v1/work/${encodeURIComponent(tracking_code)}/accept`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_work_deliver', descriptionFor('aimeat_work_deliver'), {
    agent_name: agentNameSchema,
    tracking_code: z.string().describe('Work item tracking code'),
    output: z.unknown().describe('Delivery payload (the work result)'),
    metadata: z.unknown().optional().describe('Optional delivery metadata'),
  }, annotationsFor('aimeat_work_deliver'), async ({ agent_name, tracking_code, output, metadata }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { output };
    if (metadata !== undefined) body.metadata = metadata;
    const resp = await client.post(`/v1/work/${encodeURIComponent(tracking_code)}/deliver`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Wallet ──────────────────────────────────────────────────────────

  mcp.tool('aimeat_wallet_balance', descriptionFor('aimeat_wallet_balance'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_wallet_balance'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/wallet');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Boards (basic read/post) ────────────────────────────────────────

  mcp.tool('aimeat_board_read', descriptionFor('aimeat_board_read'), {
    agent_name: agentNameSchema,
    board_id: z.string().describe('Board identifier'),
    category: z.string().optional().describe('Filter posts by category'),
    limit: z.number().optional().describe('Maximum posts to return (default 20)'),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_board_read'), async ({ agent_name, board_id, category, limit, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/boards/${encodeURIComponent(board_id)}/posts${qs}`);
    return jsonContent(shapeResponse('aimeat_board_read', response_format, resp.data ?? resp));
  });

  mcp.tool('aimeat_board_post', descriptionFor('aimeat_board_post'), {
    agent_name: agentNameSchema,
    board_id: z.string().describe('Board identifier'),
    title: z.string().describe('Post title'),
    body: z.string().describe('Post body'),
    category: z.string().optional().describe('Optional post category'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_board_post'), async ({ agent_name, board_id, title, body, category, ai_provenance, ai_provenance_id }) => {
    const { client } = pickAgent(registry, agent_name);
    const reqBody: Record<string, unknown> = { title, body };
    if (category) reqBody.category = category;
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/posts`, reqBody);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_board_post', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  // ── Storage ─────────────────────────────────────────────────────────

  mcp.tool('aimeat_storage_upload', descriptionFor('aimeat_storage_upload'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Storage key'),
    data_base64: z.string().describe('Base64-encoded file data'),
    mime_type: z.string().optional().describe('MIME type of the file'),
    visibility: z.string().optional().describe('Access control (default: private)'),
    group_id: z.string().optional().describe('ID of sharing group (required for group visibility)'),
  }, annotationsFor('aimeat_storage_upload'), async ({ agent_name, key, data_base64, mime_type, visibility, group_id }) => {
    const { client } = pickAgent(registry, agent_name);
    // REST POST /v1/storage reads the base64 payload as `data`.
    const body: Record<string, unknown> = { key, data: data_base64 };
    if (mime_type) body.mime_type = mime_type;
    if (visibility) body.visibility = visibility;
    if (group_id) body.group_id = group_id;
    const resp = await client.post('/v1/storage', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_storage_download', descriptionFor('aimeat_storage_download'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Storage key in the agent\'s own namespace, or a full "owner@node/key" reference.'),
    owner: z.string().optional().describe('GHII/GAII that owns the file. Omit for the agent\'s own files; set it for the owner\'s uploads and for DM/task attachments.'),
    inline: z.boolean().optional().describe('Only for small text files (<= 32 KB): return content inline. Binaries always return a download handle, never base64 in context.'),
  }, annotationsFor('aimeat_storage_download'), async ({ agent_name, key, owner, inline }) => {
    const { client } = pickAgent(registry, agent_name);
    // F11: never pull raw bytes through the model context — request a handle (presigned
    // download_url + metadata), or inline only for small text files.
    const mode = inline ? 'inline' : 'handle';
    // Two doors, by design: /v1/storage reads the agent's OWN namespace, /v1/pub reads a file
    // someone else owns through the consent/visibility guard. A bare key with an owner-shaped
    // head ("alice@node/report.pdf") is treated as a reference, matching the server tool.
    const slash = key.indexOf('/');
    const head = slash > 0 ? key.slice(0, slash) : '';
    const refOwner = owner ?? (head.includes('@') || head.startsWith('ext:') ? head : '');
    const refKey = owner ? key : (refOwner ? key.slice(slash + 1) : key);
    const path = refOwner
      ? `/v1/pub/${encodeURIComponent(refOwner)}/${refKey.split('/').map(encodeURIComponent).join('/')}?mode=handle`
      : `/v1/storage/${encodeURIComponent(refKey)}?mode=${mode}`;
    const resp = await client.get(path);
    return jsonContent(resp.data ?? resp);
  });

  mcp.tool('aimeat_datapackage_publish', descriptionFor('aimeat_datapackage_publish'), {
    agent_name: agentNameSchema,
    name: z.string().describe('Package name: lowercase letters, digits and dashes. It becomes part of the permanent URL.'),
    changes: z.string().describe('REQUIRED. What changed against the previous version and why.'),
    resources: z.array(z.record(z.string(), z.unknown())).describe('One or more { name, rows, schema?, title?, description? }.'),
    title: z.string().optional(),
    description: z.string().optional(),
    license: z.string().optional(),
    sources: z.array(z.record(z.string(), z.unknown())).optional(),
    legal_basis: z.string().optional(),
    // Crews publish through the connector, so the declaration has to exist HERE too — the node
    // surface being right does not help a caller that never touches it.
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_datapackage_publish'), async ({ agent_name, ...body }) => {
    const { client } = pickAgent(registry, agent_name);
    // Straight through: the quality gate, the content hash and the address all live on the node, and
    // a refusal comes back with the row and the column rather than a verdict.
    const resp = await client.post('/v1/datapackages', body as Record<string, unknown>);
    return jsonContent(resp.data ?? resp);
  });

  mcp.tool('aimeat_datapackage_export', descriptionFor('aimeat_datapackage_export'), {
    agent_name: agentNameSchema,
    ref: z.string().describe('pkg:owner/name, optionally @sha256:... to pin a version.'),
    resource: z.string().describe('Which resource of the package.'),
    format: z.enum(['url', 'csv', 'json']).optional().describe('url (default) = the permanent CSV address. csv/json = a window of rows inline.'),
    limit: z.number().optional(),
    offset: z.number().optional(),
    select: z.array(z.string()).optional(),
  }, annotationsFor('aimeat_datapackage_export'), async ({ agent_name, ref, resource, format, limit, offset, select }) => {
    const { client } = pickAgent(registry, agent_name);
    const m = /^pkg:([^/@]+)\/([^@]+)(?:@(sha256:[a-f0-9]{64}))?$/.exec(ref);
    if (!m) return jsonContent({ error: 'ref must look like "pkg:owner/name" or "pkg:owner/name@sha256:..."' });
    const [, owner, name, version] = m;
    const base = `/v1/datapackages/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const qs: string[] = [];
    if (version) qs.push(`version=${encodeURIComponent(version)}`);
    // 'url' is the default because handing over the permanent address costs one small response,
    // while pulling the table through the model context is slow, billed and usually unnecessary.
    if ((format ?? 'url') === 'url') {
      const resp = await client.get(base + (qs.length ? `?${qs.join('&')}` : ''));
      return jsonContent(resp.data ?? resp);
    }
    if (limit !== undefined) qs.push(`limit=${encodeURIComponent(limit)}`);
    if (offset !== undefined) qs.push(`offset=${encodeURIComponent(offset)}`);
    if (select?.length) qs.push(`select=${encodeURIComponent(select.join(','))}`);
    const resp = await client.get(`${base}/rows/${encodeURIComponent(resource)}${qs.length ? `?${qs.join('&')}` : ''}`);
    return jsonContent(resp.data ?? resp);
  });

  mcp.tool('aimeat_storage_delete', descriptionFor('aimeat_storage_delete'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Storage key in the agent\'s own namespace. Only the agent\'s own files can be deleted.'),
  }, annotationsFor('aimeat_storage_delete'), async ({ agent_name, key }) => {
    const { client } = pickAgent(registry, agent_name);
    // One door, unlike the download above: /v1/storage is namespaced to the caller, and there is no
    // /v1/pub form for a delete because reading someone else's file is allowed and removing it is not.
    const resp = await client.delete(`/v1/storage/${key.split('/').map(encodeURIComponent).join('/')}`);
    return jsonContent(resp.data ?? resp);
  });

  // ── Admin ───────────────────────────────────────────────────────────
  // Admin endpoints require operator role -- the agent_name parameter routes
  // through that agent's token but the SERVER still rejects unless the agent
  // has operator scope. Documented here so the param isn't misread as
  // "operator masquerade".

  mcp.tool('aimeat_admin_stats', descriptionFor('aimeat_admin_stats'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_admin_stats'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/admin/stats');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_admin_agents', descriptionFor('aimeat_admin_agents'), {
    agent_name: agentNameSchema,
    limit: z.number().optional().describe('Maximum number of agents to return'),
  }, annotationsFor('aimeat_admin_agents'), async ({ agent_name, limit }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/admin/agents');
    // REST returns all agents; apply the limit client-side to match the server MCP tool.
    const data = (resp.data ?? resp) as { agents?: unknown[] };
    if (limit !== undefined && Array.isArray(data.agents)) {
      data.agents = data.agents.slice(0, limit);
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
  });

  mcp.tool('aimeat_admin_config', descriptionFor('aimeat_admin_config'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_admin_config'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/admin/config');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
