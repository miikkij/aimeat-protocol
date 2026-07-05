/**
 * @file librarian.ts
 * @description The "librarian" retrieval route — natural-language full-text search fanned across
 *   every organism the caller has contributed to plus their personal memory, in one ranked call.
 *   Backed by the generic `storage.searchText()` FTS primitive via the librarian service. Generic
 *   and reusable: any client (the organism-notebook app, an agent, a CLI) can ask "give me what I
 *   have about X" and get back ranked, snippeted, organism-annotated hits to pick from.
 * @structure GET /v1/librarian/search?q=&limit= — requireAuth; the `own` search fans across the
 *   owner's full read surface (GHII + agents + ecosystem apps) for an owner session OR any grant
 *   carrying `memory:read`; otherwise it is scoped to the caller's own identity.
 * @usage app.use(librarianRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: Tier-1 fan-across librarian search.
 *   v1.1.0 — 2026-07-04 — classify/plan/distribute accept an `ai:use`-scoped token (H-2 app-grant)
 *     in addition to an owner session — the same capability boundary as /v1/ai/complete, so a
 *     sandboxed browser app on an isolated app origin (Notebook-engine apps like DROP) can run
 *     the owner's AI over the owner's own material once the owner granted ai:use.
 *   v1.2.0 — 2026-07-05 — Fan-out is now gated by `memory:read`, not by an owner session alone:
 *     an app/agent grant that resolves to the owner's GHII previously searched only GHII-owned rows
 *     (missing every agent-authored namespace); with `memory:read` it searches the owner's full read
 *     surface. Consent lives in the grant (mirrors discovery/memory-source). Fixes DROP librarian_assess.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { librarianSearch } from '../services/librarian.js';
import { classifyNote, distributeNote } from '../services/notebook-classify.js';
import { NotebookAiError } from '../services/notebook-ai.js';
import { planNote } from '../services/notebook-plan.js';

const MAX_LIMIT = 100;

export function librarianRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /** Owner session, or any token (agent / H-2 app-grant) carrying the `ai:use` scope.
   *  These endpoints run the owner's AI over the owner's own material — the same capability
   *  boundary as /v1/ai/complete, and the same gate shape (see ai.ts gateOwnerOrAiUseAgent),
   *  so a sandboxed app-origin session (role 'app') works once the owner granted ai:use. */
  function gateOwnerOrAiUse(req: Request, res: Response): boolean {
    const roles = req.auth?.roles ?? [];
    if (roles.includes('owner')) return true;
    const scopes = (req.auth as { scopes?: string[] } | undefined)?.scopes ?? [];
    if (scopes.includes('ai:use') || scopes.includes('*')) return true;
    res.status(403).json(error(config.nodeId, 'FORBIDDEN',
      'This endpoint requires an owner session or a token with the ai:use scope.'));
    return false;
  }

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
    // Fan the `own` search across the owner's FULL read surface (GHII + every agent + every ecosystem
    // app) for an owner session, OR for any grant that carries `memory:read` — an app/agent token that
    // resolves to the owner's GHII sees only GHII-owned rows (published .latest docs + GHII memory)
    // without it, missing everything the owner's agents authored in their own namespaces. The consent
    // to read the owner's private surface lives in the GRANT, not in content classification (mirrors
    // discovery/sources/memory-source.ts). Without it, the search stays scoped to the caller's own id.
    const scopes = (req.auth as { scopes?: string[] } | undefined)?.scopes ?? [];
    const fanOutOwner = isOwnerSession || scopes.includes('memory:read') || scopes.includes('*');
    const viewerGaii = resolveIdentity(req.auth!, config.nodeId);

    const { hits, ownersSearched } = await librarianSearch(storage, config, {
      ownerName: req.auth!.owner as string,
      fanOutOwner,
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
  router.post('/v1/librarian/classify', requireAuth(), async (req, res) => {
    if (!gateOwnerOrAiUse(req, res)) return;
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
  router.post('/v1/librarian/plan', requireAuth(), async (req, res) => {
    if (!gateOwnerOrAiUse(req, res)) return;
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
  router.post('/v1/librarian/distribute', requireAuth(), async (req, res) => {
    if (!gateOwnerOrAiUse(req, res)) return;
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
