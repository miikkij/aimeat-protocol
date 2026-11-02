/**
 * @file atelier/fingerprint-draw.js
 * @description The drawing of the fingerprint (fingerprint.js), pure: each function takes the
 *   normalised profile and returns an SVG or HTML element. Ported from the accepted prototype
 *   (docs/internal/aineiston-sormenjalki-2026-11-02.html on the developer's machine).
 *
 *   COLOUR IS A TOKEN, NEVER A LITERAL. Every coloured mark carries `--fp-c: var(--ak-fp-<genre>)`
 *   and the stylesheet (aimeat-atelier/fingerprint.css) paints with var(--fp-c), so a look or an app
 *   changes a genre's colour by setting one variable. The marks + ~ ? x are keyboard characters in
 *   the kit's monospace face; x wears --ak-fp-x, the kit's error colour.
 * @structure GENRES · MARKS · AXES · DEFAULT_GRIDS · normalize · genreShares · markShares · zoneName ·
 *   sealSvg · barcodeSvg · trustBar · gridSvg · sealCard · tagLines
 * @usage import { normalize, sealSvg } from './fingerprint-draw.js';
 * @version-history
 *   v0.69.0 — 2026-11-02 — Initial (wish-aineiston-sormenj-lki-millaista-aineisto-on-yhdell-silm-ykse).
 */
import { el } from './dom.js';
import { svg } from './chart-core.js';
import { tf } from './fingerprint-i18n.js';

export const GENRES = ['F', 'A', 'M', 'O', 'P', 'K'];
export const MARKS = ['+', '~', '?', 'x'];
export const AXES = ['fakta', 'konkr', 'toim', 'aika', 'yks', 'varm'];
export const DEFAULT_GRIDS = [['konkr', 'fakta'], ['aika', 'toim'], ['yks', 'varm']];
const SQUARE = { F: '\u{1F7E6}', A: '\u{1F7E9}', M: '\u{1F7E7}', O: '\u{1F7E8}', P: '\u{1F7E5}', K: '\u{1F7EA}' };

const colour = (g) => '--fp-c: var(--ak-fp-' + (GENRES.indexOf(g) >= 0 ? g : 'F') + ')';
const pct = (v) => Math.round(v * 100);

/**
 * The data the component was given, made safe to draw: rows of sections with their words, and
 * the headings and claims when the sections were given. Null when there is no profile.
 * @param {any} data  { profile, sections?, title?, age? }
 * @returns {any}
 */
export function normalize(data) {
  const p = data && data.profile;
  if (!p || !Array.isArray(p.sections) || !p.sections.length) return null;
  const detail = Array.isArray(data.sections) ? data.sections : [];
  const topics = (Array.isArray(p.topics) ? p.topics : []).map(function (t) {
    return { name: String(t.name || ''), share: Number(t.share) || 0, genre: t.genre, mark: t.mark, axes: t.axes || {} };
  });
  if (!topics.length) topics.push({ name: '', share: 1, genre: 'F', mark: '?', axes: {} });
  const rows = p.sections.map(function (r, i) {
    const d = detail[i] || {};
    return {
      i: i, n: d.n || i + 1, g: GENRES.indexOf(r[0]) >= 0 ? r[0] : 'F', w: Math.max(1, Number(r[1]) || 1),
      c: Math.max(0, Math.min(1, Number(r[2]) || 0)), m: MARKS.indexOf(r[3]) >= 0 ? r[3] : '?',
      ti: Math.max(0, Math.min(topics.length - 1, Number(r[4]) || 0)),
      heading: d.heading ? String(d.heading) : '', claim: d.claim ? String(d.claim) : '',
    };
  });
  return {
    title: data.title ? String(data.title) : '', kind: String(p.kind || ''), model: String(p.model || ''),
    at: String(p.at || ''), truncatedAt: p.truncatedAt || 0, age: Number(data.age) || 0,
    topics: topics, rows: rows, axes: p.axes || {}, total: rows.reduce(function (a, r) { return a + r.w; }, 0) || 1,
  };
}

/** @param {any} P @returns {Array<[string, number]>} genre shares, largest first */
export function genreShares(P) {
  const o = {};
  P.rows.forEach(function (r) { o[r.g] = (o[r.g] || 0) + r.w / P.total; });
  return GENRES.filter(function (g) { return o[g]; }).map(function (g) { return /** @type {[string, number]} */ ([g, o[g]]); })
    .sort(function (a, b) { return b[1] - a[1]; });
}

