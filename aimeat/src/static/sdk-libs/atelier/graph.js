/**
 * @file atelier/graph.js
 * @description The graph — named nodes and the lines between them, read-only: suunta's map
 *   view (ideas, risks and decisions wired together) generalized so any relationship view — a
 *   capability map, a dependency web, a harmony chart — is DATA the kit draws. One SVG, no
 *   library: nodes are toned pills, edges are lines with optional words, and a node without
 *   coordinates is laid out on a deterministic ring so a bare list of relations still reads.
 *
 *   The bound source resolves to ONE record: { nodes: [{ id, label, tone?, x?, y? }],
 *   edges: [{ from, to, label? }] }. Coordinates are 0..100 in both axes when given.
 * @structure graph(spec) → { el, set, destroy }
 * @usage  AIMEAT.atelier.graph({ target: host, data: { nodes: [{ id: 'a', label: 'Search' },
 *           { id: 'b', label: 'Index' }], edges: [{ from: 'a', to: 'b', label: 'reads' }] } });
 * @version-history
 *   v0.20.0 — 2026-08-28 — Initial (TARGET-074, the harvest: suunta's node map becomes a kit
 *     component).
 */
import { el, clear, resolve, enter } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} label
 * @property {'ok'|'warn'|'err'|'accent'|'plain'} [tone]
 * @property {number} [x]
 * @property {number} [y]
 */
/**
 * @typedef {object} GraphData
 * @property {GraphNode[]} nodes
 * @property {Array<{ from: string, to: string, label?: string }>} [edges]
 */

const W = 720;
const H = 420;
const PAD = 46;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

/** Every node a place: declared coordinates scale to the frame; the rest sit on a ring. */
function place(nodes) {
  const out = new Map();
  const ringed = nodes.filter((n) => typeof n.x !== 'number' || typeof n.y !== 'number');
  let ringIndex = 0;
  for (const node of nodes) {
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      out.set(node.id, {
        x: PAD + (Math.min(Math.max(node.x, 0), 100) / 100) * (W - PAD * 2),
        y: PAD + (Math.min(Math.max(node.y, 0), 100) / 100) * (H - PAD * 2),
      });
    } else {
      const angle = (2 * Math.PI * ringIndex) / Math.max(ringed.length, 1) - Math.PI / 2;
      out.set(node.id, {
        x: W / 2 + Math.cos(angle) * (W / 2 - PAD * 1.6),
        y: H / 2 + Math.sin(angle) * (H / 2 - PAD * 1.4),
      });
      ringIndex++;
    }
  }
  return out;
}

/**
 * The graph.
 * @param {{
 *   target?: string|Element, data?: GraphData|null, title?: string,
 *   onPick?: (node: GraphNode) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: GraphData|null }) => void, destroy: () => void }}
 */
export function graph(spec) {
  const root = el('figure', { class: 'ak-root ak-graph', role: 'img' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  /** @param {GraphData|null|undefined} data */
  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const nodes = data && Array.isArray(data.nodes) ? data.nodes.filter((n) => n && n.id) : [];
    const edges = data && Array.isArray(data.edges) ? data.edges : [];
    if (!nodes.length) {
      const e = spec.empty || {};
      emptyCard = emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
      return;
    }
    root.setAttribute('aria-label', (spec.title ? spec.title + ' — ' : '') + nodes.map((n) => n.label).join(', '));

    const at = place(nodes);
    const node = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'ak-graph__svg', 'aria-hidden': 'true' });

    for (const edge of edges) {
      const a = at.get(edge.from);
      const b = at.get(edge.to);
      if (!a || !b) continue;
      node.appendChild(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'ak-graph__edge' }));
      if (edge.label) {
        const text = svg('text', {
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5,
          class: 'ak-graph__edgelabel', 'text-anchor': 'middle',
        });
        text.textContent = edge.label;
        node.appendChild(text);
      }
    }

    for (const item of nodes) {
      const p = at.get(item.id);
      const width = Math.min(Math.max(item.label.length * 7.6 + 26, 60), 190);
      const g = svg('g', { class: 'ak-graph__node ak-graph__node--' + (item.tone || 'plain'), transform: `translate(${p.x}, ${p.y})` });
      g.appendChild(svg('rect', { x: -width / 2, y: -17, width, height: 34, rx: 17, class: 'ak-graph__pill' }));
      const label = svg('text', { x: 0, y: 5, class: 'ak-graph__label', 'text-anchor': 'middle' });
      label.textContent = item.label.length > 24 ? item.label.slice(0, 23) + '…' : item.label;
      g.appendChild(label);
      if (spec.onPick) {
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.addEventListener('click', () => spec.onPick(item));
        g.addEventListener('keydown', (ev) => {
          if (/** @type {KeyboardEvent} */ (ev).key === 'Enter') spec.onPick(item);
        });
      }
      node.appendChild(g);
    }

    root.appendChild(node);
    enter(root);
  }

  render(spec.data);

  return {
    el: root,
    /** @param {{ data: GraphData|null }} patch */
    set(patch) {
      if (!patch) return;
      render(patch.data);
    },
    destroy() {
      if (emptyCard) emptyCard.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
