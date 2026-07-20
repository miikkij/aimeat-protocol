/**
 * @file migrate.js
 * @description One-time migration off the retired browser-local catalog. The server-only cutover
 *   dropped IndexedDB persistence; a user may still have apps in the old `AppLauncherDB[_owner]`
 *   store from before. On first load after the change this reads those apps (read-only, never
 *   deletes the DB) and offers a one-time JSON download so nothing is silently lost, then sets a
 *   "done" flag so it never nags again.
 * @usage import { checkLegacyLocalApps } from './migrate.js'; checkLegacyLocalApps();
 * @version-history
 *   v1.0.0 — 2026-07-20 — Added with the server-only catalog cutover.
 */
import { showConfirm } from './ui.js';
import { t } from './i18n.js';

const DONE_KEY = 'appCatalogLocalMigrated';

// Discover every legacy DB name (the shared `AppLauncherDB` plus any per-account
// `AppLauncherDB_<owner>` from the old "Mine" mode) when the browser supports enumeration.
async function legacyDbNames() {
  var names = ['AppLauncherDB'];
  try {
    if (indexedDB.databases) {
      var list = await indexedDB.databases();
      list.forEach(function (d) {
        if (d && d.name && d.name.indexOf('AppLauncherDB') === 0 && names.indexOf(d.name) < 0) names.push(d.name);
      });
    }
  } catch (e) { /* enumeration unsupported — fall back to the shared DB only */ }
  return names;
}

function openExisting(name) {
  return new Promise(function (resolve) {
    var req;
    try { req = indexedDB.open(name); } catch (e) { resolve(null); return; }
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { resolve(null); };
    // A brand-new open would upgrade an empty DB; leave it storeless so readApps returns [].
    req.onupgradeneeded = function () { /* no stores */ };
  });
}

function readApps(db) {
  return new Promise(function (resolve) {
    if (!db || !db.objectStoreNames || !db.objectStoreNames.contains('apps')) { resolve([]); return; }
    try {
      var tx = db.transaction('apps', 'readonly');
      var r = tx.objectStore('apps').getAll();
      r.onsuccess = function () { resolve(r.result || []); };
      r.onerror = function () { resolve([]); };
    } catch (e) { resolve([]); }
  });
}

function downloadJson(apps) {
  var json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), apps: apps }, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'app-catalog-local-apps.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function checkLegacyLocalApps() {
  try { if (localStorage.getItem(DONE_KEY)) return; } catch (e) { return; }
  var apps = [];
  try {
    var names = await legacyDbNames();
    for (var i = 0; i < names.length; i++) {
      var db = await openExisting(names[i]);
      var found = await readApps(db);
      if (found && found.length) apps = apps.concat(found);
      try { if (db) db.close(); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* if anything goes wrong, do not block the catalog */ }

  if (!apps.length) { try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* private mode */ } return; }

  var msg = (t('migrate.found') || 'You have {n} local app(s) from the old catalog. Download them as a backup?')
    .replace('{n}', String(apps.length));
  var wants = await showConfirm(msg);
  if (wants) downloadJson(apps);
  try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* private mode */ }
}
