/**
 * @file detail-versions.js
 * @description The words and the chart above a list of published versions: how far apart the
 *   publishes are, the sittings they fall into, and a bar per day. Moved out of detail.js as it was
 *   (a pure extraction), because the detail view and the versions dialog both use it and detail.js
 *   had passed the line ceiling.
 *
 *   The chart has no part in the shared set yet (see the MISSING PART note in the 2026-09-22 report:
 *   a bar strip), so its SVG keeps its own mount classes; the words around it are the set's parts.
 * @structure durationUnits · versionSinceText · versionSpanText · versionSittings · versionChartHtml ·
 *   versionSpanHtml
 * @usage import { versionSinceText, versionSpanText, versionSpanHtml } from './detail-versions.js';
 * @version-history
 *   v1.0.0 — 2026-09-22 — Extracted from detail.js unchanged in logic; the count line, the chart's
 *     head and the hint under it are drawn with parts-html.js (text, stack) instead of local
 *     classes, and the bars lose their rounded corners (the poster face has none).
 */
import { escapeHtml, gapMs, durationLabel } from './util.js';
import { t } from './i18n.js';
import { text, stack } from './parts-html.js';

/** The duration units in the language the catalogue is showing. */
function durationUnits() {
  return { s: t('dur.s'), min: t('dur.min'), h: t('dur.h'), d: t('dur.d') };
}

/**
 * " · since the previous one 1 min 53 s" for one row of a newest-first version list, or '' for
 * the oldest row and for anything the stamps cannot answer.
 *
 * WHY THIS IS WORTH THE LINE. The node has stamped every publish since June and never pruned one
 * — 415 versions of one app on this node — and the list rendered each stamp beside the next
 * without ever subtracting them. So the shape of the work (which round was quick, which one was
 * the same bug three times) was on disk for every app here and readable in none of them.
 *
 * @param {Array<{ created_at?: string }>} versions newest first
 * @param {number} i
 */
export function versionSinceText(versions, i) {
  var prev = versions[i + 1];
  if (!prev) return '';
  var label = durationLabel(gapMs(versions[i].created_at, prev.created_at), durationUnits());
  return label ? ' · ' + t('versions.sincePrev') + ' ' + label : '';
}

/**
 * The one line above the list: how many versions, the day or the span of days they cover, and how
 * long the first is from the last.
 *
 * It says "first to last" and not "took", and the distinction is the whole point. Between two
 * publishes in one sitting the number is the length of a round; between June and August it is a
 * summer. The stamps cannot tell those apart and neither can this line, so it states the distance
 * and leaves the reading to the person.
 *
 * @param {Array<{ created_at?: string }>} versions newest first
 */
export function versionSpanText(versions) {
  if (versions.length < 2) return '';
  var newest = versions[0].created_at;
  var oldest = versions[versions.length - 1].created_at;
  if (!newest || !oldest) return '';
  var first = new Date(oldest).toLocaleDateString();
  var last = new Date(newest).toLocaleDateString();
  var when = first === last ? first : first + ' – ' + last;
  var span = durationLabel(gapMs(newest, oldest), durationUnits());
  return ' · ' + when + (span ? ' · ' + t('versions.span') + ' ' + span : '');
}

/**
 * Publishes grouped into sittings. A gap of two hours or more ends a sitting: publishes usually
 * come inside two hours of each other while someone is at it, and a longer gap means they went to
 * do something else, or came back another day. The time a sitting took is the time between its
 * first and last publish, which is what the stamps can honestly say; what happened before the
 * first publish is not on record and is not counted.
 *
 * @param {Array<{ created_at?: string }>} versions newest first
 * @returns {Array<{ start: number, end: number, n: number }>} oldest first
 */
var SITTING_GAP_MS = 2 * 60 * 60 * 1000;
function versionSittings(versions) {
  var stamps = [];
  for (var i = versions.length - 1; i >= 0; i--) {
    var ms = versions[i].created_at ? Date.parse(versions[i].created_at) : NaN;
    if (isFinite(ms)) stamps.push(ms);
  }
  var out = [], cur = null;
  for (var j = 0; j < stamps.length; j++) {
    if (!cur || stamps[j] - cur.end > SITTING_GAP_MS) { cur = { start: stamps[j], end: stamps[j], n: 1 }; out.push(cur); }
    else { cur.end = stamps[j]; cur.n++; }
  }
  return out;
}

/**
 * Publishes per day from the first day to the last, as one small bar chart: the rhythm of the
 * work at a glance, before the list of every version. Days with nothing stay empty so a pause
 * reads as a pause. Past four months the days are folded into weeks, so the bars stay readable.
 *
 * One series, so the bar colour is the accent and the text wears the text tokens; every bar carries
 * its day and its count as a title for the hover.
 */