/** @param {any} P @returns {Array<[string, number]>} mark shares in mark order */
export function markShares(P) {
  const o = {};
  P.rows.forEach(function (r) { o[r.m] = (o[r.m] || 0) + r.w / P.total; });
  return MARKS.filter(function (m) { return o[m]; }).map(function (m) { return /** @type {[string, number]} */ ([m, o[m]]); });
}

const axisOf = (axes, k) => Math.max(-1, Math.min(1, Number(axes && axes[k]) || 0));

/**
 * The zone a point falls in: a named zone for the three default views, the two ends' words for
 * any other pair.
 */
export function zoneName(xk, yk, x, y) {
  const i = (y >= 0 ? 0 : 2) + (x >= 0 ? 1 : 0);
  const named = tf('zone.' + xk + '|' + yk + '.' + i);
  if (named.indexOf('zone.') !== 0) return named;
  return tf('zoneJoin', { a: tf('axis.' + yk + (y >= 0 ? '.hi' : '.lo')), b: tf('axis.' + xk + (x >= 0 ? '.hi' : '.lo')).toLowerCase() });
}

function arcPath(cx, cy, r1, r2, a0, a1) {
  const p = function (r, a) { return [(cx + r * Math.sin(a)).toFixed(2), (cy - r * Math.cos(a)).toFixed(2)]; };
  const lg = a1 - a0 > Math.PI ? 1 : 0;
  const s = p(r2, a0), e = p(r2, a1), e2 = p(r1, a1), s2 = p(r1, a0);
  return 'M' + s[0] + ' ' + s[1] + 'A' + r2 + ' ' + r2 + ' 0 ' + lg + ' 1 ' + e[0] + ' ' + e[1]
    + 'L' + e2[0] + ' ' + e2[1] + 'A' + r1 + ' ' + r1 + ' 0 ' + lg + ' 0 ' + s2[0] + ' ' + s2[1] + 'Z';
}

/**
 * The seal: the genre shares as a ring, the six axes as a shape inside it. With `focus`
 * ({ g, ti }) only that genre's arc stays lit and the topic's own shape is drawn over the whole
 * item's shape (dashed), so one sees whether that part is weaker or stronger than the whole.
 * @param {any} P @param {number} size @param {{ labels?: boolean, focus?: { g: string, ti: number }|null }} [o]
 * @returns {SVGSVGElement}
 */
export function sealSvg(P, size, o) {
  const opt = o || {};
  const pad = opt.labels ? 54 : 1, c = size / 2 + pad, R = size / 2, ring = Math.max(4, size * 0.11);
  const rIn = R - ring - Math.max(2, size * 0.03);
  const W = size + 2 * pad;
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + W, width: W, class: 'ak-fp__seal', 'data-ak-part': 'seal', role: 'img', 'aria-label': tf('seal') });
  let a = 0;
  genreShares(P).forEach(function (gs) {
    const a1 = Math.min(a + gs[1] * 2 * Math.PI, a + 2 * Math.PI - 0.001);
    const dim = opt.focus && gs[0] !== opt.focus.g;
    root.appendChild(svg('path', { d: arcPath(c, c, R - ring, R, a, a1), class: 'ak-fp__arc' + (dim ? ' ak-fp--dim' : ''), style: colour(gs[0]) }));
    a = a1;
  });
  const ang = function (i) { return i * 2 * Math.PI / AXES.length; };
  const pt = function (i, r) { return [c + r * Math.sin(ang(i)), c - r * Math.cos(ang(i))]; };
  const poly = function (axes) {
    return AXES.map(function (k, i) { return pt(i, rIn * (0.14 + 0.86 * (axisOf(axes, k) + 1) / 2)).map(function (n) { return n.toFixed(1); }).join(','); }).join(' ');
  };
  if (size >= 100) {
    [0.5, 1].forEach(function (f) {
      root.appendChild(svg('polygon', { class: 'ak-fp__guide', points: AXES.map(function (_, i) { return pt(i, rIn * f).map(function (n) { return n.toFixed(1); }).join(','); }).join(' ') }));
    });
  }
  const dom = genreShares(P)[0][0];
  if (opt.focus) {
    const t = P.topics[opt.focus.ti] || P.topics[0];
    root.appendChild(svg('polygon', { class: 'ak-fp__poly ak-fp__poly--whole', points: poly(P.axes) }));
    root.appendChild(svg('polygon', { class: 'ak-fp__poly', points: poly(t.axes), style: colour(opt.focus.g) }));
  } else {
    root.appendChild(svg('polygon', { class: 'ak-fp__poly', points: poly(P.axes), style: colour(dom) }));
  }
  if (opt.labels) {
    AXES.forEach(function (k, i) {
      const xy = pt(i, R + 14);
      const anc = Math.abs(xy[0] - c) < 4 ? 'middle' : xy[0] > c ? 'start' : 'end';
      const tx = svg('text', { x: xy[0].toFixed(1), y: (xy[1] + 4).toFixed(1), 'text-anchor': anc, class: 'ak-fp__spoke' });
      tx.textContent = tf('axis.' + k + '.short');
      root.appendChild(tx);
    });
  }
  return /** @type {SVGSVGElement} */ (root);
}

