/**
 * @file living/chain-draw.js
 * @description THE FRAME THAT GROWS, and nothing else. The kit's graph part draws a relationship
 *   view in a fixed 720 × 420 box, which is the right frame for a capability map of a dozen things
 *   and the wrong one for a dependency graph: the first living document big enough to be worth
 *   drawing had 159 nodes in 18 columns, the tallest of them 38 deep, and a frame that holds about
 *   eleven per column turned it into a pile of overlapping pills. No arrangement fixes that — the
 *   pills wanted three and a half times the area the frame has.
 *
 *   SO THIS DRAWS THE FRAME AND BORROWS EVERYTHING ELSE. The markup is the kit's own, element for
 *   element and class for class — `ak-graph__svg`, `ak-graph__edge`, `ak-graph__node
 *   ak-graph__node--<tone>`, `ak-graph__pill`, `ak-graph__label` — so the tones, the colours, the
 *   line weight and the flash animation are the kit's stylesheet doing its job at a different size.
 *   There is no second look here, and there is no second set of tokens to keep in step. What is
 *   different is the geometry: the viewBox is measured from the drawing rather than declared, each
 *   column is as wide as its own widest pill, and a short column is centred against a tall one.
 *
 *   A WIRING DIAGRAM IS WIDE, AND THAT IS THE POINT. The drawing keeps its own size and the page
 *   scrolls it, the way a folded drawing is pulled open — rather than being squeezed until its
 *   lettering is four pixels high, which is the other way a large graph is made unreadable.
 *
 *   THE SMALL DOCUMENT KEEPS THE KIT'S OWN FRAME. chain.js asks fitsKitFrame() first, and a
 *   handful of nodes still goes through AIMEAT.atelier.graph with its ring layout and its measured
 *   insets. This is the drawing for the graph that has outgrown it, not a replacement for it.
 * @structure fitsKitFrame(data) · drawChain(host, data) → { el, set, destroy }
 * @usage
 *   import { fitsKitFrame, drawChain } from './chain-draw.js';
 *   if (!fitsKitFrame(data)) handle = drawChain(root, data);
 * @version-history
 *   v0.5.0 — 2026-09-06 — Initial (living 0.5.0: the first document whose chain outgrew the kit's
 *     frame — a household's year, 159 nodes deep).
 */

const NS = 'http://www.w3.org/2000/svg';

/** What the kit's own 720 × 420 frame can hold before its pills start overlapping. */
const KIT_ROWS = 11;
const KIT_COLS = 7;

/** The drawing's own geometry, in the same units the kit's pills are measured in. */
const PILL_H = 24;
const ROW = 32;
const GAP = 26;
const PAD = 22;
/** Past this many characters a label is trimmed, so one long name cannot widen a whole column. */
const LABEL_MAX = 26;
/** Roughly how wide one character of the label is at the kit's pill font. */
const CHAR_W = 6.6;

/** The words a pill actually carries. */
function words(label) {
  const text = String(label == null ? '' : label);
  return text.length > LABEL_MAX ? text.slice(0, LABEL_MAX - 1) + '…' : text;
}

function pillWidth(label) { return Math.max(56, words(label).length * CHAR_W + 22); }

function node(name, attrs) {
  const el = document.createElementNS(NS, name);
  for (const key of Object.keys(attrs || {})) el.setAttribute(key, String(attrs[key]));
  return el;
}

/**
 * Would this drawing fit the frame the kit draws in? A graph that does keeps the kit's own layout,
 * which is the better picture at that size.
 * @param {{ nodes: Array<{ col?: number, row?: number }> }} data
 * @returns {boolean}
 */
export function fitsKitFrame(data) {
  const nodes = (data && data.nodes) || [];
  if (!nodes.length) return true;
  let cols = 0;
  const perColumn = new Map();
  for (const n of nodes) {
    const c = n.col || 0;
    cols = Math.max(cols, c + 1);
    perColumn.set(c, (perColumn.get(c) || 0) + 1);
  }
  return cols <= KIT_COLS && Math.max(...perColumn.values()) <= KIT_ROWS;
}

