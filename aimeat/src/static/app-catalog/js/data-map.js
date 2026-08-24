/**
 * @file src/static/app-catalog/js/data-map.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map inside the App Detail view: where this app puts what, and on what basis
 *   anyone can say so.
 *
 *   THIS IS THE ONE PLACE AN APP'S MAP CAN BE READ IN FULL. Every other surface shows the one-line
 *   summary that rides on the manifest, and the summary is deliberately not the map — the rows carry
 *   a sentence each and a listing of 169 apps cannot open 169 documents. The strip on the profile
 *   Apps tab links here.
 *
 *   The document is a PUBLIC memory record, so this fetches it with no credentials: the map is the
 *   promise the app makes to whoever installs it, and somebody weighing an app has not signed in
 *   yet. The publish check's finding is not public and never arrives here.
 *
 *   The rules — the five bases, the four states, the reading order — come from data-map-model.js,
 *   which is a verbatim copy of the shared browser module and is held to it by a unit test.
 * @structure dataMapSectionHtml · loadDataMapInto
 * @usage import { dataMapSectionHtml, loadDataMapInto } from './data-map.js'
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial. Until this existed the map was written, stamped and summarised
 *     and there was nowhere to actually read one.
 */
import { escapeHtml } from './util.js';
import { t } from './i18n.js';
import { loadConfig } from './config.js';
import { mapState, orderRows, contradictions, covers } from './data-map-model.js';

/** Chip plus its sentence, both always: the chip alone is a word nobody outside this repo knows. */
function basisCell(tier) {
  var key = { 'schema-locked': 'locked', 'declared-space': 'declared', 'platform-prefix': 'platform', 'owner-named': 'named' }[tier] || 'unknown';
  return '<span class="dtl-dm-basis dtl-dm-basis-' + key + '">' +
    '<span class="dtl-dm-chip">' + escapeHtml(t('datamap.basis.' + key)) + '</span>' +
    '<span class="dtl-dm-note">' + escapeHtml(t('datamap.basisNote.' + key)) + '</span>' +
  '</span>';
}

function rowHtml(row, disagrees) {
  var g = row.grant || {};
  var personal = row.personalData === 'yes' ? 'yes' : row.personalData === 'no' ? 'no' : 'unstated';
  var why = String(row.why || '').trim();
  return '<div class="dtl-dm-row' + (disagrees ? ' dtl-dm-row-off' : '') + '">' +
    '<div class="dtl-dm-head">' +
      '<span class="dtl-dm-family">' + escapeHtml(g.pattern || '') + '</span>' +
      '<span class="dtl-dm-rights">' + escapeHtml((g.rights || []).join(', ')) + '</span>' +
      basisCell((row.basis || {}).tier) +
      '<span class="dtl-dm-personal dtl-dm-personal-' + personal + '">' +
        escapeHtml(t('datamap.personal.' + personal)) + '</span>' +
    '</div>' +
    '<div class="dtl-dm-why' + (why ? '' : ' dtl-dm-why-missing') + '">' +
      escapeHtml(why || t('datamap.noWhy')) + '</div>' +
    '<div class="dtl-dm-detail">' +
      '<span>' + escapeHtml(t('datamap.deleteMeans')) + '</span> ' +
      escapeHtml((row.deletion && row.deletion.says) || t('datamap.deleteUnknown')) +
    '</div>' +
  '</div>';
}

/**
 * The section, rendered from a map document.
 *
 * A map nobody has confirmed says so in a banner rather than a badge: on the day this shipped every
 * app's map was a draft the node worked out, and a corner marker would have made 169 machine guesses
 * look like 169 promises.
 */
export function dataMapHtmlFor(map) {
  if (!map) {
    return '<p class="dtl-desc">' + escapeHtml(t('datamap.none')) + '</p>';
  }
  var held = map.held || [];
  var elsewhere = map.elsewhere || [];
  if (held.length === 0 && elsewhere.length === 0) {
    return '<p class="dtl-desc">' + escapeHtml(t('datamap.storesNothing')) + '</p>';
  }

  var state = mapState(map, []);
  var out = '';
  if (state === 'derived') {
    out += '<div class="dtl-dm-banner">' + escapeHtml(t('datamap.derivedNote')) + '</div>';
  }
  var off = contradictions(map, []);
  var rows = orderRows(map, []);
  out += '<div class="dtl-dm-rows">';
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var bad = off.undeclared.some(function (o) { return covers((r.grant || {}).pattern, o.family); });
    out += rowHtml(r, bad);
  }
  out += '</div>';

  if (elsewhere.length > 0) {
    out += '<h4 class="dtl-dm-sub">' + escapeHtml(t('datamap.elsewhereTitle')) + '</h4><div class="dtl-dm-rows">';
    for (var j = 0; j < elsewhere.length; j++) {
      var e = elsewhere[j];
      out += '<div class="dtl-dm-row">' +
        '<div class="dtl-dm-head-simple">' +
          '<span class="dtl-dm-family">' + escapeHtml((e.grant || {}).pattern || '') + '</span>' +
          '<span class="dtl-dm-rights">' + escapeHtml(t('datamap.elsewhere.' + e.status)) + '</span>' +
        '</div>' +
        '<div class="dtl-dm-why">' + escapeHtml(e.where || '') + '</div>' +
        '<div class="dtl-dm-detail">' + escapeHtml((e.deletion && e.deletion.says) || '') + '</div>' +
      '</div>';
    }
    out += '</div>';
  }
  return out;
}

/** The section shell, with a stable id so the async load can fill it in place. */
export function dataMapSectionHtml() {
  return '<div class="dtl-section" id="detail-data-map">' +
    '<h3>' + escapeHtml(t('datamap.title')) + '</h3>' +
    '<p class="dtl-desc">' + escapeHtml(t('datamap.loading')) + '</p>' +
  '</div>';
}

/**
 * Fetch the document and render it. No credentials: a published app's map is public, and the person
 * deciding whether to install it has not signed in.
 */
export function loadDataMapInto(owner, filename, stamp) {
  var el = document.getElementById('detail-data-map');
  if (!el) return;
  var head = '<h3>' + escapeHtml(t('datamap.title')) + '</h3>';

  if (!stamp || !stamp.docKey) {
    el.innerHTML = head + '<p class="dtl-desc">' + escapeHtml(t('datamap.none')) + '</p>';
    return;
  }
  var config = loadConfig();
  var base = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
  // owner + filename, the same pair the app's own address uses. Reading the record directly would
  // mean assembling `owner@nodeId` here, and a browser has no business knowing the node's id.
  fetch(base + '/v1/datamap/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      var map = j && j.data && j.data.data_map;
      el.innerHTML = head + dataMapHtmlFor(map);
    })
    .catch(function () {
      el.innerHTML = head + '<p class="dtl-desc">' + escapeHtml(t('datamap.unreadable')) + '</p>';
    });
}
