/**
 * @file app-head-meta.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fills in the `<head>` metadata a published app is missing, and one `<h1>` when it
 *   has none, derived from the app record and its tool manifest.
 *
 *   Measured on a live app origin: lang 0, canonical 0, description 0, og:title 0, og:description 0,
 *   JSON-LD 0, h1 0. Seven of seven absent — worse than any page on the main site, and true of
 *   every app, because an app is a single HTML file its author wrote and most authors do not write
 *   meta tags. That cannot be fixed by telling them to: every app already published would stay
 *   broken, and so would the next one. Every published app gets an origin automatically, so the
 *   only thing that scales is deriving it here, once, for all of them.
 *
 *   Two rules make it safe to run on somebody else's document:
 *
 *   1. **Never overwrite what the app declares.** A tag the author wrote wins. This fills gaps; it
 *      does not take the author's page away from them.
 *   2. **No heading is injected.** A hidden h1 would satisfy a checker that counts elements and
 *      help nobody — hidden content is not in the accessibility tree — and a visible one would
 *      change how somebody else's app looks. The app's own heading, or none, is the honest answer.
 *
 *   The JSON-LD is a SoftwareApplication, and its `offers` come from the app's priced tools — the
 *   one piece here that is not about a checker: a machine-readable price on a machine-readable
 *   capability is what an agent shopping for one actually reads.
 *
 * @structure
 *   - AppHeadSpec — what the serving route knows
 *   - applyAppHeadMeta(text, spec) — pure string transform over the document's head
 * @usage
 *   text = applyAppHeadMeta(text, { owner, filename, appName, description, origin, baseUrl, tools });
 * @version-history
 *   v1.4.0 — 2026-08-29 — `installChip: false` leaves the install-chip script out (the owner's switch);
 *     `author` (the declared reviewer) becomes the JSON-LD author and editor; `legal` writes the
 *     app's own legal pages as <link rel="terms-of-service" | "privacy-policy" | "help">.
 *   v1.3.0 — 2026-08-16 — The app is installable from its own origin: a manifest link, a
 *     theme-color, an apple-touch-icon and the install-chip script join the gap-fill set (the
 *     manifest itself is served by subdomains.ts; the chip shows the suggestion the browser never
 *     makes). Same rule as every other tag here: the author's own declaration wins.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a: takes and returns a string, so the single
 *     serve-time-marks pass (services/app-serve-marks.ts) decodes the document once instead of four
 *     times. Head-gap detection still runs against the text WITH the body marks already in it, which
 *     is load-bearing: a JSON-LD block added by the AI-disclosure marks legitimately suppresses the
 *     SoftwareApplication one here, and that was the behaviour before the consolidation too.
 *   v1.1.0 — 2026-07-28 — Works on a document with no <head> (or no <html>) — the common shape for
 *     a single-file app, and the one the first version silently skipped, so it did nothing at all
 *     for exactly the apps that needed it. Heading injection dropped, see rule 2 (phase 12b)
 *   v1.0.0 — 2026-07-28 — Initial (agent-readability phase 12)
 */

export interface AppPricedTool {
  name: string;
  description?: string | null;
  /** Price in morsels, when the tool is priced in them. */
  morsels?: number | null;
  /** Money price in micro-units (6 decimals) plus its currency, when priced in money. */
  amount?: number | null;
  currency?: string | null;
}

