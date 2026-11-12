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
 *   - injectStaticPageHead(html, path, registryPage, config) — both, for a static file that keeps
 *     its own title and description
 *   - injectTemplatePageHead(html, path, registryPage, config) — both, for the operator's portal
 *     template: a tag the template states stays, the node writes the ones it lacks
 * @usage
 *   html = injectSiteHead(html, config, nonceAttr);
 *   html = injectPageHead(html, findPublicPage('/v1/connect'), config, nonceAttr);
 *   html = injectStaticPageHead(html, '/', findPublicPage('/'), config, nonceAttr);
 *   html = injectTemplatePageHead(templateHtml, '/', findPublicPage('/'), config);
 * @version-history
 *   2026-11-12 - injectTemplatePageHead takes the template's languages: a language version's own
 *     address is its canonical link, every page carries the hreflang set, and the WebPage block
 *     states `inLanguage`.
 *   2026-11-12 - injectTemplatePageHead: the operator's portal template at `/` is stamped too. It was
 *     sent as stored, so a node whose front page is a template had no canonical link, no og:* and
 *     no JSON-LD (AGENTSCAN S10, S12, S13), the defect the static front pages had until 2026-10-27.
 *     A tag is inserted before the head's end tag however that tag is cased, a `$` sequence in a
 *     value is written as it stands, and the canonical address is HTML-escaped in its attributes.
 *   2026-11-09 - The canonical link, og:url and the WebPage url come from canonicalPageUrl: the main
 *     node's address for a page this node repeats, the original's for a copied data package (TARGET-094).
 *   2026-11-01 - A page's own `jsonLd` (the public dataset page's schema.org Dataset) is written beside
 *     the WebPage block (WP9b).
 *   2026-10-27 - injectStaticPageHead: the static front pages (AIMEAT_FRONT_PAGE) are stamped like
 *     the shell. They were sent as read from disk, so from 2026-10-21 the page aimeat.io serves at
 *     `/` had no canonical link, no og:* and no JSON-LD, and AGENTSCAN 1.1.0 scored it 82 (S10, S12,
 *     S13), down from 100 with the SPA shell.
 *   2026-10-05 - HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (secaudit 2026-10, C8).
 *   2026-09-17 - TARGET-078: productivity category; omit a price that depends on deployment.
 *   v1.2.1 — 2026-08-26 — SECURITY (CodeQL js/reflected-xss): the per-page WebPage JSON-LD embedded
 *     page.title/description via JSON.stringify, which does not escape `<`, so a `</script>` in a
 *     title taken from a URL path (/v1/portfolio/:username with no portfolio) broke out of the
 *     ld+json block. jsonLdSafe() now \u-escapes `<`,`>`,`&` on every ld+json embed. Also (CodeQL
 *     js/polynomial-redos, FP-on-the-static-shell but cheap to make linear): the `<link …[^>]*>`
 *     upsert regexes — whose `>`-free prefix let `[^>]*` span many `<link>` starts, the O(n²) shape —
 *     and the `<title>` scan are bounded (`[^>]{0,512}` / `[^<]{0,2048}`).
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
import { canonicalPageUrl, type PublicPage } from '../data/public-pages.js';
import { escapeHtml as esc } from './html-escape.js';
import { tagSpans } from './html-tag-scan.js';

/**
 * Escape a serialized-JSON string for embedding inside a `<script type="application/ld+json">`.
 * JSON.stringify does NOT escape `<`, so a value carrying `</script>` — a page title taken from a
 * URL path, for instance — would close the script element and inject markup (a reflected-XSS class
 * hole). Rewriting `<`, `>` and `&` to their `\uXXXX` forms keeps the JSON valid and inert.
 */
