/**
 * @file src/services/app-roster-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The member-roster writes that give or take access: setting the carry plan, approving
 *   somebody (or inviting them by email), and removing a member. Each one holds the who-may test,
 *   the validation, the refusals, the grant sync, the notification and the audit row its REST route
 *   held, and answers an AppOpOutcome. The routes (routes/app-members.ts) and the aimeat_app_manage
 *   MCP tool (mcp/app-manage.ts) both call these.
 * @structure setCarryPlan · setMember · removeRosterMember
 * @usage const out = await setMember(storage, config, caller, { owner, filename }, req.body);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Moved out of the handlers of routes/app-members.ts by extraction;
 *     aimeat_app_manage calls the service in place of the route over loopback HTTP (secaudit 2026-10, M6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { isOwnerInPerson } from '../utils/gaii.js';
import { getMember, getMemberRow, removeMember, accountOf, putCarryPlan, normalizeAccess, type AppCarryPlan } from './app-members.js';
import { tokenOfThisApp } from './app-record-keys.js';
import { syncGrantsForMember } from './grant-sync.js';
import { approveMember, memberAddress, appDeepLink, appStem } from './app-member-approve.js';
import { ROLE_RE, RESERVED_ROLES, roleShapeError, isManagerRole, sameSet } from './app-member-rules.js';
import { displayNamesOf } from './app-member-roster.js';
import { sendMemberNotice, noticeLang } from './app-member-notices.js';
import { listInvites, sendAppInvite, inviteView, MAX_OPEN_INVITES_PER_APP, INVITE_DAYS } from './app-member-invites.js';
import { resolveContactEmail, ContactsError } from './contacts.js';
import { inviteEmailLocale, inviteEmailHash, InvitationError } from './invitations.js';
import { displayPrefsFor } from './display-prefs.js';
import { resolveAppUrls } from './app-urls.js';
import { rosterContext, rosterBucketOf, rosterAudit, type MembersCtx, type RosterCaller } from './app-roster-context.js';
import { MANAGER_ROLE_MSG, type AppRef } from './app-roster-ops.js';
import { done, refuse, type AppOpOutcome } from './app-op-outcome.js';

const forbidden = (message: string) => refuse(403, 'FORBIDDEN', message);
const bad = (message: string, code = 'INVALID_INPUT') => refuse(400, code, message);

/**
 * PUT .../members/plan: what each role is CARRIED on. Owner only.
 * Declared once, applied on every approval after it. An approval that set a role and carried
 * nothing was the gap that made the panel's "approved" and the member's invoice disagree.
 *
 * The app's own token may set the plan (the kit's plan tab saves through it), but never ADD an
 * offering to a role: that gives away free access to what the owner sells, which an approval by
 * the same token may not do either. It may keep or drop the offerings a role already carries.
 */
