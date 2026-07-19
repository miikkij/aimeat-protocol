/**
 * @file appdev-pitfalls.ts
 * @description Serves the curated appdev-pitfall registry (data/appdev-pitfalls.ts) —
 *   platform-level "what bites app builders" knowledge for AI agents building apps ON AIMEAT.
 *   GET /v1/appdev/pitfalls returns a paginated index with facet counts;
 *   GET /v1/appdev/pitfalls/:id returns one full entry. Public read-only data (CORS *).
 *   Scope note: this surface covers app development on the platform only, never node development.
 * @structure appdevPitfallsRouter(config) → Router
 * @usage app.use(appdevPitfallsRouter(config)) from the routes loader.
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial: paginated index (+applies_to/severity filters, facets) + by-id.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { success, error } from '../middleware/envelope.js';
import {
  getAppdevPitfalls, getAppdevPitfallFacets,
} from '../data/appdev-pitfalls.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export function appdevPitfallsRouter(config: AimeatConfig): Router {
  const router = Router();

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
