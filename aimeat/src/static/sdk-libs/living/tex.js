/**
 * @file living/tex.js
 * @description THE SAME TREE, SET AS MATHEMATICS. A formula in a living document is written once,
 *   in the spreadsheet style a person can type, and then read twice: the evaluator works it out
 *   and this printer sets it. Both walk the SAME MathJSON tree, so what the reader sees is
 *   provably the expression that produced the number under it — not a second copy of the formula
 *   somebody typed into a caption and will forget to change.
 *
 *   A DIVISION BECOMES A FRACTION, a power becomes a superscript, a square root gets its sign,
 *   and a bracket appears only where the precedence needs one — writing every bracket the source
 *   had would set p \cdot v / (r \cdot T) as a line of ASCII with a fraction bar somewhere in it,
 *   which is worse than not setting it at all. An if() is set as the cases brace mathematics
 *   already has for exactly this.
 *
 *   THE TYPESETTER IS OPTIONAL. This module returns a STRING; whether KaTeX is on the page is
 *   somebody else's problem, and the display part writes the plain expression first so a page
 *   where KaTeX never loads still says what the formula is.
 * @structure toTex(tree) · texName(symbol) · texUnit(label)
 * @usage
 *   import { toTex } from './tex.js';
 *   toTex(parse('p * v / (r * T)'));   // '\\frac{p \\cdot v}{r \\cdot T}'
 * @version-history
 *   v0.5.0 — 2026-09-06 — THE ROW, SET AS A ROW. A sum is a sigma, a map is the bracketed
 *     set-builder mathematics already writes, a position is a subscript and at() is a function
 *     call on the row — because \operatorname{index}(pv, i) is the source code printed in a serif
 *     face, which teaches a reader nothing the formula box above it did not already say. π is a
 *     head rather than 3.141592653589793 for the same reason. The functions mathematics has its
 *     own mark for (\sin, \arccos, \ln, \log_{10}) use it instead of \operatorname.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

/** Where each head sits in the pecking order — a child that binds looser gets brackets. */
const RANK = {
  Or: 1, And: 2, Not: 3,
  Equal: 4, NotEqual: 4, Less: 4, LessEqual: 4, Greater: 4, GreaterEqual: 4,
  Concat: 5,
  Add: 6, Subtract: 6,
  Multiply: 7, Divide: 7,
  Negate: 8,
  Power: 9,
};

const RELATION = {
  Equal: '=', NotEqual: '\\ne', Less: '<', LessEqual: '\\le', Greater: '>', GreaterEqual: '\\ge',
};

/** Named functions that are set as an upright operator with its argument in brackets. */
const OPERATORS = {
  Min: 'min', Max: 'max', Mean: 'avg', Count: 'count',
  Clamp: 'clamp', Convert: 'convert', Text: 'text', Number: 'number',
  Round: 'round', Floor: 'floor', Ceiling: 'ceil', First: 'first', Last: 'last',
  CumSum: 'cumsum',
};

/**
 * The functions mathematics already has a mark for. \sin is not the same object as
 * \operatorname{sin} — it carries the spacing the typesetter was built with — and a reader
 * checking a solar model by hand is reading exactly these.
 */
const MACROS = {
  Sin: '\\sin', Cos: '\\cos', Tan: '\\tan',
  Asin: '\\arcsin', Acos: '\\arccos', Atan: '\\arctan',
  Exp: '\\exp', Ln: '\\ln', Log: '\\log', Log10: '\\log_{10}', Deg: '\\deg',
};

