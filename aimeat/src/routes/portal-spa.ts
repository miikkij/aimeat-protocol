/**
 * @file portal-spa.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serving the SPA shell: the per-process build stamp that busts the browser's ES
 *   module cache, the public site-link block handed to the page, the shell server itself, and the
 *   public/ file locator every page route uses to find its HTML.
 *
 *   Extracted from portal.ts unchanged when that file passed the 800-line ceiling. A pure move:
 *   the functions, their comments and their behaviour are the same, and the tests that proved them
 *   still do. `resolvePublicFile` travels with them because it resolves paths RELATIVE TO THIS
 *   DIRECTORY — it works from here only because portal-spa.ts is portal.ts's sibling.
 *
 * @structure
 *   - BUILD_ID            — per-process cache-busting stamp
 *   - publicSiteLinks()   — the site-link block injected as window.__SITE
 *   - serveSpa()          — the shell, with head metadata, nonces and cache busting
 *   - resolvePublicFile() — locate a file under public/ from src/ or dist/
 * @usage
 *   const spaPath = resolvePublicFile('spa.html');
 *   if (spaPath) serveSpa(res, spaPath, config, '/v1/glossary');
 * @version-history
 *   v1.0.0 — 2026-08-25 — Extracted from portal.ts (line ceiling)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import { getSoftwareVersion } from '../utils/version.js';
import { findPublicPage, type PublicPage } from '../data/public-pages.js';
import { injectPageHead, injectSiteHead } from '../utils/page-head.js';

/**
 * The site-link block handed to the browser, with empty entries dropped so the injected
 * object only names what this node actually has. Consumers check for presence, so an
 * absent key and an empty string mean the same thing — dropping them keeps the payload
 * small and makes "not configured" unambiguous in devtools.
 *
 * Everything here is already public (they are links printed on public pages). No secret,
 * no internal id, and no operator field beyond the contact details the operator chose to
 * publish may be added to this object — it ships to every anonymous visitor.
 */
function publicSiteLinks(config: AimeatConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.siteLinks)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim();
  }
  // The contact list travels as-is when it has anyone in it. Every field of it is already
  // printed on the public pages, so nothing here is newly disclosed by the injection.
  if (config.siteLinks.contacts.length > 0) out.contacts = config.siteLinks.contacts;
  return out;
}

const __dirname_portal = dirname(fileURLToPath(import.meta.url));

/**
 * Unique token set once when the server process starts.
 * Used as a query-string version stamp on all first-party ES module URLs so
 * that every server restart busts the browser's ES-module cache automatically.
 * (HTTP ETag/no-cache alone is insufficient — browsers keep modules in the
 *  module registry for the entire session regardless of HTTP headers.)
 */
export const BUILD_ID = Date.now().toString(36);

/**
 * Serve spa.html with:
 *  - Cache-Control: no-cache so the browser always revalidates the shell
 *  - window.__B injected so dynamic import() calls can append ?v=BUILD_ID
 *  - importmap entries stamped with BUILD_ID so ALL first-party modules
 *    (static + dynamic imports from any view) get fresh URLs after restart
 *  - CSP nonce injected into all script and style tags
 */
