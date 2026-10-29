/**
 * @file atelier/ornament-lines.js
 * @description THE LINE FIGURES: ornaments that run the width of their element — the vine bar (a
 *   progress bar with two strands twining round it, the vine growing with the value and flowering
 *   at the end), the vine rail, the rosette divider, the braid, the twisted cord with tassels and
 *   the guilloche strip. INLINE figures for ornament.js: each puts one strip of SVG into its
 *   element at the element's width and redraws, settled, when the width changes.
 * @structure fillMount · LINE_FIGURES = { 'vine-bar', 'vine-rail', divider, braid, cord, 'guilloche-strip' }
 * @usage
 *   const bar = AIMEAT.atelier.ornament(el, 'vine-bar', { value: 0.3 });
 *   bar.set(0.75);   // the vine grows to three quarters; at 1 the tip flowers
 * @version-history
 *   v0.1.0 — 2026-10-29 — Initial: ported from the accepted ornament canvas.
 */
import { R, pathOf, lengthOf, turtle, line, helix, helixLeaves, leafPath } from './ornament-geo.js';
import { drawing, svgEl } from './ornament-svg.js';

const PI = Math.PI;
const TAU = 2 * PI;

/**
 * One strip of SVG across the element, drawn at its width and redrawn settled when it changes.
 * @param {HTMLElement} host
 * @param {number} height
 * @param {string} cls
 * @param {{ speed: number, delay: number }} opts
 * @param {(d: ReturnType<typeof drawing>, W: number, H: number) => void} draw
 */
export function fillMount(host, height, cls, opts, draw) {
  const box = document.createElement('span');
  box.className = 'ak-orn-strip ' + cls;
  box.setAttribute('aria-hidden', 'true');
  box.style.height = height + 'px';
  host.appendChild(box);
  let lastW = -1;
  let frame = 0;
  const render = (animate) => {
    const W = Math.round(box.getBoundingClientRect().width) || host.clientWidth || 0;
    lastW = W;
    box.textContent = '';
    if (W < 40) return;
    draw(drawing(box, W, height, { animate, speed: opts.speed, delay: opts.delay }), W, height);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (Math.abs(Math.round(box.getBoundingClientRect().width) - lastW) < 2) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => render(false));
  }) : null;
  if (ro) ro.observe(box);
  return {
    render,
    teardown: () => { if (ro) ro.disconnect(); cancelAnimationFrame(frame); box.remove(); },
  };
}

