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
 *   v1.1.0 — 2026-08-02 — The reserved-strip contract: whenever visible chrome is served (badge or
 *     AI label), also declare `--aimeat-chrome-bottom` (utils/app-chrome-reserve.ts) so apps can
 *     lift their own fixed bottom UI clear of the marks instead of being covered by them. Goldens
 *     re-captured — this is the first INTENTIONAL output change since the consolidation.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 5 step 0a: the four serve-time injectors become one pass.
 */
import type { AimeatConfig } from '../config.js';
import type { Locale } from '../i18n.js';
import { injectBeforeClosingTag } from '../utils/html-inject.js';
import { BADGE_MARK, badgeSnippet } from '../utils/app-badge.js';
import { RESERVE_MARK, reserveSnippet } from '../utils/app-chrome-reserve.js';
import { DISCOVERY_MARK, agentDiscoverySnippet, type AppDiscoverySpec } from '../utils/app-agent-discovery.js';
import { applyAppHeadMeta, type AppHeadSpec } from '../utils/app-head-meta.js';
import {
  PROVENANCE_HTML_MARK, aiDisclosureParts, markDocumentElement, type ServedProvenance,
} from './ai-provenance-marks.js';

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
  /** The static agent-discovery block, for an app served on its own origin. */
  discovery?: AppDiscoverySpec;
  /** The `<head>` metadata the app almost certainly has none of. */
  headMeta?: AppHeadSpec;
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
  const isDocument = /<\/body\s*>/i.test(text) || /<\/html\s*>/i.test(text);

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
      const { block, w3c } = aiDisclosureParts(spec.provenance, spec.visibleLabel);
      parts.push(block);
      // Before the head pass — see the file comment; this is what keeps a head-less document's
      // generated `<html>` element unmarked, as it has always been.
      if (w3c) out = markDocumentElement(out, w3c);
    }
    if (spec.discovery && !text.includes(DISCOVERY_MARK)) parts.push(agentDiscoverySnippet(spec.discovery));
    // ONE splice, through the one helper that knows about the last-`</body>` rule.
    if (parts.length) out = injectBeforeClosingTag(out, parts.join(''));
  }

  if (spec.headMeta) out = applyAppHeadMeta(out, spec.headMeta);
  return Buffer.from(out, 'utf-8');
}
