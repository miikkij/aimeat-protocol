/**
 * @file visitors.js
 * @description The Visitors section of the App Detail view: who opened this app, when, and from
 *   where. Read from GET /v1/apps/visitors, the same answer the owner's AI gets from
 *   aimeat_app_visitors, so the screen and the chat never disagree.
 *
 *   TWO HALVES, AND THE SECOND IS OFF UNTIL ASKED FOR. Opens are always counted, so the first half
 *   is there for every published app: how many opens in the window, by signed-in people and by
 *   nobody signed in. What KIND of visitor came (a person, a named AI, another bot) and where
 *   people came from is only counted once the owner switches measurement on, here. Until then this
 *   section says so, and shows no zeros that would read as "no AI ever came".
 *
 *   THE WINDOW IS THE READER'S, 0 TO 360 DAYS. 30 to start with, as on the node. It is remembered
 *   for the session and not per app: someone comparing their apps over the last quarter should not
 *   have to set 90 days again on each one.
 *
 *   Rendering follows the detail-view pattern: detail.js renders the section shell for OWN
 *   published apps and calls visitorsOnOpen; this module re-renders #detail-visitors in place.
 * @structure visitorsOnOpen · visitorsSectionInner · visitorsSetDays · visitorsApplyDays ·
 *   visitorsToggle · visitorsSetGeo · visitorsCountry · visitorsZoom
 * @usage import { visitorsSectionInner, visitorsOnOpen } from './visitors.js'
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { escapeHtml } from './util.js';
import { dtlBtn, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';
import { barsFromSeries, clampWindow, WINDOW_DEFAULT, WINDOW_MIN, WINDOW_MAX } from './visitors-model.js';
import { loadAtlas, mapHtml, mapFocus, mapZoom, mapReset } from './visitors-map.js';

var vAppId = '';       // "owner/filename"
var vState = 'off';    // 'off' | 'loading' | 'ready' | 'error' | 'login'
var vData = null;      // the report
var vBusy = false;     // a switch or a precision change is in flight
var vDays = WINDOW_DEFAULT;

var GEO_LEVELS = ['off', 'country', 'region', 'city'];
var PRESETS = [0, 7, 30, 90, 360];

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

function rerender() {
  var el = document.getElementById('detail-visitors');
  if (el) el.innerHTML = visitorsSectionInner();
}

function fill(key, n) { return t(key).replace('{n}', String(n)); }

function load() {
  var token = getCortexOwnerToken();
  if (!token) { vState = 'login'; vData = null; rerender(); return; }
  var asked = vAppId;
  fetch(apiBase() + '/v1/apps/visitors?app_id=' + encodeURIComponent(vAppId) + '&days=' + vDays, {
    headers: { 'Authorization': 'Bearer ' + token },
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (asked !== vAppId) return;   // the reader opened another app while this one was loading
      if (!res || !res.ok || !res.data) throw new Error('bad response');
      vData = res.data;
      vState = 'ready';
      // The map's shapes are fetched only when there is a place to draw, and once per session.
      if (vData.visitors && vData.visitors.countries.length) loadAtlas(rerender);
      rerender();
    })
    .catch(function () { if (asked === vAppId) { vState = 'error'; vData = null; rerender(); } });
}

/** Reset and load when a detail view opens. No-op for anything but the owner's own published app. */
export function visitorsOnOpen(owner, appId, isOwn) {
  vData = null; vBusy = false; mapReset();
  if (!isOwn || !owner || !appId) { vState = 'off'; vAppId = ''; return; }
  vAppId = owner + '/' + appId;
  vState = 'loading';
  load();
}

/** One of the preset windows. */
export function visitorsSetDays(days) {
  vDays = clampWindow(days);
  vState = 'loading'; rerender();
  load();
}

/** The number the reader typed. */
export function visitorsApplyDays() {
  var el = document.getElementById('vis-days');
  visitorsSetDays(el ? el.value : WINDOW_DEFAULT);
}

