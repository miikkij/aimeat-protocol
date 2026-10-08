/**
 * @file src/services/ai-provenance-marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   SERVE-TIME ONLY, FOR HTML. The HTML marks are built on the bytes on their way out and NEVER on
 *   the bytes on their way in. A published app bundle is what its author uploaded; a served copy is
 *   that plus the node's marks. This codebase has been bitten by publishing from a served copy, so
 *   the marks live on the serving path and the stored bundle is byte-identical after a serve.
 * @structure
 *   - loadServedProvenance(storage, config, id, opts) — fetch + project, for a route that has
 *     ALREADY authorized the content read
 *   - loadServedProvenanceMany(storage, config, ids, opts) — the same, batched, for a surface that
 *     reads a PAGE of items; one query rather than one per item
 *   - servedProvenanceOf(config, row, opts) / servedDisclosure(record, surface, policy) — the
 *     disclosure decided for the item as it is served, not trusted from mint
 *   - envelopeMeta(p)               — the `meta.provenance` value; the single envelope carrier
 *   - provenanceItemBlock(p)         — the per-ITEM `ai_provenance` block, for a list of rows that
 *     each carry their own statement (REST DTOs and MCP tool results share it verbatim)
 *   - setProvenanceHeaders(res, p)   — `AI-Disclosure` + `Link: rel="ai-provenance"`
 *   - aiDisclosureParts(p, visible?) — the serve-time HTML marks (meta, link, JSON-LD, plus the
 *     visible label chip for a runnable app document) and the `ai-disclosure` value for the document
 *     element; PROVENANCE_HTML_MARK + markDocumentElement() go with them. app-serve-marks.ts is what
 *     puts them in a page.
 *   - provenanceFrontmatter(p)       — YAML lines for a markdown face
 *   - provenanceMarkdownNote(p)      — ONE human-readable line for the body
 * @usage
 *   const prov = await loadServedProvenance(storage, config, record.aiProvenanceId, { full: isOwner });
 *   setProvenanceHeaders(res, prov);
 *   res.json(success(config.nodeId, data, hints, envelopeMeta(prov)));
 * @version-history
 *   v1.9.1 — 2026-10-09 — The JSON-LD escapes every non-ASCII character, so a localized fallback model
 *     name or a reviewer's name keeps the served app document ASCII.
 *   v1.9.0 — 2026-10-08 — The disclosure is decided when the record is SERVED, against the item's
 *     visibility as served and the record's medium (servedDisclosure). The loaders take an optional
 *     `surface`; without its visibility they ask the live visibility predicate, so an item made
 *     public after mint (a visibility-only update, an access code removed) carries the label it now
 *     owes. Minted words are kept while the decision is unchanged. The JSON-LD is typed by medium
 *     and carries `encodingFormat`; its fallback model name and the markdown note come from
 *     `aiLabel.note.*`. reviewedForLabel leaves synthetic media alone and reads the record's medium.
 *   v1.8.1 — 2026-10-05 — HTML is escaped with escapeHtml (utils/html-escape.ts), which escapes all five characters (secaudit 2026-10, C8).
 *   v1.8.0 — 2026-09-29 — The visible label is the EU icon alone on every viewport (developer
 *     decision 2026-09-29), and its statement opens in a panel above the chip on hover, focus or a
 *     tap, so the chip never moves (it used to jump from bottom:12px to bottom:58px and grow). The
 *     chip has a fixed width, declared as --aimeat-mark-ai-w, and the other marks line up after it
 *     on one row at the bottom-left. A tap elsewhere closes the panel, and opening it closes the
 *     attribution badge's pill. It stays in the top layer: the regulation requires it.
 *   v1.7.0 — 2026-09-26 — reviewedForLabel() takes the app's real visibility (`publiclyReadable`,
 *     default true) instead of assuming public, and under a strict node policy the chip names the
 *     reviewer and shows the AI-involvement icon instead of "AI-generated". Reported by the
 *     originalmiskate.com node on 2026-09-25: a reviewed board deck still read "AI-generated".
 *   v1.6.0 — 2026-08-29 — aiDisclosureParts takes `reviewedBy`: with a named reviewer the visible
 *     label is decided again under editorial responsibility (reviewedForLabel); the machine marks
 *     stay as minted, and the interaction and deep-fake reasons are left untouched. The reviewer
 *     is added to the provenance JSON-LD as `editor` (a Person), the way a byline scanner reads it.
 *   v1.5.0 — 2026-08-02 — Mobile presentation of the visible label: collapsed icon-only pill on the
 *     same 34px row as the attribution badge (was: full-text chip on its own row at bottom:58px,
 *     ~90px of every phone viewport), tap-to-expand to the full statement via a hidden-checkbox
 *     toggle. The disclosure icon stays visible at all times; desktop is unchanged. Developer
 *     decision 2026-08-02 (Oma talo dialog collision).
 *   v1.4.0 — 2026-08-01 — TARGET-058 Phase 9 step 0. provenanceItemBlock(): the per-item wire shape,
 *     lifted out of mcp/ai-provenance-result.ts when the REST board and agent-message reads needed
 *     the identical block. One declaration, two surfaces.
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a. injectAiDisclosure() becomes
 *     aiDisclosureParts(): the document detection, the idempotency check and the last-</body> rule
 *     are now shared with the other three serve-time marks in services/app-serve-marks.ts, which is
 *     what stops the SDK work below from creating a fifth injector. Byte-identical output, held by
 *     test/fixtures/serve-marks-golden.json.
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
import { isSyntheticMedia, type AiProvenance, type AiDisclosureBlock } from '../models/ai-provenance-schemas.js';
import { toIetfHeader, toW3cHtml, toIptc, toEuIcon } from './ai-provenance-adapters.js';
import { projectForDetail, buildDisclosure, publiclyResolvable } from './ai-provenance.js';
import type { SurfaceContext } from './ai-disclosure.js';
import { servedContext, type ServedSurface } from './ai-disclosure-served.js';

export type { ServedSurface };
import { createT, type Locale } from '../i18n.js';
import { escapeHtml } from '../utils/html-escape.js';

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
 * How a serving route asks for a record. `full` serves the whole record (the owner's own view);
 * anything else is projected down to what AIMEAT_AI_PROVENANCE_DETAIL permits a public surface to
 * show. `surface` is what the route knows about the item it serves; see servedDisclosure().
 */