function jsonLdSafe(json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * Replace `tag` if the document has one matching `find`, otherwise queue it for insertion before
 * `</head>`. Returns the new document and whether it still needs inserting.
 */
function upsert(html: string, find: RegExp, tag: string): string {
  return find.test(html) ? html.replace(find, () => tag) : beforeHeadEnd(html, tag);
}

/**
 * Insert `tag` before the head's end tag, however that tag is written (`</head>`, `</HEAD>`). The
 * replacement is a function, so a `$` sequence in a value (`$$`, `$&`) is written as it stands
 * and is not read as a replacement pattern.
 */
function beforeHeadEnd(html: string, tag: string): string {
  return html.replace(/<\/head\s*>/i, (end) => `${tag}\n${end}`);
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

  out = upsert(out, /<title>[^<]{0,2048}<\/title>/i, `<title>${name}</title>`);
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
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Any',
      ...(config.seoSameAs.length ? { sameAs: config.seoSameAs } : {}),
    });
    out = beforeHeadEnd(out, `<script type="application/ld+json"${nonceAttr}>${jsonLdSafe(software)}</script>`);
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
    out = beforeHeadEnd(out, `<script type="application/ld+json"${nonceAttr}>${jsonLdSafe(organization)}</script>`);
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
  // The canonical address, which og:url and the WebPage block repeat: the main node's for a page this
  // node repeats (seo.primary_node_url), the original's for a copy, this node's own otherwise.
  const url = canonicalPageUrl(page, config);
  const mirror = page.path === '/' ? `${b}/index.md` : `${b}${page.path}.md`;
  const title = esc(page.title);
  const desc = esc(page.description);

  let out = html;
  out = upsert(out, /<title>[^<]{0,2048}<\/title>/i, `<title>${title}</title>`);
  out = upsert(out, /<meta name="description" content="[^"]*"\s*\/?>/i,
    `<meta name="description" content="${desc}">`);
  out = upsert(out, /<meta property="og:title" content="[^"]*"\s*\/?>/i,
    `<meta property="og:title" content="${title}">`);
  out = upsert(out, /<meta property="og:description" content="[^"]*"\s*\/?>/i,
    `<meta property="og:description" content="${desc}">`);
  out = upsert(out, /<meta property="og:url" content="[^"]*"\s*\/?>/i,
    `<meta property="og:url" content="${esc(url)}">`);
  // The twitter pair follows the page for the same reason og: does. Left out, a shared link to
  // /v1/business unfurled on X with the node's generic name and blurb while the same link on every
  // other platform showed the page's own — one link, two different claims about what it is.
  out = upsert(out, /<meta name="twitter:title" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:title" content="${title}">`);
  out = upsert(out, /<meta name="twitter:description" content="[^"]*"\s*\/?>/i,
    `<meta name="twitter:description" content="${desc}">`);
  out = upsert(out, /<link rel="canonical"[^>]{0,512}>/i, `<link rel="canonical" href="${esc(url)}">`);
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
    out = upsert(out, /<link rel="alternate" type="text\/markdown"[^>]{0,512}>/i,
      `<link rel="alternate" type="text/markdown" href="${mirror}">`);
  }
  // llmstxt.org v2 names rel="describedby" as the link from a page to the llms.txt that covers it,
  // beside the markdown alternate above. A reader that finds one convention and not the other has
  // to guess the path.
  out = upsert(out, /<link rel="describedby"[^>]{0,512}>/i,
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
      ...(page.language ? { inLanguage: page.language } : {}),
      dateModified: new Date().toISOString().split('T')[0],
      isPartOf: { '@type': 'WebSite', name: config.seoSiteName, url: `${b}/` },
    });
    out = beforeHeadEnd(out, `<script type="application/ld+json"${nonceAttr}>${jsonLdSafe(jsonLd)}</script>`);
  }
  // A page that is about one thing carries that thing's own structured data beside the WebPage block:
  // the public dataset page its schema.org Dataset (services/datapackage/landing-page.ts).
  if (page.jsonLd) {
    out = beforeHeadEnd(out, `<script type="application/ld+json"${nonceAttr}>${jsonLdSafe(JSON.stringify(page.jsonLd))}</script>`);
  }
  return out;
}

