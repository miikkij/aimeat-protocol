/**
 * @file src/services/ai-provenance-marks.ts
 * @description THE one place that turns a stored provenance record into the marks a surface carries
 *   (TARGET-058 Phase 2). Every plane AIMEAT serves — the JSON envelope, HTTP headers, HTML, and
 *   markdown — gets its mark from a function here, so a record cannot say one thing on the header
 *   and another in the document, and adding a plane is one function rather than an edit in five
 *   route files.
 *
 *   NO VOCABULARY STRING IS SPELLED HERE. Everything external comes from ai-provenance-adapters.ts:
 *   the IETF header value, the W3C attribute value, the IPTC URI inside the JSON-LD. If you find
 *   yourself typing `machine-generated` or `trainedAlgorithmicMedia` in this file, the adapter is
 *   the place for it — that is what keeps "when the IETF draft expires, one function changes" true.
 *
 *   THE TWO LAYERS. Every surface emits an IN-BAND mark (the value travels with the document) and
 *   an OUT-OF-BAND one (`rel="ai-provenance"` pointing at the addressable record). That is the Code
 *   of Practice's two-layer logic and also plain resilience: strip the HTML and the record survives;
 *   take the record offline and the in-band metadata survives.
 *
 *   SERVE-TIME ONLY, FOR HTML. injectAiDisclosure() runs on the bytes on their way out and NEVER on
 *   the bytes on their way in. A published app bundle is what its author uploaded; a served copy is
 *   that plus the node's marks. This codebase has been bitten by publishing from a served copy, so
 *   the injectors live on the serving path and the stored bundle is byte-identical after a serve.
 * @structure
 *   - loadServedProvenance(storage, config, id, opts) — fetch + project, for a route that has
 *     ALREADY authorized the content read
 *   - loadServedProvenanceMany(storage, config, ids, opts) — the same, batched, for a surface that
 *     reads a PAGE of items; one query rather than one per item
 *   - envelopeMeta(p)                — the `meta.provenance` value; the single envelope carrier
 *   - setProvenanceHeaders(res, p)   — `AI-Disclosure` + `Link: rel="ai-provenance"`
 *   - injectAiDisclosure(bytes, p, visible?) — serve-time HTML marks (meta, attribute, JSON-LD),
 *     plus the visible label chip when the caller is serving a runnable app document
 *   - provenanceFrontmatter(p)       — YAML lines for a markdown face
 *   - provenanceMarkdownNote(p)      — ONE human-readable line for the body
 * @usage
 *   const prov = await loadServedProvenance(storage, config, record.aiProvenanceId, { full: isOwner });
 *   setProvenanceHeaders(res, prov);
 *   res.json(success(config.nodeId, data, hints, envelopeMeta(prov)));
 * @version-history
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 4 step 0b. loadServedProvenanceMany(): the batch loader,
 *     so a surface that reads a page of items costs one query instead of one per item.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 3. injectAiDisclosure() gained the VISIBLE label chip for
 *     runnable app documents, deliberately inside the existing injector rather than as a new pass:
 *     four serve-time HTML injectors already re-parse the same document, and adding a fifth is what
 *     Phase 5 step 0 exists to prevent.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 2.
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import type { AiProvenance } from '../models/ai-provenance-schemas.js';
import { toIetfHeader, toW3cHtml, toIptc, toEuIcon } from './ai-provenance-adapters.js';
import { projectForDetail } from './ai-provenance.js';
import { injectBeforeClosingTag } from '../utils/html-inject.js';
import { createT, type Locale } from '../i18n.js';

/** A record ready to be served, with the URL a third party resolves it at. */
export interface ServedProvenance {
  /** The node-local record id. A convenience handle — `attestation.contentHash` is the real key. */
  id: string;
  /** The `aimeat.provenance/v1` document, already projected for AIMEAT_AI_PROVENANCE_DETAIL. */
  record: AiProvenance;
  /** Absolute URL of the addressable record — the out-of-band half of every mark. */
  recordUrl: string;
}

