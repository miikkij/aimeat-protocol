/**
 * @file settings.js
 * @description App-catalog settings + chrome that isn't a core feature block: the light/dark THEME
 *   (applyTheme/toggleTheme/getThemePref), the Settings modal (openSettings/saveSettings + config
 *   sync to/from the node), the Help overlay, the JSON export/import of the local catalog, the
 *   duplicate-cleanup, and Clear-all. Uses the shared modules by import; the few main-local fns it
 *   calls are injected via initSettings(deps). Carved from main.js.
 * @usage import { initSettings, applyTheme, openSettings, exportBackup } from './settings.js'; initSettings({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 9).
 */
import { escapeHtml, sourceLabel } from './util.js';
import { getAllApps, saveApp, deleteApp, openDB } from './db.js';
import { showConfirm, closeConfirm, showNotice, dismissNotice } from './ui.js';
import { loadConfig, saveConfig } from './config.js';
import { t, getLang } from './i18n.js';

// Injected once at bootstrap by main.js (main-local fns; no shared state).
let generateId, renderApps, loadPublishedApps;
export function initSettings(deps) {
  ({ generateId, renderApps, loadPublishedApps } = deps);
}

// ── Theme ────────────────────────────────────────

function applyTheme(theme) {
  // Light is the default (:root). Dark applies the [data-theme="dark"] overrides.
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#14141C' : '#FAFAF8');
  updateThemeToggle();
}

function updateThemeToggle() {
  // Show the icon for the mode you'd switch TO: moon while light, sun while dark.
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  var btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = dark ? '☀️' : '🌙';
}

// Quick light/dark switch from the header. Flips from the LIVE data-theme so it agrees with the
// login pill's ☾ (which may have changed the theme without touching the catalog's own config).
function toggleTheme() {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  setTheme(dark ? 'light' : 'dark');
}

// Single source of truth for the theme: the shared AIMEAT key `aimeat-theme` (what the login
// pill's ☾ and every generated app read) — kept in sync with the catalog's own config so the two
// toggles never disagree (the old split wrote config.theme here but aimeat-theme in the pill,
// leaving data-theme=dark and aimeat-theme=light at the same time).
function setTheme(theme) {
  try { localStorage.setItem('aimeat-theme', theme); } catch (e) {}
  var config = loadConfig();
  config.theme = theme;
  saveConfig(config);
  applyTheme(theme);
  var sel = document.getElementById('setting-theme');
  if (sel) sel.value = theme;
}

function getThemePref() {
  try { var t = localStorage.getItem('aimeat-theme'); if (t === 'dark' || t === 'light') return t; } catch (e) {}
  var c = loadConfig().theme;
  if (c === 'dark' || c === 'light') return c;
  try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) {}
  return 'light';
}

// ── Settings ────────────────────────────────────

function openSettings() {
  var config = loadConfig();
  document.getElementById('setting-theme').value = config.theme || 'light';
  document.getElementById('setting-language').value = getLang();
  document.getElementById('setting-open-mode').value = config.defaultOpenMode || 'tab';
  document.getElementById('setting-aimeat-url').value = config.aimeatUrl || '';
  document.getElementById('settings-overlay').hidden = false;
}

function saveSettings() {
  var config = loadConfig();
  config.theme = document.getElementById('setting-theme').value;
  config.defaultOpenMode = document.getElementById('setting-open-mode').value;
  config.aimeatUrl = document.getElementById('setting-aimeat-url').value.trim();
  saveConfig(config);
  try { localStorage.setItem('aimeat-theme', config.theme); } catch (e) {}
  applyTheme(config.theme);
  document.getElementById('settings-overlay').hidden = true;
  // Sync config to server (best-effort)
  syncConfigToServer(config);
}

function syncConfigToServer(config) {
  var url = config.aimeatUrl;
  if (!url) return;
  url = url.replace(/\/+$/, '');
  // Only sync safe fields, not the URL itself
  var syncPayload = {
    theme: config.theme,
    defaultOpenMode: config.defaultOpenMode,
    language: config.language || 'en'
  };
  fetch(url + '/v1/auth/anonymous', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (auth) {
      var token = auth.data && auth.data.token;
      if (!token) return;
      return fetch(url + '/v1/memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          key: 'app-launcher/config',
          value: syncPayload,
          visibility: 'private'
        })
      });
    })
    .catch(function () { /* best-effort */ });
}