function putMeasurement(body, doneKey) {
  if (vBusy || !vData) return;
  vBusy = true; rerender();
  var token = getCortexOwnerToken();
  fetch(apiBase() + '/v1/apps/visitors/measurement', {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
    body: JSON.stringify(Object.assign({ app_id: vAppId }, body)),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      vBusy = false;
      if (!res || !res.ok) { showNotice((res && res.error && res.error.message) || t('visitors.saveFailed')); rerender(); return; }
      showNotice(t(doneKey));
      load();
    })
    .catch(function (err) { vBusy = false; showNotice(String(err && err.message ? err.message : err)); rerender(); });
}

/** Switch measurement on or off. A first switch-on starts at country precision when the node can
 *  place visitors at all: the map is what the owner came for, and a country names nobody. */
export function visitorsToggle() {
  if (!vData) return;
  var m = vData.measurement;
  if (m.on) { putMeasurement({ on: false }, 'visitors.turnedOff'); return; }
  var body = { on: true };
  if (m.geo === 'off' && !vData.visitors && m.geo_available) body.geo = 'country';
  putMeasurement(body, 'visitors.turnedOn');
}

/** Change how precisely a person's place is kept. */
export function visitorsSetGeo() {
  var el = document.getElementById('vis-geo');
  var level = el ? el.value : '';
  if (GEO_LEVELS.indexOf(level) < 0 || !vData) return;
  putMeasurement({ on: vData.measurement.on, geo: level }, 'visitors.geoSaved');
}

export function visitorsCountry(alpha2) { mapFocus(alpha2); rerender(); }
export function visitorsZoom(factor) { mapZoom(Number(factor) || 1); rerender(); }

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────

function stat(value, label) {
  return '<div class="vis-stat"><div class="vis-stat-val">' + escapeHtml(String(value)) + '</div>'
    + '<div class="vis-stat-label">' + escapeHtml(label) + '</div></div>';
}

/**
 * A stacked bar chart over the whole window, one slot per day (per week past 120 days), in the
 * idiom of the version chart: inline SVG in CSS pixels, never stretched. `parts` is drawn bottom up.
 */
function chartHtml(title, series, parts) {
  var folded = barsFromSeries(series, vData.from, vData.to, parts.map(function (p) { return p.key; }));
  if (!folded.max) return '';
  var bars = folded.bars;
  var W = 720, H = 96, PAD = 2, BASE = H - 1;
  var bw = Math.min(28, Math.max(2, Math.floor((W - PAD * (bars.length - 1)) / bars.length)));
  var svgW = bars.length * bw + PAD * (bars.length - 1);
  var rects = '';
  bars.forEach(function (bar, i) {
    var x = i * (bw + PAD);
    var when = new Date(bar.from + 'T00:00:00').toLocaleDateString()
      + (bar.to !== bar.from ? ' – ' + new Date(bar.to + 'T00:00:00').toLocaleDateString() : '');
    var label = when + ' · ' + parts.map(function (p) { return t(p.label) + ' ' + bar[p.key]; }).join(' · ');
    var marks = '';
    var y = BASE;
    var full = bar.total ? Math.max(4, Math.round((bar.total / folded.max) * (H - 14))) : 0;
    parts.forEach(function (p) {
      if (!bar[p.key]) return;
      var h = Math.max(1, Math.round(full * (bar[p.key] / bar.total)));
      y -= h;
      marks += '<rect class="vis-bar-mark ' + p.cls + '" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '"></rect>';
    });
    rects += '<g class="version-bar"><title>' + escapeHtml(label) + '</title>'
      + '<rect class="version-bar-hit" x="' + x + '" y="0" width="' + bw + '" height="' + H + '" fill="transparent"></rect>' + marks + '</g>';
  });
  var key = parts.map(function (p) { return '<span class="vis-key"><i class="vis-key-mark ' + p.cls + '"></i>' + escapeHtml(t(p.label)) + '</span>'; }).join('');
  return '<div class="version-chart vis-chart">'
    + '<div class="version-chart-head"><span class="version-chart-title">' + escapeHtml(title) + '</span>'
    + '<span class="version-chart-max">' + escapeHtml(fill(folded.grain === 'week' ? 'visitors.maxPerWeek' : 'visitors.maxPerDay', folded.max)) + '</span></div>'
    + '<svg class="version-chart-svg" width="' + svgW + '" height="' + H + '" viewBox="0 0 ' + svgW + ' ' + H + '" role="img" aria-label="' + escapeHtml(title) + '">'
    + '<line class="version-chart-base" x1="0" y1="' + BASE + '" x2="' + svgW + '" y2="' + BASE + '"></line>' + rects + '</svg>'
    + '<div class="version-chart-axis"><span>' + escapeHtml(new Date(vData.from + 'T00:00:00').toLocaleDateString()) + '</span><span>'
    + escapeHtml(new Date(vData.to + 'T00:00:00').toLocaleDateString()) + '</span></div>'
    + '<div class="vis-keys">' + key + '</div></div>';
}