/**
 * Load the record attached to an item, for a route that has ALREADY decided the caller may read the
 * item itself.
 *
 * That precondition is the whole authorization argument here, and it is why this function does not
 * repeat the public/private test: provenance travels WITH content. Someone who is allowed to read a
 * members-only workspace record is allowed to know how it was made. The strict derived-visibility
 * rule belongs to `/v1/provenance/:id`, where a bare id arrives with no content to justify it.
 *
 * `full` serves the whole record (the owner's own view); anything else is projected down to what
 * AIMEAT_AI_PROVENANCE_DETAIL permits a public surface to show.
 */
export async function loadServedProvenance(
  storage: Storage,
  config: AimeatConfig,
  provenanceId: string | null | undefined,
  opts?: { full?: boolean },
): Promise<ServedProvenance | undefined> {
  if (!provenanceId) return undefined;
  const row = await storage.getAiProvenance(provenanceId);
  return row ? servedProvenanceOf(config, row, opts) : undefined;
}

/**
 * The BATCH form: the records attached to a page of items, in one query, keyed by id.
 *
 * Use this wherever a surface reads a list. The singular form in a loop is an N+1 that grows with
 * the CONTENT rather than with the traffic — a workspace holding a thousand agent-written records
 * costs a thousand lookups on every read of it — and the read tools an agent uses hit the same path.
 * Same authorization contract as the singular form: the caller has already decided the items are
 * readable, and provenance travels with the content it describes.
 *
 * Ids that do not resolve are simply absent from the map, so a caller looks up and spreads away.
 */
export async function loadServedProvenanceMany(
  storage: Storage,
  config: AimeatConfig,
  provenanceIds: readonly (string | null | undefined)[],
  opts?: { full?: boolean },
): Promise<Map<string, ServedProvenance>> {
  const ids = [...new Set(provenanceIds.filter((id): id is string => !!id))];
  const out = new Map<string, ServedProvenance>();
  if (ids.length === 0) return out;
  for (const row of await storage.getAiProvenanceMany(ids)) {
    out.set(row.id, servedProvenanceOf(config, row, opts));
  }
  return out;
}

/** The same projection for a caller that already holds the row — the mint path, typically. */
export function servedProvenanceOf(
  config: AimeatConfig, row: AiProvenanceRecordRow, opts?: { full?: boolean },
): ServedProvenance {
  return {
    id: row.id,
    record: opts?.full ? row.record : projectForDetail(row.record, config.aiProvenanceDetail),
    recordUrl: recordUrlFor(config, row.id),
  };
}

