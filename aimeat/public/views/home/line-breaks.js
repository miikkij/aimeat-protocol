/**
 * @file public/views/home/line-breaks.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description keepLineBreaks: an agent's own words with their line breaks kept when drawn as
 *   Markdown. Markdown joins consecutive plain lines into one paragraph, so an answer written as
 *   three lines read as one on the work page ("IMvNuTmH 8 2026-10-17…" on aimeat.io, 2026-10-17).
 *   A blank line goes between two plain lines; lists, tables, headings, quotes and fenced code keep
 *   their own shape. Pure, so the unit test imports it.
 * @structure keepLineBreaks(text)
 * @usage html`<${Markdown} text=${keepLineBreaks(outcome.message)} small />`
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial.
 */

/** A line that starts a Markdown block of its own: a list item, a table row, a heading, a quote, a fence. */
const BLOCK_LINE = /^\s*([-*+]\s|\d+[.)]\s|\||#{1,6}\s|>|`{3}|~{3})/;

export function keepLineBreaks(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(`{3}|~{3})/.test(line)) fenced = !fenced;
    out.push(line);
    const next = lines[i + 1];
    if (!fenced && next !== undefined && line.trim() !== '' && next.trim() !== ''
      && !BLOCK_LINE.test(line) && !BLOCK_LINE.test(next)) out.push('');
  }
  return out.join('\n');
}
