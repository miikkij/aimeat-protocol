/**
 * @file src/middleware/file-open-redirect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a browser's new tab on a file address goes when the tab cannot read the file:
 *   GET /v1/pub/:owner/{*key} becomes /v1/file-open?path=<the address>, the SPA page that reads the
 *   same route with the session (public/views/file-open.js).
 *
 *   WHY. The SPA keeps the session in localStorage, so a link to a file (an AI's answer, a message, a
 *   document) opened in a new tab carries no credential even for a signed-in person. On a node set to
 *   signed-in content access the content access gate answered such a tab 401 SIGN_IN_REQUIRED, and on
 *   an open node the route answered a file that is not public 404 (seen on an organisation node,
 *   2026-11-23). The same was fixed for an app's Open (/v1/app-open) and an AI label's record link
 *   (/v1/provenance-open).
 *
 *   WHO IS SENT. Only a page navigation (prefersHtmlPage: the browser's Accept puts text/html before
 *   JSON), never an <img>, a <video>, a script's fetch or an API caller, whose Accept does not, and
 *   never `?mode=handle`, which is an API call by definition. Only on the node's own pages: an app,
 *   welcome page, company or page-host origin does not serve the SPA. The redirect names only the
 *   address the browser asked for; the page's read with the session decides what it gets.
 * @structure PUB_FILE_READ · fileOpenRedirect(req)
 * @usage const to = fileOpenRedirect(req); if (to) { res.setHeader('Cache-Control', 'no-store'); res.redirect(302, to); }
 * @version-history
 *   v1.0.0 — 2026-11-23 — Initial: a file link answered a signed-in person 401 on a signed-in-only node
 *     and 404 for a file that is not public on an open node.
 */
import type { Request } from 'express';
import { prefersHtmlPage } from '../services/markdown-negotiation.js';

/** GET /v1/pub/:owner/{*key}: an owner segment and a key of at least one character. */
export const PUB_FILE_READ = /^\/v1\/pub\/[^/]+\/.+$/;

/** The open page for a browser navigation to a file address, or null for every other request. */
export function fileOpenRedirect(req: Request): string | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (req.appOrigin || req.portfolioOrigin || req.coOrigin || req.pageOrigin) return null;
  if (!PUB_FILE_READ.test(req.path) || req.query.mode !== undefined) return null;
  if (!prefersHtmlPage(req)) return null;
  return `/v1/file-open?path=${encodeURIComponent(req.originalUrl)}`;
}
