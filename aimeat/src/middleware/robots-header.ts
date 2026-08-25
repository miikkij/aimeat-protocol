/**
 * @file robots-header.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stamps `X-Robots-Tag: noindex, nofollow` on every response while the node's
 *   discovery master switch (`seo.indexing`) is off.
 *
 *   This is the half of "turn discovery off" that robots.txt cannot do. A Disallow rule stops a
 *   crawler FETCHING the page; it does not stop the URL being listed. When somebody else links to
 *   it, the engine indexes the address from the link text alone — and it cannot see a noindex
 *   inside a page it was told not to fetch. The header travels with the response itself, so it is
 *   read whenever the page IS fetched, and it applies to responses that have no HTML to put a
 *   meta tag in: the JSON API, the PDF, the sitemap.
 *
 *   Read per request rather than captured at mount time, because `seo.indexing` is admin-mutable
 *   and a switch that needs a restart is a switch an operator cannot trust.
 *
 *   Never sets the header when discovery is ON. An `X-Robots-Tag: all` would say nothing a crawler
 *   does not already assume, and a header present in both states invites the reader to decide
 *   which value means which.
 *
 * @structure
 *   - robotsHeader(config) — Express middleware
 * @usage
 *   app.use(robotsHeader(config));   // before the routes
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial. There was no X-Robots-Tag anywhere in this codebase and no way
 *     to make a node undiscoverable short of editing HTML.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';

/** Refuse indexing node-wide while the operator has discovery switched off. */
export function robotsHeader(config: AimeatConfig) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (config.seoIndexing === 'off') res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  };
}