function windowHtml() {
  var presets = PRESETS.map(function (d) {
    return dtlBtn(escapeHtml(d === 0 ? t('visitors.today') : fill('visitors.days', d)),
      'window._launcher.visitorsSetDays(' + d + ')', { variant: d === vDays ? 'primary' : '', disabled: vState === 'loading' });
  }).join('');
  return '<div class="vis-window">' + presets
    + '<label class="vis-stat-label" for="vis-days">' + escapeHtml(t('visitors.daysLabel')) + '</label>'
    + '<input id="vis-days" class="modal-input vis-days-input" type="number" inputmode="numeric" min="' + WINDOW_MIN + '" max="' + WINDOW_MAX + '" step="1" value="' + vDays + '"'
    + ' onkeydown="if(event.key===\'Enter\')window._launcher.visitorsApplyDays()">'
    + dtlBtn(escapeHtml(t('visitors.show')), 'window._launcher.visitorsApplyDays()', { disabled: vState === 'loading' })
    + '</div>';
}

function opensHtml() {
  var o = vData.opens;
  var html = '<div class="vis-stats">'
    + stat(o.total, t(vData.days === 0 ? 'visitors.opensToday' : 'visitors.opensInPeriod'))
    + stat(o.signed_in, t('visitors.signedIn'))
    + stat(o.anonymous, t('visitors.anonymous'))
    + stat(o.signed_in_people, t('visitors.signedInPeople'))
    + stat(o.lifetime, t('visitors.lifetime'))
    + '</div>';
  html += o.total
    ? chartHtml(t('visitors.opensChart'), o.series, [
      { key: 'signed_in', label: 'visitors.signedIn', cls: 'vis-part-a' },
      { key: 'anonymous', label: 'visitors.anonymous', cls: 'vis-part-b' },
    ])
    : '<p class="vis-note">' + escapeHtml(t('visitors.noOpens')) + '</p>';
  html += '<p class="vis-note">' + escapeHtml(t('visitors.opensNote')) + '</p>';
  return html;
}

function measurementHtml() {
  var m = vData.measurement;
  var html = '<div class="mk-row">'
    + '<div class="mk-row-name">' + escapeHtml(t('visitors.measure')) + '</div>'
    + '<div class="mk-row-meaning">' + escapeHtml(t(m.on ? 'visitors.measureOn' : (vData.visitors ? 'visitors.measurePaused' : 'visitors.measureOff'))) + '</div>'
    + '<div class="mk-row-action">' + dtlBtn(escapeHtml(t(m.on ? 'visitors.turnOff' : 'visitors.turnOn')), 'window._launcher.visitorsToggle()',
      { variant: m.on ? '' : 'primary', disabled: vBusy }) + '</div></div>';
  if (!m.on && !vData.visitors) return html;

  var options = GEO_LEVELS.map(function (level) {
    return '<option value="' + level + '"' + (level === m.geo ? ' selected' : '') + '>' + escapeHtml(t('visitors.geo.' + level)) + '</option>';
  }).join('');
  html += '<div class="mk-row">'
    + '<div class="mk-row-name"><label for="vis-geo">' + escapeHtml(t('visitors.geoLabel')) + '</label></div>'
    + '<div class="mk-row-meaning">' + escapeHtml(t(m.geo_available ? 'visitors.geoMeaning.' + m.geo : 'visitors.geoUnavailable')) + '</div>'
    + '<div class="mk-row-action"><select id="vis-geo" class="modal-input vis-geo-select" onchange="window._launcher.visitorsSetGeo()"'
    + (vBusy || !m.geo_available ? ' disabled' : '') + '>' + options + '</select></div></div>';
  return html;
}

