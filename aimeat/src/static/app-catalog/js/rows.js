/**
 * @file rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row per app, for every list the catalog shows (your apps, the community, the
 *   favourites). Both callers hand in the same plain model, so the three lists cannot drift apart
 *   in what a row looks like or where its doors sit. The model is what the row SHOWS; the callers
 *   decide what each door DOES (the onclick strings), because that differs by list.
 *
 *   A row is the set's index row (listRow with a number and an arrow, parts-html.js). Pressing it
 *   opens its doors in place under it (Open, the draft, Details, and a community app's Fork or
 *   Agent) with one line about where the work is; pressing another row closes the first. The doors
 *   are buttons of their own, so a reader who knows what they want presses the door and never opens
 *   the row. Each row sits in a plain wrapper that carries the search attributes and the `hidden`
 *   a filter sets, because the row itself is a grid and a grid ignores `hidden`.
 * @structure rowHtml · toggleRow · fmtKb · fmtDate
 * @usage import { rowHtml, toggleRow, fmtKb, fmtDate } from './rows.js';
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial, built to the design canvas "App Catalog Alternate".
 *   v2.0.0 — 2026-08-28 — The poster face (design canvas "App Catalog Poster"): the row is a
 *     numbered index line and opens a panel in place; the doors are an ink slab and underlined
 *     words; the column heads are gone.
 *   v3.0.0 — 2026-09-22 — The row is the site's ListRow (parts-html.js listRow): number, icon and
 *     name, the meta line in mono with the markers, the state chip and the opens count as its value, the star as its
 *     action, the arrow; the description and the doors in its body. The doors are underlined words,
 *     because the page's one loud slab is Create an app. toggleRow finds the row by a data hook.
 */
import { escapeHtml, filterAttr } from './util.js';
import { t } from './i18n.js';
import { listRow, action, chip, text, stack } from './parts-html.js';

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
 * One row and the doors under it.
 * @param {object} m
 *   n (1-based position in the list), icon, name (plain text), nameExtra (trusted html after the
 *   name: AI markers, agent marker), favStar (trusted html, the star toggle, or ''), meta (plain text
 *   line under the name), desc (plain text), state ('listed' | 'unlisted' | 'local'),
 *   draft (bool), opens (number | null), tags (array, for the filter attributes),
 *   line (plain text: where the work is, shown with the doors),
 *   actions: [{ label, onclick, title, kind: 'slab' | 'word' | 'danger' }]
 */
export function rowHtml(m) {
  var stateText = m.state === 'unlisted' ? t('status.parked') : (m.state === 'local' ? t('status.local') : t('status.published'));
  if (m.draft) stateText += ' · ' + t('state.draftShort');
  var doors = '';
  for (var i = 0; i < (m.actions || []).length; i++) {
    var a = m.actions[i];
    doors += action({ kind: 'secondary', tone: a.kind === 'danger' ? 'danger' : 'plain', onclick: 'event.stopPropagation(); ' + a.onclick, title: a.title }, escapeHtml(a.label));
  }
  var n = m.n ? String(m.n) : '';
  if (n.length === 1) n = '0' + n;
  // The doors wait under the row until it is opened; toggleRow shows them.
  var panel = '<div data-row-doors hidden>' + stack({ direction: 'wrap', align: 'center' },
    doors + (m.line ? text({ kind: 'caption', tone: 'muted' }, escapeHtml(m.line)) : '')) + '</div>';
  var body = (m.desc ? text({ kind: 'body', tone: 'muted' }, escapeHtml(m.desc)) : '') + panel;
  var value = chip(escapeHtml(stateText), m.state === 'unlisted' ? 'muted' : 'coral') +
    (typeof m.opens === 'number' ? ' ' + text({ kind: 'number', size: 'small' }, String(m.opens)) : '');
  return '<div data-app-row' + filterAttr(m.name, m.tags, m.desc) + '>' +
    listRow({
      number: n,
      // The whole row opens; the name is its button, so the keyboard reaches it too. The click
      // bubbles to the row's own handler, which is the one toggle.
      name: escapeHtml(m.icon || '\u{1F4DD}') + ' ' + escapeHtml(m.name),
      onOpen: ' ',
      open: false,
      // The markers (chips, and the fork count's own button) ride on the meta line, outside the
      // name's button: a button inside a button is not valid HTML.
      detail: (m.meta ? escapeHtml(m.meta) : '') + (m.nameExtra || ''),
      value: value,
      actions: m.favStar || '',
      arrow: true,
      muted: m.state === 'unlisted',
      body: body,
      rowAttrs: ' onclick="window._launcher.toggleRow(this)"'
    }) +
  '</div>';
}

/** Open this row's doors and close every other open row in the same list. */
export function toggleRow(el) {
  var wrap = el && el.closest ? el.closest('[data-app-row]') : null;
  if (!wrap) return;
  var setOpen = function (w, on) {
    var row = w.firstElementChild;
    var doors = w.querySelector('[data-row-doors]');
    if (doors) doors.hidden = !on;
    if (row) row.setAttribute('data-selected', on ? 'yes' : 'no');
    // The arrow is the row's last marker child: right while shut, down while open.
    var kids = row ? row.children : [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].getAttribute('aria-hidden') === 'true' && (kids[i].textContent === '→' || kids[i].textContent === '↓')) kids[i].textContent = on ? '↓' : '→';
    }
    var btn = row ? row.querySelector('[aria-expanded]') : null;
    if (btn) btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  var wasOpen = wrap.firstElementChild && wrap.firstElementChild.getAttribute('data-selected') === 'yes';
  var list = wrap.parentNode;
  if (list) {
    var all = list.querySelectorAll('[data-app-row]');
    for (var i = 0; i < all.length; i++) if (all[i] !== wrap) setOpen(all[i], false);
  }
  setOpen(wrap, !wasOpen);
}