export async function setCarryPlan(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, body: unknown,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.isOwner) return forbidden('Only the app owner sets its carry plan');
  const b = (body ?? {}) as {
    roles?: Record<string, unknown>; rosterVisibility?: string; access?: string;
    seats?: Record<string, unknown>; terms?: Record<string, unknown>; manageRoles?: unknown;
  };
  const ACCESS = ['members-free', 'free', 'members-only', 'open'];
  if (b.access !== undefined && !ACCESS.includes(String(b.access))) {
    return bad('access must be "members-free" (default: a member pays nothing, everybody else pays), '
      + '"free" (nobody pays at all) or "members-only" (nobody but a member gets in, even holding '
      + 'money, refused before any settlement). "open" is accepted as the old name for members-free.');
  }
  if (b.rosterVisibility !== undefined && b.rosterVisibility !== 'owner' && b.rosterVisibility !== 'members') {
    return bad('rosterVisibility must be "owner" (default) or "members".');
  }
  if (!b.roles || typeof b.roles !== 'object' || Array.isArray(b.roles)) {
    return bad('roles is required: an object of role name to the offering ids that role is carried on.');
  }
  const roles: Record<string, string[]> = {};
  for (const [role, ids] of Object.entries(b.roles)) {
    if (!Array.isArray(ids)) return bad(`roles.${role} must be an array of offering ids.`);
    roles[role] = ids.filter((x): x is string => typeof x === 'string');
  }
  if (tokenOfThisApp(caller, c.appId)) {
    const added = Object.entries(roles).flatMap(([role, ids]) => ids.filter(id => !(c.plan?.roles[role] ?? []).includes(id)));
    if (added.length) {
      return forbidden(`The app's own token may keep or drop the offerings a role is carried on, not add one (${added.slice(0, 5).join(', ')}): `
        + 'carrying an offering gives away free access to it. Add it from the owner\'s own session, or an agent of theirs holding commerce:sell.');
    }
    // Who pays and who manages are the owner's to change. `access: "free"` makes every call of the
    // owner's paid service free before any settlement (extensions/paywall.ts), which is more than an
    // added offering gives away; manageRoles hands out the roster (secaudit 2026-10, APP-1).
    const changed = [
      b.access !== undefined && normalizeAccess(String(b.access)) !== (c.plan?.access ?? 'members-free') ? 'access' : null,
      b.manageRoles !== undefined && !sameSet(b.manageRoles as unknown[], c.plan?.manageRoles ?? []) ? 'manageRoles' : null,
      b.rosterVisibility !== undefined && b.rosterVisibility !== (c.plan?.rosterVisibility ?? 'owner') ? 'rosterVisibility' : null,
    ].filter((x): x is string => !!x);
    if (changed.length) {
      return forbidden(`The app's own token may not change ${changed.join(', ')}: who pays and who manages the roster are the owner's to decide. `
        + 'Change it from the owner\'s own session, or an agent of theirs holding commerce:sell.');
    }
  }
  const seats: Record<string, number> = {};
  for (const [role, v] of Object.entries(b.seats || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return bad(`seats.${role} must be a non-negative number of seats.`);
    seats[role] = v;
  }
  const terms: Record<string, { days?: number; renewal?: 'manual' | 'self-serve' | 'none' }> = {};
  for (const [role, v] of Object.entries(b.terms || {})) {
    const t = v as { days?: unknown; renewal?: unknown };
    if (!t || typeof t !== 'object') return bad(`terms.${role} must be an object: { days, renewal }.`);
    if (t.days !== undefined && (typeof t.days !== 'number' || t.days <= 0)) {
      return bad(`terms.${role}.days must be a positive number of days, or absent for a membership that does not lapse.`);
    }
    if (t.renewal !== undefined && !['manual', 'self-serve', 'none'].includes(String(t.renewal))) {
      return bad(`terms.${role}.renewal must be "manual", "self-serve" or "none". Nothing here charges anybody; it says what is MEANT to happen when the term ends.`);
    }
    terms[role] = {
      ...(t.days !== undefined ? { days: t.days as number } : {}),
      ...(t.renewal !== undefined ? { renewal: t.renewal as 'manual' | 'self-serve' | 'none' } : {}),
    };
  }
  // The roles whose holders manage the roster. Validated like a role an approval names, because a
  // member is approved INTO one of them.
  if (b.manageRoles !== undefined && (!Array.isArray(b.manageRoles)
    || b.manageRoles.some(r => typeof r !== 'string' || !ROLE_RE.test(r) || RESERVED_ROLES.has(r.toLowerCase())))) {
    return bad('manageRoles must be a list of role names. Each starts with a letter and holds only letters, digits, ".", "_" or "-", '
      + 'at most 40 characters; "owner" is not a role.');
  }
  const plan = await putCarryPlan(storage, {
    appId: c.appId, roles, seats, terms, setBy: c.callerAccount,
    access: b.access as AppCarryPlan['access'] | 'open' | undefined,
    rosterVisibility: b.rosterVisibility === 'members' ? 'members' : 'owner',
    manageRoles: (b.manageRoles as string[] | undefined) ?? c.plan?.manageRoles ?? [],
  });
  await rosterAudit(storage, config, c, 'plan.changed', {
    account: null, access: plan.access, rosterVisibility: plan.rosterVisibility, manageRoles: plan.manageRoles.join(',') || null,
  });
  return done({
    plan,
    // Existing members are NOT re-synced here. Changing the plan under people who were approved on
    // the old one would move their access without anybody deciding to; re-approving them applies it.
    note: 'Applies to approvals from now on. Members approved before this keep what they were given until they are approved again.',
  });
}

/**
 * POST .../members with `email` for an address that belongs to no verified account: store an
 * invitation and email it. The address was already looked up (and counted) by the caller.
 */
