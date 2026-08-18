/**
 * @file swallowed.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A bounded, inspectable record of failures the frontend deliberately continues past.
 *
 *   Why this exists rather than `console.warn` at every site. The browser code carries ~800 handlers
 *   that discard their error, and making each one print would destroy a signal this project actually
 *   relies on: Rule 1b verification treats a clean console as evidence, and an app was once reported
 *   as "0 console errors" while repainting its open dialog every second. Six hundred new warnings
 *   would make that measurement meaningless, and the noise would train everyone to ignore it.
 *
 *   So the default is quiet but NOT silent: every suppressed failure lands in a ring buffer that can
 *   be read at any time, and printing is opt-in.
 *
 *   Read them: `AIMEAT_SWALLOWED()` in the console, any time, on any page.
 *   Print them as they happen: `?debug=1` in the URL, or `localStorage.aimeat_debug = '1'`.
 *
 * @structure
 *   - swallowed(where, err): record one suppressed failure
 *   - window.AIMEAT_SWALLOWED(): read the buffer (newest last)
 * @usage
 *   import { swallowed } from '/js/swallowed.js';
 *   try { ... } catch { swallowed('memory-tab: loadKeys', err); }
 * @version-history
 *   v1.0.0 — 2026-07-26 — Initial (silent-exception cleanup, TARGET-052).
 */

const MAX = 200;
const ring = [];

let echo = false;
try {
    echo = new URLSearchParams(window.location.search).has('debug')
        || window.localStorage.getItem('aimeat_debug') === '1';
// This module IS the reporting channel: a storage-blocked browser only means the opt-in echo
// cannot be read, and reporting that through the channel being initialised would recurse.
// eslint-disable-next-line aimeat/no-silent-catch -- reporting here would recurse into this module
} catch {
    echo = false;
}

/**
 * Record a failure the caller has decided to continue past.
 * @param {string} where  Where it happened — file or component plus the operation.
 * @param {unknown} err   The caught value.
 */
export function swallowed(where, err) {
    const entry = {
        at: new Date().toISOString(),
        where,
        error: err instanceof Error ? (err.message || err.name) : String(err),
    };
    ring.push(entry);
    if (ring.length > MAX) ring.shift();
    if (echo) console.warn(`[swallowed] ${where}`, err);
}

/** Read the buffer. Exposed on window so it can be called from the console on any page. */
export function readSwallowed() {
    return ring.slice();
}

try {
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (window)).AIMEAT_SWALLOWED = readSwallowed;
// No window (SSR/worker): the buffer still works through the exported function, only the console
// shortcut is unavailable.
// eslint-disable-next-line aimeat/no-silent-catch -- no window; only the console shortcut is lost
} catch {
    void 0;
}
