/**
 * @file robots-header.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Decides the `X-Robots-Tag` header of every response the node sends.
 *
 *   Two rules, applied in this order:
 *
 *   1. While the node's discovery master switch (`seo.indexing`) is off, every response carries
 *      `noindex, nofollow`. This is the half of "turn discovery off" that robots.txt cannot do. A
 *      Disallow rule stops a crawler FETCHING the page; it does not stop the URL being listed. When
 *      somebody else links to it, the engine indexes the address from the link text alone, and it
 *      cannot see a noindex inside a page it was told not to fetch. The header travels with the
 *      response itself, so it applies to responses that have no HTML to put a meta tag in.
 *
 *   2. While discovery is on, a response that is not a content page carries `noindex`:
 *      - every response whose Content-Type is not text/html (llms.txt, AGENTS.md, the YAML spec,
 *        the JSON API, the bootstrap JSON, stylesheets, images), on every host;
 *      - an HTML page on the apex that the public-page registry (data/public-pages.ts) does not
 *        name: the signed-in views (/v1/admin, /v1/home, /v1/chat, ...), the consent and setup
 *        pages, the raw .html files, and /v1/portal?view=dev. These get `noindex, follow`, so a
 *        crawler still follows their links.
 *      Bing judged the whole domain by those addresses: the front page linked to them, they had no
 *      title beyond "AIMEAT" and no content, and the front page sat at "Discovered but not crawled"
 *      for five months (2026-09-30). noindex keeps them out of the index without refusing the
 *      fetch, so an AI agent still reads llms.txt and the spec.
 *
 *   Never stamped: robots.txt, the XML sitemaps and the IndexNow key file, which a search engine
 *   reads as instructions rather than as pages. A header a route already set wins (an app's own
 *   search switch, a portfolio, the Design Book), and so do HTML pages on an app or portfolio
 *   origin, whose owner decides.
 *
 *   The Content-Type is known only when the response is written, so the decision runs inside
 *   `res.writeHead`, which Node calls for every response including an implicit one.
 *
 *   Read per request rather than captured at mount time, because `seo.indexing` is admin-mutable
 *   and a switch that needs a restart is a switch an operator cannot trust.
 *
 * @structure
 *   - robotsTagFor(input) — the pure decision: the header value, or null for none
 *   - robotsHeader(config) — Express middleware that applies it
 * @usage
 *   app.use(robotsHeader(config));   // after subdomainMiddleware, before static files and routes
 * @version-history
 *   v2.0.0 — 2026-09-30 — noindex for every non-HTML response and for every apex HTML page the
 *     public-page registry does not name (wish-bing-noindex-kirjautumissivut-ja-konetiedostot).
 *     Mounted in server.ts ahead of the static files; from routes-loader it never reached them.
 *   v1.0.0 — 2026-08-25 — Initial. There was no X-Robots-Tag anywhere in this codebase and no way
 *     to make a node undiscoverable short of editing HTML.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../config.js';
import { findPublicPage } from '../data/public-pages.js';

/** What the decision needs to know about one response. */
export interface RobotsTagInput {
  path: string;
  /** The query string's `view` parameter, if any. */
  view?: string;
  /** True on an app or portfolio origin, false on the apex. */
  ownOrigin: boolean;
  contentType: string;
  indexNowKey?: string;
}

/** HTML families under /v1 whose route makes its own indexing decision. */
const OWN_DECISION_PREFIXES = ['/v1/apps/', '/v1/portfolio/', '/v1/designbook', '/v1/provenance'];

/** Addresses a search engine reads as instructions, never as pages. */
function isCrawlerInstruction(path: string, indexNowKey?: string): boolean {
  if (path === '/robots.txt') return true;
  if (/^\/sitemap(-[a-z0-9-]+)?\.xml$/.test(path)) return true;
  return !!indexNowKey && path === `/${indexNowKey}.txt`;
}

/** An apex HTML address the registry names: the page itself or one of its language versions. */
function isPublicPage(path: string, view?: string): boolean {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (findPublicPage(clean)) return view === undefined;
  const localized = clean.match(/^(\/v1\/[a-z-]+)\/[a-z]{2}$/);
  return !!localized && !!findPublicPage(localized[1]);
}

/** The X-Robots-Tag value for one response while discovery is on, or null for no header. */
export function robotsTagFor(input: RobotsTagInput): string | null {
  const { path, contentType } = input;
  if (!contentType) return null;
  if (isCrawlerInstruction(path, input.indexNowKey)) return null;
  if (!/^text\/html\b/i.test(contentType)) return 'noindex';
  if (input.ownOrigin) return null;
  if (OWN_DECISION_PREFIXES.some((p) => path.startsWith(p))) return null;
  return isPublicPage(path, input.view) ? null : 'noindex, follow';
}

/** The Content-Type a writeHead call will send: the one set on the response, or in its headers argument. */
function contentTypeOf(res: Response, args: unknown[]): string {
  const set = res.getHeader('Content-Type');
  if (set) return String(set);
  const headers = args.find((a) => a && typeof a === 'object' && !Array.isArray(a)) as Record<string, unknown> | undefined;
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  return key ? String(headers[key]) : '';
}

/** Stamp X-Robots-Tag on every response, per the rules in this file's header. */
export function robotsHeader(config: AimeatConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.seoIndexing === 'off') {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      next();
      return;
    }
    const writeHead = res.writeHead;
    res.writeHead = function (this: Response, ...args: unknown[]) {
      if (!res.headersSent && !res.getHeader('X-Robots-Tag')) {
        const view = typeof req.query?.view === 'string' ? req.query.view : undefined;
        const tag = robotsTagFor({
          path: req.path,
          view,
          ownOrigin: !!(req.appOrigin || req.portfolioOrigin),
          contentType: contentTypeOf(res, args),
          indexNowKey: config.indexNowKey || undefined,
        });
        if (tag) res.setHeader('X-Robots-Tag', tag);
      }
      return (writeHead as (...a: unknown[]) => Response).apply(this, args);
    } as Response['writeHead'];
    next();
  };
}
