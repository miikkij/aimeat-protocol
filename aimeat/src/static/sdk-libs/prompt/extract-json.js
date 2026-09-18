/**
 * @file prompt/extract-json.js
 * @description The first JSON value in a chat answer. Pure: no DOM and no globals, so the unit
 *   test imports it directly.
 *
 *   A chat wraps JSON in a fenced block, puts a sentence before it and another after it, so
 *   JSON.parse on the whole answer fails on an answer that is perfectly good. Every app that took
 *   an answer back wrote its own version of this, and this is where they broke.
 * @structure extractJson(text)
 * @usage import { extractJson } from './extract-json.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */

/**
 * Order of attempts: the whole text, each fenced block, then the first balanced {...} or [...]
 * that parses, skipping braces inside strings. Returns undefined when nothing parses; a JSON
 * null in the answer therefore comes back as null and is not confused with "none".
 *
 * @param {unknown} text
 * @returns {unknown}
 */
export function extractJson(text) {
  const source = String(text == null ? '' : text).trim();
  if (!source) return undefined;
  /** @param {string} candidate */
  const attempt = (candidate) => {
    try { return { ok: true, value: JSON.parse(candidate) }; } catch { return { ok: false, value: undefined }; }
  };
  const whole = attempt(source);
  if (whole.ok) return whole.value;
  const fence = /(?:^|\n)[ \t]*(?:`{3}|~{3})[^\n]*\n([\s\S]*?)\n[ \t]*(?:`{3}|~{3})/g;
  for (let m = fence.exec(source); m; m = fence.exec(source)) {
    const inFence = attempt(m[1].trim());
    if (inFence.ok) return inFence.value;
  }
  for (let start = 0; start < source.length; start++) {
    const open = source[start];
    if (open !== '{' && open !== '[') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          const found = attempt(source.slice(start, i + 1));
          if (found.ok) return found.value;
          break;
        }
      }
    }
  }
  return undefined;
}