function whoHtml() {
  var v = vData.visitors;
  if (!v) return '';
  var html = '<div class="vis-block"><h4 class="vis-h">' + escapeHtml(t('visitors.whoTitle')) + '</h4>';
  if (!v.total) return html + '<p class="vis-note">' + escapeHtml(t('visitors.noneYet')) + '</p></div>';
  html += '<div class="vis-stats">' + stat(v.humans, t('visitors.humans')) + stat(v.ai, t('visitors.ai')) + stat(v.bots, t('visitors.bots')) + '</div>';
  html += chartHtml(t('visitors.whoChart'), v.series, [
    { key: 'humans', label: 'visitors.humans', cls: 'vis-part-a' },
    { key: 'ai', label: 'visitors.ai', cls: 'vis-part-c' },
    { key: 'bots', label: 'visitors.bots', cls: 'vis-part-b' },
  ]);
  if (v.ai_agents.length) {
    html += '<table class="vis-table"><thead><tr><th>' + escapeHtml(t('visitors.colAi')) + '</th><th class="vis-num">' + escapeHtml(t('visitors.colAsked'))
      + '</th><th class="vis-num">' + escapeHtml(t('visitors.colCrawled')) + '</th></tr></thead><tbody>'
      + v.ai_agents.map(function (a) {
        return '<tr><td>' + escapeHtml(a.name) + '</td><td class="vis-num">' + a.asked + '</td><td class="vis-num">' + a.crawled + '</td></tr>';
      }).join('') + '</tbody></table>'
      + '<p class="vis-note">' + escapeHtml(t('visitors.aiNote')) + '</p>';
  } else {
    html += '<p class="vis-note">' + escapeHtml(t('visitors.noAi')) + '</p>';
  }
  return html + '</div>';
}

function whereHtml() {
  var v = vData.visitors;
  var m = vData.measurement;
  if (!v) return '';
  // Places collected earlier stay readable after the precision goes back to off.
  if (m.geo === 'off' && !v.countries.length) return '';
  var html = '<div class="vis-block"><h4 class="vis-h">' + escapeHtml(t('visitors.whereTitle')) + '</h4>'
    + mapHtml(v)
    + '<p class="vis-note">' + escapeHtml(t('visitors.whereNote')) + '</p>';
  if (v.places_truncated) html += '<p class="vis-note">' + escapeHtml(t('visitors.placesTruncated')) + '</p>';
  if (m.geo_attribution) html += '<p class="vis-note vis-dim">' + escapeHtml(m.geo_attribution) + '</p>';
  return html + '</div>';
}

export function visitorsSectionInner() {
  if (vState === 'off') return '';
  var head = '<h3>' + escapeHtml(t('visitors.title')) + '</h3>'
    + '<p class="vis-intro">' + escapeHtml(t('visitors.intro')) + '</p>';
  if (vState === 'login') return head + '<p class="vis-note">' + escapeHtml(t('visitors.needLogin')) + '</p>';
  if (vState === 'error') return head + '<p class="vis-note">' + escapeHtml(t('visitors.loadFailed')) + '</p>';
  if (!vData) return head + windowHtml() + '<p class="vis-note">' + escapeHtml(t('visitors.loading')) + '</p>';
  return head + windowHtml() + opensHtml()
    + '<div class="vis-block">' + measurementHtml() + '</div>'
    + whoHtml() + whereHtml();
}
