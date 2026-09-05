/**
 * @file living/nodes/control.js
 * @description THE PERSON'S HAND ON THE GRAPH. Everything else in a living document flows one
 *   way — a value moves, formulas follow, the screen catches up. A control is the door in the
 *   other direction: a slider, a switch, a pick, a number or a line of text, bound to ONE value
 *   node, so a person moves the same quantity an agent would have moved and the recompute cannot
 *   tell the difference.
 *
 *   IT DECLARES; IT DOES NOT DRAW. The kind and the target are the record; the row on the screen
 *   is built by render.js out of the kit's own form parts, and the bounds come from the VALUE the
 *   control is bound to (min, max, step, label, unit) rather than being typed a second time here.
 *   That is why moving a slider can never disagree with what the value will accept.
 *
 *   A PICK'S OPTIONS ARE A VALUE AND A LABEL, and only the label is words: the value is what the
 *   document stores and what its formulas compare against, so it stays the same in every language
 *   while what the person reads on the option changes with the page.
 *
 * @node       control   A slider, switch, pick, number or text field bound to one value node.
 * @inputs     control   target (the value node this control moves)
 * @outputs    control   value — what the target holds now, so a template can read the control by name
 * @options    control   kind=slider|toggle|pick|number|text · label · options (for pick) · block (a section to put it in)
 * @languages  control   label · options[].label
 * @example    control   { "type": "control", "kind": "slider", "target": "t", "label": { "fi": "Lämpötila", "en": "Temperature" }, "block": "controls" }
 * @structure control: the node-type module (dependsOn · prepare · evaluate)
 * @usage  import { control } from './control.js';
 * @version-history
 *   v0.4.0 — 2026-09-06 — `label` and a pick option's `label` may be a language map; an option's
 *     `value` may not, because it is what the document stores.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

/** The shapes a control may take. An unknown kind is refused by name in validate(). */
export const CONTROL_KINDS = ['slider', 'toggle', 'pick', 'number', 'text'];

export const control = {
  id: 'control',

  /** A control READS its target so it can show where the value is now. */
  dependsOn(node) { return node.target ? [String(node.target)] : []; },

  prepare(node, ctx) {
    const errors = [];
    const kind = String(node.kind || 'slider');
    if (CONTROL_KINDS.indexOf(kind) < 0) {
      errors.push('a control of kind "' + kind + '"; this document has ' + CONTROL_KINDS.join(', '));
    }
    if (!node.target) errors.push('a control with no target to move');
    if (kind === 'pick' && !Array.isArray(node.options)) {
      errors.push('a pick control with no options to pick from');
    }
    ctx.compiled.kind = kind;
    return errors;
  },

  /** A control's own output is its target's value: the control IS that quantity, seen. */
  evaluate(node, ctx) {
    return node.target ? ctx.scope.get(String(node.target)) : undefined;
  },
};