/** The hover text of one section. */
export function sectionTip(P, r) {
  const t = P.topics[r.ti];
  const facts = (t && t.name ? tf('topic', { name: t.name }) + ' · ' : '') + tf('genre.' + r.g) + ' · ' + r.m + ' ' + tf('mark.' + r.m)
    + ' · ' + tf('certainty', { p: pct(r.c) });
  return r.heading ? [r.heading, r.claim, facts].filter(Boolean) : [tf('words', { n: r.w }), facts];
}

/**
 * The barcode: one stripe per section in reading order, as wide as its words, as tall as its
 * certainty, coloured by its genre; under it the mark row, and in `full` mode the topic row.
 * @param {any} P @param {{ W?: number, H?: number, full?: boolean, marks?: boolean }} [o]
 * @returns {SVGSVGElement}
 */
export function barcodeSvg(P, o) {
  const opt = o || {};
  const W = opt.W || 600, H = opt.H || 56, full = opt.full !== false, marks = opt.marks !== false;
  const gap = 2, usable = W - gap * (P.rows.length - 1);
  const symH = marks ? (full ? 18 : 14) : 0, topicY = H + symH + 6;
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + (H + symH + (full ? 30 : 0)), class: 'ak-fp__barcode', 'data-ak-part': 'barcode', role: 'img', 'aria-label': tf('barcode') });
  const groups = [];
  let x = 0;
  P.rows.forEach(function (r) {
    const w = r.w / P.total * usable, h = H * (0.28 + 0.72 * r.c);
    root.appendChild(svg('rect', {
      x: x.toFixed(1), y: (H - h).toFixed(1), width: w.toFixed(1), height: h.toFixed(1), rx: 2,
      class: 'ak-fp__stripe', style: colour(r.g), 'data-ak-part': 'stripe', 'data-topic': r.ti, 'data-g': r.g, 'data-i': r.i,
    }));
    if (marks && w >= 6) {
      const tx = svg('text', { x: (x + w / 2).toFixed(1), y: H + symH - 4, 'text-anchor': 'middle', class: 'ak-fp__mark' + (full ? '' : ' ak-fp__mark--small'), 'data-m': r.m, 'data-topic': r.ti });
      tx.textContent = r.m;
      root.appendChild(tx);
    }
    const last = groups[groups.length - 1];
    if (last && last.ti === r.ti) last.x1 = x + w; else groups.push({ ti: r.ti, x0: x, x1: x + w });
    x += w + gap;
  });
  if (full) {
    groups.forEach(function (gr) {
      const t = P.topics[gr.ti];
      const room = Math.floor((gr.x1 - gr.x0) / 5.8);
      const name = t.name.length <= room ? t.name : room >= 4 ? t.name.slice(0, room - 1) + '…' : '';
      const g = svg('g', { 'data-topic': gr.ti, 'data-ak-part': 'topicBand', class: 'ak-fp__band' });
      g.appendChild(svg('rect', { x: gr.x0.toFixed(1), y: topicY, width: (gr.x1 - gr.x0).toFixed(1), height: 4, rx: 2, class: 'ak-fp__band-bar' }));
      g.appendChild(svg('rect', { x: gr.x0.toFixed(1), y: topicY - 4, width: (gr.x1 - gr.x0).toFixed(1), height: 26, class: 'ak-fp__hit' }));
      const tx = svg('text', { x: (gr.x0 + 1).toFixed(1), y: topicY + 17, class: 'ak-fp__band-name' });
      tx.textContent = name;
      g.appendChild(tx);
      root.appendChild(g);
    });
  }
  return /** @type {SVGSVGElement} */ (root);
}