/** The five characters escapeHtml writes, read back, so a value taken from a file is not escaped twice. */
function unescapeHtml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Stamp a static page served at `path` (the front pages behind AIMEAT_FRONT_PAGE) the way serveSpa
 * stamps the shell: the node's identity, then the canonical link, og:url and the WebPage block for
 * that path. The title and description are the file's own, read before injectSiteHead replaces
 * them, because the file is written for its language and the registry entry describes the classic
 * front page; the registry entry still supplies the markdown mirror and the picture.
 */
export function injectStaticPageHead(
  html: string,
  path: string,
  registryPage: PublicPage | undefined,
  config: AimeatConfig,
  nonceAttr = '',
): string {
  const title = unescapeHtml(html.match(/<title>([^<]{0,2048})<\/title>/i)?.[1]?.trim() ?? '');
  const description = unescapeHtml(html.match(/<meta name="description" content="([^"]*)"/i)?.[1] ?? '');
  const out = injectSiteHead(html, config, nonceAttr);
  const page: PublicPage = {
    changefreq: 'weekly',
    priority: '1.0',
    ...registryPage,
    path,
    title: title || registryPage?.title || config.seoSiteName,
    description: description || registryPage?.description || config.seoSiteDescription,
  };
  return injectPageHead(out, page, config, nonceAttr);
}

/** What a front page stored as one page per language tells its head. */
export interface TemplateLanguages {
  /** The language of the page being served, when it is known. */
  lang?: string;
  /** The page's own address when it is a language version; the default page keeps the path's. */
  address?: string;
  /** The hreflang set: every language's address, and `x-default`. Empty for a page in one language. */
  alternates: ReadonlyArray<{ hreflang: string; href: string }>;
}

/**
 * The head tags an operator's template may state for itself: the tag, the attribute that names it,
 * the name, and the attribute that holds its value.
 */
const OWN_HEAD_TAGS: ReadonlyArray<readonly ['meta' | 'link', string, string, string]> = [
  ['meta', 'name', 'description', 'content'],
  ['meta', 'property', 'og:title', 'content'],
  ['meta', 'property', 'og:description', 'content'],
  ['meta', 'property', 'og:image', 'content'],
  ['meta', 'property', 'og:url', 'content'],
  ['meta', 'property', 'og:site_name', 'content'],
  ['meta', 'name', 'twitter:card', 'content'],
  ['meta', 'name', 'twitter:title', 'content'],
  ['meta', 'name', 'twitter:description', 'content'],
  ['meta', 'name', 'twitter:image', 'content'],
  ['meta', 'name', 'twitter:site', 'content'],
  ['link', 'rel', 'canonical', 'href'],
];

/**
 * Stamp the operator's portal template, served at `path`, with the head metadata every other front
 * page carries. The template is the operator's own page, so a tag it states stays as written and
 * the node writes only the tags it lacks: the canonical link, og:*, twitter:* and the JSON-LD
 * blocks, described by the template's own title and description.
 *
 * A stated tag is first rewritten where it stands into the attribute order injectSiteHead and
 * injectPageHead find (`<meta property="og:title" content="…">`), its value untouched. Those two
 * then replace it instead of writing a second tag beside it, and the stated tag is put back last.
 * A canonical link the template states is also the address og:url and the WebPage block name, and
 * an og:title, og:description or og:image it states is also the twitter:* value of that name.
 * The robots tag is the node's setting (`seo.indexing`) and is not the template's to state.
 *
 * No markdown alternate link is written: the registry's mirror (`/index.md`) holds the classic
 * front page's text, a different document, and the head names no second address for this page.
 *
 * `languages` describes a front page stored as one page per language (services/site.ts): the
 * language of this page, its own address when it is a language version, and the hreflang set. The
 * address becomes the canonical link, og:url and the WebPage url unless the template states a
 * canonical link; the hreflang links are written unless the template states any itself. A page of
 * such a front page also names its language in `<meta name="aimeat-page-lang">`.
 */
