/**
 * @file app-member-invites.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Invitations to an app's roster for an email address that has no verified account on
 *   this node yet. The owner (or a member who manages the roster) approves by email; when the address
 *   belongs to nobody here, POST /v1/apps/:owner/:filename/members stores one of these and emails the
 *   address. When a person later verifies that address (signup, the verify-email code, recovery, or
 *   an account provisioned with a proven address), every open invitation for it becomes a membership
 *   through the same approval the route runs (services/app-member-approve.ts).
 *
 *   STORAGE. One private record per app and address, under the platform namespace
 *   `app-member-invite`, key `appmeminv.<app segment>.<sha256 of the lowercased address>`, the same
 *   hash the node keeps for a verified address (inviteEmailHash), so the verify step finds the
 *   invitations by the hash it already holds. The address itself is kept as the inviter typed it
 *   (`emailShown`) for the owner's and the managers' list, and is never shown to anybody else.
 *
 *   COST. Applying invitations reads the namespace once per verified address. The namespace holds
 *   at most MAX_OPEN_INVITES_PER_APP open invitations per app, each lives 7 days, and an expired
 *   one met on that read is deleted, so the read does not grow with the age of the node.
 *
 *   THE LINK. Each invitation also holds a sign-up link (services/app-invite-link.ts): the email
 *   opens the invitation page with the address filled in, and the account made there is a member at
 *   once. Sending again replaces the link; cancelling stops it.
 * @structure NS_INVITE · inviteKey · AppMemberInvite · INVITE_DAYS · MAX_OPEN_INVITES_PER_APP ·
 *   listInvites · findInvite · putInvite · removeInvite · sendAppInvite · inviteView ·
 *   applyAppInvitesForVerifiedEmail
 * @usage await applyAppInvitesForVerifiedEmail(storage, config.nodeId, emailHash, ghii);
 * @version-history
 *   v1.1.0 — 2026-10-01 — The invitation carries a sign-up link and lives 7 days (was 30); a cancel
 *     stops the link too. sendAppInvite takes the config and answers the link.
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2, A2).
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { listAppRecords, readAppRecord } from './app-record-keys.js';
import { slugOf, sameApp, accountOf, writePrivateRecord } from './app-members.js';
import { approveMember, appStem } from './app-member-approve.js';
import { appMemberInviteEmail, type NoticeLang } from './app-member-notices.js';
import { inviteEmailHash } from './invitations.js';
import { getActiveEmailService } from './email.js';
import { mintAppInviteLink, cancelAppInviteLinks } from './app-invite-link.js';
import type { AimeatConfig } from '../config.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** Platform-owned and private, like the roster. Never an `ext:` namespace. */
export const NS_INVITE = 'app-member-invite';
export const INVITE_PREFIX = 'appmeminv.';
/** How long an invitation and its sign-up link stay open. The developer's choice of 2026-10-01: a
 *  week is enough, and an inviter whose invitation lapsed sends it again. */
export const INVITE_DAYS = 7;
/** How many open invitations one app may hold, so the roster cannot be used to mail a list. */
export const MAX_OPEN_INVITES_PER_APP = 200;

export const inviteKey = (appId: string, emailHash: string) => `${INVITE_PREFIX}${slugOf(appId)}.${emailHash}`;

/** One open invitation of one address to one app. */
export interface AppMemberInvite {
  id: string;
  appId: string;
  /** sha256 of the lowercased, trimmed address (inviteEmailHash). */
  emailHash: string;
  /** The address as the inviter typed it. Shown to the owner and the managers only. */
  emailShown: string;
  role: string;
  note: string;
  /** The principal that sent it (a GHII or an agent's GAII). */
  invitedBy: string;
  at: string;
  expiresAt: string;
}

const isOpen = (inv: AppMemberInvite, now = Date.now()) => Date.parse(inv.expiresAt) > now;

