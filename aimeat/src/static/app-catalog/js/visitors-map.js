/**
 * @file visitors-map.js
 * @description The world map in the Visitors section: countries shaded by how many people came
 *   from them, a click that zooms to one country and lists its regions and cities, and a dot per
 *   city when the app's owner keeps places that precisely.
 *
 *   NOTHING LEAVES THE NODE TO DRAW IT. The shapes are the node's own file
 *   (/lib/aimeat-atlas@1.json: Natural Earth, public domain, projected once at build time into SVG
 *   path strings), fetched same-origin the first time a map is shown and kept for the session. A
 *   tile map would have had every reader's browser calling somebody else's server to look at their
 *   own visitors, and would have needed the page's content policy opened to let it.
 *
 *   ZOOM IS THE SVG VIEW BOX, nothing more. The paths are never re-projected or re-drawn: the same
 *   markup is shown through a smaller window, and `vector-effect: non-scaling-stroke` in the sheet
 *   keeps a border one pixel wide at any zoom. City dots are sized from the view box so they stay
 *   the same size on screen.
 *
 *   THE MAP IS THE PICTURE, THE LIST IS THE ANSWER. The 110m atlas cannot draw Singapore or Malta,
 *   and a shade is no number. Every country with a visitor is in the list beside the map with its
 *   count, and the list is what a keyboard or a screen reader reaches.
 * @structure loadAtlas · mapReset/mapZoom/mapFocus · countryName · mapHtml
 * @usage import { loadAtlas, mapHtml, mapFocus, mapZoom, mapReset } from './visitors-map.js'
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { escapeHtml, jsArg } from './util.js';
import { dtlBtn } from './ui.js';
import { loadConfig } from './config.js';
import { t, getLang } from './i18n.js';
import { numericOf, alpha2Of, shadeStep, projectPoint, zoomBox, placesOfCountry } from './visitors-model.js';

var atlas = null;          // the parsed geometry file, once loaded
var atlasState = 'idle';   // 'idle' | 'loading' | 'ready' | 'error'
var atlasWaiters = [];

/** Narrowest view the zoom allows, in atlas units (the canvas is 1000 wide). */
var MIN_SPAN = 60;

var view = null;    // { x, y, w, h } — null is the whole world
var focus = null;   // alpha-2 of the country the reader clicked, or null

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

/** Fetch the geometry once. `done` runs when it is ready or has failed; the caller re-renders. */
export function loadAtlas(done) {
  if (atlasState === 'ready' || atlasState === 'error') { if (done) done(); return; }
  if (done) atlasWaiters.push(done);
  if (atlasState === 'loading') return;
  atlasState = 'loading';
  var finish = function (state) {
    atlasState = state;
    var waiters = atlasWaiters; atlasWaiters = [];
    waiters.forEach(function (fn) { fn(); });
  };
  fetch(apiBase() + '/lib/aimeat-atlas@1.json')
    .then(function (r) { if (!r.ok) throw new Error('atlas ' + r.status); return r.json(); })
    .then(function (json) {
      if (!json || !Array.isArray(json.countries)) throw new Error('atlas shape');
      atlas = json;
      finish('ready');
    })
    .catch(function () { finish('error'); });
}

export function mapReset() { view = null; focus = null; }

/** Zoom in (factor < 1) or out (factor > 1) around the middle of what is shown. */
export function mapZoom(factor) {
  if (!atlas) return;
  var cur = view || { x: 0, y: 0, w: atlas.w, h: atlas.h };
  var w = Math.max(MIN_SPAN, Math.min(atlas.w, cur.w * factor));
  var h = w / 2;
  if (w >= atlas.w) { view = null; return; }
  var cx = cur.x + cur.w / 2;
  var cy = cur.y + cur.h / 2;
  view = {
    x: Math.max(0, Math.min(atlas.w - w, cx - w / 2)),
    y: Math.max(0, Math.min(atlas.h - h, cy - h / 2)),
    w: w, h: h,
  };
}

/** Show one country: zoom to it when the atlas draws it, and list its places either way. */
export function mapFocus(alpha2) {
  if (!alpha2 || focus === alpha2) { mapReset(); return; }
  focus = alpha2;
  var shape = shapeOf(alpha2);
  view = shape && atlas ? zoomBox(shape.bbox, atlas.w, atlas.h, MIN_SPAN * 2) : null;
}

function shapeOf(alpha2) {
  var id = numericOf(alpha2);
  if (!id || !atlas) return null;
  for (var i = 0; i < atlas.countries.length; i++) if (atlas.countries[i].id === id) return atlas.countries[i];
  return null;
}

var nameCache = { lang: '', names: null };

/** A country's name in the reader's language. The browser holds the list; the atlas name and the
 *  bare code are the fallbacks for a browser that does not. */
export function countryName(alpha2, unknownCode) {
  if (alpha2 === unknownCode) return t('visitors.unknownPlace');
  var lang = getLang();
  if (nameCache.lang !== lang) {
    nameCache.lang = lang;
    try { nameCache.names = new Intl.DisplayNames([lang], { type: 'region' }); } catch (e) { nameCache.names = null; }
  }
  try {
    var n = nameCache.names ? nameCache.names.of(alpha2) : '';
    if (n && n !== alpha2) return n;
  } catch (e) { /* a code the browser's list does not know: fall through to the atlas name */ }
  var shape = shapeOf(alpha2);
  return shape ? shape.name : alpha2;
}

function fill(key, n) { return t(key).replace('{n}', String(n)); }

