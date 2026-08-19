/**
 * @file server-io.js
 * @description Everything that talks to the NODE about apps: publish (incl. the create-flow
 *   publish-then-unlist), the two-view (Library/Community) + operator subdomain mappings, H-2
 *   app-grant consents, and the .zip backup export/restore. Owns no state itself — the shared
 *   app-state lives in main and is read via injected getters / written via injected setters;
 *   main-local fns (+ closeModal from apps-io) injected via initServerIo(deps). Carved from main.js.
 * @usage import { initServerIo, loadPublishedApps, showPublishModal } from './server-io.js'; initServerIo({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 11).
 *   v2.0.0 — 2026-07-20 — Server-only cutover: drop "Import from AIMEAT" (offline server→local import);
 *     the create flow publishes then parks so a new app lands unlisted.
 *   v2.1.0 — 2026-08-17 — deleteServerApp reports its outcome (true only when the node confirmed)
 *     and names the app rather than the file when the caller knows the name, so the detail view and
 *     the card menu can route their Delete here instead of dropping a page-session record.
 *   v2.2.0 — 2026-08-19 — loadPublishedApps reports when the first listing has finished — on success, on failure,
 *     and when there is no node to ask — so the grid can show a wait instead of an empty answer.
 */
import { escapeHtml, jsArg, bareOwnerName, sameOwner, filterAttr } from './util.js';
import { getAllApps, saveApp } from './db.js';
import { showConfirm, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t, getLang } from './i18n.js';
import { closeModal } from './apps-io.js';
import { getCortexOwnerToken } from './cortex.js';
import { fetchAppContentBase64, refreshServerMgmt } from './detail.js';
import { favStarHtml, isFavorite, loadFavorites } from './favorites.js';
import { loadPromoted } from './promote.js';

// Injected once at bootstrap by main.js: read getters + write setters for the shared app-state
// (which stays main-owned), plus a few main-local fns.
let getMainApps, getServerState, getServerManifests, setServerManifests, getOwnServerApps, setOwnServerApps, getActiveTag, getSearchQuery, generateId, renderApps, refreshAll, setListingLoaded, isListingLoaded;
export function initServerIo(deps) {
  ({ getMainApps, getServerState, getServerManifests, setServerManifests, getOwnServerApps, setOwnServerApps, getActiveTag, getSearchQuery, generateId, renderApps, refreshAll, setListingLoaded, isListingLoaded } = deps);
}

// Cache of the last full server-app list (own + community) + base URL, so a favourite toggle can
// re-render the ⭐ group + all star states without a network round-trip.
let lastAllServerApps = [];
let lastAimeatUrl = '';

// ── Publish to AIMEAT ───────────────────────────

var publishAppId = null;
// When the publish is driven by the "Add app" create flow we park the app straight after publishing
// so a freshly-created app lands UNLISTED (on the server, not yet public) rather than instantly live.
var publishUnlisted = false;

function showPublishModal(appId, opts) {
  publishUnlisted = !!(opts && opts.unlisted);
  var app = null;
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === appId) { app = getMainApps()[i]; break; }
  }
  if (!app) return;

  var config = loadConfig();
  if (!config.aimeatUrl) {
    showNotice('Set AIMEAT server URL in Settings first');
    return;
  }

  publishAppId = appId;
  // Republish keeps the same filename so the server appends v(N+1); otherwise derive from name.
  var safeName;
  if (app.published && app.publishedFilename) {
    safeName = app.publishedFilename;
  } else {
    safeName = (app.name || 'app').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').toLowerCase();
    if (!/\.html?$/i.test(safeName)) safeName += '.html';
  }
  document.getElementById('publish-filename').value = safeName;
  document.getElementById('publish-description').value = app.description || '';
  document.getElementById('publish-access-code').value = '';
  // Surface the sign-in requirement up front: publishing needs a signed-in owner.
  var pubStatus = document.getElementById('publish-status');
  var pubSubmit = document.getElementById('publish-submit-btn');
  if (!getCortexOwnerToken()) {
    pubStatus.textContent = t('publish.loginRequired');
    pubStatus.style.color = 'var(--accent)';
    pubSubmit.disabled = true;
  } else {
    pubStatus.textContent = '';
    pubSubmit.disabled = false;
  }
  document.getElementById('publish-overlay').hidden = false;
}

