/**
 * @file page-head.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - injectSiteHead(html, config) — the NODE's identity: same on every page, from config
 *   - injectPageHead(html, page, config) — returns the transformed document
 * @usage
 *   html = injectSiteHead(html, config, nonceAttr);
 *   html = injectPageHead(html, findPublicPage('/v1/connect'), config, nonceAttr);
 * @version-history
 *   v1.2.0 — 2026-08-25 — injectSiteHead(): the node's own name, description, social image,
 *     search-engine verification tags and the two site-level JSON-LD blocks, read from config
 *     instead of being literals in spa.html. Three things were wrong with the literals. They named
 *     aimeat.io's operator, so a second node claimed in its structured data to BE that company.
 *     og:image and twitter:* sat in the shell where injectPageHead never reached them, so all ten
 *     registry pages shared one social card. And a verification token could not be added without
 *     editing source, which is the first thing an operator has to do and the one door that was
 *     shut. Runs unconditionally, including on the routes with no registry entry — that is where
 *     /v1/portfolio/:username lives, and it had no head metadata of any kind.
 *   v1.1.0 — 2026-08-16 — The per-page WebPage JSON-LD is emitted again. Its guard was "the
 *     document has no ld+json at all", and spa.html always ships SoftwareApplication +
 *     Organization, so on every SPA route — which is every page in the registry — the per-page
 *     block was silently skipped. Guard is now the WebPage marker itself. Adds the llmstxt.org
 *     v2 rel="describedby" link beside the markdown alternate.
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

/** Absolutise a configured URL that may be root-relative. A crawler needs og:image absolute. */
function abs(base: string, value: string): string {
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `${base}${value.startsWith('/') ? '' : '/'}${value}`;
}

/**
 * Stamp the NODE's identity: the parts that are the same on every page and come from config
 * rather than from the page registry.
 *
 * Call this before `injectPageHead` and call it on EVERY served document, including the ones with
 * no registry entry. The ordering matters: this writes the node-wide title and description, and
 * `injectPageHead` then overwrites both with the ones describing that particular page. A route
 * with no registry entry keeps what this wrote, which is how `/v1/portfolio/:username` stops
 * being a page with no metadata at all.
 */
