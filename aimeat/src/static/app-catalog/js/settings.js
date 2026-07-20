/**
 * @file settings.js
 * @description App-catalog settings + chrome that isn't a core feature block: the light/dark THEME
 *   (applyTheme/toggleTheme/getThemePref), the Settings modal (openSettings/saveSettings + config
 *   sync to/from the node), and the Help overlay. Uses the shared modules by import.
 * @usage import { initSettings, applyTheme, openSettings } from './settings.js'; initSettings({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 9).
 *   v2.0.0 — 2026-07-20 — Server-only cutover: drop the local-catalog JSON export/import, the
 *     duplicate-cleanup, and Clear-all (all local-store features); initSettings is now a no-op.
 */
import { showConfirm, closeConfirm, showNotice, dismissNotice } from './ui.js';
import { loadConfig, saveConfig } from './config.js';
import { t, getLang } from './i18n.js';

// Kept for call-site stability (main.js still calls initSettings): server-only settings no longer
// need any injected main-local fns, so this is now a no-op.
export function initSettings() {}

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
  document.getElementById('setting-aimeat-url').value = config.aimeatUrl || '';
  document.getElementById('settings-overlay').hidden = false;
}

function saveSettings() {
  var config = loadConfig();
  config.theme = document.getElementById('setting-theme').value;
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

// Export / Import of a LOCAL JSON catalog was removed with the server-only cutover — there is no
// browser-local catalog to back up. Server apps + extensions are exported via the ZIP backup
// (💾 menu → /v1/apps/backup) in server-io.js, which is unaffected.

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
  closeHelp
};
