/**
 * @file src/services/ai-provenance-page.ts
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
 *   THE WORDING IS THE RECORD'S OWN. `disclosure.short` and `.long` are pre-rendered at mint time in
 *   every locale, so the page says exactly what the chip said. Writing fresh sentences here would
 *   create a second source of truth for a compliance statement, and the two would drift.
 *
 *   WHAT IS DELIBERATELY NOT HERE: any field the JSON would not have served to the same caller. The
 *   route decides `isOwner` and projects the record BEFORE calling this; a page that reached past
 *   that projection would widen a disclosure boundary in the one format nobody diffs.
 * @structure
 *   - provenancePage(record, opts) — the full HTML document
 * @usage
 *   if (prefersHtmlPage(req)) return res.type('html').send(provenancePage(serve(row, isOwner), {...}));
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial. LUOTAIN finding: the label's second layer was machine-only.
 */
import type { AiProvenance } from '../models/ai-provenance-schemas.js';
import type { Locale } from '../i18n.js';

export interface ProvenancePageOptions {
  /** The node's apex, for the links out. */
  baseUrl: string;
  /** Reader language, from Accept-Language. Only 'en' and 'fi' are rendered. */
  locale: Locale;
  /** The record's addressable URL, shown so a reader can cite or re-fetch it. */
  recordUrl: string;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Localized copy. Only the CHROME lives here; every statement of fact comes off the record. */
const COPY = {
  en: {
    title: 'How this was made',
    unstated: 'This record does not state it.',
    fields: 'What the record says',
    level: 'How much a model made', method: 'Method', human: 'Human involvement',
    model: 'Model', provider: 'Served by', generatedAt: 'Recorded', pipeline: 'Pipeline',
    principal: 'Recorded for', stampedBy: 'Stated by', sources: 'Sources',
    hash: 'Content fingerprint',
    hashNote: 'The record is bound to these exact bytes. Content that has changed since is not what '
      + 'this record describes.',
    stampedNode: 'the node, which did not witness the generation and inferred this',
    stampedPrincipal: 'the account that produced it, as its own statement',
    wrongTitle: 'Is this label wrong, or missing somewhere?',
    wrongBody: 'Anyone can report it. Quote the record id below.',
    reportBtn: 'How to report it',
    howNode: 'How this node marks AI content',
    recordId: 'Record id',
    machine: 'The same record as JSON',
    noneOwed: 'No visible label is owed for this content.',
    gone: 'No such record',
    goneBody: 'There is no provenance record at this address, or it is not public. If you arrived '
      + 'from a label, the content it described may have been unpublished.',
  },
  fi: {
    title: 'Miten tämä on tehty',
    unstated: 'Tietue ei kerro sitä.',
    fields: 'Mitä tietue kertoo',
    level: 'Kuinka paljon malli teki', method: 'Menetelmä', human: 'Ihmisen osuus',
    model: 'Malli', provider: 'Tarjoaja', generatedAt: 'Kirjattu', pipeline: 'Tuotantoketju',
    principal: 'Kirjattu tilille', stampedBy: 'Kertonut', sources: 'Lähteet',
    hash: 'Sisällön sormenjälki',
    hashNote: 'Tietue on sidottu juuri näihin tavuihin. Sen jälkeen muuttunut sisältö ei ole se, '
      + 'mitä tämä tietue kuvaa.',
    stampedNode: 'solmu, joka ei nähnyt tuottamista vaan päätteli tämän',
    stampedPrincipal: 'sisällön tuottanut tili omana ilmoituksenaan',
    wrongTitle: 'Onko merkintä väärä tai puuttuuko se jostain?',
    wrongBody: 'Kuka tahansa voi ilmoittaa siitä. Mainitse alla oleva tietueen tunnus.',
    reportBtn: 'Miten ilmoitat',
    howNode: 'Miten tämä solmu merkitsee tekoälysisältöä',
    recordId: 'Tietueen tunnus',
    machine: 'Sama tietue JSONina',
    noneOwed: 'Tälle sisällölle ei ole näkyvää merkintää velvoitettu.',
    gone: 'Tietuetta ei ole',
    goneBody: 'Tässä osoitteessa ei ole alkuperätietuetta, tai se ei ole julkinen. Jos tulit '
      + 'merkinnästä, sen kuvaama sisältö on voitu poistaa julkaisusta.',
  },
} as const;

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
  const t = COPY[opts.locale === 'fi' ? 'fi' : 'en'];
  const lang = opts.locale === 'fi' ? 'fi' : 'en';
  const base = opts.baseUrl.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t.gone)}</title>
