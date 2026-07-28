/**
 * @file page-head.ts
 * @description Stamps a served HTML page's `<head>` with the metadata that describes THAT page:
 *   title, meta description, og:*, canonical, the markdown alternate link and JSON-LD, all from
 *   the shared public-page registry.
 *
 *   It has to happen server-side. The reader this metadata exists for — a crawler, an unfurler, an
 *   agent-readability scanner, a web_fetch tool — is precisely the one that does not run the
 *   JavaScript that could set it. And it has to be per route: one spa.html shell answers ten
 *   routes, so a canonical baked into the shell would tell an index that all ten are the same
 *   page, which is worse than having none at all.
 *
 *   Existing tags are REPLACED, never duplicated, and a tag the page already carries with a
 *   different value is overwritten by the registry — the registry is the single description of
 *   what each page is.
 *
 * @structure
 *   - injectPageHead(html, page, config) — returns the transformed document
 * @usage
 *   html = injectPageHead(html, findPublicPage('/v1/connect'), config, nonceAttr);
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phases 07 + 08)
 */
import type { AimeatConfig } from '../config.js';
import type { PublicPage } from '../data/public-pages.js';

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Replace `tag` if the document has one matching `find`, otherwise queue it for insertion before
 * `</head>`. Returns the new document and whether it still needs inserting.
 */
function upsert(html: string, find: RegExp, tag: string): string {
  return find.test(html) ? html.replace(find, tag) : html.replace('</head>', `${tag}\n</head>`);
}

/**
 * Stamp the page's head. `nonceAttr` is the CSP nonce attribute (or an empty string) for the
 * JSON-LD script tag — a page with a strict script-src drops an unnonced one.
 */
export function injectPageHead(
  html: string,
  page: PublicPage,
  config: AimeatConfig,
  nonceAttr = '',
): string {
  if (!/<\/head\s*>/i.test(html)) return html;
  const b = config.baseUrl.replace(/\/$/, '');
  const url = `${b}${page.path}`;
  const mirror = page.path === '/' ? `${b}/index.md` : `${b}${page.path}.md`;
  const title = esc(page.title);
  const desc = esc(page.description);

  let out = html;
  out = upsert(out, /<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);
  out = upsert(out, /<meta name="description" content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${desc}">`);
  out = upsert(out, /<meta property="og:title" content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${title}">`);
  out = upsert(out, /<meta property="og:description" content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${desc}">`);
  out = upsert(out, /<meta property="og:url" content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${url}">`);
  out = upsert(out, /<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${url}">`);
  if (page.markdown) {
    out = upsert(out, /<link rel="alternate" type="text\/markdown"[^>]*>/i,
      `<link rel="alternate" type="text/markdown" href="${mirror}">`);
  }
  if (!/application\/ld\+json/i.test(out)) {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      headline: page.title,
      name: page.title,
      description: page.description,
      url,
      dateModified: new Date().toISOString().split('T')[0],
      isPartOf: { '@type': 'WebSite', name: 'AIMEAT', url: `${b}/` },
    });
    out = out.replace('</head>', `<script type="application/ld+json"${nonceAttr}>${jsonLd}</script>\n</head>`);
  }
  return out;
}
