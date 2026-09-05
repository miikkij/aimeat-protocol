/**
 * @file living/formula-eval.js
 * @description WORKING OUT THE TREE, WITH THE UNITS STILL ON. The evaluator walks the
 *   MathJSON-shaped tree formula-parse.js produced and answers with a value — a number, a
 *   quantity (a number and a unit), a piece of text, a truth, a list, or an ERROR, which is a
 *   value like any other and renders as one.
 *
 *   AN ERROR IS A VALUE, NOT AN EXCEPTION. A document is a screen a person is looking at, and
 *   one bad cell must not take the other twenty with it. So a refusal — an unknown node, units
 *   that will not add, a square root of a negative — comes back as { error: "…" } in the words
 *   a person can act on, propagates through whatever reads it, and shows up in exactly the one
 *   place that went wrong.
 *
 *   THE TWO RULES THAT DECIDE EVERYTHING ELSE, both from units.js: a unit rides through
 *   multiplication and division and is CHECKED on addition; and an offset unit (°C, °F) that
 *   meets a multiplication comes back as a plain number, because half of 20 °C is not 10 °C.
 *   That is what lets the hand-written conversion t * 9/5 + 32 with unit °F mean what its author
 *   meant, while p * v / (r * T) is still checked properly all the way through.
 * @structure evaluate(tree, scope) · isError · asText · asNumber · OPS
 * @usage
 *   import { evaluate } from './formula-eval.js';
 *   evaluate(parse('t * 9/5 + 32'), { get: (id) => ({ n: 22, u: celsius }) });   // 71.6
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parseUnit, unitLabel, sameDim, convert, mulUnits, divUnits, powUnit, isAffine, toBase } from './units.js';

/** @typedef {{ error: string }} Err */

/**
 * Is this value a refusal? Written as a type guard, so every caller that returns early on one is
 * left holding the good value rather than the union.
 * @param {any} v
 * @returns {v is { error: string }}
 */
export function isError(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.error === 'string'; }

/**
 * Is this value a number carrying a unit?
 * @param {any} v
 * @returns {v is { n: number, u: any }}
 */
export function isQuantity(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.n === 'number' && 'u' in v; }

/** The number inside a value, with its unit, or a refusal. */
function num(v, what) {
  if (typeof v === 'number') return { n: v, u: null };
  if (typeof v === 'boolean') return { n: v ? 1 : 0, u: null };
  if (isQuantity(v)) return v;
  if (isError(v)) return v;
  return { error: 'I need a number for ' + (what || 'this') + ', and got ' + describeValue(v) + '.' };
}

/** How a value is named inside a refusal. */
function describeValue(v) {
  if (v == null) return 'nothing';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'string') return 'the text "' + v + '"';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return 'something else';
}

/** Fold a quantity back to a plain number when its unit measures nothing. */
function tidy(q) {
  if (!q.u) return q.n;
  if (Object.keys(q.u.dim).length === 0 && !q.u.offset) {
    return q.u.scale === 1 ? q.n : q.n * q.u.scale;
  }
  return q;
}

/** How a value reads inside text: a quantity keeps its unit, a number keeps its digits. */
export function asText(v) {
  if (v == null) return '';
  if (isError(v)) return v.error;
  if (isQuantity(v)) return trimNumber(v.n) + (unitLabel(v.u) ? ' ' + unitLabel(v.u) : '');
  if (typeof v === 'number') return trimNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(asText).join(', ');
  return String(v);
}

/** A number written the way a person writes one: no trailing zeros, no exponent for ordinary sizes. */
export function trimNumber(n) {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
}

/** The plain number inside a value, in its own unit — what a chart or a gauge takes. */
export function asNumber(v) {
  if (typeof v === 'number') return v;
  if (isQuantity(v)) return v.n;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return NaN;
}

