/**
 * @file invitations.ts
 * @description Framework-agnostic core for organism invitations, shared by the REST routes
 *   (src/routes/organisms/*) and the MCP tools (src/mcp/organisms.ts) so both entry points behave
 *   identically. Covers BOTH invitation kinds: (1) EMAIL invitations to people not yet on the node —
 *   mint a single-use, time-limited token, persist the invitation (hash only), notify an already-
 *   registered invitee in-app, send the email; the accept side (register + session) stays in the
 *   route. (2) NAME invitations + DIRECT ADDS of already-registered local owners — carry an org role
 *   and per-workspace grants chosen at invite time (membership row `role` + `invitedWorkspaces`),
 *   editable while pending, applied via applyInvitationWorkspaceGrants on accept (or immediately on
 *   a direct add).
 * @structure constants (expiry/cap); hashInviteToken/inviteEmailHash; InvitationError; invitePublic;
 *   normalizeOrgRole/normalizeInviteeName/normalizeWorkspaceGrants; findWorkspaceEntry;
 *   applyInvitationWorkspaceGrants; createNameInvitation/updateNameInvitation/cancelNameInvitation/
 *   acceptNameInvitation/addOrganismMember; createEmailInvitation().
 * @usage const { invitation, acceptUrl, emailSent } = await createEmailInvitation(storage, config, input);
 *   const membership = await createNameInvitation(storage, config, { organism, inviterGhii, inviteeRaw, role, workspaces });
 * @version-history
 *   v1.3.0 — 2026-07-16 — Name-invite core: role + invitedWorkspaces at invite time, direct add
 *     (addOrganismMember), pending-invite update/cancel, shared grant application
 *     (applyInvitationWorkspaceGrants extracted from the email-accept + code-mint loops).
 *   v1.2.0 — 2026-07-10 — Add normalizeInviteeName(): shared trim/lowercase/@node-strip for name-invites
 *     (REST + MCP) so memberships + notifications land on the identity the invitee actually signs in as.
 *   v1.1.0 — 2026-07-05 — Add INVITE_CODE_QUOTA_PER_MEMBER + type/provisionedOwner on the record (provisioned-code keys live in routes/organisms.ts).
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 */
import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../storage/interface.js';
import type { InvitationRecord, InvitationWorkspaceGrant } from '../storage/repositories/invitation.repository.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { getActiveEmailService } from './email.js';
import { grantWorkspaceRole } from './workspace-roles.js';

export const INVITE_DEFAULT_EXPIRY_DAYS = 7;
export const INVITE_MAX_EXPIRY_DAYS = 30;
export const INVITE_MAX_PENDING_PER_ORG = 50; // abuse cap on outstanding email invites per organism
export const INVITE_CODE_QUOTA_PER_MEMBER = 3; // per-inviter cap on provisioned-code keys; org creators/admins are exempt (unlimited)
const INVITE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 86_400_000;

/** SHA-256 of the raw invite token — only the hash is stored; the raw token lives only in the link. */
export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
/** SHA-256 of a normalized email — matches GHII.emailHash hashing (existing-user detection). */
export function inviteEmailHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/** A validation/precondition failure the caller maps to its own error shape (HTTP envelope / MCP text). */
export class InvitationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'InvitationError';
  }
}

/** Safe public projection of an invitation (never leaks the token hash). */
export function invitePublic(inv: InvitationRecord) {
  return {
    id: inv.id,
    email: inv.email,
    organism_id: inv.organismId,
    org_role: inv.orgRole,
    type: inv.type,
    provisioned_owner: inv.provisionedOwner,
    workspaces: inv.workspaces,
    status: inv.status,
    invited_by: inv.invitedBy,
    message: inv.message,
    created_at: inv.createdAt,
    expires_at: inv.expiresAt,
    accepted_at: inv.acceptedAt,
  };
}

export function normalizeOrgRole(role: unknown): 'member' | 'admin' {
  return role === 'admin' ? 'admin' : 'member';
}

/**
 * Normalize a name-invite invitee the same way registration normalizes usernames (ghii.ts): trim,
 * lowercase, and accept the full local GHII form by stripping a matching `@node-id` suffix.
 * Membership rows and notifications are keyed by the bare lowercase owner name — an unnormalized
 * invitee ("Alice", "alice ") would be written under an identity nobody authenticates as and the
 * invitation would be permanently invisible to the invitee. Returns null for a remote identity
 * (`someone@other-node`), which name-invites don't support.
 */
