/**
 * @file src/server-bootstrap/robots-mount.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the node's own /robots.txt. Extracted from routes-loader.ts, which sits at
 *   the 800-line ceiling, when the next router could not be added at all.
 *
 *   A pure extraction: the handler below is the one that was inline, unchanged, and it is still
 *   called from the same place in the same order — AFTER the subdomain router, which is the whole
 *   reason it is where it is.
 *
 * @structure mountNodeRobots(app, config, robots) — no-op when the node has no robots.txt
 * @usage called by mountRoutes() in routes-loader.ts, after subdomainServeRouter
 * @version-history
 *   v1.0.0 — 2026-09-16 — Initial (pure extraction from routes-loader.ts v1.16.0).
 */
import type { Express } from 'express';
import type { AimeatConfig } from '../config.js';

/**
 * The node's robots.txt, registered AFTER the subdomain router so an app origin has already
 * answered with its own. Registered inside setupStaticFiles it ran before the subdomain
 * middleware, could not tell which host it was on, and served the node's file everywhere.
 */
export function mountNodeRobots(app: Express, config: AimeatConfig, robots: string | null): void {
  if (robots === null) return;
  app.get('/robots.txt', (req, res, next) => {
    // Apex only, and this is the point where that can be decided: subdomainMiddleware has run.
    // A mapped app origin answered above with its own; an UNMAPPED one gets a 404 rather than
    // the node's file, because a robots.txt whose Sitemap: line names another host is a document
    // about somebody else no matter which subdomain asked for it.
    if (req.appOrigin || req.portfolioOrigin) { next(); return; }
    res.set('Cache-Control', 'no-cache');
    // The master switch is read HERE rather than baked into `robots` at boot, because an
    // operator can flip seo.indexing from the admin config without a restart, and a robots.txt
    // still inviting crawlers an hour after they turned discovery off is the wrong answer.
    // No Sitemap line either: pointing a crawler at a sitemap it may not read is a contradiction.
    if (config.seoIndexing === 'off') {
      res.type('text/plain; charset=utf-8').send(
        '# Search-engine discovery is turned off for this node.\nUser-agent: *\nDisallow: /\n',
      );
      return;
    }
    res.type('text/plain; charset=utf-8').send(robots);
  });
}