/** The canonical absolute URL of a record on this node. One spelling, so the planes agree. */
export function recordUrlFor(config: AimeatConfig, id: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}/v1/provenance/${id}`;
}

// ── The JSON envelope ───────────────────────────────────────────────────────────────────────────

/**
 * The `meta.provenance` value, or undefined so the caller can spread it away.
 *
 * IT IS `meta`, NOT `data`, EVERYWHERE. The envelope already carries `meta` (envelope.ts), the
 * provenance describes the content rather than being part of it, and `data` shapes are what
 * published apps read. Putting it in `data` on some routes and `meta` on others is the drift that
 * makes an SDK need a per-route special case — so there is one answer and this is it.
 */
export function envelopeMeta(p: ServedProvenance | undefined): { provenance: ServedProvenance } | undefined {
  return p ? { provenance: p } : undefined;
}

// ── HTTP headers ────────────────────────────────────────────────────────────────────────────────

/**
 * `AI-Disclosure` (the IETF structured field) plus `Link: <…>; rel="ai-provenance"`.
 *
 * `append`, not `set`: `Link` is a list header and several routes already publish a `canonical` or
 * `alternate` relation on it. Overwriting theirs to add ours would trade one machine-readable fact
 * for another.
 *
 * The header is omitted entirely for unstated provenance — see the adapters: we say nothing rather
 * than assert nothing, because an `AI-Disclosure` header reading "none" would be a claim we cannot
 * back.
 */
export function setProvenanceHeaders(res: Response, p: ServedProvenance | undefined): void {
  if (!p) return;
  const value = toIetfHeader(p.record);
  if (value) res.append('AI-Disclosure', value);
  res.append('Link', `<${p.recordUrl}>; rel="ai-provenance"`);
}

// ── HTML ────────────────────────────────────────────────────────────────────────────────────────

const HTML_MARK = 'id="aimeat-ai-provenance"';

/** The visible chip's element id. Distinct from `aimeat-app-badge` — two chips, two corners. */
const VISIBLE_LABEL_ID = 'aimeat-ai-label';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * esc(), plus every non-ASCII character as a numeric entity — so the text survives a document that
 * never declared its encoding.
 *
 * Not paranoia, measured: a published app is served as `text/html` with no charset parameter and
 * very often has no `<meta charset>` of its own, so the browser falls back to windows-1252 and UTF-8
 * bytes render as mojibake. The attribution badge beside this one already shows it ("â¡" for "⚡").
 * A decorative badge can live with that; a compliance statement reading "TekoÃ¤lyn tuottama" cannot,
 * and we do not get to require every app author to fix their document first.
 */
function escAscii(s: string): string {
  return esc(s).replace(/[^\x20-\x7E]/g, (c) => `&#${c.codePointAt(0)};`);
}

/**
 * schema.org `CreativeWork`, the one structured vocabulary a general-purpose crawler already reads.
 * `digitalSourceType` is the IPTC URI, from the adapter — the same value a C2PA manifest would
 * carry, so a reader that understands one understands both.
 */
function jsonLd(p: ServedProvenance): string {
  const doc: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    dateCreated: p.record.generatedAt,
    // Not `author`: the model did not author anything in the legal sense, and saying so in a
    // vocabulary that feeds search results would be a claim about authorship we do not make.
    creator: {
      '@type': 'SoftwareApplication',
      name: p.record.generator?.model ?? 'AI model',
      applicationCategory: 'AI',
    },
    subjectOf: { '@type': 'CreativeWork', url: p.recordUrl },
  };
  const iptc = toIptc(p.record);
  if (iptc) doc.digitalSourceType = iptc;
  if (p.record.sources?.length) doc.isBasedOn = p.record.sources.map((s) => s.url);
  // `<` escaped so the JSON can never close its own <script> element.
  return JSON.stringify(doc).replace(/</g, '\\u003c');
}

/**
 * Put the `ai-disclosure` attribute on the document element.
 *
 * Anchored deliberately narrowly: only an `<html …>` tag inside the first 512 characters, only when
 * the attribute is not already there, and only one replacement. A published app is a single-file
 * document whose own JavaScript very often contains the literal strings `</body>` and `<html>`, and
 * a badge injected by a naive first-match replace once landed inside app JS and killed the app. An
 * unmarked document is a much smaller problem than a broken one, so this returns the input unchanged
 * whenever it is not certain.
 */
function markDocumentElement(text: string, value: string): string {
  const head = text.slice(0, 512);
  const m = /<html(\s[^>]*)?>/i.exec(head);
  if (!m) return text;
  if (/\sai-disclosure\s*=/i.test(m[0])) return text;
  const replaced = `<html${m[1] ?? ''} ai-disclosure="${esc(value)}">`;
  return text.slice(0, m.index) + replaced + text.slice(m.index + m[0].length);
}