export function normalizeInviteeName(raw: string, nodeId: string): string | null {
  let name = raw.trim().toLowerCase();
  const atIdx = name.indexOf('@');
  if (atIdx !== -1) {
    if (name.substring(atIdx + 1) !== nodeId) return null;
    name = name.substring(0, atIdx);
  }
  return name;
}

/** Normalize a raw workspaces input into de-duplicated { ws, role } grants. */
export function normalizeWorkspaceGrants(raw: unknown): InvitationWorkspaceGrant[] {
  const out: InvitationWorkspaceGrant[] = [];
  if (!Array.isArray(raw)) return out;
  for (const w of raw) {
    const ws = typeof (w as { ws?: unknown })?.ws === 'string'
      ? (w as { ws: string }).ws
      : (typeof w === 'string' ? w : '');
    if (!ws) continue;
    const role: 'viewer' | 'contributor' = (w as { role?: unknown })?.role === 'contributor' ? 'contributor' : 'viewer';
    if (!out.some(g => g.ws === ws)) out.push({ ws, role });
  }
  return out;
}

export interface CreateEmailInvitationInput {
  organism: OrganismRecord;
  inviterGhii: string; // bare owner name of the creator/admin
  email: string;
  orgRole: 'member' | 'admin';
  workspaces: InvitationWorkspaceGrant[]; // caller has authorized these (org creator/admin can grant any)
  message?: string | null;
  expiresInDays?: number;
}

export interface CreateEmailInvitationResult {
  invitation: InvitationRecord;
  rawToken: string;
  acceptUrl: string;
  emailSent: boolean;
  existingUser: boolean;
}

/**
 * Validate + persist an email invitation, ping an already-registered invitee in-app, and send the
 * invitation email (best-effort). Throws InvitationError on bad email / dedupe / cap violations.
 */
export async function createEmailInvitation(
  storage: Storage,
  config: AimeatConfig,
  input: CreateEmailInvitationInput,
): Promise<CreateEmailInvitationResult> {
  const cleanEmail = (input.email || '').trim().toLowerCase();
  if (!cleanEmail || !INVITE_EMAIL_RE.test(cleanEmail)) {
    throw new InvitationError(400, 'INVALID_INPUT', 'A valid "email" is required');
  }
  const id = input.organism.id;
  const emailHash = inviteEmailHash(cleanEmail);

  const pending = await storage.listInvitationsByOrganism(id, { status: 'pending' });
  if (pending.length >= INVITE_MAX_PENDING_PER_ORG) {
    throw new InvitationError(429, 'TOO_MANY_INVITES', 'This organism has too many pending invitations — cancel some before sending more');
  }
  if (pending.some(p => p.emailHash === emailHash)) {
    throw new InvitationError(409, 'ALREADY_INVITED', 'There is already a pending invitation for that email');
  }

  const days = Number.isFinite(Number(input.expiresInDays))
    ? Math.min(INVITE_MAX_EXPIRY_DAYS, Math.max(1, Math.floor(Number(input.expiresInDays))))
    : INVITE_DEFAULT_EXPIRY_DAYS;
  const now = Date.now();
  const rawToken = randomBytes(32).toString('hex');
  const invitation: InvitationRecord = {
    id: uuidv4(),
    tokenHash: hashInviteToken(rawToken),
    organismId: id,
    orgRole: input.orgRole,
    type: 'link',
    workspaces: input.workspaces,
    email: cleanEmail,
    emailHash,
    invitedBy: input.inviterGhii,
    provisionedOwner: null,
    message: (input.message && input.message.trim()) ? input.message.trim().slice(0, 1000) : null,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * DAY_MS).toISOString(),
    acceptedAt: null,
    acceptedBy: null,
  };
  await storage.createInvitation(invitation);

  // The accept URL (same construction as the magic link) — the raw token lives ONLY here.
  const acceptUrl = `${config.baseUrl}/v1/invite?token=${rawToken}`;

  // If the email already maps to a registered user, also ping them in-app (email still sent below).
  const existing = await storage.getGHIIByEmailHash(emailHash);
  if (existing) {
    await notify(storage, existing.ghii, {
      type: 'organism_invitation',
      title: `${input.inviterGhii} invited you to join "${input.organism.name}"`,
      link: `/v1/invite?token=${rawToken}`,
    });
    emitChange('notifications');
  }

  // Send the invitation email (best-effort; a disabled transport returns false).
  const emailSvc = getActiveEmailService();
  let emailSent = false;
  if (emailSvc?.enabled) {
    emailSent = await emailSvc.sendInvite(cleanEmail, {
      orgName: input.organism.name,
      inviterName: input.inviterGhii,
      acceptUrl,
      workspaces: invitation.workspaces.map(g => ({ ws: g.ws, role: g.role })),
      message: invitation.message,
      expiresLabel: invitation.expiresAt.slice(0, 10),
    }, existing?.locale);
  }

  emitChange('organisms');
  return { invitation, rawToken, acceptUrl, emailSent, existingUser: !!existing };
}

