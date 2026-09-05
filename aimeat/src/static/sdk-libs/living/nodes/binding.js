/**
 * @file living/nodes/binding.js
 * @description WHERE A NUMBER MEETS THE SCREEN. A binding says that one prop of one layout block
 *   reads one node — the gauge's reading is t, the chart's series is the history, the figure's
 *   value is the result of the formula — and that is the whole of the connection between the
 *   graph and the arrangement.
 *
 *   IT GOES THROUGH THE MOSAIC'S OWN DOOR. A bound block is given a source name, the engine
 *   registers a resolver for it, and a change calls the mosaic's refresh() — so the block is
 *   updated the way the kit updates any bound block, which means the kit's own motion runs: a
 *   figure counts to its new number, a chart's rows glide. Writing into the DOM ourselves would
 *   have been three lines shorter and would have thrown all of that away.
 *
 *   THE PROP IS A PATH, so a nested shape (series.0.values) is reachable without a new node type,
 *   and several bindings on the same block compose into one patch rather than fighting over it.
 *
 * @node     binding   One block prop on this screen reads one node.
 * @inputs   binding   from (the node whose output the prop takes)
 * @outputs  binding   value — the same value, so the chain view can show where it went
 * @options  binding   block (a layout block id) · prop (a prop path on that block, dots allowed)
 * @example  binding   { "type": "binding", "block": "dial", "prop": "value", "from": "t" }
 * @structure binding: the node-type module (dependsOn · prepare · evaluate) · BOUND_COMPONENTS
 * @usage  import { binding } from './binding.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

/**
 * The mosaic block components that take a bound source. Mirrors the `bound(...)` cases in the
 * kit's mosaic.js — it is here so validate() can say "that block does not read data" instead of
 * letting a binding land nowhere in silence. A newer kit build with more of them makes this list
 * short, never wrong: an unlisted component still works at run time, it is only unvalidated.
 */
export const BOUND_COMPONENTS = [
  'statRow', 'figure', 'rating', 'steps', 'list', 'cardGrid', 'table', 'timeline',
  'chart', 'matrix', 'graph', 'waveform', 'scene3d', 'gauge', 'console', 'atlas', 'map',
  'health', 'queue', 'kanban', 'plan', 'schedule', 'crt', 'ring', 'crew', 'poll', 'keys',
  'thread', 'calendar', 'priceTable', 'facets', 'carousel', 'sortable', 'notices',
];

export const binding = {
  id: 'binding',

  dependsOn(node) { return node.from ? [String(node.from)] : []; },

  prepare(node, ctx) {
    const errors = [];
    if (!node.block) errors.push('a binding with no block to write to');
    if (!node.prop) errors.push('a binding with no prop to write');
    if (!node.from) errors.push('a binding with no node to read');
    ctx.compiled.path = String(node.prop || '').split('.').filter(Boolean);
    return errors;
  },

  evaluate(node, ctx) {
    return node.from ? ctx.scope.get(String(node.from)) : undefined;
  },
};

/**
 * Write one value at a dotted path inside a plain object, making the boxes on the way.
 * @param {object} into @param {string[]} path @param {any} v
 */
export function setPath(into, path, v) {
  if (!path.length) return;
  let at = into;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (at[key] == null || typeof at[key] !== 'object') at[key] = /^\d+$/.test(path[i + 1]) ? [] : {};
    at = at[key];
  }
  at[path[path.length - 1]] = v;
}
