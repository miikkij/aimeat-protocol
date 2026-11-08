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
 *   the owner).
 *
 *   THE ROLE IS `metadata.wsRole`, which only the node writes: this module, and POST /v1/consent with
 *   an explicit `role` (consentWsRole below, called from services/consent-write.ts, which drops a
 *   caller's own `wsRole`). The purpose is free text the person typed, so it decides no right. A
 *   consent filed before LEGACY_ROLE_PURPOSE_BEFORE without a wsRole still reads its role from the
 *   purpose word, because that is how the role was kept then (wsRoleOf).
 *   The write gate (services/organism-namespace-access.ts) and every listing here ask wsRoleOf.
 *
 *   Before this module the exact same logic was duplicated in routes/organisms.ts (REST) and
 *   mcp/workspaces.ts (MCP). Both now delegate here, and the new aimeat_workspace_member_* MCP tools
 *   call it directly — one authority path, REST/MCP parity by construction.
 * @structure
 *   - WsRole / WsGrantSource / WS_ROLE_PURPOSES / LEGACY_ROLE_PURPOSE_BEFORE
 *   - wsPattern / wsRecipient / granteeOwner
 *   - wsRoleOf — the role one consent gives on its workspace, or null
 *   - consentWsRole — what POST /v1/consent's `role` gives, or why write is refused
 *   - grantWorkspaceRole  — set a member's role (revoke prior role, grant new; stamps source+grantedBy)
 *   - revokeWorkspaceRole — revoke every workspace-role grant for a member on a workspace
 *   - listWorkspaceMemberRoles — owner → { role, source, grantedBy, grantedAt } for a workspace
 * @usage
 *   import { grantWorkspaceRole } from './workspace-roles.js';
 *   await grantWorkspaceRole(storage, config, { creatorGhii, orgId, ws, grantee, role, source, grantedBy });
 * @version-history
 *   v1.1.0 -- 2026-11-08 -- The role is metadata.wsRole, never the purpose text: wsRoleOf for the
 *     write gate and the listings, consentWsRole for POST /v1/consent's explicit `role` (write on one
 *     workspace, to one person on this node, filed under the workspace's creator; anything else is
 *     refused with the reason). Typing `workspace-contributor` as a purpose gave write access.
 *   2026-10-12 -- The role consent's reach is `local`, the name `private` now has (Core 2026-11 AUTHZ-18).
 *   v1.0.0 -- 2026-07-11 -- Extract the creator-managed workspace-role logic (was duplicated in the REST
 *     routes + the MCP tools) into one service; add an explicit metadata.source stamp (grant|request|
 *     invite) + grantedBy for the members listing (TARGET-028).
 *   v1.0.1 -- 2026-09-26 -- A grantee's and a recipient's account names come from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 */
import { randomUUID } from 'node:crypto';
import type { Storage, ConsentRecord } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { localAccountName, localAccountOf } from '../utils/gaii.js';
import { findWorkspaceRegistration } from './workspace-meta-read.js';

export type WsRole = 'viewer' | 'contributor';
/** Where a grant came from: a direct grant, an approved access request, or an organism invitation. */
export type WsGrantSource = 'grant' | 'request' | 'invite';

/** Purposes that count as a workspace-role grant. 'workspace-access' is the legacy read purpose. */
export const WS_ROLE_PURPOSES = ['workspace-viewer', 'workspace-contributor', 'workspace-access'];

/**
 * Consents granted before this moment with no metadata.wsRole read their role from the purpose word.
 * Role grants made before 2026-07-11 carry no wsRole, and nothing tells them apart from a consent
 * whose purpose a person typed, so every consent of that age keeps the access it had: a fix does not
 * silently take a right away (CLAUDE.md, Backend: act only on positive evidence). From this moment the
 * purpose decides nothing.
 */
export const LEGACY_ROLE_PURPOSE_BEFORE = '2026-11-08T00:00:00.000Z';

/** The role one consent gives on the workspace it covers, or null when it is no workspace-role grant. */
export function wsRoleOf(c: Pick<ConsentRecord, 'purpose' | 'grantedAt' | 'metadata'>): WsRole | null {
  const stamped = (c.metadata as { wsRole?: unknown } | undefined)?.wsRole;
  if (stamped === 'contributor' || stamped === 'viewer') return stamped;
  if (!WS_ROLE_PURPOSES.includes(c.purpose)) return null;
  // A purpose word alone gives at most the viewer listing: the consent reads, nothing more.
  return c.purpose === 'workspace-contributor' && c.grantedAt < LEGACY_ROLE_PURPOSE_BEFORE ? 'contributor' : 'viewer';
}