/* ══ Name invitations + direct adds — already-registered LOCAL owners ══
 * The membership row IS the invitation (status 'invited'); `role` + `invitedWorkspaces` carry the
 * access chosen at invite time so the invitee lands with the right rights the moment they accept.
 * A direct add skips the accept round-trip entirely (product decision 2026-07-16): the member is
 * active immediately, grants applied, and they are notified (they can always leave). */

/** Find a workspace's registry entry across every member's registry copy (one key per creator).
 *  Standalone twin of routes/organisms/shared.ts findWsEntry so the service layer needs no route
 *  helper bag. */
export async function findWorkspaceEntry(
  storage: Storage, orgId: string, ws: string,
): Promise<{ id: string; name?: string; createdBy?: string; ownerGaii: string } | null> {
  const regKey = `organism.${orgId}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = (rec.value as { workspaces?: Array<{ id: string; name?: string; createdBy?: string }> } | null)?.workspaces ?? [];
    const entry = list.find(w => w.id === ws);
    if (entry) return { ...entry, ownerGaii: rec.ownerGaii };
  }
  return null;
}

/** The bare owner behind a memory record's owner identity (`agent#owner@node` / `owner@node` → `owner`). */
function bareOwnerOf(gaii: string): string {
  return (gaii.includes('#') ? gaii.split('#')[1] : gaii).split('@')[0];
}

/**
 * Apply a set of invite-time workspace grants to a grantee: resolve each workspace's creator (= the
 * consent owner) and grant the role with source 'invite'. Skips a deleted workspace and the case
 * where the grantee IS the creator. The ONE code path behind email-invite accept, code-invite mint,
 * name-invite accept, and direct add. Returns the workspace ids actually granted.
 */
export async function applyInvitationWorkspaceGrants(
  storage: Storage,
  config: AimeatConfig,
  args: { orgId: string; grants: InvitationWorkspaceGrant[]; grantee: string; invitedBy: string },
): Promise<string[]> {
  const granted: string[] = [];
  for (const g of args.grants) {
    const entry = await findWorkspaceEntry(storage, args.orgId, g.ws);
    if (!entry) continue; // workspace deleted since the invite — skip
    const createdBy = entry.createdBy ?? bareOwnerOf(entry.ownerGaii);
    if (createdBy === args.grantee) continue; // the creator already has full access
    await grantWorkspaceRole(storage, config, {
      creatorGhii: `${createdBy}@${config.nodeId}`, orgId: args.orgId, ws: g.ws,
      grantee: args.grantee, role: g.role, source: 'invite', grantedBy: args.invitedBy,
    });
    granted.push(g.ws);
  }
  return granted;
}

/** Validate that every grant's workspace exists (invite/update time — an org creator/admin may grant
 *  any existing workspace, so existence is the only per-grant precondition). */
async function assertWorkspacesExist(storage: Storage, orgId: string, grants: InvitationWorkspaceGrant[]): Promise<void> {
  for (const g of grants) {
    if (!(await findWorkspaceEntry(storage, orgId, g.ws))) {
      throw new InvitationError(404, 'WORKSPACE_NOT_FOUND', `Workspace "${g.ws}" not found in this organism`);
    }
  }
}

/** Normalize + validate a name-invite / direct-add target. Throws InvitationError on a remote name,
 *  an unknown owner, or a conflicting membership state. Returns the bare owner name + any existing
 *  membership row (for the caller to upgrade/replace where that is legal). */
async function resolveInvitee(
  storage: Storage, config: AimeatConfig, organismId: string, inviteeRaw: string,
): Promise<{ invitee: string; existing: OrganismMembershipRecord | null }> {
  const invitee = normalizeInviteeName(inviteeRaw, config.nodeId);
  if (!invitee) throw new InvitationError(400, 'INVALID_INPUT', 'Invitee belongs to another node — name-invites work for local owners only');
  if (!(await storage.getOwner(invitee))) throw new InvitationError(404, 'OWNER_NOT_FOUND', `No owner named "${invitee}" on this node`);
  const existing = await storage.getMembership(organismId, invitee);
  if (existing && existing.status === 'active') throw new InvitationError(409, 'ALREADY_MEMBER', 'That owner is already a member');
  if (existing && existing.status === 'banned') throw new InvitationError(409, 'BANNED', 'That owner is blocked — lift the block before inviting');
  return { invitee, existing };
}

export interface NameInviteInput {
  organism: OrganismRecord;
  inviterGhii: string;            // bare owner name of the creator/admin (caller has authorized)
  inviteeRaw: string;
  role?: unknown;                 // normalized via normalizeOrgRole
  workspaces?: unknown;           // normalized via normalizeWorkspaceGrants
}

/** Create a name invitation carrying role + workspace grants. Throws InvitationError. */
export async function createNameInvitation(
  storage: Storage, config: AimeatConfig, input: NameInviteInput,
): Promise<OrganismMembershipRecord> {
  const { invitee, existing } = await resolveInvitee(storage, config, input.organism.id, input.inviteeRaw);
  if (existing && existing.status === 'invited') throw new InvitationError(409, 'ALREADY_INVITED', 'That owner already has a pending invitation');
  const role = normalizeOrgRole(input.role);
  const grants = normalizeWorkspaceGrants(input.workspaces);
  await assertWorkspacesExist(storage, input.organism.id, grants);

  const now = new Date().toISOString();
  const membership = await storage.createMembership({
    id: uuidv4(), organismId: input.organism.id, ghii: invitee,
    role, status: 'invited', invitedBy: input.inviterGhii, joinedAt: now,
    invitedWorkspaces: grants.length ? grants : undefined,
  });
  await notify(storage, `${invitee}@${config.nodeId}`, {
    type: 'organism_invitation',
    title: `${input.inviterGhii} invited you to join "${input.organism.name}"`,
    link: '/v1/profile#organisms',
  });
  emitChange('notifications', `${invitee}@${config.nodeId}`);
  emitChange('organisms');
  return membership;
}

/** Edit a PENDING name invitation's role and/or workspace grants (rights stay editable before the
 *  invitee accepts — product decision 2026-07-16). Throws InvitationError. */
export async function updateNameInvitation(
  storage: Storage, config: AimeatConfig,
  input: { organism: OrganismRecord; inviteeRaw: string; role?: unknown; workspaces?: unknown },
): Promise<OrganismMembershipRecord> {
  const invitee = normalizeInviteeName(input.inviteeRaw, config.nodeId);
  const membership = invitee ? await storage.getMembership(input.organism.id, invitee) : null;
  if (!membership || membership.status !== 'invited') {
    throw new InvitationError(404, 'NO_INVITATION', 'No pending invitation for that owner');
  }
  const updates: Partial<OrganismMembershipRecord> = {};
  if (input.role !== undefined) updates.role = normalizeOrgRole(input.role);
  if (input.workspaces !== undefined) {
    const grants = normalizeWorkspaceGrants(input.workspaces);
    await assertWorkspacesExist(storage, input.organism.id, grants);
    updates.invitedWorkspaces = grants;
  }
  const updated = await storage.updateMembership(membership.id, updates);
  emitChange('organisms');
  return updated ?? { ...membership, ...updates };
}

/** Cancel a PENDING name invitation (creator/admin). Throws InvitationError when none exists. */
export async function cancelNameInvitation(
  storage: Storage, config: AimeatConfig,
  input: { organism: OrganismRecord; cancellerGhii: string; inviteeRaw: string },
): Promise<void> {
  const invitee = normalizeInviteeName(input.inviteeRaw, config.nodeId);
  const membership = invitee ? await storage.getMembership(input.organism.id, invitee) : null;
  if (!membership || membership.status !== 'invited') {
    throw new InvitationError(404, 'NO_INVITATION', 'No pending invitation for that owner');
  }
  await storage.deleteMembership(membership.id);
  await notify(storage, `${membership.ghii}@${config.nodeId}`, {
    type: 'organism_invitation_cancelled',
    title: `Your invitation to "${input.organism.name}" was withdrawn`,
    link: '/v1/profile#organisms',
  });
  emitChange('notifications', `${membership.ghii}@${config.nodeId}`);
  emitChange('organisms');
}

/**
 * The invitee accepts: activate the membership, sync the organism roster arrays (admins too when the
 * invite carried role 'admin'), apply the invite-time workspace grants, clear them off the row, and
 * tell the inviter. The ONE accept path shared by REST and MCP. Returns the granted workspace ids.
 */
export async function acceptNameInvitation(
  storage: Storage, config: AimeatConfig,
  input: { organism: OrganismRecord; membership: OrganismMembershipRecord },
): Promise<string[]> {
  const { organism, membership } = input;
  const invitee = membership.ghii;
  const now = new Date().toISOString();
  await storage.updateMembership(membership.id, { status: 'active', joinedAt: now, invitedWorkspaces: [] });
  await storage.updateOrganism(organism.id, {
    members: [...new Set([...organism.members, invitee])],
    admins: membership.role === 'admin' ? [...new Set([...organism.admins, invitee])] : organism.admins,
    updatedAt: now,
  });
  const granted = await applyInvitationWorkspaceGrants(storage, config, {
    orgId: organism.id, grants: membership.invitedWorkspaces ?? [],
    grantee: invitee, invitedBy: membership.invitedBy ?? invitee,
  });
  if (membership.invitedBy) {
    await notify(storage, `${membership.invitedBy}@${config.nodeId}`, {
      type: 'organism_invitation_accepted',
      title: `${invitee} accepted your invitation to "${organism.name}"`,
      link: '/v1/profile#organisms',
    });
    emitChange('notifications');
  }
  emitChange('organisms');
  return granted;
}

/**
 * DIRECT ADD — a creator/admin adds an existing local owner as an ACTIVE member with role +
 * workspace grants applied immediately, no accept round-trip (product decision 2026-07-16: the
 * notification + the ability to leave replace the consent step). A pending name-invite for the same
 * owner is upgraded in place. Throws InvitationError. Returns the membership + granted workspaces.
 */
export async function addOrganismMember(
  storage: Storage, config: AimeatConfig, input: NameInviteInput,
): Promise<{ membership: OrganismMembershipRecord; grantedWorkspaces: string[] }> {
  const { invitee, existing } = await resolveInvitee(storage, config, input.organism.id, input.inviteeRaw);
  const role = normalizeOrgRole(input.role);
  const grants = normalizeWorkspaceGrants(input.workspaces);
  await assertWorkspacesExist(storage, input.organism.id, grants);

  const now = new Date().toISOString();
  let membership: OrganismMembershipRecord;
  if (existing) { // status 'invited' or legacy 'pending' — upgrade in place
    membership = (await storage.updateMembership(existing.id, { status: 'active', role, joinedAt: now, invitedWorkspaces: [] }))
      ?? { ...existing, status: 'active', role, joinedAt: now };
  } else {
    membership = await storage.createMembership({
      id: uuidv4(), organismId: input.organism.id, ghii: invitee,
      role, status: 'active', invitedBy: input.inviterGhii, joinedAt: now,
    });
  }
  await storage.updateOrganism(input.organism.id, {
    members: [...new Set([...input.organism.members, invitee])],
    admins: role === 'admin' ? [...new Set([...input.organism.admins, invitee])] : input.organism.admins,
    updatedAt: now,
  });
  const grantedWorkspaces = await applyInvitationWorkspaceGrants(storage, config, {
    orgId: input.organism.id, grants, grantee: invitee, invitedBy: input.inviterGhii,
  });
  await notify(storage, `${invitee}@${config.nodeId}`, {
    type: 'organism_member_added',
    title: `${input.inviterGhii} added you to "${input.organism.name}" as ${role}`,
    link: '/v1/profile#organisms',
  });
  emitChange('notifications', `${invitee}@${config.nodeId}`);
  emitChange('organisms');
  return { membership, grantedWorkspaces };
}
