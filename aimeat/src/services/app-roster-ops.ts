/**
 * @file src/services/app-roster-ops.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The member-roster operations that read the roster or decide one pending thing: the
 *   roster, the caller's own standing, the carry plan read, dismissing a guest, the sweep, asking to
 *   join, declining an ask, the roster's audit trail and cancelling an invitation. Each one holds the
 *   who-may test, the refusals, the audit row and the notification its REST route held, and answers
 *   an AppOpOutcome. The routes (routes/app-members.ts, routes/app-members-extra.ts) and the
 *   aimeat_app_manage MCP tool (mcp/app-manage.ts) both call these.
 *
 *   The writes that give or take access (the plan, an approval, a removal) are in app-roster-write.ts.
 * @structure listRoster · rosterMe · readCarryPlan · dismissGuest · sweepRoster · requestMembership ·
 *   declineRequest · rosterAuditTrail · cancelInvite
 * @usage const out = await listRoster(storage, config, caller, { owner, filename }, req.query);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved out of the handlers of routes/app-members.ts and
 *     routes/app-members-extra.ts by extraction; aimeat_app_manage calls the service in place of the
 *     route over loopback HTTP (secaudit 2026-10, M6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { accountOf, getRequest, putRequest, noteVisit, forgetVisit } from './app-members.js';
import { sweepLapsedMemberships } from './app-member-sweep.js';
import { memberAddress, appDeepLink, appStem } from './app-member-approve.js';
import { reaskRetryAt, suggestRole, parseRosterPaging, memberAuditRows, isManagerRole } from './app-member-rules.js';
import { rosterView, memberRosterView, displayNamesOf, sampleRoles } from './app-member-roster.js';
import { sendMemberNotice, memberActionLabel } from './app-member-notices.js';
import { findInvite, removeInvite, inviteView } from './app-member-invites.js';
import { readAppAudit } from './app-audit.js';
import { readAllEntries } from './app-audit-archive.js';
import { rosterContext, rosterBucketOf, rosterAudit, type RosterCaller } from './app-roster-context.js';
import { done, refuse, type AppOpOutcome } from './app-op-outcome.js';

/** The app an operation addresses: the `:owner` and `:filename` of its route. */
export interface AppRef { owner: string; filename: string }

/** A manager reaching for a managing role: only the owner appoints or removes a manager. */
export const MANAGER_ROLE_MSG = 'Only the app owner gives, changes or takes away a role that manages the roster.';

const forbidden = (message: string) => refuse(403, 'FORBIDDEN', message);

/** GET .../members: the roster. Owner and managers; members when the app shows it to them. */
export async function listRoster(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, query: Record<string, unknown>,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  const paging = parseRosterPaging(query);
  if (!c.canManage) {
    // An app can open the roster to its own members, and some have to: a board that renders by
    // reading each member's posts shows an empty page to everyone if only the owner may see who
    // the members are. It stays shut unless the app says otherwise.
    if (c.plan?.rosterVisibility !== 'members') return forbidden('Only the app owner reads its roster');
    if (!c.callerMember) return forbidden('This app shows its roster to its members. You are not one yet.');
    // Names, roles and join dates. The note somebody wrote when they asked, who approved them and
    // what they are carried on are the owner's business, not the other members'.
    const v = await memberRosterView(storage, c.appId, paging);
    return done({
      members: v.members, requests: [], count: v.total, redacted: true,
      total: { members: v.total, requests: 0, seen: 0, invites: 0 }, limit: paging.limit, offset: paging.offset,
    });
  }
  // Everybody who turned up and holds no role is listed too (`seen`): a roster tells the owner who
  // they already said yes to; this tells them who is there to say yes TO. A person appears in
  // exactly one place: promoted, waiting, or just here.
  // The owner's view names the address the owner keeps for each person in their own address book.
  const v = await rosterView(storage, c.appId, paging,
    c.isOwner ? { ownerGhii: await rosterBucketOf(storage, config, c.owner), nodeId: config.nodeId } : null);
  return done({
    members: v.members, requests: v.requests, seen: v.seen, invites: v.invites, count: v.total.members,
    total: v.total, limit: paging.limit, offset: paging.offset, isOwner: c.isOwner, canManage: true,
  });
}

