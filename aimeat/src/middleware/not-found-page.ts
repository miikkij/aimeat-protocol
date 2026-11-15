/**
 * @file src/middleware/not-found-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One 404 answer for two kinds of caller. A browser that navigates to an address no app
 *   or page answers (a mistyped app address, a removed app, an unknown path) gets the page
 *   public/not-found.html in its language, with a link to the node's front page. Every other caller
 *   gets the JSON envelope it got before, byte for byte the same body.
 *
 *   Before 2026-11-09 the browser got the JSON too: a person who mistyped an app address on a phone
 *   saw a screen of escaped JSON with `next_actions` and `example_body` in it.
 *
 *   The test is prefersHtmlPage() (services/markdown-negotiation.ts), the one browser-or-machine
 *   question the node asks everywhere: JSON stays the default, and only a client that ranks
 *   text/html above application/json gets the page. curl, fetch() and agents send `* / *` and keep
 *   the JSON; an image or script request sends `* / *` too, so only a navigation gets the page.
 *   Only GET and HEAD: no browser navigates with any other method.
 *
 *   The page is the same for every failure it stands for, so it tells a stranger no more than the
 *   uniform JSON 404 does about which apps, portfolios or companies exist. It names nothing from the
 *   request.
 *
 *   A static file with tokens, filled here and escaped, as the privacy and connect pages are
 *   (routes/portal.ts serveStaticPage): no HTML is built in a handler (.claude/rules/backend.md).
 * @structure sendNotFound(req, res, config, body) · notFoundPageHtml(locale, baseUrl) (exported for the test)
 * @usage sendNotFound(req, res, config, error(config.nodeId, 'NOT_FOUND', 'Unknown subdomain'));
 * @version-history
 *   v1.0.1 — 2026-11-15 — A path ending in a static asset's extension (.js, .css, .map, an image, a
 *     font) gets the JSON 404 even when the caller ranks text/html first: a missing script or source
 *     map is not a page (e2e-search-visibility, nightly 43705345234). An app's .html address still
 *     gets the page.
 *   v1.0.0 — 2026-11-09 — Initial: the subdomain, portfolio, company and app-path 404s and the
 *     fallback 404 answer a browser with the page.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { AimeatResponse } from './envelope.js';
import { prefersHtmlPage } from '../services/markdown-negotiation.js';
import { createT, servedPageLocale, type Locale } from '../i18n.js';
import { escapeHtml } from '../utils/html-escape.js';
import { resolveAssetDir } from '../server-bootstrap/asset-dirs.js';
import { logger } from '../utils/logger.js';

const PAGE_FILE = 'not-found.html';

/** A path that names a static asset rather than a page. A crawler asks for these with `Accept: text/html,*\/*` too. */
const STATIC_ASSET = /\.(?:m?js|map|css|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|wasm|txt|xml)$/i;

/** The template, read once. Null when the package shipped without public/, and then JSON is sent. */
// process-local: nothing breaks; it is a copy of a file shipped with the code, read once per process.
let template: string | null | undefined;
function pageTemplate(): string | null {
  if (template !== undefined) return template;
  const dir = resolveAssetDir('public', dirname(fileURLToPath(import.meta.url)), process.cwd());
  try {
    template = dir ? readFileSync(join(dir, PAGE_FILE), 'utf-8') : null;
  } catch (err) {
    logger.warn('not-found page: template not readable, browsers get the JSON 404', { error: String(err) });
    template = null;
  }
  return template;
}

/** The filled page in one language. Every token is escaped; a token the template names and this does not fill stays visible, which a test reads. */
export function notFoundPageHtml(locale: Locale, baseUrl: string): string | null {
  const tpl = pageTemplate();
  if (tpl === null) return null;
  const t = createT(locale);
  const vars: Record<string, string> = {
    LANG: locale,
    BASE_URL: baseUrl.replace(/\/+$/, ''),
    TITLE: t('notFoundPage.title'),
    HEADLINE: t('notFoundPage.headline'),
    LEAD: t('notFoundPage.lead'),
    HINT: t('notFoundPage.hint'),
    HOME: t('notFoundPage.home'),
  };
  // The header comment carries the token syntax in its prose; only the document after it is filled.
  const body = tpl.replace(/^[\s\S]*?(?=<html)/, '<!DOCTYPE html>\n');
  return body.replace(/\{\{(\w+)\}\}/g, (m, key: string) => (key in vars ? escapeHtml(vars[key]) : m));
}

/**
 * Answer 404: the page for a browser's navigation, the JSON `body` for everyone else. `Vary: Accept`
 * on both, so a cache between the node and the caller never hands one caller the other's answer.
 */
export function sendNotFound(req: Request, res: Response, config: AimeatConfig, body: AimeatResponse): void {
  res.vary('Accept');
  if ((req.method === 'GET' || req.method === 'HEAD') && !STATIC_ASSET.test(req.path) && prefersHtmlPage(req)) {
    const html = notFoundPageHtml(servedPageLocale(req, config.siteLinks?.defaultLocale), config.baseUrl);
    if (html !== null) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.status(404).type('text/html; charset=utf-8').send(html);
      return;
    }
  }
  res.status(404).json(body);
}
