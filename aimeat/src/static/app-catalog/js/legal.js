/**
 * @file legal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Legal pages" and "Audit log" sections of an own published app's detail view.
 *   The app answers for what it does — a shop for its sales, an app that handles personal data
 *   for that data — and not the node, so the pages are the app's: terms, privacy notice, imprint,
 *   refunds and withdrawal, accessibility statement, cookies, support. Each is written here as
 *   markdown or HTML, or linked to where it already lives, and served at /terms, /privacy and so
 *   on under the app's own address.
 *
 *   Reads GET /v1/apps/{owner}/{filename}/legal (the owner gets the content too) and writes
 *   PATCH /v1/apps/{filename} { legal }. The audit log is GET /v1/apps/{owner}/{filename}/audit.
 *   The server decides everything: what counts as a page, what the app ought to have, and what
 *   the person is told.
 * @usage import { legalOnOpen, legalSectionInner, auditSectionInner, legalChipHtml, legalScrollTo, legalEdit, legalCancel, legalSave, legalRemove, auditMore } from './legal.js';
 * @version-history
 *   v1.3.0 — 2026-09-22 — Composed from the shared set (parts-html.js): both sections are drawn here
 *     as the set's section; a page kind is a list row (the Recommended chip by the name, the state
 *     at the right, Remove as a danger word), the editor the set's fields in a record, the audit log
 *     a timeline of list rows, and the masthead chip the set's coral chip as a text action (the
 *     square glyph is gone). The chip finds the head's chip row by data-dtl-chips first.
 *   v1.2.0 — 2026-09-13 — A page the app ought to have says so in a chip beside its name
 *     ("Recommended") instead of a sun bar down the row's edge: the sun bar now means the lines a
 *     chosen tab governs, and a recommendation is not a choice.
 *   v1.1.0 — 2026-08-29 — A hot chip on the masthead names how many pages are still to write and
 *     scrolls to the section. Nothing is blocked; it is meant to be noticed.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { escapeHtml } from './util.js';
import { showNotice } from './ui.js';
import { section, listRow, chip, action, stack, surface, text, field } from './parts-html.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';
import { fmtDate } from './rows.js';

var KINDS = ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'cookies', 'support'];

var lgOwner = '';
var lgAppId = '';
var lgState = 'off';      // 'off' | 'loading' | 'ready' | 'error'
var lgData = null;        // { legal, readiness, links, kinds, documents }
var lgEditing = null;     // kind being edited, or null
var lgBusy = false;
var auState = 'off';      // 'off' | 'loading' | 'ready' | 'error'
var auEntries = [];
var auTotal = 0;
var auShown = 12;

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}
function authHeaders(json) {
  var token = getCortexOwnerToken();
  var h = json ? { 'Content-Type': 'application/json' } : {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}
function rerender() {
  var el = document.getElementById('detail-legal');
  if (el) el.innerHTML = legalSectionInner();
  var au = document.getElementById('detail-audit');
  if (au) au.innerHTML = auditSectionInner();
  renderChip();
}

/**
 * The one line a person sees without scrolling: a hot chip in the masthead when the app still
 * lacks pages it ought to have. Nothing is blocked (Jouni, 2026-08-29); it is meant to be noticed.
 */
function renderChip() {
  var chips = document.querySelector('#detail-view [data-dtl-chips]')
    || document.querySelector('#detail-view .poster-identity')
    || document.querySelector('#detail-view .dtl-chips');
  if (!chips) return;
  var old = document.getElementById('lg-chip');
  if (old) old.remove();
  chips.insertAdjacentHTML('beforeend', legalChipHtml());
}

/**
 * The chip as markup, so the detail view's own masthead render carries it too: the masthead is
 * rebuilt whenever an async load re-renders the whole detail, and a chip only appended after the
 * fact would be lost on the next rebuild.
 */
export function legalChipHtml() {
  if (lgState !== 'ready' || !lgData || !lgData.readiness) return '';
  var n = (lgData.readiness.missing || []).length;
  if (!n) return '';
  return action({ kind: 'text', onclick: 'window._launcher.legalScrollTo()', attrs: ' id="lg-chip"' },
    chip(escapeHtml(t('legal.chip').replace('{n}', String(n))), 'coral'));
}

export function legalScrollTo() {
  var sec = document.getElementById('detail-legal');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function appPath() {
  return '/v1/apps/' + encodeURIComponent(lgOwner) + '/' + encodeURIComponent(lgAppId);
}

/** Reset and load when a detail view opens. No-op for anything but the owner's own published app. */
export function legalOnOpen(owner, appId, isOwn) {
  lgBusy = false; lgData = null; lgEditing = null; auEntries = []; auTotal = 0; auShown = 12;
  if (!isOwn || !owner || !appId) { lgState = 'off'; auState = 'off'; lgOwner = ''; lgAppId = ''; return; }
  lgOwner = owner; lgAppId = appId; lgState = 'loading'; auState = 'loading';
  fetch(apiBase() + appPath() + '/legal', { headers: authHeaders(false) })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res || !res.ok) { lgState = 'error'; rerender(); return; }
      lgData = res.data; lgState = 'ready'; rerender();
    })
    .catch(function () { lgState = 'error'; rerender(); });
  loadAudit();
}

