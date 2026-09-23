/**
 * @file backup-io.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The .zip backup of the owner's server apps and extensions: export all, and the
 *   selective import (inspect first, choose what to restore and what to do with what exists, then
 *   restore), following the organism-export bundle model with explicit conflict modes and never a
 *   silent overwrite. Moved out of server-io.js by pure extraction (the file had grown past the
 *   line ceiling); server-io re-exports every name and hands in refreshAll.
 * @structure setBackupRefresh · backupApiBase · exportBackupZip · importBackupPick ·
 *   importBackupFile · renderBackupSelection · backupCollectSelections · backupUpdateSummary ·
 *   backupSelectAll · submitBackupRestore · renderBackupResult
 * @usage import { exportBackupZip, importBackupFile } from './server-io.js';
 * @version-history
 *   v1.0.0 — 2026-09-22 — Extracted from server-io.js unchanged (its v2.5.0 set-part markup included).
 */
import { escapeHtml } from './util.js';
import { showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';
import { openDlg } from './dialogs.js';
import { action, chip, field, stack, table, text } from './parts-html.js';

// Injected by server-io's initServerIo: re-read everything after a restore.
let refreshAll = function () {};
export function setBackupRefresh(fn) { refreshAll = fn; }

function backupApiBase() {
  var config = loadConfig();
  return (config.aimeatUrl || window.location.origin).replace(/\/+$/, '');
}

function exportBackupZip() {
  document.getElementById('backup-menu').hidden = true;
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('backup.loginRequired')); return; }
  var btn = document.getElementById('backup-btn');
  btn.disabled = true;
  fetch(backupApiBase() + '/v1/apps/backup', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var cd = r.headers.get('Content-Disposition') || '';
      var m = cd.match(/filename="([^"]+)"/);
      return r.blob().then(function (b) { return { blob: b, name: m ? m[1] : 'aimeat-apps-backup.zip' }; });
    })
    .then(function (o) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(o.blob);
      a.download = o.name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    })
    .catch(function (e) { showNotice('Export failed: ' + (e.message || e)); })
    .finally(function () { btn.disabled = false; });
}

var backupInspectData = null;   // inspect response (apps, extensions, backup_token)

function importBackupPick() {
  document.getElementById('backup-menu').hidden = true;
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('backup.loginRequired')); return; }
  document.getElementById('backup-file-input').click();
}

function importBackupFile(file) {
  var statusEl = document.getElementById('backup-status');
  var body = document.getElementById('backup-import-body');
  document.getElementById('backup-restore-btn').hidden = true;
  body.innerHTML = '';
  statusEl.dataset.tone = 'muted';
  statusEl.textContent = t('backup.inspecting');
  openDlg('backup-overlay');

  file.arrayBuffer()
    .then(function (buf) {
      return fetch(backupApiBase() + '/v1/apps/backup/inspect', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + getCortexOwnerToken(),
          'Content-Type': 'application/zip'
        },
        body: buf
      });
    })
    .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
    .then(function (o) {
      if (!o.json.ok) {
        var msg = (o.json.error && (o.json.error.message || o.json.error.code)) || ('HTTP ' + o.status);
        throw new Error(msg);
      }
      backupInspectData = o.json.data;
      statusEl.textContent = '';
      renderBackupSelection();
    })
    .catch(function (e) {
      statusEl.dataset.tone = 'danger';
      statusEl.textContent = e.message || String(e);
    });
}

