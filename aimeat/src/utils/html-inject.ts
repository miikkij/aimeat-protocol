/**
 * @file html-inject.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared "inject a snippet before the closing </body>" transform used by every
 *   serve-time HTML injector (app badge, copy-protection domainLock/watermark). The one rule
 *   that matters: target the LAST </body> occurrence, never the first. App JavaScript routinely
 *   contains the literal string '</body>' (apps that build/export HTML in template strings), and
 *   a first-match replace lands the snippet inside that JS string — a SyntaxError that silently
 *   kills the whole app (the fatalii drum-slicer incident, 2026-07-16). The real closing tag is
 *   the last occurrence in any well-formed document, since scripts live inside <body>.
 * @structure injectBeforeClosingTag(text, snippet) — pure string transform; last </body>,
 *   fallback last </html>, else append.
 * @usage import { injectBeforeClosingTag } from './html-inject.js';
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: last-match injection extracted from app-badge/app-protect
 *     first-match replaces that broke apps whose JS contains '</body>'.
 */

/** Index of the last match of `re` in `text`, or -1. `re` must carry the `g` flag. */
function lastMatchIndex(text: string, re: RegExp): number {
    let last = -1;
    re.lastIndex = 0;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        last = m.index;
        if (m.index === re.lastIndex) re.lastIndex++;
    }
    return last;
}

/**
 * Insert `snippet` immediately before the LAST `</body>` tag (fallback: last `</html>`,
 * else append to the end). Tolerates whitespace before `>` and any tag case. Pure —
 * returns a new string, the original closing tag is kept intact.
 */
export function injectBeforeClosingTag(text: string, snippet: string): string {
    const bodyIdx = lastMatchIndex(text, /<\/body\s*>/gi);
    if (bodyIdx >= 0) return text.slice(0, bodyIdx) + snippet + text.slice(bodyIdx);
    const htmlIdx = lastMatchIndex(text, /<\/html\s*>/gi);
    if (htmlIdx >= 0) return text.slice(0, htmlIdx) + snippet + text.slice(htmlIdx);
    return text + snippet;
}