/** Truth of a value, spreadsheet-style: a number is true when it is not zero. */
function truth(v) {
  if (isError(v)) return v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (isQuantity(v)) return v.n !== 0;
  if (typeof v === 'string') return v !== '';
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

function addLike(a, b, sign, head) {
  const qa = num(a, head.toLowerCase());
  if (isError(qa)) return qa;
  const qb = num(b, head.toLowerCase());
  if (isError(qb)) return qb;
  if (!qa.u && !qb.u) return qa.n + sign * qb.n;
  if (!qb.u) return tidy({ n: qa.n + sign * qb.n, u: qa.u });
  if (!qa.u) return tidy({ n: qa.n + sign * qb.n, u: qb.u });
  if (!sameDim(qa.u, qb.u)) {
    return { error: 'I cannot ' + (sign > 0 ? 'add ' : 'subtract ') + unitLabel(qb.u) + ' '
      + (sign > 0 ? 'to ' : 'from ') + unitLabel(qa.u) + ': those measure different things.' };
  }
  if (isAffine(qa.u) || isAffine(qb.u)) {
    if (unitLabel(qa.u) !== unitLabel(qb.u)) {
      return { error: 'I cannot put ' + unitLabel(qa.u) + ' and ' + unitLabel(qb.u)
        + ' together: two temperature scales with different zeros need a conversion first, so say convert(x, "'
        + unitLabel(qa.u) + '").' };
    }
    return tidy({ n: qa.n + sign * qb.n, u: qa.u });
  }
  const moved = convert(qb, qa.u);
  if (isError(moved)) return moved;
  return tidy({ n: qa.n + sign * moved.n, u: qa.u });
}

function mulLike(a, b, divide) {
  const qa = num(a, divide ? 'a division' : 'a multiplication');
  if (isError(qa)) return qa;
  const qb = num(b, divide ? 'a division' : 'a multiplication');
  if (isError(qb)) return qb;
  const n = divide ? qa.n / qb.n : qa.n * qb.n;
  // An offset unit is not a scale: multiplying one has no meaning as a temperature, so the
  // answer comes back as a plain number and the formula's own unit names it.
  if (isAffine(qa.u) || isAffine(qb.u)) return n;
  const u = divide ? divUnits(qa.u, qb.u) : mulUnits(qa.u, qb.u);
  return tidy({ n: n, u: u });
}

function compareLike(a, b, test, head) {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (typeof a === 'string' || typeof b === 'string') {
    const left = typeof a === 'string' ? a : asText(a);
    const right = typeof b === 'string' ? b : asText(b);
    return test(left < right ? -1 : left > right ? 1 : 0);
  }
  const qa = num(a, head.toLowerCase());
  if (isError(qa)) return qa;
  const qb = num(b, head.toLowerCase());
  if (isError(qb)) return qb;
  if (qa.u && qb.u && !sameDim(qa.u, qb.u)) {
    return { error: 'I cannot compare ' + unitLabel(qa.u) + ' with ' + unitLabel(qb.u) + ': those measure different things.' };
  }
  // A bare number against a quantity is compared AS WRITTEN, in the quantity's own unit — t > 30
  // with t in °C means thirty degrees Celsius, not thirty kelvin. Only two quantities are put
  // into a common base first, which is what makes 1 km > 999 m come out right.
  const bothCarry = !!qa.u && !!qb.u;
  const left = bothCarry ? toBase(qa.n, qa.u) : qa.n;
  const right = bothCarry ? toBase(qb.n, qb.u) : qb.n;
  const diff = Math.abs(left - right) < 1e-12 ? 0 : (left < right ? -1 : 1);
  return test(diff);
}

/** Numbers out of a list of arguments — an aggregate takes a list or the arguments themselves. */
function spread(args) {
  const out = [];
  for (const a of args) {
    if (isError(a)) return a;
    if (Array.isArray(a)) { for (const x of a) out.push(x); } else out.push(a);
  }
  return out;
}

function aggregate(args, fold, name) {
  const items = spread(args);
  if (isError(items)) return items;
  if (!items.length) return { error: name + ' needs something to work on, and the list was empty.' };
  const quantities = [];
  for (const x of items) {
    const q = num(x, name);
    if (isError(q)) return q;
    quantities.push(q);
  }
  const unit = quantities[0].u;
  const values = [];
  for (const q of quantities) {
    if (unit && q.u && !sameDim(unit, q.u)) {
      return { error: name + ' cannot mix ' + unitLabel(unit) + ' and ' + unitLabel(q.u) + ': those measure different things.' };
    }
    const moved = unit && q.u && unitLabel(q.u) !== unitLabel(unit) ? convert(q, unit) : q;
    if (isError(moved)) return moved;
    values.push(moved.n);
  }
  return tidy({ n: fold(values), u: unit });
}

/**
 * Work a tree out. The scope answers for a symbol: get(id) returns a value, or undefined when
 * this document has no node by that name.
 * @param {any} tree
 * @param {{ get: (id: string) => any }} scope
 * @returns {any}
 */
export function evaluate(tree, scope) {
  if (tree == null) return { error: 'an empty formula' };
  if (typeof tree === 'number' || typeof tree === 'boolean') return tree;
  if (typeof tree === 'string') {
    const got = scope.get(tree);
    if (got === undefined) return { error: 'This document has nothing called "' + tree + '".' };
    return got;
  }
  if (!Array.isArray(tree)) {
    if (typeof tree.str === 'string') return tree.str;
    if (isError(tree)) return tree;
    return { error: 'something in the formula I cannot work out' };
  }
  const head = tree[0];
  const arg = (i) => evaluate(tree[i], scope);

  // The three that must not evaluate everything first.
  if (head === 'If') {
    const cond = truth(arg(1));
    if (isError(cond)) return cond;
    if (cond) return tree.length > 2 ? arg(2) : true;
    return tree.length > 3 ? arg(3) : false;
  }
  if (head === 'And' || head === 'Or') {
    const want = head === 'And';
    for (let i = 1; i < tree.length; i++) {
      const v = truth(arg(i));
      if (isError(v)) return v;
      if (v !== want) return !want;
    }
    return want;
  }

  const args = [];
  for (let i = 1; i < tree.length; i++) {
    const v = arg(i);
    if (isError(v)) return v;
    args.push(v);
  }
  const a = args[0];
  const b = args[1];

  switch (head) {
    case 'Add': return addLike(a, b, 1, 'Add');
    case 'Subtract': return addLike(a, b, -1, 'Subtract');
    case 'Negate': { const q = num(a, 'a minus sign'); return isError(q) ? q : tidy({ n: -q.n, u: q.u }); }
    case 'Multiply': return mulLike(a, b, false);
    case 'Divide': return mulLike(a, b, true);
    case 'Power': {
      const qa = num(a, 'a power');
      if (isError(qa)) return qa;
      const qb = num(b, 'a power');
      if (isError(qb)) return qb;
      if (qb.u) return { error: 'A power has to be a plain number, and this one is in ' + unitLabel(qb.u) + '.' };
      if (qa.u && !Number.isInteger(qb.n)) return { error: 'I can only raise ' + unitLabel(qa.u) + ' to a whole power.' };
      return tidy({ n: Math.pow(qa.n, qb.n), u: qa.u ? powUnit(qa.u, qb.n) : null });
    }
    case 'Not': { const v = truth(a); return isError(v) ? v : !v; }
    case 'Equal': return compareLike(a, b, (d) => d === 0, 'Equal');
    case 'NotEqual': return compareLike(a, b, (d) => d !== 0, 'NotEqual');
    case 'Less': return compareLike(a, b, (d) => d < 0, 'Less');
    case 'LessEqual': return compareLike(a, b, (d) => d <= 0, 'LessEqual');
    case 'Greater': return compareLike(a, b, (d) => d > 0, 'Greater');
    case 'GreaterEqual': return compareLike(a, b, (d) => d >= 0, 'GreaterEqual');
    case 'Concat': return asText(a) + asText(b);
    case 'Text': return asText(a);
    case 'Number': { const q = num(a, 'number()'); return isError(q) ? q : q.n; }
    case 'Abs': { const q = num(a, 'abs'); return isError(q) ? q : tidy({ n: Math.abs(q.n), u: q.u }); }
    case 'Sqrt': {
      const q = num(a, 'sqrt');
      if (isError(q)) return q;
      if (q.n < 0) return { error: 'There is no square root of ' + trimNumber(q.n) + '.' };
      return tidy({ n: Math.sqrt(q.n), u: null });
    }
    case 'Exp': { const q = num(a, 'exp'); return isError(q) ? q : Math.exp(q.n); }
    case 'Ln': case 'Log': {
      const q = num(a, 'log');
      if (isError(q)) return q;
      if (q.n <= 0) return { error: 'There is no logarithm of ' + trimNumber(q.n) + '.' };
      if (head === 'Ln' || args.length < 2) return Math.log(q.n) / (head === 'Log' && args.length < 2 ? Math.LN10 : 1);
      const base = num(b, 'log');
      if (isError(base)) return base;
      return Math.log(q.n) / Math.log(base.n);
    }
    case 'Round': case 'Floor': case 'Ceiling': {
      const q = num(a, head.toLowerCase());
      if (isError(q)) return q;
      const places = args.length > 1 ? Math.trunc(asNumber(b)) : 0;
      const f = Math.pow(10, places);
      const fn = head === 'Round' ? Math.round : head === 'Floor' ? Math.floor : Math.ceil;
      return tidy({ n: fn(q.n * f) / f, u: q.u });
    }
    case 'Clamp': {
      const q = num(a, 'clamp');
      if (isError(q)) return q;
      const lo = num(b, 'clamp');
      const hi = num(args[2], 'clamp');
      if (isError(lo)) return lo;
      if (isError(hi)) return hi;
      return tidy({ n: Math.min(Math.max(q.n, lo.n), hi.n), u: q.u });
    }
    case 'Convert': {
      const q = num(a, 'convert');
      if (isError(q)) return q;
      const target = parseUnit(typeof b === 'string' ? b : asText(b));
      if (isError(target)) return target;
      const moved = convert(q, target);
      return isError(moved) ? moved : tidy(moved);
    }
    case 'Min': return aggregate(args, (v) => Math.min.apply(null, v), 'min');
    case 'Max': return aggregate(args, (v) => Math.max.apply(null, v), 'max');
    case 'Sum': return aggregate(args, (v) => v.reduce((x, y) => x + y, 0), 'sum');
    case 'Mean': return aggregate(args, (v) => v.reduce((x, y) => x + y, 0) / v.length, 'avg');
    case 'Count': { const items = spread(args); return isError(items) ? items : items.length; }
    case 'First': { const items = spread(args); return isError(items) ? items : (items.length ? items[0] : { error: 'first() was given an empty list.' }); }
    case 'Last': { const items = spread(args); return isError(items) ? items : (items.length ? items[items.length - 1] : { error: 'last() was given an empty list.' }); }
    default: return { error: 'a function this document does not have: ' + head };
  }
}