function renderBackupSelection() {
  var d = backupInspectData;
  var body = document.getElementById('backup-import-body');
  if (!d || (d.apps.length === 0 && d.extensions.length === 0)) {
    body.innerHTML = text({ kind: 'body', tone: 'muted' }, t('backup.empty'));
    return;
  }

  var summaryHook = ' onchange="window._launcher.backupUpdateSummary()"';
  // One conflict choice per item that exists already: skip, append the versions, or copy.
  var conflictField = function (id, withAppend) {
    return field({ type: 'select', id: id, value: 'skip', options: [
      { value: 'skip', label: t('backup.conflictSkip') },
      withAppend ? { value: 'append', label: t('backup.conflictAppend') } : null,
      { value: 'copy', label: t('backup.conflictCopy') }
    ].filter(Boolean) });
  };
  var statusCell = function (exists, conflictId, withAppend) {
    return exists
      ? stack({ density: 'compact', align: 'start' }, chip(t('backup.statusExists'), 'coral') + conflictField(conflictId, withAppend))
      : chip(t('backup.statusNew'), 'success');
  };

  var html =
    text({ kind: 'mono', tone: 'muted' }, t('backup.from') + ': ' +
      escapeHtml((d.source.owner || '?') + '@' + (d.source.nodeId || '?')) +
      (d.exported_at ? ' · ' + new Date(d.exported_at).toLocaleString() : '')) +
    stack({ direction: 'wrap', align: 'between' },
      stack({ direction: 'horizontal', align: 'center', density: 'compact' },
        action({ kind: 'text', onclick: 'window._launcher.backupSelectAll(true)' }, t('backup.selectAll')) + ' / ' +
        action({ kind: 'text', onclick: 'window._launcher.backupSelectAll(false)' }, t('backup.selectNone'))) +
      text({ kind: 'caption', tone: 'muted', id: 'backup-summary' }, ''));

  var rows = [];
  for (var i = 0; i < d.apps.length; i++) {
    var app = d.apps[i];
    var versionList = '';
    for (var v = 0; v < app.versions.length; v++) {
      var ver = app.versions[v];
      versionList += field({
        type: 'checkbox', id: 'backup-app-' + i + '-v-' + ver.version, value: true,
        label: 'v' + ver.version + (ver.semver ? ' (' + escapeHtml(ver.semver) + ')' : '') +
          ' · ' + (ver.size < 1024 ? ver.size + ' B' : (ver.size / 1024).toFixed(1) + ' KB') +
          (ver.created_at ? ' · ' + new Date(ver.created_at).toLocaleDateString() : ''),
        inputAttrs: ' data-backup-ver data-app="' + i + '" data-v="' + ver.version + '"' + summaryHook
      });
    }
    var listId = 'backup-app-' + i + '-versions';
    rows.push([
      field({ type: 'checkbox', id: 'backup-app-' + i, value: true, inputAttrs: summaryHook }),
      escapeHtml(app.name || app.filename) + '<br/>' + text({ kind: 'mono', tone: 'muted' }, escapeHtml(app.filename)),
      app.versions.length + ' ' +
        action({ kind: 'text', expanded: false, controls: listId,
          onclick: 'var el=document.getElementById(\'' + listId + '\');el.hidden=!el.hidden;this.setAttribute(\'aria-expanded\',el.hidden?\'false\':\'true\')' },
          t('backup.colVersions').toLowerCase()) +
        '<div id="' + listId + '" hidden>' + stack({ density: 'compact' }, versionList) + '</div>',
      statusCell(app.exists, 'backup-app-' + i + '-conflict', true)
    ]);
  }
  html += table({ headers: ['', t('backup.colApp'), t('backup.colVersions'), t('backup.colStatus')], rows: rows, collapse: 600, density: 'compact' });

  if (d.extensions.length > 0) {
    var extRows = [];
    for (var e = 0; e < d.extensions.length; e++) {
      var ext = d.extensions[e];
      extRows.push([
        field({ type: 'checkbox', id: 'backup-ext-' + e, value: true, inputAttrs: summaryHook }),
        { html: escapeHtml(ext.name), mono: true },
        statusCell(ext.exists, 'backup-ext-' + e + '-conflict', false)
      ]);
    }
    html += text({ kind: 'heading', size: 'small' }, t('backup.extensions')) + table({ rows: extRows, density: 'compact' });
  }

  body.innerHTML = stack({ density: 'normal' }, html);
  document.getElementById('backup-restore-btn').hidden = false;
  backupUpdateSummary();
}

// Reads the current selection straight from the DOM — no parallel state to drift.
function backupCollectSelections() {
  var d = backupInspectData;
  var selections = [];
  var extensions = [];
  if (!d) return { selections: selections, extensions: extensions, versionTotal: 0 };
  var versionTotal = 0;
  for (var i = 0; i < d.apps.length; i++) {
    var cb = document.getElementById('backup-app-' + i);
    if (!cb || !cb.checked) continue;
    var app = d.apps[i];
    var checkedVers = [];
    var verBoxes = document.querySelectorAll('[data-backup-ver][data-app="' + i + '"]');
    verBoxes.forEach(function (b) { if (b.checked) checkedVers.push(parseInt(b.getAttribute('data-v'), 10)); });
    if (checkedVers.length === 0) continue;
    var sel = { filename: app.filename };
    if (checkedVers.length !== app.versions.length) sel.versions = checkedVers;
    if (app.exists) {
      var conflictEl = document.getElementById('backup-app-' + i + '-conflict');
      sel.conflict = conflictEl ? conflictEl.value : 'skip';
    }
    versionTotal += checkedVers.length;
    selections.push(sel);
  }
  for (var e = 0; e < d.extensions.length; e++) {
    var ecb = document.getElementById('backup-ext-' + e);
    if (!ecb || !ecb.checked) continue;
    var ext = { name: d.extensions[e].name };
    if (d.extensions[e].exists) {
      var ecEl = document.getElementById('backup-ext-' + e + '-conflict');
      ext.conflict = ecEl ? ecEl.value : 'skip';
    }
    extensions.push(ext);
  }
  return { selections: selections, extensions: extensions, versionTotal: versionTotal };
}

