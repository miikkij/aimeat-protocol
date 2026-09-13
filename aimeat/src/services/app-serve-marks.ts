/**
 * @file src/services/app-serve-marks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE one pass that adds the node's marks to a published app document on its way out.
 *
 *   WHY IT EXISTS. Four separate injectors used to run in sequence — the aimeat.io attribution
 *   badge, the AI-disclosure marks, the agent-discovery block, the head metadata. Each decoded the
 *   same buffer, each re-tested whether the payload was a document, each carried its own idempotency
 *   check, and three of them carried their own copy of the one rule that has actually broken an app:
 *   inject before the LAST `</body>`, never the first, because app JavaScript routinely contains the
 *   literal string (the fatalii drum-slicer incident, 2026-07-16). Four copies of a rule is four
 *   chances to add a fifth that forgets it — and the app-platform SDK work in TARGET-058 Phase 5 is
 *   exactly the kind of change that would have.
 *
 *   So the modules under utils/ (and ai-provenance-marks.ts) now supply MARKUP, and this file owns
 *   the three decisions they were each making separately:
 *     1. is this payload a document we may touch at all
 *     2. has it already been marked (a served copy can be re-served)
 *     3. where the markup goes
 *
 *   BYTE-IDENTICAL, AND HELD THAT WAY. The order below is the order the four injectors ran in, and
 *   test/unit/app-serve-marks.test.ts replays a corpus of trap-shaped documents against goldens
 *   captured from the pre-consolidation code (test/fixtures/serve-marks-golden.json). Two orderings
 *   in here are load-bearing rather than incidental, and both are the previous behaviour:
 *     - the document-element `ai-disclosure` attribute is applied BEFORE the head metadata can
 *       create an `<html>` element, so a head-less app document keeps ending up with an unmarked
 *       `<html lang="en">` exactly as it did before;
 *     - the head-gap detection runs against the text WITH the body marks already in it, so an
 *       AI-disclosure JSON-LD block legitimately suppresses the SoftwareApplication one.
 *
 *   SERVE TIME ONLY. Nothing here is ever written back to storage. `app.data` is what the author
 *   uploaded, which is what keeps the content hash in a provenance record meaningful, and this
 *   codebase has published from a served copy before.
 * @structure
 *   - ServeMarksSpec — which marks the calling route wants
 *   - applyServeMarks(bytes, spec) — the single pass, returns a Buffer
 * @usage
 *   const body = applyServeMarks(app.data, {
 *     badge: true, provenance: prov, visibleLabel: { config, locale }, discovery, headMeta });
 * @version-history
 *   v1.4.0 — 2026-09-13 — The `#aimeat-app-ref` identity block is written at the start of the head
 *     (headStart(): past the doctype and the `<html>` and `<head>` opening tags, never into
 *     content) instead of at the end of the body, so an app's inline script can read it at parse
 *     time; the rest of the discovery block stays in the body. Its JSON is script-safe rather than
 *     HTML-escaped. The nine goldens that carry a discovery block were re-captured.
 *   v1.3.0 — 2026-09-11 — `spec.isDocument`: a caller that has already checked the media type may
 *     say so, instead of this pass sniffing for a closing tag the author never had to write.
 *     Three live apps open with a comment or a `<meta charset>` and close nothing, so they were
 *     served with no badge, no AI-disclosure mark and no discovery block at all. Default is the
 *     sniff, unchanged, and every golden case leaves the flag unset.
 *   v1.2.1 — 2026-08-31 — The head injection finds `<body …>` with utils/html-inject's findOpenTag
 *     instead of `/<body[^>]*>/i`, which cost quadratic time on a document made of `<body` repeats
 *     (CodeQL js/polynomial-redos 1579/1580). Same insertion point, so the goldens are unchanged.
 *   v1.2.0 — 2026-08-29 — `reviewedBy`: the named reviewer goes into the head as two meta tags
 *     and re-decides the visible label with editorial responsibility declared; `badge` is now
 *     the owner's switch at every call site (services/app-marks.ts). Existing goldens unchanged:
 *     a spec without the new member produces the same bytes.
 *   v1.1.0 — 2026-08-02 — The reserved-strip contract: whenever visible chrome is served (badge or
 *     AI label), also declare `--aimeat-chrome-bottom` (utils/app-chrome-reserve.ts) so apps can
 *     lift their own fixed bottom UI clear of the marks instead of being covered by them. Goldens
 *     re-captured — this is the first INTENTIONAL output change since the consolidation.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a: the four serve-time injectors become one pass.
 */
