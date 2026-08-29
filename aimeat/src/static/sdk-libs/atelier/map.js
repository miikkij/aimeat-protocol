/**
 * @file atelier/map.js
 * @description The map — the REAL one: Leaflet over OpenStreetMap tiles, the way this
 *   platform's apps have always been told they may build ("External CDN libraries are OK —
 *   Chart.js, Leaflet"), now as one clean kit component so no app hand-wires it again.
 *   Leaflet is served by this node (/lib/leaflet@1/, BSD-2); the tiles come from
 *   OpenStreetMap with the attribution their licence requires. The chrome is the kit's card
 *   and nothing more; pins and popups ride the look's tokens; dark mode re-tones the tiles.
 *
 *   Data: { markers: [{ label?, lon, lat, tone? }], center?: { lon, lat }, zoom? }.
 *   With two or more markers the view fits them; with one it centres there; with none it
 *   shows center/zoom or the whole world. All motion is the hand's — Leaflet idles silent.
 * @structure map(spec) → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.map({ target: host, data: { markers: [
 *     { label: 'Espoo office', lon: 24.66, lat: 60.21 } ] } });
 * @version-history
 *   v0.34.0 — 2026-08-29 — Initial (the developer's words: a real map, like the apps already
 *     used — not an abstraction of one).
 */
import { el, clear, resolve } from './dom.js';
import { NODE_URL } from '../_core/config.js';
import { t } from './i18n.js';
import { skeleton, emptyState } from './state.js';

/** One shared load of Leaflet (script + stylesheet), whoever asks first. */
let leafletPromise = null;
function ensureLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise(function (ok, fail) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = NODE_URL + '/lib/leaflet@1/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = NODE_URL + '/lib/leaflet@1/leaflet.js';
    s.onload = function () { ok(window.L); };
    s.onerror = function () { leafletPromise = null; fail(new Error('leaflet failed to load')); };
    document.head.appendChild(s);
  });
  return leafletPromise;
}

const TONES = ['ok', 'warn', 'err'];

/**
 * The map.
 * @param {{
 *   target?: string|Element, title?: string, zoom?: number,
 *   data?: { markers?: Array<{ label?: string, lon: number, lat: number, tone?: string }>,
 *            center?: { lon: number, lat: number }, zoom?: number }|null,
 *   empty?: { title?: string, hint?: string }, onPick?: (marker: any) => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data: object|null }) => void, destroy: () => void }}
 */
export function map(spec) {
  const root = el('figure', { class: 'ak-root ak-map' });
  if (spec.target) resolve(spec.target).appendChild(root);
  if (spec.title) root.appendChild(el('figcaption', { class: 'ak-map__title' }, spec.title));
  const stage = el('div', { class: 'ak-map__stage' });
  root.appendChild(stage);
  const wait = skeleton({ target: stage, rows: 3 });

  let destroyed = false;
  let world = null; // { leaflet, layer }
  let pending = spec.data === undefined ? null : spec.data;

  ensureLeaflet().then(function (L) {
    if (destroyed) return;
    wait.destroy();
    const leaflet = L.map(stage, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      // The licence's condition, and simple honesty about whose map this is.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(leaflet);
    const layer = L.layerGroup().addTo(leaflet);
    world = { L: L, leaflet: leaflet, layer: layer };
    render(pending);
  }).catch(function () {
    if (destroyed) return;
    wait.destroy();
    emptyState({
      target: stage,
      title: (spec.empty && spec.empty.title) || t('atlasDown'),
      hint: (spec.empty && spec.empty.hint) || '',
    });
  });

  function pinIcon(L, tone) {
    const cls = TONES.indexOf(tone) >= 0 ? ' ak-map__pin--' + tone : '';
    // The icon BOX is the touch target: 24px is WCAG 2.2's floor and the bench's rule.
    return L.divIcon({
      className: 'ak-map__pinwrap',
      html: '<span class="ak-map__pin' + cls + '"></span>',
      iconSize: [26, 32],
      iconAnchor: [13, 30],
      popupAnchor: [0, -28],
    });
  }

  function render(data) {
    if (!world) { pending = data; return; }
    const L = world.L;
    world.layer.clearLayers();
    const markers = (data && Array.isArray(data.markers)) ? data.markers
      .filter(function (m) { return typeof m.lon === 'number' && typeof m.lat === 'number'; }) : [];
    for (const m of markers) {
      const pin = L.marker([m.lat, m.lon], { icon: pinIcon(L, m.tone) });
      if (m.label) pin.bindPopup(String(m.label));
      if (spec.onPick) pin.on('click', function () { spec.onPick(m); });
      pin.addTo(world.layer);
    }
    if (markers.length > 1) {
      world.leaflet.fitBounds(L.latLngBounds(markers.map(function (m) { return [m.lat, m.lon]; })), { padding: [36, 36] });
    } else if (markers.length === 1) {
      world.leaflet.setView([markers[0].lat, markers[0].lon], (data && data.zoom) || spec.zoom || 12);
    } else if (data && data.center) {
      world.leaflet.setView([data.center.lat, data.center.lon], data.zoom || spec.zoom || 10);
    } else {
      world.leaflet.setView([30, 10], 2);
    }
  }

  return {
    el: root,
    set: function (patch) {
      if (!patch || !('data' in patch)) return;
      pending = patch.data;
      render(patch.data);
    },
    destroy: function () {
      destroyed = true;
      if (world) world.leaflet.remove();
      root.remove();
      clear(stage);
    },
  };
}
