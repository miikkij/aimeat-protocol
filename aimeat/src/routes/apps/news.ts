/**
 * @file src/routes/apps/news.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/apps/:owner/:filename/news: which version of an app runs, when it was last
 *   updated, what the latest versions changed, and, for the people who build it, the draft under way
 *   and what it is changing (services/app-news.ts). The app-info mark on a served app reads it for a
 *   builder's draft line, and an AI asked "what is new in this app" reads the same answer.
 * @structure registerAppNewsRoutes(router, config, storage)
 * @usage registerAppNewsRoutes(router, config, storage);   // from routes/apps.ts
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (wish-p-ivitysmerkki-ja-tietomerkki-sovelluksen-p-lle-merkkien-pii).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { optionalAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { appViewerStanding, readAppNews } from '../../services/app-news.js';

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export function registerAppNewsRoutes(router: Router, config: AimeatConfig, storage: Storage): void {
  router.get('/v1/apps/:owner/:filename/news', optionalAuth(), async (req, res) => {
    const owner = String(req.params.owner ?? '');
    const filename = String(req.params.filename ?? '');
    const notFound = (): void => {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No app "${filename}" of "${owner}" to read the news of.`));
    };
    if (!owner || !FILENAME_RE.test(filename)) { notFound(); return; }
    const app = await storage.getAppByOwnerName(owner, filename);
    if (!app) { notFound(); return; }
    // One answer for "no such app" and "not yours to follow": the news must not tell a stranger
    // that a hidden or gated app exists.
    const standing = await appViewerStanding(storage, config, req.auth, app);
    if (!standing.follow) { notFound(); return; }
    const news = await readAppNews(storage, app, standing.builder);
    res.set('Cache-Control', 'no-store');
    res.json(success(config.nodeId, { ...news, builder: standing.builder }));
  });
}