import type { AimeatConfig } from '../config.js';
import type { Locale } from '../i18n.js';
import { findOpenTag, injectBeforeClosingTag } from '../utils/html-inject.js';
import { BADGE_MARK, badgeSnippet } from '../utils/app-badge.js';
import { RESERVE_MARK, reserveSnippet } from '../utils/app-chrome-reserve.js';
import {
  APP_REF_MARK, DISCOVERY_MARK, agentDiscoverySnippet, appRefSnippet, type AppDiscoverySpec,
} from '../utils/app-agent-discovery.js';
import { applyAppHeadMeta, type AppHeadSpec } from '../utils/app-head-meta.js';
import {
  PROVENANCE_HTML_MARK, aiDisclosureParts, markDocumentElement, type ServedProvenance,
} from './ai-provenance-marks.js';

/** The attribute that names the reviewer tag, and the idempotency marker for it. */
export const REVIEWED_MARK = 'name="aimeat-reviewed-by"';

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Before `</head>` when there is one; else before the body opens; else at the front. */
function injectIntoHead(html: string, snippet: string): string {
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, (m) => snippet + m);
  const body = findOpenTag(html, 'body');
  if (body) return html.slice(0, body.end) + snippet + html.slice(body.end);
  return snippet + html;
}

/**
 * Where the head's first child goes: past the document's prolog and nothing else. That is leading
 * whitespace and comments, then a doctype, then the `<html>` and `<head>` opening tags, each only
 * when it is the next thing in the text. Every element the author wrote comes after this point, a
 * script in the head included, and the scan never reads into content, so a `<head>` written inside
 * an app's JavaScript cannot be taken for the real one. A document with none of the prolog gets
 * the snippet at its front, where the parser opens the head for it.
 */
function headStart(html: string): number {
  const lower = html.toLowerCase();
  let at = 0;
  const skipBlankAndComments = (): void => {
    for (;;) {
      while (at < html.length && /\s/.test(html[at])) at++;
      if (!lower.startsWith('<!--', at)) return;
      const end = lower.indexOf('-->', at + 4);
      if (end < 0) return;
      at = end + 3;
    }
  };
  /** One past the `>` of a `<name …>` opening tag starting exactly at `at`, or -1. */
  const openTagEnd = (name: string): number => {
    const needle = `<${name}`;
    if (!lower.startsWith(needle, at)) return -1;
    const after = lower[at + needle.length];
    if (after === undefined || (after !== '>' && after !== '/' && !/\s/.test(after))) return -1;
    const gt = lower.indexOf('>', at);
    return gt < 0 ? -1 : gt + 1;
  };
  skipBlankAndComments();
  const doctype = openTagEnd('!doctype');
  if (doctype > 0) { at = doctype; skipBlankAndComments(); }
  const htmlTag = openTagEnd('html');
  if (htmlTag > 0) { at = htmlTag; skipBlankAndComments(); }
  const headTag = openTagEnd('head');
  if (headTag > 0) at = headTag;
  return at;
}

/** Which marks this response carries. Every member is optional; omitting one leaves it off. */
export interface ServeMarksSpec {
  /** The permanent aimeat.io attribution pill. */
  badge?: boolean;
  /** The provenance record attached to these bytes, when one exists. */
  provenance?: ServedProvenance;
  /**
   * Also render the VISIBLE AI label. Opt-in per caller: the machine-readable marks belong on every
   * HTML face, the chip belongs only where a person is looking at a running app.
   */
  visibleLabel?: { config: AimeatConfig; locale: Locale };
  /**
   * The natural person who declared they reviewed this app and answer for it
   * (manifest.authorship, services/app-marks.ts). Served as `<meta name="author">` and
   * `<meta name="aimeat-reviewed-by">` in the head, and it re-decides the VISIBLE label with
   * editorial responsibility declared — which lifts the Art. 50(4) content label and nothing
   * else. The machine-readable marks (the attribute, the JSON-LD, the record link) are untouched:
   * synthesis may have happened, and the record keeps saying so.
   */
  reviewedBy?: string;
  /** The static agent-discovery block, for an app served on its own origin. */
  discovery?: AppDiscoverySpec;
  /** The `<head>` metadata the app almost certainly has none of. */
  headMeta?: AppHeadSpec;
  /**
   * The CALLER states that these bytes are an HTML document, overruling the sniff below.
   *
   * The sniff looks for a closing `</body>` or `</html>`, and three published apps on aimeat.io
   * have neither: noste, taivas and laake open with a comment or a `<meta charset>` and simply
   * stop, which every browser parses as a document and this pass declined as a fragment. They were
   * served with no attribution badge, no AI-disclosure mark and no discovery block — 235 kB of
   * application with eleven characters of text in it, on an origin a search engine had indexed.
   *
   * It stays a sniff by default, because the callers that hand this function JSON, SVG or a raw
   * download cannot all vouch for their payload and a mark spliced into JSON corrupts it. The two
   * that CAN vouch already tested the media type before calling, and say so here.
   */
  isDocument?: boolean;
}

