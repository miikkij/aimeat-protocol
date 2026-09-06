/**
 * @file living/nodes/formula.js
 * @description THE BINDING BETWEEN THE PARTS. A formula node reads other nodes by name and
 *   answers with what they come to — and it is the reason a living document is one thing rather
 *   than a page of unrelated widgets. Move a value, and every formula standing on it moves in the
 *   same recompute.
 *
 *   IT ANSWERS TWICE. The value is what the gauge and the sentence read; the TeX is what the page
 *   sets as mathematics, printed from the SAME tree the value came out of, so the formula on the
 *   screen is provably the formula that produced the number under it. Read the second one as
 *   <id>.tex from any other formula or template.
 *
 *   THE UNIT FIELD CONVERTS WHEN IT CAN AND NAMES WHEN IT CANNOT. A result that still carries a
 *   unit is converted into the one declared, and refuses in words when the two measure different
 *   things; a result that came out as a plain number takes the declared unit as its label. That
 *   second half is what makes the hand-written t * 9/5 + 32 with unit °F mean what its author
 *   meant — see units.js for why an offset unit leaves arithmetic as a bare number.
 *
 *   `format` DECIDES HOW IT IS PRINTED AND NOTHING ELSE. The answer under the set formula is
 *   written the way `format` asks — one decimal, a thousands separator, a currency, the unit
 *   before or after — while the FULL number goes on to everything standing on this node. That is
 *   the difference from the round(expr, 1) a document used to have to write to get a readable
 *   dew point: that one rounded the maths, and the printed formula then said something its author
 *   did not mean. The vocabulary is format.js's, the same one the sentence template takes.
 *
 *   AND A ROW IS A VALUE. An expression may hold a LIST, every arithmetic and comparison goes down
 *   one element by element, and range/map/fold/scan/cumsum/index/at/where build one and read it
 *   back. That is what lets a day of twenty-four hours, a battery simulated hour by hour and a
 *   year of irradiation on a tilted plane be three formulas rather than three hundred nodes. The
 *   whole vocabulary is in @functions below, which is what describe("formula") answers with.
 *
 * @node       formula   A spreadsheet expression over the other nodes, worked out with its units.
 * @inputs     formula   expr (an expression naming other nodes; it may hold a whole ROW of values, and every operation goes down one)
 * @outputs    formula   value — the result, with its unit · tex — the same expression set as mathematics
 * @options    formula   unit (convert the result, or name a plain one) · format (how the answer is printed: 1 · "int" · "unit" · { decimals, group, locale, style, currency, unit, prefix, suffix }; `locale: "auto"` writes the number in the page's language) · label · block (a section to print it in)
 * @languages  formula   label
 * @functions  formula   if(cond, a, b) · and · or · not · = <> < <= > >= · & joins text · + - * / ^ · min(xs) and max(xs) reduce a row to one value; min(a, b, …) and max(a, b, …) with two or more arguments go element by element, which is how a surplus is written: max(0, pv - load) · sum · avg · count · first · last · abs · sqrt · pow · exp · ln · log · log10 · round(x, decimals) · floor · ceil · clamp(x, lo, hi) · convert(x, "K") · fraction(x) and percent(x), the two doors of the percentage rule · text · number · sin · cos · tan · asin · acos · atan · atan2(y, x) · deg(radians) and rad(degrees), because every angle in this language is in RADIANS · pi · ROWS — a list is an ordinary value and every operation above goes down one, a plain number repeating against it and two lists of different lengths refused by name: range(n) · range(from, to) · range(from, to, step), counted from the first and stopping BEFORE the last · map(xs, expr), where the element is `x` and its position `i` · fold(xs, start, expr), where what is being built is `acc`, answering with the last one · scan(xs, start, expr), the same step answering with EVERY accumulator INCLUDING the one it started from, so it is ONE LONGER than the list and a 24-hour battery gives 25 readings · cumsum(xs) · index(xs, i), counted from 0 · at(xs, t), which reads BETWEEN two positions and stops at the ends · where(cond, a, b), the element-wise if
 * @example    formula   { "type": "formula", "expr": "t * 9/5 + 32", "unit": "°F", "format": 1, "label": { "fi": "Fahrenheit", "en": "Fahrenheit" }, "block": "maths" }
 * @structure formula: the node-type module (dependsOn · prepare · evaluate)
 * @usage  import { formula } from './formula.js';
 * @version-history
 *   v0.5.0 — 2026-09-06 — @functions: the expression vocabulary is declared where the type is, so
 *     describe("formula") answers it instead of an AI guessing whether range() and map() exist.
 *     Twenty names arrived at once in living 0.5.0, which is what made the absence expensive.
 *   v0.4.0 — 2026-09-06 — `label` may be a language map. The EXPRESSION never is: arithmetic is
 *     the same arithmetic in every language, and a formula that differed between them would be
 *     two documents wearing one id.
 *   v0.3.0 — 2026-09-05 — `format` stops being a documented field nothing read: the answer is
 *     printed through it, and the value that flows on is untouched.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parse, symbolsOf } from '../formula-parse.js';
import { evaluate as run, isError, isQuantity } from '../formula-eval.js';
import { toTex } from '../tex.js';
import { formatError } from '../format.js';
import { parseUnit, convert } from '../units.js';

/**
 * THE DECLARED UNIT IS PUT ON THE ANSWER, AND A ROW WEARS IT ELEMENT BY ELEMENT. A formula that
 * answers with 24 hours of yield is one node with one unit, not 24 nodes each declaring kWh — so
 * the unit goes on every element, and a conversion that will not work is refused once, in the
 * words the element gave, rather than 24 times. Without this a row of numbers left the node BARE,
 * and everything downstream then computed in whatever the raw arithmetic had produced: the
 * refusal came out three nodes later, naming dimensions nobody had written.
 * @param {any} out @param {any} unit
 */
function wear(out, unit) {
  if (Array.isArray(out)) {
    const row = [];
    for (const one of out) {
      const got = wear(one, unit);
      if (isError(got)) return got;
      row.push(got);
    }
    return row;
  }
  if (isQuantity(out)) return convert(out, unit);
  if (typeof out === 'number') return { n: out, u: unit };
  return out;
}

export const formula = {
  id: 'formula',

  /** Every name the expression reads. A name this document does not have is caught in validate. */
  dependsOn(node, ctx) {
    const tree = ctx.compiled.tree;
    return tree ? symbolsOf(tree).map((s) => s.split('.')[0]) : [];
  },

  /** Parse the expression and the unit ONCE — a formula is re-evaluated on every move. */
  prepare(node, ctx) {
    const errors = [];
    const tree = parse(node.expr);
    if (isError(tree)) {
      errors.push('the formula ' + String(node.expr) + ' has ' + tree.error);
      ctx.compiled.tree = null;
    } else {
      ctx.compiled.tree = tree;
      ctx.compiled.tex = toTex(tree);
    }
    const unit = parseUnit(node.unit);
    if (isError(unit)) errors.push(unit.error);
    ctx.compiled.unit = isError(unit) ? null : unit;
    const badFormat = formatError(node.format);
    if (badFormat) errors.push(badFormat);
    return errors;
  },

  evaluate(node, ctx) {
    if (!ctx.compiled.tree) return { error: 'This formula could not be read.' };
    const out = run(ctx.compiled.tree, ctx.scope);
    if (isError(out) || !ctx.compiled.unit) return out;
    return wear(out, ctx.compiled.unit);
  },

  /** The second output: the expression, set. */
  fields(node, ctx) { return { tex: ctx.compiled.tex || '' }; },
};