function submitPublish() {
  if (!publishAppId) return;

  var app = null;
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === publishAppId) { app = getMainApps()[i]; break; }
  }
  if (!app) return;

  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var filename = document.getElementById('publish-filename').value.trim();
  var accessCode = document.getElementById('publish-access-code').value.trim();
  var statusEl = document.getElementById('publish-status');
  var submitBtn = document.getElementById('publish-submit-btn');

  if (!filename || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
    statusEl.textContent = 'Invalid filename. Use letters, numbers, dots, hyphens, underscores.';
    statusEl.style.color = 'var(--accent)';
    return;
  }

  if (accessCode && (accessCode.length < 4 || accessCode.length > 64)) {
    statusEl.textContent = 'Access code must be 4-64 characters.';
    statusEl.style.color = 'var(--accent)';
    return;
  }

  // Description is required for a NEW app (the server enforces it too); on a republish the server
  // carries the existing one forward when omitted.
  var description = document.getElementById('publish-description').value.trim();
  if (!description && !app.published) {
    statusEl.textContent = 'A description is required for a new app. Write 1-2 sentences (your AI can write it).';
    statusEl.style.color = 'var(--accent)';
    return;
  }
  app.description = description;

  // Get the HTML content
  var htmlContent = '';
  if (app.blob) {
    htmlContent = app.blob; // already base64
  } else if (app.url) {
    statusEl.textContent = 'Cannot publish URL-linked apps. Download it first (right-click \u2192 View Source \u2192 Save).';
    statusEl.style.color = 'var(--accent)';
    return;
  } else {
    statusEl.textContent = 'No app content found.';
    statusEl.style.color = 'var(--accent)';
    return;
  }

  // Publishing to AIMEAT REQUIRES a signed-in owner. This is the gate that stops
  // anonymous apps from ever reaching the node — there is NO fallback to an
  // anonymous token. If not signed in, point the user at the top-bar sign-in.
  var token = getCortexOwnerToken();
  if (!token) {
    statusEl.textContent = t('publish.loginRequired');
    statusEl.style.color = 'var(--accent)';
    submitBtn.disabled = false;
    return;
  }

  statusEl.textContent = 'Publishing...';
  statusEl.style.color = '#34d399';
  submitBtn.disabled = true;

  // Omit category + uses_cortex: the server defaults them for a NEW app and now CARRIES THE
  // EXISTING VALUES FORWARD on a re-publish. Hardcoding 'utility'/[] here used to reset the
  // server manifest on every update. Send the icon so a re-publish keeps it.
  var body = {
    filename: filename,
    content: htmlContent,
    mime_type: 'text/html',
    name: app.name || filename.replace(/\.html?$/i, ''),
    description: app.description || '',
    tags: app.tags || []
  };
  if (app.icon) body.icon = app.icon;
  if (accessCode) body.access_code = accessCode;

  fetch(aimeatUrl + '/v1/apps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: JSON.stringify(body)
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        statusEl.textContent = '\u2714 Published! ' + (json.data.download_url || '');
        statusEl.style.color = '#34d399';
        // Mark app as published in IndexedDB
        app.published = true;
        app.publishedFilename = filename;
        app.publishedAt = new Date().toISOString();
        app.publishedUrl = json.data.download_url || null;
        app.publishedVersionNumber = json.data.version_number || 1;
        app.publishedVersionsUrl = json.data.versions_url || null;
        saveApp(app).then(function() {
          // Create flow: park it immediately so the new app is UNLISTED (server-only, not public).
          if (publishUnlisted) {
            app.parked = true;
            statusEl.textContent = '\u2714 ' + (t('publish.savedUnlisted') || 'Saved (unlisted)');
            try { toggleParkApp(filename, true); } catch (e) { /* park is best-effort */ }
          }
          publishUnlisted = false;
          loadPublishedApps();
          // Close the modal shortly after showing success \u2014 otherwise it dead-ends with a
          // disabled button and the user isn't sure the publish took.
          setTimeout(function () {
            var ov = document.getElementById('publish-overlay');
            if (ov) ov.hidden = true;
            submitBtn.disabled = false;
          }, 1400);
        });
      } else {
        statusEl.textContent = '\u2718 ' + ((json.error && json.error.message) || 'Publish failed');
        statusEl.style.color = 'var(--accent)';
        submitBtn.disabled = false;
      }
    })
    .catch(function(err) {
      statusEl.textContent = '\u2718 ' + (err.message || 'Publish failed');
      statusEl.style.color = 'var(--accent)';
      submitBtn.disabled = false;
    });
}

// ── Published Apps Section ──────────────────────

// Community section keeps its own collapse toggle (Published/Parked merged into #app-grid).
var communityVisible = true;
function toggleCommunity() {
  communityVisible = !communityVisible;
  var grid = document.getElementById('community-grid');
  var arrow = document.getElementById('community-arrow');
  grid.style.display = communityVisible ? '' : 'none';
  arrow.classList.toggle('open', communityVisible);
}

// ── Two views: Kirjasto (your apps: local + published + parked) / Yhteisö (community) ──
// Sections carry data-view; body[data-active-view] hides the inactive one via CSS.
function switchView(view) {
  if (view !== 'community') view = 'library';
  document.body.setAttribute('data-active-view', view);
  var lib = document.getElementById('view-tab-library');
  var com = document.getElementById('view-tab-community');
  if (lib) lib.classList.toggle('active', view === 'library');
  if (com) com.classList.toggle('active', view === 'community');
  try { localStorage.setItem('appCatalogView', view); } catch (e) { /* private mode */ }
  updateCommunityEmpty();
}

// Empty-state for the Community view: shown only when that view is active and has no apps
// (an empty tab reads as broken, so say why it's empty).
function updateCommunityEmpty() {
  var empty = document.getElementById('community-empty');
  if (!empty) return;
  var loading = document.getElementById('community-loading');
  var grid = document.getElementById('community-grid');
  var hasApps = !!grid && grid.children.length > 0;
  var inCommunity = document.body.getAttribute('data-active-view') === 'community';
  // Three states, not two: still fetching, fetched and empty, fetched and full. Before the first
  // listing lands "no community apps yet" would be a claim we cannot make.
  var waiting = !hasApps && inCommunity && !isListingLoaded();
  if (loading) loading.style.display = waiting ? 'block' : 'none';
  empty.style.display = (!hasApps && inCommunity && !waiting) ? 'block' : 'none';
}