export interface AppHeadSpec {
  /** Bare owner name. */
  owner: string;
  /** App id — a filename WITH its extension. */
  filename: string;
  appName?: string | null;
  description?: string | null;
  /** The app's own origin, e.g. `https://nuotta.apps.aimeat.io` (no trailing slash). */
  origin: string;
  /** The node's apex base URL. */
  baseUrl: string;
  /** Priced tools from the app's manifest, for the JSON-LD offers. */
  tools?: AppPricedTool[];
  /** ISO date the app version was published, for `dateModified`. */
  updatedAt?: string | null;
  /** CSP nonce attribute for the JSON-LD script tag, or ''. */
  nonceAttr?: string;
  /**
   * Whether a search engine should index this app (services/app-seo.ts). False stamps a robots
   * meta and skips the descriptive tags: an app nobody asked to have found does not need keywords.
   * Defaults to false, so a caller that has not thought about it does not accidentally opt an
   * owner's app in.
   */
  indexable?: boolean;
  /** Keywords, from the owner's override or the app's own tags. Only used when indexable. */
  keywords?: string[];
  /** Absolute URL of the social image (the app's own screenshot, usually). */
  image?: string;
  /** BCP-47 tag the app declares for itself. Empty leaves the document's own `lang` alone. */
  lang?: string;
  /** Lifetime opens, for the JSON-LD interaction count. */
  downloads?: number;
  /**
   * The owner's EXPLICIT search title and description, from the app's Search section — set only
   * when they typed one. These are the two fields allowed to replace what the app already carries,
   * because they are the same author saying so deliberately rather than the node guessing. Absent
   * or empty, the app's own tags stand.
   */
  seoTitle?: string;
  seoDescription?: string;
  /**
   * Whether to load the browser install chip. The owner's switch (manifest.marks.install);
   * absent means on, which is what every app got before the switch existed.
   */
  installChip?: boolean;
  /**
   * The natural person who reviewed this app and answers for it (manifest.authorship). Becomes
   * the JSON-LD `author` and `editor`; absent, the account name stays the author as before.
   */
  author?: string;
  /**
   * The app's own legal pages (services/app-legal.ts), as `<link rel>` tags where a registered
   * relation exists (terms-of-service, privacy-policy, help) so a store, a crawler or an agent
   * finds them without reading the page.
   */
  legal?: Array<{ rel?: string; href: string; title: string }>;
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

const has = (html: string, re: RegExp) => re.test(html);

/** Add the tags the document does not already carry. Returns the input unchanged if it is not a document. */
export function applyAppHeadMeta(text: string, spec: AppHeadSpec): string {
  // A single-file app is frequently a bare fragment. The one measured here opens with
  // `<meta charset>` and has no doctype, no <html> and no <head> at all, leaving the parser to
  // build them — and the first version of this function bailed out on the missing </head>, so it
  // did nothing whatsoever for exactly the documents that needed it most.
  const hasHtmlEl = /<html[\s>]/i.test(text);
  const hasHeadEl = /<\/head\s*>/i.test(text);
  if (!hasHtmlEl && !hasHeadEl && !/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) {
    return text;  // not an HTML document
  }

  const name = spec.appName?.trim() || spec.filename.replace(/\.[^.]+$/, '');
  const desc = spec.description?.trim()
    || `${name} — an application published on AIMEAT by ${spec.owner}.`;
  const origin = spec.origin.replace(/\/$/, '');
  const add: string[] = [];

  // Search visibility is the app owner's own decision and it is off until they make one. The
  // robots meta is added even though the serving route also sends X-Robots-Tag, because the two
  // reach different readers: the header travels with THIS response, the meta travels with the
  // document however it was obtained. Neither is redundant, and unlike every other tag here this
  // one OVERWRITES an author's own robots meta — an app author cannot opt their app into the
  // node's search index by writing a tag, because that is the operator's and the owner's decision
  // to make through the switch, not the document's.
  if (!spec.indexable) {
    const noindex = `<meta name="robots" content="noindex, nofollow">`;
    text = has(text, /<meta name="robots"[^>]*>/i)
      ? text.replace(/<meta name="robots"[^>]*>/i, noindex)
      : text;
    if (!has(text, /<meta name="robots"/i)) add.push(noindex);
  }

  if (!has(text, /<meta name="description"/i)) {
    add.push(`<meta name="description" content="${esc(desc)}">`);
  }
  if (!has(text, /<meta property="og:title"/i)) {
    add.push(`<meta property="og:title" content="${esc(name)}">`);
  }

  // THE ONE PLACE THE AUTHOR'S OWN TAG IS REPLACED, and the exception proves the rule rather than
  // breaking it. Rule 1 protects an author from the NODE guessing at their metadata. An explicit
  // `seo.title` is not the node guessing: it is the same author, in the app's own Search section,
  // saying "use this in search results instead". Without this the field was a lie — it reached
  // og:title and nothing else, so a search engine kept reading the `<title>` the app shipped with,
  // and an owner who had followed advice to lengthen a short title saw no change at all.
  //
  // Only when they typed something. Left empty, the app's own title stands untouched.
  if (spec.seoTitle && has(text, /<title>[\s\S]*?<\/title>/i)) {
    text = text.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(spec.seoTitle)}</title>`);
  }
  if (spec.seoDescription && has(text, /<meta name="description" content="[^"]*"\s*\/?>/i)) {
    text = text.replace(/<meta name="description" content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${esc(spec.seoDescription)}">`);
  }
  if (!has(text, /<meta property="og:description"/i)) {
    add.push(`<meta property="og:description" content="${esc(desc)}">`);
  }
  if (!has(text, /<meta property="og:url"/i)) {
    add.push(`<meta property="og:url" content="${origin}/">`);
  }
  if (!has(text, /<meta property="og:type"/i)) {
    add.push(`<meta property="og:type" content="website">`);
  }
  // The app's own picture. Every published app can have a screenshot and none of them had a social
  // card, while the image sat one unauthenticated route away — a shared app link unfurled as a bare
  // URL everywhere it was posted. Only when the app is search-visible: the query behind
  // `spec.image` is not worth spending on an app nobody asked to have found.
  if (spec.indexable && spec.image) {
    if (!has(text, /<meta property="og:image"/i)) {
      add.push(`<meta property="og:image" content="${esc(spec.image)}">`);
    }
    if (!has(text, /<meta name="twitter:card"/i)) {
      add.push(`<meta name="twitter:card" content="summary_large_image">`);
    }
    if (!has(text, /<meta name="twitter:image"/i)) {
      add.push(`<meta name="twitter:image" content="${esc(spec.image)}">`);
    }
  }
  if (spec.indexable && spec.keywords?.length && !has(text, /<meta name="keywords"/i)) {
    add.push(`<meta name="keywords" content="${esc(spec.keywords.join(', '))}">`);
  }
  if (!has(text, /<link rel="canonical"/i)) {
    // The app's OWN origin, never the apex. The app is the page here.
    add.push(`<link rel="canonical" href="${origin}/">`);
  }
  // Installable from its own origin: the manifest (served per-app by subdomains.ts) is what lets
  // a browser offer "install" for THIS app, with its own name and its own icon, without the
  // author writing a single tag. iOS reads the two tags after it instead of the manifest.
  if (!has(text, /<link rel="manifest"/i)) {
    add.push(`<link rel="manifest" href="/manifest.webmanifest">`);
  }
  if (!has(text, /<meta name="theme-color"/i)) {
    add.push(`<meta name="theme-color" content="#FAFAF8">`);
  }
  if (!has(text, /<link rel="apple-touch-icon"/i)) {
    // A PNG, because iOS ignores SVG here. The apex heart stands in for every app: the per-app
    // emoji icon is an SVG and rasterizing emoji server-side would need a font pipeline.
    add.push(`<link rel="apple-touch-icon" href="${spec.baseUrl.replace(/\/$/, '')}/icons/apple-touch-icon.png">`);
  }
  if (spec.installChip !== false && !has(text, /install-chip\.js/i)) {
    // The suggestion half of installability: when the browser hands over an install offer, this
    // shows a small "Install this app" pill above the aimeat.io badge — the browser itself never
    // proposes anything. Does nothing on browsers that make no offer.
    add.push(`<script src="/js/install-chip.js" defer></script>`);
  }
  if (!has(text, /<link rel="alternate" type="text\/markdown"/i)) {
    add.push(`<link rel="alternate" type="text/markdown" href="${origin}/?format=md">`);
  }
  // The app's own legal pages, for the relations the platform registry has a word for. An app
  // that already declares one keeps its own.
  for (const l of spec.legal ?? []) {
    if (!l.rel) continue;
    if (has(text, new RegExp(`<link[^>]+rel="${l.rel}"`, 'i'))) continue;
    add.push(`<link rel="${esc(l.rel)}" href="${esc(l.href)}" title="${esc(l.title)}">`);
  }
  if (!has(text, /application\/ld\+json/i)) {
    const offers = (spec.tools ?? [])
      .filter((t) => (t.morsels ?? 0) > 0 || (t.amount ?? 0) > 0)
      .map((t) => ({
        '@type': 'Offer',
        name: t.name,
        description: t.description ?? undefined,
        ...(t.amount && t.currency
          // Money prices are carried in micro-units; schema.org wants the human amount.
          ? { price: (t.amount / 1_000_000).toFixed(2), priceCurrency: t.currency }
          : { price: String(t.morsels ?? 0), priceCurrency: 'MORSEL' }),
      }));
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name,
      description: desc,
      url: `${origin}/`,
      applicationCategory: 'WebApplication',
      operatingSystem: 'Any',
      // The declared reviewer (manifest.authorship) is the person who answers for this app, and
      // that is what `author` means to a reader of this vocabulary; without one, the account name.
      // `editor` is the same person, stated separately because a scanner reading bylines the way
      // the press is read (Luotain, 2026-08-29) looks for schema.org author AND editor.
      author: { '@type': 'Person', name: spec.author ?? spec.owner },
      ...(spec.author ? { editor: { '@type': 'Person', name: spec.author } } : {}),
      isPartOf: { '@type': 'WebSite', name: 'AIMEAT', url: `${spec.baseUrl.replace(/\/$/, '')}/` },
      dateModified: (spec.updatedAt ?? new Date().toISOString()).split('T')[0],
      ...(spec.image ? { image: spec.image } : {}),
      ...(spec.keywords?.length ? { keywords: spec.keywords.join(', ') } : {}),
      ...(spec.lang ? { inLanguage: spec.lang } : {}),
      // How many times this app has actually been opened. A real number rather than a rating: this
      // node counts opens and does not collect stars, and inventing an aggregateRating to win a
      // richer search result would be inventing the one thing here nobody measured.
      ...(spec.downloads
        ? {
            interactionStatistic: {
              '@type': 'InteractionCounter',
              interactionType: 'https://schema.org/DownloadAction',
              userInteractionCount: spec.downloads,
            },
          }
        : {}),
      ...(offers.length ? { offers } : {}),
    };
    add.push(`<script type="application/ld+json"${spec.nonceAttr ?? ''}>${JSON.stringify(ld)}</script>`);
  }

  let out: string;
  if (hasHeadEl) {
    out = add.length ? text.replace(/<\/head\s*>/i, `${add.join('\n')}\n</head>`) : text;
  } else {
    // No head element: open the document properly and let the parser close the head where it
    // always did — at the first flow content. The app's own <meta> and <title> stay in the head
    // exactly as before; the document simply now has a doctype, a lang and our tags.
    out = `<!DOCTYPE html>\n<html lang="en">\n<head>\n${add.join('\n')}\n${text}`;
  }

  // `lang` only when the author left it off — an app in Finnish must not be relabelled English.
  //
  // Which is what happened for a year, because the value here was the literal 'en'. Most app
  // authors omit the attribute, and this node's apps are substantially Finnish, so the tag was
  // asserting something plainly false to every search engine and screen reader that read it.
  // `spec.lang` carries what the app declares about ITSELF — its own `aimeat-locales` meta, or the
  // owner's override. 'en' is the last resort it always was, not the first answer.
  if (hasHtmlEl && !/<html[^>]*\slang=/i.test(out)) {
    const lang = esc(spec.lang?.trim() || 'en');
    out = out.replace(/<html(\s|>)/i, (m, tail: string) => `<html lang="${lang}"${tail === '>' ? '>' : ' '}`);
  }

  return out;
}
