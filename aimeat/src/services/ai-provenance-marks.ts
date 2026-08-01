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
 *   - envelopeMeta(p)                — the `meta.provenance` value; the single envelope carrier
 *   - setProvenanceHeaders(res, p)   — `AI-Disclosure` + `Link: rel="ai-provenance"`
 *   - injectAiDisclosure(bytes, p)   — serve-time HTML marks (meta, attribute, JSON-LD)
 *   - provenanceFrontmatter(p)       — YAML lines for a markdown face
 *   - provenanceMarkdownNote(p)      — ONE human-readable line for the body
 * @usage
 *   const prov = await loadServedProvenance(storage, config, record.aiProvenanceId, { full: isOwner });
 *   setProvenanceHeaders(res, prov);
 *   res.json(success(config.nodeId, data, hints, envelopeMeta(prov)));
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 2.
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import type { AiProvenance } from '../models/ai-provenance-schemas.js';
import { toIetfHeader, toW3cHtml, toIptc } from './ai-provenance-adapters.js';
import { projectForDetail } from './ai-provenance.js';
import { injectBeforeClosingTag } from '../utils/html-inject.js';

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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
 * Serve-time AI-disclosure marks for an HTML document: the `ai-disclosure` attribute on `<html>`, a
 * `<meta name="ai-disclosure">`, a `<link rel="ai-provenance">` to the addressable record, and a
 * schema.org JSON-LD block.
 *
 * NEVER CALL THIS ON THE WAY IN. The output is what a visitor receives; the stored bundle stays the
 * author's bytes. Returns the input unchanged for a non-HTML payload, for unstated provenance, and
 * for a document that already carries the block (idempotent — a served document can be re-served
 * through the same path).
 *
 * Nothing here executes, so it needs no CSP allowance a static document does not already have.
 */
export function injectAiDisclosure(
  data: Buffer | Uint8Array | string, p: ServedProvenance | undefined,
): Buffer {
  const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  if (!p) return Buffer.from(text, 'utf-8');
  if (!/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) return Buffer.from(text, 'utf-8');
  if (text.includes(HTML_MARK)) return Buffer.from(text, 'utf-8');

  const w3c = toW3cHtml(p.record);
  const block =
    (w3c ? `<meta name="ai-disclosure" content="${esc(w3c)}">` : '')
    + `<link rel="ai-provenance" href="${esc(p.recordUrl)}">`
    + `<script type="application/ld+json" ${HTML_MARK}>${jsonLd(p)}</script>`;

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
