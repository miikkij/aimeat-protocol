/**
 * @file groups.ts
 * @description MCP tool registrations for sharing group management -- creating,
 *   listing, viewing, and managing group membership.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: id->group_id (get/add_member/remove_member),
 *     add members to create, replace add_member role with required identifier_type + permissions
 *     object to match REST SharingGroupAddMemberSchema (connector was sending an ignored role field).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerGroupsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_group_list', descriptionFor('aimeat_group_list'), {}, annotationsFor('aimeat_group_list'), async () => {
    const resp = await client.get('/v1/groups');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_get', descriptionFor('aimeat_group_get'), {
    group_id: z.string().describe('Group identifier'),
  }, annotationsFor('aimeat_group_get'), async ({ group_id }) => {
    const resp = await client.get(`/v1/groups/${encodeURIComponent(group_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  const memberSchema = z.object({
    identifier: z.string().describe('GAII or GHII of the member'),
    identifier_type: z.enum(['gaii', 'ghii']).describe('Type of identifier'),
    permissions: z.object({ read: z.boolean(), write: z.boolean() }).optional().describe('Member permissions'),
  });

  mcp.tool('aimeat_group_create', descriptionFor('aimeat_group_create'), {
    name: z.string().describe('Group name'),
    description: z.string().optional().describe('Group description'),
    members: z.array(memberSchema).optional().describe('Initial members to add'),
  }, annotationsFor('aimeat_group_create'), async ({ name, description, members }) => {
    const body: Record<string, unknown> = { name };
    if (description) body.description = description;
    if (members) body.members = members;
    const resp = await client.post('/v1/groups', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_add_member', descriptionFor('aimeat_group_add_member'), {
    group_id: z.string().describe('Group identifier'),
    identifier: z.string().describe('Member GAII or GHII'),
    identifier_type: z.enum(['gaii', 'ghii']).describe('Type of identifier'),
    permissions: z.object({ read: z.boolean(), write: z.boolean() }).optional().describe('Member permissions (defaults to group default)'),
  }, annotationsFor('aimeat_group_add_member'), async ({ group_id, identifier, identifier_type, permissions }) => {
    const body: Record<string, unknown> = { identifier, identifier_type };
    if (permissions) body.permissions = permissions;
    const resp = await client.post(`/v1/groups/${encodeURIComponent(group_id)}/members`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_group_remove_member', descriptionFor('aimeat_group_remove_member'), {
    group_id: z.string().describe('Group identifier'),
    identifier: z.string().describe('Member GAII or GHII'),
  }, annotationsFor('aimeat_group_remove_member'), async ({ group_id, identifier }) => {
    const resp = await client.delete(
      `/v1/groups/${encodeURIComponent(group_id)}/members/${encodeURIComponent(identifier)}`,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  // ── Key-space shares: the group says WHO, these say WHAT it reaches ──

  mcp.tool('aimeat_share_create', descriptionFor('aimeat_share_create'), {
    group_id: z.string().describe('The group whose members should be able to read'),
    key_pattern: z.string().describe('Key or pattern, e.g. "deliveries.abc.**". `*` is one segment, `**` the subtree.'),
    note: z.string().optional().describe('A reminder for your own list; the reader never sees it'),
    expires_at: z.string().optional().describe('ISO timestamp after which it stops granting'),
  }, annotationsFor('aimeat_share_create'), async ({ group_id, key_pattern, note, expires_at }) => {
    const body: Record<string, unknown> = { key_pattern };
    if (note) body.note = note;
    if (expires_at) body.expires_at = expires_at;
    const resp = await client.post(`/v1/groups/${encodeURIComponent(group_id)}/shares`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_share_list', descriptionFor('aimeat_share_list'), {
    direction: z.enum(['outgoing', 'incoming']).optional().describe('outgoing = what you share; incoming = what was shared with you'),
  }, annotationsFor('aimeat_share_list'), async ({ direction }) => {
    const resp = await client.get(direction === 'incoming' ? '/v1/shares/incoming' : '/v1/shares');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_share_revoke', descriptionFor('aimeat_share_revoke'), {
    share_id: z.string().describe('The share to withdraw'),
  }, annotationsFor('aimeat_share_revoke'), async ({ share_id }) => {
    const resp = await client.delete(`/v1/shares/${encodeURIComponent(share_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
