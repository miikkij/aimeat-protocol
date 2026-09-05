/**
 * @file living/bindings.js
 * @description THE JOIN BETWEEN THE GRAPH AND THE ARRANGEMENT, and it is deliberately thin. The
 *   binding nodes are grouped by the block they write to, each block is given ONE source name,
 *   and the engine registers a resolver for that name with the mosaic. From there it is the kit's
 *   own machinery: a change calls mosaic.refresh(name), the kit hands the fresh record to the
 *   component's set(), and the component does what it always does — a figure counts to its new
 *   number, a chart's marks move, a gauge's needle travels.
 *
 *   THAT IS THE WHOLE REASON THIS FILE IS SHORT. The alternative — reaching into the block's DOM
 *   and writing the new number in — is four lines and throws away every entrance, glide and
 *   count-up the kit gives for nothing, in a library whose entire promise is that the screen
 *   MOVES when you touch it.
 *
 *   SEVERAL BINDINGS ON ONE BLOCK COMPOSE. A chart taking its labels from one node and its series
 *   from another is two binding nodes and one patch, built by prop path, so nothing overwrites
 *   anything. `prop: "."` hands the node's value over as the whole record, for a block that takes
 *   one shape rather than fields.
 * @structure planBindings(doc) · sourceNameFor(blockId) · layoutWithSources(layout, plan) ·
 *   composeBlock(graph, entries, base)
 * @usage
 *   import { planBindings, layoutWithSources, composeBlock } from './bindings.js';
 * @version-history
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { setPath } from './nodes/binding.js';
import { isError, isQuantity } from './formula-eval.js';

/** The source name a bound block is given. Namespaced so it cannot collide with an app's own. */
export function sourceNameFor(blockId) { return 'living:' + String(blockId); }

/**
 * Group the document's binding nodes by the block they write to.
 * @param {{ model?: { nodes?: Record<string, any> } }} doc
 * @returns {Map<string, Array<{ id: string, path: string[], from: string }>>}
 */
export function planBindings(doc) {
  const nodes = ((doc && doc.model) || {}).nodes || {};
  /** @type {Map<string, Array<{ id: string, path: string[], from: string }>>} */
  const plan = new Map();
  for (const id of Object.keys(nodes)) {
    const node = nodes[id] || {};
    if (node.type !== 'binding' || !node.block) continue;
    const list = plan.get(String(node.block)) || [];
    const prop = String(node.prop == null ? '.' : node.prop);
    list.push({ id: id, path: prop === '.' ? [] : prop.split('.').filter(Boolean), from: String(node.from) });
    plan.set(String(node.block), list);
  }
  return plan;
}

/**
 * A copy of the layout with each bound block given its source name. The original record is not
 * touched: the document a person saves is the document they wrote.
 * @param {any} layout @param {Map<string, any[]>} plan
 * @returns {any}
 */
export function layoutWithSources(layout, plan) {
  if (!layout || !Array.isArray(layout.blocks)) return layout;
  const out = Object.assign({}, layout);
  out.blocks = layout.blocks.map(function (block) {
    if (!block || !plan.has(String(block.id))) return block;
    const props = Object.assign({}, block.props || {});
    props.source = sourceNameFor(block.id);
    return Object.assign({}, block, { props: props });
  });
  return out;
}

/** What a block prop takes from a node's value: a quantity gives its number, a refusal gives null. */
export function plainValue(v) {
  if (v == null) return null;
  if (isError(v)) return null;
  if (isQuantity(v)) return v.n;
  return v;
}

/**
 * The record one bound block reads: the props the layout already declared, with every binding
 * on that block written into it by path.
 * @param {any} graph @param {Array<{ path: string[], from: string }>} entries @param {any} [base]
 * @returns {any}
 */
export function composeBlock(graph, entries, base) {
  let whole;
  // A COPY, all the way down. A shallow one would hand the component the layout's own arrays, and
  // writing series.0.values.1 would then edit the document record itself — the thing a person
  // saves — instead of the patch being built for this one paint.
  let copy = {};
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    try { copy = JSON.parse(JSON.stringify(base)); } catch { copy = Object.assign({}, base); }
  }
  const out = copy;
  for (const entry of entries || []) {
    const v = plainValue(graph.valueOf(entry.from));
    if (!entry.path.length) { whole = v; continue; }
    setPath(out, entry.path, v);
  }
  return whole === undefined ? out : whole;
}