/**
 * Draw the chain in a frame measured from the chain itself.
 * @param {Element} host
 * @param {{ nodes: Array<any>, edges: Array<any> }} data
 * @param {{ title?: string }} [opts]
 * @returns {{ el: Element, set: (patch: { data: any }) => void, destroy: () => void }}
 */
export function drawChain(host, data, opts) {
  const root = document.createElement('div');
  root.className = 'ak-root ak-graph ak-living__chain-draw';
  root.setAttribute('role', 'img');
  host.appendChild(root);

  function render(next) {
    while (root.firstChild) root.removeChild(root.firstChild);
    const nodes = (next && next.nodes) || [];
    const edges = (next && next.edges) || [];
    if (!nodes.length) return;
    root.setAttribute('aria-label', (((opts || {}).title ? opts.title + ' — ' : ''))
      + nodes.map((n) => n.label).join(', '));

    // ── The columns: each one as wide as its own widest pill, and no wider. Giving every column
    // the width of the widest pill in the drawing pushed sixteen columns of short ids out to the
    // width of the two columns of sentences.
    const byColumn = new Map();
    for (const n of nodes) {
      const c = n.col || 0;
      const list = byColumn.get(c) || [];
      list.push(n);
      byColumn.set(c, list);
    }
    const columns = [...byColumn.keys()].sort((a, b) => a - b);
    const width = new Map();
    for (const c of columns) width.set(c, Math.max(...byColumn.get(c).map((n) => pillWidth(n.label))));
    const centre = new Map();
    let x = PAD;
    for (const c of columns) {
      centre.set(c, x + width.get(c) / 2);
      x += width.get(c) + GAP;
    }
    const frameW = x - GAP + PAD;
    const tallest = Math.max(...columns.map((c) => byColumn.get(c).length));
    const frameH = PAD * 2 + Math.max(1, tallest) * ROW;

    // A short column is centred against the tall ones, so the picture reads as a spine rather
    // than as everything hanging from the top edge.
    const place = new Map();
    for (const c of columns) {
      const list = byColumn.get(c);
      const top = (frameH - list.length * ROW) / 2 + ROW / 2;
      list.forEach((n, i) => place.set(n.id, { x: centre.get(c), y: top + i * ROW, w: width.get(c) }));
    }

    const svg = node('svg', {
      viewBox: '0 0 ' + Math.round(frameW) + ' ' + Math.round(frameH),
      width: Math.round(frameW), height: Math.round(frameH),
      class: 'ak-graph__svg', 'aria-hidden': 'true',
    });

    // ── The edges first, so a pill always sits on top of the lines that reach it. A curve, not a
    // straight line: with two hundred of them the straight ones read as a hatch.
    for (const edge of edges) {
      const a = place.get(edge.from);
      const b = place.get(edge.to);
      if (!a || !b) continue;
      const ax = a.x + a.w / 2;
      const bx = b.x - b.w / 2;
      const bend = Math.max(18, (bx - ax) / 2);
      svg.appendChild(node('path', {
        d: 'M ' + ax + ' ' + a.y + ' C ' + (ax + bend) + ' ' + a.y + ', '
          + (bx - bend) + ' ' + b.y + ', ' + bx + ' ' + b.y,
        fill: 'none', class: 'ak-graph__edge',
      }));
    }

    // ── The pills, IN THE ORDER THEY WERE GIVEN, because the flash indexes them by position.
    for (const n of nodes) {
      const at = place.get(n.id);
      if (!at) continue;
      const g = node('g', {
        class: 'ak-graph__node ak-graph__node--' + (n.tone || 'plain'),
        transform: 'translate(' + at.x + ', ' + at.y + ')',
      });
      g.appendChild(node('rect', {
        x: -at.w / 2, y: -PILL_H / 2, width: at.w, height: PILL_H, rx: PILL_H / 2,
        class: 'ak-graph__pill',
      }));
      const label = node('text', { x: 0, y: 4, class: 'ak-graph__label', 'text-anchor': 'middle' });
      label.textContent = words(n.label);
      g.appendChild(label);
      svg.appendChild(g);
    }
    root.appendChild(svg);
  }

  render(data);

  return {
    el: root,
    set(patch) { if (patch && patch.data) render(patch.data); },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