/** GET .../members/me: the caller's own standing. Any authenticated caller. */
export async function rosterMe(storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  const member = c.callerMember;
  // Asking "where do I stand" IS turning up: this is what the library calls when an app loads, so
  // it is the honest moment to record a visit. Throttled to one write an hour per person, so a page
  // that re-renders does not turn one visitor into a hundred. The owner is not a guest in their own
  // app, and neither is somebody who already holds a role.
  if (!c.isOwner && !member) {
    try {
      await noteVisit(storage, c.appId, c.callerAccount);
    } catch (err) {
      // Nobody's standing depends on this being written. Losing a visit is not worth an error.
      logger.warn('app-members: could not note a visit', { error: String(err) });
    }
  }
  const mine = c.isOwner ? null : await getRequest(storage, c.appId, c.callerAccount);
  // The member's own row without the owner's side of it: the note the owner kept with the decision
  // and who approved them are the owner's records, not something the app shows the member.
  const own = member ? (({ note: _note, approvedBy: _by, ...rest }) => rest)(member) : null;
  const retryAt = reaskRetryAt(mine);
  return done({
    member: own, isOwner: c.isOwner, canManage: c.canManage,
    displayName: (await displayNamesOf(storage, [c.callerAccount])).get(c.callerAccount) ?? null,
    role: c.isOwner ? 'owner' : (member?.role ?? null),
    requested: mine ? { at: mine.at, state: mine.state, note: mine.note, ...(retryAt ? { retryAt } : {}) } : null,
  });
}

/** GET .../members/plan: what each role is CARRIED on. Owner only. */
export async function readCarryPlan(storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.isOwner) return forbidden('Only the app owner reads its carry plan');
  const plan = c.plan;
  return done({
    plan,
    meaning: plan
      ? 'Approving somebody as one of these roles issues a zero-priced grant over the listed offerings, and removing them withdraws those grants again.'
      : 'No plan declared: an approval sets a role and carries nothing, so a member is billed at list price unless the approval names the offerings itself.',
  });
}

/**
 * DELETE .../members/seen/{account}: dismiss a guest from the list. Owner and managers.
 * Not a punishment and not a block: it only says "I have looked at this one". They are recorded
 * again the next time they turn up, because the list answers who is here, not who is unread.
 */
export async function dismissGuest(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, rawAccount: string,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.canManage) return forbidden('Only the app owner, or a member who manages its roster, manages its guest list');
  const account = accountOf(rawAccount);
  // Only a visit that was there leaves an audit row: a made-up name changes nothing and writes
  // nothing, so a manager cannot grow the owner's log with it (secaudit 2026-10, APP-5).
  const had = await forgetVisit(storage, c.appId, account);
  if (had) await rosterAudit(storage, config, c, 'visitor.dismissed', { account });
  return done({
    dismissed: had,
    note: 'Removed from the list of people who turned up. They are recorded again on their next visit.',
  });
}

/**
 * POST .../members/sweep: close every lapsed membership NOW. Owner only.
 * The timer runs hourly, which bounds how long somebody the owner stopped selling to can keep
 * calling on the owner's money. An owner who has just ended a term should not have to wait for it.
 */
export async function sweepRoster(storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.isOwner) return forbidden('Only the app owner sweeps its roster');
  const result = await sweepLapsedMemberships(storage, config, c.appId);
  await rosterAudit(storage, config, c, 'roster.swept', { account: null, swept: result.swept, revoked: result.revoked });
  return done({
    ...result,
    meaning: result.swept
      ? `${result.swept} lapsed membership(s) closed and ${result.revoked} grant(s) withdrawn.`
      : 'Nothing had lapsed. Access already stops on the clock; this only takes the free access back.',
  });
}

