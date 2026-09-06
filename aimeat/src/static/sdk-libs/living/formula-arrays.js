/**
 * @file living/formula-arrays.js
 * @description THE ROW. A spreadsheet's power was never the formula, it was the COLUMN: one
 *   expression written once and worked out down a thousand rows, where the thousand rows are the
 *   thing you actually want to see. A living document had the formula and not the column, so a
 *   day of twenty-four hours had to be twenty-four nodes, and a year could not be written at all.
 *   This module is the other half: a list is an ordinary value, and everything else follows.
 *
 *   BROADCASTING IS THE WHOLE IDEA, and it is one rule. Any arithmetic, any comparison and any
 *   one-argument function goes down a list element by element; a list meeting a plain number
 *   repeats the number; two lists of different lengths are REFUSED with both lengths, because the
 *   answer would otherwise be silently short. `prices * load` is a row of costs and
 *   `max(0, pv - load)` is a row of surpluses, written exactly as a person would say them.
 *
 *   A REFUSAL NAMES THE POSITION. A unit that will not add at element 7 of a 288-element vector is
 *   a refusal nobody can act on unless it says 7 — so every element-wise answer that comes back as
 *   an error is re-worded with where it happened before it leaves.
 *
 *   A POSITION IS COUNTED FROM ZERO, everywhere and without exception. index(xs, 0) is the first
 *   value and at(xs, 0) is the same value, which is what lets a day be range(24) and hour 13 be
 *   position 13. One-based would have made index() and at() disagree at every integer, and the
 *   disagreement would have been invisible.
 *
 *   scan() ANSWERS WITH ONE MORE THAN IT WAS GIVEN — the accumulator it started from, then one
 *   after each element. A battery scanned over 24 hours therefore gives 25 readings, which are the
 *   state of charge at each hour BOUNDARY, and the flow during hour i is position i + 1 less
 *   position i. Answering with 24 would have left the first hour with nothing to subtract from,
 *   and every document would have written the same workaround.
 *
 *   NOTHING HERE KNOWS ABOUT UNITS OR TREES. The arithmetic is handed in as a callback by
 *   formula-eval.js, which owns both; this file owns the shapes.
 * @structure isList · broadcast · rangeOf · indexAt · readAt · cumsumOf · childScope · MAX_ROW
 * @usage
 *   import { broadcast, rangeOf } from './formula-arrays.js';
 *   broadcast([[1, 2, 3], 2], (vals) => vals[0] * vals[1]);   // [2, 4, 6]
 * @version-history
 *   v0.5.0 — 2026-09-06 — Initial (living 0.5.0: the language grows rows).
 */

/** The longest row this document will build in one go. A slider must not be able to hang a page. */
export const MAX_ROW = 20000;

/** Is this value a row? An array and nothing else — a string is not a row of letters here. */
export function isList(v) { return Array.isArray(v); }

/** A refusal, the way the evaluator writes one. Kept local so this file imports nothing. */
function isErr(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.error === 'string'; }

/**
 * Work one operation out down the row.
 *
 * With no list among the arguments this is just the operation. With one or more, every list must
 * be the same length, a plain value repeats, and the answer is a list of the same length. A
 * refusal from any element is re-worded with the position it happened at and returned whole,
 * because half a row is worse than none.
 * @param {any[]} args
 * @param {(vals: any[]) => any} apply  the scalar operation, given one element from each argument
 * @returns {any}
 */
export function broadcast(args, apply) {
  let n = -1;
  for (const a of args) {
    if (!isList(a)) continue;
    if (n < 0) { n = a.length; continue; }
    if (a.length !== n) {
      return {
        error: 'These lists are not the same length: one has ' + n + ' values and another has '
          + a.length + '. Working an expression out down a row needs them to line up.',
      };
    }
  }
  if (n < 0) return apply(args);
  const out = [];
  for (let k = 0; k < n; k++) {
    const one = [];
    for (const a of args) one.push(isList(a) ? a[k] : a);
    const got = apply(one);
    if (isErr(got)) return { error: got.error + ' That is at position ' + k + ' of the list.' };
    out.push(got);
  }
  return out;
}

