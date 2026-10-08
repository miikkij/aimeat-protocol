/**
 * @file src/routes/visibility-behaviour.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description On-page behaviour over REST (AI visibility, layer D): the public beacon the behaviour
 *   script sends when a page view ends, and the owner's report, settings and fixing agent. The MCP
 *   tools `aimeat_visibility_behaviour`, `aimeat_visibility_behaviour_set` and
 *   `aimeat_visibility_behaviour_fix` call the same service functions.
 *
 *   THE BEACON IS PUBLIC AND READS NOTHING BACK. It answers 204 whatever happens (unknown owner,
 *   unknown app, an app switched off, a body of the wrong shape), so the address discloses nothing,
 *   and it is rate-limited per address without keeping the address. A browser that sends
 *   `Sec-GPC: 1` or `DNT: 1` is counted as a view and nothing more, whatever the body says.
 * @structure visibilityBehaviourRouter (POST /v1/signals/behaviour · GET /v1/visibility/behaviour ·
 *   GET|PUT /v1/visibility/behaviour/settings · POST /v1/visibility/behaviour/fix)
 * @usage router.use(visibilityBehaviourRouter(config, storage)) inside signalsRouter (routes/signals.ts)
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { logger } from '../utils/logger.js';
import { optedOut } from '../utils/visit-signals.js';
import { recordBehaviour } from '../services/visibility/behaviour-counter.js';
import { readBehaviour } from '../services/visibility/behaviour-report.js';
import {
  behaviourOnFor, setBehaviourSettings, nodeWatchesBehaviour, BehaviourSettingsError,
} from '../services/visibility/behaviour-settings.js';
import { runBehaviourFix, behaviourSettingsView, BehaviourFixError } from '../services/visibility/behaviour-fixer.js';
import { localAccountOf } from '../utils/gaii.js';

/** What the script sends. Every map is bounded again by the counter; this only refuses the wrong shape. */
const BeaconSchema = z.object({
  o: z.string().min(3).max(200),
  a: z.string().min(1).max(200),
  x: z.literal(1).optional(),
  vc: z.string().max(10).optional(),
  s: z.string().max(4).optional(),
  h: z.record(z.string().max(10), z.record(z.string().max(5), z.number().int().min(0).max(1000))).optional(),
  d: z.record(z.string().max(100), z.number().int().min(0).max(1000)).optional(),
  r: z.record(z.string().max(100), z.number().int().min(0).max(1000)).optional(),
});

const SettingsSchema = z.object({
  app: z.string().min(1).max(200).optional(),
  app_enabled: z.boolean().optional(),
  fixer: z.boolean().optional(),
}).strict();

const FixSchema = z.object({ app: z.string().min(1).max(200) }).strict();

export function visibilityBehaviourRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** The account whose behaviour this is. A visitor from another node has none here. */
  function ownerOf(req: Request, res: Response): string | null {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.visitor) {
      res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'A session from another node has no behaviour report here.'));
      return null;
    }
    return caller.ownerGhii;
  }

  // ── The beacon (public) ─────────────────────────────────────────────────────────────────────
  router.post('/v1/signals/behaviour',
    rateLimit({ windowMs: 60_000, max: 60, keyBy: 'ip' }),
    express.text({ type: 'text/plain', limit: '32kb' }),
    async (req, res) => {
      res.status(204).end();
      try {
        if (!nodeWatchesBehaviour(config)) return;
        let body: unknown = req.body;
        if (typeof body === 'string') {
          try { body = JSON.parse(body); } catch (e) {
            logger.debug('behaviour: a beacon body was not JSON', { error: String(e) });
            return;
          }
        }
        const parsed = BeaconSchema.safeParse(body);
        if (!parsed.success) return;
        const b = parsed.data;
        // The owner as the script wrote it, which is this node's GHII; anything else is not ours.
        if (!b.o.endsWith(`@${config.nodeId}`)) return;
        if (!(await behaviourOnFor(storage, config, b.o, b.a))) return;
        if (!(await storage.getApp(b.o, b.a))) return;
        const out = b.x === 1 || optedOut((n) => req.get(n));
        recordBehaviour(storage, {
          ownerGhii: b.o, app: b.a, optedOut: out,
          vc: b.vc, scroll: b.s, heat: b.h, dead: b.d, rage: b.r,
        });
      } catch (e) {
        logger.warn('behaviour: a beacon could not be counted', { error: String(e) });
      }
    });

  // ── The owner's side ────────────────────────────────────────────────────────────────────────
  router.get('/v1/visibility/behaviour', requireAuth(), requireScope('signals:read'), async (req, res) => {
    const owner = ownerOf(req, res);
    if (!owner) return;
    const days = typeof req.query.days === 'string' && /^\d{1,3}$/.test(req.query.days) ? Number(req.query.days) : undefined;
    const app = typeof req.query.app === 'string' && req.query.app ? req.query.app.slice(0, 200) : undefined;
    res.json(success(config.nodeId, await readBehaviour(storage, config, owner, { app, days }), [
      { description: 'Switch an app or the fixing agent', method: 'PUT', url: '/v1/visibility/behaviour/settings' },
    ]));
  });

  router.get('/v1/visibility/behaviour/settings', requireAuth(), requireScope('signals:read'), async (req, res) => {
    const owner = ownerOf(req, res);
    if (!owner) return;
    res.json(success(config.nodeId, await behaviourSettingsView(storage, config, owner)));
  });

  router.put('/v1/visibility/behaviour/settings', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
    const owner = ownerOf(req, res);
    if (!owner) return;
    try {
      await setBehaviourSettings(storage, owner, { app: parsed.data.app, appEnabled: parsed.data.app_enabled, fixer: parsed.data.fixer });
    } catch (e) {
      if (e instanceof BehaviourSettingsError) {
        res.status(e.code === 'NOT_FOUND' ? 404 : 400).json(error(config.nodeId, e.code, e.message));
        return;
      }
      throw e;
    }
    res.json(success(config.nodeId, await behaviourSettingsView(storage, config, owner)));
  });

  router.post('/v1/visibility/behaviour/fix', requireAuth(), requireScope('signals:write'), async (req, res) => {
    const parsed = FixSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.message)); return; }
    const owner = ownerOf(req, res);
    if (!owner) return;
    try {
      const run = await runBehaviourFix(storage, config, owner, parsed.data.app, 'owner');
      const name = localAccountOf(owner) ?? '';
      res.json(success(config.nodeId, run, run.draft ? [
        { description: 'Read the draft', method: 'GET', url: `/v1/apps/${encodeURIComponent(name)}/${encodeURIComponent(parsed.data.app)}/draft` },
      ] : []));
    } catch (e) {
      if (e instanceof BehaviourFixError) { res.status(e.status).json(error(config.nodeId, e.code, e.message)); return; }
      throw e;
    }
  });

  return router;
}