/** POST .../members/requests: ask to be let in. Any authenticated caller. */
export async function requestMembership(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, rawNote: unknown,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (c.isOwner) return refuse(400, 'OWNER_CANNOT_ASK', 'You own this app; there is nobody to ask.');
  const already = c.callerMember;
  if (already) return done({ recorded: false, alreadyMember: true, member: already });
  // A declined person waits 7 days before asking again, and is refused before anything is written
  // or anybody is notified: the owner already said no, and a repeat ask must not ring them again.
  const retryAt = reaskRetryAt(await getRequest(storage, c.appId, c.callerAccount));
  if (retryAt) return refuse(429, 'REASK_TOO_SOON', `Your request was declined. You can ask again from ${retryAt}.`, { retryAt });

  const note = typeof rawNote === 'string' ? rawNote.slice(0, 400) : '';
  const rec = await putRequest(storage, { appId: c.appId, account: c.callerAccount, note });
  // The OWNER is the one who needs to know, and this is the direction an extension could never
  // reach: there the caller is the applicant, so the applicant would notify themselves.
  // The one-click approval offers the role the app's members hold most, read from one bounded page
  // of the roster (sampleRoles), and never a managing role. The button says which role it grants:
  // a button that grants an unnamed role is worse than no button.
  const suggested = suggestRole(await sampleRoles(storage, c.appId), c.plan?.manageRoles ?? []);
  const base = `/v1/apps/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.filename)}/members`;
  await sendMemberNotice(storage, `${c.owner}@${config.nodeId}`, 'request', { app: appStem(c.filename), who: c.callerAccount, note }, {
    link: appDeepLink(c.appId),
    // Inline actions execute with the RECIPIENT's own authority when clicked, so they may only
    // ever be set by trusted server code, which is what this is. The public notifications route
    // rejects them outright for exactly that reason.
    actions: lang => [
      { id: 'approve', label: memberActionLabel('approveAs', lang, { role: suggested }), kind: 'api', method: 'POST',
        endpoint: base, body: { account: c.callerAccount, role: suggested }, style: 'primary' },
      { id: 'decline', label: memberActionLabel('decline', lang), kind: 'api', method: 'DELETE',
        endpoint: `${base}/requests/${encodeURIComponent(c.callerAccount)}`, confirm: true, style: 'default' },
    ],
  });
  return done({ recorded: true, request: rec }, 201);
}

/**
 * DELETE .../members/requests/:account: decline an ask. Owner and managers.
 * The person is told, with the date from which they may ask again. Declining an ask that is
 * already declined changes nothing and tells nobody again; there being no ask at all is a 404,
 * so this cannot be used to send a "declined" notice to anybody who never asked.
 */
export async function declineRequest(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, rawAccount: string,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.canManage) return forbidden('Only the app owner, or a member who manages its roster, decides its requests');
  const account = accountOf(rawAccount);
  const prev = await getRequest(storage, c.appId, account);
  if (!prev) return refuse(404, 'NOT_FOUND', `No request from "${account}".`);
  if (prev.state === 'declined') return done({ declined: true, retryAt: reaskRetryAt(prev) });
  const rec = await putRequest(storage, { appId: c.appId, account, state: 'declined' });
  const retryAt = reaskRetryAt(rec);
  await sendMemberNotice(storage, memberAddress(account, config.nodeId), 'declined', { app: appStem(c.filename), date: retryAt ?? '' }, {
    link: appDeepLink(c.appId), dates: ['date'],
  });
  await rosterAudit(storage, config, c, 'request.declined', { account });
  return done({ declined: true, retryAt });
}

/**
 * GET .../members/audit: who decided what about whom, newest first. Owner and managers.
 * The rows of the app's audit log that are about the roster: approvals, role changes, removals,
 * declines, dismissals, invitations, plan changes and sweeps. The owner's other settings (terms,
 * badges, development rights) stay the owner's, so a manager reads only these.
 */
export async function rosterAuditTrail(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, opts: { limit?: unknown; before?: unknown },
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.canManage) return forbidden('Only the app owner, or a member who manages its roster, reads its audit trail');
  // The archived years too, so paging back with `before` reaches the oldest roster entry kept.
  const bucket = await rosterBucketOf(storage, config, c.owner);
  const entries = await readAllEntries(storage, bucket, c.filename, await readAppAudit(storage, bucket, c.filename));
  return done({ ...memberAuditRows(entries, { limit: opts.limit, before: opts.before }) });
}

/**
 * DELETE .../members/invites/:id: cancel an open invitation. Owner and managers.
 * The same word as declining an ask: nothing is granted or withdrawn, a pending decision is ended.
 * A manager cannot cancel an invitation into a managing role, which only the owner can have sent.
 */
export async function cancelInvite(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, inviteId: string,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.canManage) return forbidden('Only the app owner, or a member who manages its roster, cancels its invitations');
  const inv = await findInvite(storage, c.appId, inviteId);
  if (!inv) return refuse(404, 'NOT_FOUND', 'No such invitation.');
  if (!c.isOwner && isManagerRole(c.plan, inv.role)) return forbidden(MANAGER_ROLE_MSG);
  await removeInvite(storage, c.appId, inv.emailHash);
  await rosterAudit(storage, config, c, 'invite.cancelled', { account: null, from: inv.role, invite: inv.id, email: inv.emailShown });
  return done({ cancelled: true, invite: inviteView(inv) });
}
