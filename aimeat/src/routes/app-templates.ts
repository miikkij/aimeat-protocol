/**
 * @file app-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the authoring-template registry (the "booster kit") so the app-prompt
 *   builders (app-catalog + landing) can inject a curated starting scaffold instead of having
 *   the AI build from scratch. GET /v1/app-templates returns the index (no content);
 *   GET /v1/app-templates/:id returns one template WITH its content. Public data (CORS *).
 * @structure appTemplatesRouter(config, storage) → Router
 * @usage app.use(appTemplatesRouter(config, storage)) from the server setup.
 * @version-history
 *   v1.1.0 — 2026-09-20 — Both routes also answer for a genre that grew out of an app, while that
 *     app stands (services/design-book/grown-genre.ts).
 *   v1.0.0 — 2026-06-26 — initial: index + by-id endpoints over the app-templates registry.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { getAppTemplates, getAppTemplateIndex } from '../data/app-templates.js';
import { DesignBookService } from '../services/design-book/service.js';

export function appTemplatesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/app-templates[?kind=app-shell] — index (no content) for a picker / prompt menu.
  router.get('/v1/app-templates', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;
    let index: Array<Record<string, unknown> & { kind: string }> = getAppTemplateIndex(lang);
    // The genres that grew out of an app and still stand (services/design-book/grown-genre.ts).
    if (!kind || kind === 'genre') {
      const grown = await new DesignBookService(storage, config).grownGenres();
      index = [...index, ...grown.map(g => ({ id: g.id, kind: 'genre', title: g.title, description: g.summary, libs: [], light: g.page.light, source: 'design-book' }))];
    }
    if (kind) index = index.filter(t => t.kind === kind);
    res.json(success(config.nodeId, { templates: index }));
  });

  // GET /v1/app-templates/:id — one template WITH its content (the scaffold to inject).
  router.get('/v1/app-templates/:id', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const id = req.params.id as string;
    const tpl = getAppTemplates().find(t => t.id === id);
    if (tpl) {
      res.json(success(config.nodeId, { template: tpl }));
      return;
    }
    // A genre that grew out of an app: a public page its owner opened for forking, whole, as a
    // shipped template is here. The tool doors cut it into parts (services/node-templates.ts).
    const grown = await new DesignBookService(storage, config).grownGenre(id);
    if (!grown) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No app template "${id}"`));
      return;
    }
    res.json(success(config.nodeId, { template: {
      id: grown.id, kind: 'genre', title: grown.title, description: grown.summary, libs: [], light: grown.page.light,
      source: 'design-book', grew_from: { owner: grown.page.owner, filename: grown.page.filename, version: grown.page.version },
      content: grown.page.html,
    } }));
  });

  return router;
}