function backupUpdateSummary() {
  var sel = backupCollectSelections();
  var el = document.getElementById('backup-summary');
  if (!el) return;
  el.textContent = t('backup.restoring') + ': ' + sel.selections.length + ' ' + t('backup.sumApps') +
    ', ' + sel.versionTotal + ' ' + t('backup.sumVersions') +
    (sel.extensions.length ? ', ' + sel.extensions.length + ' ' + t('backup.sumExts') : '');
}

function backupSelectAll(checked) {
  var d = backupInspectData;
  if (!d) return;
  for (var i = 0; i < d.apps.length; i++) {
    var cb = document.getElementById('backup-app-' + i);
    if (cb) cb.checked = checked;
    document.querySelectorAll('[data-backup-ver][data-app="' + i + '"]').forEach(function (b) { b.checked = checked; });
  }
  for (var e = 0; e < d.extensions.length; e++) {
    var ecb = document.getElementById('backup-ext-' + e);
    if (ecb) ecb.checked = checked;
  }
  backupUpdateSummary();
}

function submitBackupRestore() {
  var sel = backupCollectSelections();
  var statusEl = document.getElementById('backup-status');
  if (sel.selections.length === 0 && sel.extensions.length === 0) {
    statusEl.dataset.tone = 'danger';
    statusEl.textContent = t('backup.nothingSelected');
    return;
  }
  statusEl.dataset.tone = 'muted';
  statusEl.textContent = t('backup.restoring') + '...';
  var btn = document.getElementById('backup-restore-btn');
  btn.disabled = true;
  fetch(backupApiBase() + '/v1/apps/backup/restore', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + getCortexOwnerToken(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      backup_token: backupInspectData.backup_token,
      selections: sel.selections,
      extensions: sel.extensions
    })
  })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (!json.ok) {
        var msg = (json.error && (json.error.message || json.error.code)) || 'Restore failed';
        throw new Error(msg);
      }
      statusEl.textContent = '';
      renderBackupResult(json.data);
      refreshAll();
    })
    .catch(function (e) {
      statusEl.dataset.tone = 'danger';
      statusEl.textContent = e.message || String(e);
    })
    .finally(function () { btn.disabled = false; });
}

function renderBackupResult(s) {
  var body = document.getElementById('backup-import-body');
  document.getElementById('backup-restore-btn').hidden = true;
  // One group per outcome: its label with the count, then one mono line per item.
  var section = function (label, items, tone) {
    if (!items || items.length === 0) return '';
    var rendered = items.map(function (x) {
      if (typeof x === 'string') return escapeHtml(x);
      if (x && x.from && x.to) return escapeHtml(x.from) + ' → ' + escapeHtml(x.to);
      if (x && x.item) return escapeHtml(x.item) + ': ' + escapeHtml(x.message || '');
      return escapeHtml(JSON.stringify(x));
    });
    return stack({ density: 'compact' },
      text({ kind: 'label' }, label + ' (' + items.length + ')') +
      rendered.map(function (r) { return text({ kind: 'mono', tone: tone }, r); }).join(''));
  };
  body.innerHTML = stack({ density: 'normal' },
    text({ kind: 'heading', size: 'small' }, '✓ ' + t('backup.resultTitle')) +
    text({ kind: 'body' }, t('backup.resVersions') + ': ' + s.versions_restored) +
    section(t('backup.resCreated'), s.apps_created.concat(s.extensions_created)) +
    section(t('backup.resAppended'), s.apps_appended) +
    section(t('backup.resCopied'), s.apps_copied.concat(s.extensions_copied)) +
    section(t('backup.resSkipped'), s.apps_skipped.concat(s.extensions_skipped)) +
    section(t('backup.resErrors'), s.errors, 'danger'));
}

export {
  exportBackupZip,
  importBackupPick,
  importBackupFile,
  backupUpdateSummary,
  backupSelectAll,
  submitBackupRestore
};
