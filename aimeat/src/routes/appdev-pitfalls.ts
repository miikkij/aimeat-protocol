/**
 * @file appdev-pitfalls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the curated appdev-pitfall registry (data/appdev-pitfalls.ts) —
 *   platform-level "what bites app builders" knowledge for AI agents building apps ON AIMEAT.
 *   GET /v1/appdev/pitfalls returns a paginated index with facet counts;
 *   GET /v1/appdev/pitfalls/:id returns one full entry. Public read-only data (CORS *).
 *   Scope note: this surface covers app development on the platform only, never node development.
 * @structure appdevPitfallsRouter(config, storage) → Router
 * @usage app.use(appdevPitfallsRouter(config, storage)) from the routes loader.
 * @version-history
 *   v1.1.0 — 2026-07-19 — learned-entry management for the profile UI: GET /learned (full
 *     bodies, own + optional shared), PATCH /learned/:category/:slug (share/status flags),
 *     DELETE /learned/:category/:slug — registered before /:id (route-ordering).
 *   v1.0.0 — 2026-07-19 — initial: paginated index (+applies_to/severity filters, facets) + by-id.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  getAppdevPitfalls, getAppdevPitfallFacets,
} from '../data/appdev-pitfalls.js';
import {
  listLearnedPitfalls, setPitfallFlags, deletePitfallEntry,
} from '../services/appdev-kb.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export function appdevPitfallsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── LEARNED entries (the profile UI's management surface) — MUST be registered before
  // the parameterized /v1/appdev/pitfalls/:id route or "learned" would match as an id. ──

  // GET /v1/appdev/pitfalls/learned[?include_shared=1] — the caller's own learned entries
  // (full bodies, any visibility) + optionally other owners' public-shared entries.
  router.get('/v1/appdev/pitfalls/learned', requireAuth(), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const includeShared = req.query.include_shared === '1' || req.query.include_shared === 'true';
    const entries = await listLearnedPitfalls(storage, config, identity, { includeShared });
    res.json(success(config.nodeId, { pitfalls: entries, total: entries.length }));
  });

  // PATCH /v1/appdev/pitfalls/learned/:category/:slug — toggle share (visibility) / status.
  router.patch('/v1/appdev/pitfalls/learned/:category/:slug', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const share = typeof req.body?.share === 'boolean' ? req.body.share as boolean : undefined;
    const status = req.body?.status === 'active' || req.body?.status === 'outdated'
      ? req.body.status as 'active' | 'outdated' : undefined;
    if (share === undefined && status === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide share (boolean) and/or status (active|outdated)'));
      return;
    }
    const entry = await setPitfallFlags(storage, config, identity, req.params.category as string, req.params.slug as string, { share, status });
    if (!entry) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such learned pitfall in your scope'));
      return;
    }
    res.json(success(config.nodeId, { pitfall: entry }));
  });

  // DELETE /v1/appdev/pitfalls/learned/:category/:slug — remove the entry + manifest ref.
  router.delete('/v1/appdev/pitfalls/learned/:category/:slug', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const ok = await deletePitfallEntry(storage, config, identity, req.params.category as string, req.params.slug as string);
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such learned pitfall in your scope'));
      return;
    }
    res.json(success(config.nodeId, { deleted: true }));
  });

  // GET /v1/appdev/pitfalls[?applies_to=ext&severity=critical&limit=25&offset=0&include_outdated=1]
  router.get('/v1/appdev/pitfalls', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const appliesTo = typeof req.query.applies_to === 'string' ? req.query.applies_to : undefined;
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const includeOutdated = req.query.include_outdated === '1' || req.query.include_outdated === 'true';
    const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(req.query.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;

    let entries = getAppdevPitfalls({ includeOutdated });
    if (appliesTo) entries = entries.filter(p => (p.appliesTo as string[]).includes(appliesTo));
    if (severity) entries = entries.filter(p => p.severity === severity);

    // Severity first (critical → warn → info), stable within a class.
    const rank = { critical: 0, warn: 1, info: 2 } as const;
    entries = [...entries].sort((a, b) => rank[a.severity] - rank[b.severity]);

    const page = entries.slice(offset, offset + limit);
    res.json(success(config.nodeId, {
      pitfalls: page,
      total: entries.length,
      offset,
      limit,
      facets: getAppdevPitfallFacets(entries),
    }, [{ description: 'One full entry', method: 'GET', url: '/v1/appdev/pitfalls/{id}' }]));
  });

  // GET /v1/appdev/pitfalls/:id — one full entry.
  router.get('/v1/appdev/pitfalls/:id', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const id = req.params.id as string;
    const entry = getAppdevPitfalls({ includeOutdated: true }).find(p => p.id === id);
    if (!entry) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No appdev pitfall "${id}"`));
      return;
    }
    res.json(success(config.nodeId, { pitfall: entry }));
  });

  return router;
}
