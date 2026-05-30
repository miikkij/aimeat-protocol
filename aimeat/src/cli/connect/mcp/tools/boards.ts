/**
 * @file boards.ts
 * @description MCP tool registrations for board management -- creating, listing,
 *   subscribing, reacting, replying, member updates, and deletion.
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

export function registerBoardsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_board_list', descriptionFor('aimeat_board_list'), {}, annotationsFor('aimeat_board_list'), async () => {
    const resp = await client.get('/v1/boards');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_create', descriptionFor('aimeat_board_create'), {
    name: z.string().describe('Board name'),
    description: z.string().optional().describe('Board description'),
    visibility: z.string().optional().describe('Board visibility level'),
  }, annotationsFor('aimeat_board_create'), async ({ name, description, visibility }) => {
    const body: Record<string, unknown> = { name };
    if (description) body.description = description;
    if (visibility) body.visibility = visibility;
    const resp = await client.post('/v1/boards', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_subscribe', descriptionFor('aimeat_board_subscribe'), {
    board_id: z.string().describe('Board identifier'),
  }, annotationsFor('aimeat_board_subscribe'), async ({ board_id }) => {
    const resp = await client.post(`/v1/boards/${encodeURIComponent(board_id)}/subscribe`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_react', descriptionFor('aimeat_board_react'), {
    board_id: z.string().describe('Board identifier'),
    post_id: z.string().describe('Post identifier'),
    emoji: z.string().describe('Reaction emoji'),
  }, annotationsFor('aimeat_board_react'), async ({ board_id, post_id, emoji }) => {
    const resp = await client.post(
      `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/react`,
      { emoji },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_reply', descriptionFor('aimeat_board_reply'), {
    board_id: z.string().describe('Board identifier'),
    post_id: z.string().describe('Post identifier'),
    body: z.string().describe('Reply body'),
  }, annotationsFor('aimeat_board_reply'), async ({ board_id, post_id, body }) => {
    const resp = await client.post(
      `/v1/boards/${encodeURIComponent(board_id)}/posts/${encodeURIComponent(post_id)}/replies`,
      { body },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_members', descriptionFor('aimeat_board_members'), {
    board_id: z.string().describe('Board identifier'),
    members: z.array(z.string()).describe('List of member identifiers'),
  }, annotationsFor('aimeat_board_members'), async ({ board_id, members }) => {
    const resp = await client.patch(
      `/v1/boards/${encodeURIComponent(board_id)}/members`,
      { members },
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_board_delete', descriptionFor('aimeat_board_delete'), {
    board_id: z.string().describe('Board identifier'),
  }, annotationsFor('aimeat_board_delete'), async ({ board_id }) => {
    const resp = await client.delete(`/v1/boards/${encodeURIComponent(board_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
