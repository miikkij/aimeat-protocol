/**
 * @file workspace-roles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE shared implementation of organism workspace member roles — the "unified IAM"
 *   the grant/revoke/list surfaces all call, so there is no parallel ad-hoc mechanism. A workspace
 *   CREATOR (or an org admin acting on the creator's behalf) grants an approved member one of two
 *   roles, modelled as a consent the CREATOR owns on `organism.{id}.w.{ws}.**`:
 *     - viewer       → read only          (purpose 'workspace-viewer')
 *     - contributor  → read + write       (purpose 'workspace-contributor')
 *   The consent IS the audit record (grant = createConsent, revoke = updateConsent→revoked); every
 *   grant stamps `metadata.source` (grant | request | invite) + `grantedBy` so the members list can
 *   show provenance without a new table. Roles are granted to the OWNER (recipient `ghii:owner@node`),
 *   so all the owner's agents inherit — a GHII grantee and a GAII grantee are equal (both resolve to
 *   the owner). The write gate keys off purpose ('workspace-contributor'); this module never changes
 *   purpose, so stamping metadata is transparent to it.
 *
 *   Before this module the exact same logic was duplicated in routes/organisms.ts (REST) and
 *   mcp/workspaces.ts (MCP). Both now delegate here, and the new aimeat_workspace_member_* MCP tools
 *   call it directly — one authority path, REST/MCP parity by construction.
 * @structure
 *   - WsRole / WsGrantSource / WS_ROLE_PURPOSES
 *   - wsPattern / wsRecipient / granteeOwner
 *   - grantWorkspaceRole  — set a member's role (revoke prior role, grant new; stamps source+grantedBy)
 *   - revokeWorkspaceRole — revoke every workspace-role grant for a member on a workspace
 *   - listWorkspaceMemberRoles — owner → { role, source, grantedBy, grantedAt } for a workspace
 * @usage
 *   import { grantWorkspaceRole } from './workspace-roles.js';
 *   await grantWorkspaceRole(storage, config, { creatorGhii, orgId, ws, grantee, role, source, grantedBy });
 * @version-history
 *   v1.0.0 -- 2026-07-11 -- Extract the creator-managed workspace-role logic (was duplicated in the REST
 *     routes + the MCP tools) into one service; add an explicit metadata.source stamp (grant|request|
 *     invite) + grantedBy for the members listing (TARGET-028).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { parseGaiiLoose } from '../utils/gaii.js';

export type WsRole = 'viewer' | 'contributor';
/** Where a grant came from: a direct grant, an approved access request, or an organism invitation. */
export type WsGrantSource = 'grant' | 'request' | 'invite';

/** Purposes that count as a workspace-role grant. 'workspace-access' is the legacy read purpose. */
export const WS_ROLE_PURPOSES = ['workspace-viewer', 'workspace-contributor', 'workspace-access'];

/** The consent dataPattern that scopes a grant to one workspace's content. */
export function wsPattern(orgId: string, ws: string): string {
  return `organism.${orgId}.w.${ws}.**`;
}

/** The bare owner behind any grantee form (owner name / GHII / GAII / GEAI). Bare names pass through. */
export function granteeOwner(grantee: string): string {
  return parseGaiiLoose(grantee).owner || grantee;
}

/** The consent recipient for a grantee — always the OWNER on THIS node, so all their agents inherit. */
export function wsRecipient(nodeId: string, grantee: string): string {
  return `ghii:${granteeOwner(grantee)}@${nodeId}`;
}

type RoleMeta = { source: WsGrantSource; grantedBy: string; grantedAt: string };
export type WsMemberRole = { owner: string; role: WsRole } & Partial<RoleMeta>;

/**
 * Set a member's role on a workspace: revoke any prior workspace-role consent for them, then grant the
 * new one. Idempotent in effect (re-granting the same role just re-stamps it). The grant is OWNED by the
 * workspace creator (`creatorGhii`) so content reads resolve via the owner and the creator can revoke it.
 * `source` + `grantedBy` are stamped into the consent metadata for the members listing.
 */
export async function grantWorkspaceRole(
  storage: Storage,
  config: AimeatConfig,
  args: { creatorGhii: string; orgId: string; ws: string; grantee: string; role: WsRole; source: WsGrantSource; grantedBy: string },
): Promise<{ recipient: string; role: WsRole; owner: string }> {
  const { creatorGhii, orgId, ws, grantee, role, source, grantedBy } = args;
  const recipient = wsRecipient(config.nodeId, grantee);
  const pattern = wsPattern(orgId, ws);
  const now = new Date().toISOString();
  const prior = (await storage.listConsents(creatorGhii, { status: 'active' }))
    .filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
  for (const g of prior) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
  await storage.createConsent({
    id: randomUUID(), ownerGaii: creatorGhii, dataPattern: pattern, recipient,
    purpose: role === 'contributor' ? 'workspace-contributor' : 'workspace-viewer',
    scope: 'private', expires: null, status: 'active', grantedAt: now, revokedAt: null,
    metadata: { source, grantedBy, wsRole: role },
  });
  return { recipient, role, owner: granteeOwner(grantee) };
}

/** Revoke EVERY workspace-role grant a member holds on a workspace. Returns how many were revoked. */
export async function revokeWorkspaceRole(
  storage: Storage,
  config: AimeatConfig,
  args: { creatorGhii: string; orgId: string; ws: string; grantee: string },
): Promise<number> {
  const { creatorGhii, orgId, ws, grantee } = args;
  const recipient = wsRecipient(config.nodeId, grantee);
  const pattern = wsPattern(orgId, ws);
  const now = new Date().toISOString();
  const grants = (await storage.listConsents(creatorGhii, { status: 'active' }))
    .filter(c => c.dataPattern === pattern && c.recipient === recipient && WS_ROLE_PURPOSES.includes(c.purpose));
  for (const g of grants) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
  return grants.length;
}

/**
 * Map the creator's active grants → each member's current role for one workspace, with provenance.
 * A contributor grant wins over a viewer grant for the same owner (matches the write gate). `source`,
 * `grantedBy`, and `grantedAt` come from the consent metadata (absent on legacy grants → 'unknown').
 */
export async function listWorkspaceMemberRoles(
  storage: Storage,
  _config: AimeatConfig,
  args: { creatorGhii: string; orgId: string; ws: string },
): Promise<Map<string, WsMemberRole>> {
  const { creatorGhii, orgId, ws } = args;
  const pattern = wsPattern(orgId, ws);
  const byOwner = new Map<string, WsMemberRole>();
  for (const c of await storage.listConsents(creatorGhii, { status: 'active' })) {
    if (c.dataPattern !== pattern || !WS_ROLE_PURPOSES.includes(c.purpose)) continue;
    const owner = c.recipient.replace(/^ghii:/, '').split('@')[0];
    const role: WsRole = c.purpose === 'workspace-contributor' ? 'contributor' : 'viewer';
    const meta = (c.metadata ?? {}) as Partial<RoleMeta>;
    const existing = byOwner.get(owner);
    // Contributor wins; otherwise keep the first (viewer) seen. Always carry the winning grant's provenance.
    if (!existing || (role === 'contributor' && existing.role !== 'contributor')) {
      byOwner.set(owner, {
        owner, role,
        source: (meta.source as WsGrantSource) ?? 'unknown' as WsGrantSource,
        grantedBy: meta.grantedBy ?? undefined,
        grantedAt: c.grantedAt,
      });
    }
  }
  return byOwner;
}
