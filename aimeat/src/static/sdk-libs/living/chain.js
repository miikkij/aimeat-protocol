/**
 * @file living/chain.js
 * @description THE CHAIN, VISIBLE. A living document is one dependency graph, and the single
 *   thing a person cannot see while using it is the graph itself: which control feeds which
 *   formula, what the machine is watching, where a change travelled. This draws it — and then
 *   FLASHES the nodes that just moved, so a slider pushed at the top of the page is seen arriving
 *   at the sentence at the bottom.
 *
 *   IT IS THE KIT'S OWN GRAPH PART. AIMEAT.atelier.graph draws nodes and edges from a record, and
 *   this hands it one; the tones, the ring layout, the empty state and the accessibility wiring
 *   are the kit's, not a second drawing engine living inside this library. Without the kit on the
 *   page it falls back to a plain readable list of edges, because a chain view that renders
 *   nothing is worse than an ugly one.
 *
 *   A MACHINE BRINGS ITS STATES WITH IT: each state is a node of its own hanging off the machine,
 *   and the one it is in is the toned one. That is the cluster, and it is why the statechart is
 *   not a black box in the middle of the picture.
 *
 *   THE FLASH IS FINITE AND THE VIEWER WINS. One short animation per changed node, removed when
 *   it ends; under reduced motion nothing moves and the final DOM is identical.
 * @structure chain(host, spec) → { el, set, flash, destroy } · chainData(graph)
 * @usage
 *   import { chain } from './chain.js';
 *   const view = chain(host, { graph: g });
 *   view.flash(['t', 'f']);
 * @version-history
 *   v0.2.0 — 2026-09-05 — The 6 % column inset is gone: atelier 0.53.0 measures its own pills and
 *     keeps them inside the frame, so the columns run the full width and the outer labels are
 *     whole because the kit made them so, not because this file guessed at its padding.
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { el, clear, kit, reducedMotion } from './dom.js';
import { statesOf } from './render.js';

/** How long a changed node stays lit. Short enough to read as a pulse, not as a state. */
const FLASH_MS = 900;

/** The tone each kind of node wears, so the picture reads before any label is. */
const TONE = {
  control: 'accent', value: 'ok', source: 'ok', formula: 'plain',
  text: 'plain', binding: 'plain', machine: 'warn',
};

/**
 * How far each node is from the ground: one more than the deepest thing it stands on. This is
 * what turns the picture into a CHAIN read left to right — the kit's graph part lays a node with
 * no coordinates on a ring, which is fine for a handful of relations and unreadable for a
 * dependency graph, where the whole point is the direction the change travels.
 * @param {any} graph
 * @returns {Map<string, number>}
 */
function depths(graph) {
  const out = new Map();
  for (const id of graph.order) {
    let deep = 0;
    for (const on of graph.dependencies(id)) deep = Math.max(deep, (out.get(on) || 0) + 1);
    out.set(id, deep);
  }
  return out;
}

/**
 * The record the graph part draws: one node per model node, one per machine state, an edge for
 * every dependency, and a place for each — laid out in columns by depth, so the ground the
 * document stands on is on the left and what it comes to is on the right.
 * @param {any} graph
 * @returns {{ nodes: Array<any>, edges: Array<any> }}
 */
export function chainData(graph) {
  const nodes = [];
  const edges = [];
  const depth = depths(graph);
  /** Every node's column, machine states one column right of their machine. */
  const column = new Map();
  for (const id of graph.ids) column.set(id, depth.get(id) || 0);

  for (const id of graph.ids) {
    const node = graph.nodeOf(id) || {};
    nodes.push({ id: id, label: node.label ? node.label + ' (' + id + ')' : id, tone: TONE[node.type] || 'plain' });
    if (node.type !== 'machine') continue;
    const active = String(graph.valueOf(id) || '').split('.');
    for (const state of statesOf(node)) {
      const sid = id + ':' + state;
      nodes.push({ id: sid, label: state, tone: active.indexOf(state) >= 0 ? 'accent' : 'plain' });
      column.set(sid, (depth.get(id) || 0) + 1);
      edges.push({ from: id, to: sid });
    }
  }
  for (const edge of graph.edges()) edges.push({ from: edge.from, to: edge.to });

  // Place them: the column decides x, the position within the column decides y, and a column of
  // one sits in the middle of the frame rather than at the top of it.
  const byColumn = new Map();
  for (const n of nodes) {
    const c = column.get(n.id) || 0;
    const list = byColumn.get(c) || [];
    list.push(n);
    byColumn.set(c, list);
  }
  // The columns run the full width of the frame. They used to be inset by 6 % because the kit's
  // graph part centred a pill on its point and padded the frame by less than half a long pill,
  // so a first- or last-column node with a word-length label was cut off by the viewBox; the kit
  // measures its own pills as of atelier 0.53.0 and keeps them inside, so this library stops
  // guessing at somebody else's geometry.
  const last = Math.max(0, ...byColumn.keys());
  for (const [c, list] of byColumn) {
    for (let i = 0; i < list.length; i++) {
      list[i].x = last === 0 ? 50 : (c / last) * 100;
      list[i].y = list.length === 1 ? 50 : (i / (list.length - 1)) * 100;
    }
  }
  return { nodes: nodes, edges: edges };
}

/**
 * The chain view.
 * @param {string|Element} host
 * @param {{ graph: any, title?: string }} spec
 * @returns {{ el: HTMLElement, set: () => void, flash: (ids: string[]) => void, destroy: () => void }}
 */
export function chain(host, spec) {
  const root = el('div', { class: 'ak-living__chain', 'data-ak-part': 'chain' });
  const target = typeof host === 'string' ? document.querySelector(host) : host;
  if (target) target.appendChild(root);

  const k = kit();
  let handle = null;
  let order = [];
  const timers = new Set();

  function paint() {
    const data = chainData(spec.graph);
    order = data.nodes.map(function (n) { return n.id; });
    if (k && typeof k.graph === 'function') {
      if (!handle) handle = k.graph({ target: root, data: data, title: spec.title });
      else handle.set({ data: data });
      return;
    }
    // No kit on the page: the edges as words, which still says what depends on what.
    clear(root);
    root.appendChild(el('ul', { class: 'ak-living__chain-list' }, data.edges.map(function (e) {
      return el('li', { text: e.from + ' → ' + e.to });
    })));
  }
  paint();

  /** The elements the kit's graph part drew, in the order of the nodes array it was given. */
  function nodeElements() {
    return root.querySelectorAll('.ak-graph__node');
  }

  return {
    el: root,

    /** Redraw from the graph's current state — a machine that moved changes which state is toned. */
    set() { paint(); },

    /**
     * Light the nodes that just changed. Finite, and nothing at all under reduced motion.
     * @param {string[]} ids
     */
    flash(ids) {
      paint();
      if (!ids || !ids.length || reducedMotion()) return;
      const drawn = nodeElements();
      for (const id of ids) {
        const at = order.indexOf(id);
        const node = at >= 0 ? drawn[at] : null;
        if (!node) continue;
        node.setAttribute('data-living-flash', 'yes');
        const timer = setTimeout(function () {
          node.removeAttribute('data-living-flash');
          timers.delete(timer);
        }, FLASH_MS);
        timers.add(timer);
      }
    },

    destroy() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      if (handle && handle.destroy) handle.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