export function injectTemplatePageHead(
  html: string,
  path: string,
  registryPage: PublicPage | undefined,
  config: AimeatConfig,
  nonceAttr = '',
  languages?: TemplateLanguages,
): string {
  const headEnd = html.search(/<\/head\s*>/i);
  if (headEnd < 0) return html;
  const head = html.slice(0, headEnd);
  const spans = { meta: tagSpans(head, 'meta'), link: tagSpans(head, 'link') };

  const stated: Array<{ key: string; value: string; start: number; end: number; text: string; pattern: RegExp }> = [];
  for (const [tag, keyAttr, key, valueAttr] of OWN_HEAD_TAGS) {
    const span = spans[tag].find(s => (s.attrs[keyAttr] ?? '').trim().toLowerCase() === key && (s.attrs[valueAttr] ?? '').trim() !== '');
    if (!span) continue;
    const value = span.attrs[valueAttr]!;
    stated.push({
      key,
      value,
      start: span.start,
      end: span.end,
      text: `<${tag} ${keyAttr}="${key}" ${valueAttr}="${value.replace(/"/g, '&quot;')}">`,
      pattern: tag === 'link'
        ? /<link rel="canonical"[^>]{0,512}>/i
        : new RegExp(`<meta ${keyAttr}="${key}" content="[^"]*"\\s*/?>`, 'i'),
    });
  }

  // Rewritten from the last tag to the first, so the places read above still hold.
  let out = html;
  for (const tag of [...stated].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, tag.start) + tag.text + out.slice(tag.end);
  }

  // A social title, description or picture stated for Open Graph only is the template's word for
  // the twitter:* tag of the same name too, so one link does not unfurl as two different pages.
  for (const name of ['title', 'description', 'image']) {
    const og = stated.find(t => t.key === `og:${name}`);
    if (!og || stated.some(t => t.key === `twitter:${name}`)) continue;
    stated.push({
      ...og,
      key: `twitter:${name}`,
      text: `<meta name="twitter:${name}" content="${og.value.replace(/"/g, '&quot;')}">`,
      pattern: new RegExp(`<meta name="twitter:${name}" content="[^"]*"\\s*/?>`, 'i'),
    });
  }

  const statedCanonical = unescapeHtml(stated.find(t => t.key === 'canonical')?.value ?? '').trim();
  const page: PublicPage = {
    path,
    title: '',
    description: '',
    changefreq: 'weekly',
    priority: '1.0',
    ...registryPage,
    markdown: undefined,
    ...(languages?.lang ? { language: languages.lang } : {}),
    ...(languages?.address ? { canonical: languages.address } : {}),
    ...(/^https?:\/\/[^\s"'<>]+$/i.test(statedCanonical) ? { canonical: statedCanonical } : {}),
  };
  out = injectStaticPageHead(out, path, page, config, nonceAttr);

  for (const tag of stated) out = out.replace(tag.pattern, () => tag.text);

  // One link per language the front page has, the same set on every one of its pages.
  const statesHreflang = spans.link.some(s => (s.attrs.hreflang ?? '').trim() !== '');
  if (languages && languages.alternates.length > 0 && !statesHreflang) {
    const links = languages.alternates
      .map(a => `<link rel="alternate" hreflang="${esc(a.hreflang)}" href="${esc(a.href)}">`).join('\n');
    out = beforeHeadEnd(out, links);
  }

  // The language of the page the node picked, for the served libraries on it (the drop-in header,
  // the sign-in dialog): _core/lang.js reads it first, so they speak the language of the text
  // around them. Written only when the front page has language versions; a page in one language
  // was not picked, and its libraries follow the reader's own choice as on any other page.
  const statesPageLang = spans.meta.some(s => (s.attrs.name ?? '').trim().toLowerCase() === 'aimeat-page-lang');
  if (languages?.lang && languages.alternates.length > 0 && !statesPageLang) {
    out = beforeHeadEnd(out, `<meta name="aimeat-page-lang" content="${esc(languages.lang)}">`);
  }
  return out;
}
