/**
 * @file atelier/atlas.js
 * @description The atlas — the data map, fully offline: country shapes ship on the node itself
 *   (/lib/aimeat-atlas@1.json, Natural Earth geometry pre-projected to SVG paths by
 *   scripts/vendor-atlas-data.mjs), so no tile server, no external host, no key. Two layers,
 *   both data:
 *
 *     regions   choropleth — rows matched to countries by name (or numeric id), filled with
 *               the accent at an intensity riding the value, or with a tone (--ak-ok/-warn/-err);
 *     markers   dots at lon/lat with a label — offices, events, sources.
 *
 *   The view FITS THE STORY: with regions or markers present it frames their extent (plus air),
 *   so a Nordic dataset shows the Nordics, not Antarctica; `fit: 'world'` pins the whole world.
 *   The geometry loads lazily on first mount and is shared by every atlas on the page.
 * @structure atlas(spec) → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.atlas({ target: host, data: {
 *     regions: [{ name: 'Finland', value: 12 }, { name: 'Sweden', value: 7 }],
 *     markers: [{ label: 'Espoo', lon: 24.66, lat: 60.21, tone: 'ok' }] } });
 * @version-history
 *   v0.33.0 — 2026-08-29 — Initial (TARGET-074 next level: the map that was missing, without
 *     a tile server).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { t } from './i18n.js';
import { skeleton, emptyState } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs || {})) node.setAttribute(key, String(attrs[key]));
  return node;
}

const TONES = ['ok', 'warn', 'err'];

/** One shared load of the geometry, whoever asks first. */
let geoPromise = null;
function ensureGeometry() {
  if (geoPromise) return geoPromise;
  // NODE_URL, not APEX_URL: an app subdomain proxies this node's /lib, and a SAME-ORIGIN read
  // needs no CORS grant — the apex fetch from an app origin was blocked by exactly that.
  geoPromise = fetch(NODE_URL + '/lib/aimeat-atlas@1.json')
    .then(function (res) { if (!res.ok) throw new Error('atlas geometry ' + res.status); return res.json(); })
    .catch(function (err) { geoPromise = null; throw err; });
  return geoPromise;
}

/**
 * The atlas.
 * @param {{ target?: string|Element, title?: string, fit?: 'auto'|'world',
 *   data?: { regions?: Array<{ name?: string, id?: string, value?: number, tone?: string }>,
 *            markers?: Array<{ label?: string, lon: number, lat: number, tone?: string }> }|null,
 *   empty?: { title?: string, hint?: string }, onPick?: (region: any) => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: object|null }) => void, destroy: () => void }}
 */
