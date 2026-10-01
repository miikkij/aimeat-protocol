/**
 * @file app-members.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The member roster for an app, as a node capability rather than something each app
 *   rebuilds. Six apps on this node had built their own and disagreed six ways; the deciding reason
 *   to move it here is that three of the jobs cannot be done from an app at all. Telling the
 *   approved person they were approved: the sandbox notify reaches the CALLER, so an approval
 *   notifies the approver. Keeping the list private: an `ext:` namespace is world-readable by
 *   default, and every fork that stored a roster there served it to anyone who asked for the key.
 *   Taking free access away with the role: a demotion that leaves the grants behind keeps billing
 *   the provider for someone they removed.
 *
 *   The split this preserves: the node owns WHO is a member and everything that follows from a
 *   change; the extension keeps WHAT a member may do, because a capability vocabulary is genuinely
 *   per-app and a browser can never enforce it.
 *
 *   Authorisation is the app's owner, resolved through the identity table rather than compared as a
 *   string, so the owner's own agents administer the roster too (an owner who manages members from
 *   an AI chat is the normal case here, not an edge one). A member whose role the carry plan lists
 *   in `manageRoles` manages the roster beside the owner, except the plan, the sweep and the
 *   managing roles themselves (routes/app-members-context.ts). Everyone else may only ask, and read
 *   their own standing.
 * @structure appMembersRouter(config, storage) — GET/POST/DELETE members, GET/POST requests, GET me,
 *   GET/PUT plan, sweep, seen, GET/PUT/DELETE dev-grants (per app), GET/PUT/DELETE /v1/app-dev-grants
 *   (across all of them). The audit read and the invitation cancel are in routes/app-members-extra.ts.
 * @usage app.use(appMembersRouter(config, storage))
 * @version-history
 *   v1.4.0 — 2026-10-01 — An invitation by email carries a sign-up link (services/app-invite-link.ts)
 *     and lives 7 days; the answer gives the inviter `acceptUrl` only when no email left.
 *   v1.3.2 — 2026-10-01 — The owner's roster names each person's address from the owner's own address book.
 *   v1.3.1 — 2026-10-01 — The invitation's audit row names the address, so the history can say whom.
 *   v1.3.0 — 2026-10-01 — IAM round 2. The roster answers display names (A1) and is searched and
 *     paged with `q`, `limit` and `offset`, with `total` per list (A5). POST members takes `email`:
 *     an address of a verified account approves that account, any other address stores an invitation
 *     and emails it (A2). A role change notifies the member (A4). Members holding a role listed in
 *     the plan's `manageRoles` manage the roster, never the plan, the sweep or a managing role (B1).
 *     Every decision writes an audit row (B2). A decline notifies the person, who may ask again after
 *     7 days and is refused with REASK_TOO_SOON before that; declining nobody's ask answers 404 (B3).
 *     The notifications are in the recipient's language (B4). The request path reads one page of the
 *     roster for the suggested role, never the whole of it, and never suggests a managing role. The
 *     app's own token may set the plan, but not add offerings to it. The request context and the
 *     approval moved out by extraction (routes/app-members-context.ts, services/app-member-approve.ts).
 *   v1.2.0 — 2026-10-01 — The IAM defect round. Every roster route that reads or changes membership
 *     needs a scope word (app:write to read, app:manage to decline or dismiss, exchange:grant to
 *     sweep, approve or remove), except for the app's own token, which manages its own roster and
 *     may not name offerings. The app must exist. An approval refuses a role named "owner" or of
 *     the wrong shape, an account nobody holds, and an unreadable date, and keeps 400 characters of
 *     its note. /me reads one request by key and leaves the owner's records off the member's row.
 *     An identity of another node is notified at its own address. A removal always reconciles the
 *     grants, and keeps a development right.
 *   v1.1.2 — 2026-09-24 — The dev-grant DELETE comment says what the revoke now does to a row that
 *     only carried the right (A6-5, services/app-dev-grant.ts). No behaviour change in this file.
 *   v1.1.1 — 2026-09-12 — bucketOf hands resolveGhii the node; composing `${owner}@${nodeId}` at the
 *     call site is what the helper does now. wish-identity-gate-sees-resolveghii.
 *   v1.1.0 — 2026-09-08 — The DEVELOPMENT right: who, other than the owner, may build this app. Three
 *     rungs from services/app-dev-grant.ts, written on the roster row because it is the same person
 *     keyed the same way, and a blanket "any app of mine" list that is its own record so an owner can
 *     see and withdraw it in one place. The per-app door is app management and the owner's agents do
 *     it; the blanket door is the account holder in person, because a right over every app they will
 *     ever publish is not app management.
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2): the roster becomes a platform capability,
 *     with the notification and the grant withdrawal that an app could not do for itself.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireOwnerPrincipal, requireScope } from '../auth/middleware.js';
// Every roster route that reads or changes membership: a scope word for an agent or another app,
// none for the app's own token, which is the app managing its own roster (auth/app-own-gate.ts).
import { requireScopeOrOwnApp, tokenOfThisApp } from '../auth/app-own-gate.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { listAppRecords } from '../services/app-record-keys.js';
import {
  getMember, getMemberRow, removeMember, getRequest, putRequest, accountOf,
  putCarryPlan, type AppCarryPlan, noteVisit, forgetVisit, isLive,
} from '../services/app-members.js';
import {
  APP_DEV_LEVEL_LIST, actsFor, levelName, parseDevLevel,
  putDevGrant, removeDevGrant, listDevGrants,
  putBlanketGrant, listBlanketGrants, removeBlanketGrant,
} from '../services/app-dev-grant.js';
import { recordAppAudit } from '../services/app-audit.js';
import { notify } from '../services/notify.js';
import { syncGrantsForMember } from '../services/grant-sync.js';
import { sweepLapsedMemberships } from '../services/app-member-sweep.js';
import { logger } from '../utils/logger.js';
import { membersContext, type MembersCtx } from './app-members-context.js';
import { appMembersExtraRouter } from './app-members-extra.js';
import { approveMember, memberAddress, appDeepLink, appStem } from '../services/app-member-approve.js';
import { ROLE_RE, RESERVED_ROLES, roleShapeError, isManagerRole, reaskRetryAt, suggestRole, parseRosterPaging } from '../services/app-member-rules.js';
import { rosterView, memberRosterView, displayNamesOf, sampleRoles } from '../services/app-member-roster.js';
import { sendMemberNotice, memberActionLabel, noticeLang } from '../services/app-member-notices.js';
import { listInvites, sendAppInvite, inviteView, MAX_OPEN_INVITES_PER_APP, INVITE_DAYS } from '../services/app-member-invites.js';
import { resolveContactEmail, ContactsError } from '../services/contacts.js';
import { inviteEmailLocale, inviteEmailHash, InvitationError } from '../services/invitations.js';
import { displayPrefsFor } from '../services/display-prefs.js';
import { resolveAppUrls } from './apps/helpers.js';

export function appMembersRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // The audit read and the invitation cancel live in their own module and are mounted here, so
  // the roster stays one mount in routes-loader, ahead of the parameterized app routes.
  router.use(appMembersExtraRouter(config, storage));
  const { context, bucketOf, audit, sendContextError } = membersContext(config, storage);
  const addressOf = (account: string) => memberAddress(account, config.nodeId);
  const appLink = appDeepLink;
  const forbidden = (res: import('express').Response, message: string) =>
    res.status(403).json(error(config.nodeId, 'FORBIDDEN', message));
  /** A manager reaching for a managing role: only the owner appoints or removes a manager. */
  const MANAGER_ROLE_MSG = 'Only the app owner gives, changes or takes away a role that manages the roster.';

  // ── GET /v1/apps/:owner/:filename/members — the roster. Owner and managers; members when the app shows it to them. ──
  router.get('/v1/apps/:owner/:filename/members', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    const paging = parseRosterPaging(req.query as Record<string, unknown>);
    if (!c.canManage) {
      // An app can open the roster to its own members, and some have to: a board that renders by
      // reading each member's posts shows an empty page to everyone if only the owner may see who
      // the members are. It stays shut unless the app says otherwise.
      if (c.plan?.rosterVisibility !== 'members') return forbidden(res, 'Only the app owner reads its roster');
      if (!c.callerMember) return forbidden(res, 'This app shows its roster to its members. You are not one yet.');
      // Names, roles and join dates. The note somebody wrote when they asked, who approved them and
      // what they are carried on are the owner's business, not the other members'.
      const v = await memberRosterView(storage, c.appId, paging);
      return res.json(success(config.nodeId, {
        members: v.members, requests: [], count: v.total, redacted: true,
        total: { members: v.total, requests: 0, seen: 0, invites: 0 }, limit: paging.limit, offset: paging.offset,
      }));
    }
    // Everybody who turned up and holds no role is listed too (`seen`): a roster tells the owner who
    // they already said yes to; this tells them who is there to say yes TO. A person appears in
    // exactly one place: promoted, waiting, or just here.
    // The owner's view names the address the owner keeps for each person in their own address book.
    const v = await rosterView(storage, c.appId, paging, c.isOwner ? { ownerGhii: await bucketOf(c.owner), nodeId: config.nodeId } : null);
    return res.json(success(config.nodeId, {
      members: v.members, requests: v.requests, seen: v.seen, invites: v.invites, count: v.total.members,
      total: v.total, limit: paging.limit, offset: paging.offset, isOwner: c.isOwner, canManage: true,
    }));
  });

  // ── GET .../members/me — the caller's own standing. Any authenticated caller. ──
  // An agent asks this and gets its HUMAN's answer, which is the whole point of keying on the person.
  router.get('/v1/apps/:owner/:filename/members/me', requireAuth(), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
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
    return res.json(success(config.nodeId, {
      member: own, isOwner: c.isOwner, canManage: c.canManage,
      displayName: (await displayNamesOf(storage, [c.callerAccount])).get(c.callerAccount) ?? null,
      role: c.isOwner ? 'owner' : (member?.role ?? null),
      requested: mine ? { at: mine.at, state: mine.state, note: mine.note, ...(retryAt ? { retryAt } : {}) } : null,
    }));
  });

  // ── GET/PUT .../members/plan — what each role is CARRIED on. Owner only. ──
  // Declared once, applied on every approval after it. An approval that set a role and carried
  // nothing was the gap that made the panel's "approved" and the member's invoice disagree.
  router.get('/v1/apps/:owner/:filename/members/plan', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.isOwner) return forbidden(res, 'Only the app owner reads its carry plan');
    const plan = c.plan;
    return res.json(success(config.nodeId, {
      plan,
      meaning: plan
        ? 'Approving somebody as one of these roles issues a zero-priced grant over the listed offerings, and removing them withdraws those grants again.'
        : 'No plan declared: an approval sets a role and carries nothing, so a member is billed at list price unless the approval names the offerings itself.',
    }));
  });

  // The app's own token may set the plan (the kit's plan tab saves through it), but never ADD an
  // offering to a role: that gives away free access to what the owner sells, which an approval by
  // the same token may not do either. It may keep or drop the offerings a role already carries.
  router.put('/v1/apps/:owner/:filename/members/plan', requireAuth(), requireScopeOrOwnApp('commerce:sell'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.isOwner) return forbidden(res, 'Only the app owner sets its carry plan');
    const b = (req.body ?? {}) as {
      roles?: Record<string, unknown>; rosterVisibility?: string; access?: string;
      seats?: Record<string, unknown>; terms?: Record<string, unknown>; manageRoles?: unknown;
    };
    const bad = (msg: string) => res.status(400).json(error(config.nodeId, 'INVALID_INPUT', msg));
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
    if (tokenOfThisApp(req.auth, c.appId)) {
      const added = Object.entries(roles).flatMap(([role, ids]) => ids.filter(id => !(c.plan?.roles[role] ?? []).includes(id)));
      if (added.length) {
        return forbidden(res, `The app's own token may keep or drop the offerings a role is carried on, not add one (${added.slice(0, 5).join(', ')}): `
          + 'carrying an offering gives away free access to it. Add it from the owner\'s own session, or an agent of theirs holding commerce:sell.');
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
    await audit(c, 'plan.changed', {
      account: null, access: plan.access, rosterVisibility: plan.rosterVisibility, manageRoles: plan.manageRoles.join(',') || null,
    });
    return res.json(success(config.nodeId, {
      plan,
      // Existing members are NOT re-synced here. Changing the plan under people who were approved on
      // the old one would move their access without anybody deciding to; re-approving them applies it.
      note: 'Applies to approvals from now on. Members approved before this keep what they were given until they are approved again.',
    }));
  });

  // ── DELETE .../members/seen/{account} — dismiss a guest from the list. Owner and managers. ──
  // Not a punishment and not a block: it only says "I have looked at this one". They are recorded
  // again the next time they turn up, because the list answers who is here, not who is unread.
  router.delete('/v1/apps/:owner/:filename/members/seen/:account', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.canManage) return forbidden(res, 'Only the app owner, or a member who manages its roster, manages its guest list');
    const account = accountOf(String(req.params.account ?? ''));
    await forgetVisit(storage, c.appId, account);
    await audit(c, 'visitor.dismissed', { account });
    return res.json(success(config.nodeId, {
      dismissed: true,
      note: 'Removed from the list of people who turned up. They are recorded again on their next visit.',
    }));
  });

  // ── POST .../members/sweep — close every lapsed membership NOW. Owner only. ──
  // The timer runs hourly, which bounds how long somebody the owner stopped selling to can keep
  // calling on the owner's money. An owner who has just ended a term should not have to wait for it.
  router.post('/v1/apps/:owner/:filename/members/sweep', requireAuth(), requireScopeOrOwnApp('exchange:grant'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.isOwner) return forbidden(res, 'Only the app owner sweeps its roster');
    const result = await sweepLapsedMemberships(storage, config, c.appId);
    await audit(c, 'roster.swept', { account: null, swept: result.swept, revoked: result.revoked });
    return res.json(success(config.nodeId, {
      ...result,
      meaning: result.swept
        ? `${result.swept} lapsed membership(s) closed and ${result.revoked} grant(s) withdrawn.`
        : 'Nothing had lapsed. Access already stops on the clock; this only takes the free access back.',
    }));
  });

  /**
   * POST .../members with `email` for an address that belongs to no verified account: store an
   * invitation and email it. The address was already looked up (and counted) by the caller.
   */
  async function invite(c: MembersCtx, res: import('express').Response, args: { email: string; role: string; note?: string; lang: string | undefined }) {
    const open = await listInvites(storage, c.appId);
    const hash = inviteEmailHash(args.email);
    if (open.length >= MAX_OPEN_INVITES_PER_APP && !open.some(i => i.emailHash === hash)) {
      return res.status(429).json(error(config.nodeId, 'TOO_MANY_INVITES',
        `This app has ${open.length} open invitations, the most one app may hold. Cancel some, or wait for them to expire after ${INVITE_DAYS} days.`));
    }
    const urls = await resolveAppUrls(config, storage, [{ owner: c.owner, filename: c.filename }]);
    const { invite: inv, emailSent, acceptUrl } = await sendAppInvite(storage, config, {
      appId: c.appId, filename: c.filename, email: args.email, role: args.role, note: args.note, invitedBy: c.callerGaii,
      inviterName: (await displayNamesOf(storage, [c.callerAccount])).get(c.callerAccount) || c.callerAccount,
      appUrl: Object.values(urls)[0] ?? `${config.baseUrl}${appLink(c.appId)}`, lang: noticeLang(args.lang),
    });
    // The address, as the owner's and the managers' invitation list shows it: the history is read
    // by the same people, and an invitation has no account to name.
    await audit(c, 'invite.sent', { account: null, to: args.role, invite: inv.id, email: inv.emailShown, emailSent });
    // The sign-up link goes back to the inviter only when no email left, so they can pass it on.
    // When the email left, the link exists only in the invited person's mailbox.
    return res.status(201).json(success(config.nodeId, {
      invited: true, invite: inviteView(inv), emailSent, ...(emailSent ? {} : { acceptUrl }),
    }));
  }

  // ── POST .../members — approve someone, or change their role. Owner and managers. ──
  // `exchange:grant`, because approveMember issues the same exchange grants that
  // POST /v1/exchange/grants issues, and that door has always demanded the word: giving away free
  // access to what the owner sells is the operation, whichever door it is reached through. Owner
  // sessions bypass scopes, so the person's own Members screen is untouched; what needs the word is
  // a machine doing it.
  router.post('/v1/apps/:owner/:filename/members', requireAuth(), requireScopeOrOwnApp('exchange:grant'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.canManage) return forbidden(res, 'Only the app owner, or a member who manages its roster, approves its members');
    const b = (req.body ?? {}) as Record<string, unknown>;
    const bad = (msg: string, code = 'INVALID_INPUT') => res.status(400).json(error(config.nodeId, code, msg));
    const email = typeof b.email === 'string' ? b.email.trim() : '';
    let account = typeof b.account === 'string' ? accountOf(b.account) : '';
    const role = typeof b.role === 'string' && b.role.trim() ? b.role.trim() : '';
    if (email && account) return bad('Give account or email, not both.');
    if ((!account && !email) || !role) return bad('account (or email) and role are required');
    // Only the owner makes managers: a manager may not approve anybody INTO a managing role.
    if (!c.isOwner && isManagerRole(c.plan, role)) return forbidden(res, MANAGER_ROLE_MSG);
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
      let hit: Awaited<ReturnType<typeof resolveContactEmail>>;
      try {
        hit = await resolveContactEmail(storage, c.callerGaii, email);
      } catch (e) {
        if (e instanceof ContactsError) return res.status(e.status).json(error(config.nodeId, e.code, e.message, e.status, e.details));
        throw e;
      }
      const verified = hit.found ? (await storage.getGHII(hit.ghii))?.emailVerifiedAt : null;
      if (!hit.found || !verified) return invite(c, res, { email, role, note, lang });
      account = accountOf(hit.owner);
      found = { account, displayName: hit.display_name };
    }
    if (account === c.owner.toLowerCase()) {
      return bad('The owner already reaches everything; a row for them would only be one more thing to keep in step.', 'MEMBER_IS_OWNER');
    }
    const before = await getMember(storage, c.appId, account);
    // A manager does not change or renew somebody who holds a managing role.
    if (!c.isOwner && before && isManagerRole(c.plan, before.role)) return forbidden(res, MANAGER_ROLE_MSG);
    // The shape check is skipped for the role the person already holds, so a renewal of a row
    // written before the check existed still goes through.
    const shape = before && before.role === role ? null : roleShapeError(role);
    if (shape) return bad(shape);
    // A name nobody answers to would wait on the roster forever and look, on the owner's panel,
    // exactly like a member. An identity of another node is taken as given: this node cannot look it up.
    if (!found && !account.includes('@') && !(await storage.getGHIIByOwner(account))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No account named "${account}" on this node.`));
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
    const namesOfferings = Array.isArray(b.offerings) && c.isOwner && !tokenOfThisApp(req.auth, c.appId);
    const r = await approveMember(storage, config.nodeId, {
      appId: c.appId, owner: c.owner, filename: c.filename, account, role,
      level: typeof b.level === 'number' ? b.level : undefined, note,
      approvedBy: c.callerAccount, by: c.callerGaii, ownerGhii: await bucketOf(c.owner),
      offerings: namesOfferings ? (b.offerings as unknown[]).filter((x): x is string => typeof x === 'string') : undefined,
      days: typeof b.days === 'number' ? b.days : undefined, expiresAt,
      ...(found ? { auditDetail: { via: 'email' } } : {}),
    });
    if (!r.ok) return res.status(r.status).json(error(config.nodeId, r.code, r.message));
    return res.status(r.created ? 201 : 200).json(success(config.nodeId, {
      member: r.member, created: r.created, access: r.access, ...(found ? { found } : {}),
    }));
  });

  // ── DELETE .../members/:account — remove a member. Owner and managers. ──
  // Same word as the approval above, and for the same reason one door over: this withdraws the
  // grants, which is what POST /v1/exchange/grants/revoke does and demands `exchange:grant` for.
  router.delete('/v1/apps/:owner/:filename/members/:account', requireAuth(), requireScopeOrOwnApp('exchange:grant'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.canManage) return forbidden(res, 'Only the app owner, or a member who manages its roster, removes its members');
    const account = accountOf(String(req.params.account ?? ''));
    if (!c.isOwner && isManagerRole(c.plan, (await getMemberRow(storage, c.appId, account))?.role)) return forbidden(res, MANAGER_ROLE_MSG);
    const gone = await removeMember(storage, c.appId, account);
    // Taking the role away takes the access with it. Leaving the grants behind would mean a removed
    // member keeps calling free and the owner keeps paying for it.
    // Unconditional: the row's own list can be empty while grants issued another way (an earlier
    // approval that named offerings, a plan that changed since) are still live.
    if (gone) {
      await syncGrantsForMember(storage, {
        providerOwner: c.owner.toLowerCase(), providerGhii: `${c.owner}@${config.nodeId}`,
        consumer: addressOf(account), appId: c.appId, role: gone.role,
        offeringIds: [],
      });
    }
    if (!gone) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such member'));
    await sendMemberNotice(storage, addressOf(account), 'revoked', { app: appStem(c.filename), by: c.callerAccount }, { link: appLink(c.appId) });
    await audit(c, 'member.removed', { account, from: gone.role || null, to: null });
    return res.json(success(config.nodeId, { removed: true, member: gone }));
  });

  // ── POST .../members/requests — ask to be let in. Any authenticated caller. ──
  router.post('/v1/apps/:owner/:filename/members/requests', requireAuth(), requireScopeOrOwnApp('social:write'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (c.isOwner) {
      return res.status(400).json(error(config.nodeId, 'OWNER_CANNOT_ASK', 'You own this app; there is nobody to ask.'));
    }
    const already = c.callerMember;
    if (already) return res.json(success(config.nodeId, { recorded: false, alreadyMember: true, member: already }));
    // A declined person waits 7 days before asking again, and is refused before anything is written
    // or anybody is notified: the owner already said no, and a repeat ask must not ring them again.
    const retryAt = reaskRetryAt(await getRequest(storage, c.appId, c.callerAccount));
    if (retryAt) {
      return res.status(429).json(error(config.nodeId, 'REASK_TOO_SOON',
        `Your request was declined. You can ask again from ${retryAt}.`, 429, { retryAt }));
    }

    const note = typeof (req.body ?? {}).note === 'string' ? String((req.body as Record<string, unknown>).note).slice(0, 400) : '';
    const rec = await putRequest(storage, { appId: c.appId, account: c.callerAccount, note });
    // The OWNER is the one who needs to know, and this is the direction an extension could never
    // reach: there the caller is the applicant, so the applicant would notify themselves.
    // The one-click approval offers the role the app's members hold most, read from one bounded page
    // of the roster (sampleRoles), and never a managing role. The button says which role it grants:
    // a button that grants an unnamed role is worse than no button.
    const suggested = suggestRole(await sampleRoles(storage, c.appId), c.plan?.manageRoles ?? []);
    const base = `/v1/apps/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.filename)}/members`;
    await sendMemberNotice(storage, `${c.owner}@${config.nodeId}`, 'request', { app: appStem(c.filename), who: c.callerAccount, note }, {
      link: appLink(c.appId),
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
    return res.status(201).json(success(config.nodeId, { recorded: true, request: rec }));
  });

  // ── DELETE .../members/requests/:account — decline an ask. Owner and managers. ──
  // The person is told, with the date from which they may ask again. Declining an ask that is
  // already declined changes nothing and tells nobody again; there being no ask at all is a 404,
  // so this cannot be used to send a "declined" notice to anybody who never asked.
  router.delete('/v1/apps/:owner/:filename/members/requests/:account', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.canManage) return forbidden(res, 'Only the app owner, or a member who manages its roster, decides its requests');
    const account = accountOf(String(req.params.account ?? ''));
    const prev = await getRequest(storage, c.appId, account);
    if (!prev) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No request from "${account}".`));
    if (prev.state === 'declined') return res.json(success(config.nodeId, { declined: true, retryAt: reaskRetryAt(prev) }));
    const rec = await putRequest(storage, { appId: c.appId, account, state: 'declined' });
    const retryAt = reaskRetryAt(rec);
    await sendMemberNotice(storage, addressOf(account), 'declined', { app: appStem(c.filename), date: retryAt ?? '' }, {
      link: appLink(c.appId), dates: ['date'],
    });
    await audit(c, 'request.declined', { account });
    return res.json(success(config.nodeId, { declined: true, retryAt }));
  });

  // ── The development right: who, other than the owner, may BUILD this app ────────────────────────
  //
  // Beside the roster rather than somewhere of its own, because it is written on the same row and
  // keyed to the same person. What separates the two is what they are about: a role says what
  // somebody may do INSIDE the app, and this says what they may do TO it.

  /** The rungs as a door answers them, so a client never has to hardcode the numbers. */
  const rungs = APP_DEV_LEVEL_LIST.map(l => ({ name: l.name, level: l.level, carries: actsFor(l.level) }));

  // ── GET .../dev-grants — who can build this app. Owner only. ──
  // app:write, not a read word: the app domain carries write and manage, and an agent that may
  // manage an app may read who else builds it. Without a scope this list is readable by any
  // app-grant token whatever single word its owner ticked.
  router.get('/v1/apps/:owner/:filename/dev-grants', requireAuth(), requireScope('app:write'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.isOwner) return forbidden(res, 'Only the app owner sees who may build it');
    const grants = await listDevGrants(storage, c.appId);
    return res.json(success(config.nodeId, {
      grants: grants.map(g => ({ ...g, levelName: levelName(g.level), carries: actsFor(g.level) })),
      levels: rungs,
      never: ['delete the app', 'change its price or licence', 'pass the right on'],
    }));
  });

  // ── PUT .../dev-grants/:account — invite somebody to build it. Owner only. ──
  router.put('/v1/apps/:owner/:filename/dev-grants/:account', requireAuth(), requireScope('app:manage'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.isOwner) return forbidden(res, 'Only the app owner says who may build it');

    const level = parseDevLevel((req.body ?? {}).level);
    if (level === null) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `level must be one of: ${APP_DEV_LEVEL_LIST.map(l => l.name).join(', ')}.`, 400, { levels: rungs }));
    }
    const account = accountOf(String(req.params.account ?? ''));
    if (!account) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'account is required'));
    if (account === c.callerAccount) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'You already own this app. A development right is for somebody else.'));
    }
    // Both of these are refusals BEFORE anything is written. A grant to a name nobody answers to
    // waits forever and looks, on the owner's own page, exactly like a grant that works.
    if (!(await storage.getGHIIByOwner(account))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No owner named "${account}" on this node.`));
    }
    const ownerGhii = await bucketOf(c.owner);
    if (!(await storage.getApp(ownerGhii, c.filename))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such app.'));
    }

    const note = typeof (req.body ?? {}).note === 'string' ? String((req.body as Record<string, unknown>).note).slice(0, 400) : undefined;
    const rec = await putDevGrant(storage, {
      appId: c.appId, account, level, grantedBy: c.callerGaii, ...(note !== undefined ? { note } : {}),
    });
    await recordAppAudit(storage, {
      ownerGhii, filename: c.filename, by: c.callerGaii,
      action: 'dev.granted', detail: { account, level, levelName: levelName(level) },
    });
    try {
      await notify(storage, addressOf(account), {
        type: 'app_dev_grant',
        title: `${c.owner} invited you to build ${appStem(c.filename)}`,
        body: `You may ${actsFor(level).join(', ')} on this app. Your agents are covered by the same invitation.`,
        link: appLink(c.appId),
      });
    } catch (err) {
      logger.warn('app-members: dev-grant notification failed, the grant stands', { error: String(err) });
    }
    return res.json(success(config.nodeId, {
      granted: true, account, level, levelName: levelName(level), carries: actsFor(level), member: rec,
    }));
  });

  // ── DELETE .../dev-grants/:account — take the right back. Owner only. ──
  // A member's roster row survives: somebody can pay for an app they no longer help build, and
  // deleting the row here would take their access away with the right. A row that existed only to
  // carry the right goes with it (removeDevGrant), so a pure builder does not stay on as a member.
  router.delete('/v1/apps/:owner/:filename/dev-grants/:account', requireAuth(), requireScope('app:manage'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.isOwner) return forbidden(res, 'Only the app owner says who may build it');
    const account = accountOf(String(req.params.account ?? ''));
    const had = await removeDevGrant(storage, c.appId, account);
    if (had) {
      await recordAppAudit(storage, {
        ownerGhii: await bucketOf(c.owner), filename: c.filename, by: c.callerGaii,
        action: 'dev.revoked', detail: { account },
      });
    }
    return res.json(success(config.nodeId, { revoked: had, account }));
  });

  // ── The blanket right: "this person may build ANY app of mine" ──────────────────────────────────
  //
  // Its own list rather than a row on every roster, and that is the entire reason it exists
  // separately: a right written into forty rosters is a right its owner cannot see in one place and
  // cannot take back in one act.
  //
  // Behind the account holder in person, unlike the per-app grant. An owner handing out one app is
  // doing app management, which their agents do for them all day. An owner handing out every app
  // they will ever publish is doing something to the account, and this repo's rule for that is the
  // person, not something acting in their name.

  router.get('/v1/app-dev-grants', requireAuth(), requireScope('app:write'), async (req, res) => {
    const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
    const grants = await listBlanketGrants(storage, me);
    const perApp: Record<string, unknown[]> = {};
    if (req.query.include_apps === 'true') {
      const rows = await listAppRecords(storage, 'app-member', 'appmember.');
      for (const { value } of rows.items) {
        const row = value as import('../services/app-members.js').AppMemberRecord;
        if (!row?.appId || accountOf(row.appId.split('/')[0]) !== me || typeof row.dev !== 'number' || !isLive(row)) continue;
        (perApp[row.appId] ??= []).push({ account: row.owner, level: row.dev, levelName: levelName(row.dev), since: row.devSince, grantedBy: row.devBy });
      }
    }
    return res.json(success(config.nodeId, {
      grants: grants.map(g => ({ ...g, levelName: levelName(g.level), carries: actsFor(g.level) })),
      levels: rungs,
      ...(req.query.include_apps === 'true' ? { per_app: perApp } : {}),
      meaning: 'These people may build any app of yours, including ones you have not published yet. A right on a single app is set on that app instead.',
    }));
  });

  router.put('/v1/app-dev-grants/:account', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
    const level = parseDevLevel((req.body ?? {}).level);
    if (level === null) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        `level must be one of: ${APP_DEV_LEVEL_LIST.map(l => l.name).join(', ')}.`, 400, { levels: rungs }));
    }
    const account = accountOf(String(req.params.account ?? ''));
    if (!account) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'account is required'));
    if (account === me) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'These are your own apps already.'));
    }
    if (!(await storage.getGHIIByOwner(account))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No owner named "${account}" on this node.`));
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rec = await putBlanketGrant(storage, {
      owner: me, grantee: account, level, grantedBy: resolveIdentity(req.auth!, config.nodeId),
      ...(typeof body.note === 'string' ? { note: body.note.slice(0, 400) } : {}),
      ...(typeof body.expires_at === 'string' ? { expiresAt: body.expires_at } : {}),
    });
    try {
      await notify(storage, addressOf(account), {
        type: 'app_dev_grant',
        title: `${me} invited you to build their apps`,
        body: `You may ${actsFor(level).join(', ')} on any app of theirs. Your agents are covered by the same invitation.`,
      });
    } catch (err) {
      logger.warn('app-members: blanket dev-grant notification failed, the grant stands', { error: String(err) });
    }
    return res.json(success(config.nodeId, { granted: true, grant: rec, levelName: levelName(level), carries: actsFor(level) }));
  });

  router.delete('/v1/app-dev-grants/:account', requireAuth(), requireOwnerPrincipal(), async (req, res) => {
    const me = accountOf(resolveIdentity(req.auth!, config.nodeId));
    const account = accountOf(String(req.params.account ?? ''));
    const had = await removeBlanketGrant(storage, me, account);
    return res.json(success(config.nodeId, { revoked: had, account }));
  });

  return router;
}