// Owner-match: an app belongs to the logged-in user when the bare owner names
// match, regardless of whether either side carries a `@node` suffix. Legacy
// publish paths stored ownerName as the full GHII, so an exact string compare
// wrongly dumped the user's own apps into "Community".

// ── Operator subdomain mappings ─────────────────
// Operators can map a subdomain to a published app (served at the subdomain
// root). Mappings are loaded only for operator sessions; everyone else never
// sees the controls and the admin API returns 403 anyway.

function getSessionRoles() {
  try {
    var token = getCortexOwnerToken();
    if (!token) return [];
    var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.roles || [];
  } catch (e) { return []; }
}

function isOperatorSession() {
  return getSessionRoles().indexOf('operator') !== -1;
}

// target ("owner/filename") → site record; null until loaded
var subdomainsByTarget = null;

function loadSubdomainSites() {
  if (!isOperatorSession()) {
    subdomainsByTarget = null;
    return Promise.resolve();
  }
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
  if (!aimeatUrl) { subdomainsByTarget = null; return Promise.resolve(); }
  return fetch(aimeatUrl + '/v1/admin/subdomains', {
    headers: { 'Authorization': 'Bearer ' + getCortexOwnerToken() }
  })
    .then(function (resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
    .then(function (json) {
      subdomainsByTarget = {};
      var sites = (json.data && json.data.sites) || [];
      for (var i = 0; i < sites.length; i++) {
        if (sites[i].kind === 'app') subdomainsByTarget[sites[i].target] = sites[i];
      }
    })
    .catch(function () { subdomainsByTarget = null; });
}

// The host where subdomain apps are actually served: apps.<domain>, NOT the bare apex. A subdomain
// chip must read "<sub>.apps.aimeat.io" (the real, reachable app URL), not "<sub>.aimeat.io".
function apexHostLabel() {
  if (window.__APP_HOST) return window.__APP_HOST;            // node-injected app host (authoritative)
  try {
    var apexHost = new URL(loadConfig().aimeatUrl || window.location.origin).host;
    return 'apps.' + apexHost;                                 // derive apps.<apex> when not injected
  } catch (e) { return window.location.host; }
}

// The app target currently open in the subdomain modal: { target, existingSub }
var subdomainModalState = null;

function showSubdomainModal(owner, filename) {
  var target = bareOwnerName(owner) + '/' + filename;
  var existing = (subdomainsByTarget && subdomainsByTarget[target]) || null;
  subdomainModalState = { target: target, existingSub: existing ? existing.subdomain : null };
  document.getElementById('subdomain-app-label').textContent = target;
  document.getElementById('subdomain-input').value = existing ? existing.subdomain : '';
  document.getElementById('subdomain-status').textContent = '';
  document.getElementById('subdomain-unassign-btn').style.display = existing ? '' : 'none';
  document.getElementById('subdomain-overlay').hidden = false;
}

function subdomainApiCall(method, path, body) {
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  return fetch(aimeatUrl + path, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + getCortexOwnerToken(),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  }).then(function (resp) {
    return resp.json().then(function (json) {
      if (!json.ok) {
        var msg = (json.error && (json.error.message || json.error.code)) || ('HTTP ' + resp.status);
        throw new Error(msg);
      }
      return json;
    });
  });
}

function submitSubdomainAssign() {
  if (!subdomainModalState) return;
  var sub = document.getElementById('subdomain-input').value.trim().toLowerCase();
  var statusEl = document.getElementById('subdomain-status');
  if (!sub) {
    statusEl.style.color = '#ef4444';
    statusEl.textContent = t('subModal.empty');
    return;
  }
  if (sub === subdomainModalState.existingSub) {
    document.getElementById('subdomain-overlay').hidden = true;
    return;
  }
  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = t('subModal.saving');
  var oldSub = subdomainModalState.existingSub;
  subdomainApiCall('POST', '/v1/admin/subdomains', {
    subdomain: sub, kind: 'app', target: subdomainModalState.target
  })
    .then(function () {
      // Re-pointing to a new subdomain: drop the old mapping after the new
      // one exists, so the app is never left unmapped on failure.
      if (oldSub) return subdomainApiCall('DELETE', '/v1/admin/subdomains/' + encodeURIComponent(oldSub));
    })
    .then(function () {
      statusEl.style.color = '#34d399';
      statusEl.textContent = '✔ ' + t('subModal.assigned') + ' — ' + sub + '.' + apexHostLabel();
      return loadSubdomainSites();
    })
    .then(function () { loadPublishedApps(); })
    .catch(function (err) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = err.message || String(err);
    });
}

function unassignSubdomain() {
  if (!subdomainModalState || !subdomainModalState.existingSub) return;
  var statusEl = document.getElementById('subdomain-status');
  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = t('subModal.saving');
  subdomainApiCall('DELETE', '/v1/admin/subdomains/' + encodeURIComponent(subdomainModalState.existingSub))
    .then(function () {
      statusEl.style.color = '#34d399';
      statusEl.textContent = '✔ ' + t('subModal.unassigned');
      document.getElementById('subdomain-unassign-btn').style.display = 'none';
      subdomainModalState.existingSub = null;
      return loadSubdomainSites();
    })
    .then(function () { loadPublishedApps(); })
    .catch(function (err) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = err.message || String(err);
    });
}

