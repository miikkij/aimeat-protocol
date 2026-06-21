/**
 * @file living.ts
 * @description Living Documents routes. Phase 1 exposes the AI template AUTHOR: given a plain-language
 *   need (+ the owner's agent-offer catalogue for grounding), the caller's own OpenRouter model designs
 *   a reusable living-document template the client editor can load and the user can hand-edit. Template
 *   storage, deploy, and rendering are client-orchestrated over the generic memory/organism APIs
 *   (no-SSR); the background pulse arrives in a later phase. See
 *   docs/plans/2026-06-21-living-documents-plan.md.
 * @structure POST /v1/living/author — requireAuth + requireRole('owner'); returns { template, model }
 * @usage app.use(livingRouter(config, storage))
 * @version-history
 *   v1.0.0 — 2026-06-21 — Phase 1: AI template author.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { NotebookAiError } from '../services/notebook-ai.js';
import { authorLivingTemplate } from '../services/living-author.js';

export function livingRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // POST /v1/living/author — design a living-document template from a description (owner-scoped: it
  // decrypts the caller's own OpenRouter key). No writes happen here; the client saves the template.
  router.post('/v1/living/author', requireAuth(), requireRole('owner'), async (req, res) => {
    const { need, catalogue } = req.body as { need?: string; catalogue?: unknown };
    if (!need || typeof need !== 'string' || !need.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'need is required'));
      return;
    }
    req.setTimeout(600_000);
    res.setTimeout(600_000);
    try {
      const gaii = resolveIdentity(req.auth!, config.nodeId);
      const result = await authorLivingTemplate(storage, config, { gaii, need, catalogue });
      res.json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof NotebookAiError) {
        res.status(e.status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'AUTHOR_FAILED', (e as Error).message));
    }
  });

  return router;
}
