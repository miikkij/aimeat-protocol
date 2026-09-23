/**
 * @file marks.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Marks and authorship" section of an own published app's detail view: the two
 *   switches on the chrome the node adds when it serves the app (the "publish your own app" badge
 *   and the browser install offer), the declaration of the natural person who reviewed the app
 *   and answers for it, what this node sees about the app's own AI use, and the log of every
 *   declaration and withdrawal.
 *
 *   Reads its state from the same listing the SEO section reads (`/v1/apps`, where the owner's
 *   row carries the manifest with `marks`, `authorship` and `authorshipLog`, and `ai_posture`),
 *   and writes through PATCH /v1/apps/{filename} with `marks` or `author`. The server decides
 *   everything: the route refuses the declaration from anything but the account holder in
 *   person, and the note it returns is what the person is told.
 * @usage import { marksOnOpen, marksSectionInner, marksToggle, marksDeclare, marksWithdraw } from './marks.js';
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { escapeHtml } from './util.js';
import { dtlBtn, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';
import { fmtDate } from './rows.js';

var LAW_URL = 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj#art_50';

var mkOwner = '';
var mkAppId = '';
var mkState = 'off';   // 'off' | 'loading' | 'ready' | 'error'
var mkData = null;     // { marks, authorship, log, posture, agents, cortex }
var mkBusy = false;

function apiBase() {
  var cfg = loadConfig();
  return (cfg.aimeatUrl || '').replace(/\/+$/, '');
}

function rerender() {
  var el = document.getElementById('detail-marks');
  if (el) el.innerHTML = marksSectionInner();
}

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
}

/** Reset and load when a detail view opens. No-op for anything but the owner's own published app. */
export function marksOnOpen(owner, appId, isOwn) {
  mkBusy = false; mkData = null;
  if (!isOwn || !owner || !appId) { mkState = 'off'; mkOwner = ''; mkAppId = ''; return; }
  mkOwner = owner; mkAppId = appId; mkState = 'loading';
  var token = getCortexOwnerToken();
  fetch(apiBase() + '/v1/apps?limit=200', { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      var apps = (res && res.ok && res.data && res.data.apps) || [];
      var mine = null;
      for (var i = 0; i < apps.length; i++) {
        if (apps[i].filename === mkAppId && apps[i].owner === mkOwner) { mine = apps[i]; break; }
      }
      if (!mine) { mkState = 'error'; rerender(); return; }
      var m = mine.manifest || {};
      mkData = {
        marks: { badge: !(m.marks && m.marks.badge === false), install: !(m.marks && m.marks.install === false) },
        authorship: m.authorship || null,
        log: m.authorshipLog || [],
        posture: mine.ai_posture || null,
        agents: (m.cortex && m.cortex.agents && m.cortex.agents.length) || 0,
        cortex: m.usesCortex || [],
      };
      mkState = 'ready';
      rerender();
    })
    .catch(function () { mkState = 'error'; rerender(); });
}

/** Flip one of the two switches. */
export function marksToggle(key) {
  if (mkBusy || !mkData) return;
  var next = {};
  next[key] = !mkData.marks[key];
  patch({ marks: next });
}

/** Declare the reviewer named in the field. */
export function marksDeclare() {
  if (mkBusy || !mkData) return;
  var el = document.getElementById('mk-author');
  var name = el ? el.value.trim() : '';
  if (!name) { showNotice(t('marks.authorEmpty')); return; }
  patch({ author: name });
}

/** Withdraw the declaration. */
export function marksWithdraw() {
  if (mkBusy || !mkData || !mkData.authorship) return;
  patch({ author: null });
}

function patch(body) {
  mkBusy = true; rerender();
  var token = getCortexOwnerToken();
  fetch(apiBase() + '/v1/apps/' + encodeURIComponent(mkAppId), {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {}),
    body: JSON.stringify(body),
  })
    .then(function (r) { return r.json(); })
    .then(function (res) {
      mkBusy = false;
      if (!res || !res.ok) {
        showNotice((res && res.error && res.error.message) || t('marks.saveFailed'));
        rerender();
        return;
      }
      var d = res.data || {};
      if (d.marks) mkData.marks = { badge: d.marks.badge !== false, install: d.marks.install !== false };
      if ('authorship' in d) mkData.authorship = d.authorship || null;
      if (d.authorshipLog) mkData.log = d.authorshipLog;
      showNotice(d.note || t('marks.saved'));
      rerender();
    })
    .catch(function (err) {
      mkBusy = false;
      showNotice(String(err && err.message ? err.message : err));
      rerender();
    });
}

