/**
 * @file src/services/app-serve-marks-strip.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Take the node's own serve marks back out of an app document on its way IN, so a
 *   copy of an app as the node served it is stored as the source the owner wrote.
 *
 *   THE DECISION (the developer's, 2026-09-13). When an app is published with HTML that carries
 *   the marks services/app-serve-marks.ts adds when it SERVES an app, the publish removes exactly
 *   those node-written blocks before storing, and the response names what was removed. It is not
 *   refused. The node adds its marks again every time it serves the app.
 *
 *   WHY A SERVED COPY CANNOT SIMPLY BE STORED. The serve pass skips a mark that is already in the
 *   document, which is what makes a re-serve idempotent, and which is also why a stored copy went
 *   wrong in silence: a baked-in badge ignored the owner switching it off, a baked-in AI-disclosure
 *   block described a version that no longer existed (and its visible label made the posture check
 *   believe the app disclosed its AI), and a baked-in `#aimeat-app-ref` made a copy published by one
 *   owner identify itself as the other owner's app. The content hash in the provenance record was
 *   taken over bytes nobody had written.
 *
 *   WHAT COUNTS AS A MARK. Only markup the serve pass itself writes, recognised by the exact opening
 *   tag it emits (an id, or for the reviewer tags the node's own meta name), and only in markup: an
 *   occurrence inside a script, a style, a comment, a title or a textarea is text the app wrote and
 *   is never touched. The companions a block writes without an id of their own (the meta and link
 *   before the AI-disclosure JSON-LD, the label's script, the two links before the discovery
 *   noscript, the WebMCP bridge after it, the author meta before the reviewer meta) are removed only
 *   when they sit directly against their marked block, character for character, which is where the
 *   pass puts them. An element whose closing tag never arrives is left alone. Copies served by every
 *   earlier version of the pass strip too: the first `<a>` badge, the two-value reserve declaration,
 *   and the identity block at the end of the body with HTML-escaped JSON (until 2026-09-13).
 *
 *   WHAT IS NOT A MARK, AND STAYS. The head metadata the app-origin serve fills in (description,
 *   og:*, canonical, manifest, theme-color, the install chip, the SoftwareApplication JSON-LD) is
 *   written with no marker of its own, and every one of those tags is one an author may write, so
 *   it cannot be told apart from the author's and is kept. Five in-place rewrites of the author's
 *   own tags cannot be undone either: the relaxed CSP meta, the robots meta, the `<title>` replaced
 *   by an owner's search title, the `lang` attribute, and an upper-case `<HTML>` tag name that
 *   markDocumentElement writes in lower case. Copy-protection watermarks are not marks
 *   in this sense at all: services/app-similarity.ts reads one in stored bytes as evidence of a copy.
 *
 *   BYTES, NOT TEXT. The document is read as latin1, one character per byte, so the bytes outside a
 *   removed block come back exactly as they arrived, whatever encoding the app used and whether or
 *   not it is valid UTF-8. Every marker is ASCII, so the search reads the same either way. A document
 *   with nothing to remove comes back as the same Buffer.
 * @structure
 *   - ServedMarkKind / ServedMarkRemoval / StrippedServedMarks: the contract
 *   - stripServedMarks(bytes): THE function every publish door reaches (services/app-publish.ts)
 *   - servedMarksNote(removed): the sentence a person or an agent reads
 *   - servedMarksResponse(result): the two response fields every door renders
 * @usage
 *   const { data, removed } = stripServedMarks(upload);
 *   res.json({ ...fields, ...servedMarksResponse(out) });
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial: the developer's decision that a served copy is stripped at
 *     publish rather than warned about (it replaces checkServedCopy in app-artifact-lint.ts).
 */
import { BADGE_MARK } from '../utils/app-badge.js';
import { RESERVE_MARK } from '../utils/app-chrome-reserve.js';
import { APP_REF_MARK, DISCOVERY_MARK } from '../utils/app-agent-discovery.js';
import { PROVENANCE_HTML_MARK } from './ai-provenance-marks.js';
import { REVIEWED_MARK } from './app-serve-marks.js';