/**
 * The VISIBLE label for a served app document — Art. 50(5) on the one surface that cannot import
 * the Preact component, because it is somebody else's single-file HTML on an isolated origin.
 *
 * Built the same way as the aimeat.io attribution badge next to it (utils/app-badge.ts): pure static
 * markup plus a scoped `<style>`, no script, every declaration `!important` so arbitrary app CSS
 * cannot restyle a compliance mark. It sits bottom-LEFT precisely because that badge is bottom-right
 * — two fixed chips in one corner would overlay each other, and "no intervening overlay elements" is
 * a requirement of the Code, not a preference. The z-index is the maximum, so nothing an app draws
 * can cover it.
 *
 * The icon is referenced by absolute URL on the serving node rather than inlined: `img-src * data:`
 * in the app CSP already permits it, a 6 KB data URI on every response would not cache, and CSS
 * background-image is governed by `img-src`. The `aria-label` carries the statement, so the mark
 * never depends on the image loading.
 *
 * Returns '' when no visible label is owed — which is disclosureFor()'s decision, pre-rendered into
 * the record at mint time. Nothing here re-decides it.
 */
function visibleLabelMarkup(p: ServedProvenance, config: AimeatConfig, locale: Locale): string {
  if (!p.record.disclosure?.required) return '';
  const icon = toEuIcon(p.record);
  if (!icon) return '';

  const t = createT(locale);
  const short = p.record.disclosure.short?.[locale] ?? p.record.disclosure.short?.en ?? t('aiLabel.short');
  const alt = t(icon.alt);
  const base = config.baseUrl.replace(/\/+$/, '');
  const light = `${base}/assets/eu-ai-icons/svg/${icon.file}_black.svg`;
  const dark = `${base}/assets/eu-ai-icons/svg/${icon.file}_white.svg`;
  // The SVGs' own viewBox ratios. Two of the three are wide lockups, not glyphs, and a square box
  // would distort them — which the Code forbids ("proportions are preserved on resize").
  const ratio = icon.file === 'ai-basic' ? '1 / 1'
    : icon.file === 'ai-generated' ? '1789.84 / 566.93' : '1700.79 / 566.93';

  const surface =
    'background:#fff!important;color:#14151a!important;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.28)!important;border:1px solid #d5d5d5!important;';
  // `position:fixed` + the maximum z-index is the FALLBACK. The real answer is the top layer, put on
  // by the script below; both need the same box, so the rules are shared and `:popover-open` only
  // undoes the UA popover defaults (which would otherwise centre it and shrink-wrap it to nothing).
  const box =
    'position:fixed!important;left:12px!important;bottom:12px!important;top:auto!important;right:auto!important;'
    + 'margin:0!important;inset:auto auto 12px 12px!important;'
    + 'z-index:2147483647!important;display:inline-flex!important;align-items:center!important;'
    + 'flex-wrap:wrap!important;gap:4px 8px!important;padding:6px 10px!important;border-radius:14px!important;'
    + 'max-width:min(92vw,420px)!important;width:auto!important;height:auto!important;overflow:visible!important;'
    + 'font:600 11px/1.25 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;' + surface;
  const css =
    `#${VISIBLE_LABEL_ID}{${box}}`
    + `#${VISIBLE_LABEL_ID}:popover-open{${box}}`
    + `#${VISIBLE_LABEL_ID} i{display:block!important;flex:0 0 auto!important;height:18px!important;width:auto!important;`
    + `aspect-ratio:${ratio}!important;background:url("${esc(light)}") center/contain no-repeat!important}`
    + `#${VISIBLE_LABEL_ID} b{font-weight:600!important;overflow-wrap:anywhere!important}`
    // The link is the interactive second layer the Code encourages, so it survives every viewport:
    // the chip WRAPS on a narrow screen instead of dropping it. An earlier version hid it below
    // 520px, which removed the second layer on the commonest viewport there is.
    + `#${VISIBLE_LABEL_ID} a{color:inherit!important;opacity:.8!important;font-weight:500!important;`
    + 'text-decoration:underline!important}'
    + '@media (prefers-color-scheme:dark){'
    + `#${VISIBLE_LABEL_ID}{background:#14151a!important;color:#fff!important;border-color:#3a3a44!important}`
    + `#${VISIBLE_LABEL_ID}:popover-open{background:#14151a!important;color:#fff!important;border-color:#3a3a44!important}`
    + `#${VISIBLE_LABEL_ID} i{background-image:url("${esc(dark)}")!important}`
    + '}'
    // Narrow viewports: sit on the row ABOVE the aimeat.io attribution badge instead of beside it.
    // Measured at 390px — when a reader taps that badge open it slides left across the bottom row and
    // collides with this chip. This label is in the top layer so it wins the paint, which means the
    // COLLISION shows up as the badge being covered rather than the label; either way the Code asks
    // for "sufficient spacing from other overlay elements", and two chips fighting over one corner is
    // not that.
    + `@media (max-width:640px){#${VISIBLE_LABEL_ID},#${VISIBLE_LABEL_ID}:popover-open`
    + '{bottom:58px!important;inset:auto auto 58px 12px!important}}';

  // THE TOP LAYER, AND WHY IT NEEDS THREE LINES OF SCRIPT. The Code requires the mark to sit "where
  // no intervening overlay elements exist", and z-index cannot deliver that: an app appending its
  // own fixed layer at the same maximum z-index wins on DOM order, which is exactly what a browser
  // measurement showed. A manual popover is promoted to the browser's TOP LAYER, above every
  // z-index and above a modal dialog's backdrop, and it is the only mechanism that does.
  //
  // Applied by script rather than by a `popover` attribute in the markup, deliberately: a popover
  // that is never shown is `display:none`, so a hard-coded attribute would make the label VANISH
  // wherever the script does not run. This way the no-script outcome is the fixed chip — visible,
  // merely coverable — and the script is a strict upgrade. It rides the same
  // `script-src 'unsafe-inline'` the app CSP already grants, and it touches nothing but itself.
  // The observer's ONLY job is to put the mark back when an app removes it from the document or
  // closes the popover. Measured on a real page: the top layer already wins against an app's
  // `position:fixed` layer at the maximum z-index AND against a full-screen opaque modal `<dialog>`
  // (the label paints over both), so there is nothing to fight there.
  //
  // Deliberately NOT hit-testing to decide whether to re-show. `elementFromPoint` reports the dialog
  // while a modal is open, because inert content is excluded from hit testing even when it is
  // painted on top — so a "something is in front of me" test reads false-positive forever, and
  // re-showing mutates the element, which re-triggers the observer, which is a repaint loop for as
  // long as the dialog stays open. The two conditions below both become false after one repair, so
  // this cannot spin.
  const script =
    `(function(){var e=document.getElementById(${JSON.stringify(VISIBLE_LABEL_ID)});`
    + 'if(!e||typeof e.showPopover!=="function")return;'
    + 'var q=0;function up(){q=0;'
    + 'if(!e.isConnected){try{document.body.appendChild(e);}catch(_){return;}}'
    + 'try{e.popover="manual";if(!e.matches(":popover-open"))e.showPopover();}catch(_){}}'
    + 'function nudge(){if(q)return;'
    + 'if(e.isConnected&&e.matches(":popover-open"))return;'
    + 'q=requestAnimationFrame(up);}'
    + 'up();'
    + 'try{new MutationObserver(nudge).observe(document.documentElement,{childList:true,subtree:true});}catch(_){}'
    + '})();';

  // escAscii, not esc: every user-visible string here may be Finnish, and the host document's
  // encoding is not ours to rely on.
  return `<div id="${VISIBLE_LABEL_ID}" role="group" aria-label="${escAscii(t('aiLabel.regionLabel'))}">`
    + `<style>${css}</style>`
    + `<i role="img" aria-label="${escAscii(alt)}"></i>`
    + `<b>${escAscii(short)}</b>`
    + `<a href="${esc(p.recordUrl)}" target="_blank" rel="noopener noreferrer">${escAscii(t('aiLabel.detailsLink'))}</a>`
    + `</div><script>${script}</script>`;
}