/** The trust bar: what the item rests on, by share of its words, and its legend. */
export function trustBar(P) {
  const W = 600, H = 22, sh = markShares(P), gap = 2, usable = W - gap * (sh.length - 1);
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'ak-fp__trustbar', role: 'img', 'aria-label': tf('trust') });
  let x = 0;
  sh.forEach(function (ms) {
    const w = ms[1] * usable;
    s.appendChild(svg('rect', { x: x.toFixed(1), y: 0, width: w.toFixed(1), height: H, rx: 3, class: 'ak-fp__trust', 'data-m': ms[0] }));
    x += w + gap;
  });
  const legend = el('div', { class: 'ak-fp__legend', 'data-ak-part': 'trustLegend' },
    sh.map(function (ms) { return el('span', null, [el('b', { class: 'ak-fp__glyph', 'data-m': ms[0], text: ms[0] }), ' ' + tf('mark.' + ms[0]) + ' ' + pct(ms[1]) + ' %']); }));
  return el('div', { class: 'ak-fp__trustwrap', 'data-ak-part': 'trust' }, [s, legend]);
}

function bubble(t, cx, cy, r) {
  const g = svg('g', {});
  const hollow = t.mark === '?';
  g.appendChild(svg('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: (hollow ? r - 1 : r).toFixed(1), class: 'ak-fp__bubble' + (hollow ? ' ak-fp__bubble--hollow' : '') + (t.mark === 'x' ? ' ak-fp__bubble--x' : ''), style: colour(t.genre) }));
  const fs = Math.max(11, Math.min(20, r * 1.15));
  const tx = svg('text', { x: cx.toFixed(1), y: (cy + fs * 0.36).toFixed(1), 'text-anchor': 'middle', class: 'ak-fp__bubble-mark' + (hollow ? ' ak-fp__bubble-mark--hollow' : ''), 'font-size': fs.toFixed(1) });
  tx.textContent = t.mark;
  g.appendChild(tx);
  return g;
}

/**
 * One quadrant view: the topics as bubbles (size the share, colour the genre, mark inside), the four
 * zones named outside the plot, the item's leaning as a cross, labels nudged apart.
 * @param {any} P @param {string} xk @param {string} yk @returns {SVGSVGElement}
 */
export function gridSvg(P, xk, yk) {
  const W = 300, H = W + 30, x0 = 28, x1 = W - 4, y0 = 24, y1 = H - 44, cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
  const X = function (v) { return cxm + v * 0.44 * (x1 - x0); };
  const Y = function (v) { return cym - v * 0.44 * (y1 - y0); };
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'ak-fp__grid', 'data-ak-part': 'grid', role: 'img', 'aria-label': tf('axis.' + xk + '.hi') + ' · ' + tf('axis.' + yk + '.hi') });
  root.appendChild(svg('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 8, class: 'ak-fp__zone' }));
  root.appendChild(svg('line', { x1: cxm, y1: y0, x2: cxm, y2: y1, class: 'ak-fp__cross' }));
  root.appendChild(svg('line', { x1: x0, y1: cym, x2: x1, y2: cym, class: 'ak-fp__cross' }));
  const text = function (x, y, s, cls, attrs) {
    const tx = svg('text', Object.assign({ x: x, y: y, class: cls }, attrs || {}));
    tx.textContent = s;
    root.appendChild(tx);
    return tx;
  };
  text(x0 + 2, y0 - 8, '↖ ' + zoneName(xk, yk, -1, 1), 'ak-fp__zone-name');
  text(x1 - 2, y0 - 8, zoneName(xk, yk, 1, 1) + ' ↗', 'ak-fp__zone-name', { 'text-anchor': 'end' });
  text(x0 + 2, y1 + 15, '↙ ' + zoneName(xk, yk, -1, -1), 'ak-fp__zone-name');
  text(x1 - 2, y1 + 15, zoneName(xk, yk, 1, -1) + ' ↘', 'ak-fp__zone-name', { 'text-anchor': 'end' });
  text(x0, H - 6, '← ' + tf('axis.' + xk + '.lo'), 'ak-fp__axis');
  text(x1, H - 6, tf('axis.' + xk + '.hi') + ' →', 'ak-fp__axis', { 'text-anchor': 'end' });
  text(14, y1, '← ' + tf('axis.' + yk + '.lo'), 'ak-fp__axis', { transform: 'rotate(-90 14 ' + y1 + ')' });
  text(14, y0, tf('axis.' + yk + '.hi') + ' →', 'ak-fp__axis', { transform: 'rotate(-90 14 ' + y0 + ')', 'text-anchor': 'end' });
  const order = P.topics.map(function (t, i) { return i; }).sort(function (a, b) { return P.topics[b].share - P.topics[a].share; });
  order.forEach(function (i) {
    const t = P.topics[i];
    const g = bubble(t, X(axisOf(t.axes, xk)), Y(axisOf(t.axes, yk)), 5 + 24 * Math.sqrt(t.share));
    g.setAttribute('data-topic', String(i));
    g.setAttribute('data-ak-part', 'bubble');
    root.appendChild(g);
  });
  const mx = X(axisOf(P.axes, xk)), my = Y(axisOf(P.axes, yk));
  root.appendChild(svg('path', { d: 'M' + (mx - 6) + ' ' + my + 'H' + (mx + 6) + 'M' + mx + ' ' + (my - 6) + 'V' + (my + 6), class: 'ak-fp__centre', 'data-ak-part': 'leaning' }));
  const labs = P.topics.map(function (t, i) {
    const cx = X(axisOf(t.axes, xk)), cy = Y(axisOf(t.axes, yk)), r = 5 + 24 * Math.sqrt(t.share), w = t.name.length * 6.3;
    const right = cx + r + 4 + w <= x1 + 2;
    const x = right ? cx + r + 4 : cx - r - 4;
    return { i: i, name: t.name, x: x, y: cy + 4, anchor: right ? 'start' : 'end', a: right ? x : x - w, b: right ? x + w : x };
  }).sort(function (p, q) { return p.y - q.y; });
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const p = labs[i], q = labs[j];
        if (p.b > q.a && q.b > p.a && Math.abs(q.y - p.y) < 14) q.y = p.y + 14;
      }
    }
  }
  labs.forEach(function (l) {
    text(l.x.toFixed(1), l.y.toFixed(1), l.name, 'ak-fp__tlabel', { 'text-anchor': l.anchor, 'data-topic': l.i });
  });
  return /** @type {SVGSVGElement} */ (root);
}

