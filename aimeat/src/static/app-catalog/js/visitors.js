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
 *   Rendering follows the detail-view pattern: detail.js renders the section's slot for OWN
 *   published apps and calls visitorsOnOpen; this module draws the whole section (the set's
 *   section() from parts-html.js) into #detail-visitors and re-renders it in place. Every word,
 *   table, number and control is a part of the shared set; only the two SVG drawings (the bar
 *   charts and the map, visitors-map.js) keep their own drawing classes, because the set has no
 *   chart part yet.
 * @structure visitorsOnOpen · visitorsSectionInner · visitorsSetDays · visitorsApplyDays ·
 *   visitorsToggle · visitorsSetGeo · visitorsCountry · visitorsZoom
 * @usage import { visitorsSectionInner, visitorsOnOpen } from './visitors.js'
 * @version-history
 *   v1.1.0 — 2026-09-22 — Composed from the shared set (parts-html.js): the section slab, the day
 *     window as tabs and a narrow field, the counts as a plain numeral band, the measurement as list
 *     rows, the AI table as the set's table. The page's look now changes with the site's parts.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { escapeHtml } from './util.js';
import { showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';
import { barsFromSeries, clampWindow, WINDOW_DEFAULT, WINDOW_MIN, WINDOW_MAX } from './visitors-model.js';
import { loadAtlas, mapHtml, mapFocus, mapZoom, mapReset } from './visitors-map.js';
import { section, action, field, toolbar, numeralBand, listRow, table, text, stack } from './parts-html.js';

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

/** A quiet sentence under a block. */
function note(key) { return text({ kind: 'caption', tone: 'muted' }, escapeHtml(t(key))); }

/** A sub-heading inside the section. */
function subHead(words) { return text({ kind: 'label' }, escapeHtml(words)); }

/** A row of counts: the set's numeral band, small and plain inside a section. */
function counts(items) {
  return numeralBand({
    tone: 'plain', size: 'small',
    items: items.map(function (it) { return { value: escapeHtml(String(it[0])), label: escapeHtml(it[1]) }; }),
  });
}

/** A key swatch: the same SVG mark the bars draw with, so key and bar are one colour by one rule. */
function swatch(cls) {
  return '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect class="vis-bar-mark ' + cls + '" width="12" height="12"></rect></svg>';
}

/**
 * A stacked bar chart over the whole window, one slot per day (per week past 120 days), in the
 * idiom of the version chart: inline SVG in CSS pixels, never stretched. `parts` is drawn bottom up.
 * The drawing keeps its own SVG classes (the set has no chart part); the words around it are parts.
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
  var keys = stack({ direction: 'wrap', density: 'compact', align: 'center' }, parts.map(function (p) {
    return stack({ direction: 'horizontal', density: 'compact', align: 'center' }, swatch(p.cls) + note(p.label));
  }).join(''));
  return stack({ density: 'compact' },
    stack({ direction: 'horizontal', align: 'between' },
      text({ kind: 'label' }, escapeHtml(title)) +
      text({ kind: 'mono', tone: 'muted' }, escapeHtml(fill(folded.grain === 'week' ? 'visitors.maxPerWeek' : 'visitors.maxPerDay', folded.max)))) +
    '<svg class="version-chart-svg" width="' + svgW + '" height="' + H + '" viewBox="0 0 ' + svgW + ' ' + H + '" role="img" aria-label="' + escapeHtml(title) + '">'
      + '<line class="version-chart-base" x1="0" y1="' + BASE + '" x2="' + svgW + '" y2="' + BASE + '"></line>' + rects + '</svg>' +
    stack({ direction: 'horizontal', align: 'between' },
      text({ kind: 'mono', tone: 'muted' }, escapeHtml(new Date(vData.from + 'T00:00:00').toLocaleDateString())) +
      text({ kind: 'mono', tone: 'muted' }, escapeHtml(new Date(vData.to + 'T00:00:00').toLocaleDateString()))) +
    keys);
}

/** The day window: the presets as tabs (the chosen one on), the typed number, and Show. */
function windowHtml() {
  var busy = vState === 'loading';
  var presets = PRESETS.map(function (d) {
    return action({ kind: 'tab', selected: d === vDays, disabled: busy, onclick: 'window._launcher.visitorsSetDays(' + d + ')' },
      escapeHtml(d === 0 ? t('visitors.today') : fill('visitors.days', d)));
  }).join('');
  var days = field({
    id: 'vis-days', type: 'number', width: 'narrow', label: escapeHtml(t('visitors.daysLabel')),
    value: String(vDays), min: WINDOW_MIN, max: WINDOW_MAX, step: 1,
    inputAttrs: ' inputmode="numeric" onkeydown="if(event.key===\'Enter\')window._launcher.visitorsApplyDays()"',
  });
  return toolbar({
    label: t('visitors.daysLabel'),
    filters: presets,
    body: days + action({ kind: 'secondary', disabled: busy, onclick: 'window._launcher.visitorsApplyDays()' }, escapeHtml(t('visitors.show'))),
  });
}

function opensHtml() {
  var o = vData.opens;
  var html = counts([
    [o.total, t(vData.days === 0 ? 'visitors.opensToday' : 'visitors.opensInPeriod')],
    [o.signed_in, t('visitors.signedIn')],
    [o.anonymous, t('visitors.anonymous')],
    [o.signed_in_people, t('visitors.signedInPeople')],
    [o.lifetime, t('visitors.lifetime')],
  ]);
  html += o.total
    ? chartHtml(t('visitors.opensChart'), o.series, [
      { key: 'signed_in', label: 'visitors.signedIn', cls: 'vis-part-a' },
      { key: 'anonymous', label: 'visitors.anonymous', cls: 'vis-part-b' },
    ])
    : note('visitors.noOpens');
  html += note('visitors.opensNote');
  return stack({}, html);
}

function measurementHtml() {
  var m = vData.measurement;
  var html = listRow({
    name: escapeHtml(t('visitors.measure')),
    detail: escapeHtml(t(m.on ? 'visitors.measureOn' : (vData.visitors ? 'visitors.measurePaused' : 'visitors.measureOff'))),
    detailKind: 'text',
    actions: action({ kind: 'secondary', semantics: 'switch', selected: !!m.on, disabled: vBusy, onclick: 'window._launcher.visitorsToggle()' },
      escapeHtml(t(m.on ? 'visitors.turnOff' : 'visitors.turnOn'))),
  });
  if (!m.on && !vData.visitors) return html;

  var geo = field({
    id: 'vis-geo', type: 'select', value: m.geo, disabled: vBusy || !m.geo_available,
    options: GEO_LEVELS.map(function (level) { return { value: level, label: escapeHtml(t('visitors.geo.' + level)) }; }),
    inputAttrs: ' onchange="window._launcher.visitorsSetGeo()"',
  });
  html += listRow({
    name: '<label for="vis-geo">' + escapeHtml(t('visitors.geoLabel')) + '</label>',
    detail: escapeHtml(t(m.geo_available ? 'visitors.geoMeaning.' + m.geo : 'visitors.geoUnavailable')),
    detailKind: 'text',
    actions: geo,
  });
  return html;
}

function whoHtml() {
  var v = vData.visitors;
  if (!v) return '';
  var html = subHead(t('visitors.whoTitle'));
  if (!v.total) return stack({}, html + note('visitors.noneYet'));
  html += counts([[v.humans, t('visitors.humans')], [v.ai, t('visitors.ai')], [v.bots, t('visitors.bots')]]);
  html += chartHtml(t('visitors.whoChart'), v.series, [
    { key: 'humans', label: 'visitors.humans', cls: 'vis-part-a' },
    { key: 'ai', label: 'visitors.ai', cls: 'vis-part-c' },
    { key: 'bots', label: 'visitors.bots', cls: 'vis-part-b' },
  ]);
  if (v.ai_agents.length) {
    html += table({
      label: t('visitors.whoTitle'),
      headers: [escapeHtml(t('visitors.colAi')), escapeHtml(t('visitors.colAsked')), escapeHtml(t('visitors.colCrawled'))],
      rows: v.ai_agents.map(function (a) {
        return [escapeHtml(a.name), { html: escapeHtml(String(a.asked)), end: true }, { html: escapeHtml(String(a.crawled)), end: true }];
      }),
    }) + note('visitors.aiNote');
  } else {
    html += note('visitors.noAi');
  }
  return stack({}, html);
}

function whereHtml() {
  var v = vData.visitors;
  var m = vData.measurement;
  if (!v) return '';
  // Places collected earlier stay readable after the precision goes back to off.
  if (m.geo === 'off' && !v.countries.length) return '';
  var html = subHead(t('visitors.whereTitle')) + mapHtml(v) + note('visitors.whereNote');
  if (v.places_truncated) html += note('visitors.placesTruncated');
  if (m.geo_attribution) html += text({ kind: 'caption', tone: 'muted' }, escapeHtml(m.geo_attribution));
  return stack({}, html);
}

/** The whole section; detail.js holds its slot (#detail-visitors) and this fills it. */
export function visitorsSectionInner() {
  if (vState === 'off') return '';
  var wrap = function (body) {
    return section({ title: escapeHtml(t('visitors.title')), description: escapeHtml(t('visitors.intro')), body: stack({ density: 'roomy' }, body) });
  };
  if (vState === 'login') return wrap(note('visitors.needLogin'));
  if (vState === 'error') return wrap(note('visitors.loadFailed'));
  if (!vData) return wrap(windowHtml() + note('visitors.loading'));
  return wrap(windowHtml() + opensHtml() + '<div>' + measurementHtml() + '</div>' + whoHtml() + whereHtml());
}
