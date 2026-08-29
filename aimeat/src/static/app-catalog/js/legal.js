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
 * @usage import { legalOnOpen, legalSectionInner, auditSectionInner, legalEdit, legalCancel, legalSave, legalRemove, auditMore } from './legal.js';
 * @version-history
 *   v1.1.0 — 2026-08-29 — A hot chip on the masthead names how many pages are still to write and
 *     scrolls to the section. Nothing is blocked; it is meant to be noticed.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { escapeHtml } from './util.js';
import { dtlBtn, showNotice } from './ui.js';
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
  var chips = document.querySelector('#detail-view .dtl-chips');
  if (!chips) return;
  var old = document.getElementById('lg-chip');
  if (old) old.remove();
  if (lgState !== 'ready' || !lgData || !lgData.readiness) return;
  var n = (lgData.readiness.missing || []).length;
  if (!n) return;
  var chip = document.createElement('button');
  chip.type = 'button';
  chip.id = 'lg-chip';
  chip.className = 'dtl-chip dtl-chip--hot lg-chip';
  chip.textContent = '■ ' + t('legal.chip').replace('{n}', String(n));
  chip.onclick = function () {
    var sec = document.getElementById('detail-legal');
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  chips.appendChild(chip);
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

function kindRow(kind) {
  var info = (lgData.kinds && lgData.kinds[kind]) || { title: kind, why: '' };
  var st = lgData.legal && lgData.legal[kind];
  var link = null;
  for (var i = 0; i < (lgData.links || []).length; i++) if (lgData.links[i].kind === kind) link = lgData.links[i];
  var missing = (lgData.readiness && lgData.readiness.missing || []).indexOf(kind) >= 0;
  var recommended = (lgData.readiness && lgData.readiness.recommended || []).indexOf(kind) >= 0;
  var state;
  if (st) {
    state = '<span class="lg-state lg-state-on">' + escapeHtml(fmtLabel(st.format)) + ' · ' + escapeHtml(fmtDate(st.updatedAt)) + '</span>'
      + (link ? ' <a class="lg-open" href="' + escapeHtml(link.href) + '" target="_blank" rel="noopener">' + escapeHtml(t('legal.open')) + ' →</a>' : '');
  } else if (missing) {
    state = '<span class="lg-state lg-state-missing">' + escapeHtml(t('legal.missing')) + '</span>';
  } else {
    state = '<span class="lg-state">' + escapeHtml(t('legal.none')) + '</span>';
  }
  var actions = lgEditing === kind ? '' :
    dtlBtn(t(st ? 'legal.edit' : 'legal.write'), 'window._launcher.legalEdit(\'' + kind + '\')', { disabled: lgBusy })
    + (st ? ' ' + dtlBtn(t('legal.remove'), 'window._launcher.legalRemove(\'' + kind + '\')', { disabled: lgBusy }) : '');
  var html = '<div class="lg-row' + (recommended ? ' is-recommended' : '') + '">'
    + '<div class="lg-row-head"><div class="lg-row-name">' + escapeHtml(t('legal.kind.' + kind)) + '</div>' + state + '</div>'
    + '<div class="lg-row-why">' + escapeHtml(info.why) + '</div>'
    + '<div class="lg-row-actions">' + actions + '</div>';
  if (lgEditing === kind) html += editorHtml(kind, st);
  return html + '</div>';
}

function editorHtml(kind, st) {
  var doc = (lgData.documents && lgData.documents[kind]) || null;
  var format = doc ? doc.format : 'markdown';
  var content = doc ? doc.content : '';
  var opts = ['markdown', 'html', 'url'].map(function (f) {
    return '<option value="' + f + '"' + (f === format ? ' selected' : '') + '>' + escapeHtml(fmtLabel(f)) + '</option>';
  }).join('');
  return '<div class="lg-editor">'
    + '<label class="mz-label" for="lg-format">' + escapeHtml(t('legal.formatLabel')) + '</label>'
    + '<select id="lg-format" class="modal-input" onchange="window._launcher.legalFormatHint()">' + opts + '</select>'
    + '<p class="dtl-ai-status" id="lg-format-hint">' + escapeHtml(t('legal.hint.' + format)) + '</p>'
    + '<label class="mz-label" for="lg-content">' + escapeHtml(t('legal.contentLabel')) + '</label>'
    + '<textarea id="lg-content" class="modal-input lg-textarea" rows="14" spellcheck="true" placeholder="' + escapeHtml(t('legal.placeholder.' + kind)) + '">' + escapeHtml(content) + '</textarea>'
    + '<div class="dtl-btn-row">'
    + dtlBtn(t('legal.save'), 'window._launcher.legalSave(\'' + kind + '\')', { variant: 'primary', disabled: lgBusy })
    + dtlBtn(t('legal.cancel'), 'window._launcher.legalCancel()', { disabled: lgBusy })
    + '</div>'
    + (st ? '' : '<p class="dtl-ai-status">' + escapeHtml(t('legal.aiHint')) + '</p>')
    + '</div>';
}

export function legalFormatHint() {
  var fmtEl = document.getElementById('lg-format');
  var hint = document.getElementById('lg-format-hint');
  if (fmtEl && hint) hint.textContent = t('legal.hint.' + fmtEl.value);
}

export function legalSectionInner() {
  if (lgState === 'off') return '';
  var head = '<h3>' + escapeHtml(t('legal.title')) + '</h3>';
  if (lgState === 'loading') return head + '<p class="dtl-ai-status">' + escapeHtml(t('legal.loading')) + '</p>';
  if (lgState === 'error' || !lgData) return head + '<p class="dtl-ai-status">' + escapeHtml(t('legal.loadFailed')) + '</p>';
  var r = lgData.readiness || { missing: [], recommended: [], reason: '' };
  var html = head + '<p class="dtl-ai-status">' + escapeHtml(t('legal.intro')) + '</p>';
  html += '<div class="mk-aside">' + escapeHtml(r.reason) + ' '
    + escapeHtml(r.missing.length
      ? t('legal.readinessMissing').replace('{n}', String(r.missing.length))
      : t('legal.readinessOk'))
    + '</div>';
  html += '<div class="lg-rows">';
  for (var i = 0; i < KINDS.length; i++) html += kindRow(KINDS[i]);
  html += '</div>';
  return html;
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

export function auditSectionInner() {
  if (auState === 'off') return '';
  var head = '<h3>' + escapeHtml(t('audit.title')) + '</h3>';
  if (auState === 'loading') return head + '<p class="dtl-ai-status">' + escapeHtml(t('audit.loading')) + '</p>';
  if (auState === 'error') return head + '<p class="dtl-ai-status">' + escapeHtml(t('audit.loadFailed')) + '</p>';
  var html = head + '<p class="dtl-ai-status">' + escapeHtml(t('audit.intro')) + '</p>';
  if (!auEntries.length) return html + '<p class="dtl-ai-status">' + escapeHtml(t('audit.empty')) + '</p>';
  html += '<ol class="mk-log">';
  var shown = auEntries.slice().reverse().slice(0, auShown);
  for (var i = 0; i < shown.length; i++) {
    var e = shown[i];
    html += '<li><span class="mk-log-when">' + escapeHtml(fmtDate(e.at)) + '</span> '
      + '<span class="mk-log-name">' + escapeHtml(actionLabel(e)) + '</span> '
      + '<span class="mk-log-by">' + escapeHtml(e.by) + '</span></li>';
  }
  html += '</ol>';
  if (auEntries.length > auShown) {
    html += '<div class="dtl-btn-row">' + dtlBtn(t('audit.more').replace('{n}', String(auEntries.length - auShown)), 'window._launcher.auditMore()') + '</div>';
  }
  return html;
}