export interface ServeOptions {
  full?: boolean;
  surface?: ServedSurface;
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
 * THE DISCLOSURE IS DECIDED HERE, NOT AT MINT. A route that does not say the item's visibility gets
 * the live answer of the visibility predicate (publiclyResolvable): public while anything public
 * points at the record. One query for the whole call, and a route that knows passes `surface`.
 */
export async function loadServedProvenance(
  storage: Storage,
  config: AimeatConfig,
  provenanceId: string | null | undefined,
  opts?: ServeOptions,
): Promise<ServedProvenance | undefined> {
  if (!provenanceId) return undefined;
  const row = await storage.getAiProvenance(provenanceId);
  if (!row) return undefined;
  const visibility = opts?.surface?.visibility
    ?? ((await publiclyResolvable(storage, [row.id])).has(row.id) ? 'public' : 'private');
  return servedProvenanceOf(config, row, { ...opts, surface: { ...opts?.surface, visibility } });
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
  opts?: ServeOptions,
): Promise<Map<string, ServedProvenance>> {
  const ids = [...new Set(provenanceIds.filter((id): id is string => !!id))];
  const out = new Map<string, ServedProvenance>();
  if (ids.length === 0) return out;
  const rows = await storage.getAiProvenanceMany(ids);
  // One predicate query for the page when the route did not say the items' visibility.
  const known = opts?.surface?.visibility;
  const pub = known ? undefined : await publiclyResolvable(storage, rows.map((r) => r.id));
  for (const row of rows) {
    const visibility = known ?? (pub?.has(row.id) ? 'public' : 'private');
    out.set(row.id, servedProvenanceOf(config, row, { ...opts, surface: { ...opts?.surface, visibility } }));
  }
  return out;
}

/**
 * The same projection for a caller that already holds the row. With `surface.visibility` the
 * disclosure is decided for that surface (servedDisclosure); without it the block is served as
 * minted, which is right only for the mint path itself, where the record was decided a moment ago
 * against the surface the caller passed to the mint.
 */
export function servedProvenanceOf(
  config: AimeatConfig, row: AiProvenanceRecordRow, opts?: ServeOptions,
): ServedProvenance {
  const visibility = opts?.surface?.visibility;
  const decided = visibility
    ? { ...row.record, disclosure: servedDisclosure(row.record, { ...opts!.surface, visibility }, config.aiLabelPublic) }
    : row.record;
  return {
    id: row.id,
    record: opts?.full ? decided : projectForDetail(decided, config.aiProvenanceDetail),
    recordUrl: recordUrlFor(config, row.id),
  };
}

/**
 * THE serve-time decision: the disclosure a reader of this item is owed NOW, against the item's
 * visibility as served and the record's medium.
 *
 * The block stored at mint is the record of what was decided then, against the surface the item
 * had then. An item made public afterwards (a visibility-only update, an access code removed, a file
 * shared) kept "no label owed" on every surface that trusted it. So every serving surface decides
 * again. When the decision is the one the record was minted with, the minted words are kept, so a
 * record keeps the words it was minted with until the decision itself changes.
 */
export function servedDisclosure(
  record: AiProvenance, served: ServedSurface & { visibility: SurfaceContext['visibility'] },
  policy: AimeatConfig['aiLabelPublic'],
): AiDisclosureBlock {
  const block = buildDisclosure(record, servedContext(record, served), policy);
  const minted = record.disclosure;
  if (minted && minted.required === block.required && minted.reason === block.reason
    && (minted.strength ?? block.strength) === block.strength) return minted;
  return block;
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

/** The per-ITEM wire shape: the id, the document, and where the document resolves. */
export interface AiProvenanceItemBlock {
  ai_provenance: { id: string; record: AiProvenance; record_url: string };
}

/**
 * The block that rides on ONE ITEM in a list, or `{}` so a caller can spread it away unconditionally.
 *
 * `meta.provenance` above is for a response that IS one piece of generated content. A list of board
 * posts or agent messages is not that: each row carries its own statement, and folding them into one
 * envelope key would say that one record described the whole page.
 *
 * snake_case keys around a camelCase document is not an inconsistency to apologise for: the keys are
 * a DTO and follow the wire convention, while the document is self-describing and keeps one spelling
 * on every carrier it travels on (22-frozen-vocabulary §B1).
 *
 * AUTHORIZATION IS THE CALLER'S READ, NOT A SECOND TEST — same contract as loadServedProvenance():
 * whoever may read the item may know how it was made.
 */
export function provenanceItemBlock(
  p: ServedProvenance | undefined,
): AiProvenanceItemBlock | Record<string, never> {
  if (!p) return {};
  return { ai_provenance: { id: p.id, record: p.record, record_url: p.recordUrl } };
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

/** Present in a document that already carries the marks — what makes a re-serve idempotent. */
export const PROVENANCE_HTML_MARK = 'id="aimeat-ai-provenance"';

/** The visible chip's element id. Distinct from `aimeat-app-badge` — two chips, two corners. */
const VISIBLE_LABEL_ID = 'aimeat-ai-label';
/** The EU icon's height in the chip, in px. The chip's width is derived from it. */
const ICON_H = 15;

const esc = escapeHtml;

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

/** The schema.org type for a record's medium. `CreativeWork` when the record does not say. */
const SCHEMA_TYPE_BY_MEDIUM: Record<string, string> = {
  code: 'WebApplication', image: 'ImageObject', audio: 'AudioObject', video: 'VideoObject', data: 'Dataset',
};

/**
 * schema.org, the one structured vocabulary a general-purpose crawler already reads, typed by the
 * record's medium (a served app is a `WebApplication`, a picture an `ImageObject`).
 * `digitalSourceType` is the IPTC URI, from the adapter — the same value a C2PA manifest would
 * carry, so a reader that understands one understands both.
 */
function jsonLd(p: ServedProvenance, reviewedBy?: string, locale: Locale = 'en'): string {
  const doc: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': SCHEMA_TYPE_BY_MEDIUM[p.record.mediaKind ?? ''] ?? 'CreativeWork',
    dateCreated: p.record.generatedAt,
    ...(p.record.mediaType ? { encodingFormat: p.record.mediaType } : {}),
    // Not `author`: the model did not author anything in the legal sense, and saying so in a
    // vocabulary that feeds search results would be a claim about authorship we do not make.
    creator: {
      '@type': 'SoftwareApplication',
      name: p.record.generator?.model ?? createT(locale)('aiLabel.note.model'),
      applicationCategory: 'AI',
    },
    subjectOf: { '@type': 'CreativeWork', url: p.recordUrl },
  };
  // The declared reviewer is the EDITOR, never the author: a person examined what the model
  // produced and answers for it, which is exactly what schema.org's `editor` says, and it is the
  // second field a byline scanner reads (Luotain reads schema.org author and editor, meta author
  // and rel=author, the way the press is read). `creator` above stays the model.
  if (reviewedBy) doc.editor = { '@type': 'Person', name: reviewedBy };
  const iptc = toIptc(p.record);
  if (iptc) doc.digitalSourceType = iptc;
  if (p.record.sources?.length) doc.isBasedOn = p.record.sources.map((s) => s.url);
  // `<` escaped so the JSON can never close its own <script> element. Every non-ASCII character is
  // escaped too (the same JSON value): the served app document stays ASCII whatever its own charset
  // says, and a localized fallback name ("tekoälymalli") or a reviewer's name would otherwise put a
  // UTF-8 byte into it (test/unit/app-badge-encoding.test.ts).
  return JSON.stringify(doc).replace(/[<\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
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
export function markDocumentElement(text: string, value: string): string {
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
 * cannot restyle a compliance mark. It is the FIRST mark on the node's one row at the bottom-left:
 * it declares its width as `--aimeat-mark-ai-w`, and the attribution bolt and the install button
 * line up after it, so no two marks overlay each other ("no intervening overlay elements" is a
 * requirement of the Code, not a preference). The z-index is the maximum and the script below puts
 * it in the top layer, so nothing an app draws can cover it.
 *
 * The icon is referenced by absolute URL on the serving node rather than inlined: `img-src * data:`
 * in the app CSP already permits it, a 6 KB data URI on every response would not cache, and CSS
 * background-image is governed by `img-src`. The `aria-label` carries the statement, so the mark
 * never depends on the image loading.
 *
 * On every viewport the chip is the EU icon alone in a 34px pill (developer decision 2026-09-29; it
 * was the phone rule since 2026-08-02). The words and the details link open in a panel ABOVE the
 * chip on hover, on keyboard focus and on a tap, and the chip itself never moves. One short row is
 * the whole footprint the marks cost — the strip apps keep clear via `--aimeat-chrome-bottom`
 * (utils/app-chrome-reserve.ts).
 *
 * Returns '' when no visible label is owed — which is disclosureFor()'s decision, made for this
 * surface when the record was loaded (servedDisclosure). Nothing here re-decides it.
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
  const [rw, rh] = icon.file === 'ai-basic' ? [1, 1]
    : icon.file === 'ai-generated' ? [1789.84, 566.93] : [1700.79, 566.93];
  const ratio = icon.file === 'ai-basic' ? '1 / 1' : `${rw} / ${rh}`;
  // The chip's width is fixed, not shrink-wrapped, because the next mark on the row is placed after
  // it: 15px of icon height at the lockup's ratio, 10px of padding each side, a 1px border each side.
  const chipW = Math.ceil(ICON_H * rw / rh) + 22;

  // The colours as variables on the chip, so the chip and the panel above it change together in
  // dark mode instead of each carrying its own copy of every declaration.
  const palette = (bg: string, fg: string, line: string): string =>
    `--aimeat-ail-bg:${bg}!important;--aimeat-ail-fg:${fg}!important;--aimeat-ail-line:${line}!important;`;
  const surface =
    'background:var(--aimeat-ail-bg)!important;color:var(--aimeat-ail-fg)!important;'
    + 'box-shadow:0 4px 16px rgba(0,0,0,.28)!important;border:1px solid var(--aimeat-ail-line)!important;';
  // `position:fixed` + the maximum z-index is the FALLBACK. The real answer is the top layer, put on
  // by the script below; both need the same box, so the rules are shared and `:popover-open` only
  // undoes the UA popover defaults (which would otherwise centre it and shrink-wrap it to nothing).
  //
  // THE CHIP NEVER CHANGES. On every viewport it is the EU icon in a 34px pill at the bottom-left
  // corner, and no state of the label moves it or resizes it (developer decision 2026-09-29: the
  // tapped label used to jump 46px up and grow, because the open statement took the chip's place).
  const box =
    'position:fixed!important;left:12px!important;bottom:12px!important;top:auto!important;right:auto!important;'
    + 'margin:0!important;inset:auto auto 12px 12px!important;'
    + 'z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;'
    + `width:${chipW}px!important;height:34px!important;box-sizing:border-box!important;padding:0 10px!important;`
    + 'border-radius:9999px!important;overflow:visible!important;'
    + 'font:600 13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif!important;' + palette('#fff', '#14151a', '#d5d5d5') + surface;
  const panel = `#${VISIBLE_LABEL_ID}>span`;
  const css =
    // The next mark on the row (the attribution bolt, then the install button) starts after this.
    `:root{--aimeat-mark-ai-w:${chipW + 8}px}`
    + `#${VISIBLE_LABEL_ID}{${box}}`
    + `#${VISIBLE_LABEL_ID}:popover-open{${box}}`
    + `#${VISIBLE_LABEL_ID} i{display:block!important;flex:0 0 auto!important;height:${ICON_H}px!important;width:auto!important;`
    + `aspect-ratio:${ratio}!important;background:url("${esc(light)}") center/contain no-repeat!important}`
    // THE STATEMENT, the interactive second layer the Code encourages: the words and the details
    // link, in a panel that opens ABOVE the chip, left edge on the chip's left edge. Closed, it is
    // visually hidden rather than display:none, so a screen reader reads the statement at all
    // times and the link stays in the tab order (tabbing to it opens the panel).
    + `${panel}{position:absolute!important;left:-1px!important;bottom:100%!important;width:1px!important;height:1px!important;`
    + 'margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important}'
    + `#${VISIBLE_LABEL_ID}:hover>span,#${VISIBLE_LABEL_ID}:focus-within>span,#${VISIBLE_LABEL_ID} input:checked~span`
    + '{bottom:calc(100% + 6px)!important;display:flex!important;flex-wrap:wrap!important;align-items:baseline!important;'
    + 'gap:4px 10px!important;width:max-content!important;max-width:min(420px,calc(100vw - 24px))!important;height:auto!important;'
    + 'box-sizing:border-box!important;padding:10px 14px!important;border-radius:14px!important;overflow:visible!important;'
    + `clip-path:none!important;white-space:normal!important;${surface}}`
    // The 6px between the panel and the chip, made hoverable, so the pointer can reach the link.
    + `${panel}::after{content:""!important;position:absolute!important;left:0!important;right:0!important;top:100%!important;height:8px!important}`
    + `#${VISIBLE_LABEL_ID} b{font-weight:600!important;overflow-wrap:anywhere!important}`
    + `#${VISIBLE_LABEL_ID} a{color:inherit!important;opacity:.8!important;font-weight:500!important;`
    + 'text-decoration:underline!important}'
    // The toggle plumbing: a visually-hidden (never display:none — keyboard a11y) checkbox plus a
    // tap target over the chip. A touch screen has no hover to hold the panel open, so a tap does.
    + `#${VISIBLE_LABEL_ID} input{position:absolute!important;width:1px!important;height:1px!important;`
    + 'margin:0!important;opacity:0!important;pointer-events:none!important}'
    + `#${VISIBLE_LABEL_ID} label{display:block!important;position:absolute!important;inset:0!important;`
    + 'margin:0!important;cursor:pointer!important;border-radius:inherit!important;z-index:2!important}'
    + `#${VISIBLE_LABEL_ID} input:focus-visible~label{outline:2px solid var(--color-primary,#E8564A)!important;outline-offset:2px!important}`
    + '@media (prefers-color-scheme:dark){'
    + `#${VISIBLE_LABEL_ID},#${VISIBLE_LABEL_ID}:popover-open{${palette('#14151a', '#fff', '#3a3a44')}}`
    + `#${VISIBLE_LABEL_ID} i{background-image:url("${esc(dark)}")!important}`
    + '}';

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
  //
  // TWO MORE LINES, FOR THE TAPPED PANELS. A tap opens this label's statement or the attribution
  // badge's pill, and both open above the same row, so opening one closes the other; a tap anywhere
  // else closes both, as a touch reader expects of anything that opened on a tap. Only the
  // checkboxes change, never the elements, so the observer below does not see it.
  const tapIds = `var A=${JSON.stringify(`${VISIBLE_LABEL_ID}-open`)},B="aimeat-app-badge-open";`;
  const script =
    `(function(){var e=document.getElementById(${JSON.stringify(VISIBLE_LABEL_ID)});`
    + 'if(!e)return;' + tapIds
    + 'function g(i){return document.getElementById(i);}'
    + 'document.addEventListener("change",function(v){var t=v.target,o=t&&t.id===A?B:t&&t.id===B?A:"";'
    + 'if(o&&t.checked){var x=g(o);if(x)x.checked=false;}},true);'
    + 'document.addEventListener("pointerdown",function(v){[[A,e],[B,g("aimeat-app-badge")]].forEach(function(p){'
    + 'var x=g(p[0]);if(x&&x.checked&&p[1]&&!p[1].contains(v.target))x.checked=false;});},true);'
    + 'if(typeof e.showPopover!=="function")return;'
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
    + `<input type="checkbox" id="${VISIBLE_LABEL_ID}-open">`
    + `<label for="${VISIBLE_LABEL_ID}-open" aria-label="${escAscii(t('aiLabel.expand'))}"></label>`
    + `<i role="img" aria-label="${escAscii(alt)}"></i>`
    // A span, never a div: the publish strip finds the end of this block at its first `</div>`.
    + `<span><b>${escAscii(short)}</b>`
    + `<a href="${esc(p.recordUrl)}" target="_blank" rel="noopener noreferrer">${escAscii(t('aiLabel.detailsLink'))}</a></span>`
    + `</div><script>${script}</script>`;
}

/**
 * The serve-time AI-disclosure marks for an HTML document: a `<meta name="ai-disclosure">`, a
 * `<link rel="ai-provenance">` to the addressable record, a schema.org JSON-LD block, and — for a
 * RUNNABLE app document — the visible label a person sees; plus `w3c`, the value that goes on the
 * document element (apply it with markDocumentElement).
 *
 * NEVER PUT THESE IN ON THE WAY IN. They belong on what a visitor receives; the stored bundle stays
 * the author's bytes.
 *
 * Nothing here executes beyond the label's own three lines, and none of it needs a CSP allowance a
 * static app document does not already have: the inline `<style>` rides the same
 * `style-src 'unsafe-inline'` the attribution badge already needs, and the icon rides `img-src *`.
 *
 * `visible` is opt-in per caller rather than automatic, because the machine marks belong on every
 * HTML face while the chip belongs only where a person is looking at a rendered app. The raw
 * (attachment) download gets neither — it stays byte-for-byte, which is what keeps the content hash
 * in the record verifiable.
 */
export function aiDisclosureParts(
  p: ServedProvenance,
  visible?: { config: AimeatConfig; locale: Locale; reviewedBy?: string; publiclyReadable?: boolean },
): { block: string; w3c: string | undefined } {
  const w3c = toW3cHtml(p.record);
  // The machine-readable marks come from the record AS MINTED. Only the chip a person sees is
  // re-decided when a reviewer has been declared — see reviewedForLabel().
  const forLabel = visible?.reviewedBy
    ? reviewedForLabel(p, visible.config, visible.reviewedBy, visible.publiclyReadable !== false)
    : p;
  const block =
    (w3c ? `<meta name="ai-disclosure" content="${esc(w3c)}">` : '')
    + `<link rel="ai-provenance" href="${esc(p.recordUrl)}">`
    + `<script type="application/ld+json" ${PROVENANCE_HTML_MARK}>${jsonLd(p, visible?.reviewedBy, visible?.locale)}</script>`
    + (visible ? visibleLabelMarkup(forLabel, visible.config, visible.locale) : '');
  return { block, w3c };
}

/**
 * The record with its visible-label decision made again, this time with editorial responsibility
 * declared: a natural person has reviewed this app and answers for it (manifest.authorship).
 *
 * That is rule 5 of disclosureFor() — the Art. 50(4) exemption for content under human review or
 * editorial control — and it lifts the CONTENT label only. Two reasons are left exactly as minted
 * because the declaration does not reach them: a person conversing with a model is told so
 * whoever reviewed the app (Art. 50(1)), and a deep fake is labelled regardless of review (the
 * exemption belongs to the text limb). Under the node's `strict` policy the light "a model was
 * involved" label still shows, with the neutral wording — buildDisclosure() chooses it from the
 * `policy` reason, and the chip then names the reviewer ("AI-drafted, reviewed by {name}") with
 * the EU icon for AI involvement rather than the "AI generated" lockup, because that is the
 * statement the reviewer made. Only the chip's copy of the record changes.
 *
 * `publiclyReadable` is the app AS SERVED NOW: an access code or a park since publication makes it
 * private, and the strict policy labels only what anyone can read. Until 2026-09-26 this function
 * assumed every app was public.
 */
function reviewedForLabel(
  p: ServedProvenance, config: AimeatConfig, reviewer: string, publiclyReadable: boolean,
): ServedProvenance {
  const reason = p.record.disclosure?.reason;
  if (!p.record.disclosure?.required) return p;
  // Synthetic media is labelled whatever the reason recorded (deep fake or precautionary).
  if (reason === 'art50_1_interaction' || reason === 'art50_4_deepfake' || isSyntheticMedia(p.record.mediaKind)) return p;
  const ctx: SurfaceContext = {
    visibility: publiclyReadable ? 'public' : 'private',
    humanAudience: true, editorialResponsibility: true,
  };
  const disclosure = buildDisclosure(p.record, ctx, config.aiLabelPublic, { reviewer });
  const humanInvolvement = p.record.humanInvolvement === 'full-human' ? 'full-human' : 'editorial-control';
  return { ...p, record: { ...p.record, humanInvolvement, disclosure } };
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
export function provenanceMarkdownNote(p: ServedProvenance | undefined, locale: Locale = 'en'): string {
  if (!p) return '';
  const t = createT(locale);
  const r = p.record;
  const label = r.disclosure?.short?.[locale] ?? r.disclosure?.short?.en ?? r.level;
  const model = r.generator?.model ? ` (${r.generator.model})` : '';
  const reviewed = r.humanInvolvement === 'editorial-control' || r.humanInvolvement === 'full-human'
    ? t('aiLabel.note.reviewed')
    : t('aiLabel.note.unreviewed');
  return `> **${t('aiLabel.note.heading')}** — ${label}${model}, ${reviewed}, ${r.generatedAt} · ${t('aiLabel.note.record')}: ${p.recordUrl}`;
}