// ── App grant consents (H-2) ─────────────────────
// Manage the scoped grant THIS user gave a (usually someone else's) app: see the granted scopes
// and revoke. Reuses the owner-authenticated /v1/app-grants list + delete; a tiny dynamic modal.
function closeConsents() { var o = document.getElementById('consents-overlay'); if (o) o.remove(); }
function openConsents(owner, filename, appName) {
  var target = bareOwnerName(owner) + '/' + filename;
  closeConsents();
  var ov = document.createElement('div');
  ov.id = 'consents-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  ov.onclick = function (e) { if (e.target === ov) closeConsents(); };
  var box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = '<div style="font-size:1.05rem;font-weight:700;margin-bottom:4px">' + t('consents.title') + '</div>'
    + '<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">' + escapeHtml(appName || filename) + ' · ' + escapeHtml(target) + '</div>'
    + '<div id="consents-body" style="font-size:.9rem;color:var(--text-muted)">' + t('common.loading') + '</div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">'
    + '<button type="button" class="modal-btn secondary" onclick="window._launcher.closeConsents()">' + t('common.close') + '</button></div>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  subdomainApiCall('GET', '/v1/app-grants').then(function (json) {
    var grants = (json.data && json.data.grants) || [];
    var g = grants.filter(function (x) { return x.app === target; })[0];
    var body = document.getElementById('consents-body');
    if (!body) return;
    if (!g) { body.innerHTML = '<span style="color:var(--text-muted)">' + t('consents.none') + '</span>'; return; }
    body.innerHTML = '<div style="margin-bottom:6px;color:var(--text)">' + t('consents.granted') + '</div>'
      + '<ul style="margin:0 0 14px;padding-left:18px">'
      + g.scopes.map(function (s) { return '<li><code>' + escapeHtml(s) + '</code></li>'; }).join('')
      + '</ul>'
      + '<div style="font-size:.8rem;color:var(--text-muted);margin-bottom:12px">' + t('consents.hint') + '</div>'
      + '<button type="button" class="modal-btn danger" onclick="window._launcher.revokeConsent(\'' + jsArg(g.grant_id) + '\')">' + t('consents.revoke') + '</button>';
  }).catch(function (e) {
    var body = document.getElementById('consents-body');
    if (body) { body.style.color = '#ef4444'; body.textContent = e.message || String(e); }
  });
}
function revokeConsent(grantId) {
  subdomainApiCall('DELETE', '/v1/app-grants/' + encodeURIComponent(grantId))
    .then(function () { closeConsents(); })
    .catch(function (e) { var b = document.getElementById('consents-body'); if (b) { b.style.color = '#ef4444'; b.textContent = e.message || String(e); } });
}

// ── Backup: export all + selective import ────────
// Follows the organism-export bundle model: one ZIP, manifest + per-item
// folders, inspect-before-write, explicit conflict modes — never a silent
// overwrite.

function toggleBackupMenu(event) {
  if (event && event.stopPropagation) event.stopPropagation();
  var menu = document.getElementById('backup-menu');
  var create = document.getElementById('create-menu');
  if (create) create.hidden = true;
  menu.hidden = !menu.hidden;
}

// Create menu (Add app / Generate with AI / Generate homepage grouped under one +).
function toggleCreateMenu(event) {
  if (event && event.stopPropagation) event.stopPropagation();
  var menu = document.getElementById('create-menu');
  var backup = document.getElementById('backup-menu');
  if (backup) backup.hidden = true;
  menu.hidden = !menu.hidden;
}
function closeCreateMenu() { var m = document.getElementById('create-menu'); if (m) m.hidden = true; }

// Active Extensions bar: collapsed by default, expand/collapse the chip grid (declutters Library).
function toggleCortexBar() {
  var grid = document.getElementById('cortex-bar-grid');
  var arrow = document.getElementById('cortex-bar-arrow');
  if (!grid) return;
  var open = grid.style.display === 'none';
  grid.style.display = open ? 'flex' : 'none';
  if (arrow) arrow.innerHTML = open ? '▼' : '▶';
}

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
  var overlay = document.getElementById('backup-overlay');
  var statusEl = document.getElementById('backup-status');
  var body = document.getElementById('backup-import-body');
  document.getElementById('backup-restore-btn').style.display = 'none';
  body.innerHTML = '';
  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = t('backup.inspecting');
  overlay.hidden = false;

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
      statusEl.style.color = '#ef4444';
      statusEl.textContent = e.message || String(e);
    });
}