/** The seal's hover card: the seal large with its axis words, the genre shares, the six axes as sliders. */
export function sealCard(P) {
  const genres = el('div', { class: 'ak-fp__card-genres' }, genreShares(P).map(function (gs) {
    return el('span', { class: 'ak-fp__chip' }, [el('i', { class: 'ak-fp__swatch', style: colour(gs[0]) }), tf('genre.' + gs[0]) + ' ' + pct(gs[1]) + ' %']);
  }));
  const axes = el('div', { class: 'ak-fp__card-axes' }, AXES.map(function (k) {
    const v = axisOf(P.axes, k);
    return el('div', { class: 'ak-fp__slider' }, [
      el('span', { class: 'ak-fp__slider-lo', text: tf('axis.' + k + '.lo') }),
      el('span', { class: 'ak-fp__slider-track' }, el('i', { class: 'ak-fp__slider-dot', vars: { '--fp-at': ((v + 1) / 2 * 100).toFixed(0) + '%' } })),
      el('span', { class: 'ak-fp__slider-hi', text: tf('axis.' + k + '.hi') }),
    ]);
  }));
  return el('div', { class: 'ak-fp__card', 'data-ak-part': 'card' }, [
    el('div', { class: 'ak-fp__card-seal' }, sealSvg(P, 120, { labels: true })),
    el('div', { class: 'ak-fp__card-body' }, [el('b', { text: P.title || P.kind }), genres, axes]),
  ]);
}

/** The profile as the lines a chat shows: squares, kind and genres, topics with marks, trust, leaning, who profiled it. */
export function tagLines(P) {
  const squares = P.rows.map(function (r) { return SQUARE[r.g].repeat(Math.max(1, Math.round(r.w / P.total * 18))); }).join('');
  const genres = genreShares(P).slice(0, 3).map(function (gs) { return tf('genre.' + gs[0]) + ' ' + pct(gs[1]) + ' %'; }).join(', ');
  const topics = P.topics.slice().sort(function (a, b) { return b.share - a.share; }).map(function (t) { return t.name + ' ' + t.mark; }).join(', ');
  const trust = markShares(P).map(function (ms) { return ms[0] + ' ' + pct(ms[1]) + ' %'; }).join('  ');
  const leaning = DEFAULT_GRIDS.map(function (xy) { return zoneName(xy[0], xy[1], axisOf(P.axes, xy[0]), axisOf(P.axes, xy[1])); }).join(' · ');
  const by = P.model ? tf('profiledBy', { model: P.model, date: P.at.slice(0, 10) }) + (P.truncatedAt ? ', ' + tf('truncated', { n: P.truncatedAt }) : '') : '';
  return [squares, (P.kind ? P.kind + ': ' : '') + genres, tf('topics') + ': ' + topics, tf('trust') + ': ' + trust, tf('leaning') + ': ' + leaning, by].filter(Boolean);
}
