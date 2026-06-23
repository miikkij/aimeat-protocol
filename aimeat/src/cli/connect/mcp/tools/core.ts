/**
 * @file core.ts
 * @description Core MCP tool registrations for memory, catalogue, work, wallet,
 *   boards, storage, and admin endpoints. These cover the most commonly used
 *   AIMEAT API surface.
 * @structure
 *   - registerCoreTools() -- Registers core REST-backed connector MCP tools
 * @version-history
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
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor, shapeResponse, jsonContent, responseFormatSchema } from '../../../../mcp/catalog/shape.js';
import { agentNameSchema, pickAgent } from './_registry.js';

export function registerCoreTools(mcp: McpServer, registry: AgentRegistry): void {
  // ── Memory ──────────────────────────────────────────────────────────

  mcp.tool('aimeat_memory_read', descriptionFor('aimeat_memory_read'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Memory entry key'),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_memory_read'), async ({ agent_name, key, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/memory/${encodeURIComponent(key)}`);
    return jsonContent(shapeResponse('aimeat_memory_read', response_format, resp.data ?? resp));
  });

  mcp.tool('aimeat_memory_write', descriptionFor('aimeat_memory_write'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Memory entry key'),
    value: z.unknown().describe('Value to store'),
    visibility: z.string().optional().describe('Visibility level (default: private)'),
    group_id: z.string().optional().describe('ID of sharing group (required for group visibility)'),
    tags: z.array(z.string()).optional().describe('Optional tags for filtering/shared areas'),
    ttl_hours: z.number().optional().describe('Time-to-live in hours'),
  }, annotationsFor('aimeat_memory_write'), async ({ agent_name, key, value, visibility, group_id, tags, ttl_hours }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { key, value };
    if (visibility) body.visibility = visibility;
    if (group_id) body.group_id = group_id;
    if (tags) body.tags = tags;
    if (ttl_hours !== undefined) body.ttl_hours = ttl_hours;
    const resp = await client.post('/v1/memory', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
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
  }, annotationsFor('aimeat_memory_search'), async ({ agent_name, query, visibility }) => {
    const { client } = pickAgent(registry, agent_name);
    const params = new URLSearchParams({ q: query });
    if (visibility) params.set('visibility', visibility);
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
  }, annotationsFor('aimeat_board_post'), async ({ agent_name, board_id, title, body, category }) => {
    const { client } = pickAgent(registry, agent_name);
    const reqBody: Record<string, unknown> = { title, body };
    if (category) reqBody.category = category;
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/posts`, reqBody);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
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
    key: z.string().describe('Storage key'),
    inline: z.boolean().optional().describe('Only for small text files (<= 32 KB): return content inline. Binaries always return a download handle, never base64 in context.'),
  }, annotationsFor('aimeat_storage_download'), async ({ agent_name, key, inline }) => {
    const { client } = pickAgent(registry, agent_name);
    // F11: never pull raw bytes through the model context — request a handle (presigned
    // download_url + metadata), or inline only for small text files.
    const mode = inline ? 'inline' : 'handle';
    const resp = await client.get(`/v1/storage/${encodeURIComponent(key)}?mode=${mode}`);
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
