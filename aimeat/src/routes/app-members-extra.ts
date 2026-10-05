/**
 * @file app-members-extra.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two member-roster routes beside routes/app-members.ts, in a module of their own
 *   because that file was near the line limit: the roster's audit trail, and cancelling an open
 *   invitation. Both are for the app's owner and the members who manage its roster; the handlers
 *   are the route's gate and one call of services/app-roster-ops.ts, which the aimeat_app_manage
 *   MCP tool calls too.
 * @structure appMembersExtraRouter(config, storage) — GET .../members/audit,
 *   DELETE .../members/invites/:id
 * @usage router.use(appMembersExtraRouter(config, storage)), inside appMembersRouter
 * @version-history
 *   v1.1.0 — 2026-10-05 — The handlers' logic (the manager test, the refusals, the audit row) moved to
 *     services/app-roster-ops.ts (rosterAuditTrail, cancelInvite); aimeat_app_manage calls the service
 *     in place of the route over loopback HTTP (secaudit 2026-10, M6).
 *   v1.0.2 — 2026-10-01 — The roster history reads the archived years of the audit log too.
 *   v1.0.1 — 2026-10-01 — The cancel's audit row names the address, so the history can say whom.
 *   v1.0.0 — 2026-10-01 — Initial (IAM round 2, A2 and B2).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { requireScopeOrOwnApp } from '../auth/app-own-gate.js';
import { rosterAuditTrail, cancelInvite } from '../services/app-roster-ops.js';
import { sendAppOp } from './app-op-answer.js';

export function appMembersExtraRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const refOf = (params: Record<string, unknown>) => ({ owner: String(params.owner ?? ''), filename: String(params.filename ?? '') });

  // ── GET .../members/audit — who decided what about whom, newest first. Owner and managers. ──
  router.get('/v1/apps/:owner/:filename/members/audit', requireAuth(), requireScopeOrOwnApp('app:write'), async (req, res) =>
    sendAppOp(res, config.nodeId, await rosterAuditTrail(storage, config, req.auth!, refOf(req.params), {
      limit: req.query.limit, before: req.query.before,
    })));

  // ── DELETE .../members/invites/:id — cancel an open invitation. Owner and managers. ──
  router.delete('/v1/apps/:owner/:filename/members/invites/:id', requireAuth(), requireScopeOrOwnApp('app:manage'), async (req, res) =>
    sendAppOp(res, config.nodeId, await cancelInvite(storage, config, req.auth!, refOf(req.params), String(req.params.id ?? ''))));

  return router;
}
