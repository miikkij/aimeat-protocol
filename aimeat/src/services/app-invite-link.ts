/**
 * @file src/services/app-invite-link.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sign-up link in an app invitation. An app invitation (services/app-member-invites.ts)
 *   used to link to the app only, so the invited person had to register with the same address and
 *   confirm it before the invitation applied. Now each invitation also holds one row in the
 *   invitations table, type 'app', and its email links to the same invitation page organism
 *   invitations use (/v1/invite?token=...): the address is filled in and locked, the account it
 *   creates starts with that address confirmed (opening the emailed link proves the person reads that
 *   mail), and the hook that applies app invitations on a confirmed address makes the person a
 *   member before the page returns them to the app.
 *
 *   WHAT THE TOKEN IS. 32 random bytes, hex, sent only in the link; the row keeps its SHA-256, as
 *   every invitation does. It is used once, expires with the app invitation (7 days), and dies when
 *   the invitation is cancelled or sent again (a new invitation to the same address mints a new link
 *   and cancels the old one, because a raw token cannot be read back to send twice). It grants
 *   nothing an invitation does not: the app membership in the invited role, for that address only.
 *   A signed-in person whose confirmed address differs is refused (routes/invite-accept.ts).
 *
 *   THE ROW. organismId null, workspaces [], returnUrl the app's address (checked against the
 *   allowlist at mint and again at redirect), meta { appId, appInviteId, role, app } so the accept
 *   page can say what the invitation is for and the accept route can check the app invitation is
 *   still open before anything is created.
 * @structure APP_INVITE_TYPE · AppInviteMeta · appInviteMeta · mintAppInviteLink · cancelAppInviteLinks
 * @usage
 *   const acceptUrl = await mintAppInviteLink(storage, config, { appId, appInviteId, email, role, ... });
 *   await cancelAppInviteLinks(storage, appId, emailHash);
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2 leftover 6, approved by the developer: 7 days).
 */
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { InvitationRecord } from '../storage/repositories/invitation.repository.js';
import { hashInviteToken, inviteEmailHash, resolveInvitationReturnTarget } from './invitations.js';
import { localAccountName } from '../utils/gaii.js';

/** The invitation type of an app invitation's link. */
export const APP_INVITE_TYPE = 'app' as const;

/** What an app invitation's row carries besides the shared shape. */
export interface AppInviteMeta {
  appId: string;
  appInviteId: string;
  role: string;
  /** The app's name as the invitation names it (its file name without .html). */
  app: string;
}

/** The meta of an app invitation row, or null when the row is not one. */
export function appInviteMeta(inv: Pick<InvitationRecord, 'type' | 'meta'>): AppInviteMeta | null {
  if (inv.type !== APP_INVITE_TYPE || !inv.meta) return null;
  const m = inv.meta as Partial<AppInviteMeta>;
  return typeof m.appId === 'string' && typeof m.appInviteId === 'string' && typeof m.role === 'string'
    ? { appId: m.appId, appInviteId: m.appInviteId, role: m.role, app: typeof m.app === 'string' ? m.app : m.appId }
    : null;
}

/** The pending link rows of one app for one address. */
async function pendingLinks(storage: Storage, appId: string, emailHash: string): Promise<InvitationRecord[]> {
  const rows = await storage.listInvitationsByEmailHash(emailHash, { status: 'pending' });
  return rows.filter(r => appInviteMeta(r)?.appId === appId);
}

/** Cancel every pending link of one app for one address. */
export async function cancelAppInviteLinks(storage: Storage, appId: string, emailHash: string): Promise<number> {
  const rows = await pendingLinks(storage, appId, emailHash);
  for (const r of rows) await storage.updateInvitation(r.id, { status: 'cancelled' });
  return rows.length;
}

/**
 * Mint the link of one app invitation, cancelling any link sent for it before. Answers the address
 * the email carries.
 */
export async function mintAppInviteLink(
  storage: Storage,
  config: AimeatConfig,
  input: {
    appId: string; appInviteId: string; app: string; email: string; role: string; note?: string;
    invitedBy: string; appUrl: string; expiresAt: string;
  },
): Promise<string> {
  const emailHash = inviteEmailHash(input.email);
  await cancelAppInviteLinks(storage, input.appId, emailHash);
  const token = randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const meta: AppInviteMeta = { appId: input.appId, appInviteId: input.appInviteId, role: input.role, app: input.app };
  await storage.createInvitation({
    id: uuidv4(),
    tokenHash: hashInviteToken(token),
    organismId: null,
    orgRole: 'member',
    type: APP_INVITE_TYPE,
    workspaces: [],
    email: input.email.trim(),
    emailHash,
    invitedBy: localAccountName(input.invitedBy).toLowerCase(),
    provisionedOwner: null,
    message: input.note ? input.note.slice(0, 400) : null,
    status: 'pending',
    createdAt: now,
    expiresAt: input.expiresAt,
    acceptedAt: null,
    acceptedBy: null,
    returnUrl: resolveInvitationReturnTarget(input.appUrl, config),
    meta: meta as unknown as Record<string, unknown>,
  });
  return `${config.baseUrl}/v1/invite?token=${token}`;
}