/**
 * Serve-time AI-disclosure marks for an HTML document: the `ai-disclosure` attribute on `<html>`, a
 * `<meta name="ai-disclosure">`, a `<link rel="ai-provenance">` to the addressable record, a
 * schema.org JSON-LD block, and — for a RUNNABLE app document — the visible label a person sees.
 *
 * NEVER CALL THIS ON THE WAY IN. The output is what a visitor receives; the stored bundle stays the
 * author's bytes. Returns the input unchanged for a non-HTML payload, for unstated provenance, and
 * for a document that already carries the block (idempotent — a served document can be re-served
 * through the same path).
 *
 * Nothing here executes, so it needs no CSP allowance a static document does not already have: the
 * inline `<style>` rides the same `style-src 'unsafe-inline'` the attribution badge already needs,
 * and the icon rides `img-src *`.
 *
 * `visible` is opt-in per caller rather than automatic, because the machine marks belong on every
 * HTML face while the chip belongs only where a person is looking at a rendered app. The raw
 * (attachment) download gets neither — it stays byte-for-byte, which is what keeps the content hash
 * in the record verifiable.
 */
export function injectAiDisclosure(
  data: Buffer | Uint8Array | string, p: ServedProvenance | undefined,
  visible?: { config: AimeatConfig; locale: Locale },
): Buffer {
  const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  if (!p) return Buffer.from(text, 'utf-8');
  if (!/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) return Buffer.from(text, 'utf-8');
  if (text.includes(HTML_MARK)) return Buffer.from(text, 'utf-8');

  const w3c = toW3cHtml(p.record);
  const block =
    (w3c ? `<meta name="ai-disclosure" content="${esc(w3c)}">` : '')
    + `<link rel="ai-provenance" href="${esc(p.recordUrl)}">`
    + `<script type="application/ld+json" ${HTML_MARK}>${jsonLd(p)}</script>`
    + (visible ? visibleLabelMarkup(p, visible.config, visible.locale) : '');

  const marked = w3c ? markDocumentElement(text, w3c) : text;
  return Buffer.from(injectBeforeClosingTag(marked, block), 'utf-8');
}

