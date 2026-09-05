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
 *   NO FIELD OF A BINDING IS EVER A LANGUAGE MAP, which is why its @languages line says none. A
 *   binding is a wire: the words at the node end belong to that node, and the words at the block
 *   end are the block's own props, which the arrangement carries in every language it was written
 *   in and mount() reads through the same door.
 *
 * @node       binding   One block prop on this screen reads one node.
 * @inputs     binding   from (the node whose output the prop takes)
 * @outputs    binding   value — the same value, so the chain view can show where it went
 * @options    binding   block (a layout block id) · prop (a prop path on that block, dots allowed)
 * @languages  binding   none
 * @example    binding   { "type": "binding", "block": "dial", "prop": "value", "from": "t" }
 * @structure binding: the node-type module (dependsOn · prepare · evaluate) · setPath ·
 *   unboundBlocks(surface, blockIds)
 * @usage  import { binding } from './binding.js';
 * @version-history
 *   v0.2.0 — 2026-09-05 — The hand-kept BOUND_COMPONENTS list is gone. Which components read a
 *     bound record is the kit's answer, asked of the mounted mosaic through its blocks()
 *     accessor, so a newer kit with more of them needs no edit here and this library can never
 *     be wrong about the kit's own vocabulary.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */

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
 * THE ONE QUESTION THIS LIBRARY IS NOT ALLOWED TO ANSWER ITSELF: which of the arrangement's
 * blocks actually read a bound record. It used to be a copy of the `bound(...)` cases in the
 * kit's mosaic.js kept here, and a copy of somebody else's list is a list that goes stale while
 * still claiming to be current. The mounted mosaic now says so itself.
 *
 * Answers with the block ids a binding was aimed at that the kit did NOT bind — which is the
 * refusal a person needs, in the kit's own words rather than in this library's guess.
 * @param {{ blocks?: () => Array<{ id: string, component: string, bound: boolean }> }} surface
 * @param {Iterable<string>} blockIds  the blocks this document's bindings write to
 * @returns {Array<{ id: string, component: string }>}
 */
export function unboundBlocks(surface, blockIds) {
  if (!surface || typeof surface.blocks !== 'function') return [];
  const mounted = new Map();
  for (const b of surface.blocks()) mounted.set(String(b.id), b);
  const out = [];
  for (const id of blockIds) {
    const block = mounted.get(String(id));
    // A block the arrangement does not hold at all is validate()'s refusal, not this one's.
    if (block && !block.bound) out.push({ id: block.id, component: block.component });
  }
  return out;
}

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
