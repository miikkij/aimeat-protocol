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
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { librarianSearch } from '../services/librarian.js';
import { classifyNote, distributeNote } from '../services/notebook-classify.js';
import { NotebookAiError } from '../services/notebook-ai.js';
import { planNote } from '../services/notebook-plan.js';

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
    const scope = req.query.scope === 'public' ? 'public' : 'own';
    const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);

    const { hits, ownersSearched } = await librarianSearch(storage, config, {
      ownerName: req.auth!.owner as string,
      isOwnerSession,
      viewerGaii,
      query: q,
      limit,
      keyPrefix,
      scope,
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

  // POST /v1/librarian/classify — AI placement suggestion for a free-text note (notebook slice B).
  // Owner-scoped: it decrypts the caller's own OpenRouter key. The materialize step runs client-side
  // over the generic memory/organism APIs.
  router.post('/v1/librarian/classify', requireAuth(), requireRole('owner'), async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'text is required'));
      return;
    }
    req.setTimeout(600_000);
    res.setTimeout(600_000);
    try {
      const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
      const result = await classifyNote(storage, config, {
        gaii: viewerGaii,
        ownerName: req.auth!.owner as string,
        viewerGaii,
        text,
      });
      res.json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof NotebookAiError) {
        res.status(e.status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'CLASSIFY_FAILED', (e as Error).message));
    }
  });

  // POST /v1/librarian/plan — AI enrichment-plan generation for a free-text note (notebook stage 2).
  // Owner-scoped: decrypts the caller's own OpenRouter key. Multistep reasoning produces an ordered
  // plan of enrichment steps (reason about the note / assess the user's own material via the
  // librarian); the steps are then executed client-side. No writes happen here.
  router.post('/v1/librarian/plan', requireAuth(), requireRole('owner'), async (req, res) => {
    const { text, catalogue } = req.body as { text?: string; catalogue?: unknown };
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'text is required'));
      return;
    }
    req.setTimeout(600_000);
    res.setTimeout(600_000);
    try {
      const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
      const result = await planNote(storage, config, {
        gaii: viewerGaii,
        ownerName: req.auth!.owner as string,
        viewerGaii,
        text,
        catalogue,
      });
      res.json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof NotebookAiError) {
        res.status(e.status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'PLAN_FAILED', (e as Error).message));
    }
  });

  // POST /v1/librarian/distribute — split a note into chunks, each with a suggested home (notebook
  // stage 3). Owner-scoped (decrypts the caller's own OpenRouter key). The per-chunk materialize runs
  // client-side over the generic memory/organism APIs; nothing is written here.
  router.post('/v1/librarian/distribute', requireAuth(), requireRole('owner'), async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'text is required'));
      return;
    }
    req.setTimeout(600_000);
    res.setTimeout(600_000);
    try {
      const viewerGaii = resolveIdentity(req.auth!, config.nodeId);
      const result = await distributeNote(storage, config, {
        gaii: viewerGaii,
        ownerName: req.auth!.owner as string,
        viewerGaii,
        text,
      });
      res.json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof NotebookAiError) {
        res.status(e.status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'DISTRIBUTE_FAILED', (e as Error).message));
    }
  });

  return router;
}
