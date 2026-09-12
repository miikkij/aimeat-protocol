/**
 * @file discovery-tab.shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one thing every section of the admin Discovery page reads that is only about
 *   this page: the base address the status was read from. Kept apart from the shell so the sections
 *   import a leaf rather than each other.
 *
 *   The metric row and the machine-readable stamp used to live here too. They moved to ./shared.js
 *   when the Hooks page needed the same two: a helper every operator page in the poster face uses
 *   belongs with Badge and Spinner, not in one page's own file.
 * @structure baseOf
 * @usage import { baseOf } from './discovery-tab.shared.js';
 * @version-history
 *   v1.1.0 — 2026-09-12 — Row and when() move to ./shared.js; only baseOf stays.
 *   v1.0.0 — 2026-09-11 — Initial (the Discovery page in the poster face).
 */

/** The base this node is served from, without a trailing slash, from the status itself. */
export function baseOf(status) {
  return status.sitemap.url.replace(/\/sitemap\.xml$/, '');
}
