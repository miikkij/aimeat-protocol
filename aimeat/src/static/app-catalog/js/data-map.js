/**
 * @file src/static/app-catalog/js/data-map.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The data map in the app catalogue's detail view: what this app is, what it is used
 *   for, and where its data actually lives.
 *
 *   THE CATALOGUE HAS ITS OWN RENDERER because it is an esbuild bundle with no Preact and no live
 *   channel. The VOCABULARY is shared: `data-map-model.js` beside this file is a verbatim copy of
 *   `public/components/data-map/model.js`, and test/unit/data-map-model.test.ts fails when the two
 *   drift.
 *
 *   It reads `/v1/datamap/apps/{owner}/{filename}` rather than the memory record, because assembling
 *   an owner identity out of a name and a server id is not a browser's job.
 * @structure dataMapSectionHtml · loadDataMapInto
 * @usage import { dataMapSectionHtml, loadDataMapInto } from './data-map.js'
 * @version-history
 *   v2.0.0 — 2026-08-25 — Rewritten for aimeat.datamap/2: the paragraph first, then the rows.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { t } from './i18n.js';
import { escapeHtml as esc } from './util.js';
import { labelKeyFor, orderRows, contradictionOf, placesOf, stateOf } from './data-map-model.js';

/** An axis value in the reader's language, or the raw word when this build does not know it. */
function label(axis, value) {
  const key = labelKeyFor(axis, value);
  return esc(key ? t(key) : String(value || ''));
}

/** The section shell, rendered before the fetch so the detail view has a stable anchor. */
export function dataMapSectionHtml() {
  return '<div class="dtl-section" id="detail-data-map">'
    + '<h3>' + esc(t('dataMap.title')) + '</h3>'
    + '<div class="dtl-dm-body"><p class="dtl-desc">' + esc(t('common.loading')) + '</p></div>'
    + '</div>';
}

function rowHtml(row) {
  const facts = [
    label('kind', row.kind),
    label('use', row.usedFor),
    label('readers', row.readers),
    label('loss', row.lossRisk),
    label('kept', row.keptFor),
  ];
  if (row.personalData === 'yes') {
    facts.push('<span class="dtl-dm-personal">' + esc(t('dataMap.personal.yes')) + '</span>');
  }
  const why = String(row.why || '').trim();
  return '<div class="dtl-dm-row' + (why ? '' : ' dtl-dm-row-unexplained') + '">'
    + '<div class="dtl-dm-head">'
    + '<span class="dtl-dm-what">' + esc(row.what) + '</span>'
    + '<span class="dtl-dm-holds">' + esc(row.holds || '') + '</span>'
    + '<span class="dtl-dm-where">' + label('where', row.where)
    + (row.whereExactly ? ' <span class="dtl-dm-where-exact">' + esc(row.whereExactly) + '</span>' : '')
    + '</span></div>'
    + '<div class="dtl-dm-facts">' + facts.join(' · ') + '</div>'
    + '<div class="dtl-dm-why' + (why ? '' : ' dtl-dm-why-missing') + '">'
    + esc(why || t('dataMap.row.noWhy')) + '</div>'
    + '</div>';
}

function elsewhereHtml(row) {
  return '<div class="dtl-dm-row">'
    + '<div class="dtl-dm-head">'
    + '<span class="dtl-dm-what">' + esc(row.what) + '</span>'
    + '<span class="dtl-dm-holds">' + esc(t('dataMap.elsewhere.' + row.status)) + '</span>'
    + '</div>'
    + '<div class="dtl-dm-facts">'
    + esc(t('dataMap.elsewhere.whereLabel')) + ' ' + esc(row.where) + ' · '
    + esc(t('dataMap.elsewhere.controlledByLabel')) + ' ' + esc(row.controlledBy)
    + '</div>'
    + '<div class="dtl-dm-why">' + esc(row.deletion || '') + '</div>'
    + '</div>';
}

function panelHtml(map) {
  if (!map || map.source === 'none') {
    return '<p class="dtl-desc">' + esc(t('dataMap.panel.missing')) + '</p>';
  }

  var out = '';
  var contradiction = contradictionOf(map);
  if (contradiction) {
    out += '<p class="dtl-dm-contradiction">' + esc(t(contradiction)) + '</p>';
  }

  out += '<p class="dtl-dm-what">'
    + esc(map.what || t('dataMap.panel.noWhat')) + '</p>';
  out += '<p class="dtl-dm-usedfor"><b>' + esc(t('dataMap.usedForLabel')) + '</b> '
    + esc(map.usedFor || t('dataMap.panel.noUsedFor')) + '</p>';
  out += '<p class="dtl-dm-form"><b>' + esc(t('dataMap.formLabel')) + '</b> '
    + label('form', map.form) + '</p>';

  out += '<h4>' + esc(t('dataMap.arrangementLabel')) + '</h4>';
  out += '<p class="dtl-desc">' + esc(map.arrangement || t('dataMap.panel.noArrangement')) + '</p>';
  var places = placesOf(map);
  if (places.length) {
    out += '<ul class="dtl-dm-places">'
      + places.map(function (p) { return '<li>' + label('where', p.where) + ' · ' + p.n + '</li>'; }).join('')
      + '</ul>';
  }

  var rows = orderRows(map.held || []);
  if (rows.length) {
    out += '<h4>' + esc(t('dataMap.rowsLabel')) + '</h4>' + rows.map(rowHtml).join('');
  }
  if ((map.machinery || []).length) {
    out += '<h4>' + esc(t('dataMap.machineryLabel')) + '</h4>'
      + '<p class="dtl-desc">' + esc(map.machinery.join(' · ')) + '</p>';
  }
  if ((map.leaves || []).length) {
    out += '<h4>' + esc(t('dataMap.leavesLabel')) + '</h4><ul class="dtl-dm-leaves">'
      + map.leaves.map(function (l) {
        return '<li>' + esc(l.what) + ' → ' + esc(l.to)
          + (l.recallable ? '' : ' <span class="dtl-dm-norecall">' + esc(t('dataMap.leaves.noRecall')) + '</span>')
          + '</li>';
      }).join('') + '</ul>';
  }
  if ((map.elsewhere || []).length) {
    out += '<h4>' + esc(t('dataMap.elsewhereLabel')) + '</h4>'
      + map.elsewhere.map(elsewhereHtml).join('');
  }
  return out;
}

/**
 * Fetch one app's map and render it into the section.
 *
 * Findings are owner-only and the route decides that, so this simply renders what comes back.
 */
export async function loadDataMapInto(owner, filename) {
  const section = document.getElementById('detail-data-map');
  if (!section) return;
  const body = section.querySelector('.dtl-dm-body');
  if (!body) return;

  try {
    const res = await fetch('/v1/datamap/apps/' + encodeURIComponent(owner)
      + '/' + encodeURIComponent(filename));
    const json = await res.json();
    const map = json && json.data ? json.data.data_map : null;
    const findings = (json && json.data && json.data.findings) || [];

    let html = panelHtml(map);
    if (findings.length) {
      html += '<h4>' + esc(t('dataMap.findingsLabel')) + '</h4><ul class="dtl-dm-findings">'
        + findings.map(function (f) { return '<li>' + esc(f.message) + '</li>'; }).join('')
        + '</ul>';
    }
    body.innerHTML = html;
    section.className = 'dtl-section dtl-dm-' + stateOf(map);
  } catch (err) {
    body.innerHTML = '<p class="dtl-desc">' + esc(t('dataMap.panel.missing')) + '</p>';
  }
}