function loadAudit() {
  fetch(apiBase() + appPath() + '/audit', { headers: authHeaders(false) })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (!res || !res.ok) { auState = 'error'; rerender(); return; }
      auEntries = (res.data && res.data.entries) || [];
      auTotal = (res.data && res.data.total) || auEntries.length;
      auState = 'ready'; rerender();
    })
    .catch(function () { auState = 'error'; rerender(); });
}

export function legalEdit(kind) { if (lgBusy) return; lgEditing = kind; rerender(); }
export function legalCancel() { lgEditing = null; rerender(); }

export function legalSave(kind) {
  if (lgBusy || !lgData) return;
  var fmtEl = document.getElementById('lg-format');
  var contentEl = document.getElementById('lg-content');
  var format = fmtEl ? fmtEl.value : 'markdown';
  var content = contentEl ? contentEl.value : '';
  if (!content.trim()) { showNotice(t('legal.empty')); return; }
  var body = {}; body[kind] = { format: format, content: content };
  patch(body);
}

export function legalRemove(kind) {
  if (lgBusy || !lgData) return;
  if (!window.confirm(t('legal.removeConfirm'))) return;
  var body = {}; body[kind] = null;
  patch(body);
}

export function auditMore() { auShown += 25; rerender(); }

function patch(legal) {
  lgBusy = true; rerender();
  fetch(apiBase() + '/v1/apps/' + encodeURIComponent(lgAppId), {
    method: 'PATCH', headers: authHeaders(true), body: JSON.stringify({ legal: legal }),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      lgBusy = false;
      if (!res || !res.ok) {
        showNotice((res && res.error && res.error.message) || t('legal.saveFailed'));
        rerender();
        return;
      }
      showNotice((res.data && res.data.note) || t('legal.saved'));
      lgEditing = null;
      // Re-read: the answer carries the state, the editor needs the documents too.
      legalOnOpen(lgOwner, lgAppId, true);
    })
    .catch(function (err) {
      lgBusy = false;
      showNotice(String(err && err.message ? err.message : err));
      rerender();
    });
}

function fmtLabel(format) { return t('legal.format.' + format); }

function quiet(words) { return text({ kind: 'caption', tone: 'muted' }, escapeHtml(words)); }

/**
 * One page kind as the set's list row: its name (with a Recommended chip), why it matters as the
 * sentence under it, its state at the right, the doors, and the editor opening under the row.
 */
function kindRow(kind) {
  var info = (lgData.kinds && lgData.kinds[kind]) || { title: kind, why: '' };
  var st = lgData.legal && lgData.legal[kind];
  var link = null;
  for (var i = 0; i < (lgData.links || []).length; i++) if (lgData.links[i].kind === kind) link = lgData.links[i];
  var missing = (lgData.readiness && lgData.readiness.missing || []).indexOf(kind) >= 0;
  var recommended = (lgData.readiness && lgData.readiness.recommended || []).indexOf(kind) >= 0;
  var state;
  if (st) {
    state = text({ kind: 'mono' }, escapeHtml(fmtLabel(st.format)) + ' · ' + escapeHtml(fmtDate(st.updatedAt)))
      + (link ? ' ' + action({ kind: 'text', href: link.href, target: '_blank' }, escapeHtml(t('legal.open')) + ' →') : '');
  } else if (missing) {
    state = text({ kind: 'mono', tone: 'coral' }, escapeHtml(t('legal.missing')));
  } else {
    state = text({ kind: 'mono', tone: 'muted' }, escapeHtml(t('legal.none')));
  }
  var actions = lgEditing === kind ? '' :
    action({ kind: 'secondary', disabled: lgBusy, onclick: 'window._launcher.legalEdit(\'' + kind + '\')' }, escapeHtml(t(st ? 'legal.edit' : 'legal.write')))
    + (st ? action({ kind: 'secondary', tone: 'danger', disabled: lgBusy, onclick: 'window._launcher.legalRemove(\'' + kind + '\')' }, escapeHtml(t('legal.remove'))) : '');
  return listRow({
    name: escapeHtml(t('legal.kind.' + kind)) + (recommended ? ' ' + chip(escapeHtml(t('legal.recommended'))) : ''),
    detail: escapeHtml(info.why),
    detailKind: 'text',
    value: state,
    actions: actions,
    open: lgEditing === kind ? true : undefined,
    body: lgEditing === kind ? editorHtml(kind, st) : '',
  });
}

