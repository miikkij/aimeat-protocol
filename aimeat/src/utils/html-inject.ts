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
 *   findOpenTag(text, name) — where an opening tag starts and ends, by index scan.
 * @usage import { injectBeforeClosingTag } from './html-inject.js';
 * @version-history
 *   v1.2.0 — 2026-11-21 — The last `</body>` is the last one OUTSIDE a script, a style, a textarea,
 *     a title and a comment. A page with a script after its `</body>` whose code held the string
 *     '</body>' got the snippet inside that string, a SyntaxError that stopped the script.
 *   v1.1.0 — 2026-08-31 — findOpenTag(): locating `<body …>` or `<html …>` in an uploaded document
 *     is an index scan now, not `/<body[^>]*>/`. That regex restarts its `[^>]*` at every `<body`
 *     in the text, so a document written to contain a hundred thousand of them costs quadratic time
 *     on a serving thread (CodeQL js/polynomial-redos, alerts 1579/1580/1584).
 *   v1.0.0 — 2026-07-16 — Initial: last-match injection extracted from app-badge/app-protect
 *     first-match replaces that broke apps whose JS contains '</body>'.
 */

/** The elements whose content is raw text: a `</body>` inside one is a string, never the tag. */
const RAW_TEXT = ['script', 'style', 'textarea', 'title'] as const;

/**
 * Where each closing tag of `name` starts, outside raw text and comments, in document order.
 *
 * One linear pass: at each `<` it either skips a comment to its `-->`, skips a raw-text element to
 * its own closing tag, or notes a `</name>`. The last-match rule alone failed for a page that puts
 * a script AFTER its `</body>` (browsers accept it): a `'</body>'` string in that script was the
 * last match, and the snippet landed inside the script's string, which is a SyntaxError.
 */
function closingTagsOutsideRawText(text: string, name: string): number[] {
    const lower = text.toLowerCase();
    const close = `</${name}`;
    const found: number[] = [];
    let at = lower.indexOf('<');
    while (at >= 0) {
        if (lower.startsWith('<!--', at)) {
            const end = lower.indexOf('-->', at + 4);
            if (end < 0) break;
            at = lower.indexOf('<', end + 3);
            continue;
        }
        const raw = RAW_TEXT.find(tag => lower.startsWith(`<${tag}`, at) && /[\s/>]/.test(lower[at + tag.length + 1] ?? ''));
        if (raw) {
            const end = lower.indexOf(`</${raw}`, at + raw.length + 1);
            if (end < 0) break;
            at = lower.indexOf('<', end + raw.length + 2);
            continue;
        }
        if (lower.startsWith(close, at) && /^\s*>/.test(lower.slice(at + close.length, at + close.length + 64))) found.push(at);
        at = lower.indexOf('<', at + 1);
    }
    return found;
}

/**
 * Insert `snippet` immediately before the LAST `</body>` tag (fallback: last `</html>`,
 * else append to the end). Tolerates whitespace before `>` and any tag case. A `</body>` inside a
 * script, a style, a textarea, a title or a comment is text and never the tag, wherever it stands.
 * Pure — returns a new string, the original closing tag is kept intact.
 */
export function injectBeforeClosingTag(text: string, snippet: string): string {
    const bodies = closingTagsOutsideRawText(text, 'body');
    const bodyIdx = bodies.length ? bodies[bodies.length - 1]! : -1;
    if (bodyIdx >= 0) return text.slice(0, bodyIdx) + snippet + text.slice(bodyIdx);
    const htmls = closingTagsOutsideRawText(text, 'html');
    const htmlIdx = htmls.length ? htmls[htmls.length - 1]! : -1;
    if (htmlIdx >= 0) return text.slice(0, htmlIdx) + snippet + text.slice(htmlIdx);
    return text + snippet;
}

/**
 * Where the first `<name …>` opening tag starts, and where it ends (one past its `>`). Null when
 * the document has no such tag, or when the tag never closes.
 *
 * An index scan rather than `/<name[^>]*>/i`, and the difference is not style. That regex has no
 * anchor, so the engine retries it at every position, and at each `<name` it finds it scans forward
 * with `[^>]*` looking for a `>` — quadratic on a document built out of `<body<body<body…`. Every
 * document these injectors touch is a file somebody uploaded, and a serving thread is the wrong
 * place to spend that.
 *
 * The name must end where a tag name ends: whitespace, `/` or `>`. `<bodyguard>` is not a body.
 */
export function findOpenTag(text: string, name: string): { start: number; end: number } | null {
    const lower = text.toLowerCase();
    const needle = `<${name.toLowerCase()}`;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
        const after = lower[at + needle.length];
        if (after === undefined || (after !== '>' && after !== '/' && !/\s/.test(after))) continue;
        const gt = lower.indexOf('>', at);
        if (gt < 0) return null;
        return { start: at, end: gt + 1 };
    }
    return null;
}