/** Which of the node's marks a removal was. One word per block the serve pass writes. */
export type ServedMarkKind =
  | 'chrome-reserve' | 'badge' | 'ai-disclosure' | 'ai-label' | 'agent-discovery' | 'app-ref' | 'reviewed-by';

/** One kind of mark taken out of an upload, with everything of that kind summed. */
export interface ServedMarkRemoval {
  mark: ServedMarkKind;
  /** The exact marker the block was recognised by, as it appears in the served document. */
  marker: string;
  /** How many bytes of the upload this mark accounted for. */
  bytes: number;
}

export interface StrippedServedMarks {
  /** The document without the marks: the upload itself when there was nothing to remove. */
  data: Buffer;
  /** In a fixed order, one entry per kind that was present. Empty when nothing was removed. */
  removed: ServedMarkRemoval[];
}

// ── The exact markup the serve pass writes ─────────────────────────────────────────────────────

const RESERVE_OPEN = `<style ${RESERVE_MARK}>`;
const BADGE_OPEN = `<div ${BADGE_MARK}>`;
/**
 * The first badge, 2026-06-24 to 2026-07-16: one `<a>` with inline styles. Matched on the whole
 * opening run it always had, so an app's own link that happens to carry the id is not taken for it.
 */
const BADGE_V1_OPEN = `<a ${BADGE_MARK} href="https://aimeat.io/" target="_blank" rel="noopener noreferrer" aria-label="`;
const PROVENANCE_OPEN = `<script type="application/ld+json" ${PROVENANCE_HTML_MARK}>`;
const PROVENANCE_LINK_OPEN = '<link rel="ai-provenance" href="';
const DISCLOSURE_META_OPEN = '<meta name="ai-disclosure" content="';
/**
 * The visible label's id is private to ai-provenance-marks.ts, so it is spelled here. If it ever
 * changes there, the round trip in test/unit/app-serve-marks-strip.test.ts goes red.
 */
const LABEL_OPEN = '<div id="aimeat-ai-label" role="group" aria-label="';
const LABEL_SCRIPT_OPEN = '<script>(function(){var e=document.getElementById("aimeat-ai-label");';
const DISCOVERY_LINKS = '<link rel="mcp-server" href="/.well-known/mcp.json">'
  + '<link rel="alternate" type="text/markdown" href="?format=md" title="Agent-facing description">';
const DISCOVERY_OPEN = `<noscript ${DISCOVERY_MARK}>`;
const WEBMCP_BRIDGE = /<script src="\/v1\/libs\/aimeat-webmcp\.js\?expose=app" data-owner="[^"<>]*" data-app="[^"<>]*" defer><\/script>/y;
const APP_REF_OPEN = `<script type="application/json" ${APP_REF_MARK}>`;
const REVIEWED_META = new RegExp(`<meta ${REVIEWED_MARK} content="([^"<>]*)">`, 'y');
const REVIEWED_OPEN = `<meta ${REVIEWED_MARK} content="`;

/** The order removals are reported in, so one upload always reads the same way. */
const ORDER: ReadonlyArray<{ mark: ServedMarkKind; marker: string; words: string }> = [
  { mark: 'badge', marker: BADGE_MARK, words: 'the aimeat.io attribution badge' },
  { mark: 'chrome-reserve', marker: RESERVE_MARK, words: 'the declaration of the bottom strip the node\'s chrome takes' },
  { mark: 'ai-disclosure', marker: PROVENANCE_HTML_MARK, words: 'the AI-disclosure marks (meta, record link, JSON-LD and the attribute on <html>)' },
  { mark: 'ai-label', marker: 'id="aimeat-ai-label"', words: 'the visible AI label' },
  { mark: 'agent-discovery', marker: DISCOVERY_MARK, words: 'the agent-discovery block' },
  { mark: 'app-ref', marker: APP_REF_MARK, words: 'the app identity block (#aimeat-app-ref)' },
  { mark: 'reviewed-by', marker: REVIEWED_MARK, words: 'the reviewer tags' },
];

/** Where markDocumentElement looks for the `<html>` tag, in the document it marks. */
const DOCUMENT_ELEMENT_WINDOW = 512;

/** A served copy re-served by an older node can carry two generations; more than this is not a copy. */
const MAX_PASSES = 4;

/**
 * Elements whose content the parser reads as text rather than markup. A marker inside one of them
 * is something the app wrote (a template in a script, a commented-out block), never a mark.
 */
const RAW_TEXT_ELEMENTS = ['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'];

interface Cut { start: number; end: number; mark: ServedMarkKind }

/**
 * THE strip. Every door that stores app HTML reaches this through services/app-publish.ts.
 *
 * Idempotent: the output of one call strips to itself. The loop is what guarantees it for a
 * document built so that removing one block joins two halves of another marker; a real served copy
 * is done in one pass and confirmed by the second.
 */
export function stripServedMarks(input: Buffer | Uint8Array): StrippedServedMarks {
  const original = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let text = original.toString('latin1');
  const bytes = new Map<ServedMarkKind, number>();

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const cuts = findCuts(text);
    if (cuts.length === 0) break;
    let out = '';
    let at = 0;
    for (const cut of cuts) {
      out += text.slice(at, cut.start);
      at = cut.end;
      bytes.set(cut.mark, (bytes.get(cut.mark) ?? 0) + (cut.end - cut.start));
    }
    text = out + text.slice(at);
  }

  if (bytes.size === 0) return { data: original, removed: [] };
  const removed = ORDER
    .filter(o => bytes.has(o.mark))
    .map(o => ({ mark: o.mark, marker: o.marker, bytes: bytes.get(o.mark) as number }));
  return { data: Buffer.from(text, 'latin1'), removed };
}

