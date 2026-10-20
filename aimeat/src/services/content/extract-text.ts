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
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import type { TextFacts } from './types.js';

/** Characters (code points), words and lines of a text. */
export function measureText(text: string, from: TextFacts['from']): TextFacts {
  if (!text) return { chars: 0, words: 0, lines: 0, from };
  const chars = Array.from(text).length;
  const words = text.match(/\S+/gu)?.length ?? 0;
  const lines = text.split(/\r\n|\r|\n/).length;
  return { chars, words, lines, from };
}
