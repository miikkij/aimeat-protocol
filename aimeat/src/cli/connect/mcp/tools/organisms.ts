/**
 * @file organisms.ts
 * @description MCP tool registrations for organism (collective) management --
 *   listing, viewing, joining, leaving, and member listing.
 * @version-history
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
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerOrganismsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, owner } = registry.resolve();

  mcp.tool('aimeat_organism_list', descriptionFor('aimeat_organism_list'), {}, annotationsFor('aimeat_organism_list'), async () => {
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
    return { content: [{ type: 'text' as const, text: JSON.stringify({ organisms, total: organisms.length }, null, 2) }] };
  });

  mcp.tool('aimeat_organism_get', descriptionFor('aimeat_organism_get'), {
    organism_id: z.string().describe('ID of the organism to retrieve'),
  }, annotationsFor('aimeat_organism_get'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_overview', descriptionFor('aimeat_organism_overview'), {
    organism_id: z.string().describe('Organism identifier.'),
  }, annotationsFor('aimeat_organism_overview'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/overview`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_update', descriptionFor('aimeat_organism_update'), {
    organism_id: z.string().describe('Organism identifier.'),
    name: z.string().optional().describe('New organism name.'),
    description: z.string().optional().describe('Short tagline shown under the name.'),
    readme: z.string().optional().describe('Free-form markdown README (mermaid allowed) shown at the top of the organism home.'),
    interests: z.array(z.string()).optional().describe('Interest tags.'),
    join_policy: z.string().optional().describe('open | approval_required | invite_only.'),
    visibility: z.string().optional().describe('public | listed | private.'),
  }, annotationsFor('aimeat_organism_update'), async ({ organism_id, name, description, readme, interests, join_policy, visibility }) => {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (description !== undefined) body.description = description;
    if (readme !== undefined) body.readme = readme;
    if (interests !== undefined) body.interests = interests;
    if (join_policy !== undefined) body.join_policy = join_policy;
    if (visibility !== undefined) body.visibility = visibility;
    const resp = await client.put(`/v1/organisms/${encodeURIComponent(organism_id)}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_join', descriptionFor('aimeat_organism_join'), {
    organism_id: z.string().describe('ID of the organism to join'),
    message: z.string().optional().describe('Optional message for join requests (used when approval is required)'),
  }, annotationsFor('aimeat_organism_join'), async ({ organism_id, message }) => {
    const body: Record<string, unknown> = {};
    if (message != null) body.message = message;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/join`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_leave', descriptionFor('aimeat_organism_leave'), {
    organism_id: z.string().describe('ID of the organism to leave'),
  }, annotationsFor('aimeat_organism_leave'), async ({ organism_id }) => {
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/leave`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_members', descriptionFor('aimeat_organism_members'), {
    organism_id: z.string().describe('The organism ID'),
    role: z.string().optional().describe('Filter by role: creator, admin, member'),
    status: z.string().optional().describe('Filter by status: active, pending, banned (default: active)'),
  }, annotationsFor('aimeat_organism_members'), async ({ organism_id, role, status }) => {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    const qs = params.toString();
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/members${qs ? `?${qs}` : ''}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_create', descriptionFor('aimeat_organism_create'), {
    name: z.string().describe('Organism name (min 2 chars)'),
    description: z.string().optional().describe('What this organism is for'),
    type: z.string().optional().describe('community | team | club | cooperative | project'),
    join_policy: z.string().optional().describe('open | approval_required | invite_only'),
    visibility: z.string().optional().describe('public | listed | private'),
  }, annotationsFor('aimeat_organism_create'), async ({ name, description, type, join_policy, visibility }) => {
    const body: Record<string, unknown> = { name };
    if (description != null) body.description = description;
    if (type != null) body.type = type;
    if (join_policy != null) body.join_policy = join_policy;
    if (visibility != null) body.visibility = visibility;
    const resp = await client.post('/v1/organisms', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_export', descriptionFor('aimeat_organism_export'), {
    organism_id: z.string().describe('Organism to export'),
  }, annotationsFor('aimeat_organism_export'), async ({ organism_id }) => {
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/export?format=base64`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_import', descriptionFor('aimeat_organism_import'), {
    zip_base64: z.string().describe('Organism export ZIP, base64-encoded'),
  }, annotationsFor('aimeat_organism_import'), async ({ zip_base64 }) => {
    const resp = await client.post('/v1/organisms/import', { zip_base64 });
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  const wsGrantShape = z.array(z.object({
    ws: z.string().describe('Workspace id'),
    role: z.enum(['viewer', 'contributor']).describe('viewer = read only; contributor = read + write'),
  })).optional().describe('Optional per-workspace grants applied when the invitee joins');

  mcp.tool('aimeat_organism_invite', descriptionFor('aimeat_organism_invite'), {
    organism_id: z.string().describe('Organism identifier'),
    invitee: z.string().describe('Bare owner name to invite'),
    role: z.enum(['member', 'admin']).optional().describe('Organism role granted on accept (default "member")'),
    workspaces: wsGrantShape,
  }, annotationsFor('aimeat_organism_invite'), async ({ organism_id, invitee, role, workspaces }) => {
    const body: Record<string, unknown> = { invitee };
    if (role) body.role = role;
    if (workspaces) body.workspaces = workspaces;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_member_add', descriptionFor('aimeat_organism_member_add'), {
    organism_id: z.string().describe('Organism identifier'),
    ghii: z.string().describe('Bare owner name to add as an active member'),
    role: z.enum(['member', 'admin']).optional().describe('Organism role (default "member")'),
    workspaces: wsGrantShape,
  }, annotationsFor('aimeat_organism_member_add'), async ({ organism_id, ghii, role, workspaces }) => {
    const body: Record<string, unknown> = { ghii };
    if (role) body.role = role;
    if (workspaces) body.workspaces = workspaces;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/members`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_invitation_update', descriptionFor('aimeat_organism_invitation_update'), {
    organism_id: z.string().describe('Organism identifier'),
    invitee: z.string().describe('Bare owner name whose pending invitation to edit'),
    role: z.enum(['member', 'admin']).optional().describe('New organism role'),
    workspaces: wsGrantShape,
  }, annotationsFor('aimeat_organism_invitation_update'), async ({ organism_id, invitee, role, workspaces }) => {
    const body: Record<string, unknown> = {};
    if (role) body.role = role;
    if (workspaces) body.workspaces = workspaces;
    const resp = await client.patch(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/${encodeURIComponent(invitee)}`, body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_invitation_cancel', descriptionFor('aimeat_organism_invitation_cancel'), {
    organism_id: z.string().describe('Organism identifier'),
    invitee: z.string().describe('Bare owner name whose pending invitation to withdraw'),
  }, annotationsFor('aimeat_organism_invitation_cancel'), async ({ organism_id, invitee }) => {
    const resp = await client.delete(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/${encodeURIComponent(invitee)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_invitations', descriptionFor('aimeat_organism_invitations'), {}, annotationsFor('aimeat_organism_invitations'), async () => {
    const resp = await client.get('/v1/organisms/invitations/mine');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_organism_invitation_respond', descriptionFor('aimeat_organism_invitation_respond'), {
    organism_id: z.string().describe('Organism identifier you were invited to'),
    decision: z.enum(['accept', 'decline']).describe('accept or decline'),
  }, annotationsFor('aimeat_organism_invitation_respond'), async ({ organism_id, decision }) => {
    const path = decision === 'accept' ? 'accept' : 'decline';
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/invitations/${path}`, {});
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_organism_search', descriptionFor('aimeat_organism_search'), {
    organism_id: z.string().describe('Organism identifier'),
    q: z.string().describe('Search text (min 2 characters)'),
    ws: z.string().optional().describe('Optional: limit to a single workspace id'),
    archived: z.enum(['exclude', 'include', 'only']).optional().describe('Archive scope: exclude (default), only (archive search), or include (both)'),
  }, annotationsFor('aimeat_organism_search'), async ({ organism_id, q, ws, archived }) => {
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

  mcp.tool('aimeat_workspace_comment', descriptionFor('aimeat_workspace_comment'), {
    organism_id: z.string().describe('Organism identifier'),
    ws: z.string().describe('Workspace id'),
    space: z.string().describe('The objectType (space) name'),
    instance_id: z.string().describe('The record/document id'),
    body: z.string().describe('The comment text'),
    anchor: z.object({ section: z.string().optional(), quote: z.string().optional() }).optional().describe('Optional anchor to part of a document'),
    parent_id: z.string().optional().describe('Optional id of the comment this replies to'),
  }, annotationsFor('aimeat_workspace_comment'), async ({ organism_id, ws, space, instance_id, body, anchor, parent_id }) => {
    const payload: Record<string, unknown> = { ws, space, instance_id, body };
    if (anchor != null) payload.anchor = anchor;
    if (parent_id != null) payload.parent_id = parent_id;
    const resp = await client.post(`/v1/organisms/${encodeURIComponent(organism_id)}/comments`, payload);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) };
  });

  mcp.tool('aimeat_workspace_comments', descriptionFor('aimeat_workspace_comments'), {
    organism_id: z.string().describe('Organism identifier'),
    ws: z.string().describe('Workspace id'),
    space: z.string().describe('The objectType (space) name'),
    instance_id: z.string().describe('The record/document id'),
  }, annotationsFor('aimeat_workspace_comments'), async ({ organism_id, ws, space, instance_id }) => {
    const params = new URLSearchParams({ ws, space, instance_id });
    const resp = await client.get(`/v1/organisms/${encodeURIComponent(organism_id)}/comments?${params.toString()}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
