/**
 * @file appdev-overview.ts
 * @description GET /v1/appdev/overview — the authenticated "big picture" research surface for
 *   building apps ON AIMEAT (services/appdev-overview.ts). Query params: ?model= (indicative
 *   model filter for proofs + learned pitfalls), ?sections=apps,library_packs,... (partial
 *   fetch for token economy). Read-only; identity via resolveIdentity (owner or agent session).
 * @structure appdevOverviewRouter(config, storage) → Router
 * @usage app.use(appdevOverviewRouter(config, storage)) from the routes loader.
 * @version-history
 *   2026-07-19 — AppDev tab (KB UI): learned-pitfall + template management surface, start-prompt copy, model badge
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB Phase 5).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';
import { buildAppdevOverview } from '../services/appdev-overview.js';
import { logger } from '../utils/logger.js';
import {
  listTemplateProposals, getTemplateProposal, deleteTemplateProposal,
} from '../services/app-template-proposals.js';

export function appdevOverviewRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/appdev/overview', requireAuth(), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const model = typeof req.query.model === 'string' ? req.query.model : undefined;
    const sections = typeof req.query.sections === 'string'
      ? req.query.sections.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;
    const overview = await buildAppdevOverview(storage, config, identity, { model, sections });
    res.json(success(config.nodeId, overview, [
      { description: 'Curated pitfalls', method: 'GET', url: '/v1/appdev/pitfalls' },
      { description: 'Library pack detail', method: 'GET', url: '/v1/library-packs/{id}' },
      { description: 'App template detail', method: 'GET', url: '/v1/app-templates/{id}' },
      { description: 'The canonical build spec', method: 'GET', url: '/v1/prompts/build-app' },
    ]));
  });

  // ── Template proposals (the profile UI's management surface) ──

  // GET /v1/appdev/templates — the caller's owner-scope template proposals (full manifests).
  router.get('/v1/appdev/templates', requireAuth(), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const templates = await listTemplateProposals(storage, config, identity);
    res.json(success(config.nodeId, { templates, total: templates.length }));
  });

  // GET /v1/appdev/templates/:id — one proposal + the source app's live state.
  router.get('/v1/appdev/templates/:id', requireAuth(), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const found = await getTemplateProposal(storage, config, identity, req.params.id as string);
    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such template proposal'));
      return;
    }
    const m = found.manifest;
    const sourceOwnerGhii = `${m.derivedFrom.owner}@${config.nodeId}`;
    const app = await storage.getApp(sourceOwnerGhii, m.derivedFrom.filename).catch(err => { logger.warn('GET /v1/appdev/templates/:id: continuing after a suppressed failure', { error: String(err) }); return null; });
    res.json(success(config.nodeId, {
      template: m,
      source_app: app ? {
        exists: true,
        forkable: app.forkable ?? false,
        version: app.versionNumber,
        download_url: `/v1/apps/${encodeURIComponent(m.derivedFrom.owner)}/${encodeURIComponent(m.derivedFrom.filename)}`,
      } : { exists: false },
    }));
  });

  // DELETE /v1/appdev/templates/:id — remove a proposal.
  router.delete('/v1/appdev/templates/:id', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const ok = await deleteTemplateProposal(storage, config, identity, req.params.id as string);
    if (!ok) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such template proposal'));
      return;
    }
    res.json(success(config.nodeId, { deleted: true }));
  });

  return router;
}
