/**
 * @file src/utils/html-tag-scan.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The attribute text of every `<script ...>` or `<link ...>` tag in an HTML document,
 *   read in one linear pass. The publish-time asset scan (services/app-artifact-lint.ts) runs on the
 *   node's event loop before the write, on HTML an uploader chose. The patterns it used ran `[^>]*`
 *   from each opener, and an opener with no `>` after it cost a scan to the end of the text, so k such
 *   openers cost k times the size of the upload (secaudit2026oct26,
 *   collectAssetRefs:unclosed-tag-quadratic-scan). Moved out of app-artifact-lint.ts at its line limit.
 * @structure tagAttributes(html, name)
 * @usage for (const attrs of tagAttributes(html, 'link')) { ... }
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */

/**
 * The attribute text of every `<name ...>` tag, in order: from the opener to the next `>`. Found with
 * one opener pattern and indexOf, so the whole HTML is read once. A scan resumes after the `>` it
 * found, as the global patterns it replaces did. When no `>` follows an opener, none follows a later
 * one either, so the scan stops there.
 */
export function tagAttributes(html: string, name: 'script' | 'link'): string[] {
  const out: string[] = [];
  const opener = name === 'script' ? /<script\b/gi : /<link\b/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(html)) !== null) {
    const start = m.index + m[0].length;
    const end = html.indexOf('>', start);
    if (end < 0) break;
    out.push(html.slice(start, end));
    opener.lastIndex = end + 1;
  }
  return out;
}
