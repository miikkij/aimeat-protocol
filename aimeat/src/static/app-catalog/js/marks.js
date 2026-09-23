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
 *   v1.1.0 — 2026-09-22 — Composed from the shared set (parts-html.js): this module draws the whole
 *     section; the two switches are list rows with a switch word, the reviewer field is the set's
 *     field, the record note the set's aside, what the node sees key-value rows, and the log a
 *     timeline of list rows.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { escapeHtml } from './util.js';
import { showNotice } from './ui.js';
import { section, listRow, action, keyValue, stack, surface, text, field } from './parts-html.js';
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

/** One of the two switches: the mark's name, what it means now, and the switch word. */
function switchRow(key, on) {
  return listRow({
    name: escapeHtml(t('marks.' + key)),
    detail: escapeHtml(t(on ? 'marks.' + key + 'On' : 'marks.' + key + 'Off')),
    detailKind: 'text',
    actions: action({ kind: 'secondary', semantics: 'switch', selected: on, disabled: mkBusy, onclick: 'window._launcher.marksToggle(\'' + key + '\')' },
      escapeHtml(t(on ? 'marks.turnOff' : 'marks.turnOn'))),
  });
}

function yesNo(v) { return t(v ? 'marks.yes' : 'marks.no'); }

function subHead(key) { return text({ kind: 'label' }, escapeHtml(t(key))); }
function quiet(key) { return text({ kind: 'caption', tone: 'muted' }, escapeHtml(t(key))); }

function seesHtml(d) {
  var p = d.posture;
  var rows = [];
  var generates = (p && p.generates && p.generates.length) ? p.generates.join(', ') : t('marks.seesNothing');
  rows.push([t('marks.seesGenerates'), generates]);
  rows.push([t('marks.seesUsesAi'), yesNo(!!(p && p.usesAi))]);
  rows.push([t('marks.seesDiscloses'), yesNo(!!(p && (p.discloses || p.disclosureCallFound)))]);
  rows.push([t('marks.seesAgents'), String(d.agents)]);
  rows.push([t('marks.seesCortex'), d.cortex.length ? d.cortex.join(', ') : t('marks.no')]);
  var html = '';
  for (var i = 0; i < rows.length; i++) html += keyValue(escapeHtml(rows[i][0]), escapeHtml(rows[i][1]));
  return stack({ density: 'compact' }, subHead('marks.seesTitle') + '<div>' + html + '</div>');
}

function logHtml(log) {
  if (!log.length) return stack({ density: 'compact' }, subHead('marks.logTitle') + quiet('marks.logEmpty'));
  var html = '';
  for (var i = log.length - 1; i >= 0; i--) {
    var e = log[i];
    html += listRow({
      density: 'compact',
      time: escapeHtml(fmtDate(e.at)),
      name: escapeHtml(t(e.action === 'cleared' ? 'marks.logCleared' : 'marks.logDeclared')) + ' ' + escapeHtml(e.name),
      detail: escapeHtml(fill(t('marks.by'), { by: e.by })),
    });
  }
  return stack({ density: 'compact' }, subHead('marks.logTitle') + '<div>' + html + '</div>');
}

/** The whole section; detail.js holds its slot (#detail-marks) and this fills it. */
export function marksSectionInner() {
  if (mkState === 'off') return '';
  var wrap = function (description, body) {
    return section({ title: escapeHtml(t('marks.title')), description: description, body: stack({ density: 'roomy' }, body) });
  };
  if (mkState === 'loading') return wrap('', quiet('marks.loading'));
  if (mkState === 'error' || !mkData) return wrap('', quiet('marks.loadFailed'));

  var d = mkData;
  var html = '<div>' + switchRow('badge', d.marks.badge) + switchRow('install', d.marks.install) + '</div>';

  var author;
  if (d.authorship) {
    author = text({ kind: 'body' }, escapeHtml(fill(t('marks.authorIs'), { name: d.authorship.name, when: fmtDate(d.authorship.declaredAt) })))
      + stack({ direction: 'horizontal', align: 'start' },
        action({ kind: 'secondary', disabled: mkBusy, onclick: 'window._launcher.marksWithdraw()' }, escapeHtml(t('marks.withdraw'))));
  } else {
    author = quiet('marks.authorNone')
      + field({ id: 'mk-author', label: escapeHtml(t('marks.authorLabel')), maxLength: 120, placeholder: t('marks.authorPh') })
      + stack({ direction: 'horizontal', align: 'start' },
        action({ kind: 'primary', disabled: mkBusy, onclick: 'window._launcher.marksDeclare()' }, escapeHtml(t('marks.declare'))));
  }
  html += stack({}, subHead('marks.authorTitle') + author
    + surface({ kind: 'aside' }, text({ kind: 'body' }, escapeHtml(t('marks.audited'))))
    + text({ kind: 'caption', tone: 'muted' }, escapeHtml(t('marks.legal')) + ' '
      + action({ kind: 'secondary', href: LAW_URL, target: '_blank' }, escapeHtml(t('marks.legalLink')) + ' →')));

  html += seesHtml(d);
  html += logHtml(d.log);
  return wrap(escapeHtml(t('marks.intro')), html);
}
