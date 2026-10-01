/**
 * @file apex-page-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sends a request for one of the node's own content pages, made on an app or
 *   portfolio host, to the same address on the apex with a 301.
 *
 *   The node's pages are routes on the one Express app, so every host it answers for served them:
 *   `turbo.apps.aimeat.io/v1/glossary`, `apps.aimeat.io/v1/how-it-works` and
 *   `happydude500001.portfolio.aimeat.io/v1/glossary` each answered 200 with the whole page, and
 *   the bare `apps.aimeat.io/` answered with the whole front page. Each copy carried a canonical
 *   link to the apex, and the app hosts' robots.txt allowed crawling, so a search engine saw every
 *   content page once per app host. Bing's guidelines ask for one URL per piece of content and for
 *   a redirect rather than a canonical tag; found on 2026-10-01 while Bing held aimeat.io at
 *   "Discovered but not crawled". The company host family already redirected this way.
 *
 *   Which requests move:
 *     - a path the public-page registry names (data/public-pages.ts), other than `/`, on any app
 *       or portfolio host;
 *     - `/` on the bare app host, which has no page of its own.
 *   `/` on a per-app or per-person host is that app or that portfolio, and stays. The bare
 *   portfolio host's `/` keeps its own redirect to the member showcase (routes/subdomains.ts).
 *   Nothing else is touched: the API, the app documents (llms.txt, robots.txt, sitemap.xml), the
 *   markdown mirrors and the static files answer on every host as before.
 *
 *   GET and HEAD only. The served SDK already links from an app host to the apex pages
 *   (sdk-libs/header nodeHref), so no app opens one of these pages on its own host.
 *
 * @structure
 *   - apexPageRedirectTarget(input) — the pure decision: the apex URL, or null to leave the request
 *   - apexPageRedirect(config)      — Express middleware that applies it
 * @usage
 *   app.use(apexPageRedirect(config));   // after subdomainMiddleware, before static files and routes
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import { findPublicPage } from '../data/public-pages.js';

export interface ApexPageRedirectInput {
  method: string;
  /** The path without the query string. */
  path: string;
  /** The path with the query string, as received. */
  originalUrl: string;
  appOrigin: boolean;
  portfolioOrigin: boolean;
  /** The host's leftmost label inside its family, or null on the bare family host. */
  subdomain: string | null;
  baseUrl: string;
}

/** The apex URL this request belongs on, or null when the request stays where it is. */
export function apexPageRedirectTarget(input: ApexPageRedirectInput): string | null {
  if (input.method !== 'GET' && input.method !== 'HEAD') return null;
  if (!input.appOrigin && !input.portfolioOrigin) return null;
  const base = input.baseUrl.replace(/\/$/, '');
  if (input.path === '/') {
    return input.appOrigin && !input.subdomain ? `${base}${input.originalUrl}` : null;
  }
  return findPublicPage(input.path) ? `${base}${input.originalUrl}` : null;
}

export function apexPageRedirect(config: AimeatConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const target = apexPageRedirectTarget({
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      appOrigin: !!req.appOrigin,
      portfolioOrigin: !!req.portfolioOrigin,
      subdomain: req.subdomain ?? null,
      baseUrl: config.baseUrl,
    });
    if (!target) { next(); return; }
    res.redirect(301, target);
  };
}
