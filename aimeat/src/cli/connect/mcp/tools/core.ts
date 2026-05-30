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
    tags: z.array(z.string()).optional().describe('Optional tags for filtering/shared areas'),
    ttl_hours: z.number().optional().describe('Time-to-live in hours'),
  }, annotationsFor('aimeat_memory_write'), async ({ agent_name, key, value, visibility, tags, ttl_hours }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { key, value };
    if (visibility) body.visibility = visibility;
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
  }, annotationsFor('aimeat_memory_search'), async ({ agent_name, query }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/memory/search?q=${encodeURIComponent(query)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Catalogue ───────────────────────────────────────────────────────

  mcp.tool('aimeat_catalogue_search', descriptionFor('aimeat_catalogue_search'), {
    agent_name: agentNameSchema,
    query: z.string().optional().describe('Search query'),
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_catalogue_search'), async ({ agent_name, query, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/catalogue${qs}`);
    return jsonContent(shapeResponse('aimeat_catalogue_search', response_format, resp.data ?? resp));
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
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters for the action'),
  }, annotationsFor('aimeat_action_execute'), async ({ agent_name, action_id, input }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { action_id };
    if (input) body.input = input;
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
    result: z.unknown().describe('Delivery payload'),
  }, annotationsFor('aimeat_work_deliver'), async ({ agent_name, tracking_code, result }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.post(`/v1/work/${encodeURIComponent(tracking_code)}/deliver`, { result });
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
    response_format: responseFormatSchema,
  }, annotationsFor('aimeat_board_read'), async ({ agent_name, board_id, response_format }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/boards/${encodeURIComponent(board_id)}/posts`);
    return jsonContent(shapeResponse('aimeat_board_read', response_format, resp.data ?? resp));
  });

  mcp.tool('aimeat_board_post', descriptionFor('aimeat_board_post'), {
    agent_name: agentNameSchema,
    board_id: z.string().describe('Board identifier'),
    title: z.string().describe('Post title'),
    body: z.string().describe('Post body'),
  }, annotationsFor('aimeat_board_post'), async ({ agent_name, board_id, title, body }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/posts`, { title, body });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Storage ─────────────────────────────────────────────────────────

  mcp.tool('aimeat_storage_upload', descriptionFor('aimeat_storage_upload'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Storage key'),
    content: z.string().describe('File content (base64-encoded)'),
    mime_type: z.string().optional().describe('MIME type of the file'),
  }, annotationsFor('aimeat_storage_upload'), async ({ agent_name, key, content, mime_type }) => {
    const { client } = pickAgent(registry, agent_name);
    const body: Record<string, unknown> = { key, content };
    if (mime_type) body.mime_type = mime_type;
    const resp = await client.post('/v1/storage', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_storage_download', descriptionFor('aimeat_storage_download'), {
    agent_name: agentNameSchema,
    key: z.string().describe('Storage key'),
  }, annotationsFor('aimeat_storage_download'), async ({ agent_name, key }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get(`/v1/storage/${encodeURIComponent(key)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
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
  }, annotationsFor('aimeat_admin_agents'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/admin/agents');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_admin_config', descriptionFor('aimeat_admin_config'), {
    agent_name: agentNameSchema,
  }, annotationsFor('aimeat_admin_config'), async ({ agent_name }) => {
    const { client } = pickAgent(registry, agent_name);
    const resp = await client.get('/v1/admin/config');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
