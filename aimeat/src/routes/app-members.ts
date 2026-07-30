/**
 * @file app-members.ts
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
 *   an AI chat is the normal case here, not an edge one). Everyone else may only ask, and read
 *   their own standing.
 * @structure appMembersRouter(config, storage) — GET/POST/DELETE members, GET/POST requests, GET me
 * @usage app.use(appMembersRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2): the roster becomes a platform capability,
 *     with the notification and the grant withdrawal that an app could not do for itself.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  listMembers, getMember, putMember, removeMember,
  listRequests, putRequest, removeRequest, accountOf,
  getCarryPlan, putCarryPlan, seatsTaken,
} from '../services/app-members.js';
import { notify } from '../services/notify.js';
import { syncGrantsForMember } from '../services/grant-sync.js';
import { sweepLapsedMemberships } from '../services/app-member-sweep.js';
import { logger } from '../utils/logger.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export function appMembersRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The app under `:owner/:filename`, plus whether this caller may administer it. */
  type Ctx =
    | { bad: string }
    | { appId: string; owner: string; filename: string; callerAccount: string; isOwner: boolean };

  async function context(req: import('express').Request): Promise<Ctx> {
    const owner = String(req.params.owner ?? '');
    const filename = String(req.params.filename ?? '');
    if (!FILENAME_RE.test(filename)) return { bad: 'Invalid filename.' as const };
    const appId = `${owner}/${filename}`;
    // The caller's OWNER, so an agent acting for the app's owner administers as the owner does.
    const callerAccount = accountOf(resolveIdentity(req.auth!, config.nodeId));
    return { appId, owner, filename, callerAccount, isOwner: callerAccount === owner.toLowerCase() };
  }

  /** A deep link back to the app, which is where every one of these notifications should land. */
  const appLink = (appId: string) => {
    const [o, f] = appId.split('/');
    return `/v1/apps/${encodeURIComponent(o ?? '')}/${encodeURIComponent(f ?? '')}?mode=inline`;
  };

  // ── GET /v1/apps/:owner/:filename/members — the roster. Owner only. ──
  router.get('/v1/apps/:owner/:filename/members', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    const plan = await getCarryPlan(storage, c.appId);
    if (!c.isOwner) {
      // An app can open the roster to its own members, and some have to: a board that renders by
      // reading each member's posts shows an empty page to everyone if only the owner may see who
      // the members are. It stays shut unless the app says otherwise.
      if (plan?.rosterVisibility !== 'members') {
        return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner reads its roster'));
      }
      const me = await getMember(storage, c.appId, c.callerAccount);
      if (!me) {
        return res.status(403).json(error(config.nodeId, 'FORBIDDEN',
          'This app shows its roster to its members. You are not one yet.'));
      }
      // Names, roles and join dates. The note somebody wrote when they asked, who approved them and
      // what they are carried on are the owner's business, not the other members'.
      const visible = (await listMembers(storage, c.appId))
        .map(m => ({ appId: m.appId, owner: m.owner, role: m.role, level: m.level, since: m.since }));
      return res.json(success(config.nodeId, { members: visible, requests: [], count: visible.length, redacted: true }));
    }
    const [members, requests] = await Promise.all([listMembers(storage, c.appId), listRequests(storage, c.appId)]);
    return res.json(success(config.nodeId, { members, requests, count: members.length }));
  });

  // ── GET .../members/me — the caller's own standing. Any authenticated caller. ──
  // An agent asks this and gets its HUMAN's answer, which is the whole point of keying on the person.
  router.get('/v1/apps/:owner/:filename/members/me', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    const member = await getMember(storage, c.appId, c.callerAccount);
    const requests = c.isOwner ? [] : await listRequests(storage, c.appId, 'all');
    const mine = requests.find(r => r.owner === c.callerAccount) ?? null;
    return res.json(success(config.nodeId, {
      member, isOwner: c.isOwner,
      role: c.isOwner ? 'owner' : (member?.role ?? null),
      requested: mine ? { at: mine.at, state: mine.state, note: mine.note } : null,
    }));
  });

  // ── GET/PUT .../members/plan — what each role is CARRIED on. Owner only. ──
  // Declared once, applied on every approval after it. An approval that set a role and carried
  // nothing was the gap that made the panel's "approved" and the member's invoice disagree.
  router.get('/v1/apps/:owner/:filename/members/plan', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner reads its carry plan'));
    const plan = await getCarryPlan(storage, c.appId);
    return res.json(success(config.nodeId, {
      plan,
      meaning: plan
        ? 'Approving somebody as one of these roles issues a zero-priced grant over the listed offerings, and removing them withdraws those grants again.'
        : 'No plan declared: an approval sets a role and carries nothing, so a member is billed at list price unless the approval names the offerings itself.',
    }));
  });

  router.put('/v1/apps/:owner/:filename/members/plan', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner sets its carry plan'));
    const b = (req.body ?? {}) as {
      roles?: Record<string, unknown>; rosterVisibility?: string;
      seats?: Record<string, unknown>; terms?: Record<string, unknown>;
    };
    if (b.rosterVisibility !== undefined && b.rosterVisibility !== 'owner' && b.rosterVisibility !== 'members') {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'rosterVisibility must be "owner" (default) or "members".'));
    }
    if (!b.roles || typeof b.roles !== 'object' || Array.isArray(b.roles)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'roles is required: an object of role name to the offering ids that role is carried on.'));
    }
    const roles: Record<string, string[]> = {};
    for (const [role, ids] of Object.entries(b.roles)) {
      if (!Array.isArray(ids)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `roles.${role} must be an array of offering ids.`));
      }
      roles[role] = ids.filter((x): x is string => typeof x === 'string');
    }
    const seats: Record<string, number> = {};
    for (const [role, v] of Object.entries(b.seats || {})) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `seats.${role} must be a non-negative number of seats.`));
      }
      seats[role] = v;
    }
    const terms: Record<string, { days?: number; renewal?: 'manual' | 'self-serve' | 'none' }> = {};
    for (const [role, v] of Object.entries(b.terms || {})) {
      const t = v as { days?: unknown; renewal?: unknown };
      if (!t || typeof t !== 'object') {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `terms.${role} must be an object: { days, renewal }.`));
      }
      if (t.days !== undefined && (typeof t.days !== 'number' || t.days <= 0)) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `terms.${role}.days must be a positive number of days, or absent for a membership that does not lapse.`));
      }
      if (t.renewal !== undefined && !['manual', 'self-serve', 'none'].includes(String(t.renewal))) {
        return res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
          `terms.${role}.renewal must be "manual", "self-serve" or "none". Nothing here charges anybody; it says what is MEANT to happen when the term ends.`));
      }
      terms[role] = {
        ...(t.days !== undefined ? { days: t.days as number } : {}),
        ...(t.renewal !== undefined ? { renewal: t.renewal as 'manual' | 'self-serve' | 'none' } : {}),
      };
    }
    const plan = await putCarryPlan(storage, {
      appId: c.appId, roles, seats, terms, setBy: c.callerAccount,
      rosterVisibility: b.rosterVisibility === 'members' ? 'members' : 'owner',
    });
    return res.json(success(config.nodeId, {
      plan,
      // Existing members are NOT re-synced here. Changing the plan under people who were approved on
      // the old one would move their access without anybody deciding to; re-approving them applies it.
      note: 'Applies to approvals from now on. Members approved before this keep what they were given until they are approved again.',
    }));
  });

  // ── POST .../members/sweep — close every lapsed membership NOW. Owner only. ──
  // The timer runs hourly, which bounds how long somebody the owner stopped selling to can keep
  // calling on the owner's money. An owner who has just ended a term should not have to wait for it.
  router.post('/v1/apps/:owner/:filename/members/sweep', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner sweeps its roster'));
    const result = await sweepLapsedMemberships(storage, config, c.appId);
    return res.json(success(config.nodeId, {
      ...result,
      meaning: result.swept
        ? `${result.swept} lapsed membership(s) closed and ${result.revoked} grant(s) withdrawn.`
        : 'Nothing had lapsed. Access already stops on the clock; this only takes the free access back.',
    }));
  });

  // ── POST .../members — approve someone, or change their role. Owner only. ──
  router.post('/v1/apps/:owner/:filename/members', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner approves its members'));
    const b = (req.body ?? {}) as Record<string, unknown>;
    const account = typeof b.account === 'string' ? accountOf(b.account) : '';
    const role = typeof b.role === 'string' && b.role.trim() ? b.role.trim() : '';
    if (!account || !role) {
      return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'account and role are required'));
    }
    if (account === c.owner.toLowerCase()) {
      return res.status(400).json(error(config.nodeId, 'MEMBER_IS_OWNER',
        'The owner already reaches everything; a row for them would only be one more thing to keep in step.'));
    }
    const before = await getMember(storage, c.appId, account);
    const planEarly = await getCarryPlan(storage, c.appId);

    // A seat count is a product decision with teeth. Refusing past the last seat, and saying how
    // many are taken, is the difference between a limit and a number in a settings screen.
    // Somebody already holding the role is not taking a new seat: this must not block a renewal.
    const cap = planEarly?.seats?.[role];
    if (typeof cap === 'number' && (!before || before.role !== role)) {
      const taken = await seatsTaken(storage, c.appId, role);
      if (taken >= cap) {
        return res.status(409).json(error(config.nodeId, 'SEATS_FULL',
          `All ${cap} "${role}" seats are taken (${taken} in use). Remove somebody, raise the seat count, `
          + 'or approve them into a different role.'));
      }
    }

    // How long the term runs. An explicit date wins; otherwise the role's declared length applies,
    // counted from NOW, so re-approving somebody is a renewal rather than an extension of a date
    // that may already be in the past.
    const term = planEarly?.terms?.[role];
    let expiresAt: string | null | undefined;
    if (b.expiresAt !== undefined) {
      expiresAt = b.expiresAt === null ? null : String(b.expiresAt);
    } else if (typeof b.days === 'number' && b.days > 0) {
      expiresAt = new Date(Date.now() + Math.floor(b.days) * 86400_000).toISOString();
    } else if (term?.days) {
      expiresAt = new Date(Date.now() + term.days * 86400_000).toISOString();
    } else if (!before) {
      expiresAt = null;
    }
    // What this role is carried on. An explicit list wins, because a caller who names one means it;
    // otherwise the app's declared plan applies. Without the plan an approval from the panel set a
    // role and carried nothing, so the member was billed at list price on every call while the panel
    // showed them approved — the panel's word and the invoice disagreeing is the worst of the three.
    const plan = planEarly;
    const carried = Array.isArray(b.offerings)
      ? b.offerings.filter(x => typeof x === 'string') as string[]
      : (plan?.roles[role] ?? (before ? undefined : []));
    const rec = await putMember(storage, {
      appId: c.appId, account, role,
      level: typeof b.level === 'number' ? b.level : undefined,
      note: typeof b.note === 'string' ? b.note : undefined,
      approvedBy: c.callerAccount,
      offerings: carried,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(term?.renewal ? { renewal: term.renewal } : {}),
    });
    await removeRequest(storage, c.appId, account);

    // The role decides WHAT they may reach; the grant is what lets them reach it without being
    // billed. Doing both here is the point of the roster living on the node: an approval that only
    // set a role would be a sentence with nothing behind it, and a demotion that left the grants
    // would keep billing the owner for somebody they just narrowed.
    // Reconcile whenever there is a plan to reconcile AGAINST — an explicit list, a declared plan, or
    // an existing member whose set may now be wrong for their new role. Skipping it when the caller
    // simply did not pass a list is what let a role change keep the grants of the role it replaced.
    const sync = (Array.isArray(b.offerings) || plan || before)
      ? await syncGrantsForMember(storage, {
          providerOwner: c.owner.toLowerCase(), providerGhii: `${c.owner}@${config.nodeId}`,
          consumer: `${account}@${config.nodeId}`, appId: c.appId, role,
          offeringIds: rec.offerings, note: rec.note,
        })
      : null;

    // Only a NEW member is told they were approved. A role change is a different message, and
    // sending "you were approved" again to somebody who already had access reads as a mistake.
    if (!before) {
      try {
        await notify(storage, `${account}@${config.nodeId}`, {
          type: 'app_member_approved',
          title: `You were approved for ${c.filename.replace(/\.html?$/i, '')}`,
          body: `${c.owner} approved you as ${role}.`,
          link: appLink(c.appId),
        });
      } catch (err) {
        // An approval must not fail because a bell could not be rung.
        logger.warn('app-members: approval notification failed, the membership stands', { error: String(err) });
      }
    }
    return res.status(before ? 200 : 201).json(success(config.nodeId, {
      member: rec, created: !before,
      // Never a bare ok: an approval that carried less than it promised must say so here, because
      // the member finds out as a 402 on their first call otherwise.
      access: sync ? { granted: sync.granted, revoked: sync.revoked, unchanged: sync.unchanged, failed: sync.failed } : null,
    }));
  });

  // ── DELETE .../members/:account — remove a member. Owner only. ──
  router.delete('/v1/apps/:owner/:filename/members/:account', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner removes its members'));
    const account = accountOf(String(req.params.account ?? ''));
    const gone = await removeMember(storage, c.appId, account);
    // Taking the role away takes the access with it. Leaving the grants behind would mean a removed
    // member keeps calling free and the owner keeps paying for it.
    if (gone && gone.offerings.length) {
      await syncGrantsForMember(storage, {
        providerOwner: c.owner.toLowerCase(), providerGhii: `${c.owner}@${config.nodeId}`,
        consumer: `${account}@${config.nodeId}`, appId: c.appId, role: gone.role,
        offeringIds: [],
      });
    }
    if (!gone) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such member'));
    try {
      await notify(storage, `${account}@${config.nodeId}`, {
        type: 'app_member_revoked',
        title: `Your access to ${c.filename.replace(/\.html?$/i, '')} ended`,
        body: `${c.owner} removed you from the member list.`,
        link: appLink(c.appId),
      });
    } catch (err) {
      logger.warn('app-members: removal notification failed, the removal stands', { error: String(err) });
    }
    return res.json(success(config.nodeId, { removed: true, member: gone }));
  });

  // ── POST .../members/requests — ask to be let in. Any authenticated caller. ──
  router.post('/v1/apps/:owner/:filename/members/requests', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (c.isOwner) {
      return res.status(400).json(error(config.nodeId, 'OWNER_CANNOT_ASK', 'You own this app; there is nobody to ask.'));
    }
    const already = await getMember(storage, c.appId, c.callerAccount);
    if (already) return res.json(success(config.nodeId, { recorded: false, alreadyMember: true, member: already }));

    const note = typeof (req.body ?? {}).note === 'string' ? String((req.body as Record<string, unknown>).note).slice(0, 400) : '';
    const rec = await putRequest(storage, { appId: c.appId, account: c.callerAccount, note });
    // The OWNER is the one who needs to know, and this is the direction an extension could never
    // reach: there the caller is the applicant, so the applicant would notify themselves.
    // Decide FROM the roster rather than guessing: the node does not own the role vocabulary, so the
    // one-click approval offers the role this app actually uses most, and the button says which one
    // it will grant. A button that grants an unnamed role is worse than no button.
    const roster = await listMembers(storage, c.appId);
    const tally = new Map<string, number>();
    for (const m of roster) tally.set(m.role, (tally.get(m.role) ?? 0) + 1);
    const suggested = [...tally.entries()].sort((a2, b2) => b2[1] - a2[1])[0]?.[0] ?? 'member';
    try {
      await notify(storage, `${c.owner}@${config.nodeId}`, {
        type: 'app_member_request',
        title: `${c.callerAccount} asked for access to ${c.filename.replace(/\.html?$/i, '')}`,
        body: note || 'No message was left.',
        link: appLink(c.appId),
        // Inline actions execute with the RECIPIENT's own authority when clicked, so they may only
        // ever be set by trusted server code — which is what this is. The public notifications
        // route rejects them outright for exactly that reason.
        actions: [
          { id: 'approve', label: `Approve as ${suggested}`, kind: 'api', method: 'POST',
            endpoint: `/v1/apps/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.filename)}/members`,
            body: { account: c.callerAccount, role: suggested }, style: 'primary' },
          { id: 'decline', label: 'Decline', kind: 'api', method: 'DELETE',
            endpoint: `/v1/apps/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.filename)}/members/requests/${encodeURIComponent(c.callerAccount)}`,
            confirm: true, style: 'default' },
        ],
      });
    } catch (err) {
      logger.warn('app-members: request notification failed, the request stands', { error: String(err) });
    }
    return res.status(201).json(success(config.nodeId, { recorded: true, request: rec }));
  });

  // ── DELETE .../members/requests/:account — decline an ask. Owner only. ──
  router.delete('/v1/apps/:owner/:filename/members/requests/:account', requireAuth(), async (req, res) => {
    const c = await context(req);
    if ('bad' in c) return res.status(400).json(error(config.nodeId, 'INVALID_INPUT', c.bad));
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner decides its requests'));
    const account = accountOf(String(req.params.account ?? ''));
    await putRequest(storage, { appId: c.appId, account, state: 'declined' });
    return res.json(success(config.nodeId, { declined: true }));
  });

  return router;
}
