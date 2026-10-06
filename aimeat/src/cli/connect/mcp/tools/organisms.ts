/**
 * @file organisms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 * @version-history
 *   2026-10-06 — aimeat_workspace_rows_delete runs its dispatch definition (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.8.0 -- 2026-09-30 -- aimeat_workspace_comment_delete (DELETE /v1/organisms/:id/comments/:commentId);
 *     aimeat_organism_invite_email takes `locale`, the email's language.
 *   v1.7.2 -- 2026-09-28 -- aimeat_organism_invite_email takes return_url and passes it to the REST route;
 *     aimeat_organism_update takes agent_access.
 *   v1.8.0 -- 2026-10-01 -- aimeat_organism_create forwards `shape` and `lang` (starting shapes).
 *   v1.7.1 -- 2026-08-29 -- aimeat_organism_create's `type` is described as free text with five presets.
 *   v1.7.0 -- 2026-08-25 -- aimeat_organism_member_remove (DELETE /v1/organisms/:id/members/:ghii,
 *     ?ban=1), parity with the server MCP and the CLI dispatch.
 *   v1.6.1 -- 2026-08-15 -- owner_add / owner_remove: plural organism ownership over the
 *     connector, mirroring POST/DELETE /v1/organisms/:id/owners. Ships in aimeat@3.2.0.
 *   v1.6.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_workspace_comment carries
 *     `ai_provenance` / `ai_provenance_id` and echoes what was recorded.
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- MCP drift reconciliation: id -> organism_id across get/join/leave/members;
 *     add message (join) and role/status filters (members) to match server MCP + REST.
 *   v1.3.0 -- 2026-06-10 -- organism_list also fetches ?member={owner} and merges (was public-only:
 *     an agent's join answered ALREADY_MEMBER while the list omitted its own private organisms — the
 *     agent could not find its home). Mirrors the server-MCP tool; rows carry is_member.
 *   v1.4.0 -- 2026-06-30 -- MCP drift fix: add `archived` enum (exclude/include/only) to
 *     organism_search to match the server MCP surface; maps to the REST ?archived/?includeArchived flags.
 *   v1.5.0 -- 2026-07-16 -- invite carries role + workspaces; add member_add / invitation_update /
 *     invitation_cancel tools (name-invite parity with the server MCP).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { provenanceEchoedResult } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { envelopeResult, payloadResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerOrganismsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, owner } = registry.resolve();

  mcp.tool('aimeat_organism_list', descriptionFor('aimeat_organism_list'), zodShapeFor('aimeat_organism_list'), annotationsFor('aimeat_organism_list'), async () => {
    // Public discovery PLUS the agent's own organisms (?member={owner} — owner-keyed memberships,
    // including private ones). A bare GET /v1/organisms is public-only, so an agent could not find
    // its own home: join answered ALREADY_MEMBER while this list omitted the organism. Mirrors the
    // server-MCP tool; is_member tells the agent which organisms it belongs to.
    const [pub, mine] = await Promise.all([
      client.get('/v1/organisms'),
      client.get(`/v1/organisms?member=${encodeURIComponent(owner)}`),
    ]);
    if (pub.ok === false && mine.ok === false) return { content: [{ type: 'text' as const, text: JSON.stringify(pub.error ?? pub, null, 2) }], isError: true };
    const mineList = ((mine.data as { organisms?: { id: string }[] } | undefined)?.organisms) ?? [];
    const pubList = ((pub.data as { organisms?: { id: string }[] } | undefined)?.organisms) ?? [];
    const memberIds = new Set(mineList.map(o => o.id));
    const seen = new Set<string>();
    const organisms = [...mineList, ...pubList]
      .filter(o => { if (seen.has(o.id)) return false; seen.add(o.id); return true; })
      .map(o => ({ ...o, is_member: memberIds.has(o.id) }));
    // Two reads merged into one list, so the flag asks whether ANY of it could be read. A single
    // refusal leaves a SHORTER list rather than no list -- the caller sees public organisms and not
    // its own, or the other way round -- and calling that an error would be as wrong as calling it
    // a success. What must not happen is both reads being refused and the answer coming back as an
    // empty list that reads like "you belong to nothing".
    return payloadResult({ organisms, total: organisms.length }, { ok: mine.ok !== false || pub.ok !== false });
  });

  mcp.tool('aimeat_organism_overview', descriptionFor('aimeat_organism_overview'), {
    organism_id: z.string().describe('Organism identifier.'),
  }, annotationsFor('aimeat_organism_overview'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/overview`);
    return envelopeResult(resp);
  });

  // Ownership is plural: adding is additive, and the LAST owner cannot be removed. Both mirror the
  // REST routes, which call services/organism-ownership.ts — the connector adds no rules of its own.
  mcp.tool('aimeat_organism_owner_add', descriptionFor('aimeat_organism_owner_add'), zodShapeFor('aimeat_organism_owner_add'), annotationsFor('aimeat_organism_owner_add'), async ({ organism_id, ghii }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/owners`, { ghii });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_owner_remove', descriptionFor('aimeat_organism_owner_remove'), zodShapeFor('aimeat_organism_owner_remove'), annotationsFor('aimeat_organism_owner_remove'), async ({ organism_id, ghii }) => {
    const resp = await client.delete(`/v1/organisms/${encodeURIComponent(organism_id)}/owners/${encodeURIComponent(ghii)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_search', descriptionFor('aimeat_organism_search'), zodShapeFor('aimeat_organism_search'), annotationsFor('aimeat_organism_search'), async ({ organism_id, q, ws, archived }) => {
    const params = new URLSearchParams({ q });
    if (ws) params.set('ws', ws);
    // The REST route reads archive scope from two flags: ?archived=only (archive
    // search) and ?includeArchived=true (both). Map the enum to those; 'exclude'
    // (the default) sends neither.
    if (archived === 'only') params.set('archived', 'only');
    else if (archived === 'include') params.set('includeArchived', 'true');
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/search?${params.toString()}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_workspace_comment', descriptionFor('aimeat_workspace_comment'), zodShapeFor('aimeat_workspace_comment'), annotationsFor('aimeat_workspace_comment'), async ({ organism_id, ws, space, instance_id, body, anchor, parent_id, ai_provenance, ai_provenance_id }) => {
    const payload: Record<string, unknown> = { ws, space, instance_id, body };
    if (anchor != null) payload.anchor = anchor;
    if (parent_id != null) payload.parent_id = parent_id;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/comments`, payload);
    if (resp.ok === false) return { content: [{ type: 'text' as const, text: JSON.stringify(resp.error ?? resp, null, 2) }], isError: true };
    return provenanceEchoedResult(client,
      { tool: 'aimeat_workspace_comment', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  // ── In-place DOCUMENT edits ───────────────────────────────────────────────────────────────────
  // The connector half of the two document tools. Thin calls to the same routes the node MCP
  // reaches through services/workspace-doc-edit.ts, so the section lookup, the byte-identical
  // splice and the compare-and-swap retry are the node's answer on this door too — which matters
  // here more than anywhere, because a retry loop implemented twice is a retry loop that differs.

  // → POST /v1/organisms/:id/invitations/email — invite an external email (creator/admin).
  mcp.tool('aimeat_organism_invite_email', descriptionFor('aimeat_organism_invite_email'), zodShapeFor('aimeat_organism_invite_email'), annotationsFor('aimeat_organism_invite_email'), async ({ organism_id, email, org_role, workspaces, message, expires_in_days, return_url, locale }) => {
    const body: Record<string, unknown> = { email };
    if (org_role) body.orgRole = org_role;
    if (workspaces) body.workspaces = workspaces;
    if (message) body.message = message;
    if (expires_in_days !== undefined) body.expiresInDays = expires_in_days;
    if (return_url) body.return_url = return_url;
    if (locale) body.locale = locale;
    return out(await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/email`, body));
  });

  // → GET /v1/organisms/:id/invitations/email — list pending email invitations.
  mcp.tool('aimeat_organism_invitations_email', descriptionFor('aimeat_organism_invitations_email'), zodShapeFor('aimeat_organism_invitations_email'), annotationsFor('aimeat_organism_invitations_email'), async ({ organism_id }) => {
    return out(await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/email`));
  });

  // → POST /v1/organisms/:id/invitations/email/:invId/cancel — cancel a pending email invitation.
  mcp.tool('aimeat_organism_invitation_email_cancel', descriptionFor('aimeat_organism_invitation_email_cancel'), zodShapeFor('aimeat_organism_invitation_email_cancel'), annotationsFor('aimeat_organism_invitation_email_cancel'), async ({ organism_id, invitation_id }) => {
    return out(await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/email/${encodeURIComponent(invitation_id)}/cancel`));
  });
}
