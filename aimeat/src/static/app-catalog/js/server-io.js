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
 *   v2.3.0 — 2026-09-13 — The consents dialog's title is an h2, so it wears the dialog slab like
 *     every other dialog title; its target line takes a class instead of an inline style.
 *   v2.3.1 — 2026-09-13 — The consents overlay's layout moves to the stylesheet (#consents-overlay),
 *     so it scrolls like every other dialog instead of centring past the top of a short screen.
 *   v2.4.0 — 2026-09-13 — Publish, subdomain, backup and consents are the site's one dialog
 *     (dialogs.js). The consents dialog is built as a <dialog> with header, body and footer, and
 *     Revoke moves from the body into the footer.
 *   v2.0.0 — 2026-08-28 — The showroom skin: community and favourites render as rows (rows.js),
 *     favourites is a third view of its own, the header's sort order applies to both lists, and
 *     the rail reads getCommunityApps / getFavoriteServerApps for its tag counts.
 *   v2.1.0 — 2026-08-28 — The poster face: rows are numbered index lines with a panel (the doors
 *     as a slab and underlined words, one line about who published it and when); a filtered-out
 *     row's panel hides with it.
 *   v2.3.0 — 2026-09-03 — getServerAppRow(owner, filename): the server's own row for one app, for the detail's Needs section.
 *   v2.5.0 — 2026-09-22 — Drawn from the site's one set (parts-html.js): the consents dialog, the
 *     backup selection (a Table with Field checkboxes and selects, chips for new and existing) and
 *     its result are the set's parts; a status line takes a tone (data-tone) instead of a hex colour;
 *     the menu's view rows sit on the sun through data-selected; sections, empty states and the
 *     restore and unassign buttons show and hide with `hidden`; the agent and fork markers are a chip
 *     and a word instead of emoji and a glyph; a filter hides a row's wrapper (rows.js). The
 *     subdomain and consent group moves to grants-io.js and the backup group to backup-io.js by pure
 *     extraction (the file was past the line ceiling); both are re-exported from here.
 */
import { escapeHtml, jsArg, sameOwner, filterAttr } from './util.js';
import { getAllApps, saveApp } from './db.js';
import { showConfirm, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t, getLang } from './i18n.js';
import { closeModal } from './apps-io.js';
import { getCortexOwnerToken } from './cortex.js';
import { fetchAppContentBase64, refreshServerMgmt } from './detail.js';
import { favStarHtml, isFavorite, loadFavorites } from './favorites.js';
import { rowHtml, toggleRow, fmtDate } from './rows.js';
import { loadPromoted } from './promote.js';
import { openDlg, closeDlg } from './dialogs.js';
import { action, chip } from './parts-html.js';
// Two groups live in their own files (pure extraction, 2026-09-22); every name is re-exported below.
import { isOperatorSession, loadSubdomainSites, showSubdomainModal, submitSubdomainAssign, unassignSubdomain, closeConsents, openConsents, revokeConsent } from './grants-io.js';
import { setBackupRefresh, exportBackupZip, importBackupPick, importBackupFile, backupUpdateSummary, backupSelectAll, submitBackupRestore } from './backup-io.js';

// Injected once at bootstrap by main.js: read getters + write setters for the shared app-state
// (which stays main-owned), plus a few main-local fns.
let getMainApps, getServerState, getServerManifests, setServerManifests, getOwnServerApps, setOwnServerApps, getActiveTag, getSearchQuery, getSortMode, generateId, renderApps, refreshAll, setListingLoaded, isListingLoaded, setBoundSkillApps;
export function initServerIo(deps) {
  ({ getMainApps, getServerState, getServerManifests, setServerManifests, getOwnServerApps, setOwnServerApps, getActiveTag, getSearchQuery, getSortMode, generateId, renderApps, refreshAll, setListingLoaded, isListingLoaded, setBoundSkillApps } = deps);
  setBackupRefresh(refreshAll);
}

