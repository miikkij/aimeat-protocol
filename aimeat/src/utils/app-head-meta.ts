/**
 * @file app-head-meta.ts
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
 *   - injectAppHeadMeta(html, spec) — pure string transform
 * @usage
 *   buf = injectAppHeadMeta(buf, { owner, filename, appName, description, origin, baseUrl, tools });
 * @version-history
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
}

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

const has = (html: string, re: RegExp) => re.test(html);

/** Add the tags the document does not already carry. Returns the input unchanged if it is not a document. */
export function injectAppHeadMeta(
  data: Buffer | Uint8Array | string,
  spec: AppHeadSpec,
): Buffer {
  const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  // A single-file app is frequently a bare fragment. The one measured here opens with
  // `<meta charset>` and has no doctype, no <html> and no <head> at all, leaving the parser to
  // build them — and the first version of this function bailed out on the missing </head>, so it
  // did nothing whatsoever for exactly the documents that needed it most.
  const hasHtmlEl = /<html[\s>]/i.test(text);
  const hasHeadEl = /<\/head\s*>/i.test(text);
  if (!hasHtmlEl && !hasHeadEl && !/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) {
    return Buffer.from(text, 'utf-8');  // not an HTML document
  }

  const name = spec.appName?.trim() || spec.filename.replace(/\.[^.]+$/, '');
  const desc = spec.description?.trim()
    || `${name} — an application published on AIMEAT by ${spec.owner}.`;
  const origin = spec.origin.replace(/\/$/, '');
  const add: string[] = [];

  if (!has(text, /<meta name="description"/i)) {
    add.push(`<meta name="description" content="${esc(desc)}">`);
  }
  if (!has(text, /<meta property="og:title"/i)) {
    add.push(`<meta property="og:title" content="${esc(name)}">`);
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
  if (!has(text, /<link rel="canonical"/i)) {
    // The app's OWN origin, never the apex. The app is the page here.
    add.push(`<link rel="canonical" href="${origin}/">`);
  }
  if (!has(text, /<link rel="alternate" type="text\/markdown"/i)) {
    add.push(`<link rel="alternate" type="text/markdown" href="${origin}/?format=md">`);
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
      author: { '@type': 'Person', name: spec.owner },
      isPartOf: { '@type': 'WebSite', name: 'AIMEAT', url: `${spec.baseUrl.replace(/\/$/, '')}/` },
      dateModified: (spec.updatedAt ?? new Date().toISOString()).split('T')[0],
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
  if (hasHtmlEl && !/<html[^>]*\slang=/i.test(out)) {
    out = out.replace(/<html(\s|>)/i, (m, tail: string) => `<html lang="en"${tail === '>' ? '>' : ' '}`);
  }

  return Buffer.from(out, 'utf-8');
}
