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
 *   NO PILL LEAVES THE FRAME. A pill is centred on its point and can be 190 units wide, while
 *   the frame's own padding was 46 — so a word-length label in the leftmost or rightmost column
 *   was cut off by the viewBox, and every caller was left to invent its own inset. The widest
 *   pill is measured first, the layout insets by half of it, and each pill is then anchored
 *   inside the frame as a belt. The viewBox scales, so this holds at every rendered size.
 * @version-history
 *   v0.53.0 — 2026-09-05 — The pill is kept inside the frame: pillWidth() measures the label
 *     that is actually drawn, the layout insets by half the widest one, and a final clamp
 *     anchors each pill on both axes. A caller no longer needs a padding fudge of its own.
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
/** The pill's own box, in viewBox units, and the breathing room kept outside it. */
const PILL_H = 34;
const GUTTER = 4;
/** Past this many characters the label is trimmed, so the pill has a ceiling. */
const LABEL_MAX = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

/** The words a pill actually carries — the label, trimmed where it would not fit. */
export function pillLabel(label) {
  const text = String(label == null ? '' : label);
  return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX - 1) + '…' : text;
}

/**
 * How wide a pill is, measured off the label that is DRAWN rather than the one that was given:
 * the layout below insets by half the widest of these, which is what keeps a node in an outer
 * column whole instead of cut off by the viewBox.
 * @param {string} label @returns {number}
 */
export function pillWidth(label) {
  return Math.min(Math.max(pillLabel(label).length * 7.6 + 26, 60), 190);
}

/** Keep a number inside a pair of bounds, with a sane answer when the bounds cross. */
function clamp(v, lo, hi) {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Every node a place: declared coordinates scale to the frame; the rest sit on a ring. The frame
 * is inset sideways by half the widest pill, and each pill is anchored inside the viewBox after
 * that, so neither a long label in the first column nor a ring point can leave the picture.
 * @param {GraphNode[]} nodes @param {Map<string, number>} widths
 */
function place(nodes, widths) {
  const out = new Map();
  let widest = 0;
  for (const w of widths.values()) widest = Math.max(widest, w);
  const padX = Math.min(Math.max(PAD, widest / 2 + GUTTER), W / 2 - GUTTER);
  const padY = Math.max(PAD, PILL_H / 2 + GUTTER);
  const ringed = nodes.filter((n) => typeof n.x !== 'number' || typeof n.y !== 'number');
  let ringIndex = 0;
  for (const node of nodes) {
    let x;
    let y;
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      x = padX + (Math.min(Math.max(node.x, 0), 100) / 100) * (W - padX * 2);
      y = padY + (Math.min(Math.max(node.y, 0), 100) / 100) * (H - padY * 2);
    } else {
      const angle = (2 * Math.PI * ringIndex) / Math.max(ringed.length, 1) - Math.PI / 2;
      x = W / 2 + Math.cos(angle) * (W / 2 - padX);
      y = H / 2 + Math.sin(angle) * (H / 2 - padY);
      ringIndex++;
    }
    const half = (widths.get(node.id) || 60) / 2;
    out.set(node.id, {
      x: clamp(x, half + GUTTER, W - half - GUTTER),
      y: clamp(y, PILL_H / 2 + GUTTER, H - PILL_H / 2 - GUTTER),
    });
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

    const widths = new Map();
    for (const item of nodes) widths.set(item.id, pillWidth(item.label));
    const at = place(nodes, widths);
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
      const width = widths.get(item.id);
      const g = svg('g', { class: 'ak-graph__node ak-graph__node--' + (item.tone || 'plain'), transform: `translate(${p.x}, ${p.y})` });
      g.appendChild(svg('rect', { x: -width / 2, y: -PILL_H / 2, width, height: PILL_H, rx: PILL_H / 2, class: 'ak-graph__pill' }));
      const label = svg('text', { x: 0, y: 5, class: 'ak-graph__label', 'text-anchor': 'middle' });
      label.textContent = pillLabel(item.label);
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
