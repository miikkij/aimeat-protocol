/**
 * @file rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row per app, for every list the catalog shows (your apps, the community, the
 *   favourites). Both callers hand in the same plain model, so the three lists cannot drift apart
 *   in what a row looks like or where its doors sit. The model is what the row SHOWS; the callers
 *   decide what each door DOES (the onclick strings), because that differs by list.
 *
 *   A row is a line in a numbered index. Pressing it opens a panel in place under it with the doors
 *   (Open, the draft, Details, and a community app's Fork or Agent) and one line about where the
 *   work is; pressing another row closes the first. The doors are buttons of their own, so a reader
 *   who knows what they want presses the door and never opens the panel.
 * @structure rowHtml · toggleRow · fmtKb · fmtDate
 * @usage import { rowHtml, toggleRow, fmtKb, fmtDate } from './rows.js';
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "App Catalog Alternate".
 *   v2.0.0 — 2026-08-28 — The poster face (design canvas "App Catalog Poster"): the row is a
 *     numbered index line and opens a panel in place; the doors are an ink slab and underlined
 *     words; the column heads are gone.
 */
import { escapeHtml, filterAttr } from './util.js';
import { t } from './i18n.js';

/** "260 kB" from a byte count; empty when unknown. */
export function fmtKb(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return bytes + ' B';
  var kb = bytes / 1024;
  if (kb < 1000) return Math.round(kb) + ' kB';
  return (Math.round(kb / 102.4) / 10) + ' MB';
}

/** The viewer's own short date, as everywhere else in the catalog; empty when unknown. */
export function fmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

/**
 * One row and the panel under it.
 * @param {object} m
 *   n (1-based position in the list), icon, name (plain text), nameExtra (trusted html after the
 *   name: AI markers, agent marker), favStar (trusted html, the ⭐ toggle, or ''), meta (plain text
 *   line under the name), desc (plain text), state ('listed' | 'unlisted' | 'local'),
 *   draft (bool), opens (number | null), tags (array, for the filter attributes),
 *   line (plain text: where the work is, shown in the panel),
 *   actions: [{ label, onclick, title, kind: 'slab' | 'word' | 'danger' }]
 */
export function rowHtml(m) {
  var stateText = m.state === 'unlisted' ? t('status.parked') : (m.state === 'local' ? t('status.local') : t('status.published'));
  if (m.draft) stateText += ' · ' + t('state.draftShort');
  var doors = '';
  for (var i = 0; i < (m.actions || []).length; i++) {
    var a = m.actions[i];
    var cls = a.kind === 'slab' ? 'cat-slab' : (a.kind === 'danger' ? 'cat-word cat-word--danger' : 'cat-word');
    doors += '<button type="button" class="' + cls + '" onclick="event.stopPropagation(); ' + a.onclick + '"' +
      (a.title ? ' title="' + escapeHtml(a.title) + '"' : '') + '>' + escapeHtml(a.label) + '</button>';
  }
  var n = m.n ? String(m.n) : '';
  if (n.length === 1) n = '0' + n;
  return '<div class="cat-row' + (m.state === 'unlisted' ? ' is-unlisted' : '') + (m.draft ? ' is-draft' : '') + '"' +
      filterAttr(m.name, m.tags, m.desc) +
      ' onclick="window._launcher.toggleRow(this)"' +
      ' style="animation-delay:' + (((m.n || 1) - 1) * 0.03) + 's">' +
      '<div class="cat-row-n">' + n + '</div>' +
      '<div class="cat-row-icon">' + escapeHtml(m.icon || '\u{1F4DD}') + '</div>' +
      '<div class="cat-row-main">' +
        '<div class="cat-row-name">' + (m.favStar || '') + '<span>' + escapeHtml(m.name) + '</span>' + (m.nameExtra || '') + '</div>' +
        (m.meta ? '<div class="cat-row-meta">' + escapeHtml(m.meta) + '</div>' : '') +
      '</div>' +
      '<div class="cat-row-desc">' + escapeHtml(m.desc || '') + '</div>' +
      '<div class="cat-row-state">' + escapeHtml(stateText) + '</div>' +
      '<div class="cat-row-opens">' + (typeof m.opens === 'number' ? String(m.opens) : '') + '</div>' +
      '<div class="cat-row-arrow" aria-hidden="true"></div>' +
    '</div>' +
    '<div class="cat-row-panel">' + doors +
      (m.line ? '<span class="cat-row-line">' + escapeHtml(m.line) + '</span>' : '') +
    '</div>';
}

/** Open this row's panel and close every other one in the same list. */
export function toggleRow(el) {
  if (!el) return;
  var wasOpen = el.classList.contains('is-open');
  var list = el.parentNode;
  if (list) {
    var open = list.querySelectorAll('.cat-row.is-open');
    for (var i = 0; i < open.length; i++) open[i].classList.remove('is-open');
  }
  if (!wasOpen) el.classList.add('is-open');
}