export function atlas(spec) {
  const root = el('figure', { class: 'ak-root ak-atlas', role: 'img' });
  if (spec.target) resolve(spec.target).appendChild(root);
  const wait = skeleton({ target: root, rows: 3 });
  let destroyed = false;
  let geo = null;
  let pending = spec.data === undefined ? null : spec.data;

  ensureGeometry().then(function (loaded) {
    if (destroyed) return;
    wait.destroy();
    geo = loaded;
    render(pending);
  }).catch(function () {
    if (destroyed) return;
    wait.destroy();
    emptyState({
      target: root,
      title: (spec.empty && spec.empty.title) || t('atlasDown'),
      hint: (spec.empty && spec.empty.hint) || '',
    });
  });

  function matchRegion(row, byName, byId) {
    if (row.id != null && byId.has(String(row.id))) return byId.get(String(row.id));
    if (row.name) return byName.get(String(row.name).toLowerCase()) || null;
    return null;
  }

  function project(lon, lat) {
    return [((lon + 180) / 360) * geo.w, ((90 - lat) / 180) * geo.h];
  }

  function render(data) {
    clear(root);
    const regions = (data && Array.isArray(data.regions)) ? data.regions : [];
    const markers = (data && Array.isArray(data.markers)) ? data.markers : [];

    const byName = new Map();
    const byId = new Map();
    for (const c of geo.countries) { byName.set(c.name.toLowerCase(), c); byId.set(c.id, c); }

    // Matched rows, their max value for the intensity ramp, and the extent worth framing.
    let maxValue = 0;
    const matched = [];
    const extent = [Infinity, Infinity, -Infinity, -Infinity];
    function grow(x0, y0, x1, y1) {
      if (x0 < extent[0]) extent[0] = x0;
      if (y0 < extent[1]) extent[1] = y0;
      if (x1 > extent[2]) extent[2] = x1;
      if (y1 > extent[3]) extent[3] = y1;
    }
    for (const row of regions) {
      const c = matchRegion(row, byName, byId);
      if (!c) continue;
      matched.push({ row: row, country: c });
      if (typeof row.value === 'number' && row.value > maxValue) maxValue = row.value;
      grow(c.bbox[0], c.bbox[1], c.bbox[2], c.bbox[3]);
    }
    for (const m of markers) {
      if (typeof m.lon !== 'number' || typeof m.lat !== 'number') continue;
      const [x, y] = project(m.lon, m.lat);
      grow(x - 2, y - 2, x + 2, y + 2);
    }

    // The frame: the story's extent with air, floored so one small country still has context;
    // the whole world when nothing is matched or the layout asked for it.
    let vb = [0, 0, geo.w, geo.h];
    if (spec.fit !== 'world' && extent[0] < extent[2]) {
      // Pad floors scale-free (the context floor below carries the minimum breadth): a fixed
      // 20-unit pad forced ~800 km of margin onto an 80 km crossing.
      const padX = Math.max((extent[2] - extent[0]) * 0.25, 3);
      const padY = Math.max((extent[3] - extent[1]) * 0.25, 2);
      let x0 = Math.max(0, extent[0] - padX);
      let y0 = Math.max(0, extent[1] - padY);
      let x1 = Math.min(geo.w, extent[2] + padX);
      let y1 = Math.min(geo.h, extent[3] + padY);
      // Keep the frame's shape near 2:1 so the card never shows a sliver. The context floor
      // SCALES with the data: a lone country still gets its neighbours, while two harbours
      // 80 km apart get their gulf instead of half a continent (the crossing finding).
      const minW = Math.max((extent[2] - extent[0]) * 3, 22);
      if (x1 - x0 < minW) { const cx = (x0 + x1) / 2; x0 = Math.max(0, cx - minW / 2); x1 = Math.min(geo.w, cx + minW / 2); }
      if (y1 - y0 < (x1 - x0) / 2) { const cy = (y0 + y1) / 2; const half = (x1 - x0) / 4; y0 = Math.max(0, cy - half); y1 = Math.min(geo.h, cy + half); }
      vb = [x0, y0, x1 - x0, y1 - y0];
    }

    root.setAttribute('aria-label', (spec.title ? spec.title + ' — ' : '')
      + matched.map(function (m) { return m.country.name + (m.row.value != null ? ' ' + m.row.value : ''); }).join(', '));

    const node = svg('svg', { viewBox: vb.join(' '), class: 'ak-atlas__svg', 'aria-hidden': 'true' });
    const still = reducedMotion();

    // Every country as the quiet ground, then the matched ones over it in colour.
    for (const c of geo.countries) node.appendChild(svg('path', { d: c.d, class: 'ak-atlas__land' }));
    matched.forEach(function (m, i) {
      const tone = TONES.indexOf(m.row.tone) >= 0 ? m.row.tone : null;
      const attrs = { d: m.country.d, class: 'ak-atlas__region' + (tone ? ' ak-atlas__region--' + tone : '') };
      if (!tone) {
        const frac = maxValue > 0 && typeof m.row.value === 'number' ? m.row.value / maxValue : 1;
        attrs.style = 'fill: var(--ak-accent); fill-opacity: ' + (0.25 + 0.75 * frac).toFixed(3);
      }
      const path = svg('path', attrs);
      if (!still) { path.classList.add('ak-atlas__region--enter'); path.style.animationDelay = (i * 40) + 'ms'; }
      if (spec.onPick) {
        path.classList.add('ak-atlas__region--pick');
        path.addEventListener('click', function () { spec.onPick(m.row); });
      }
      node.appendChild(path);
    });

    // Screen-constant: ~1/160 of the drawn width whatever the zoom, so a close-up's buoys
    // stay pins instead of blots.
    const dotR = vb[2] / 160;
    markers.forEach(function (m, i) {
      if (typeof m.lon !== 'number' || typeof m.lat !== 'number') return;
      const [x, y] = project(m.lon, m.lat);
      const tone = TONES.indexOf(m.tone) >= 0 ? m.tone : null;
      const dot = svg('circle', { cx: x, cy: y, r: dotR, class: 'ak-atlas__marker' + (tone ? ' ak-atlas__marker--' + tone : '') });
      if (!still) { dot.classList.add('ak-atlas__marker--enter'); dot.style.animationDelay = (120 + i * 60) + 'ms'; }
      node.appendChild(dot);
      if (m.label) {
        const label = svg('text', { x: x + dotR * 1.8, y: y + dotR * 0.8, class: 'ak-atlas__label', 'font-size': String(Math.max(vb[2] / 60, 4)) });
        label.textContent = String(m.label);
        node.appendChild(label);
      }
    });

    root.appendChild(node);
    // A world with nothing on it still renders (a map is a legal ground), but it says so —
    // an unlabeled empty world reads as broken, not as "no data yet".
    if (!matched.length && !markers.length) {
      root.appendChild(el('figcaption', { class: 'ak-atlas__note', text: (spec.empty && spec.empty.title) || t('empty') }));
    }
  }

  return {
    el: root,
    set: function (patch) {
      if (!patch || !('data' in patch)) return;
      pending = patch.data;
      if (geo) render(patch.data);
    },
    destroy: function () { destroyed = true; root.remove(); },
  };
}
