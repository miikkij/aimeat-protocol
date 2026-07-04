/**
 * @file invitations.ts
 * @description Framework-agnostic core for EMAIL invitations to people not yet on the node: mint a
 *   single-use, time-limited token, persist the invitation (hash only), notify an already-registered
 *   invitee in-app, and send the invitation email. Shared by the REST routes (src/routes/organisms.ts)
 *   and the MCP tools (src/mcp/organisms.ts) so both entry points create invites identically. The
 *   ACCEPT side (register + join + workspace grants) stays in the route — it is HTTP/session-bound and
 *   not exposed via MCP.
 * @structure constants (expiry/cap); hashInviteToken/inviteEmailHash; InvitationError; invitePublic;
 *   normalizeOrgRole/normalizeWorkspaceGrants; createEmailInvitation().
 * @usage const { invitation, acceptUrl, emailSent } = await createEmailInvitation(storage, config, input);
 * @version-history
 *   v1.0.0 — 2026-07-04 — Initial (email invitations for unregistered users).
 *   v1.1.0 — 2026-07-05 — Add INVITE_CODE_QUOTA_PER_MEMBER + type/provisionedOwner on the record (provisioned-code keys live in routes/organisms.ts).
 */
import { randomBytes, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, OrganismRecord } from '../storage/interface.js';
import type { InvitationRecord, InvitationWorkspaceGrant } from '../storage/repositories/invitation.repository.js';
import { notify } from './notify.js';
import { emitChange } from './event-bus.js';
import { getActiveEmailService } from './email.js';

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