/**
 * range(n) · range(from, to) · range(from, to, step) — counted from the first and stopping BEFORE
 * the last, the way a row of positions is counted everywhere else in this language.
 * @param {number[]} args  the plain numbers, already taken out of whatever carried them
 * @returns {number[]|{ error: string }}
 */
export function rangeOf(args) {
  const one = args.length === 1;
  const from = one ? 0 : args[0];
  const to = one ? args[0] : args[1];
  const step = args.length > 2 ? args[2] : 1;
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step)) {
    return { error: 'range() counts with plain numbers, and one of the three it was given is not one.' };
  }
  if (step === 0) return { error: 'range() was given a step of 0, and would never reach the end.' };
  const count = Math.ceil((to - from) / step);
  if (count <= 0) return [];
  if (count > MAX_ROW) {
    return {
      error: 'range() was asked for ' + count + ' values, and one row in this document holds at most '
        + MAX_ROW + '.',
    };
  }
  const out = [];
  for (let k = 0; k < count; k++) out.push(from + k * step);
  return out;
}

/**
 * One value out of a row, by whole position, counted from zero.
 * @param {any[]} list @param {number} i
 */
export function indexAt(list, i) {
  if (!Number.isFinite(i)) return { error: 'index() needs a position that is a number.' };
  if (!Number.isInteger(i)) {
    return { error: 'index() reads a whole position, and got ' + i + '. To read BETWEEN two positions, say at().' };
  }
  if (i < 0 || i >= list.length) {
    return {
      error: 'This list holds ' + list.length + ' values, counted from 0, so there is nothing at position ' + i + '.',
    };
  }
  return list[i];
}

/**
 * A row read at a position that need not be a whole one: between two values it interpolates in a
 * straight line, and past either end it STOPS at the end rather than falling off it. That is what
 * lets a clock scrubbed to 13:30 read an hourly curve without the document owning a second, finer
 * copy of it.
 * @param {any[]} list @param {number} t
 * @param {(a: any, b: any, f: number) => any} blend  a + (b − a)·f, in the evaluator's arithmetic
 */
export function readAt(list, t, blend) {
  if (!list.length) return { error: 'at() was given an empty list.' };
  if (!Number.isFinite(t)) return { error: 'at() needs a position that is a number.' };
  if (t <= 0) return list[0];
  const lo = Math.floor(t);
  if (lo >= list.length - 1) return list[list.length - 1];
  const f = t - lo;
  if (f === 0) return list[lo];
  return blend(list[lo], list[lo + 1], f);
}

/**
 * The running totals of a row: as long as the row, each one the sum of everything up to and
 * including it. The addition is the evaluator's, so units are checked at every step and the
 * refusal says which step.
 * @param {any[]} list @param {(a: any, b: any) => any} add
 */
export function cumsumOf(list, add) {
  const out = [];
  let acc = null;
  for (let k = 0; k < list.length; k++) {
    acc = k === 0 ? list[0] : add(acc, list[k]);
    if (isErr(acc)) return { error: acc.error + ' That is at position ' + k + ' of the list.' };
    out.push(acc);
  }
  return out;
}

/**
 * The scope a map, fold or scan body is worked out in: the bound names first, everything the
 * document has behind them. A node genuinely called `x` is shadowed inside the body, which is what
 * a bound name does everywhere a bound name exists.
 * @param {{ get: (id: string) => any }} parent
 * @param {string[]} names @param {any[]} values
 * @returns {{ get: (id: string) => any }}
 */
export function childScope(parent, names, values) {
  return {
    get(symbol) {
      const whole = String(symbol);
      const head = whole.split('.')[0];
      const k = names.indexOf(head);
      if (k < 0) return parent.get(symbol);
      let at = values[k];
      if (whole === head) return at;
      for (const part of whole.slice(head.length + 1).split('.')) {
        if (at == null || typeof at !== 'object') return undefined;
        at = at[part];
      }
      return at;
    },
  };
}
