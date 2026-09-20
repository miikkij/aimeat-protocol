/**
 * @file src/utils/regex-literal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Putting a piece of text inside a regular expression so that it matches ITSELF.
 *
 *   WHAT GOES WRONG WITHOUT IT. A caller that escapes the character it happened to think of, and
 *   only that one, builds a pattern that means something else for every other character. Two places
 *   in this repo did exactly that: one escaped `-` and one escaped `$`, and neither escaped the
 *   BACKSLASH, which is the one that turns the next character into an escape sequence. `a\b` as a
 *   class name becomes a word-boundary assertion; a name ending in a backslash makes the pattern
 *   fail to compile and throws inside a publish check that was only supposed to count things.
 *   CodeQL calls it js/incomplete-sanitization (alerts 1640 and 1644, 2026-09-20).
 *
 *   The list is every character with a meaning in a JavaScript regular expression, and the
 *   backslash is FIRST so that the escapes this adds are not escaped again by a later rule.
 * @structure regexLiteral(text) — the text as a pattern that matches only itself
 * @usage
 *   import { regexLiteral } from '../utils/regex-literal.js';
 *   new RegExp(`\\b${regexLiteral(name)}\\b`).test(html);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial, replacing two hand-written escapes that each covered one
 *     character. `RegExp.escape` is Stage 3 and not in Node 24; when it lands this becomes a
 *     one-line delegation.
 */

/** The text as a regular-expression pattern that matches exactly itself, nothing else. */
export function regexLiteral(text: string): string {
    return text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
}
