/**
 * @file living/nodes/value.js
 * @description A NAMED QUANTITY: the thing everything else in the document stands on. It holds a
 *   number (or a piece of text, a truth, a list), it may carry a unit, and it may say the range
 *   and step a person is allowed to move it through — which is what lets a control node put a
 *   slider on it without being told the bounds twice.
 *
 *   IT IS THE ONLY NODE A PERSON WRITES TO DIRECTLY. A control moves a value, a machine's entry
 *   action assigns to a value, living.set(id, x) sets a value; everything else in the graph is
 *   computed and cannot be written. That is deliberate: one writable kind means the recompute has
 *   one place to start from and a document can never disagree with itself about where a number
 *   came from.
 *
 * @node       value     A named quantity: the writable ground the rest of the document stands on.
 * @inputs     value     value (the quantity itself, a literal — never a reference)
 * @outputs    value     value — the number with its unit, or the text, truth or list it holds
 * @options    value     unit · min · max · step · format (how it is printed: 1 · "int" · "unit" · an object; `locale: "auto"` writes the number in the page's language) · label
 * @languages  value     label
 * @example    value     { "type": "value", "value": 22, "unit": "°C", "min": -20, "max": 40, "step": 0.5, "format": 1, "label": { "fi": "Lämpötila", "en": "Temperature" } }
 * @structure value: the node-type module (dependsOn · prepare · evaluate · coerce)
 * @usage  import { value } from './value.js';
 * @version-history
 *   v0.4.0 — 2026-09-06 — `label` may be a language map; the value itself is never one, because a
 *     quantity is the same quantity in every language.
 *   v0.3.0 — 2026-09-05 — `format` is read and refused by name when it is not one this build
 *     knows; the printing itself is format.js's, and the value held here is untouched by it.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parseUnit } from '../units.js';
import { formatError } from '../format.js';
import { isError } from '../formula-eval.js';

/** Put a raw literal and a unit together into the value the graph carries. */
export function wrapValue(raw, unit) {
  if (raw == null) return unit ? { n: 0, u: unit } : 0;
  if (typeof raw === 'number') return unit ? { n: raw, u: unit } : raw;
  if (typeof raw === 'boolean' || typeof raw === 'string' || Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && typeof raw.n === 'number') return raw;
  return raw;
}

export const value = {
  id: 'value',
  settable: true,

  /** A value stands on nothing: it is where the graph starts. */
  dependsOn() { return []; },

  /** Read the unit once and seed the store, so a rebuild does not forget where the slider was. */
  prepare(node, ctx) {
    const errors = [];
    const unit = parseUnit(node.unit);
    if (isError(unit)) errors.push(unit.error);
    ctx.compiled.unit = isError(unit) ? null : unit;
    const badFormat = formatError(node.format);
    if (badFormat) errors.push(badFormat);
    if (!ctx.state.values.has(ctx.id)) {
      ctx.state.values.set(ctx.id, wrapValue(node.value, ctx.compiled.unit));
    }
    return errors;
  },

  evaluate(node, ctx) { return ctx.state.values.get(ctx.id); },

  /**
   * What a person, a control or a machine's action is allowed to put here: the number is kept
   * inside min and max when the node declared them, and the unit is the node's own — a slider
   * reports 31, not 31 of whatever it thought the unit was.
   */
  coerce(node, ctx, raw) {
    let v = raw;
    if (v != null && typeof v === 'object' && typeof v.n === 'number') v = v.n;
    if (typeof v === 'number') {
      if (typeof node.min === 'number') v = Math.max(node.min, v);
      if (typeof node.max === 'number') v = Math.min(node.max, v);
      return wrapValue(v, ctx.compiled.unit);
    }
    if (typeof node.value === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      return this.coerce(node, ctx, Number(v));
    }
    return v;
  },
};
