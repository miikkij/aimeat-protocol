/**
 * @file organisms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 * @version-history
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

  mcp.tool('aimeat_organism_get', descriptionFor('aimeat_organism_get'), zodShapeFor('aimeat_organism_get'), annotationsFor('aimeat_organism_get'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_overview', descriptionFor('aimeat_organism_overview'), {
    organism_id: z.string().describe('Organism identifier.'),
  }, annotationsFor('aimeat_organism_overview'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/overview`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_update', descriptionFor('aimeat_organism_update'), zodShapeFor('aimeat_organism_update'), annotationsFor('aimeat_organism_update'), async ({ organism_id, name, description, readme, interests, join_policy, visibility, agent_access }) => {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    if (readme !== undefined) body.readme = readme;
    if (interests !== undefined) body.interests = interests;
    if (join_policy !== undefined) body.join_policy = join_policy;
    if (visibility !== undefined) body.visibility = visibility;
    if (agent_access !== undefined) body.agent_access = agent_access;
    const resp = await client.put(`/v1/organisms/${encodeURIComponent(organism_id)}`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_join', descriptionFor('aimeat_organism_join'), zodShapeFor('aimeat_organism_join'), annotationsFor('aimeat_organism_join'), async ({ organism_id, message }) => {
    const body: Record<string, unknown> = {};
    if (message != null) body.message = message;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/join`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_leave', descriptionFor('aimeat_organism_leave'), zodShapeFor('aimeat_organism_leave'), annotationsFor('aimeat_organism_leave'), async ({ organism_id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/leave`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_members', descriptionFor('aimeat_organism_members'), zodShapeFor('aimeat_organism_members'), annotationsFor('aimeat_organism_members'), async ({ organism_id, role, status }) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const qs = params.toString();
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/members${qs ? `?${qs}` : ''}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_create', descriptionFor('aimeat_organism_create'), zodShapeFor('aimeat_organism_create'), annotationsFor('aimeat_organism_create'), async ({ name, description, type, join_policy, visibility, shape, lang }) => {
    const body: Record<string, unknown> = { name };
    if (description != null) body.description = description;
    if (type != null) body.type = type;
    if (join_policy != null) body.join_policy = join_policy;
    if (visibility != null) body.visibility = visibility;
    if (shape != null) body.shape = shape;
    if (lang != null) body.lang = lang;
    const resp = await client.post('/v1/organisms', body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_export', descriptionFor('aimeat_organism_export'), zodShapeFor('aimeat_organism_export'), annotationsFor('aimeat_organism_export'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/export?format=base64`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_import', descriptionFor('aimeat_organism_import'), zodShapeFor('aimeat_organism_import'), annotationsFor('aimeat_organism_import'), async ({ zip_base64 }) => {
    const resp = await client.post('/v1/organisms/import', { zip_base64 });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_invite', descriptionFor('aimeat_organism_invite'), zodShapeFor('aimeat_organism_invite'), annotationsFor('aimeat_organism_invite'), async ({ organism_id, invitee, role, workspaces }) => {
    const body: Record<string, unknown> = { invitee };
    if (role) body.role = role;
    if (workspaces) body.workspaces = workspaces;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_member_add', descriptionFor('aimeat_organism_member_add'), zodShapeFor('aimeat_organism_member_add'), annotationsFor('aimeat_organism_member_add'), async ({ organism_id, ghii, role, workspaces }) => {
    const body: Record<string, unknown> = { ghii };
    if (role) body.role = role;
    if (workspaces) body.workspaces = workspaces;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/members`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_member_remove', descriptionFor('aimeat_organism_member_remove'), zodShapeFor('aimeat_organism_member_remove'), annotationsFor('aimeat_organism_member_remove'), async ({ organism_id, ghii, ban }) => {
    const path = `/v1/organisms/${encodeURIComponent(organism_id)}/members/${encodeURIComponent(ghii)}${ban ? '?ban=1' : ''}`;
    const resp = await client.delete(path);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
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

  mcp.tool('aimeat_organism_invitation_update', descriptionFor('aimeat_organism_invitation_update'), zodShapeFor('aimeat_organism_invitation_update'), annotationsFor('aimeat_organism_invitation_update'), async ({ organism_id, invitee, role, workspaces }) => {
    const body: Record<string, unknown> = {};
    if (role) body.role = role;
    if (workspaces) body.workspaces = workspaces;
    const resp = await client.patch(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/${encodeURIComponent(invitee)}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_invitation_cancel', descriptionFor('aimeat_organism_invitation_cancel'), zodShapeFor('aimeat_organism_invitation_cancel'), annotationsFor('aimeat_organism_invitation_cancel'), async ({ organism_id, invitee }) => {
    const resp = await client.delete(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/${encodeURIComponent(invitee)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_invitations', descriptionFor('aimeat_organism_invitations'), zodShapeFor('aimeat_organism_invitations'), annotationsFor('aimeat_organism_invitations'), async () => {
    const resp = await client.get('/v1/organisms/invitations/mine');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_organism_invitation_respond', descriptionFor('aimeat_organism_invitation_respond'), zodShapeFor('aimeat_organism_invitation_respond'), annotationsFor('aimeat_organism_invitation_respond'), async ({ organism_id, decision }) => {
    const path = decision === 'accept' ? 'accept' : 'decline';
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/${path}`, {});
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

  mcp.tool('aimeat_workspace_comments', descriptionFor('aimeat_workspace_comments'), zodShapeFor('aimeat_workspace_comments'), annotationsFor('aimeat_workspace_comments'), async ({ organism_id, ws, space, instance_id }) => {
    const params = new URLSearchParams({ ws, space, instance_id });
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/comments?${params.toString()}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_workspace_comment_delete', descriptionFor('aimeat_workspace_comment_delete'), zodShapeFor('aimeat_workspace_comment_delete'), annotationsFor('aimeat_workspace_comment_delete'), async ({ organism_id, ws, space, instance_id, comment_id }) => {
    const params = new URLSearchParams({ ws, space, instance_id });
    const resp = await client.delete(`/v1/organisms/${encodeURIComponent(organism_id)}/comments/${encodeURIComponent(comment_id)}?${params.toString()}`);
    return envelopeResult(resp);
  });

  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  // ── Workspace ROW spaces ──────────────────────────────────────────────────────────────────────
  // The connector half of the four row tools. Each is a thin call to the same REST route the node
  // MCP reaches through the service, so the manifest gate, the access rule and the quotas are the
  // node's answer on this door too.
  const rowsPath = (organism_id: string, space: string, ws: string, extra: Record<string, string> = {}) =>
    `/v1/organisms/${encodeURIComponent(organism_id)}/workspace/rows/${encodeURIComponent(space)}`
    + `?${new URLSearchParams({ ws, ...extra }).toString()}`;

  mcp.tool('aimeat_workspace_rows_append', descriptionFor('aimeat_workspace_rows_append'), zodShapeFor('aimeat_workspace_rows_append'), annotationsFor('aimeat_workspace_rows_append'), async ({ organism_id, ws, space, body, row_id, occurred_at, rows }) => {
    const payload = rows?.length ? { rows } : { body, row_id, occurred_at };
    return out(await client.post(rowsPath(organism_id, space, ws), payload));
  });

  mcp.tool('aimeat_workspace_rows_read', descriptionFor('aimeat_workspace_rows_read'), zodShapeFor('aimeat_workspace_rows_read'), annotationsFor('aimeat_workspace_rows_read'), async ({ organism_id, ws, space, where, since, until, changed_since, limit, cursor, order }) => {
    // A declared field rides the query string as itself, which is the shape the route reads: every
    // parameter that is not reserved is a filter.
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(where ?? {})) if (v != null) extra[k] = String(v);
    if (since) extra.since = since;
    if (until) extra.until = until;
    if (changed_since) extra.changed_since = changed_since;
    if (limit) extra.limit = String(limit);
    if (cursor) extra.cursor = cursor;
    if (order) extra.order = order;
    return out(await client.get(rowsPath(organism_id, space, ws, extra)));
  });

  mcp.tool('aimeat_workspace_rows_stats', descriptionFor('aimeat_workspace_rows_stats'), zodShapeFor('aimeat_workspace_rows_stats'), annotationsFor('aimeat_workspace_rows_stats'), async ({ organism_id, ws, space }) => out(
    await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/workspace/rows/${encodeURIComponent(space)}/stats?${new URLSearchParams({ ws }).toString()}`),
  ));

  mcp.tool('aimeat_workspace_rows_delete', descriptionFor('aimeat_workspace_rows_delete'), zodShapeFor('aimeat_workspace_rows_delete'), annotationsFor('aimeat_workspace_rows_delete'), async ({ organism_id, ws, space, row_id, before }) => {
    if (!!row_id === !!before) {
      return { content: [{ type: 'text' as const, text: 'Pass exactly one of `row_id` (remove that row) or `before` (remove everything created before that ISO timestamp).' }], isError: true };
    }
    const path = row_id
      ? `/v1/organisms/${encodeURIComponent(organism_id)}/workspace/rows/${encodeURIComponent(space)}/${encodeURIComponent(row_id)}?${new URLSearchParams({ ws }).toString()}`
      : rowsPath(organism_id, space, ws, { before: before! });
    return out(await client.delete(path));
  });

  // ── In-place DOCUMENT edits ───────────────────────────────────────────────────────────────────
  // The connector half of the two document tools. Thin calls to the same routes the node MCP
  // reaches through services/workspace-doc-edit.ts, so the section lookup, the byte-identical
  // splice and the compare-and-swap retry are the node's answer on this door too — which matters
  // here more than anywhere, because a retry loop implemented twice is a retry loop that differs.
  const docPath = (organism_id: string, space: string, docId: string, ws: string, op: string) =>
    `/v1/organisms/${encodeURIComponent(organism_id)}/workspace/documents/${encodeURIComponent(space)}/${encodeURIComponent(docId)}/${op}`
    + `?${new URLSearchParams({ ws }).toString()}`;

  mcp.tool('aimeat_workspace_doc_append', descriptionFor('aimeat_workspace_doc_append'), zodShapeFor('aimeat_workspace_doc_append'), annotationsFor('aimeat_workspace_doc_append'), async ({ organism_id, ws, space, id, markdown, section }) => out(
    await client.post(docPath(organism_id, space, id, ws, 'append'), { markdown, ...(section ? { section } : {}) }),
  ));

  mcp.tool('aimeat_workspace_doc_section_replace', descriptionFor('aimeat_workspace_doc_section_replace'), zodShapeFor('aimeat_workspace_doc_section_replace'), annotationsFor('aimeat_workspace_doc_section_replace'), async ({ organism_id, ws, space, id, section, markdown }) => out(
    await client.post(docPath(organism_id, space, id, ws, 'section'), { section, markdown }),
  ));

  // → POST /v1/organisms/:id/(archive|unarchive) — archive/restore an organism or a scoped subtree.
  mcp.tool('aimeat_organism_archive', descriptionFor('aimeat_organism_archive'), zodShapeFor('aimeat_organism_archive'), annotationsFor('aimeat_organism_archive'), async ({ organism_id, level, action, ws, namespace, key }) => {
    const act = action === 'unarchive' ? 'unarchive' : 'archive';
    const body: Record<string, unknown> = { level };
    if (ws) body.ws = ws;
    if (namespace) body.namespace = namespace;
    if (key) body.key = key;
    return out(await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/${act}`, body));
  });

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
