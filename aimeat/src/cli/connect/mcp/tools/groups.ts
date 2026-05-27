/**
 * @file groups.ts
 * @description MCP tool registrations for sharing group management -- creating,
 *   listing, viewing, and managing group membership.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerGroupsTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_group_list', 'List sharing groups', {}, async () => {
    const resp = await client.get('/v1/groups');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_get', 'Get group detail', {
    id: z.string().describe('Group identifier'),
  }, async ({ id }) => {
    const resp = await client.get(`/v1/groups/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_create', 'Create a sharing group', {
    name: z.string().describe('Group name'),
    description: z.string().optional().describe('Group description'),
  }, async ({ name, description }) => {
    const body: Record<string, unknown> = { name };
    if (description) body.description = description;
    const resp = await client.post('/v1/groups', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_add_member', 'Add a member to a group', {
    id: z.string().describe('Group identifier'),
    identifier: z.string().describe('Member GAII or GHII'),
    role: z.string().optional().describe('Member role within the group'),
  }, async ({ id, identifier, role }) => {
    const body: Record<string, unknown> = { identifier };
    if (role) body.role = role;
    const resp = await client.post(`/v1/groups/${encodeURIComponent(id)}/members`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_remove_member', 'Remove a member from a group', {
    id: z.string().describe('Group identifier'),
    identifier: z.string().describe('Member GAII or GHII'),
  }, async ({ id, identifier }) => {
    const resp = await client.delete(
      `/v1/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(identifier)}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