function versionChartHtml(sittings) {
  if (!sittings.length) return '';
  var DAY = 24 * 60 * 60 * 1000;
  var dayOf = function (ms) { var d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  var counts = {};
  var first = Infinity, last = -Infinity;
  // Every publish counted on its own day; the sittings already hold the stamps in order.
  for (var s = 0; s < sittings.length; s++) {
    var st = sittings[s];
    for (var k = 0; k < st.stamps.length; k++) {
      var d = dayOf(st.stamps[k]);
      counts[d] = (counts[d] || 0) + 1;
      if (d < first) first = d; if (d > last) last = d;
    }
  }
  var days = Math.round((last - first) / DAY) + 1;
  var bucket = days > 120 ? 7 : 1;
  var bars = [];
  var max = 0;
  for (var day = first; day <= last; day += DAY * bucket) {
    var n = 0;
    for (var b = 0; b < bucket; b++) n += counts[day + b * DAY] || 0;
    bars.push({ day: day, n: n });
    if (n > max) max = n;
  }
  if (!max) return '';
  // Bars are drawn in CSS pixels and never stretched: two days are two narrow bars, not two slabs.
  var W = 720, H = 96, PAD = 2, BASE = H - 1;
  var bw = Math.min(28, Math.max(2, Math.floor((W - PAD * (bars.length - 1)) / bars.length)));
  var svgW = bars.length * bw + PAD * (bars.length - 1);
  var rects = '';
  for (var i = 0; i < bars.length; i++) {
    var h = bars[i].n ? Math.max(4, Math.round((bars[i].n / max) * (H - 14))) : 0;
    var x = i * (bw + PAD);
    var when = new Date(bars[i].day).toLocaleDateString();
    var label = when + (bucket > 1 ? ' +' + (bucket - 1) : '') + ' · ' + t('versions.perDay').replace('{n}', String(bars[i].n));
    rects += '<g class="version-bar"><title>' + escapeHtml(label) + '</title>' +
      '<rect class="version-bar-hit" x="' + x + '" y="0" width="' + bw + '" height="' + H + '" fill="transparent"></rect>' +
      (h ? '<rect class="version-bar-mark" x="' + x + '" y="' + (BASE - h) + '" width="' + bw + '" height="' + h + '"></rect>' : '') +
      '</g>';
  }
  return stack({ direction: 'horizontal', align: 'between' },
      text({ kind: 'label' }, escapeHtml(t('versions.chartTitle'))) +
      text({ kind: 'mono', tone: 'muted' }, escapeHtml(t('versions.chartMax').replace('{n}', String(max))))) +
    // The chart itself: no part in the set draws a bar strip yet, so this block is its own mount.
    '<div class="version-chart">' +
      '<svg class="version-chart-svg" width="' + svgW + '" height="' + H + '" viewBox="0 0 ' + svgW + ' ' + H + '" role="img" aria-label="' + escapeHtml(t('versions.chartTitle')) + '">' +
        '<line class="version-chart-base" x1="0" y1="' + BASE + '" x2="' + svgW + '" y2="' + BASE + '"></line>' + rects +
      '</svg>' +
      // A short chart (a few days) cannot hold a date at each end, so it says the span in one line.
      (svgW < 240
        ? '<div class="version-chart-axis"><span>' + escapeHtml(new Date(first).toLocaleDateString() + (first === last ? '' : ' – ' + new Date(last).toLocaleDateString())) + '</span></div>'
        : '<div class="version-chart-axis" style="max-width:' + svgW + 'px"><span>' + escapeHtml(new Date(first).toLocaleDateString()) + '</span><span>' + escapeHtml(new Date(last).toLocaleDateString()) + '</span></div>') +
    '</div>';
}

/**
 * The block above the detail view's list: the count, the days it covers, the sittings and the
 * time worked between publishes, then the chart. "first to last" is gone from here: a summer
 * between two publishes is not time spent, and the sittings say what is.
 */
export function versionSpanHtml(versions) {
  if (!versions.length) return '';
  var sittings = versionSittings(versions);
  // Keep the stamps on each sitting for the chart.
  var asc = [];
  for (var i = versions.length - 1; i >= 0; i--) { var ms = Date.parse(versions[i].created_at || ''); if (isFinite(ms)) asc.push(ms); }
  var idx = 0;
  for (var s = 0; s < sittings.length; s++) { sittings[s].stamps = asc.slice(idx, idx + sittings[s].n); idx += sittings[s].n; }
  var worked = 0;
  for (var w = 0; w < sittings.length; w++) worked += sittings[w].end - sittings[w].start;
  var parts = [versions.length + ' ' + t('versions.stored')];
  if (asc.length) {
    var firstDay = new Date(asc[0]).toLocaleDateString(), lastDay = new Date(asc[asc.length - 1]).toLocaleDateString();
    parts.push(firstDay === lastDay ? firstDay : firstDay + ' – ' + lastDay);
  }
  if (sittings.length) {
    var sit = t('versions.sittings').replace('{n}', String(sittings.length));
    var lab = durationLabel(worked, durationUnits());
    parts.push(lab ? sit + ', ' + t('versions.worked').replace('{t}', lab) : sit);
  }
  return stack({ density: 'compact' },
    text({ kind: 'mono', tone: 'muted' }, escapeHtml(parts.join(' · '))) +
    versionChartHtml(sittings) +
    text({ kind: 'caption', tone: 'muted' }, escapeHtml(t('versions.chartHint'))));
}