/** The map, its controls, and the list beside it. `visitors` is the report's second half. */
export function mapHtml(visitors) {
  var countries = visitors.countries || [];
  var unknown = visitors.unknown_country;
  if (!countries.length) return '<p class="vis-note">' + escapeHtml(t('visitors.mapEmpty')) + '</p>';

  var byCode = {};
  var max = 0;
  countries.forEach(function (c) {
    byCode[c.country] = c.people;
    if (c.country !== unknown && c.people > max) max = c.people;
  });

  var svg;
  if (atlasState === 'error') {
    svg = '<p class="vis-note">' + escapeHtml(t('visitors.mapFailed')) + '</p>';
  } else if (atlasState !== 'ready') {
    svg = '<div class="vis-map-wait">' + escapeHtml(t('visitors.mapLoading')) + '</div>';
  } else {
    var vb = view || { x: 0, y: 0, w: atlas.w, h: atlas.h };
    var paths = '';
    atlas.countries.forEach(function (shape) {
      var a2 = alpha2Of(shape.id);
      var n = a2 ? (byCode[a2] || 0) : 0;
      var cls = 'vis-land vis-shade-' + shadeStep(n, max) + (a2 && a2 === focus ? ' is-focus' : '');
      var label = (a2 ? countryName(a2, unknown) : shape.name) + (n ? ' · ' + fill('visitors.people', n) : '');
      paths += '<path class="' + cls + '" d="' + shape.d + '"'
        + (n ? ' onclick="window._launcher.visitorsCountry(\'' + jsArg(a2) + '\')"' : '')
        + '><title>' + escapeHtml(label) + '</title></path>';
    });
    // City dots, only where the owner keeps a city and the proxy sent its coordinates. Sized from
    // the view box so a dot stays the same size on screen at any zoom.
    var dots = '';
    var r = vb.w / 1000 * 5;
    (visitors.places || []).forEach(function (p) {
      if (p.lat === null || p.lon === null || p.lat === undefined || p.lon === undefined) return;
      var pt = projectPoint(p.lat, p.lon, atlas.w, atlas.h);
      var label = [p.city, p.region, countryName(p.country, unknown)].filter(Boolean).join(', ') + ' · ' + fill('visitors.people', p.people);
      dots += '<circle class="vis-dot" cx="' + pt.x.toFixed(1) + '" cy="' + pt.y.toFixed(1) + '" r="' + r.toFixed(2) + '"><title>' + escapeHtml(label) + '</title></circle>';
    });
    svg = '<svg class="vis-map-svg" viewBox="' + [vb.x, vb.y, vb.w, vb.h].map(function (v) { return v.toFixed(1); }).join(' ')
      + '" role="img" aria-label="' + escapeHtml(t('visitors.mapLabel')) + '">' + paths + dots + '</svg>';
  }

  var controls = '<div class="vis-map-controls">'
    + dtlBtn(escapeHtml(t('visitors.zoomIn')), 'window._launcher.visitorsZoom(0.6)', { title: t('visitors.zoomInTitle') })
    + dtlBtn(escapeHtml(t('visitors.zoomOut')), 'window._launcher.visitorsZoom(1.6)', { title: t('visitors.zoomOutTitle'), disabled: !view })
    + dtlBtn(escapeHtml(t('visitors.zoomReset')), 'window._launcher.visitorsCountry(\'\')', { disabled: !view && !focus })
    + '</div>';

  var legend = '<div class="vis-legend"><span>' + escapeHtml(t('visitors.legendFew')) + '</span>'
    + [1, 2, 3, 4, 5].map(function (s) { return '<i class="vis-legend-step vis-shade-' + s + '"></i>'; }).join('')
    + '<span>' + escapeHtml(t('visitors.legendMany')) + '</span></div>';

  var rows = countries.map(function (c) {
    var drawn = c.country !== unknown && !!shapeOf(c.country);
    var name = escapeHtml(countryName(c.country, unknown));
    var cell = c.country === unknown
      ? '<span class="vis-country-name">' + name + '</span>'
      : '<button type="button" class="vis-country-btn' + (c.country === focus ? ' is-focus' : '') + '" onclick="window._launcher.visitorsCountry(\'' + jsArg(c.country) + '\')">' + name + '</button>';
    return '<tr><td>' + cell + (!drawn && c.country !== unknown && atlasState === 'ready' ? ' <span class="vis-dim">' + escapeHtml(t('visitors.notDrawn')) + '</span>' : '')
      + '</td><td class="vis-num">' + c.people + '</td></tr>';
  }).join('');
  var list = '<table class="vis-table"><thead><tr><th>' + escapeHtml(t('visitors.colCountry')) + '</th><th class="vis-num">'
    + escapeHtml(t('visitors.colPeople')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>';

  var detail = '';
  if (focus) {
    var places = placesOfCountry(visitors.places, focus);
    detail = '<div class="vis-places"><h4 class="vis-h">' + escapeHtml(countryName(focus, unknown)) + '</h4>'
      + (places.length
        ? '<table class="vis-table"><tbody>' + places.map(function (p) {
          return '<tr><td>' + escapeHtml([p.city, p.region].filter(Boolean).join(', ')) + '</td><td class="vis-num">' + p.people + '</td></tr>';
        }).join('') + '</tbody></table>'
        : '<p class="vis-note">' + escapeHtml(t('visitors.noPlaces')) + '</p>')
      + '</div>';
  }

  return '<div class="vis-geo"><div class="vis-map">' + controls + '<div class="vis-map-frame">' + svg + '</div>' + legend + '</div>'
    + '<div class="vis-map-side">' + list + detail + '</div></div>';
}