function loadConfigFromServer() {
  var config = loadConfig();
  var url = config.aimeatUrl;
  if (!url) return;
  url = url.replace(/\/+$/, '');
  fetch(url + '/v1/auth/anonymous', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (auth) {
      var token = auth.data && auth.data.token;
      if (!token) return;
      var gaii = auth.data.gaii || auth.data.sub || '';
      if (!gaii) return;
      return fetch(url + '/v1/memory/app-launcher%2Fconfig', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      });
    })
    .then(function (json) {
      if (!json || !json.data || !json.data.value) return;
      var remote = json.data.value;
      var local = loadConfig();
      var changed = false;
      // Merge remote into local (remote wins for preferences, but don't overwrite aimeatUrl)
      if (remote.theme && remote.theme !== local.theme) {
        local.theme = remote.theme;
        changed = true;
      }
      if (remote.defaultOpenMode && remote.defaultOpenMode !== local.defaultOpenMode) {
        local.defaultOpenMode = remote.defaultOpenMode;
        changed = true;
      }
      if (remote.language && remote.language !== local.language) {
        local.language = remote.language;
        changed = true;
      }
      if (changed) {
        saveConfig(local);
        applyTheme(local.theme);
      }
    })
    .catch(function () { /* best-effort */ });
}

function closeSettings() {
  document.getElementById('settings-overlay').hidden = true;
}

function openHelp() { document.getElementById('help-overlay').hidden = false; }
function closeHelp() { document.getElementById('help-overlay').hidden = true; }

// Confirm dialog + toast notices → ui.js (showConfirm/closeConfirm/showNotice/dismissNotice),
// imported at the top. The OK/Cancel buttons are wired to closeConfirm() in bootstrap below.

// ── Export / Import ─────────────────────────────