/** The vine bar: the strands grow with the value, the leaves open as the tip passes, the end flowers. */
function mountVineBar(host, p, opts) {
  let value = p.value;
  /** @type {null | ((v: number, settle?: boolean) => void)} */
  let apply = null;
  const strip = fillMount(host, 96, 'ak-orn-strip--bar', opts, (d, W) => {
    const y = 48;
    const base = line(0, y, W, y);
    const L = base.L;
    const period = Math.max(70, Math.min(110, W / 6));
    const amp = 21;
    const k = TAU / period;
    const x0 = 20;
    const bw = W - 40;
    /** @type {Array<{ el: SVGElement, s0: number, s1: number, len: number }>} */
    const segs = [];
    const back = d.group(d.svg);
    const budBack = d.group(d.svg);
    svgEl('rect', { x: x0, y: y - 11, width: R(bw), height: 22, rx: 11, class: 'ak-orn-track' }, d.svg);
    let hatch = '';
    for (let x = x0 + 12; x <= x0 + bw - 14; x += 6) hatch += 'M' + R(x) + ' ' + (y + 7) + 'l6 -14';
    svgEl('path', { d: hatch, class: 'ak-orn-hatch', 'stroke-width': 0.8 }, d.svg);
    const fill = svgEl('rect', { x: x0 + 3, y: y - 8, width: 0, height: 16, rx: 8, class: 'ak-orn-fill' }, d.svg);
    const front = d.group(d.svg);
    const add = (parent, gs, role, width) => {
      for (const g of gs) {
        const el = svgEl('path', { d: g.d, class: 'ak-orn-' + role + ' ak-orn-dash', 'stroke-width': width }, parent);
        /** @type {any} */ (el).style.strokeDasharray = String(g.len);
        /** @type {any} */ (el).style.strokeDashoffset = String(g.len);
        segs.push({ el, s0: g.s0, s1: g.s1, len: g.len });
      }
    };
    for (const [a, ph, wf, wb, wg] of [[amp, 0, 2.4, 1.6, 6], [16, PI, 1.2, 1, 4]]) {
      const gs = helix(base.at, L, a, period, ph, 2);
      add(back, gs.filter((g) => !g.front), 'vback', wb);
      const fr = gs.filter((g) => g.front);
      add(front, fr, 'gap', wg);
      add(front, fr, 'vine', wf);
    }
    /** @type {Array<{ el: SVGElement, s: number }>} */
    const leaves = [];
    if (p.leaves > 0) {
      for (const q of helixLeaves(base.at, L, amp, period, 0, { size: 13, alpha: 0.95, from: 10, endGap: 6 })) {
        const outer = svgEl('g', { transform: 'translate(' + R(q.x) + ' ' + R(q.y) + ') rotate(' + R(q.ang * 180 / PI) + ')' }, front);
        const inner = svgEl('g', { class: 'ak-orn-pop' }, outer);
        svgEl('path', { d: leafPath(q.size), class: 'ak-orn-leaf' }, inner);
        svgEl('path', { d: 'M' + R(q.size * 0.12) + ' 0L' + R(q.size * 0.8) + ' 0', class: 'ak-orn-rib' }, inner);
        leaves.push({ el: inner, s: q.s });
      }
    }
    const budFront = d.group(d.svg);
    const buds = [budBack, budFront].map((g) => {
      const bloom = svgEl('g', { class: 'ak-orn-bloom' }, g);
      for (let i = 0; i < 5; i++) svgEl('path', { d: leafPath(9), class: 'ak-orn-leaf', transform: 'rotate(' + 72 * i + ') translate(2.5 0)' }, bloom);
      svgEl('circle', { r: 3.2, class: 'ak-orn-vdot' }, g);
      return { g, bloom };
    });
    apply = (v) => {
      const rv = 14 + v * (L - 14);
      for (const s of segs) {
        const f = Math.max(0, Math.min(1, (rv - s.s0) / Math.max(1, s.s1 - s.s0)));
        /** @type {any} */ (s.el).style.strokeDashoffset = String(Math.round(s.len * (1 - f)));
      }
      for (const lf of leaves) lf.el.classList.toggle('ak-orn-open', lf.s <= rv - 4);
      fill.setAttribute('width', String(R(Math.max(0, (bw - 6) * v))));
      const b = base.at(rv);
      const th = k * rv;
      const o = amp * Math.sin(th);
      const inFront = Math.cos(th) >= 0;
      buds.forEach((bd, i) => {
        bd.g.setAttribute('transform', 'translate(' + R(b.x + b.nx * o) + ' ' + R(b.y + b.ny * o) + ')');
        bd.g.style.display = (i === 1) === inFront ? '' : 'none';
        bd.bloom.classList.toggle('ak-orn-open', v >= 0.995);
      });
    };
    // Every drawing, a redraw after a resize included, stands at the current value.
    apply(value);
  });
  const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  return {
    render: (animate) => {
      strip.render(animate);
      if (!apply) return;
      if (animate) {
        apply(0);
        requestAnimationFrame(() => requestAnimationFrame(() => apply && apply(value)));
      } else apply(value);
    },
    set: (v) => { value = clamp(v); if (apply) apply(value); },
    teardown: strip.teardown,
  };
}

/** Two strands round a hairline, fully grown, beaded at the ends. */
function drawRail(d, W) {
  const y = 14;
  const base = line(8, y, W - 8, y);
  const T = Math.max(1.2, Math.min(3, W / 300));
  const back = d.group(d.svg);
  d.stroke(d.svg, 'M8 ' + y + 'H' + R(W - 8), 'ln', 1, Math.ceil(W), 0, 0.8);
  const front = d.group(d.svg);
  d.chain(back, front, helix(base.at, base.L, 7, 44, 0, 1.5), base.L, 0.3, T, [['gap', 4], ['vine', 1.4]], ['vback', 1]);
  d.chain(back, front, helix(base.at, base.L, 6, 44, PI, 1.5), base.L, 0.45, T, [['gap', 4], ['vine', 1]], ['vback', 0.8]);
  for (const q of helixLeaves(base.at, base.L, 7, 44, 0, { size: 7.5, alpha: 0.95, every: 2, from: 6, endGap: 6 })) d.leaf(front, q.x, q.y, q.ang, q.size, 0.3 + T * q.s / base.L);
  d.bead(d.svg, 5, y, 3, 0.1);
  d.bead(d.svg, W - 5, y, 3, 0.3 + T);
}

