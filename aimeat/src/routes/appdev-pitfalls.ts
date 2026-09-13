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
 *   v1.3.0 — 2026-09-13 — POST /learned reports (upserts) an entry through reportLearnedPitfall(),
 *     the node MCP tool's own function, so the connector doors stop writing raw memory. PATCH
 *     /learned/:category/:slug takes `verified: true`, stamping the entry with now and this node's
 *     software version. Curated entries carry verifiedAt/verifiedVersion.
 *   v1.2.0 — 2026-09-03 — GET /learned pages, filters (status, severity, category, model, area,
 *     shared, q text search), sorts and returns facets + the community count, through the same
 *     step the MCP list tool uses (AppDev page, poster face). It served every entry with its full
 *     body before, 112 rows and about 150 kB on the production node.
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
  queryLearnedPitfalls, setPitfallFlags, deletePitfallEntry, reportLearnedPitfall,
} from '../services/appdev-kb.js';
import { getSoftwareVersion } from '../utils/version.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

export function appdevPitfallsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── LEARNED entries (the profile UI's management surface) — MUST be registered before
  // the parameterized /v1/appdev/pitfalls/:id route or "learned" would match as an id. ──

  // GET /v1/appdev/pitfalls/learned[?include_shared=1&status=&severity=&category=&model=
  //   &applies_to=&shared=&q=&sort=&limit=&offset=] — one page of the caller's own learned
  // entries (full bodies, any visibility) + optionally other owners' public-shared entries, with
  // the facet counts around it. The step is the one the MCP list tool uses (appdev-kb.ts).
  router.get('/v1/appdev/pitfalls/learned', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const bool = (v: unknown) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : undefined);
    const num = (v: unknown) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : undefined; };
    const status = str(req.query.status);
    const sort = str(req.query.sort);
    const page = await queryLearnedPitfalls(storage, config, identity, {
      includeShared: bool(req.query.include_shared) === true,
      // This door defaults to every status: it served the whole scope before it could page, and
      // the page asks for status=active itself when it wants outdated hidden.
      status: status === 'active' || status === 'outdated' ? status : 'all',
      severity: str(req.query.severity),
      category: str(req.query.category),
      model: str(req.query.model),
      applies_to: str(req.query.applies_to),
      shared: bool(req.query.shared),
      q: str(req.query.q),
      sort: sort === 'severity' ? 'severity' : 'updated',
      limit: num(req.query.limit),
      offset: num(req.query.offset),
    });
    res.json(success(config.nodeId, page));
  });

  // POST /v1/appdev/pitfalls/learned — report (upsert) one learned pitfall. The same function the
  // node's MCP tool runs, and the door both connector surfaces now call: they used to write
  // POST /v1/memory themselves, which skipped the manifest and could fork a second copy of an entry
  // another of the owner's identities already held.
  router.post('/v1/appdev/pitfalls/learned', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max ? v : undefined;
    const model = str(b.model, 64)?.trim();
    const category = str(b.category, 40);
    const title = str(b.title, 160);
    const symptom = str(b.symptom, 10_000);
    const resolution = str(b.resolution, 40_000);
    if (!model || !category || !title || title.length < 3 || !symptom || symptom.length < 5 || !resolution || resolution.length < 5) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'model, category, title (3-160), symptom (5-10000) and resolution (5-40000) are required'));
      return;
    }
    const severity = b.severity === 'info' || b.severity === 'warn' || b.severity === 'critical' ? b.severity : undefined;
    const status = b.status === 'active' || b.status === 'outdated' ? b.status : undefined;
    const appliesTo = Array.isArray(b.applies_to)
      ? (b.applies_to as unknown[]).filter((a): a is string => typeof a === 'string' && a.length <= 20).slice(0, 8)
      : undefined;
    const r = await reportLearnedPitfall(storage, config, {
      principal: resolveIdentity(req.auth!, config.nodeId),
      scopes: req.auth!.scopes ?? [],
      roles: req.auth!.roles,
    }, {
      model, category, title, symptom, resolution,
      slug: str(b.slug, 64), applies_to: appliesTo, severity, status,
      app_ref: str(b.app_ref, 200),
      share: typeof b.share === 'boolean' ? b.share : undefined,
    }, getSoftwareVersion());
    if (!r.ok) {
      res.status(r.status).json(error(config.nodeId, r.code, r.message));
      return;
    }
    res.status(r.updated ? 200 : 201).json(success(config.nodeId, {
      key: r.key, category: r.category, slug: r.slug, updated: r.updated, version: r.version,
      visibility: r.visibility, shared: r.visibility === 'public',
      verified_at: r.verified_at, verified_version: r.verified_version,
    }));
  });

  // PATCH /v1/appdev/pitfalls/learned/:category/:slug — toggle share (visibility) / status.
  router.patch('/v1/appdev/pitfalls/learned/:category/:slug', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const share = typeof req.body?.share === 'boolean' ? req.body.share as boolean : undefined;
    const status = req.body?.status === 'active' || req.body?.status === 'outdated'
      ? req.body.status as 'active' | 'outdated' : undefined;
    // `verified: true` records that somebody checked the entry against this node again, on the
    // version the node is running now. The version is the node's own, never the caller's word.
    const verified = req.body?.verified === true ? { version: getSoftwareVersion() } : undefined;
    if (share === undefined && status === undefined && verified === undefined) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide share (boolean), status (active|outdated) and/or verified (true)'));
      return;
    }
    const entry = await setPitfallFlags(storage, config, identity, req.params.category as string, req.params.slug as string, { share, status, verified });
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