export function serveSpa(
  res: import('express').Response,
  spaPath: string,
  config: AimeatConfig,
  /** The route being served, so the head can describe THIS page and not the shell. */
  routePath?: string,
  /**
   * A page BUILT for this request rather than looked up in the registry. One route can serve as
   * many pages as there are people — /v1/portfolio/:username is that case — and the registry
   * cannot hold those, so the caller composes the description and hands it over.
   */
  builtPage?: PublicPage,
): void {
  const appOriginEnabled = config.appOriginEnabled && !!config.appHost;
  const v = `?v=${BUILD_ID}`;
  let html = readFileSync(spaPath, 'utf-8');

  // A safety net for absolute https://aimeat.io URLs in the shell: unrewritten, every OTHER node
  // running this software would tell each crawler, unfurler and AI reader that it was aimeat.io.
  // The tags this was written for — og:url, og:image and the two site-level JSON-LD blocks — are
  // config-driven now and injected below, so today it matches nothing. It stays because the
  // failure it prevents is silent and the cost of keeping it is one string scan.
  const canonicalBase = config.baseUrl.replace(/\/$/, '');
  if (canonicalBase !== 'https://aimeat.io') {
    html = html.replaceAll('https://aimeat.io', canonicalBase);
  }

  // Inject CSP nonce into all script and style tags
  const nonce = res.locals.cspNonce as string || '';
  if (nonce) {
    html = html.replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
    html = html.replace(/<style(?=[ >])/g, `<style nonce="${nonce}"`);
  }

  // Inject window.__B for dynamic import() cache-busting in spa.html scripts, PLUS a tiny
  // auto-reload watchdog: it polls /v1/build (on tab-visible and every 60s) and, the
  // moment the server reports a different BUILD_ID (i.e. it restarted with new code), reloads the
  // page so fresh ES modules are fetched. This kills the recurring "restarted the server but the
  // open tab still runs old code until a manual hard refresh" problem — no F5 ever needed.
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  const bootScript =
    `window.__B="${v}";` +
    // H-2: when the app origin is provisioned, the frontend opens published apps TOP-LEVEL
    // (the apex inline URL 301s to apps.<domain>) — a clean full page on an isolated origin,
    // no opaque-sandbox overlay. Off → the Phase-0 sandboxed iframe is used instead.
    `window.__APP_ORIGIN_ENABLED=${appOriginEnabled ? 'true' : 'false'};` +
    // This node's own public-page links (its academy, marketplace, proof apps, contact).
    // Injected rather than fetched so the first paint already knows which nav items and
    // sections exist. Empty on a fresh clone, and every consumer treats empty as "absent".
    `window.__SITE=${JSON.stringify(publicSiteLinks(config))};` +
    `(function(){var c="${BUILD_ID}";` +
    `function chk(){fetch("/v1/build",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;})` +
    `.then(function(d){if(d&&d.build&&d.build!==c){location.reload();}}).catch(function(){});}` +
    `document.addEventListener("visibilitychange",function(){if(!document.hidden)chk();});` +
    `setInterval(chk,60000);})();`;
  html = html.replace('</head>', `<script${nonceAttr}>${bootScript}</script>\n</head>`);

  // The node's own identity — its name, description, social image, verification tags and the two
  // site-level JSON-LD blocks — unconditionally, because it is true of every route including the
  // ones with no registry entry. /v1/portfolio/:username is served through here without a
  // routePath and therefore had no head metadata whatsoever.
  html = injectSiteHead(html, config, nonceAttr);

  // Per-route head metadata: one spa.html shell answers ten routes, so the canonical link, the
  // title and the description are stamped per request. Runs second, so a page that describes
  // itself wins over the node-wide fallback just written. Shared with the static info pages.
  const page = builtPage ?? (routePath ? findPublicPage(routePath) : undefined);
  if (page) html = injectPageHead(html, page, config, nonceAttr);

  // Make the running AIMEAT version visible from the page itself — a view-source comment plus a
  // queryable meta tag. Lets anyone confirm which version a node runs (esp. across federation peers)
  // without an API call: View Source, or `document.querySelector('meta[name=aimeat-version]').content`.
  const version = getSoftwareVersion();
  html = html.replace(
    '</head>',
    `<meta name="aimeat-version" content="${version}">\n` +
    `<meta name="aimeat-build" content="${BUILD_ID}">\n` +
    `<!-- AIMEAT v${version} · build ${BUILD_ID} -->\n</head>`,
  );

  // Stamp ALL importmap values with the build version — generic regex replaces
  // any value starting with "/" (local path), so new importmap entries are
  // automatically cache-busted without touching this code.
  html = html.replace(
    /("imports"\s*:\s*\{)([\s\S]*?)(\})/,
    (_match, prefix, entries, suffix) => {
      const stamped = entries.replace(
        /:\s*"(\/[^"?]+\.(js|mjs))"/g,
        `: "$1${v}"`,
      );
      return prefix + stamped + suffix;
    },
  );

  // Stamp all view CSS hrefs (preloaded in spa.html head) with the build version
  html = html.replace(
    /(<link rel="stylesheet" href=")(\/css\/views\/[^"?]+\.css)(")/g,
    `$1$2${v}$3`
  );
  // Also stamp theme.css
  html = html.replace(
    /(<link rel="stylesheet" href=")(\/css\/theme\.css)(")/,
    `$1$2${v}$3`
  );

  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/html').send(html);
}

/** Resolve a file from public/ directory (works from both src/ and dist/). */
export function resolvePublicFile(filename: string): string | null {
  const candidates = [
    join(__dirname_portal, '..', '..', 'public', filename),      // dev: src/routes/../../public
    join(__dirname_portal, '..', '..', '..', 'public', filename), // dist: dist/src/routes/../../../public
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