function renderBackupSelection() {
  var d = backupInspectData;
  var body = document.getElementById('backup-import-body');
  if (!d || (d.apps.length === 0 && d.extensions.length === 0)) {
    body.innerHTML = '<p style="color:var(--text-muted)">' + t('backup.empty') + '</p>';
    return;
  }

  var conflictOptions =
    '<option value="skip">' + t('backup.conflictSkip') + '</option>' +
    '<option value="append">' + t('backup.conflictAppend') + '</option>' +
    '<option value="copy">' + t('backup.conflictCopy') + '</option>';

  var html =
    '<div style="font-size:.8rem;color:var(--text-muted)">' + t('backup.from') + ': <span style="font-family:monospace">' +
      escapeHtml((d.source.owner || '?') + '@' + (d.source.nodeId || '?')) + '</span>' +
      (d.exported_at ? ' · ' + new Date(d.exported_at).toLocaleString() : '') +
    '</div>' +
    '<div class="backup-toolbar-row">' +
      '<div>' +
        '<button class="backup-link-btn" onclick="window._launcher.backupSelectAll(true)">' + t('backup.selectAll') + '</button> / ' +
        '<button class="backup-link-btn" onclick="window._launcher.backupSelectAll(false)">' + t('backup.selectNone') + '</button>' +
      '</div>' +
      '<div class="backup-summary-line" id="backup-summary"></div>' +
    '</div>' +
    '<table class="backup-table"><thead><tr>' +
      '<th></th><th>' + t('backup.colApp') + '</th><th>' + t('backup.colVersions') + '</th><th>' + t('backup.colStatus') + '</th>' +
    '</tr></thead><tbody>';

  for (var i = 0; i < d.apps.length; i++) {
    var app = d.apps[i];
    var versionList = '';
    for (var v = 0; v < app.versions.length; v++) {
      var ver = app.versions[v];
      versionList +=
        '<label><input type="checkbox" class="backup-ver" data-app="' + i + '" data-v="' + ver.version + '" checked ' +
          'onchange="window._launcher.backupUpdateSummary()"/> v' + ver.version +
          (ver.semver ? ' (' + escapeHtml(ver.semver) + ')' : '') +
          ' · ' + (ver.size < 1024 ? ver.size + ' B' : (ver.size / 1024).toFixed(1) + ' KB') +
          (ver.created_at ? ' · ' + new Date(ver.created_at).toLocaleDateString() : '') +
        '</label>';
    }
    html +=
      '<tr>' +
        '<td><input type="checkbox" id="backup-app-' + i + '" checked onchange="window._launcher.backupUpdateSummary()"/></td>' +
        '<td>' + escapeHtml(app.name || app.filename) +
          '<div class="mono-cell">' + escapeHtml(app.filename) + '</div></td>' +
        '<td>' + app.versions.length + ' ' +
          '<button class="backup-versions-toggle" onclick="var el=document.getElementById(\'backup-app-' + i + '-versions\');el.style.display=el.style.display===\'none\'?\'\':\'none\'">' + t('backup.colVersions').toLowerCase() + ' ▾</button>' +
          '<div class="backup-version-list" id="backup-app-' + i + '-versions" style="display:none">' + versionList + '</div></td>' +
        '<td>' +
          (app.exists
            ? '<span class="backup-status-badge backup-status-exists">' + t('backup.statusExists') + '</span><br/>' +
              '<select class="backup-conflict-select" id="backup-app-' + i + '-conflict">' + conflictOptions + '</select>'
            : '<span class="backup-status-badge backup-status-new">' + t('backup.statusNew') + '</span>') +
        '</td>' +
      '</tr>';
  }
  html += '</tbody></table>';

  if (d.extensions.length > 0) {
    html += '<h3 style="font-size:.9rem;margin:14px 0 6px">' + t('backup.extensions') + '</h3>';
    for (var e = 0; e < d.extensions.length; e++) {
      var ext = d.extensions[e];
      html +=
        '<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:.85rem">' +
          '<input type="checkbox" id="backup-ext-' + e + '" checked onchange="window._launcher.backupUpdateSummary()"/>' +
          '<span style="font-family:monospace">' + escapeHtml(ext.name) + '</span>' +
          (ext.exists
            ? '<span class="backup-status-badge backup-status-exists">' + t('backup.statusExists') + '</span>' +
              '<select class="backup-conflict-select" id="backup-ext-' + e + '-conflict">' +
                '<option value="skip">' + t('backup.conflictSkip') + '</option>' +
                '<option value="copy">' + t('backup.conflictCopy') + '</option>' +
              '</select>'
            : '<span class="backup-status-badge backup-status-new">' + t('backup.statusNew') + '</span>') +
        '</div>';
    }
  }

  body.innerHTML = html;
  document.getElementById('backup-restore-btn').style.display = '';
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
    var verBoxes = document.querySelectorAll('.backup-ver[data-app="' + i + '"]');
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
    document.querySelectorAll('.backup-ver[data-app="' + i + '"]').forEach(function (b) { b.checked = checked; });
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
    statusEl.style.color = '#ef4444';
    statusEl.textContent = t('backup.nothingSelected');
    return;
  }
  statusEl.style.color = 'var(--text-muted)';
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
      statusEl.style.color = '#ef4444';
      statusEl.textContent = e.message || String(e);
    })
    .finally(function () { btn.disabled = false; });
}

function renderBackupResult(s) {
  var body = document.getElementById('backup-import-body');
  document.getElementById('backup-restore-btn').style.display = 'none';
  var section = function (label, items) {
    if (!items || items.length === 0) return '';
    var rendered = items.map(function (x) {
      if (typeof x === 'string') return escapeHtml(x);
      if (x && x.from && x.to) return escapeHtml(x.from) + ' → ' + escapeHtml(x.to);
      if (x && x.item) return escapeHtml(x.item) + ': ' + escapeHtml(x.message || '');
      return escapeHtml(JSON.stringify(x));
    });
    return '<div style="font-size:.85rem;font-weight:600;margin-top:8px">' + label + ' (' + items.length + ')</div>' +
      '<ul class="backup-result-list">' + rendered.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>';
  };
  body.innerHTML =
    '<h3 style="font-size:.95rem;margin:6px 0">✔ ' + t('backup.resultTitle') + '</h3>' +
    '<div style="font-size:.85rem">' + t('backup.resVersions') + ': ' + s.versions_restored + '</div>' +
    section(t('backup.resCreated'), s.apps_created.concat(s.extensions_created)) +
    section(t('backup.resAppended'), s.apps_appended) +
    section(t('backup.resCopied'), s.apps_copied.concat(s.extensions_copied)) +
    section(t('backup.resSkipped'), s.apps_skipped.concat(s.extensions_skipped)) +
    (s.errors.length ? '<div class="backup-result-errors">' + section(t('backup.resErrors'), s.errors) + '</div>' : '');
}