function editorHtml(kind, st) {
  var doc = (lgData.documents && lgData.documents[kind]) || null;
  var format = doc ? doc.format : 'markdown';
  var content = doc ? doc.content : '';
  return surface({ kind: 'record' }, stack({},
    field({
      id: 'lg-format', type: 'select', label: escapeHtml(t('legal.formatLabel')), value: format,
      options: ['markdown', 'html', 'url'].map(function (f) { return { value: f, label: escapeHtml(fmtLabel(f)) }; }),
      inputAttrs: ' onchange="window._launcher.legalFormatHint()"',
    })
    + text({ kind: 'caption', tone: 'muted', id: 'lg-format-hint' }, escapeHtml(t('legal.hint.' + format)))
    + field({
      id: 'lg-content', type: 'textarea', rows: 14, label: escapeHtml(t('legal.contentLabel')), value: content,
      placeholder: t('legal.placeholder.' + kind), inputAttrs: ' spellcheck="true"',
    })
    + stack({ direction: 'wrap', align: 'center' },
      action({ kind: 'primary', disabled: lgBusy, onclick: 'window._launcher.legalSave(\'' + kind + '\')' }, escapeHtml(t('legal.save')))
      + action({ kind: 'secondary', disabled: lgBusy, onclick: 'window._launcher.legalCancel()' }, escapeHtml(t('legal.cancel'))))
    + (st ? '' : quiet(t('legal.aiHint')))));
}

export function legalFormatHint() {
  var fmtEl = document.getElementById('lg-format');
  var hint = document.getElementById('lg-format-hint');
  if (fmtEl && hint) hint.textContent = t('legal.hint.' + fmtEl.value);
}

/** The Legal pages section; detail.js holds its slot (#detail-legal) and this fills it. */
export function legalSectionInner() {
  if (lgState === 'off') return '';
  var wrap = function (description, body) {
    return section({ title: escapeHtml(t('legal.title')), description: description, body: body });
  };
  if (lgState === 'loading') return wrap('', quiet(t('legal.loading')));
  if (lgState === 'error' || !lgData) return wrap('', quiet(t('legal.loadFailed')));
  var r = lgData.readiness || { missing: [], recommended: [], reason: '' };
  var html = surface({ kind: 'aside' }, text({ kind: 'body' }, escapeHtml(r.reason) + ' '
    + escapeHtml(r.missing.length
      ? t('legal.readinessMissing').replace('{n}', String(r.missing.length))
      : t('legal.readinessOk'))));
  var rows = '';
  for (var i = 0; i < KINDS.length; i++) rows += kindRow(KINDS[i]);
  return wrap(escapeHtml(t('legal.intro')), stack({}, html + '<div>' + rows + '</div>'));
}

function actionLabel(e) {
  var key = 'audit.action.' + e.action;
  var s = t(key);
  if (s === key) s = e.action;
  var d = e.detail || {};
  var extra = [];
  if (d.kind) extra.push(t('legal.kind.' + d.kind));
  if (d.format) extra.push(fmtLabel(d.format));
  if (typeof d.size === 'number') extra.push(Math.max(1, Math.round(d.size / 1000)) + ' kB');
  if (d.sha256) extra.push('#' + String(d.sha256).slice(0, 8));
  if (typeof d.on === 'boolean') extra.push(t(d.on ? 'marks.yes' : 'marks.no'));
  if (d.name) extra.push(String(d.name));
  if (d.state) extra.push(String(d.state));
  if (d.flags) extra.push(String(d.flags));
  return s + (extra.length ? ' · ' + extra.join(' · ') : '');
}

/** The Audit log section; detail.js holds its slot (#detail-audit) and this fills it. */
export function auditSectionInner() {
  if (auState === 'off') return '';
  var wrap = function (description, body) {
    return section({ title: escapeHtml(t('audit.title')), description: description, body: body });
  };
  if (auState === 'loading') return wrap('', quiet(t('audit.loading')));
  if (auState === 'error') return wrap('', quiet(t('audit.loadFailed')));
  var intro = escapeHtml(t('audit.intro'));
  if (!auEntries.length) return wrap(intro, quiet(t('audit.empty')));
  var rows = '';
  var shown = auEntries.slice().reverse().slice(0, auShown);
  for (var i = 0; i < shown.length; i++) {
    var e = shown[i];
    rows += listRow({ density: 'compact', time: escapeHtml(fmtDate(e.at)), name: escapeHtml(actionLabel(e)), detail: escapeHtml(e.by) });
  }
  var more = auEntries.length > auShown
    ? stack({ direction: 'horizontal', align: 'start' },
      action({ kind: 'secondary', onclick: 'window._launcher.auditMore()' }, escapeHtml(t('audit.more').replace('{n}', String(auEntries.length - auShown)))))
    : '';
  return wrap(intro, stack({}, '<div>' + rows + '</div>' + more));
}