/**
 * Add the requested marks and return the bytes to send.
 *
 * A payload that is not an HTML document comes back unchanged apart from the head-metadata pass,
 * which has its own (deliberately wider) notion of a document because a single-file app is often a
 * bare fragment with no `<head>` at all.
 */
export function applyServeMarks(data: Buffer | Uint8Array | string, spec: ServeMarksSpec): Buffer {
  const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');

  // Only touch real HTML documents; never corrupt JSON/SVG/other inline payloads. Tested ONCE.
  // A caller that has already checked the media type may say so instead (spec.isDocument): the
  // sniff reads closing tags, and a single-file app is under no obligation to write any.
  const isDocument = spec.isDocument ?? (/<\/body\s*>/i.test(text) || /<\/html\s*>/i.test(text));

  let out = text;
  if (isDocument) {
    // Idempotency is decided against the ORIGINAL text for every mark, which is what the four
    // injectors did in effect: none of them emits another's marker, so a chain of `.includes`
    // checks over progressively longer strings gave the same answers.
    const parts: string[] = [];
    // The reserved-strip contract rides along whenever VISIBLE chrome does (the badge or the AI
    // label): it declares `--aimeat-chrome-bottom` so the app can lift its own bottom UI clear of
    // the marks. Declaration only — an app that ignores it renders exactly as before.
    const visibleChrome = spec.badge || (spec.provenance && spec.visibleLabel);
    if (visibleChrome && !text.includes(RESERVE_MARK)) parts.push(reserveSnippet());
    if (spec.badge && !text.includes(BADGE_MARK)) parts.push(badgeSnippet());
    if (spec.provenance && !text.includes(PROVENANCE_HTML_MARK)) {
      const { block, w3c } = aiDisclosureParts(spec.provenance,
        spec.visibleLabel ? { ...spec.visibleLabel, reviewedBy: spec.reviewedBy } : undefined);
      parts.push(block);
      // Before the head pass — see the file comment; this is what keeps a head-less document's
      // generated `<html>` element unmarked, as it has always been.
      if (w3c) out = markDocumentElement(out, w3c);
    }
    if (spec.discovery && !text.includes(DISCOVERY_MARK)) parts.push(agentDiscoverySnippet(spec.discovery));
    // ONE splice, through the one helper that knows about the last-`</body>` rule.
    if (parts.length) out = injectBeforeClosingTag(out, parts.join(''));
    // The app's own identity block goes to the START of the head instead, because an app reads it
    // from its first line of script (AIMEAT.atelier.appRef(), the mosaic's own boot). At the end of
    // the body it arrived after every inline script and read as null at parse time.
    if (spec.discovery && !text.includes(APP_REF_MARK)) {
      const at = headStart(out);
      out = out.slice(0, at) + appRefSnippet(spec.discovery) + out.slice(at);
    }
    // The reviewer's name, machine-readable, in the head. Before the head pass so a head-less
    // document gets it inside the `<head>` that pass opens, and so that pass's own "already has
    // an author" checks see it. Two tags: the standard one every crawler reads, and the one that
    // says what it means here — a person reviewed this and answers for it.
    if (spec.reviewedBy && !text.includes(REVIEWED_MARK)) {
      const name = escAttr(spec.reviewedBy);
      out = injectIntoHead(out,
        `<meta name="author" content="${name}"><meta ${REVIEWED_MARK} content="${name}">`);
    }
  }

  if (spec.headMeta) out = applyAppHeadMeta(out, spec.headMeta);
  return Buffer.from(out, 'utf-8');
}
