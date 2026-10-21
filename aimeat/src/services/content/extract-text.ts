/**
 * @file src/services/content/extract-text.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The measure of a text: characters, words and lines, and where the text came from.
 *   The text itself is stored as its own file by the pipeline; only these counts go into the facts
 *   record (types.ts TextFacts).
 *
 *   Characters are counted as Unicode code points, so an emoji or a character outside the Basic
 *   Multilingual Plane counts once. Words are runs of non-whitespace. Lines count the line breaks
 *   plus one, and an empty text has zero lines.
 * @structure measureText
 * @usage const facts = measureText(text, 'file');
 * @version-history
 *   v1.0.1 — 2026-10-21 — One pass with no regular expression and no intermediate array; an 8 MB text
 *     overflowed the stack on aimeat.io.
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import type { TextFacts } from './types.js';

/**
 * Characters (code points), words and lines of a text, in one pass with no regular expression and no
 * intermediate array. On aimeat.io (2026-10-21) the earlier measure (Array.from, a /\S+/gu match and
 * a split) failed with "Maximum call stack size exceeded" on an 8 MB JSON file that is almost one
 * token; the same file measured fine on a Windows machine, so the step that overflowed on the
 * server is not known. This form has none of the three.
 */
export function measureText(text: string, from: TextFacts['from']): TextFacts {
  if (!text) return { chars: 0, words: 0, lines: 0, from };
  let chars = 0;
  let words = 0;
  let lines = 1;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // A high surrogate and its low surrogate are one code point.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    chars++;
    if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) lines++;
    const space = c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
      || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
    if (space) inWord = false;
    else if (!inWord) { inWord = true; words++; }
  }
  return { chars, words, lines, from };
}
