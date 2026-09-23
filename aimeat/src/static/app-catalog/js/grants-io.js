/**
 * @file grants-io.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's subdomain mappings and the H-2 app-grant consents: who may map a
 *   subdomain to a published app, the dialog that assigns or removes one, and the dialog where a
 *   person sees and revokes the scoped access they granted an app. Moved out of server-io.js by pure
 *   extraction (the file had grown past the line ceiling); server-io re-exports every name, so the
 *   callers did not change.
 * @structure getSessionRoles · isOperatorSession · loadSubdomainSites · apexHostLabel ·
 *   showSubdomainModal · subdomainApiCall · submitSubdomainAssign · unassignSubdomain ·
 *   closeConsents · openConsents · revokeConsent
 * @usage import { isOperatorSession, openConsents } from './server-io.js';
 * @version-history
 *   v1.0.0 — 2026-09-22 — Extracted from server-io.js unchanged (its v2.5.0 set-part markup included).
 */
import { escapeHtml, bareOwnerName } from './util.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { getCortexOwnerToken } from './cortex.js';
import { openDlg, closeDlg, onDlgClose } from './dialogs.js';
import { action, chip, stack, text } from './parts-html.js';

// The listing reload lives in server-io.js, which imports this module; it is handed in by main.js
// (initGrantsIo) rather than imported, so the two modules do not import each other.
var deps = {};
/** main.js hands in { loadPublishedApps } once at start. */
export function initGrantsIo(d) { deps = d || {}; }
function loadPublishedApps() { if (deps.loadPublishedApps) deps.loadPublishedApps(); }

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
  document.getElementById('subdomain-unassign-btn').hidden = !existing;
  openDlg('subdomain-overlay');
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
    statusEl.dataset.tone = 'danger';
    statusEl.textContent = t('subModal.empty');
    return;
  }
  if (sub === subdomainModalState.existingSub) {
    closeDlg('subdomain-overlay');
    return;
  }
  statusEl.dataset.tone = 'muted';
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
      statusEl.dataset.tone = 'success';
      statusEl.textContent = '✓ ' + t('subModal.assigned') + ' — ' + sub + '.' + apexHostLabel();
      return loadSubdomainSites();
    })
    .then(function () { loadPublishedApps(); })
    .catch(function (err) {
      statusEl.dataset.tone = 'danger';
      statusEl.textContent = err.message || String(err);
    });
}

function unassignSubdomain() {
  if (!subdomainModalState || !subdomainModalState.existingSub) return;
  var statusEl = document.getElementById('subdomain-status');
  statusEl.dataset.tone = 'muted';
  statusEl.textContent = t('subModal.saving');
  subdomainApiCall('DELETE', '/v1/admin/subdomains/' + encodeURIComponent(subdomainModalState.existingSub))
    .then(function () {
      statusEl.dataset.tone = 'success';
      statusEl.textContent = '✓ ' + t('subModal.unassigned');
      document.getElementById('subdomain-unassign-btn').hidden = true;
      subdomainModalState.existingSub = null;
      return loadSubdomainSites();
    })
    .then(function () { loadPublishedApps(); })
    .catch(function (err) {
      statusEl.dataset.tone = 'danger';
      statusEl.textContent = err.message || String(err);
    });
}

// ── App grant consents (H-2) ─────────────────────
// Manage the scoped grant THIS user gave a (usually someone else's) app: see the granted scopes
// and revoke. Reuses the owner-authenticated /v1/app-grants list + delete; a dialog built on demand
// in the same shape as the template's, and removed again when it closes.
function closeConsents() {
  var d = document.getElementById('consents-overlay');
  if (!d) return;
  closeDlg(d);
  d.remove();
}
function openConsents(owner, filename, appName) {
  var target = bareOwnerName(owner) + '/' + filename;
  closeConsents();
  var dlg = document.createElement('dialog');
  dlg.id = 'consents-overlay';
  // The site's dialog frame (dialog.css + the set's poster-dialog), its content the set's parts.
  dlg.className = 'dlg modal dlg--md poster-dialog';
  dlg.setAttribute('data-dlg-guard', 'off');
  dlg.innerHTML = '<header class="dlg-head"><h2 class="dlg-title">' + escapeHtml(t('consents.title')) + '</h2><button type="button" class="dlg-close"></button></header>'
    + '<div class="dlg-body">'
    + stack({ density: 'normal' },
        text({ kind: 'mono', tone: 'muted' }, escapeHtml(appName || filename) + ' · ' + escapeHtml(target))
        + '<div id="consents-body">' + text({ kind: 'body', tone: 'muted' }, t('common.loading')) + '</div>')
    + '</div>'
    + '<footer class="dlg-foot">'
    + action({ kind: 'secondary', attrs: ' data-dlg-close' }, escapeHtml(t('common.close')))
    + action({ kind: 'secondary', tone: 'danger', attrs: ' id="consents-revoke-btn" hidden' }, escapeHtml(t('consents.revoke')))
    + '</footer>';
  document.body.appendChild(dlg);
  onDlgClose('consents-overlay', closeConsents);
  openDlg(dlg);
  subdomainApiCall('GET', '/v1/app-grants').then(function (json) {
    var grants = (json.data && json.data.grants) || [];
    var g = grants.filter(function (x) { return x.app === target; })[0];
    var body = document.getElementById('consents-body');
    if (!body) return;
    if (!g) { body.innerHTML = text({ kind: 'body', tone: 'muted' }, t('consents.none')); return; }
    // The granted scopes, one mono chip each: machine values, read as a list of facts.
    body.innerHTML = stack({ density: 'normal' },
      text({ kind: 'body' }, t('consents.granted'))
      + stack({ direction: 'wrap', align: 'start', density: 'compact' }, g.scopes.map(function (s) { return chip(escapeHtml(s)); }).join(''))
      + text({ kind: 'caption', tone: 'muted' }, t('consents.hint')));
    var revoke = document.getElementById('consents-revoke-btn');
    if (revoke) {
      revoke.onclick = function () { revokeConsent(g.grant_id); };
      revoke.hidden = false;
    }
  }).catch(function (e) {
    var body = document.getElementById('consents-body');
    if (body) body.innerHTML = text({ kind: 'body', tone: 'danger' }, escapeHtml(e.message || String(e)));
  });
}
function revokeConsent(grantId) {
  subdomainApiCall('DELETE', '/v1/app-grants/' + encodeURIComponent(grantId))
    .then(function () { closeConsents(); })
    .catch(function (e) { var b = document.getElementById('consents-body'); if (b) b.innerHTML = text({ kind: 'body', tone: 'danger' }, escapeHtml(e.message || String(e))); });
}

export {
  isOperatorSession,
  loadSubdomainSites,
  showSubdomainModal,
  submitSubdomainAssign,
  unassignSubdomain,
  closeConsents,
  openConsents,
  revokeConsent
};
