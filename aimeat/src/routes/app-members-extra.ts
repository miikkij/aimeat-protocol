/**
 * @file app-members-extra.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two member-roster routes beside routes/app-members.ts, in a module of their own
 *   because that file is near the line limit: the roster's audit trail, and cancelling an open
 *   invitation. Both are for the app's owner and the members who manage its roster, through the
 *   same request context (routes/app-members-context.ts).
 * @structure appMembersExtraRouter(config, storage) — GET .../members/audit,
 *   DELETE .../members/invites/:id
 * @usage router.use(appMembersExtraRouter(config, storage)), inside appMembersRouter
 * @version-history
 *   v1.0.2 — 2026-10-01 — The roster history reads the archived years of the audit log too.
 *   v1.0.1 — 2026-10-01 — The cancel's audit row names the address, so the history can say whom.
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2, A2 and B2).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { requireScopeOrOwnApp } from '../auth/app-own-gate.js';
import { success, error } from '../middleware/envelope.js';
import { membersContext } from './app-members-context.js';
import { readAppAudit } from '../services/app-audit.js';
import { readAllEntries } from '../services/app-audit-archive.js';
import { memberAuditRows, isManagerRole } from '../services/app-member-rules.js';
import { findInvite, removeInvite, inviteView } from '../services/app-member-invites.js';

export function appMembersExtraRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const { context, bucketOf, audit, sendContextError } = membersContext(config, storage);

  // ── GET .../members/audit — who decided what about whom, newest first. Owner and managers. ──
  // The rows of the app's audit log that are about the roster: approvals, role changes, removals,
  // declines, dismissals, invitations, plan changes and sweeps. The owner's other settings (terms,
  // badges, development rights) stay the owner's, so a manager reads only these.
  router.get('/v1/apps/:owner/:filename/members/audit', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.canManage) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner, or a member who manages its roster, reads its audit trail'));
    }
    // The archived years too, so paging back with `before` reaches the oldest roster entry kept.
    const bucket = await bucketOf(c.owner);
    const entries = await readAllEntries(storage, bucket, c.filename, await readAppAudit(storage, bucket, c.filename));
    const page = memberAuditRows(entries, { limit: req.query.limit, before: req.query.before });
    return res.json(success(config.nodeId, page));
  });

  // ── DELETE .../members/invites/:id — cancel an open invitation. Owner and managers. ──
  // The same word as declining an ask: nothing is granted or withdrawn, a pending decision is ended.
  // A manager cannot cancel an invitation into a managing role, which only the owner can have sent.
  router.delete('/v1/apps/:owner/:filename/members/invites/:id', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) => {
    const c = await context(req);
    if (sendContextError(res, c)) return;
    if (!c.canManage) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner, or a member who manages its roster, cancels its invitations'));
    }
    const inv = await findInvite(storage, c.appId, String(req.params.id ?? ''));
    if (!inv) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such invitation.'));
    if (!c.isOwner && isManagerRole(c.plan, inv.role)) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app owner gives, changes or takes away a role that manages the roster.'));
    }
    await removeInvite(storage, c.appId, inv.emailHash);
    await audit(c, 'invite.cancelled', { account: null, from: inv.role, invite: inv.id, email: inv.emailShown });
    return res.json(success(config.nodeId, { cancelled: true, invite: inviteView(inv) }));
  });

  return router;
}