// Cache of the last full server-app list (own + community) + base URL, so a favourite toggle can
// re-render the favourites view + all star states without a network round-trip.
let lastAllServerApps = [];

/** The server's own row for one app (owner + filename), as the last listing returned it; null if unlisted. */
function getServerAppRow(owner, filename) {
  for (var i = 0; i < (lastAllServerApps || []).length; i++) {
    var sa = lastAllServerApps[i];
    if (sameOwner(sa.owner, owner) && sa.filename === filename) return sa;
  }
  return null;
}
let lastCommunityApps = [];
let lastAimeatUrl = '';

/** The community and favourites lists, read by the rail for its tag counts. */
function getCommunityApps() { return lastCommunityApps; }
function getFavoriteServerApps() {
  return (lastAllServerApps || []).filter(function (sa) { return isFavorite((sa.owner || '') + '/' + (sa.filename || '')); });
}

/** The header's order, applied to a server-app list: newest keeps the server's order. */
function sortServerApps(list) {
  var mode = getSortMode ? getSortMode() : 'newest';
  if (mode === 'opens') list.sort(function (a, b) { return (b.downloads || 0) - (a.downloads || 0); });
  else if (mode === 'name') {
    var nm = function (sa) { return String((sa.manifest && sa.manifest.name) || sa.filename || ''); };
    list.sort(function (a, b) { return nm(a).localeCompare(nm(b), undefined, { sensitivity: 'base' }); });
  }
  return list;
}

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
    pubStatus.dataset.tone = 'coral';
    pubSubmit.disabled = true;
  } else {
    pubStatus.textContent = '';
    pubSubmit.disabled = false;
  }
  openDlg('publish-overlay');
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
    statusEl.dataset.tone = 'coral';
    return;
  }

  if (accessCode && (accessCode.length < 4 || accessCode.length > 64)) {
    statusEl.textContent = 'Access code must be 4-64 characters.';
    statusEl.dataset.tone = 'coral';
    return;
  }

  // Description is required for a NEW app (the server enforces it too); on a republish the server
  // carries the existing one forward when omitted.
  var description = document.getElementById('publish-description').value.trim();
  if (!description && !app.published) {
    statusEl.textContent = 'A description is required for a new app. Write 1-2 sentences (your AI can write it).';
    statusEl.dataset.tone = 'coral';
    return;
  }
  app.description = description;

  // Get the HTML content
  var htmlContent = '';
  if (app.blob) {
    htmlContent = app.blob; // already base64
  } else if (app.url) {
    statusEl.textContent = 'Cannot publish URL-linked apps. Download it first (right-click \u2192 View Source \u2192 Save).';
    statusEl.dataset.tone = 'coral';
    return;
  } else {
    statusEl.textContent = 'No app content found.';
    statusEl.dataset.tone = 'coral';
    return;
  }

  // Publishing to AIMEAT REQUIRES a signed-in owner. This is the gate that stops
  // anonymous apps from ever reaching the node — there is NO fallback to an
  // anonymous token. If not signed in, point the user at the top-bar sign-in.
  var token = getCortexOwnerToken();
  if (!token) {
    statusEl.textContent = t('publish.loginRequired');
    statusEl.dataset.tone = 'coral';
    submitBtn.disabled = false;
    return;
  }

  statusEl.textContent = 'Publishing...';
  statusEl.dataset.tone = 'success';
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
        statusEl.textContent = '\u2713 Published! ' + (json.data.download_url || '');
        statusEl.dataset.tone = 'success';
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
            statusEl.textContent = '\u2713 ' + (t('publish.savedUnlisted') || 'Saved (unlisted)');
            try { toggleParkApp(filename, true); } catch (e) { /* park is best-effort */ }
          }
          publishUnlisted = false;
          loadPublishedApps();
          // Close the modal shortly after showing success \u2014 otherwise it dead-ends with a
          // disabled button and the user isn't sure the publish took.
          setTimeout(function () {
            closeDlg('publish-overlay');
            submitBtn.disabled = false;
          }, 1400);
        });
      } else {
        statusEl.textContent = '\u2717 ' + ((json.error && json.error.message) || 'Publish failed');
        statusEl.dataset.tone = 'coral';
        submitBtn.disabled = false;
      }
    })
    .catch(function(err) {
      statusEl.textContent = '\u2717 ' + (err.message || 'Publish failed');
      statusEl.dataset.tone = 'coral';
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
  grid.hidden = !communityVisible;
  arrow.textContent = communityVisible ? '↓' : '→';
  arrow.setAttribute('aria-expanded', communityVisible ? 'true' : 'false');
}

// ── Two views: Kirjasto (your apps: local + published + parked) / Yhteisö (community) ──
// Sections carry data-view; body[data-active-view] hides the inactive one via CSS.
function switchView(view) {
  if (view !== 'community' && view !== 'favorites') view = 'library';
  document.body.setAttribute('data-active-view', view);
  var names = ['library', 'community', 'favorites'];
  for (var i = 0; i < names.length; i++) {
    // The menu's view rows: the chosen one on the sun (the row's data-selected, as ListRow emits it).
    var el = document.getElementById('view-tab-' + names[i]);
    if (!el) continue;
    el.setAttribute('aria-selected', view === names[i] ? 'true' : 'false');
    var row = el.closest('article');
    if (row) row.setAttribute('data-selected', view === names[i] ? 'yes' : 'no');
  }
  try { localStorage.setItem('appCatalogView', view); } catch (e) { /* private mode */ }
  updateCommunityEmpty();
  updateFavoritesEmpty();
  // The rail's tags count the list on screen, so a view change re-counts them.
  if (renderApps) renderApps();
}

// The favourites view says why it is empty instead of showing an empty box.
function updateFavoritesEmpty() {
  var empty = document.getElementById('favorites-empty');
  var grid = document.getElementById('favorites-grid');
  if (!empty || !grid) return;
  empty.hidden = grid.children.length > 0;
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
  if (loading) loading.hidden = !waiting;
  empty.hidden = !(!hasApps && inCommunity && !waiting);
}

// Owner-match: an app belongs to the logged-in user when the bare owner names
// match, regardless of whether either side carries a `@node` suffix. Legacy
// publish paths stored ownerName as the full GHII, so an exact string compare
// wrongly dumped the user's own apps into "Community".

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
  var trigger = document.getElementById('backup-btn');
  if (trigger) trigger.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
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

// Active Extensions bar: the set's fold, closed by default, opening in place (declutters Library).
function toggleCortexBar() {
  var body = document.getElementById('cortex-bar-body');
  var arrow = document.getElementById('cortex-bar-arrow');
  if (!body) return;
  var open = body.hidden;
  body.hidden = !open;
  if (arrow) arrow.textContent = open ? '↓' : '→';
  var fold = document.getElementById('cortex-bar-fold');
  if (fold) fold.setAttribute('data-open', open ? 'yes' : 'no');
  var toggle = document.getElementById('cortex-bar-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
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
      if (communitySection) communitySection.hidden = true;
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
        lastCommunityApps = communityApps;
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
          // The "no skill" condition row: which apps a skill is bound to, from the owner's own skill
          // list in ONE read. Fetched after the grid is up, so a slow or refused read only delays
          // that one row; the grid re-renders when it lands.
          if (currentOwner && listTok) {
            fetch(aimeatUrl + '/v1/skills?scope=user', { headers: listHeaders })
              .then(function (resp) { return resp.ok ? resp.json() : null; })
              .then(function (json) {
                var skills = (json && json.data && (json.data.skills || json.data)) || [];
                var bound = {};
                for (var si = 0; si < skills.length; si++) {
                  var b = (skills[si].metadata && skills[si].metadata.binding) || skills[si].binding || '';
                  if (b.indexOf('app:') === 0) bound[b.slice(4)] = true;
                }
                setBoundSkillApps(bound);
                renderApps();
              })
              .catch(function () { setBoundSkillApps({}); });
          }
        });
      })
      .catch(function() {
        // A failed fetch has still FINISHED: leaving the spinner up would promise a result that is
        // not coming. The grid falls back to its empty state.
        setListingLoaded(true);
        setOwnServerApps([]);
        renderApps();
        if (communitySection) communitySection.hidden = true;
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
  var grids = ['community-grid', 'favorites-grid'];
  for (var g = 0; g < grids.length; g++) {
    var grid = document.getElementById(grids[g]);
    if (!grid) continue;
    // Each row sits in a plain wrapper that carries the search attributes (rows.js); the wrapper
    // hides, and with it the row and its doors. A hidden row is never left open.
    var rows = grid.querySelectorAll('[data-app-row]');
    var shown = 0;
    rows.forEach(function (row) {
      var match = true;
      if (at === '__favorites__') { match = false; } // favorites is a Local-only filter
      else if (at !== null) {
        match = (',' + (row.getAttribute('data-tags') || '') + ',').indexOf(',' + at.toLowerCase() + ',') !== -1;
      }
      if (match && q) match = (row.getAttribute('data-filter') || '').indexOf(q) !== -1;
      row.hidden = !match;
      if (!match && row.firstElementChild && row.firstElementChild.getAttribute('data-selected') === 'yes') toggleRow(row);
      if (match) shown++;
    });
    if (grids[g] === 'community-grid' && rows.length) {
      var countEl = document.getElementById('community-count');
      if (countEl) countEl.textContent = String(shown);
      var sectionEl = document.getElementById('community-section');
      if (sectionEl) sectionEl.hidden = filtering && shown === 0;
    }
  }
}

// One published-app ROW (used by BOTH the Community list and the Favourites view). Carries a
// favourite toggle + a description localized to the current UI language; rows.js draws it.
function publishedRowHtml(sa, aimeatUrl, index) {
  var owner = sa.owner || '';
  var fn = sa.filename || '';
  var ref = owner + '/' + fn;
  var m = sa.manifest || {};
  var name = m.name || fn;
  var description = (m.descriptions && m.descriptions[getLang()]) || m.description || '';
  var author = m.authorDisplay || owner;
  var viewUrl = aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(fn);
  // Agent-Bundled Apps: this app ships its own agent(s) — mark it and offer the Bundled-agents modal.
  var shipsAgent = !!(m.cortex && m.cortex.agents && m.cortex.agents.length);
  var detailCall = 'window._launcher.openPublishedDetail(\'' + jsArg(owner) + '\', \'' + jsArg(fn) + '\', \'\', ' + (sa.version_number || 0) + ')';
  var actions = [{ label: t('card.view'), onclick: 'window._launcher.viewPublished(\'' + jsArg(viewUrl) + '?mode=inline\', \'' + jsArg(name) + '\')', kind: 'slab' }];
  // Fork is offered on a community app only when its owner marked it forkable.
  if (sa.forkable) actions.push({ label: t('card.fork'), onclick: 'window._launcher.forkVersion(\'' + jsArg(owner) + '\', \'' + jsArg(fn) + '\', ' + (sa.version_number || 0) + ')', title: t('card.forkHint'), kind: 'word' });
  if (shipsAgent) actions.push({ label: t('card.agent'), onclick: 'window._launcher.showAppAgentsModal(\'' + jsArg(owner) + '\', \'' + jsArg(fn) + '\')', title: t('card.agentHint'), kind: 'word' });
  actions.push({ label: t('card.details'), onclick: detailCall, title: t('ctx.details'), kind: 'word' });
  var metaParts = [author];
  if (sa.version_number) metaParts.push('v' + sa.version_number);
  var when = fmtDate(sa.created_at); if (when) metaParts.push(when);
  // The agent marker is a chip; the fork count is a word that opens the lineage (its own button,
  // so it does not open the row).
  var nameExtra = (shipsAgent ? ' ' + chip(escapeHtml(t('card.agent')), 'plain', t('card.agentHint')) : '') +
    ((sa.forks && sa.forks > 0)
      ? ' ' + action({ kind: 'text', title: t('card.forksHint'),
          onclick: 'event.stopPropagation(); window._launcher.showLineageModal(\'' + jsArg(owner) + '\', \'' + jsArg(fn) + '\')' },
          escapeHtml(t('lineage.title')) + ' ' + sa.forks)
      : '');
  return rowHtml({
    n: index + 1, icon: sa.icon || m.icon || '\u{1F4DD}', name: name, nameExtra: nameExtra, favStar: favStarHtml(ref),
    meta: metaParts.join(' · '), desc: description,
    state: sa.parked ? 'unlisted' : 'listed', draft: false,
    opens: (typeof sa.downloads === 'number') ? sa.downloads : null,
    tags: m.tags || [], actions: actions,
    line: t('row.lineBy').replace('{owner}', author).replace('{date}', when || '')
  });
}

function renderCommunityApps(serverApps, aimeatUrl, section, grid, countEl, currentOwner) {
  if (!section || !grid || !countEl) return;
  if (serverApps.length === 0) {
    section.hidden = true;
    grid.innerHTML = '';
    updateCommunityEmpty();
    return;
  }
  section.hidden = false;
  countEl.textContent = String(serverApps.length);
  var railCount = document.getElementById('rail-count-community');
  if (railCount) railCount.textContent = String(serverApps.length);
  var list = sortServerApps(serverApps.slice());
  var html = '';
  for (var i = 0; i < list.length; i++) html += publishedRowHtml(list[i], aimeatUrl, i);
  grid.innerHTML = html;
  updateCommunityEmpty();
}

// The Favourites view: apps the owner starred, drawn from the FULL server-app list (own +
// community). Its own view since 2026-08-28; empty, it says why.
function renderFavorites(allServerApps, aimeatUrl) {
  var section = document.getElementById('favorites-section');
  var grid = document.getElementById('favorites-grid');
  var countEl = document.getElementById('favorites-count');
  if (!section || !grid) return;
  var favs = getFavoriteServerApps();
  var railCount = document.getElementById('rail-count-favorites');
  if (railCount) railCount.textContent = String(favs.length);
  if (countEl) countEl.textContent = String(favs.length);
  if (favs.length === 0) { grid.innerHTML = ''; updateFavoritesEmpty(); return; }
  var list = sortServerApps(favs.slice());
  var html = '';
  for (var i = 0; i < list.length; i++) html += publishedRowHtml(list[i], aimeatUrl, i);
  grid.innerHTML = html;
  updateFavoritesEmpty();
}

// Re-render the community and favourites lists from the cached listing — no re-fetch. The rail
// calls this after a sort change; a favourite toggle calls refreshFavoritesUI, which adds the
// owner's own rows (their stars).
function rerenderServerLists() {
  renderFavorites(lastAllServerApps, lastAimeatUrl);
  renderCommunityApps(lastCommunityApps, lastAimeatUrl,
    document.getElementById('community-section'), document.getElementById('community-grid'),
    document.getElementById('community-count'), null);
  applyServerFilter();
}

// Re-render everything that shows a star (own list, community list, favourites view) from the
// cached list after a favourite toggle. Called by the _launcher.toggleFavorite handler.
function refreshFavoritesUI() {
  rerenderServerLists();
  renderApps(); // own-list stars
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
  rerenderServerLists,
  getCommunityApps,
  getServerAppRow,
  getFavoriteServerApps,
  applyServerFilter,
  unpublishApp,
  toggleParkApp,
  toggleForkApp,
  deleteServerApp
};