/** Every mark in one pass over the text, sorted and with no overlaps. */
function findCuts(text: string): Cut[] {
  const raw = rawTextRanges(text);
  const inRaw = (at: number): boolean => {
    // Binary search: the ranges are sorted and disjoint.
    let lo = 0;
    let hi = raw.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = raw[mid] as [number, number];
      if (at < r[0]) hi = mid - 1;
      else if (at >= r[1]) lo = mid + 1;
      else return true;
    }
    return false;
  };
  /** Each start of `open` that sits in markup rather than inside an element's text. */
  const anchors = (open: string): number[] => {
    const found: number[] = [];
    for (let at = text.indexOf(open); at !== -1; at = text.indexOf(open, at + open.length)) {
      if (!inRaw(at)) found.push(at);
    }
    return found;
  };
  /** One past the first `close` at or after `from` that sits in markup, or -1. */
  const endOf = (from: number, close: string): number => {
    for (let at = text.indexOf(close, from); at !== -1; at = text.indexOf(close, at + close.length)) {
      if (!inRaw(at)) return at + close.length;
    }
    return -1;
  };
  /** One past `</script>` for a script element whose opening tag ends at `from`. */
  const scriptEnd = (from: number): number => {
    const at = text.indexOf('</script>', from);
    return at === -1 ? -1 : at + '</script>'.length;
  };

  const cuts: Cut[] = [];
  const cut = (mark: ServedMarkKind, start: number, end: number): void => { cuts.push({ mark, start, end }); };

  // The reserve declaration, both generations.
  for (const at of anchors(RESERVE_OPEN)) {
    const end = endOf(at + RESERVE_OPEN.length, '</style>');
    if (end > 0) cut('chrome-reserve', at, end);
  }

  // The badge: a `<div>` since 2026-07-16, an `<a>` before. Neither ever held a nested element of
  // its own kind, so the first closing tag in markup is its end.
  for (const at of anchors(BADGE_OPEN)) {
    const end = endOf(at + BADGE_OPEN.length, '</div>');
    if (end > 0) cut('badge', at, end);
  }
  for (const at of anchors(BADGE_V1_OPEN)) {
    const end = endOf(at + BADGE_V1_OPEN.length, '</a>');
    if (end > 0) cut('badge', at, end);
  }

  // The AI-disclosure marks: the JSON-LD carries the id, and the record link and the meta sit
  // directly before it. The meta's value is also what markDocumentElement put on `<html>`.
  const disclosureValues = new Set<string>();
  for (const at of anchors(PROVENANCE_OPEN)) {
    const end = scriptEnd(at + PROVENANCE_OPEN.length);
    if (end < 0) continue;
    let start = at;
    const link = endsWithTag(text, start, PROVENANCE_LINK_OPEN, /^<link rel="ai-provenance" href="[^"<>]*">$/);
    if (link >= 0) {
      start = link;
      const meta = endsWithTag(text, start, DISCLOSURE_META_OPEN, /^<meta name="ai-disclosure" content="([^"<>]*)">$/);
      if (meta >= 0) {
        disclosureValues.add(text.slice(meta + DISCLOSURE_META_OPEN.length, start - 2));
        start = meta;
      }
    }
    cut('ai-disclosure', start, end);
  }
  if (disclosureValues.size > 0) {
    const attr = documentElementDisclosure(text, disclosureValues);
    if (attr) cut('ai-disclosure', attr.start, attr.end);
  }

  // The visible label and its three-line script, which follows it directly.
  for (const at of anchors(LABEL_OPEN)) {
    let end = endOf(at + LABEL_OPEN.length, '</div>');
    if (end < 0) continue;
    if (text.startsWith(LABEL_SCRIPT_OPEN, end)) {
      const scriptClose = scriptEnd(end + LABEL_SCRIPT_OPEN.length);
      if (scriptClose > 0) end = scriptClose;
    }
    cut('ai-label', at, end);
  }

  // The agent-discovery block: two links, the noscript, and the WebMCP bridge. Until 2026-09-13
  // the identity block sat between the noscript and the bridge; it is cut by its own rule below and
  // only stepped over here, so the bridge after it is still recognised as adjacent.
  for (const at of anchors(DISCOVERY_OPEN)) {
    const end = endOf(at + DISCOVERY_OPEN.length, '</noscript>');
    if (end < 0) continue;
    const start = precededBy(text, at, DISCOVERY_LINKS) ? at - DISCOVERY_LINKS.length : at;
    cut('agent-discovery', start, end);
    let next = end;
    if (text.startsWith(APP_REF_OPEN, next)) {
      const refEnd = scriptEnd(next + APP_REF_OPEN.length);
      if (refEnd > 0) next = refEnd;
    }
    WEBMCP_BRIDGE.lastIndex = next;
    const bridge = WEBMCP_BRIDGE.exec(text);
    if (bridge) cut('agent-discovery', next, next + bridge[0].length);
  }

  // The identity block, wherever it sits: the start of the head now, the end of the body before.
  for (const at of anchors(APP_REF_OPEN)) {
    const end = scriptEnd(at + APP_REF_OPEN.length);
    if (end > 0) cut('app-ref', at, end);
  }

  // The reviewer: `<meta name="author">` directly before `<meta name="aimeat-reviewed-by">`, both
  // carrying the same escaped name. The author meta alone is the author's.
  for (const at of anchors(REVIEWED_OPEN)) {
    REVIEWED_META.lastIndex = at;
    const m = REVIEWED_META.exec(text);
    if (!m) continue;
    const author = `<meta name="author" content="${m[1]}">`;
    const start = precededBy(text, at, author) ? at - author.length : at;
    cut('reviewed-by', start, at + m[0].length);
  }

  // Sorted, and an overlap keeps the earlier cut: no rule above can produce one from a real serve,
  // and a document built to make two overlap must not make the output depend on rule order.
  cuts.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Cut[] = [];
  for (const c of cuts) {
    const last = kept[kept.length - 1];
    if (last && c.start < last.end) continue;
    kept.push(c);
  }
  return kept;
}