// Manifest cache keyed by "owner\nfilename" — lets Restore/Fork reuse the
// app's metadata (name, description, category, tags, icon) without a re-fetch.

// Fetch ALL server apps across pages — the /v1/apps default limit is 50, so a single request
// silently dropped everything beyond the newest 50 (community apps + the owner's older apps,
// and the "not in this catalog" banner undercounted). Loop by offset until we have them all.
function fetchAllPublishedApps(aimeatUrl, headers) {
  var LIMIT = 200; // the server caps limit at 200
  var all = [];
  function page(offset) {
    return fetch(aimeatUrl + '/v1/apps?limit=' + LIMIT + '&offset=' + offset, { headers: headers })
      .then(function(resp) { if (!resp.ok) throw new Error('Server returned ' + resp.status); return resp.json(); })
      .then(function(json) {
        var apps = (json.data && json.data.apps) || [];
        all = all.concat(apps);
        var total = (json.data && typeof json.data.total === 'number') ? json.data.total : all.length;
        if (apps.length === LIMIT && all.length < total) return page(offset + LIMIT);
        return { data: { apps: all, total: total } };
      });
  }
  return page(0);
}

function loadPublishedApps() {
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
  var communitySection = document.getElementById('community-section');
  var communityGrid = document.getElementById('community-grid');
  var communityCountEl = document.getElementById('community-count');

  var currentOwner = null;
  try {
    if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession()) {
      currentOwner = window.AIMEAT.auth.getSession().owner || null;
    }
    if (!currentOwner) {
      var stored = localStorage.getItem('aimeat_session');
      if (stored) {
        currentOwner = JSON.parse(stored).owner || null;
      }
    }
    // The token is the authority the rest of this file uses. Without one there is no owner,
    // whatever a leftover localStorage blob says — reading that stale blob kept "Your apps (1)"
    // on screen after a logout (UX-remake v3, measured).
    if (!getCortexOwnerToken()) currentOwner = null;
  } catch(e) {}

  // Load the owner's favourites alongside the app list so the ⭐ group + stars match the current
  // session (also refreshes them on an auth change, which routes through here via refreshAll).
  Promise.all([getAllApps(), loadFavorites(), loadPromoted()]).then(function() {
    if (!aimeatUrl) {
      setListingLoaded(true);   // nothing to fetch — an empty grid here is the answer, not a wait
      setOwnServerApps([]);
      renderApps();
      if (communitySection) communitySection.style.display = 'none';
      return;
    }

    // Send the owner token when we have one: the server decides visibility from who
    // is authenticated, so an authenticated owner gets back their OWN parked +
    // operator-hidden apps (badged) while everyone else never sees them.
    var listHeaders = {};
    var listTok = getCortexOwnerToken();
    if (listTok) listHeaders['Authorization'] = 'Bearer ' + listTok;
    fetchAllPublishedApps(aimeatUrl, listHeaders)
      .then(function(json) {
        var serverApps = json.data && json.data.apps ? json.data.apps : [];

        // Cache manifests for Restore/Fork before partitioning
        setServerManifests({});
        for (var mi = 0; mi < serverApps.length; mi++) {
          var msa = serverApps[mi];
          getServerManifests()[(msa.owner || '') + '\n' + (msa.filename || '')] = msa.manifest || {};
        }

        var ownApps = currentOwner
          ? serverApps.filter(function(a) { return sameOwner(a.owner, currentOwner); })
          : [];
        var communityApps = currentOwner
          ? serverApps.filter(function(a) { return !sameOwner(a.owner, currentOwner); })
          : serverApps;

        // Cache the FULL list (own + community) so a favourite toggle can re-render the ⭐ group
        // and the star state in place, without another round-trip.
        lastAllServerApps = serverApps;
        lastAimeatUrl = aimeatUrl;

        return loadSubdomainSites().then(function () {
          // Kirjasto grid: the owner's server apps (published + parked). Logged out → none
          // (a visitor browses everything under Community).
          setListingLoaded(true);
          setOwnServerApps(currentOwner ? ownApps : []);
          renderApps();
          renderCommunityApps(communityApps, aimeatUrl, communitySection, communityGrid, communityCountEl, currentOwner);
          renderFavorites(serverApps, aimeatUrl); // ⭐ group pinned atop the Library
          applyServerFilter(); // re-apply any active search/tag to the community cards
        });
      })
      .catch(function() {
        // A failed fetch has still FINISHED: leaving the spinner up would promise a result that is
        // not coming. The grid falls back to its empty state.
        setListingLoaded(true);
        setOwnServerApps([]);
        renderApps();
        if (communitySection) communitySection.style.display = 'none';
      });
  });
}

// Build a data-filter/data-tags attribute pair so applyServerFilter() can match a server card
// against the search query (name + tags substring) and the active tag (exact) without a re-fetch.

