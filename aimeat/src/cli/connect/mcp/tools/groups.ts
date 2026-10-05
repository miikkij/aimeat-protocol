/**
 * @file groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for sharing group management -- creating,
 *   listing, viewing, and managing group membership.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: id->group_id (get/add_member/remove_member),
 *     add members to create, replace add_member role with required identifier_type + permissions
 *     object to match REST SharingGroupAddMemberSchema (connector was sending an ignored role field).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { envelopeResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerGroupsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_group_list', descriptionFor('aimeat_group_list'), zodShapeFor('aimeat_group_list'), annotationsFor('aimeat_group_list'), async () => {
    const resp = await client.get('/v1/groups');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_group_get', descriptionFor('aimeat_group_get'), zodShapeFor('aimeat_group_get'), annotationsFor('aimeat_group_get'), async ({ group_id }) => {
    const resp = await client.get(`/v1/groups/${encodeURIComponent(group_id)}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_group_create', descriptionFor('aimeat_group_create'), zodShapeFor('aimeat_group_create'), annotationsFor('aimeat_group_create'), async ({ name, description, members }) => {
    const body: Record<string, unknown> = { name };
    if (description) body.description = description;
    if (members) body.members = members;
    const resp = await client.post('/v1/groups', body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_group_add_member', descriptionFor('aimeat_group_add_member'), zodShapeFor('aimeat_group_add_member'), annotationsFor('aimeat_group_add_member'), async ({ group_id, identifier, identifier_type, permissions }) => {
    const body: Record<string, unknown> = { identifier, identifier_type };
    if (permissions) body.permissions = permissions;
    const resp = await client.post(`/v1/groups/${encodeURIComponent(group_id)}/members`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_group_remove_member', descriptionFor('aimeat_group_remove_member'), zodShapeFor('aimeat_group_remove_member'), annotationsFor('aimeat_group_remove_member'), async ({ group_id, identifier }) => {
    const resp = await client.delete(
      `/v1/groups/${encodeURIComponent(group_id)}/members/${encodeURIComponent(identifier)}`,
    );
    return envelopeResult(resp);
  });

  // ── Key-space shares: the group says WHO, these say WHAT it reaches ──

  mcp.tool('aimeat_share_create', descriptionFor('aimeat_share_create'), zodShapeFor('aimeat_share_create'), annotationsFor('aimeat_share_create'), async ({ group_id, key_pattern, note, expires_at }) => {
    const body: Record<string, unknown> = { key_pattern };
    if (note) body.note = note;
    if (expires_at) body.expires_at = expires_at;
    const resp = await client.post(`/v1/groups/${encodeURIComponent(group_id)}/shares`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_share_list', descriptionFor('aimeat_share_list'), zodShapeFor('aimeat_share_list'), annotationsFor('aimeat_share_list'), async ({ direction }) => {
    const resp = await client.get(direction === 'incoming' ? '/v1/shares/incoming' : '/v1/shares');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_share_revoke', descriptionFor('aimeat_share_revoke'), zodShapeFor('aimeat_share_revoke'), annotationsFor('aimeat_share_revoke'), async ({ share_id }) => {
    const resp = await client.delete(`/v1/shares/${encodeURIComponent(share_id)}`);
    return envelopeResult(resp);
  });
}
