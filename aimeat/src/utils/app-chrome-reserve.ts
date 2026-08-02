/**
 * @file app-chrome-reserve.ts
 * @description Publish the height of the node's bottom chrome strip to a served app document as a
 *   CSS custom property, so the app can keep its own bottom UI out from under the node's marks.
 *
 *   THE PROBLEM THIS SOLVES. Two fixed marks ride every served app: the aimeat.io attribution badge
 *   (bottom-right, utils/app-badge.ts) and the visible AI label (bottom-left, top layer,
 *   services/ai-provenance-marks.ts). Both are deliberate and both stay — the badge is the permanent
 *   attribution, the label is an Art. 50 compliance mark. But an app with its own fixed bottom bar
 *   (a game HUD, a stats footer, a Move button) collides with them, and the marks win the paint, so
 *   the APP is what gets covered. The fix is not to move the marks; it is to tell the app how much
 *   bottom space the node's chrome occupies, so the app lifts its own bottom UI clear.
 *
 *   THE CONTRACT. The node owns the geometry: this snippet sets `--aimeat-chrome-bottom` on `:root`
 *   (56px wide viewports, 96px at <=640px where the AI label sits on the row above the badge). An
 *   app offsets its fixed bottom elements by `var(--aimeat-chrome-bottom, <fallback>)` and pads its
 *   scroll container by the same. If the marks' geometry ever changes, ONLY the values here change
 *   and every app that follows the contract adapts on the next serve — that is the point of serving
 *   the number instead of hardcoding it in a hundred apps. The values MUST therefore keep covering
 *   the real footprint of both marks; measure before changing either.
 *
 *   Same mechanics as the marks themselves: pure static markup, a scoped `<style>` riding the
 *   `style-src 'unsafe-inline'` the inline marks already need, idempotent via RESERVE_MARK, injected
 *   by the one pass in services/app-serve-marks.ts. It declares a variable and nothing else — it
 *   never restyles the app, so an app that ignores it is exactly as well off as before.
 * @structure RESERVE_MARK — idempotency marker; reserveSnippet() — the markup.
 * @usage import { reserveSnippet } from '../utils/app-chrome-reserve.js';  // via applyServeMarks()
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial: the reserved bottom strip contract (--aimeat-chrome-bottom).
 */

/** Present in an already-marked document. Makes a re-serve idempotent. */
export const RESERVE_MARK = 'id="aimeat-chrome-reserve"';

/**
 * Footprint of the node's bottom chrome, measured from the marks' own CSS:
 * - wide: both marks anchor at bottom:12px; the taller (the AI label chip, one wrapped row worst
 *   case) tops out under 56px.
 * - <=640px: the AI label sits at bottom:58px above the collapsed badge, chip height ~32px → 90px;
 *   96px covers it with margin.
 */
const WIDE_PX = 56;
const NARROW_PX = 96;

/** The `:root` variable declaration an app reads to keep its bottom UI clear of the node's marks. */
export function reserveSnippet(): string {
    return `<style ${RESERVE_MARK}>`
        + `:root{--aimeat-chrome-bottom:${WIDE_PX}px}`
        + `@media (max-width:640px){:root{--aimeat-chrome-bottom:${NARROW_PX}px}}`
        + '</style>';
}