function exportBackup() {
  getAllApps().then(function (apps) {
    var config = loadConfig();
    var backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: config,
      apps: apps
    };
    var json = JSON.stringify(backup, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'app-catalog-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// Identity key for duplicate detection: a published app is the same app
// regardless of its local id; unpublished ones match by name + content size.
function localAppKey(a) {
  if (a.publishedFilename) return 'pf:' + a.publishedFilename;
  return 'nm:' + (a.name || '') + '|' + (a.blob ? a.blob.length : (a.url || ''));
}

// Parsed JSON backup awaiting user selection: { backup, rows: [{app, isDup}] }
var jsonImportState = null;

function handleImportBackup(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var backup;
    try {
      backup = JSON.parse(reader.result);
    } catch (e) {
      showNotice('Failed to parse backup file: ' + (e.message || e));
      return;
    }
    if (!backup.apps || !Array.isArray(backup.apps)) {
      showNotice('Invalid backup file: missing apps array');
      return;
    }
    // Inspect-before-write: compare against the current catalog and let the
    // user choose. Duplicates default to unchecked — nothing is imported
    // (and no setting is changed) without an explicit selection.
    getAllApps().then(function (existing) {
      var existingKeys = {};
      existing.forEach(function (a) { existingKeys[localAppKey(a)] = true; });
      jsonImportState = {
        backup: backup,
        rows: backup.apps.map(function (a) {
          return { app: a, isDup: !!existingKeys[localAppKey(a)] };
        }),
      };
      renderJsonImportModal();
    });
  };
  reader.readAsText(file);
}

function renderJsonImportModal() {
  var rows = jsonImportState.rows;
  var body = document.getElementById('json-import-body');
  var html = '<p style="font-size:.8rem;color:var(--text-muted);margin:4px 0 8px">' + t('jsonImport.desc') + '</p>' +
    '<div class="backup-toolbar-row"><div>' +
      '<button class="backup-link-btn" onclick="window._launcher.jsonImportSelectAll(true)">' + t('backup.selectAll') + '</button> / ' +
      '<button class="backup-link-btn" onclick="window._launcher.jsonImportSelectAll(false)">' + t('backup.selectNone') + '</button>' +
    '</div></div>' +
    '<table class="backup-table"><tbody>';
  for (var i = 0; i < rows.length; i++) {
    var a = rows[i].app;
    html +=
      '<tr>' +
        '<td><input type="checkbox" class="json-import-cb" data-i="' + i + '"' + (rows[i].isDup ? '' : ' checked') + '/></td>' +
        '<td>' + escapeHtml(a.name || a.publishedFilename || 'Untitled') +
          (a.publishedFilename ? '<div class="mono-cell">' + escapeHtml(a.publishedFilename) + '</div>' : '') + '</td>' +
        '<td>' + sourceLabel(a.source) + '</td>' +
        '<td>' + (rows[i].isDup
          ? '<span class="backup-status-badge backup-status-exists">' + t('jsonImport.statusDup') + '</span>'
          : '<span class="backup-status-badge backup-status-new">' + t('backup.statusNew') + '</span>') + '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';
  if (jsonImportState.backup.config && typeof jsonImportState.backup.config === 'object') {
    html += '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.85rem">' +
      '<input type="checkbox" id="json-import-config"/> ' + t('jsonImport.config') + '</label>';
  }
  body.innerHTML = html;
  document.getElementById('json-import-status').textContent = '';
  document.getElementById('json-import-btn').style.display = '';
  document.getElementById('json-import-overlay').hidden = false;
}

function jsonImportSelectAll(checked) {
  document.querySelectorAll('.json-import-cb').forEach(function (b) { b.checked = checked; });
}

function submitJsonImport() {
  var statusEl = document.getElementById('json-import-status');
  var selected = [];
  document.querySelectorAll('.json-import-cb').forEach(function (b) {
    if (b.checked) selected.push(jsonImportState.rows[parseInt(b.getAttribute('data-i'), 10)].app);
  });
  var configCb = document.getElementById('json-import-config');
  var importConfig = !!(configCb && configCb.checked);
  if (selected.length === 0 && !importConfig) {
    statusEl.style.color = '#ef4444';
    statusEl.textContent = t('backup.nothingSelected');
    return;
  }
  if (importConfig) {
    var merged = Object.assign({}, loadConfig(), jsonImportState.backup.config);
    saveConfig(merged);
    applyTheme(merged.theme);
  }
  Promise.all(selected.map(function (a) {
    var app = Object.assign({}, a);
    app.id = generateId(); // new id — the source backup may collide with existing ids
    return saveApp(app);
  })).then(function () {
    statusEl.style.color = '#34d399';
    statusEl.textContent = '✔ ' + t('jsonImport.done') + ': ' + selected.length;
    document.getElementById('json-import-btn').style.display = 'none';
    renderApps();
    loadPublishedApps();
  });
}

// ── Remove duplicate apps (cleanup after legacy blind imports) ──

function removeDuplicateApps() {
  getAllApps().then(async function (apps) {
    var groups = {};
    apps.forEach(function (a) {
      var k = localAppKey(a);
      (groups[k] = groups[k] || []).push(a);
    });
    var toDelete = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length < 2) return;
      // Keep the best copy: favorites first, then the earliest added
      g.sort(function (x, y) {
        if (!!y.favorite !== !!x.favorite) return (y.favorite ? 1 : 0) - (x.favorite ? 1 : 0);
        return (x.addedAt || '') < (y.addedAt || '') ? -1 : 1;
      });
      toDelete = toDelete.concat(g.slice(1));
    });
    if (toDelete.length === 0) { showNotice(t('dedup.none')); return; }
    if (!(await showConfirm(t('dedup.confirm') + ' ' + toDelete.length))) return;
    Promise.all(toDelete.map(function (a) { return deleteApp(a.id); })).then(function () {
      renderApps();
      loadPublishedApps();
      showNotice(t('dedup.done') + ': ' + toDelete.length);
    });
  });
}

// ── Clear All Data ──────────────────────────────

async function clearAllData() {
  if (!(await showConfirm(t('confirm.clearAll1')))) return;
  if (!(await showConfirm(t('confirm.clearAll2')))) return;

  openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }).then(function () {
    localStorage.removeItem('appLauncherConfig');
    applyTheme('dark');
    renderApps();
    document.getElementById('settings-overlay').hidden = true;
    showNotice('All data cleared');
  });
}

export {
  applyTheme,
  updateThemeToggle,
  toggleTheme,
  getThemePref,
  openSettings,
  saveSettings,
  syncConfigToServer,
  loadConfigFromServer,
  closeSettings,
  openHelp,
  closeHelp,
  exportBackup,
  handleImportBackup,
  jsonImportSelectAll,
  submitJsonImport,
  removeDuplicateApps,
  clearAllData
};
