/**
 * @file dialogs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalog's dialogs on the site's one dialog: public/js/dialog.js for the closing
 *   rules and public/css/dialog.css for the look, both built into this page, so a dialog here has
 *   the same header, body, footer, phone sheet and ways out as one in the SPA. Every
 *   <dialog class="dlg"> in the template, and the one server-io.js builds for an app's permissions,
 *   opens and closes through this module.
 *   The X, a button marked data-dlg-close, Escape and a press on the page behind all end in one
 *   close, which is the dialog's own closer when it registered one with onDlgClose (the add form
 *   resets, the confirm answers no, the source editor asks about unsaved work). Escape and the page
 *   behind do nothing once something has been typed in the dialog, unless it says
 *   data-dlg-guard="off"; the X always closes.
 * @structure initDialogs() · upgradeDialog(dialog) · openDlg(id) · closeDlg(id) · isDlgOpen(id) ·
 *   anyDlgOpen() · onDlgClose(id, fn)
 * @usage import { openDlg, closeDlg, isDlgOpen, onDlgClose } from './dialogs.js';
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (wish "Yksi dialogikomponentti kaikille dialogeille").
 */
import { wireDialog, CLOSE_ICON } from '../../../../public/js/dialog.js';
import { t } from './i18n.js';

// What closing a dialog means, when it means more than hiding it. Keyed by the dialog's id.
var closers = {};
var wirings = new WeakMap();
// A dialog this module closed: the `close` event that follows is the echo of that, not a request.
var closedHere = new WeakSet();

function byId(id) {
  return typeof id === 'string' ? document.getElementById(id) : id;
}

function requestClose(dialog) {
  var fn = closers[dialog.id];
  if (fn) fn(); else closeDlg(dialog);
}

/** Register what closing this dialog does. The X, Escape, the page behind and data-dlg-close end here. */
export function onDlgClose(id, fn) {
  closers[id] = fn;
}

/** Give one <dialog class="dlg"> its drawn X, its accessible name and its closing rules. Idempotent. */
export function upgradeDialog(dialog) {
  if (!dialog || wirings.has(dialog)) return;
  var title = dialog.querySelector('.dlg-title');
  if (title) {
    if (!title.id) title.id = dialog.id + '-heading';
    dialog.setAttribute('aria-labelledby', title.id);
  }
  var x = dialog.querySelector('.dlg-close');
  if (x) {
    x.innerHTML = CLOSE_ICON;
    x.setAttribute('data-dlg-close', '');
  }
  dialog.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-dlg-close]') : null;
    if (btn && dialog.contains(btn)) requestClose(dialog);
  });
  wirings.set(dialog, wireDialog(dialog, {
    guard: dialog.getAttribute('data-dlg-guard') !== 'off',
    onRequestClose: function (reason) {
      if (reason === 'native' && closedHere.has(dialog)) { closedHere.delete(dialog); return; }
      requestClose(dialog);
    },
  }));
}

/** Upgrade every dialog the template carries. Run once, before anything can open one. */
export function initDialogs() {
  var all = document.querySelectorAll('dialog.dlg');
  for (var i = 0; i < all.length; i++) upgradeDialog(all[i]);
}

/** Open a dialog (an id or the element) as a modal. One that is open already stays as it is. */
export function openDlg(id) {
  var dialog = byId(id);
  if (!dialog) return;
  upgradeDialog(dialog);
  if (dialog.open) return;
  wirings.get(dialog).reset();
  // The X's name follows the language, which may have changed since the page loaded.
  var x = dialog.querySelector('.dlg-close');
  if (x) x.setAttribute('aria-label', t('common.close'));
  dialog.showModal();
}

/** Close a dialog without asking its closer; the closer itself calls this. */
export function closeDlg(id) {
  var dialog = byId(id);
  if (!dialog || !dialog.open) return;
  closedHere.add(dialog);
  dialog.close();
}

export function isDlgOpen(id) {
  var dialog = byId(id);
  return !!(dialog && dialog.open);
}

/** Whether any dialog is open, so the page's own shortcuts can stand aside while one is. */
export function anyDlgOpen() {
  return !!document.querySelector('dialog.dlg[open]');
}
