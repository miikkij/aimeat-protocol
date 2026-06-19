/**
 * @file librarian.ts
 * @description The "librarian" retrieval route — natural-language full-text search fanned across
 *   every organism the caller has contributed to plus their personal memory, in one ranked call.
 *   Backed by the generic `storage.searchText()` FTS primitive via the librarian service. Generic
 *   and reusable: any client (the organism-notebook app, an agent, a CLI) can ask "give me what I
 *   have about X" and get back ranked, snippeted, organism-annotated hits to pick from.
 * @structure GET /v1/librarian/search?q=&limit= — requireAuth; owner sessions fan across GHII +
 *   agents + ecosystem apps, agent sessions are scoped to themselves.
 * @usage app.use(librarianRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: Tier-1 fan-across librarian search.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { librarianSearch } from '../services/librarian.js';

const MAX_LIMIT = 100;

export function librarianRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/librarian/search — ranked full-text search across all of the caller's content.
  router.get('/v1/librarian/search', requireAuth(), async (req, res) => {
    const q = req.query.q as string | undefined;
    if (!q || !q.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'q query parameter is required'));
      return;
    }
    const limitParam = req.query.limit as string | undefined;
    let limit = limitParam !== undefined ? parseInt(limitParam, 10) : 50;
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, MAX_LIMIT);

    const keyPrefix = (req.query.prefix as string | undefined)?.trim() || undefined;
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);

    const { hits, ownersSearched } = await librarianSearch(storage, config, {
      ownerName: req.auth!.owner as string,
      isOwnerSession,
      viewerGaii,
      query: q,
      limit,
      keyPrefix,
    });

    res.json(success(config.nodeId, {
      query: q,
      hits,
      total: hits.length,
      owners_searched: ownersSearched,
    }, [
      { description: 'Read a hit in full', method: 'GET', url: '/v1/memory/{key}' },
    ]));
  });

  return router;
}
