/**
 * @file src/routes/overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The overview of an account: its machines, agents, apps, knowledge and offerings,
 *   how much each was used in a period, and the lines between them.
 *
 *     GET /v1/overview?range=24h|7d|30d            the whole account (default 7d)
 *     GET /v1/overview?focus=<item id>             one item and everything one line away
 *     GET /v1/overview?limit=<n>                   the busiest n of each lane
 *
 *   The Overview page draws the whole answer; aimeat_overview reads it with `focus` or `limit` so an
 *   AI's context stays small. Both read services/overview/overview-read.ts.
 *
 *   WHO MAY READ IT. The owner in person, and a session acting for them that holds agent:read (the
 *   word the agent list asks), because the answer lists the owner's agents. Workspace names inside
 *   the owner's organisms are shown to the owner in person and to a session that also holds
 *   organism:read. A session from another node is a visitor and has no account here to show.
 * @structure overviewRouter(config, storage)
 * @usage router.use(overviewRouter(config, storage)); (routes/home.ts mounts it)
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { readOverview, trimOverview } from '../services/overview/overview-read.js';
import { OVERVIEW_RANGES, type OverviewRange } from '../services/overview/overview-types.js';

/** The largest `limit` a reader may ask for; the whole answer is the call without one. */
const MAX_LIMIT = 50;
/** An item id is `<kind>:<rest>`; anything longer than this names nothing the overview holds. */
const MAX_FOCUS = 300;

export function overviewRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/overview', requireAuth(), requireScope('agent:read'), async (req: Request, res: Response) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.visitor) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'The overview is an account of this node; a visitor from another node has none here.'));
      return;
    }
    const rawRange = typeof req.query.range === 'string' ? req.query.range : '7d';
    if (!(OVERVIEW_RANGES as readonly string[]).includes(rawRange)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', `range must be one of ${OVERVIEW_RANGES.join(', ')}`));
      return;
    }
    const focus = typeof req.query.focus === 'string' && req.query.focus.trim() ? req.query.focus.trim() : undefined;
    if (focus && focus.length > MAX_FOCUS) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'focus is an item id from this answer'));
      return;
    }
    const askedLimit = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(askedLimit) && askedLimit > 0 ? Math.min(askedLimit, MAX_LIMIT) : undefined;

    const view = await readOverview({ config, storage }, {
      owner: caller.owner,
      ownerGhii: caller.ownerGhii,
      seeWorkspaces: caller.inPerson || caller.has('organism:read'),
    }, rawRange as OverviewRange);
    const answer = trimOverview(view, { focus, limit });
    if (focus && answer.items.length === 0) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No item ${focus} in this account's overview.`));
      return;
    }
    res.json(success(config.nodeId, answer, [
      { description: 'One item and its lines', method: 'GET', url: '/v1/overview?focus={item id}' },
      { description: 'The machines', method: 'GET', url: '/v1/agents/v2/connectors' },
      { description: 'Every agent', method: 'GET', url: '/v1/agents?include=stats' },
    ]));
  });

  return router;
}
