/**
 * @file living.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Living Documents routes. Phase 1 exposes the AI template AUTHOR: given a plain-language
 *   need (+ the owner's agent-offer catalogue for grounding), the caller's own OpenRouter model designs
 *   a reusable living-document template the client editor can load and the user can hand-edit. Template
 *   storage, deploy, and rendering are client-orchestrated over the generic memory/organism APIs
 *   (no-SSR); the background pulse arrives in a later phase. See
 *   docs/plans/2026-06-21-living-documents-plan.md.
 * @structure POST /v1/living/author — the owner, or their agent holding ai:use; returns { template, model }
 * @usage app.use(livingRouter(config, storage))
 * @version-history
 *   v1.3.0 — 2026-11-19 — POST /v1/living/author hands the caller to the service and admits the
 *     owner's agent or ecosystem app holding ai:use, planned and capped as that agent (the MCP tool
 *     aimeat_living_author runs the same service). An app grant stays refused (feature audit
 *     2026-11-19, 4.4 item 5).
 *   v1.2.0 — 2026-09-29 — TARGET-082 V4: GET /v1/living-docs hands the caller's ContentReader to the
 *     Living Docs composite, which filters the templates and instances through it.
 *   v1.1.0 — 2026-07-16 — Add GET /v1/living-docs composite (templates + instances partitioned from one
 *     owner-memory scan + organisms), folding the tab's two duplicate memory scans (LivingDocsService).
 *   v1.0.0 — 2026-06-21 — Phase 1: AI template author.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRole, requireRoleOrScope } from '../auth/middleware.js';
import { callerOf } from '../middleware/caller.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { NotebookAiError } from '../services/notebook/ai.js';
import { authorLivingTemplate } from '../services/living/author.js';
import { scanOwnerDue } from '../services/living/pulse.js';
import { createLivingDocsService } from '../services/db/living-docs-db-service.js';
import { readerFor } from '../services/classification/reader.js';

export function livingRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const livingDocsDb = createLivingDocsService(storage);

  // GET /v1/living-docs — the Living Docs tab mount in ONE call: templates + deployed instances (both
  // partitioned server-side from a single owner-memory scan, replacing two identical full scans) + the
  // owner's organisms (deploy-target picker). Owner-scoped read.
  router.get('/v1/living-docs', requireAuth(), requireRole('owner'), async (req, res) => {
    const owner = req.auth!.owner as string;
    const data = await livingDocsDb.overview(readerFor({ storage, config }, req.auth), owner);
    res.json(success(config.nodeId, data));
  });

  // POST /v1/living/author — design a living-document template from a description. The owner pays;
  // the owner in person, or an agent or an ecosystem app of the owner holding ai:use, asks, and an
  // agent's call is planned as that agent's (services/living/author.ts authorPayer). An app grant
  // stays refused, as requireRole('owner') refused it before: its app is not on the caller, and the
  // planner would read it as the owner in person. No writes happen here; the client saves the template.
  router.post('/v1/living/author', requireAuth(), requireRoleOrScope('owner', 'ai:use'), async (req, res) => {
    const caller = callerOf(req, config.nodeId, storage);
    if (caller.kind === 'app' || caller.visitor) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only the account holder, or their own AI with permission to use AI, designs a document template here.'));
      return;
    }
    const { need, catalogue } = req.body as { need?: string; catalogue?: unknown };
    if (!need || typeof need !== 'string' || !need.trim()) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'need is required'));
      return;
    }
    req.setTimeout(600_000);
    res.setTimeout(600_000);
    try {
      const result = await authorLivingTemplate(storage, config, { caller, need, catalogue });
      res.json(success(config.nodeId, result));
    } catch (e) {
      if (e instanceof NotebookAiError) {
        res.status(e.status).json(error(config.nodeId, e.code, e.message));
        return;
      }
      res.status(500).json(error(config.nodeId, 'AUTHOR_FAILED', (e as Error).message));
    }
  });

  // POST /v1/living/pulse-due — run the unattended (self-fulfilled) pulse NOW for the caller's own
  // due living documents. Same logic the scheduler runs across all owners; exposed so the owner can
  // refresh on demand and to make the unattended path testable.
  router.post('/v1/living/pulse-due', requireAuth(), requireRole('owner'), async (req, res) => {
    req.setTimeout(1_800_000);
    res.setTimeout(1_800_000);
    try {
      const ownerGaii = resolveIdentity(req.auth!, config.nodeId);
      const result = await scanOwnerDue(storage, config, ownerGaii);
      res.json(success(config.nodeId, result));
    } catch (e) {
      res.status(500).json(error(config.nodeId, 'PULSE_FAILED', (e as Error).message));
    }
  });

  return router;
}
