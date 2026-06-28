/**
 * @file app-templates.ts
 * @description Serves the authoring-template registry (the "booster kit") so the app-prompt
 *   builders (app-catalog + landing) can inject a curated starting scaffold instead of having
 *   the AI build from scratch. GET /v1/app-templates returns the index (no content);
 *   GET /v1/app-templates/:id returns one template WITH its content. Public data (CORS *).
 * @structure appTemplatesRouter(config, storage) → Router
 * @usage app.use(appTemplatesRouter(config, storage)) from the server setup.
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial: index + by-id endpoints over the app-templates registry.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { getAppTemplates, getAppTemplateIndex } from '../data/app-templates.js';

export function appTemplatesRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  // GET /v1/app-templates[?kind=app-shell] — index (no content) for a picker / prompt menu.
  router.get('/v1/app-templates', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
    let index = getAppTemplateIndex(lang);
    if (kind) index = index.filter(t => t.kind === kind);
    res.json(success(config.nodeId, { templates: index }));
  });

  // GET /v1/app-templates/:id — one template WITH its content (the scaffold to inject).
  router.get('/v1/app-templates/:id', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const id = req.params.id as string;
    const tpl = getAppTemplates().find(t => t.id === id);
    if (!tpl) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No app template "${id}"`));
      return;
    }
    res.json(success(config.nodeId, { template: tpl }));
  });

  return router;
}