/** Whether `literal` ends exactly at `at`. startsWith clamps a negative position to 0, so it is guarded. */
function precededBy(text: string, at: number, literal: string): boolean {
  return at >= literal.length && text.startsWith(literal, at - literal.length);
}

/**
 * Where a tag opening with `open` ends exactly at `before`, validated against `shape`, or -1.
 * Found with lastIndexOf and checked on that one slice, so the cost does not grow with the document.
 */
function endsWithTag(text: string, before: number, open: string, shape: RegExp): number {
  const at = text.lastIndexOf(open, before - open.length);
  if (at < 0) return -1;
  return shape.test(text.slice(at, before)) ? at : -1;
}

/**
 * The ` ai-disclosure="…"` markDocumentElement appended to the `<html>` tag, when its value is one
 * the node's own meta carried in this same document. It is written as the tag's last attribute, on
 * the first `<html>` tag in the first 512 characters, so that is the only place it is looked for.
 * An author who wrote the attribute themselves with no node block beside it keeps it.
 *
 * One rewrite here is not undone: markDocumentElement writes the tag name in lower case, so an app
 * that wrote `<HTML …>` gets back `<html …>`.
 */
function documentElementDisclosure(text: string, values: ReadonlySet<string>): { start: number; end: number } | null {
  const lower = text.slice(0, DOCUMENT_ELEMENT_WINDOW).toLowerCase();
  for (let at = lower.indexOf('<html'); at !== -1; at = lower.indexOf('<html', at + 5)) {
    const after = lower[at + 5];
    if (after !== '>' && !(after !== undefined && /\s/.test(after))) continue;
    const gt = text.indexOf('>', at);
    if (gt < 0) return null;
    for (const value of values) {
      const suffix = ` ai-disclosure="${value}"`;
      if (text.startsWith(suffix, gt - suffix.length)) return { start: gt - suffix.length, end: gt };
    }
    return null;
  }
  return null;
}

