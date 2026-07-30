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
} from '../services/app-members.js';
import { notify } from '../services/notify.js';
import { syncGrantsForMember } from '../services/grant-sync.js';
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
    if (!c.isOwner) return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner reads its roster'));
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
    const rec = await putMember(storage, {
      appId: c.appId, account, role,
      level: typeof b.level === 'number' ? b.level : undefined,
      note: typeof b.note === 'string' ? b.note : undefined,
      approvedBy: c.callerAccount,
      offerings: Array.isArray(b.offerings) ? b.offerings.filter(x => typeof x === 'string') as string[] : undefined,
    });
    await removeRequest(storage, c.appId, account);

    // The role decides WHAT they may reach; the grant is what lets them reach it without being
    // billed. Doing both here is the point of the roster living on the node: an approval that only
    // set a role would be a sentence with nothing behind it, and a demotion that left the grants
    // would keep billing the owner for somebody they just narrowed.
    const sync = Array.isArray(b.offerings)
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
    try {
      await notify(storage, `${c.owner}@${config.nodeId}`, {
        type: 'app_member_request',
        title: `${c.callerAccount} asked for access to ${c.filename.replace(/\.html?$/i, '')}`,
        body: note || 'No message was left.',
        link: appLink(c.appId),
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
