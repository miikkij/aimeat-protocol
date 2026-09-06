/**
 * @file living/json-path.js
 * @description ONE PATH INTO AN ANSWER, READ THE WAY A PERSON WOULD WRITE IT. A URL source names
 *   where in the reply its number is — `prices[1].price`, `data.now`, `readings.0.celsius` — and
 *   this is the whole of that language: names separated by dots, positions in brackets or as bare
 *   numbers, counted from zero.
 *
 *   IT IS TWO FUNCTIONS, NOT ONE, AND THAT IS THE POINT. `digPath` reads at run time and answers
 *   undefined where the path runs out, because a server that changed its shape is a stale reading,
 *   not a crash. `pathError` reads BEFORE anything runs and names a path that cannot be a path at
 *   all — an unclosed bracket, an empty segment, a space — so validate() refuses the record instead
 *   of the document mounting and quietly reading nothing forever. A path that is merely WRONG for
 *   today's answer is not an error here; a path that is not a path is.
 * @structure pathParts(path) · digPath(value, path) · pathError(path)
 * @usage
 *   import { digPath, pathError } from './json-path.js';
 *   digPath({ prices: [{ price: 4.2 }] }, 'prices[0].price');   // 4.2
 * @version-history
 *   v0.6.0 — 2026-09-06 — Initial (the living document, stage 5: hooks).
 */

/** A segment name: letters, digits, underscore, dollar, dash. No spaces, never empty. */
const NAME = /^[A-Za-z0-9_$-]+$/;

/**
 * The path broken into the steps it takes, or null when it is not a path at all.
 * @param {any} path
 * @returns {string[]|null}
 */
export function pathParts(path) {
  const text = String(path == null ? '' : path).trim();
  if (!text) return [];
  const out = [];
  let at = 0;
  while (at < text.length) {
    if (text[at] === '[') {
      const end = text.indexOf(']', at);
      if (end < 0) return null;
      const inner = text.slice(at + 1, end);
      if (!/^\d+$/.test(inner)) return null;
      out.push(inner);
      at = end + 1;
      if (at < text.length && text[at] === '.') at += 1;
      continue;
    }
    let end = at;
    while (end < text.length && text[end] !== '.' && text[end] !== '[') end += 1;
    const name = text.slice(at, end);
    if (!NAME.test(name)) return null;
    out.push(name);
    at = end;
    if (at < text.length && text[at] === '.') at += 1;
  }
  return out;
}

/**
 * Read the value at a path. The value itself when no path was asked for; undefined where the answer
 * does not go that deep, which is a reading that did not arrive rather than a failure.
 * @param {any} value @param {any} path
 * @returns {any}
 */
export function digPath(value, path) {
  const parts = pathParts(path);
  if (!parts) return undefined;
  let at = value;
  for (const part of parts) {
    if (at == null || typeof at !== 'object') return undefined;
    at = at[part];
  }
  return at;
}

/**
 * The refusal a path earns before anything runs, or null when it is one.
 * @param {any} path
 * @returns {string|null}
 */
export function pathError(path) {
  if (path == null || path === '') return null;
  if (typeof path !== 'string') return 'a path that is not a line of text';
  return pathParts(path)
    ? null
    : 'a path "' + path + '" that cannot be read as a path; a path is names joined by dots with '
      + 'positions in brackets, such as "prices[1].price"';
}

/**
 * The answer shape a path DESCRIBES, built around one sample value: the object a server would have
 * to send for this node to find its number. The inward dialog shows it, so the person setting the
 * URL up is looking at the exact structure rather than at a plausible example.
 * @param {any} path @param {any} sample
 * @returns {any}
 */
export function shapeFor(path, sample) {
  const parts = pathParts(path);
  if (!parts || !parts.length) return sample;
  let built = sample;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (/^\d+$/.test(part)) {
      const row = [];
      for (let k = 0; k < Number(part); k++) row.push(null);
      row.push(built);
      built = row;
      continue;
    }
    const box = {};
    box[part] = built;
    built = box;
  }
  return built;
}
