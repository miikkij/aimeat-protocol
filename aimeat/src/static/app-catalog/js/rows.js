/**
 * @file rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row per app, for every list the catalog shows (your apps, the community, the
 *   favourites). Both callers hand in the same plain model, so the three lists cannot drift apart
 *   in what a row looks like or where its buttons sit. The model is what the row SHOWS; the
 *   callers decide what each button DOES (the onclick strings), because that differs by list.
 * @structure listHeadHtml · rowHtml · fmtKb · fmtDate
 * @usage import { listHeadHtml, rowHtml, fmtKb, fmtDate } from './rows.js';
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "App Catalog Alternate".
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

/** The column heads of a list; the phone stylesheet hides them and the rows carry their own labels. */
export function listHeadHtml() {
  return '<div class="cat-list-head" aria-hidden="true">' +
      '<div></div>' +
      '<div>' + escapeHtml(t('list.app')) + '</div>' +
      '<div>' + escapeHtml(t('list.what')) + '</div>' +
      '<div>' + escapeHtml(t('list.state')) + '</div>' +
      '<div>' + escapeHtml(t('list.opens')) + '</div>' +
      '<div></div>' +
    '</div>';
}

/**
 * One row.
 * @param {object} m
 *   icon, name (plain text), nameExtra (trusted html after the name: AI markers, agent marker),
 *   favStar (trusted html, the ⭐ toggle, or ''), meta (plain text line under the name),
 *   desc (plain text), state ('listed' | 'unlisted' | 'local'), draft (bool), opens (number | null),
 *   tags (array, for the filter attributes), rowClick (js string, opens the details),
 *   actions: [{ label, onclick, title, kind: 'open' | 'draft' | 'more' | 'plain' }], index (for the entrance delay)
 */
export function rowHtml(m) {
  var stateClass = m.state === 'unlisted' ? ' is-unlisted' : '';
  var stateLabel = m.state === 'unlisted' ? t('status.parked') : (m.state === 'local' ? t('status.local') : t('status.published'));
  var statePill = '<span class="cat-pill' + (m.state === 'unlisted' ? ' cat-pill--dim' : '') + '">' + escapeHtml(stateLabel) + '</span>';
  var draftPill = m.draft ? '<span class="cat-pill cat-pill--sun" title="' + escapeHtml(t('card.stagingHint')) + '">' + escapeHtml(t('card.draft')) + '</span>' : '';
  var buttons = '';
  for (var i = 0; i < (m.actions || []).length; i++) {
    var a = m.actions[i];
    var cls = a.kind === 'draft' ? ' class="cat-act--draft"' : (a.kind === 'more' ? ' class="cat-act--more"' : '');
    buttons += '<button type="button"' + cls + ' onclick="event.stopPropagation(); ' + a.onclick + '"' +
      (a.title ? ' title="' + escapeHtml(a.title) + '"' : '') + '>' + escapeHtml(a.label) + '</button>';
  }
  return '<div class="cat-row' + stateClass + (m.draft ? ' is-draft' : '') + '"' +
      filterAttr(m.name, m.tags, m.desc) +
      (m.rowClick ? ' onclick="' + m.rowClick + '"' : '') +
      ' style="animation-delay:' + ((m.index || 0) * 0.03) + 's">' +
      '<div class="cat-row-icon">' + escapeHtml(m.icon || '\u{1F4DD}') + '</div>' +
      '<div class="cat-row-main">' +
        '<div class="cat-row-name">' + (m.favStar || '') + '<span>' + escapeHtml(m.name) + '</span>' + (m.nameExtra || '') + '</div>' +
        (m.meta ? '<div class="cat-row-meta">' + escapeHtml(m.meta) + '</div>' : '') +
      '</div>' +
      '<div class="cat-row-desc">' + escapeHtml(m.desc || '') + '</div>' +
      '<div class="cat-row-state">' + statePill + draftPill + '</div>' +
      '<div class="cat-row-opens">' + (typeof m.opens === 'number' ? String(m.opens) : '') + '</div>' +
      '<div class="cat-row-actions">' + buttons + '</div>' +
    '</div>';
}
