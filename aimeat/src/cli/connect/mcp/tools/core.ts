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
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerCoreTools(mcp: McpServer, registry: AgentRegistry): void {
  // These tools are not scoped to a specific agent's URL path -- they use the
  // primary agent's token for auth (or the only loaded agent in single-agent mode).
  const { client } = registry.resolve();

  // ── Memory ──────────────────────────────────────────────────────────

  mcp.tool('aimeat_memory_read', 'Read a memory entry by key', {
    key: z.string().describe('Memory entry key'),
  }, annotationsFor('aimeat_memory_read'), async ({ key }) => {
    const resp = await client.get(`/v1/memory/${encodeURIComponent(key)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_memory_write', 'Write a memory entry', {
    key: z.string().describe('Memory entry key'),
    value: z.unknown().describe('Value to store'),
    visibility: z.string().optional().describe('Visibility level (default: private)'),
    tags: z.array(z.string()).optional().describe('Optional tags for filtering/shared areas'),
    ttl_hours: z.number().optional().describe('Time-to-live in hours'),
  }, annotationsFor('aimeat_memory_write'), async ({ key, value, visibility, tags, ttl_hours }) => {
    const body: Record<string, unknown> = { key, value };
    if (visibility) body.visibility = visibility;
    if (tags) body.tags = tags;
    if (ttl_hours !== undefined) body.ttl_hours = ttl_hours;
    const resp = await client.post('/v1/memory', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_memory_list', 'List memory entries for this agent, or same-owner memory when owner_scope is true', {
    prefix: z.string().optional().describe('Key prefix filter'),
    visibility: z.string().optional().describe('Optional visibility filter'),
    tags: z.array(z.string()).optional().describe('Optional tag filters'),
    owner_scope: z.boolean().optional().describe('When true, list same-owner GHII and agent memory'),
    limit: z.number().optional().describe('Maximum entries to return'),
  }, annotationsFor('aimeat_memory_list'), async ({ prefix, visibility, tags, owner_scope, limit }) => {
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (visibility) params.set('visibility', visibility);
    if (tags?.length) params.set('tags', tags.join(','));
    if (owner_scope) params.set('owner_scope', 'true');
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const resp = await client.get(`/v1/memory${qs ? `?${qs}` : ''}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_memory_search', 'Search memory entries by query', {
    query: z.string().describe('Search query'),
  }, annotationsFor('aimeat_memory_search'), async ({ query }) => {
    const resp = await client.get(`/v1/memory/search?q=${encodeURIComponent(query)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Catalogue ───────────────────────────────────────────────────────

  mcp.tool('aimeat_catalogue_search', 'Search the action catalogue', {
    query: z.string().optional().describe('Search query'),
  }, annotationsFor('aimeat_catalogue_search'), async ({ query }) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const resp = await client.get(`/v1/catalogue${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Agent profile ──────────────────────────────────────────────────

  mcp.tool('aimeat_agent_profile', 'View an agent\'s public profile', {
    gaii: z.string().describe('Agent GAII identifier'),
  }, annotationsFor('aimeat_agent_profile'), async ({ gaii }) => {
    const resp = await client.get(`/v1/agents/${encodeURIComponent(gaii)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Work ────────────────────────────────────────────────────────────

  mcp.tool('aimeat_action_execute', 'Request execution of an action', {
    action_id: z.string().describe('Action identifier'),
    input: z.record(z.string(), z.unknown()).optional().describe('Input parameters for the action'),
  }, annotationsFor('aimeat_action_execute'), async ({ action_id, input }) => {
    const body: Record<string, unknown> = { action_id };
    if (input) body.input = input;
    const resp = await client.post('/v1/work/request', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_work_inbox', 'Check the work inbox for pending work items', {}, annotationsFor('aimeat_work_inbox'), async () => {
    const resp = await client.get('/v1/work/inbox');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_work_accept', 'Accept a work item', {
    tracking_code: z.string().describe('Work item tracking code'),
  }, annotationsFor('aimeat_work_accept'), async ({ tracking_code }) => {
    const resp = await client.post(`/v1/work/${encodeURIComponent(tracking_code)}/accept`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_work_deliver', 'Deliver a work result', {
    tracking_code: z.string().describe('Work item tracking code'),
    result: z.unknown().describe('Delivery payload'),
  }, annotationsFor('aimeat_work_deliver'), async ({ tracking_code, result }) => {
    const resp = await client.post(`/v1/work/${encodeURIComponent(tracking_code)}/deliver`, { result });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Wallet ──────────────────────────────────────────────────────────

  mcp.tool('aimeat_wallet_balance', 'Check morsel wallet balance', {}, annotationsFor('aimeat_wallet_balance'), async () => {
    const resp = await client.get('/v1/wallet');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Boards (basic read/post) ────────────────────────────────────────

  mcp.tool('aimeat_board_read', 'Read board posts', {
    board_id: z.string().describe('Board identifier'),
  }, annotationsFor('aimeat_board_read'), async ({ board_id }) => {
    const resp = await client.get(`/v1/boards/${encodeURIComponent(board_id)}/posts`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_post', 'Post to a board', {
    board_id: z.string().describe('Board identifier'),
    title: z.string().describe('Post title'),
    body: z.string().describe('Post body'),
  }, annotationsFor('aimeat_board_post'), async ({ board_id, title, body }) => {
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/posts`, { title, body });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Storage ─────────────────────────────────────────────────────────

  mcp.tool('aimeat_storage_upload', 'Upload a file to storage', {
    key: z.string().describe('Storage key'),
    content: z.string().describe('File content (base64-encoded)'),
    mime_type: z.string().optional().describe('MIME type of the file'),
  }, annotationsFor('aimeat_storage_upload'), async ({ key, content, mime_type }) => {
    const body: Record<string, unknown> = { key, content };
    if (mime_type) body.mime_type = mime_type;
    const resp = await client.post('/v1/storage', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_storage_download', 'Download a file from storage', {
    key: z.string().describe('Storage key'),
  }, annotationsFor('aimeat_storage_download'), async ({ key }) => {
    const resp = await client.get(`/v1/storage/${encodeURIComponent(key)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Admin ───────────────────────────────────────────────────────────

  mcp.tool('aimeat_admin_stats', 'Node statistics (operator only)', {}, annotationsFor('aimeat_admin_stats'), async () => {
    const resp = await client.get('/v1/admin/stats');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_admin_agents', 'List all agents on the node (operator only)', {}, annotationsFor('aimeat_admin_agents'), async () => {
    const resp = await client.get('/v1/admin/agents');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_admin_config', 'View node configuration (operator only)', {}, annotationsFor('aimeat_admin_config'), async () => {
    const resp = await client.get('/v1/admin/config');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