// Apply the current getSearchQuery() + getActiveTag() to the Community grid. (Your own apps live in the
// unified #app-grid, which renderApps() filters directly; Community is the one server section
// left, so its cards still need this pass so a search matches community apps too.)
function applyServerFilter() {
  var q = (getSearchQuery() || '').toLowerCase();
  var at = getActiveTag();
  var filtering = !!(q || (at !== null));
  var grid = document.getElementById('community-grid');
  if (!grid) return;
  var cards = grid.querySelectorAll('.published-card');
  if (!cards.length) return;
  var shown = 0;
  cards.forEach(function (card) {
    var match = true;
    if (at === '__favorites__') { match = false; } // favorites is a Local-only filter
    else if (at !== null) {
      match = (',' + (card.getAttribute('data-tags') || '') + ',').indexOf(',' + at.toLowerCase() + ',') !== -1;
    }
    if (match && q) match = (card.getAttribute('data-filter') || '').indexOf(q) !== -1;
    card.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  var countEl = document.getElementById('community-count');
  if (countEl) countEl.textContent = '(' + shown + ')';
  var sectionEl = document.getElementById('community-section');
  if (sectionEl) sectionEl.style.display = (filtering && shown === 0) ? 'none' : '';
}

// One published-app card (used by BOTH the Community grid and the ⭐ Favourites group). Carries a
// favourite toggle + a description localized to the current UI language.
function publishedCardHtml(sa, aimeatUrl) {
  var owner = sa.owner || '';
  var fn = sa.filename || '';
  var ref = owner + '/' + fn;
  var m = sa.manifest || {};
  var name = m.name || fn;
  var version = sa.version_number ? 'v' + sa.version_number : '';
  var description = (m.descriptions && m.descriptions[getLang()]) || m.description || '';
  var date = sa.created_at ? new Date(sa.created_at).toLocaleDateString() : '';
  var author = m.authorDisplay || owner;
  var viewUrl = aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(fn);
  // Agent-Bundled Apps: this app ships its own agent(s) — badge it and offer the Bundled-agents modal.
  var shipsAgent = !!(m.cortex && m.cortex.agents && m.cortex.agents.length);
  return '<div class="published-card"' + filterAttr(name, m.tags || []) + '>' +
      favStarHtml(ref) +
      '<div class="published-card-name">' + escapeHtml(name) + '</div>' +
      (description ? '<div class="published-card-desc">' + escapeHtml(description) + '</div>' : '') +
      '<div class="published-card-footer">' +
        '<div class="published-card-metaline">' +
          '<span class="pcm-main" style="color:var(--accent)">&#x1F464; ' + escapeHtml(author) + '</span>' +
          (date ? '<span class="pcm-date">' + date + '</span>' : '') +
        '</div>' +
        '<div class="published-card-actions">' +
          '<button onclick="window._launcher.viewPublished(\'' + escapeHtml(viewUrl) + '?mode=inline\', \'' + jsArg(name) + '\')">' + t('card.view') + '</button>' +
          // Fork is offered on a community app only when its owner marked it forkable.
          (sa.forkable
            ? '<button onclick="window._launcher.forkVersion(\'' + escapeHtml(owner) + '\', \'' + escapeHtml(fn) + '\', ' + (sa.version_number || 0) + ')" title="' + escapeHtml(t('card.forkHint')) + '">' + t('card.fork') + '</button>'
            : '') +
          (shipsAgent
            ? '<button onclick="window._launcher.showAppAgentsModal(\'' + jsArg(owner) + '\', \'' + jsArg(fn) + '\')" title="' + escapeHtml(t('card.agentHint')) + '">' + t('card.agent') + '</button>'
            : '') +
        '</div>' +
        ((version || (sa.forks && sa.forks > 0) || shipsAgent)
          ? '<div class="published-card-badgerow">'
            + (shipsAgent
              ? '<span class="pcb-agent" title="' + escapeHtml(t('card.agentHint')) + '">&#x1F916;</span>'
              : '')
            + ((sa.forks && sa.forks > 0)
              ? '<span class="pcb-forks" title="' + escapeHtml(t('card.forksHint')) + '" onclick="window._launcher.showLineageModal(\'' + escapeHtml(owner) + '\', \'' + escapeHtml(fn) + '\')">⑂ ' + sa.forks + '</span>'
              : '')
            + (version ? '<span class="pcb-version">' + escapeHtml(version) + '</span>' : '')
            + '</div>'
          : '') +
      '</div>' +
    '</div>';
}

function renderCommunityApps(serverApps, aimeatUrl, section, grid, countEl, currentOwner) {
  if (!section || !grid || !countEl) return;
  if (serverApps.length === 0) {
    section.style.display = 'none';
    grid.innerHTML = '';
    updateCommunityEmpty();
    return;
  }
  section.style.display = '';
  countEl.textContent = '(' + serverApps.length + ')';
  var html = '';
  for (var i = 0; i < serverApps.length; i++) html += publishedCardHtml(serverApps[i], aimeatUrl);
  grid.innerHTML = html;
  updateCommunityEmpty();
}

// The ⭐ Favourites group (Library view): apps the owner favourited, drawn from the FULL server-app
// list (own + community). Pinned above "Your apps"; hidden when there are none.
function renderFavorites(allServerApps, aimeatUrl) {
  var section = document.getElementById('favorites-section');
  var grid = document.getElementById('favorites-grid');
  var countEl = document.getElementById('favorites-count');
  if (!section || !grid) return;
  var favs = (allServerApps || []).filter(function (sa) { return isFavorite((sa.owner || '') + '/' + (sa.filename || '')); });
  if (favs.length === 0) { section.style.display = 'none'; grid.innerHTML = ''; return; }
  section.style.display = '';
  if (countEl) countEl.textContent = '(' + favs.length + ')';
  var html = '';
  for (var i = 0; i < favs.length; i++) html += publishedCardHtml(favs[i], aimeatUrl);
  grid.innerHTML = html;
}

// Re-render everything that shows a star (own grid, community grid, ⭐ group) from the cached list
// after a favourite toggle — no re-fetch. Called by the _launcher.toggleFavorite handler.
function refreshFavoritesUI() {
  renderFavorites(lastAllServerApps, lastAimeatUrl);
  var currentOwner = null;
  try {
    var s = (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession());
    currentOwner = (s && s.owner) || (JSON.parse(localStorage.getItem('aimeat_session') || '{}').owner) || null;
  } catch (e) { /* anonymous */ }
  var communityApps = currentOwner
    ? lastAllServerApps.filter(function (a) { return !sameOwner(a.owner, currentOwner); })
    : lastAllServerApps;
  renderCommunityApps(communityApps, lastAimeatUrl,
    document.getElementById('community-section'), document.getElementById('community-grid'),
    document.getElementById('community-count'), currentOwner);
  applyServerFilter();
  renderApps(); // own-grid stars
}

// Render the owner's PARKED apps in their own section. A parked app is hidden from
// the public catalogue but stays fully usable by the owner; the primary action here
// is Publish (unpark), which moves it back into Published Apps.
async function unpublishApp(appId) {
  if (!(await showConfirm(t('confirm.removePublished')))) return;

  var app = null;
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === appId) { app = getMainApps()[i]; break; }
  }
  if (!app || !app.publishedFilename) return;

  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');

  var token = getCortexOwnerToken();
  if (!token) { showNotice('You must be logged in to delete apps. Sign in first.'); return; }
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(app.publishedFilename), {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        app.published = false;
        delete app.publishedFilename;
        delete app.publishedAt;
        delete app.publishedUrl;
        delete app.publishedVersionNumber;
        delete app.publishedVersionsUrl;
        saveApp(app).then(function() {
          loadPublishedApps();
        });
      } else {
        showNotice('Failed to remove: ' + ((json.error && json.error.message) || 'Unknown error'));
      }
    })
    .catch(function(err) {
      showNotice('Error: ' + (err.message || err));
    });
}