/** The open invitations of one app, newest first. */
export async function listInvites(storage: Storage, appId: string): Promise<AppMemberInvite[]> {
  const { items } = await listAppRecords(storage, NS_INVITE, INVITE_PREFIX, appId);
  return items
    .map(r => r.value as AppMemberInvite)
    .filter(v => v && sameApp(v.appId, appId) && isOpen(v))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** One invitation of the app by its id, open or not, or null. */
export async function findInvite(storage: Storage, appId: string, id: string): Promise<AppMemberInvite | null> {
  const { items } = await listAppRecords(storage, NS_INVITE, INVITE_PREFIX, appId);
  const hit = items.map(r => r.value as AppMemberInvite).find(v => v && sameApp(v.appId, appId) && v.id === id);
  return hit ?? null;
}

/**
 * Store an invitation, or renew the one already open for the same address (new role, note and
 * expiry; the id stays, so a link the inviter kept still names it).
 */
export async function putInvite(
  storage: Storage,
  input: { appId: string; emailHash: string; emailShown: string; role: string; note?: string; invitedBy: string },
): Promise<AppMemberInvite> {
  const key = inviteKey(input.appId, input.emailHash);
  const prev = (await readAppRecord(storage, NS_INVITE, key, input.appId))?.value as AppMemberInvite | undefined;
  const now = new Date();
  const rec: AppMemberInvite = {
    id: prev?.id ?? `inv_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    appId: input.appId,
    emailHash: input.emailHash,
    emailShown: input.emailShown.trim().slice(0, 254),
    role: input.role,
    note: (input.note ?? '').slice(0, 400),
    invitedBy: input.invitedBy,
    at: now.toISOString(),
    expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString(),
  };
  await writePrivateRecord(storage, NS_INVITE, key, rec, { tags: ['app-member'], createdAt: prev ? undefined : rec.at });
  return rec;
}

/** Delete the invitation of one address to one app. */
export async function removeInvite(storage: Storage, appId: string, emailHash: string): Promise<void> {
  await readAppRecord(storage, NS_INVITE, inviteKey(appId, emailHash), appId);
  await storage.deleteMemory(NS_INVITE, inviteKey(appId, emailHash));
  // The emailed sign-up link stops with the invitation.
  await cancelAppInviteLinks(storage, appId, emailHash);
}

/**
 * Store the invitation and email the address. The address must already have been looked up and
 * found to belong to no verified account (resolveContactEmail, which also counts the lookup). The
 * email is best-effort: `emailSent` says whether it left, and the invitation is applied on the
 * address's verification either way.
 *
 * @param input.lang the email's language (en, fi or es)
 * @param input.appUrl the address a person opens the app at (routes/apps/helpers.ts resolveAppUrls)
 * @param input.inviterName who invites, as the recipient should read it (their display name)
 */
export async function sendAppInvite(
  storage: Storage,
  config: AimeatConfig,
  input: {
    appId: string; filename: string; email: string; role: string; note?: string; invitedBy: string;
    inviterName: string; appUrl: string; lang: NoticeLang;
  },
): Promise<{ invite: AppMemberInvite; emailSent: boolean; acceptUrl: string | null }> {
  const invite = await putInvite(storage, {
    appId: input.appId, emailHash: inviteEmailHash(input.email), emailShown: input.email,
    role: input.role, note: input.note, invitedBy: input.invitedBy,
  });
  // The sign-up link (services/app-invite-link.ts). Without it the email still links to the app and
  // the invitation still applies on a confirmed address, as before the link existed.
  let acceptUrl: string | null = null;
  try {
    acceptUrl = await mintAppInviteLink(storage, config, {
      appId: input.appId, appInviteId: invite.id, app: appStem(input.filename), email: input.email,
      role: input.role, note: input.note, invitedBy: input.invitedBy, appUrl: input.appUrl, expiresAt: invite.expiresAt,
    });
  } catch (err) {
    logger.warn('app-member-invites: the sign-up link was not made, the email links to the app', { error: String(err) });
  }
  let emailSent = false;
  const mail = getActiveEmailService();
  if (mail?.enabled) {
    const { subject, html, text } = appMemberInviteEmail(input.lang, {
      inviter: input.inviterName, app: appStem(input.filename), role: input.role, appUrl: input.appUrl, acceptUrl,
      // An ISO date: the address has no account here, so nothing says how its reader writes dates.
      date: invite.expiresAt.slice(0, 10),
    });
    try {
      emailSent = await mail.sendRaw(input.email.trim(), subject, html, text);
    } catch (err) {
      logger.warn('app-member-invites: the invitation email failed, the invitation stands', { error: String(err) });
    }
  }
  return { invite, emailSent, acceptUrl };
}

/** The invitation as the owner's and the managers' list shows it: without the address hash. */
export function inviteView(inv: AppMemberInvite): Omit<AppMemberInvite, 'emailHash'> {
  return {
    id: inv.id, appId: inv.appId, emailShown: inv.emailShown, role: inv.role, note: inv.note,
    invitedBy: inv.invitedBy, at: inv.at, expiresAt: inv.expiresAt,
  };
}

/**
 * Turn every open invitation of a just-verified address into a membership. Called where a verified
 * address binding is made (routes/ghii/web-verify.ts, routes/ghii/recovery.ts,
 * services/owner-provisioning.ts), beside promoteContactsForVerifiedEmail, and best-effort in the same
 * way: the caller logs a failure and the verification still completes.
 *
 * An invitation whose app is gone, which names the app's own owner, or which has expired is deleted.
 * One the approval refuses (every seat taken) stays open and is tried again at the next verification
 * of the same address. Returns how many memberships were made.
 */
export async function applyAppInvitesForVerifiedEmail(
  storage: Storage, nodeId: string, emailHash: string, ghii: string,
): Promise<number> {
  if (!emailHash || !ghii) return 0;
  const account = accountOf(ghii);
  if (!account) return 0;
  const { items } = await listAppRecords(storage, NS_INVITE, INVITE_PREFIX);
  let made = 0;
  for (const row of items) {
    const inv = row.value as AppMemberInvite | null;
    if (!inv || inv.emailHash !== emailHash || !row.key.endsWith(`.${emailHash}`)) continue;
    const slash = inv.appId.indexOf('/');
    const owner = slash > 0 ? inv.appId.slice(0, slash) : '';
    const filename = slash > 0 ? inv.appId.slice(slash + 1) : '';
    const drop = () => storage.deleteMemory(NS_INVITE, row.key);
    if (!isOpen(inv) || !owner || accountOf(owner) === account) { await drop(); continue; }
    const ownerGhii = await resolveGhii(storage, owner, { nodeId });
    if (!(await storage.getApp(ownerGhii, filename))) { await drop(); continue; }
    const result = await approveMember(storage, nodeId, {
      appId: inv.appId, owner, filename, account, role: inv.role, note: inv.note || undefined,
      approvedBy: localAccountName(inv.invitedBy).toLowerCase(), by: inv.invitedBy, ownerGhii,
      auditDetail: { via: 'invite', invite: inv.id },
    });
    if (!result.ok) {
      logger.warn('app-member-invites: an invitation could not be applied yet, it stays open', { appId: inv.appId, code: result.code });
      continue;
    }
    await drop();
    made++;
  }
  if (made) logger.info('app-member-invites: invitations became memberships', { ghii, made });
  return made;
}
