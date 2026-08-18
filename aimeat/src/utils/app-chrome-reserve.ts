/**
 * @file app-chrome-reserve.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   (one 56px strip on every viewport — the marks share a single bottom row). An
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
 *   v1.1.0 — 2026-08-02 — One row everywhere: 56px on all viewports (was 96px on <=640px), since the
 *     AI label now collapses onto the same 34px row as the badge on narrow screens.
 *   v1.0.0 — 2026-08-02 — Initial: the reserved bottom strip contract (--aimeat-chrome-bottom).
 */

/** Present in an already-marked document. Makes a re-serve idempotent. */
export const RESERVE_MARK = 'id="aimeat-chrome-reserve"';

/**
 * Footprint of the node's bottom chrome, measured from the marks' own CSS: every viewport keeps the
 * marks on ONE row anchored at bottom:12px — the full AI chip / badge pill on wide viewports (tops
 * out under 56px with a wrapped row), the two collapsed 34px buttons on <=640px. The AI label's
 * tap-EXPANDED panel transiently rises above this strip by design (user-invoked, self-dismissing),
 * so it is not part of the reserved height.
 */
const STRIP_PX = 56;

/** The `:root` variable declaration an app reads to keep its bottom UI clear of the node's marks. */
export function reserveSnippet(): string {
    return `<style ${RESERVE_MARK}>:root{--aimeat-chrome-bottom:${STRIP_PX}px}</style>`;
}