function switchRow(key, on) {
  return '<div class="mk-row">'
    + '<div class="mk-row-name">' + escapeHtml(t('marks.' + key)) + '</div>'
    + '<div class="mk-row-meaning">' + escapeHtml(t(on ? 'marks.' + key + 'On' : 'marks.' + key + 'Off')) + '</div>'
    + '<div class="mk-row-action">'
    + dtlBtn(t(on ? 'marks.turnOff' : 'marks.turnOn'), 'window._launcher.marksToggle(\'' + key + '\')', { disabled: mkBusy })
    + '</div></div>';
}

function yesNo(v) { return t(v ? 'marks.yes' : 'marks.no'); }

function seesHtml(d) {
  var p = d.posture;
  var rows = [];
  var generates = (p && p.generates && p.generates.length) ? p.generates.join(', ') : t('marks.seesNothing');
  rows.push([t('marks.seesGenerates'), generates]);
  rows.push([t('marks.seesUsesAi'), yesNo(!!(p && p.usesAi))]);
  rows.push([t('marks.seesDiscloses'), yesNo(!!(p && (p.discloses || p.disclosureCallFound)))]);
  rows.push([t('marks.seesAgents'), String(d.agents)]);
  rows.push([t('marks.seesCortex'), d.cortex.length ? d.cortex.join(', ') : t('marks.no')]);
  var html = '<h4>' + escapeHtml(t('marks.seesTitle')) + '</h4><dl class="mk-sees">';
  for (var i = 0; i < rows.length; i++) {
    html += '<dt>' + escapeHtml(rows[i][0]) + '</dt><dd>' + escapeHtml(rows[i][1]) + '</dd>';
  }
  return html + '</dl>';
}

function logHtml(log) {
  var html = '<h4>' + escapeHtml(t('marks.logTitle')) + '</h4>';
  if (!log.length) return html + '<p class="dtl-ai-status">' + escapeHtml(t('marks.logEmpty')) + '</p>';
  html += '<ol class="mk-log">';
  for (var i = log.length - 1; i >= 0; i--) {
    var e = log[i];
    html += '<li><span class="mk-log-when">' + escapeHtml(fmtDate(e.at)) + '</span> '
      + '<span class="mk-log-action">' + escapeHtml(t(e.action === 'cleared' ? 'marks.logCleared' : 'marks.logDeclared')) + '</span> '
      + '<span class="mk-log-name">' + escapeHtml(e.name) + '</span> '
      + '<span class="mk-log-by">' + escapeHtml(fill(t('marks.by'), { by: e.by })) + '</span></li>';
  }
  return html + '</ol>';
}

export function marksSectionInner() {
  if (mkState === 'off') return '';
  var head = '<h3>' + escapeHtml(t('marks.title')) + '</h3>';
  if (mkState === 'loading') return head + '<p class="dtl-ai-status">' + escapeHtml(t('marks.loading')) + '</p>';
  if (mkState === 'error' || !mkData) return head + '<p class="dtl-ai-status">' + escapeHtml(t('marks.loadFailed')) + '</p>';

  var d = mkData;
  var html = head + '<p class="dtl-ai-status">' + escapeHtml(t('marks.intro')) + '</p>'
    + '<div class="mk-rows">' + switchRow('badge', d.marks.badge) + switchRow('install', d.marks.install) + '</div>';

  html += '<h4>' + escapeHtml(t('marks.authorTitle')) + '</h4>';
  if (d.authorship) {
    html += '<p class="mk-author-is">' + escapeHtml(fill(t('marks.authorIs'), { name: d.authorship.name, when: fmtDate(d.authorship.declaredAt) })) + '</p>'
      + '<div class="dtl-btn-row">' + dtlBtn(t('marks.withdraw'), 'window._launcher.marksWithdraw()', { disabled: mkBusy }) + '</div>';
  } else {
    html += '<p class="dtl-ai-status">' + escapeHtml(t('marks.authorNone')) + '</p>'
      + '<div class="mk-author-form">'
      + '<label class="mz-label" for="mk-author">' + escapeHtml(t('marks.authorLabel')) + '</label>'
      + '<input id="mk-author" type="text" class="modal-input" maxlength="120" placeholder="' + escapeHtml(t('marks.authorPh')) + '">'
      + '<div class="dtl-btn-row">' + dtlBtn(t('marks.declare'), 'window._launcher.marksDeclare()', { variant: 'primary', disabled: mkBusy }) + '</div>'
      + '</div>';
  }
  html += '<div class="mk-aside">' + escapeHtml(t('marks.audited')) + '</div>'
    + '<p class="mk-legal">' + escapeHtml(t('marks.legal')) + ' '
    + '<a class="mk-legal-link" href="' + LAW_URL + '" target="_blank" rel="noopener">' + escapeHtml(t('marks.legalLink')) + ' →</a></p>';

  html += seesHtml(d);
  html += logHtml(d.log);
  return html;
}