<meta name="robots" content="noindex">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(t.gone)}</h1>
<p class="lede">${esc(t.goneBody)}</p>
<div class="card"><div class="actions">
<a href="${esc(base)}/v1/ai-transparency">${esc(t.howNode)}</a>
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
  const t = COPY[opts.locale === 'fi' ? 'fi' : 'en'];
  const lang = opts.locale === 'fi' ? 'fi' : 'en';
  const base = opts.baseUrl.replace(/\/+$/, '');
  const d = record.disclosure;
  const g = record.generator;

  // The chip's own sentence, in the reader's language, with the record's fallbacks.
  const short = d?.short?.[lang] ?? d?.short?.en ?? '';
  const long = d?.long?.[lang] ?? d?.long?.en ?? '';
  const lede = d?.required === false && !short ? t.noneOwed : [short, long].filter(Boolean).join('. ');

  const sources = (record.sources ?? []).filter(s => s?.url);
  const stamped = record.attestation?.stampedBy === 'node' ? t.stampedNode
    : record.attestation?.stampedBy === 'principal' ? t.stampedPrincipal : null;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(t.title)}</title>
<meta name="robots" content="noindex">
<link rel="alternate" type="application/json" href="${esc(opts.recordUrl)}">
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(t.title)}</h1>
<p class="lede">${esc(lede)}</p>

<h2>${esc(t.fields)}</h2>
<div class="card"><dl>
${row(t.level, esc(record.level))}
${row(t.method, record.method ? esc(record.method) : '')}
${row(t.human, esc(record.humanInvolvement))}
${row(t.model, g?.model ? `<code>${esc(g.model)}</code>` : '')}
${row(t.provider, g?.provider ? esc(g.provider) : '')}
${row(t.pipeline, g?.pipeline ? `<code>${esc(g.pipeline)}</code>` : '')}
${row(t.principal, g?.principal ? `<code>${esc(g.principal)}</code>` : '')}
${row(t.generatedAt, record.generatedAt ? esc(record.generatedAt) : '')}
${row(t.stampedBy, stamped ? esc(stamped) : '')}
</dl></div>

${sources.length ? `<h2>${esc(t.sources)}</h2>
<div class="card"><ol>
${sources.map(s => `<li><a href="${esc(s.url)}" rel="noopener noreferrer nofollow" target="_blank">${esc(s.title || s.url)}</a>${s.retrievedAt ? ` <span class="note">(${esc(String(s.retrievedAt).slice(0, 10))})</span>` : ''}</li>`).join('\n')}
</ol></div>` : ''}

${record.attestation?.contentHash ? `<h2>${esc(t.hash)}</h2>
<div class="card"><code>${esc(record.attestation.contentHash)}</code>
<p class="note">${esc(t.hashNote)}</p></div>` : ''}

${record.notes ? `<div class="card" style="margin-top:1rem"><p class="note" style="margin:0">${esc(record.notes)}</p></div>` : ''}

<h2>${esc(t.wrongTitle)}</h2>
<div class="card">
<p style="margin:0">${esc(t.wrongBody)}</p>
<p class="note">${esc(t.recordId)}: <code>${esc(opts.recordUrl.split('/').pop() ?? '')}</code></p>
<div class="actions">
<a href="${esc(base)}/v1/ai-transparency">${esc(t.howNode)}</a>
<a href="${esc(base)}/v1/docs#post-v1flags">${esc(t.reportBtn)}</a>
<a href="${esc(opts.recordUrl)}">${esc(t.machine)}</a>
</div>
</div>
</main>
</body>
</html>`;
}
