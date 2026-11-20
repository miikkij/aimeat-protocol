/**
 * @file src/routes/organisms/value.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The organism's value report (services/value/report.ts, scope `organism`): what AI made
 *   in the organism or one of its workspaces, what happened to it, and the rhythm, as sums per feature
 *   and never per member or agent. The person's own report is GET /v1/usage/summary?report=value and
 *   the node's is GET /v1/admin/usage/summary?report=value; this is the third scope.
 *
 *   WHO MAY READ IT. The organism's creator and its admins, the people who run it. A member is refused
 *   the organism-wide report, because a workspace a member cannot open would still show its activity in
 *   the counts; with `ws`, a member who may read that workspace reads that workspace's report.
 * @structure valueRouter · GET /v1/organisms/:id/value
 * @version-history
 *   v1.2.0 — 2026-11-20 — With `ws`, a member who may read that workspace reads its report.
 *   v1.1.0 — 2026-11-20 — `measures`: the organism's own measures the reader keeps
 *     (services/value/measures.ts), each counted only in a workspace the reader may read.
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 2).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { callerOf } from '../../middleware/caller.js';
import { memberRoleOf } from '../../services/workspace/ops-caller.js';
import { readValueReport } from '../../services/value/report.js';
import { readMeasures } from '../../services/value/measures.js';
import { canReadWorkspace } from '../../services/access-guard.js';
import { isForeignPrincipal } from '../../utils/gaii.js';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function valueRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** GET /v1/organisms/:id/value?ws=&from=&to= — the organism's (or one workspace's) value report. */
  router.get('/v1/organisms/:id/value', requireAuth(), requireScope('organism:read'), async (req: Request, res: Response) => {
    const orgId = req.params.id as string;
    const ws = typeof req.query.ws === 'string' && req.query.ws ? req.query.ws : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (!ID.test(orgId) || (ws !== undefined && !ID.test(ws))) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'The organism and workspace ids are letters, digits, - and _.'));
      return;
    }
    if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'from and to are YYYY-MM-DD.'));
      return;
    }
    // A session from another node is not a member here, whatever its local part says.
    if (isForeignPrincipal(req.auth)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'A session from another node does not read this organism\'s report.'));
      return;
    }
    const caller = callerOf(req, config.nodeId, storage);
    const role = await memberRoleOf(storage, {
      principal: caller.principal, ownerName: caller.owner, ownerGhii: caller.ownerGhii,
      writerGaii: caller.principal, roles: [...caller.auth.roles],
    }, orgId);
    // A member reads one workspace's report when they may read that workspace: its sums say nothing the
    // workspace does not already show them. The organism-wide report stays its creators' and admins'.
    const manager = role === 'creator' || role === 'admin';
    let allowed = manager;
    if (!manager && role === 'member' && ws) {
      const organism = await storage.getOrganism(orgId);
      allowed = !!organism && await canReadWorkspace(storage, config, organism, caller.auth.sub, caller.owner, caller.principal, ws);
    }
    if (!allowed) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', ws
        ? 'A workspace\'s value report is for the organism\'s creator and admins and the members who may read that workspace.'
        : 'The organism\'s value report is for its creator and admins.'));
      return;
    }
    const report = await readValueReport({ storage, config }, { kind: 'organism', orgId, ...(ws ? { wsId: ws } : {}) }, { from, to });
    // The organism's own measures as this reader keeps them, counted only where the reader may read.
    const measures = await readMeasures({ storage, config }, caller.ownerGhii, orgId, { from: report.from, to: report.to, ...(ws ? { wsId: ws } : {}) });
    res.json(success(config.nodeId, { ...report, measures }, [
      { description: 'Your own value report', method: 'GET', url: '/v1/usage/summary?report=value' },
    ]));
  });

  return router;
}