async function invite(
  storage: Storage, config: AimeatConfig, c: MembersCtx, args: { email: string; role: string; note?: string; lang: string | undefined },
): Promise<AppOpOutcome> {
  const open = await listInvites(storage, c.appId);
  const hash = inviteEmailHash(args.email);
  if (open.length >= MAX_OPEN_INVITES_PER_APP && !open.some(i => i.emailHash === hash)) {
    return refuse(429, 'TOO_MANY_INVITES',
      `This app has ${open.length} open invitations, the most one app may hold. Cancel some, or wait for them to expire after ${INVITE_DAYS} days.`);
  }
  const urls = await resolveAppUrls(config, storage, [{ owner: c.owner, filename: c.filename }]);
  const { invite: inv, emailSent, acceptUrl } = await sendAppInvite(storage, config, {
    appId: c.appId, filename: c.filename, email: args.email, role: args.role, note: args.note, invitedBy: c.callerGaii,
    inviterName: (await displayNamesOf(storage, [c.callerAccount])).get(c.callerAccount) || c.callerAccount,
    appUrl: Object.values(urls)[0] ?? `${config.baseUrl}${appDeepLink(c.appId)}`, lang: noticeLang(args.lang),
  });
  // The address, as the owner's and the managers' invitation list shows it: the history is read
  // by the same people, and an invitation has no account to name.
  await rosterAudit(storage, config, c, 'invite.sent', { account: null, to: args.role, invite: inv.id, email: inv.emailShown, emailSent });
  // The sign-up link goes back to the inviter only when no email left, so they can pass it on.
  // When the email left, the link exists only in the invited person's mailbox.
  return done({ invited: true, invite: inviteView(inv), emailSent, ...(emailSent ? {} : { acceptUrl }) }, 201);
}

/**
 * POST .../members: approve someone, or change their role. Owner and managers.
 * `exchange:grant` at the route and on the MCP action, because approveMember issues the same
 * exchange grants that POST /v1/exchange/grants issues: giving away free access to what the owner
 * sells is the operation, whichever endpoint it is reached through.
 */