// ── Markdown ────────────────────────────────────────────────────────────────────────────────────

/**
 * YAML frontmatter lines carrying the record, for a markdown face. Returned as lines rather than a
 * block so a caller can fold them into frontmatter it is already building.
 *
 * The document keeps ONE spelling on every carrier it travels on, so the nested keys are the
 * record's own camelCase — this is the same `aimeat.provenance/v1` an agent would fetch from
 * `/v1/provenance/:id`, not a markdown-specific dialect of it.
 */
export function provenanceFrontmatter(p: ServedProvenance | undefined): string[] {
  if (!p) return [];
  return [
    'ai_provenance:',
    ...JSON.stringify(p.record, null, 2).split('\n').map((l) => `  ${l}`),
    `ai_provenance_url: ${p.recordUrl}`,
  ];
}

/**
 * ONE human-readable line for the body.
 *
 * Frontmatter alone is not enough: an agent asked to summarise a page carries the BODY forward and
 * routinely drops the metadata, so a statement that exists only in frontmatter stops existing the
 * moment the page is summarised. This line is the version that survives being retold.
 *
 * The words come from the record's own pre-rendered `disclosure.short`, so the markdown face and a
 * rendered label say the same thing in the same language.
 */
export function provenanceMarkdownNote(p: ServedProvenance | undefined): string {
  if (!p) return '';
  const r = p.record;
  const label = r.disclosure?.short?.en ?? r.level;
  const model = r.generator?.model ? ` (${r.generator.model})` : '';
  const reviewed = r.humanInvolvement === 'editorial-control' || r.humanInvolvement === 'full-human'
    ? 'human editorial review'
    : 'no human editorial review';
  return `> **AI provenance** — ${label}${model}, ${reviewed}, ${r.generatedAt} · record: ${p.recordUrl}`;
}