/**
 * The content ranges of every raw-text element and comment, sorted and disjoint: `[start, end)`
 * from one past the opening tag's `>` to the closing tag. An element that never closes runs to the
 * end of the document, which is how a browser reads it too.
 */
function rawTextRanges(text: string): Array<[number, number]> {
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let at = lower.indexOf('<');
  while (at !== -1) {
    if (lower.startsWith('<!--', at)) {
      const close = lower.indexOf('-->', at + 4);
      const stop = close === -1 ? text.length : close;
      ranges.push([at + 4, stop]);
      at = close === -1 ? -1 : lower.indexOf('<', close + 3);
      continue;
    }
    const name = RAW_TEXT_ELEMENTS.find(n => lower.startsWith(n, at + 1) && isTagNameEnd(lower[at + 1 + n.length]));
    if (name) {
      const gt = lower.indexOf('>', at);
      if (gt === -1) break;
      const close = lower.indexOf(`</${name}`, gt + 1);
      const stop = close === -1 ? text.length : close;
      ranges.push([gt + 1, stop]);
      at = close === -1 ? -1 : lower.indexOf('<', close + 2);
      continue;
    }
    at = lower.indexOf('<', at + 1);
  }
  return ranges;
}

function isTagNameEnd(c: string | undefined): boolean {
  return c === undefined || c === '>' || c === '/' || /\s/.test(c);
}

// ── What the doors say ─────────────────────────────────────────────────────────────────────────

/** One sentence naming what came out and what that means for the stored app. */
export function servedMarksNote(removed: readonly ServedMarkRemoval[]): string {
  const words = ORDER.filter(o => removed.some(r => r.mark === o.mark)).map(o => o.words);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] ?? '');
  return `This file was a copy of the app as the node serves it: it carried ${list}, which the node `
    + 'adds on the way out. Those blocks were removed before storing and nothing else was, so the '
    + 'stored version is the source, and every serve adds the current marks once. Next time, edit '
    + 'from a draft (aimeat_app_draft_seed) or from the stored file at download_url.';
}

/**
 * The two fields every door puts in its response, or nothing when nothing was removed.
 *
 * Takes any result object rather than one type, because the publish result and the draft-slot
 * results reach the doors through different services, and one rendering keeps the wording and the
 * field names the same on every door that stores app HTML.
 */
export function servedMarksResponse(result: object): { served_marks_removed?: ServedMarkRemoval[]; served_marks_note?: string } {
  const removed: unknown = 'servedMarksRemoved' in result ? result.servedMarksRemoved : undefined;
  if (!Array.isArray(removed) || removed.length === 0) return {};
  const list = removed as ServedMarkRemoval[];
  return { served_marks_removed: list, served_marks_note: servedMarksNote(list) };
}
