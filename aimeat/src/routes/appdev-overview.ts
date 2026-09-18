/**
 * @file appdev-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/appdev/overview — the authenticated "big picture" research surface for
 *   building apps ON AIMEAT (services/appdev-overview.ts). Query params: ?model= (indicative
 *   model filter for proofs + learned pitfalls), ?sections=apps,library_packs,... (partial
 *   fetch for token economy). Read-only; identity via resolveIdentity (owner or agent session).
 * @structure appdevOverviewRouter(config, storage) → Router
 * @usage app.use(appdevOverviewRouter(config, storage)) from the routes loader.
 * @version-history
 *   v1.2.0 — 2026-09-19 — GET /v1/appdev/templates/:id takes ?part=N for a large shipped template.
 *   v1.1.0 — 2026-09-18 — GET /v1/appdev/templates/:id answers for a template the node ships when
 *     no proposal carries the id, and the list names them (`node_templates`).
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
import { nodeTemplateAnswer, nodeTemplateIndex, unknownTemplateMessage } from '../services/node-templates.js';

export function appdevOverviewRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  router.get('/v1/appdev/overview', requireAuth(), requireScope('memory:read'), async (req, res) => {
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
  router.get('/v1/appdev/templates', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const templates = await listTemplateProposals(storage, config, identity);
    // `node_templates`: what the node ships, without content, beside the owner's proposals, so
    // the tool that lists templates can name the shell a build starts from.
    res.json(success(config.nodeId, { templates, total: templates.length, node_templates: nodeTemplateIndex() }));
  });

  // GET /v1/appdev/templates/:id — one proposal + the source app's live state.
  router.get('/v1/appdev/templates/:id', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const identity = resolveIdentity(req.auth!, config.nodeId);
    const found = await getTemplateProposal(storage, config, identity, req.params.id as string);
    if (!found) {
      // A template the node ships answers here too, as it does on the MCP tool: this route is
      // what the connector's aimeat_app_template_get calls (services/node-templates.ts).
      // ?part=N: a shipped file too large for one tool result comes one part at a time.
      const rawPart = typeof req.query.part === 'string' ? Number(req.query.part) : undefined;
      const shipped = nodeTemplateAnswer(req.params.id as string, rawPart);
      if (shipped && typeof shipped.part_error === 'string') {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', shipped.part_error));
        return;
      }
      if (shipped) {
        res.json(success(config.nodeId, { template: shipped }));
        return;
      }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', unknownTemplateMessage(req.params.id as string)));
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