/** Escape the characters TeX would otherwise read as instructions. */
function escapeText(s) {
  return String(s).replace(/([\\{}$&#^_%~])/g, '\\$1');
}

/**
 * A node id, set as a name. A single letter stays italic the way a variable does; a word gets
 * an upright roman face, because "readings" in italics reads as r·e·a·d·i·n·g·s.
 * @param {string} name
 * @returns {string}
 */
export function texName(name) {
  const parts = String(name).split('.');
  const head = parts[0];
  const rest = parts.slice(1);
  const base = head.length === 1 ? escapeText(head) : '\\mathrm{' + escapeText(head) + '}';
  return rest.length ? base + '_{' + escapeText(rest.join('.')) + '}' : base;
}

/** A unit label, set upright beside the number it belongs to. */
export function texUnit(label) {
  if (!label) return '';
  return '\\,\\mathrm{' + escapeText(label).replace(/\\\^/g, '^') + '}';
}

function numberTex(n) {
  if (!Number.isFinite(n)) return '\\text{?}';
  return String(n);
}

function wrap(inner, childRank, parentRank) {
  return childRank < parentRank ? '\\left(' + inner + '\\right)' : inner;
}

/**
 * Set one tree as TeX.
 * @param {any} tree
 * @param {number} [parentRank]
 * @returns {string}
 */
export function toTex(tree, parentRank) {
  const outer = parentRank || 0;
  if (tree == null) return '';
  if (typeof tree === 'number') return numberTex(tree);
  if (typeof tree === 'boolean') return '\\text{' + (tree ? 'true' : 'false') + '}';
  if (typeof tree === 'string') return texName(tree);
  if (!Array.isArray(tree)) {
    if (typeof tree.str === 'string') return '\\text{“' + escapeText(tree.str) + '”}';
    return '';
  }
  const head = tree[0];
  const rank = RANK[head] || 10;
  const at = (i) => toTex(tree[i], rank);

  switch (head) {
    case 'Add': return wrap(at(1) + ' + ' + at(2), rank, outer);
    case 'Subtract': return wrap(at(1) + ' - ' + at(2), rank, outer);
    case 'Negate': return wrap('-' + at(1), rank, outer);
    case 'Multiply': return wrap(at(1) + ' \\cdot ' + at(2), rank, outer);
    case 'Divide': return '\\frac{' + toTex(tree[1], 0) + '}{' + toTex(tree[2], 0) + '}';
    case 'Power': return toTex(tree[1], rank + 1) + '^{' + toTex(tree[2], 0) + '}';
    case 'Sqrt': return '\\sqrt{' + toTex(tree[1], 0) + '}';
    case 'Abs': return '\\left|' + toTex(tree[1], 0) + '\\right|';
    case 'Concat': return wrap(at(1) + ' \\mathbin{\\&} ' + at(2), rank, outer);
    case 'Not': return wrap('\\lnot ' + at(1), rank, outer);
    case 'And': return wrap(tree.slice(1).map((t) => toTex(t, rank)).join(' \\land '), rank, outer);
    case 'Or': return wrap(tree.slice(1).map((t) => toTex(t, rank)).join(' \\lor '), rank, outer);
    case 'If': {
      const then = toTex(tree[2], 0);
      const other = tree.length > 3 ? toTex(tree[3], 0) : '';
      return '\\begin{cases} ' + then + ' & ' + toTex(tree[1], 0)
        + ' \\\\ ' + other + ' & \\text{otherwise} \\end{cases}';
    }
    // ── THE ROW, SET AS A ROW. A sigma is a sigma, a map is the bracketed set-builder mathematics
    // already writes, and a position is a subscript. The alternative — \operatorname{index}(pv, i)
    // — is the source code printed in a serif face, which teaches a reader nothing they could not
    // read in the formula box above it.
    case 'Pi': return '\\pi';
    case 'Sum': {
      if (tree.length === 2) return wrap('\\sum ' + toTex(tree[1], 10), 10, outer);
      return '\\sum\\left(' + tree.slice(1).map((t) => toTex(t, 0)).join(',\\; ') + '\\right)';
    }
    case 'Index': return toTex(tree[1], 10) + '_{' + toTex(tree[2], 0) + '}';
    case 'At': return toTex(tree[1], 10) + '\\!\\left(' + toTex(tree[2], 0) + '\\right)';
    case 'Range': {
      const from = tree.length > 2 ? toTex(tree[1], 0) : '0';
      const to = toTex(tree[tree.length > 2 ? 2 : 1], 0);
      const step = tree.length > 3 ? '_{\\,\\Delta ' + toTex(tree[3], 0) + '}' : '';
      return '\\left[' + from + ' \\ldots ' + to + '\\right)' + step;
    }
    case 'Map':
      return '\\left[\\, ' + toTex(tree[2], 0) + ' \\;\\middle|\\; x \\in ' + toTex(tree[1], 0) + ' \\,\\right]';
    case 'Fold': case 'Scan': {
      const name = head === 'Fold' ? 'fold' : 'scan';
      return '\\operatorname{' + name + '}_{x \\in ' + toTex(tree[1], 0) + '}\\left(\\mathrm{acc}_{0} = '
        + toTex(tree[2], 0) + ',\\; ' + toTex(tree[3], 0) + '\\right)';
    }
    case 'Where': {
      return '\\begin{cases} ' + toTex(tree[2], 0) + ' & ' + toTex(tree[1], 0)
        + ' \\\\ ' + toTex(tree[3], 0) + ' & \\text{otherwise} \\end{cases}';
    }
    default: {
      if (RELATION[head]) return wrap(at(1) + ' ' + RELATION[head] + ' ' + at(2), rank, outer);
      const args = tree.slice(1).map((t) => toTex(t, 0)).join(',\\; ');
      if (MACROS[head]) return MACROS[head] + '\\left(' + args + '\\right)';
      const name = OPERATORS[head] || String(head).toLowerCase();
      return '\\operatorname{' + escapeText(name) + '}\\left(' + args + '\\right)';
    }
  }
}