/** A consent's metadata key for the role. The node writes it; a caller's own value is dropped. */
export const WS_ROLE_KEY = 'wsRole';

type RoleRefusal = { ok: false; status: number; code: string; message: string };

/**
 * What POST /v1/consent's `role` gives, decided before anything is written. `read` (the default) is
 * any consent; on one workspace, to one person on this node, filed under the workspace's creator, it
 * is that person's viewer role. `write` is the contributor role, and only that shape takes it, because
 * the write check (services/organism-namespace-access.ts) reads the creator's consents for one local
 * person on one workspace and nothing else: any other `write` would be stored as a promise no check keeps.
 */
export async function consentWsRole(
  storage: Storage, nodeId: string, fileUnder: string,
  input: { dataPattern: string; recipient: string; role?: unknown },
): Promise<{ ok: true; wsRole: WsRole | null } | RoleRefusal> {
  const role = input.role ?? 'read';
  if (role !== 'read' && role !== 'write') {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'role is "read" or "write".' };
  }
  const ws = /^organism\.([^.*]+)\.w\.([^.*]+)\.\*\*$/.exec(input.dataPattern);
  // One person on this node: `ghii:<name>@<this node>`, cut to an account by localAccountOf, which
  // answers null for an identity of another node; an agent (`#`) is not a person.
  const personIdentity = input.recipient.startsWith('ghii:') ? input.recipient.slice('ghii:'.length) : null;
  const localPerson = personIdentity !== null && !personIdentity.includes('#')
    && personIdentity.endsWith(`@${nodeId}`) && localAccountOf(personIdentity) !== null;
  if (role === 'write' && !ws) {
    return {
      ok: false, status: 400, code: 'WRITE_NOT_SUPPORTED',
      message: 'Write access is given on one workspace: data_pattern organism.<organism>.w.<workspace>.**. A key area, a whole organism or any other pattern takes read only, because no write check reads a permission on it.',
    };
  }
  if (role === 'write' && !localPerson) {
    return {
      ok: false, status: 400, code: 'WRITE_NOT_SUPPORTED',
      message: `Write access goes to one person on this node, recipient ghii:<name>@${nodeId}, and covers that person's agents. An organism's members, a node's users, everyone, a domain, one agent or a person on another node take read only, because the workspace write check matches one local person.`,
    };
  }
  if (!ws || !localPerson) return { ok: true, wsRole: null };
  const creator = (await findWorkspaceRegistration(storage, ws[1], ws[2]))?.creator ?? null;
  const byCreator = creator !== null && fileUnder === `${creator}@${nodeId}`;
  if (role === 'write' && !byCreator) {
    return {
      ok: false, status: 403, code: 'WRITE_NOT_SUPPORTED',
      message: `Only the workspace's creator gives write access with a permission, signed in as themselves, because the write check reads the creator's permissions. An organism admin gives a member write with POST /v1/organisms/${ws[1]}/workspace-access/grant.`,
    };
  }
  if (!byCreator) return { ok: true, wsRole: null };
  return { ok: true, wsRole: role === 'write' ? 'contributor' : 'viewer' };
}

/** The consent dataPattern that scopes a grant to one workspace's content. */
export function wsPattern(orgId: string, ws: string): string {
  return `organism.${orgId}.w.${ws}.**`;
}

/** The bare owner behind any grantee form (owner name / GHII / GAII / GEAI). Bare names pass through. */
export function granteeOwner(grantee: string): string {
  return localAccountName(grantee);
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
    .filter(c => c.dataPattern === pattern && c.recipient === recipient && wsRoleOf(c) !== null);
  for (const g of prior) await storage.updateConsent(g.id, { status: 'revoked', revokedAt: now });
  await storage.createConsent({
    id: randomUUID(), ownerGaii: creatorGhii, dataPattern: pattern, recipient,
    purpose: role === 'contributor' ? 'workspace-contributor' : 'workspace-viewer',
    scope: 'local', expires: null, status: 'active', grantedAt: now, revokedAt: null,
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
    .filter(c => c.dataPattern === pattern && c.recipient === recipient && wsRoleOf(c) !== null);
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
    const role = wsRoleOf(c);
    if (c.dataPattern !== pattern || role === null) continue;
    const owner = localAccountName(c.recipient.replace(/^ghii:/, ''));
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
