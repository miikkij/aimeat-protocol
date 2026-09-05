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
 * @node     formula   A spreadsheet expression over the other nodes, worked out with its units.
 * @inputs   formula   expr (an expression naming other nodes)
 * @outputs  formula   value — the result, with its unit · tex — the same expression set as mathematics
 * @options  formula   unit (convert the result, or name a plain one) · format · label · block (a section to print it in)
 * @example  formula   { "type": "formula", "expr": "t * 9/5 + 32", "unit": "°F", "label": "Fahrenheit", "block": "maths" }
 * @structure formula: the node-type module (dependsOn · prepare · evaluate)
 * @usage  import { formula } from './formula.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parse, symbolsOf } from '../formula-parse.js';
import { evaluate as run, isError, isQuantity } from '../formula-eval.js';
import { toTex } from '../tex.js';
import { parseUnit, convert } from '../units.js';

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
    return errors;
  },

  evaluate(node, ctx) {
    if (!ctx.compiled.tree) return { error: 'This formula could not be read.' };
    const out = run(ctx.compiled.tree, ctx.scope);
    if (isError(out) || !ctx.compiled.unit) return out;
    if (isQuantity(out)) return convert(out, ctx.compiled.unit);
    if (typeof out === 'number') return { n: out, u: ctx.compiled.unit };
    return out;
  },

  /** The second output: the expression, set. */
  fields(node, ctx) { return { tex: ctx.compiled.tex || '' }; },
};
