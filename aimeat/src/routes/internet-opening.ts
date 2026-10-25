/**
 * @file src/routes/internet-opening.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The REST routes of an app opened to the internet on a closed node
 *   (services/internet-opening/). The owner reads, opens and closes their own app's opening; an
 *   operator reads the node's list, decides what waits, closes any opening, and names the owners who
 *   open without asking. Every route calls the service the MCP tools call (mcp/internet-opening.ts).
 *
 *     GET    /v1/apps/:owner/:filename/internet-opening           the app's opening (owner, operator)
 *     POST   /v1/apps/:owner/:filename/internet-opening           open, ask, or extend (owner)
 *     DELETE /v1/apps/:owner/:filename/internet-opening           close or withdraw (owner, operator)
 *     GET    /v1/admin/internet-openings                          the operators' list
 *     POST   /v1/admin/internet-openings/:owner/:filename/decision  approve or decline what waits
 *     POST   /v1/admin/internet-openings/:owner/:filename/close     close any opening
 *     PUT    /v1/admin/internet-openers/:owner                    trust an owner to open on their own
 *     DELETE /v1/admin/internet-openers/:owner                    take that back
 * @structure internetOpeningRouter(config, storage)
 * @usage app.use(internetOpeningRouter(config, storage));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { Router, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope, requireOperator } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { localAccountName } from '../utils/gaii.js';
import { openingDoor, actorOf } from '../services/internet-opening/opening-door.js';
import { closeOpening, decideOpening, setTrustedOpener, type OpeningResult } from '../services/internet-opening/opening-service.js';
import { operatorOpeningsList, ownerOpeningView, openingToApi } from '../services/internet-opening/opening-view.js';

export function internetOpeningRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const ctx = { storage, config };

  const refused = (res: Response, r: Extract<OpeningResult<unknown>, { ok: false }>) =>
    res.status(r.status).json(error(config.nodeId, r.code, r.message));

  // The word the app's other owner views ask (its audit log, routes/apps/legal.ts).
  router.get('/v1/apps/:owner/:filename/internet-opening', requireAuth(), requireScope('app:write'), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const owner = localAccountName(req.params.owner as string);
    const operator = await c.operator();
    if (c.visitor || (c.owner !== owner && !operator)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'App not found'));
      return;
    }
    const view = await ownerOpeningView(ctx, owner, req.params.filename as string, operator);
    if (!view) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'App not found')); return; }
    res.json(success(config.nodeId, view));
  });

  router.post('/v1/apps/:owner/:filename/internet-opening', requireAuth(), requireScope('app:write'), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    if (c.owner !== localAccountName(req.params.owner as string)) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Only the app\'s owner opens it to the internet.'));
      return;
    }
    const body = (req.body ?? {}) as { reason?: unknown; days?: unknown };
    const r = await openingDoor(ctx, c, { filename: req.params.filename as string, reason: body.reason, days: body.days });
    if (!r.ok) { refused(res, r); return; }
    if (r.data.outcome === 'owner_asked') { res.status(202).json(success(config.nodeId, r.data)); return; }
    res.status(r.data.outcome === 'requested' || r.data.outcome === 'extend_requested' ? 202 : 200)
      .json(success(config.nodeId, { outcome: r.data.outcome, opening: openingToApi(r.data.opening) }));
  });

  router.delete('/v1/apps/:owner/:filename/internet-opening', requireAuth(), requireScope('app:write'), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    if (c.visitor) { res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A session from another node closes nothing here.')); return; }
    // The reason in the body, or in the query for a client whose DELETE carries no body.
    const r = await closeOpening(ctx, await actorOf(c), {
      owner: localAccountName(req.params.owner as string), filename: req.params.filename as string,
      reason: (req.body ?? {}).reason ?? req.query.reason,
    });
    if (!r.ok) { refused(res, r); return; }
    res.json(success(config.nodeId, { opening: openingToApi(r.data.opening) }));
  });

  router.get('/v1/admin/internet-openings', requireAuth(), requireOperator(storage), async (req, res) => {
    res.json(success(config.nodeId, await operatorOpeningsList(ctx, { state: req.query.state })));
  });

  router.post('/v1/admin/internet-openings/:owner/:filename/decision', requireAuth(), requireOperator(storage), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const body = (req.body ?? {}) as { decision?: unknown; note?: unknown; which?: unknown };
    const r = await decideOpening(ctx, await actorOf(c), {
      owner: localAccountName(req.params.owner as string), filename: req.params.filename as string,
      decision: body.decision, note: body.note, which: body.which,
    });
    if (!r.ok) { refused(res, r); return; }
    res.json(success(config.nodeId, { decided: r.data.decided, opening: openingToApi(r.data.opening) }));
  });

  router.post('/v1/admin/internet-openings/:owner/:filename/close', requireAuth(), requireOperator(storage), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const r = await closeOpening(ctx, await actorOf(c), {
      owner: localAccountName(req.params.owner as string), filename: req.params.filename as string, reason: (req.body ?? {}).reason,
    });
    if (!r.ok) { refused(res, r); return; }
    res.json(success(config.nodeId, { opening: openingToApi(r.data.opening) }));
  });

  router.put('/v1/admin/internet-openers/:owner', requireAuth(), requireOperator(storage), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const body = (req.body ?? {}) as { reason?: unknown; until?: unknown };
    const r = await setTrustedOpener(ctx, await actorOf(c), { owner: localAccountName(req.params.owner as string), allowed: true, reason: body.reason, until: body.until });
    if (!r.ok) { refused(res, r); return; }
    res.json(success(config.nodeId, r.data));
  });

  router.delete('/v1/admin/internet-openers/:owner', requireAuth(), requireOperator(storage), async (req, res) => {
    const c = callerOf(req, config.nodeId, storage);
    const r = await setTrustedOpener(ctx, await actorOf(c), { owner: localAccountName(req.params.owner as string), allowed: false });
    if (!r.ok) { refused(res, r); return; }
    res.json(success(config.nodeId, r.data));
  });

  return router;
}