// Park / unpark a server-published app. Parked apps drop out of the public
// catalogue/gallery/search but stay fully usable by the owner (and the owner's
// agents). PATCH /v1/apps/:filename { parked } toggles the state.
function toggleParkApp(filename, parked) {
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('common.loginRequired') || 'You must be logged in. Sign in first.'); return; }
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(filename), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parked: !!parked })
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        // Optimistically flip the cached state so the open detail re-renders correctly now.
        if (getServerState()[filename]) getServerState()[filename].parked = !!parked;
        loadPublishedApps();
        refreshServerMgmt();
      } else {
        showNotice('Failed: ' + (json.error && json.error.message ? json.error.message : 'Unknown error'));
      }
    })
    .catch(function(err) { showNotice('Error: ' + (err.message || err)); });
}

// Allow / disallow others forking a server-published app. When forkable, any user
// can fork it into their own catalogue; otherwise only the owner and the owner's
// agents may. PATCH /v1/apps/:filename { forkable } toggles the state.
function toggleForkApp(filename, forkable) {
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('common.loginRequired') || 'You must be logged in. Sign in first.'); return; }
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(filename), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ forkable: !!forkable })
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        if (getServerState()[filename]) getServerState()[filename].forkable = !!forkable;
        loadPublishedApps();
        refreshServerMgmt();
      } else {
        showNotice('Failed: ' + (json.error && json.error.message ? json.error.message : 'Unknown error'));
      }
    })
    .catch(function(err) { showNotice('Error: ' + (err.message || err)); });
}

// The ONE place an app is deleted from the node. `label` is what the confirmation names — the detail
// view knows the app's name, a card knows only its filename. Resolves true only when the server
// confirmed the delete, so a caller can close its view on success and keep it open on failure.
async function deleteServerApp(filename, label) {
  if (!(await showConfirm(t('confirm.deleteFromServer').replace('{file}', function () { return label || filename; })))) return false;
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var token = getCortexOwnerToken();
  if (!token) { showNotice('You must be logged in to delete apps. Sign in first.'); return false; }
  try {
    var resp = await fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(filename), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    var json = await resp.json();
    if (!json.ok) {
      showNotice('Failed to delete: ' + (json.error && json.error.message ? json.error.message : 'Unknown error'));
      return false;
    }
    loadPublishedApps();
    return true;
  } catch (err) {
    showNotice('Error: ' + (err.message || err));
    return false;
  }
}

export {
  isOperatorSession,
  showPublishModal,
  submitPublish,
  toggleCommunity,
  switchView,
  showSubdomainModal,
  submitSubdomainAssign,
  unassignSubdomain,
  closeConsents,
  openConsents,
  revokeConsent,
  toggleBackupMenu,
  toggleCreateMenu,
  closeCreateMenu,
  toggleCortexBar,
  exportBackupZip,
  importBackupPick,
  importBackupFile,
  backupUpdateSummary,
  backupSelectAll,
  submitBackupRestore,
  loadPublishedApps,
  refreshFavoritesUI,
  applyServerFilter,
  unpublishApp,
  toggleParkApp,
  toggleForkApp,
  deleteServerApp
};
