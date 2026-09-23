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
 *   drift. The LOOK is shared too: every piece is a part of the site's set (parts-html.js).
 *
 *   It reads `/v1/datamap/apps/{owner}/{filename}` rather than the memory record, because assembling
 *   an owner identity out of a name and a server id is not a browser's job.
 * @structure dataMapSectionHtml · loadDataMapInto
 * @usage import { dataMapSectionHtml, loadDataMapInto } from './data-map.js'
 * @version-history
 *   v2.1.0 — 2026-09-22 — Composed from the shared set: the section and its slot, the two labelled
 *     facts as key-value rows, the sub-headings, one list row per data row, the contradiction as the
 *     solid aside. The body is found by `data-dm-body` and the map's state is `data-dm-state` on the
 *     slot, so no styling class carries a hook any more.
 *   v2.0.0 — 2026-08-25 — Rewritten for aimeat.datamap/2: the paragraph first, then the rows.
 *   v1.0.0 — 2026-08-25 — Initial.
 */
import { t } from './i18n.js';
import { escapeHtml as esc } from './util.js';
import {
  labelKeyFor, orderRows, contradictionOf, placesOf, stateOf, DATA_MAP_SPEC,
} from './data-map-model.js';
import { section, sectionSlot, listRow, keyValue, stack, surface, text } from './parts-html.js';

/** An axis value in the reader's language, or the raw word when this build does not know it. */
function label(axis, value) {
  const key = labelKeyFor(axis, value);
  return esc(key ? t(key) : String(value || ''));
}

function body(words) { return text({ kind: 'body' }, words); }
function subHead(key) { return text({ kind: 'label' }, esc(t(key))); }

/** The section shell, rendered before the fetch so the detail view has a stable anchor. */
export function dataMapSectionHtml() {
  return sectionSlot({ id: 'detail-data-map', attrs: ' data-dtl-section' },
    section({
      title: esc(t('dataMap.title')),
      body: '<div data-dm-body>' + text({ kind: 'body', tone: 'muted' }, esc(t('common.loading'))) + '</div>',
    }));
}

/** One held row: what it is (mono), what it holds, where it lives, its facts, and why it is kept. */
function rowHtml(row) {
  const facts = [
    label('kind', row.kind),
    label('use', row.usedFor),
    label('readers', row.readers),
    label('loss', row.lossRisk),
    label('kept', row.keptFor),
  ];
  if (row.personalData === 'yes') {
    facts.push(text({ kind: 'mono', tone: 'coral' }, esc(t('dataMap.personal.yes'))));
  }
  const why = String(row.why || '').trim();
  return listRow({
    name: text({ kind: 'mono' }, esc(row.what)),
    detail: esc(row.holds || ''),
    detailKind: 'text',
    value: label('where', row.where) + (row.whereExactly ? '<br>' + text({ kind: 'caption', tone: 'muted' }, esc(row.whereExactly)) : ''),
    body: stack({ density: 'compact' },
      text({ kind: 'mono', tone: 'muted' }, facts.join(' · '))
      + text({ kind: 'body', tone: why ? 'muted' : 'coral' }, esc(why || t('dataMap.row.noWhy')))),
  });
}

function elsewhereHtml(row) {
  return listRow({
    name: text({ kind: 'mono' }, esc(row.what)),
    detail: esc(t('dataMap.elsewhere.' + row.status)),
    detailKind: 'text',
    body: stack({ density: 'compact' },
      text({ kind: 'mono', tone: 'muted' },
        esc(t('dataMap.elsewhere.whereLabel')) + ' ' + esc(row.where) + ' · '
        + esc(t('dataMap.elsewhere.controlledByLabel')) + ' ' + esc(row.controlledBy))
      + text({ kind: 'body', tone: 'muted' }, esc(row.deletion || ''))),
  });
}

/** A titled block of the panel: the sub-heading and what goes under it. */
function block(key, content) { return stack({ density: 'compact' }, subHead(key) + content); }

function panelHtml(map) {
  if (!map || map.spec !== DATA_MAP_SPEC || map.source === 'none') {
    return body(esc(t('dataMap.panel.missing')));
  }

  var out = '';
  var contradiction = contradictionOf(map);
  if (contradiction) {
    out += surface({ kind: 'aside', tone: 'danger' }, text({ kind: 'body' }, esc(t(contradiction))));
  }

  out += text({ kind: 'lead' }, esc(map.what || t('dataMap.panel.noWhat')));
  out += '<div>'
    + keyValue(esc(t('dataMap.usedForLabel')), esc(map.usedFor || t('dataMap.panel.noUsedFor')))
    + keyValue(esc(t('dataMap.formLabel')), label('form', map.form))
    + '</div>';

  var places = placesOf(map);
  out += block('dataMap.arrangementLabel',
    body(esc(map.arrangement || t('dataMap.panel.noArrangement')))
    + (places.length
      ? stack({ direction: 'wrap', density: 'compact' }, places.map(function (p) {
        return text({ kind: 'mono', tone: 'muted' }, label('where', p.where) + ' · ' + p.n);
      }).join(''))
      : ''));

  var rows = orderRows(map.held || []);
  if (rows.length) out += block('dataMap.rowsLabel', '<div>' + rows.map(rowHtml).join('') + '</div>');
  if ((map.machinery || []).length) out += block('dataMap.machineryLabel', body(esc(map.machinery.join(' · '))));
  if ((map.leaves || []).length) {
    out += block('dataMap.leavesLabel', map.leaves.map(function (l) {
      return body(esc(l.what) + ' → ' + esc(l.to)
        + (l.recallable ? '' : ' ' + text({ kind: 'caption', tone: 'danger' }, esc(t('dataMap.leaves.noRecall')))));
    }).join(''));
  }
  if ((map.elsewhere || []).length) {
    out += block('dataMap.elsewhereLabel', '<div>' + map.elsewhere.map(elsewhereHtml).join('') + '</div>');
  }
  return stack({ density: 'roomy' }, out);
}

/**
 * Fetch one app's map and render it into the section.
 *
 * Findings are owner-only and the route decides that, so this simply renders what comes back.
 */
export async function loadDataMapInto(owner, filename) {
  const slot = document.getElementById('detail-data-map');
  if (!slot) return;
  const target = slot.querySelector('[data-dm-body]');
  if (!target) return;

  try {
    const res = await fetch('/v1/datamap/apps/' + encodeURIComponent(owner)
      + '/' + encodeURIComponent(filename));
    const json = await res.json();
    const map = json && json.data ? json.data.data_map : null;
    const findings = (json && json.data && json.data.findings) || [];

    let html = panelHtml(map);
    if (findings.length) {
      html += block('dataMap.findingsLabel', findings.map(function (f) { return body(esc(f.message)); }).join(''));
    }
    target.innerHTML = stack({ density: 'roomy' }, html);
    slot.setAttribute('data-dm-state', stateOf(map));
  } catch (err) {
    target.innerHTML = body(esc(t('dataMap.panel.missing')));
  }
}