export function injectSiteHead(html: string, config: AimeatConfig, nonceAttr = ''): string {
  if (!/<\/head\s*>/i.test(html)) return html;
  const b = config.baseUrl.replace(/\/$/, '');
  const name = esc(config.seoSiteName);
  const desc = esc(config.seoSiteDescription);
  const image = abs(b, config.seoOgImage);
  let out = html;

  // The master switch, in the document as well as in the X-Robots-Tag header the middleware sets.
  // Neither is redundant: the header reaches non-HTML responses, and this reaches a reader that
  // was handed the HTML by something other than a crawl.
  if (config.seoIndexing === 'off') {
    out = upsert(out, /<meta name="robots" content="[^"]*"\s*\/?>/i,
      `<meta name="robots" content="noindex, nofollow">`);
  }

  out = upsert(out, /<title>[\s\S]*?<\/title>/i, `<title>${name}</title>`);
  out = upsert(out, /<meta name="description" content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${desc}">`);
  out = upsert(out, /<meta property="og:site_name" content="[^"]*"\s*\/?>/i,
    `<meta property="og:site_name" content="${name}">`);
  out = upsert(out, /<meta property="og:title" content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${name}">`);
  out = upsert(out, /<meta property="og:description" content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${desc}">`);
  if (image) {
    out = upsert(out, /<meta property="og:image" content="[^"]*"\s*\/?>/i,
      `<meta property="og:image" content="${esc(image)}">`);
    out = upsert(out, /<meta name="twitter:image" content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image" content="${esc(image)}">`);
  }
  // twitter:title and twitter:description used to be their own hardcoded strings, saying something
  // different from og:* on the same page for no reason anyone recorded. One description per page.
  out = upsert(out, /<meta name="twitter:card" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`);
  out = upsert(out, /<meta name="twitter:title" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${name}">`);
  out = upsert(out, /<meta name="twitter:description" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${desc}">`);
  if (config.seoTwitterSite) {
    const handle = config.seoTwitterSite.startsWith('@')
      ? config.seoTwitterSite : `@${config.seoTwitterSite}`;
    out = upsert(out, /<meta name="twitter:site" content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:site" content="${esc(handle)}">`);
  }

  // Search-engine ownership verification. Both Google and Bing accept a meta tag as an
  // alternative to a DNS record, and the tag is the only one of the two an operator can set from
  // inside this application.
  const verifications: Array<[string, string]> = [
    ...(config.seoVerificationGoogle ? [['google-site-verification', config.seoVerificationGoogle] as [string, string]] : []),
    ...(config.seoVerificationBing ? [['msvalidate.01', config.seoVerificationBing] as [string, string]] : []),
    ...Object.entries(config.seoVerificationExtra ?? {}),
  ];
  for (const [metaName, content] of verifications) {
    const safeName = metaName.replace(/[^A-Za-z0-9._:-]/g, '');
    if (!safeName) continue;
    out = upsert(out, new RegExp(`<meta name="${safeName}" content="[^"]*"\\s*/?>`, 'i'),
      `<meta name="${safeName}" content="${esc(content)}">`);
  }

  // Two site-level blocks saying two different things: what the software is, and who runs this
  // copy of it. An agent resolving "who is this node" needs the second. Guarded by their own
  // markers so a second pass over an already-stamped document is a no-op.
  if (!/"@type"\s*:\s*"SoftwareApplication"/.test(out)) {
    const software = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: config.seoSiteName,
      alternateName: 'AI Memory Exchange and Action Transfer',
      url: b,
      description: config.seoSiteDescription,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      ...(config.seoSameAs.length ? { sameAs: config.seoSameAs } : {}),
    });
    out = out.replace('</head>', `<script type="application/ld+json"${nonceAttr}>${software}</script>\n</head>`);
  }
  if (!/"@type"\s*:\s*"Organization"/.test(out)) {
    const organization = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: config.seoOrganizationName,
      url: config.seoOrganizationUrl || b,
      ...(config.seoOrganizationLogo ? { logo: abs(b, config.seoOrganizationLogo) } : {}),
      description: config.seoSiteDescription,
      ...(config.seoSameAs.length ? { sameAs: config.seoSameAs } : {}),
    });
    out = out.replace('</head>', `<script type="application/ld+json"${nonceAttr}>${organization}</script>\n</head>`);
  }

  return out;
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
  // The twitter pair follows the page for the same reason og: does. Left out, a shared link to
  // /v1/business unfurled on X with the node's generic name and blurb while the same link on every
  // other platform showed the page's own — one link, two different claims about what it is.
  out = upsert(out, /<meta name="twitter:title" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${title}">`);
  out = upsert(out, /<meta name="twitter:description" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${desc}">`);
  out = upsert(out, /<link rel="canonical"[^>]*>/i, `<link rel="canonical" href="${url}">`);
  // A page with its own picture overrides the node-wide one injectSiteHead just stamped. Without
  // this, every page on the node shares one social card, which is what happened for a year.
  if (page.image) {
    const img = esc(abs(b, page.image));
    out = upsert(out, /<meta property="og:image" content="[^"]*"\s*\/?>/i,
      `<meta property="og:image" content="${img}">`);
    out = upsert(out, /<meta name="twitter:image" content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image" content="${img}">`);
  }
  if (page.markdown) {
    out = upsert(out, /<link rel="alternate" type="text\/markdown"[^>]*>/i,
      `<link rel="alternate" type="text/markdown" href="${mirror}">`);
  }
  // llmstxt.org v2 names rel="describedby" as the link from a page to the llms.txt that covers it,
  // beside the markdown alternate above. A reader that finds one convention and not the other has
  // to guess the path.
  out = upsert(out, /<link rel="describedby"[^>]*>/i,
    `<link rel="describedby" type="text/plain" href="${b}/llms.txt">`);

  // The WebPage block describes THIS page and is separate from the site-level SoftwareApplication
  // and Organization blocks that spa.html ships. This used to be guarded by "does the document
  // already contain any ld+json", which spa.html always does — so on every SPA route, which is
  // every page in the registry, the per-page structured data was never emitted. Multiple ld+json
  // blocks in one document are legal, and are how you say two different things.
  if (!/"@type"\s*:\s*"WebPage"/.test(out)) {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      headline: page.title,
      name: page.title,
      description: page.description,
      url,
      dateModified: new Date().toISOString().split('T')[0],
      isPartOf: { '@type': 'WebSite', name: config.seoSiteName, url: `${b}/` },
    });
    out = out.replace('</head>', `<script type="application/ld+json"${nonceAttr}>${jsonLd}</script>\n</head>`);
  }
  return out;
}