export async function setMember(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, body: unknown,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.canManage) return forbidden('Only the app owner, or a member who manages its roster, approves its members');
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  let account = typeof b.account === 'string' ? accountOf(b.account) : '';
  const role = typeof b.role === 'string' && b.role.trim() ? b.role.trim() : '';
  if (email && account) return bad('Give account or email, not both.');
  if ((!account && !email) || !role) return bad('account (or email) and role are required');
  // Only the owner makes managers: a manager may not approve anybody INTO a managing role.
  if (!c.isOwner && isManagerRole(c.plan, role)) return forbidden(MANAGER_ROLE_MSG);
  const note = typeof b.note === 'string' ? b.note.slice(0, 400) : undefined;

  // By email: an exact match through the contacts lookup and its per-account limit. An address of
  // a VERIFIED account approves that account; any other address becomes an invitation.
  let found: { account: string; displayName: string | null } | null = null;
  if (email) {
    const shape = roleShapeError(role);
    if (shape) return bad(shape);
    let lang: string | undefined;
    try {
      lang = inviteEmailLocale(b.locale, null, (await displayPrefsFor(storage, c.callerGaii)).locale);
    } catch (e) {
      if (e instanceof InvitationError) return bad(e.message);
      throw e;
    }
    // Whether an address belongs to an account here is the contacts lookup's answer, and that
    // endpoint admits a person's own session or an agent holding messages:read, never an app's token
    // (POST /v1/contacts/resolve). Anybody else asking here (the app's own token, an agent, a
    // manager) gets an invitation whatever the address is, so the answer tells them nothing about
    // who has an account; the account holder accepts it from their mail (secaudit 2026-10, APP-3).
    if (!isOwnerInPerson(caller)) return invite(storage, config, c, { email, role, note, lang });
    let hit: Awaited<ReturnType<typeof resolveContactEmail>>;
    try {
      hit = await resolveContactEmail(storage, c.callerGaii, email);
    } catch (e) {
      if (e instanceof ContactsError) return refuse(e.status, e.code, e.message, e.details);
      throw e;
    }
    const verified = hit.found ? (await storage.getGHII(hit.ghii))?.emailVerifiedAt : null;
    if (!hit.found || !verified) return invite(storage, config, c, { email, role, note, lang });
    account = accountOf(hit.owner);
    found = { account, displayName: hit.display_name };
  }
  if (account === c.owner.toLowerCase()) {
    return bad('The owner already reaches everything; a row for them would only be one more thing to keep in step.', 'MEMBER_IS_OWNER');
  }
  const before = await getMember(storage, c.appId, account);
  // A manager does not change or renew somebody who holds a managing role.
  if (!c.isOwner && before && isManagerRole(c.plan, before.role)) return forbidden(MANAGER_ROLE_MSG);
  // The shape check is skipped for the role the person already holds, so a renewal of a row
  // written before the check existed still goes through.
  const shape = before && before.role === role ? null : roleShapeError(role);
  if (shape) return bad(shape);
  // A name nobody answers to would wait on the roster forever and look, on the owner's panel,
  // exactly like a member. An identity of another node is taken as given: this node cannot look it up.
  if (!found && !account.includes('@') && !(await storage.getGHIIByOwner(account))) {
    return refuse(404, 'NOT_FOUND', `No account named "${account}" on this node.`);
  }
  let expiresAt: string | null | undefined;
  if (b.expiresAt !== undefined) {
    const t = b.expiresAt === null ? null : Date.parse(String(b.expiresAt));
    if (t !== null && !Number.isFinite(t)) {
      return bad('expiresAt must be a date such as 2026-12-31T00:00:00Z, or null for a membership that does not lapse.');
    }
    expiresAt = t === null ? null : new Date(t).toISOString();
  }
  // Naming offerings gives away free access to what the owner sells, which is the exchange:grant
  // act itself. The app's own token and a manager approve by the declared plan only.
  const namesOfferings = Array.isArray(b.offerings) && c.isOwner && !tokenOfThisApp(caller, c.appId);
  const r = await approveMember(storage, config.nodeId, {
    appId: c.appId, owner: c.owner, filename: c.filename, account, role,
    level: typeof b.level === 'number' ? b.level : undefined, note,
    approvedBy: c.callerAccount, by: c.callerGaii, ownerGhii: await rosterBucketOf(storage, config, c.owner),
    offerings: namesOfferings ? (b.offerings as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
    days: typeof b.days === 'number' ? b.days : undefined, expiresAt,
    ...(found ? { auditDetail: { via: 'email' } } : {}),
  });
  if (!r.ok) return refuse(r.status, r.code, r.message);
  return done({ member: r.member, created: r.created, access: r.access, ...(found ? { found } : {}) }, r.created ? 201 : 200);
}

/**
 * DELETE .../members/:account: remove a member. Owner and managers.
 * Same word as the approval, and for the same reason: this withdraws the grants, which is what
 * POST /v1/exchange/grants/revoke does and demands `exchange:grant` for.
 */
export async function removeRosterMember(
  storage: Storage, config: AimeatConfig, caller: RosterCaller, ref: AppRef, rawAccount: string,
): Promise<AppOpOutcome> {
  const c = await rosterContext(storage, config, caller, ref.owner, ref.filename);
  if (!c.ok) return c;
  if (!c.canManage) return forbidden('Only the app owner, or a member who manages its roster, removes its members');
  const account = accountOf(rawAccount);
  if (!c.isOwner && isManagerRole(c.plan, (await getMemberRow(storage, c.appId, account))?.role)) return forbidden(MANAGER_ROLE_MSG);
  const gone = await removeMember(storage, c.appId, account);
  // Taking the role away takes the access with it. Leaving the grants behind would mean a removed
  // member keeps calling free and the owner keeps paying for it.
  // Unconditional: the row's own list can be empty while grants issued another way (an earlier
  // approval that named offerings, a plan that changed since) are still live.
  if (gone) {
    await syncGrantsForMember(storage, {
      providerOwner: c.owner.toLowerCase(), providerGhii: `${c.owner}@${config.nodeId}`,
      consumer: memberAddress(account, config.nodeId), appId: c.appId, role: gone.role,
      offeringIds: [],
    });
  }
  if (!gone) return refuse(404, 'NOT_FOUND', 'No such member');
  await sendMemberNotice(storage, memberAddress(account, config.nodeId), 'revoked', { app: appStem(c.filename), by: c.callerAccount }, { link: appDeepLink(c.appId) });
  await rosterAudit(storage, config, c, 'member.removed', { account, from: gone.role || null, to: null });
  return done({ removed: true, member: gone });
}
