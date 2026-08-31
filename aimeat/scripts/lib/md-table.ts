/**
 * @file scripts/lib/md-table.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one escape a generated markdown table needs, in one place. Two report
 *   generators had written it separately (gen-third-party-notices.ts, security-report.ts) and both
 *   had written it the same way wrong: they escaped the pipe and left the backslash alone, so an
 *   upstream description containing `\|` came out as `\\|` — a literal backslash followed by a
 *   LIVE column separator, which splits the row and shifts every cell after it.
 *
 *   Order is the whole of it: backslashes first, pipes second. Reverse them and the escape escapes
 *   its own escape (CodeQL js/incomplete-sanitization, alerts 1586 and 1590). 1586 was fixed in
 *   commit 96027cdd where it stood; this file is why the same fix does not have to be found twice.
 * @structure cell(text) — pure, safe for any upstream string
 * @usage import { cell } from './lib/md-table.js';
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial: extracted from the two generators that each had the same bug.
 */

/**
 * One markdown table cell: no live pipe, no newline. Anything a package author wrote upstream is
 * safe to pass through here.
 */
export function cell(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}