/** A rosette in the middle, a hairline each way with a strand round it, a curl at each end. */
function drawDivider(d, W, H, leaves) {
  const y = H / 2;
  const c = W / 2;
  const reach = Math.min(W / 2 - 40, 420);
  const d0 = 0.4;
  const T = Math.max(1.2, Math.min(2.4, reach / 180));
  const ends = [c + reach, c - reach];
  const back = d.group(d.svg);
  d.stroke(d.svg, 'M' + R(c + 14) + ' ' + R(y) + 'H' + R(ends[0]), 'ln', 1, Math.ceil(reach) + 2, 0.2, 1);
  d.stroke(d.svg, 'M' + R(c - 14) + ' ' + R(y) + 'H' + R(ends[1]), 'ln', 1, Math.ceil(reach) + 2, 0.2, 1);
  const front = d.group(d.svg);
  for (const bs of [line(c + 14, y, ends[0], y), line(c - 14, y, ends[1], y, true)]) {
    d.chain(back, front, helix(bs.at, bs.L, 6, 42, 0, 1.5), bs.L, d0, T, [['gap', 4], ['vine', 1.6]], ['vback', 1]);
    if (leaves > 0) {
      for (const q of helixLeaves(bs.at, bs.L, 6, 42, 0, { size: 7.5, alpha: 0.95, every: leaves > 1.5 ? 1 : 2, from: 8, endGap: 10 })) {
        d.leaf(front, q.x, q.y, q.ang, q.size, d0 + T * q.s / bs.L + 0.1);
      }
    }
  }
  const cr = turtle(ends[0], y, 0, 40, (u) => -(0.02 + 0.42 * u * u));
  const cl = turtle(ends[1], y, PI, 40, (u) => 0.02 + 0.42 * u * u);
  d.stroke(d.svg, cr.d, 'ln', 1.2, cr.len, d0 + T - 0.2, 0.7);
  d.stroke(d.svg, cl.d, 'ln', 1.2, cl.len, d0 + T - 0.2, 0.7);
  d.rosette(d.svg, c, y, 6, 3, 5, 9, 0.1);
}

/** n strands round one base, evenly out of phase. */
function rope(d, back, front, base, n, amp, period, t0, T, fronts, backRole) {
  for (let j = 0; j < n; j++) d.chain(back, front, helix(base.at, base.L, amp, period, j * TAU / n, 1.5), base.L, t0, T, fronts, backRole);
}

/** A three-strand braid with a knot at each end. */
function drawBraid(d, W, H, strands) {
  const y = H / 2;
  const base = line(14, y, W - 14, y);
  const back = d.group(d.svg);
  const front = d.group(d.svg);
  rope(d, back, front, base, Math.round(strands), 6, 34, 0.4, Math.max(1.2, Math.min(3, W / 300)), [['gap', 7], ['ln', 4], ['hi', 1]], ['dim', 3]);
  for (const x of [8, W - 8]) {
    const g = d.bead(d.svg, x, y, 2.6, x < W / 2 ? 0.3 : 2.4);
    g.insertBefore(svgEl('circle', { r: 7, class: 'ak-orn-ring' }), g.firstChild);
  }
}

/** Two strands twisted into a cord, a tassel hanging from each end. */
function drawCord(d, W) {
  const y = 16;
  const base = line(18, y, W - 18, y);
  const back = d.group(d.svg);
  const front = d.group(d.svg);
  const T = Math.max(1, Math.min(2.4, W / 300));
  rope(d, back, front, base, 2, 3.5, 20, 0.3, T, [['gap', 5], ['ln', 2.4], ['hi', 0.8]], ['dim', 1.6]);
  let tassel = '';
  for (let i = -3; i <= 3; i++) tassel += 'M' + R(i * 1.6) + ' 11L' + R(i * 2.6) + ' 44';
  for (const [x, del] of [[12, 0.3], [W - 12, 0.3 + T]]) {
    const g = d.bead(d.svg, x, y, 4.5, del);
    svgEl('path', { d: tassel, class: 'ak-orn-ln', 'stroke-width': 1 }, g);
    svgEl('path', { d: 'M-5 9H5', class: 'ak-orn-ln', 'stroke-width': 3 }, g);
  }
}

/** Eight waves braided along a line between two rules. */
function drawStrip(d, W, H) {
  const y = H / 2;
  d.stroke(d.svg, 'M4 3H' + R(W - 4) + 'M4 ' + R(H - 3) + 'H' + R(W - 4), 'ln', 0.8, Math.ceil(2 * W), 0, 1.2);
  for (let m = 0; m < 8; m++) {
    const pts = [];
    for (let x = 4; x <= W - 4; x += 2) pts.push([x, y + 7 * Math.sin(TAU * (x - 4) / 28 + m * PI / 4)]);
    d.stroke(d.svg, pathOf(pts), 'ln', 0.6, lengthOf(pts), 0.3 + m * 0.08, 2.4);
  }
}

/** @type {Record<string, import('./ornament.js').InlineFigure>} */
export const LINE_FIGURES = {
  'vine-bar': { params: ['leaves', 'value'], mount: mountVineBar },
  'vine-rail': { params: [], mount: (host, _p, opts) => fillMount(host, 28, 'ak-orn-strip--rail', opts, drawRail) },
  divider: { params: ['leaves'], mount: (host, p, opts) => fillMount(host, 48, 'ak-orn-strip--divider', opts, (d, W, H) => drawDivider(d, W, H, p.leaves)) },
  braid: { params: ['strands'], mount: (host, p, opts) => fillMount(host, 32, 'ak-orn-strip--braid', opts, (d, W, H) => drawBraid(d, W, H, p.strands)) },
  cord: { params: [], mount: (host, _p, opts) => fillMount(host, 64, 'ak-orn-strip--cord', opts, drawCord) },
  'guilloche-strip': { params: [], mount: (host, _p, opts) => fillMount(host, 30, 'ak-orn-strip--guilloche', opts, drawStrip) },
};
