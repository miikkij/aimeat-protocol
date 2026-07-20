/**
 * @file render.js
 * @description The rendering + interaction core: tag bar (renderTags/filterByTag), the app grid
 *   (renderApps + buildLibraryEntries), Recently-Opened, launch (tab/iframe), the per-card context
 *   menu, View-Source / Share-as-Prompt / Generate-Homepage prompt outputs, and drag reordering.
 *   OWNS the server-derived shared state (serverStateByFilename / serverAppManifests / ownAppProtection
 *   / ownServerApps / currentIframeUrl) as live-binding exports; the browser-local app list + filter
 *   state (allApps/activeTag/searchQuery) stay main-owned and are read/written via initRender(deps).
 *   Carved from main.js.
 * @usage import { initRender, renderApps, renderTags, serverStateByFilename, setServerManifests } from './render.js'; initRender({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 12).
 *   v1.1.0 — 2026-07-16 — Card badges now reflect PUBLICATION state only (retire the
 *     "Server only" concept: a published no-local-copy app is "Listed vN", not "server").
 *     Add a Staging pill + split Open into "Open released" / "Open staging" when has_draft.
 *   v2.0.0 — 2026-07-20 — Server-only cutover: grid renders the owner's server apps only (no local
 *     merge), drop drag-reorder + Recently-Opened + the local-only card affordances + byte stats.
 */
import { escapeHtml, jsArg, sourceLabel, filterAttr, isSameOriginUrl } from './util.js';
import { getAllApps, saveApp, deleteApp } from './db.js';
import { showConfirm, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';
import { setEditingAppId, switchTab } from './apps-io.js';
import { openPromptBuilder } from './cortex.js';
import { openDetailView, openPublishedDetail } from './detail.js';
import { loadPublishedApps, showPublishModal, applyServerFilter } from './server-io.js';

// browser-local list + filter state stay main-owned; injected once via initRender at bootstrap.
let getMainApps, setAllApps, getActiveTag, setActiveTag, getSearchQuery;
export function initRender(deps) {
  ({ getMainApps, setAllApps, getActiveTag, setActiveTag, getSearchQuery } = deps);
}

// external writers (server-io, detail) set these owned vars through the setters.
export function setServerManifests(v) { serverAppManifests = v; }
export function setOwnServerApps(v) { ownServerApps = v; }
export function setIframeUrl(v) { currentIframeUrl = v; }

// ── Tag Rendering ─────────────────────────────────

function renderTags() {
  var tagBar = document.getElementById('tag-bar');
  var tagSet = {};
  var hasFavorites = false;

  for (var i = 0; i < getMainApps().length; i++) {
    var app = getMainApps()[i];
    if (app.favorite) hasFavorites = true;
    if (app.tags && app.tags.length) {
      for (var j = 0; j < app.tags.length; j++) {
        // Case-insensitive dedup — "Tools" and "tools" are one tag; first-seen casing wins.
        var lc = String(app.tags[j]).toLowerCase();
        if (!(lc in tagSet)) tagSet[lc] = app.tags[j];
      }
    }
  }

  var uniqueTags = Object.keys(tagSet).map(function (k) { return tagSet[k]; })
    .sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  var html = '';

  // "All" button
  html += '<button class="tag' + (getActiveTag() === null ? ' active' : '') + '" onclick="window._launcher.filterByTag(null)">' + t('tag.all') + '</button>';

  // Favorites button (only if any favorites exist)
  if (hasFavorites) {
    html += '<button class="tag' + (getActiveTag() === '__favorites__' ? ' active' : '') + '" onclick="window._launcher.filterByTag(\'__favorites__\')">' + t('tag.favorites') + '</button>';
  }

  // One button per unique tag
  for (var k = 0; k < uniqueTags.length; k++) {
    var tag = uniqueTags[k];
    html += '<button class="tag' + (getActiveTag() === tag ? ' active' : '') + '" onclick="window._launcher.filterByTag(\'' + jsArg(tag) + '\')">' + escapeHtml(tag) + '</button>';
  }

  tagBar.innerHTML = html;
}

// ── Tag Filtering ─────────────────────────────────

function filterByTag(tag) {
  setActiveTag(tag);
  renderApps();
  applyServerFilter();
}

// ── Launch App ──────────────────────────────────

function launchApp(id, mode) {
  var app = null;
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === id) { app = getMainApps()[i]; break; }
  }
  if (!app) return;

  app.lastOpenedAt = new Date().toISOString();
  saveApp(app).then(function () {
    if (mode === 'tab') {
      launchInTab(app);
    } else if (mode === 'iframe') {
      launchInIframe(app);
    }
  });
}


function launchInTab(app) {
  if (app.source === 'url' && app.url) {
    // Apex ?mode=inline URL → server serves inline (session inherited) or 301s to the
    // isolated app origin. Either way it opens TOP-LEVEL as a clean full page.
    window.open(app.url, '_blank', 'noopener');
  } else if (app.blob) {
    // A local blob app opened top-level would run on THIS origin (blob: URLs carry the creator's
    // origin) with full read access to our localStorage session — the H-2 vector the
    // isSameOriginUrl comment warns about. Run it in the sandboxed iframe (opaque origin) instead,
    // where it only gets what the postMessage bridge chooses to hand it.
    launchInIframe(app);
  }
}

// View a published app: open it TOP-LEVEL in a new tab (clean full page, no toolbar/X). The
// url is the apex ?mode=inline URL; the server serves it inline (session inherited) when the
// app origin is OFF, or 301s it to the isolated app origin when ON.
function viewPublished(url, name) {
  window.open(url, '_blank', 'noopener');
}

// Hide the "open in new tab" affordance whenever the framed content is same-origin
// (apex-hosted or blob) — opening it top-level would re-introduce H-2.
function updateOpenExternalBtn() {
  var btn = document.getElementById('iframe-external-btn');
  if (!btn) return;
  btn.style.display = (currentIframeUrl && !isSameOriginUrl(currentIframeUrl)) ? '' : 'none';
}

function launchInIframe(app) {
  var view = document.getElementById('iframe-view');
  var iframe = document.getElementById('app-iframe');
  var title = document.getElementById('iframe-title');

  title.textContent = app.name || 'App';
  iframe.dataset.appId = app.id;

  if (app.source === 'url' && app.url) {
    // URL apps are never framed. A cross-origin URL would leak the session token via the
    // postMessage auth bridge below; an apex ?mode=inline URL is blocked by the served app's
    // frame-ancestors CSP and shows "Sign in to continue" because the framed session never
    // propagates. Open the app TOP-LEVEL instead — the server serves it inline (session
    // inherited) or 301s to the isolated app origin, the same clean full page as viewPublished.
    window.open(app.url, '_blank', 'noopener');
    return;
  } else if (app.blob) {
    var html = decodeURIComponent(escape(atob(app.blob)));
    iframe.removeAttribute('src');
    iframe.srcdoc = html;
    currentIframeUrl = '';
  }

  updateOpenExternalBtn();
  view.hidden = false;
}

// ── Rendering ─────────────────────────────────────

// Cached own server apps (published + parked), refreshed by loadPublishedApps().
// renderApps() merges these with the local apps so each app shows as ONE unified card
// in the Kirjasto grid (no more Local + Published + Parked triplicate cards).
export let ownServerApps = [];

// filename -> authoritative server state { parked, forkable, forks, owner, versionNumber,
// protection }. Populated by buildLibraryEntries so the DETAIL view can offer the owner's
// server management (park/fork/protect/remove) that used to sit on the published card.
export let serverStateByFilename = {};
// filename -> current protection object, populated here as own cards render; the detail module
// (copy-protection modal) reads it via the injected getOwnProtection() getter.
export let ownAppProtection = {};
export let serverAppManifests = {}; // moved out of server-io: SSOT for the owner-app manifest cache (detail reads via getServerManifests)

// Status of a unified entry, for its badge. The badge shows the app's PUBLICATION
// state on the server — Listed / Unlisted / (browser-only) Local — NOT whether this
// browser happens to hold a local copy. A published app with no local twin (e.g.
// pushed via MCP/VSCode) is still "Listed vN", not a separate "server only" state;
// materialization of a local copy is an implementation detail the badge never surfaces.
function libStatus(e) {
  if (e.parked) return 'parked';        // on the server, hidden from the public catalogue
  if (e.published) return 'published';  // on the server, public in the catalogue
  return 'local';                       // a draft in this browser, not on the server yet
}
function libStatusLabel(e) {
  switch (libStatus(e)) {
    case 'parked':    return t('status.parked');
    case 'published': return t('status.published') + (e.versionNumber ? ' v' + e.versionNumber : '');
    default:          return t('status.local');
  }
}

// Merge local apps with the owner's server apps into ONE entry per app (deduped by the
// published filename). Local apps own favorites/drag-drop/openMode; the server copy supplies
// the authoritative published/parked/version state; a server app with no local twin becomes a
// read-only "server-only" entry.
function buildLibraryEntries(localApps, serverApps) {
  var base = (loadConfig().aimeatUrl || '').replace(/\/+$/, '');
  var byFilename = {};
  var entries = [];
  serverStateByFilename = {}; // rebuilt fresh each render
  for (var i = 0; i < localApps.length; i++) {
    var la = localApps[i];
    var e = {
      hasLocal: true, localId: la.id,
      name: la.name || la.filename || 'Untitled',
      icon: la.icon || '\u{1F4DD}',
      description: la.description || '',
      tags: la.tags || [],
      favorite: !!la.favorite, sortOrder: la.sortOrder, openMode: la.openMode || 'tab',
      source: la.source, origin: la.origin,
      aimeatOwner: la.aimeatOwner || null, aimeatFilename: la.aimeatFilename || null,
      addedAt: la.addedAt, lastOpenedAt: la.lastOpenedAt, blob: la.blob,
      published: !!la.published, parked: false, serverOnly: false, hasDraft: false,
      filename: la.publishedFilename || null, owner: null,
      versionNumber: la.publishedVersionNumber || null,
      viewUrl: la.publishedUrl ? (base + la.publishedUrl) : '',
      forkable: false, forks: 0
    };
    entries.push(e);
    if (e.filename) byFilename[e.filename] = e;
  }
  for (var s = 0; s < serverApps.length; s++) {
    var sa = serverApps[s];
    var fn = sa.filename || '';
    var prot = (sa.manifest && sa.manifest.protection) || {};
    // Agent-Bundled Apps: the card gets a 🤖 marker when the manifest declares crew-defs.
    var shipsAgent = !!(sa.manifest && sa.manifest.cortex && sa.manifest.cortex.agents && sa.manifest.cortex.agents.length);
    var m = fn ? byFilename[fn] : null;
    if (m) {
      m.parked = !!sa.parked;
      m.published = !sa.parked;
      m.owner = sa.owner || m.owner;
      m.versionNumber = sa.version_number || m.versionNumber;
      m.forkable = !!sa.forkable; m.forks = sa.forks || 0;
      m.hasDraft = !!sa.has_draft;
      m.hasAgents = shipsAgent;
      m.protection = prot;
      // EXACTLY what the old "View" used: the CONSTRUCTED served URL (aimeatUrl/v1/apps/<owner>/<file>),
      // NOT the local publishedUrl — so Open opens the app top-level on its origin (and it SSOs)
      // identically to the old published card's View button.
      m.viewUrl = base + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(fn);
      if (!m.description && sa.manifest && sa.manifest.description) m.description = sa.manifest.description;
    } else {
      var se = {
        hasLocal: false, localId: null,
        name: (sa.manifest && sa.manifest.name) || fn,
        icon: '\u{1F310}',
        description: (sa.manifest && sa.manifest.description) || '',
        tags: (sa.manifest && sa.manifest.tags) || [],
        favorite: false, sortOrder: undefined, openMode: 'tab',
        source: 'server', origin: null,
        aimeatOwner: sa.owner || null, aimeatFilename: fn,
        published: !sa.parked, parked: !!sa.parked, serverOnly: true, hasDraft: !!sa.has_draft,
        filename: fn, owner: sa.owner || '',
        versionNumber: sa.version_number || null,
        viewUrl: (base && fn) ? (base + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(fn)) : '',
        forkable: !!sa.forkable, forks: sa.forks || 0, protection: prot, hasAgents: shipsAgent
      };
      entries.push(se);
      if (fn) byFilename[fn] = se;
    }
    // Record authoritative server state so the detail view can manage this app.
    if (fn) {
      serverStateByFilename[fn] = {
        parked: !!sa.parked, forkable: !!sa.forkable, forks: sa.forks || 0,
        owner: sa.owner || '', versionNumber: sa.version_number || null, protection: prot,
        // `protected` is the ACCESS-CODE flag (distinct from copy-`protection`); the detail view's
        // access-code editor reads it to show whether the app currently requires a code.
        accessCode: !!sa.protected
      };
      ownAppProtection[fn] = prot;
    }
  }
  return entries;
}

function renderApps() {
  getAllApps().then(function (apps) {
    setAllApps(apps); // keep the transient working-set (openPublishedDetail materializes into it)

    // Server-only library: one entry per OWN server app (published + parked). No browser-local
    // apps exist anymore, so nothing local is merged in — the grid is purely the owner's server apps.
    var entries = buildLibraryEntries([], ownServerApps);

    // Sort: Listed (public) before Unlisted (parked); the server already returns each group
    // newest-first, so preserve that order within a group.
    entries.sort(function (a, b) {
      if (!!a.parked !== !!b.parked) return a.parked ? 1 : -1;
      return 0;
    });

    // Filter by getActiveTag()
    var filtered = entries;
    if (getActiveTag() === '__favorites__') {
      filtered = entries.filter(function (app) { return app.favorite; });
    } else if (getActiveTag() !== null) {
      var at = getActiveTag().toLowerCase();
      filtered = entries.filter(function (app) {
        return app.tags && app.tags.some(function (tg) { return String(tg).toLowerCase() === at; });
      });
    }

    // Filter by getSearchQuery()
    if (getSearchQuery()) {
      var q = getSearchQuery().toLowerCase();
      filtered = filtered.filter(function (app) {
        if (app.name && app.name.toLowerCase().indexOf(q) !== -1) return true;
        if (app.tags) {
          for (var i = 0; i < app.tags.length; i++) {
            if (String(app.tags[i]).toLowerCase().indexOf(q) !== -1) return true;
          }
        }
        return false;
      });
    }

    var grid = document.getElementById('app-grid');
    var localHeader = document.getElementById('local-apps-header');
    var localCount = document.getElementById('local-apps-count');
    if (localHeader) {
      localHeader.style.display = entries.length > 0 ? '' : 'none';
      if (localCount) localCount.textContent = '(' + entries.length + ')';
    }

    if (filtered.length === 0) {
      if (!getActiveTag() && !getSearchQuery() && entries.length === 0) {
        grid.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon">\u{1F680}</div>' +
            '<h3>' + t('empty.noApps') + '</h3>' +
            '<p>' + t('empty.noAppsDesc') + '</p>' +
            '<span class="empty-formats">' + t('empty.formats') + '</span>' +
          '</div>';
      } else {
        grid.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon">\u{1F50D}</div>' +
            '<h3>' + t('empty.noMatch') + '</h3>' +
            '<p>' + t('empty.noMatchDesc') + '</p>' +
          '</div>';
      }
    } else {
      var html = '';
      for (var j = 0; j < filtered.length; j++) {
        html += libraryCardHtml(filtered[j], j);
      }
      grid.innerHTML = html;
    }

    // Stats: app count only — the catalog is server-only, so there is no local footprint to report.
    var statsEl = document.getElementById('stats');
    statsEl.textContent = entries.length + ' ' + t('stats.apps');

    renderTags();
  });
}

// One unified card. hasLocal entries keep favorites/drag-drop/menu; server-only entries are
// read-only (open the published copy). Management (publish, park, fork, protect, versions,
// remove, consents) lives in the detail view — the card face stays to a status badge + two
// buttons (Open, Details).
function libraryCardHtml(e, i) {
  var idAttr = e.hasLocal ? escapeHtml(e.localId) : ('srv:' + escapeHtml(e.filename));
  // Detail routing: openPublishedDetail resolves a local twin itself; local-only -> openDetailView.
  var detailCall = (e.filename)
    ? 'window._launcher.openPublishedDetail(\'' + jsArg(e.owner || '') + '\', \'' + jsArg(e.filename) + '\', \'' + jsArg(e.hasLocal ? e.localId : '') + '\', ' + (e.versionNumber || 0) + ')'
    : 'window._launcher.openDetailView(\'' + jsArg(e.localId) + '\')';
  // Open: a PUBLISHED/PARKED/server app opens TOP-LEVEL on its served URL (clean full page on the
  // app origin) — like the old "View". Launching its local blob (a materialized twin) in the apex
  // sandbox iframe breaks app-origin apps (frame-ancestors CSP). Only a purely-local app launches
  // its local copy.
  var openCall = ((e.published || e.parked || e.serverOnly) && e.viewUrl)
    ? 'window._launcher.viewPublished(\'' + jsArg(e.viewUrl) + '?mode=inline\', \'' + jsArg(e.name) + '\')'
    : (e.hasLocal
        ? 'window._launcher.launchApp(\'' + jsArg(e.localId) + '\', \'' + jsArg(e.openMode || 'tab') + '\')'
        : detailCall);
  // When a staging draft exists the single "Open" splits into two labelled buttons so the
  // released version and the unpublished staging draft are never confused. openStagingPreview
  // mints a short-lived owner-only preview URL for the draft and opens it top-level.
  var stagingCall = 'window._launcher.openStagingPreview(\'' + jsArg(e.owner || '') + '\', \'' + jsArg(e.filename || '') + '\')';
  var openBtns = (e.hasDraft && e.viewUrl)
    ? '<button onclick="event.stopPropagation(); window._launcher.viewPublished(\'' + jsArg(e.viewUrl) + '?mode=inline\', \'' + jsArg(e.name) + '\')" title="' + escapeHtml(t('card.openReleasedHint')) + '">▶ ' + escapeHtml(t('card.openReleased')) + '</button>' +
      '<button class="act-staging" onclick="event.stopPropagation(); ' + stagingCall + '" title="' + escapeHtml(t('card.openStagingHint')) + '">⏫ ' + escapeHtml(t('card.openStaging')) + '</button>'
    : '<button onclick="event.stopPropagation(); ' + openCall + '" title="' + escapeHtml(t('card.openHint')) + '">▶ ' + escapeHtml(t('card.open')) + '</button>';
  var st = libStatus(e);
  var dragAttrs = e.hasLocal
    ? ' draggable="true" ondragstart="window._launcher.onCardDragStart(event)" ondragend="window._launcher.onCardDragEnd(event)" ondragover="window._launcher.onCardDragOver(event)" ondrop="window._launcher.onCardDrop(event)"'
    : '';
  var menuBtn = e.hasLocal
    ? '<button class="card-menu-btn" onclick="event.stopPropagation(); window._launcher.showContextMenu(event, \'' + jsArg(e.localId) + '\')" title="' + escapeHtml(t('common.menu')) + '">⋮</button>'
    : '';
  return '<div class="app-card' + (e.hasLocal ? '' : ' server-only') + '" data-id="' + idAttr + '"' + dragAttrs +
      filterAttr(e.name, e.tags) +
      ' onclick="' + detailCall + '"' +
      (e.hasLocal ? ' oncontextmenu="window._launcher.showContextMenu(event, \'' + jsArg(e.localId) + '\')"' : '') +
      ' style="animation-delay:' + (i * 0.04) + 's">' +
      '<span class="app-status-badge st-' + st + '">' + escapeHtml(libStatusLabel(e)) + '</span>' +
      (e.hasDraft ? '<span class="app-staging-badge" title="' + escapeHtml(t('card.stagingHint')) + '">' + escapeHtml(t('card.stagingBadge')) + '</span>' : '') +
      menuBtn +
      '<div class="app-icon">' + escapeHtml(e.icon || '\u{1F4DD}') + '</div>' +
      '<div class="app-name">' + escapeHtml(e.name) +
        (e.origin === 'ai-published' ? ' <span class="ai-origin-badge">AI</span>' : '') +
        (e.hasAgents ? ' <span class="pcb-agent" title="' + escapeHtml(t('card.agentHint')) + '">\u{1F916}</span>' : '') + '</div>' +
      (e.description
        ? '<div class="app-source">' + escapeHtml(e.description) + '</div>'
        : '<div class="app-source">' + sourceLabel(e.source) + '</div>') +
      '<div class="app-actions">' +
        openBtns +
        '<button onclick="event.stopPropagation(); ' + detailCall + '">' + escapeHtml(t('ctx.details')) + '</button>' +
      '</div>' +
      (e.favorite ? '<span class="fav-star visible">⭐</span>' : '') +
    '</div>';
}

// ── Iframe helpers ────────────────────────────────

export let currentIframeUrl = '';

function closeIframe() {
  var view = document.getElementById('iframe-view');
  var iframe = document.getElementById('app-iframe');
  view.hidden = true;
  iframe.removeAttribute('src');
  iframe.removeAttribute('srcdoc');
  delete iframe.dataset.appId;
  currentIframeUrl = '';
}

function openExternal() {
  // H-2: only ever open genuinely cross-origin app URLs top-level. Same-origin (apex)
  // or blob content stays sandboxed in the iframe — opening it top-level would let it
  // read the visitor's aimeat.io session.
  if (currentIframeUrl && !isSameOriginUrl(currentIframeUrl)) {
    window.open(currentIframeUrl, '_blank', 'noopener');
  }
}

// ── Context Menu ────────────────────────────────

var contextAppId = null;

function showContextMenu(event, id) {
  if (event.preventDefault) event.preventDefault();
  if (event.stopPropagation) event.stopPropagation();
  contextAppId = id;

  var menu = document.getElementById('context-menu');
  // Reveal off-screen first so we can measure the REAL height — the menu has
  // a variable number of items (Edit, Favorite, Open mode, Source, Improve,
  // Share, Publish, Delete…), so a hardcoded estimate overflowed the viewport
  // and pushed the lower actions out of reach.
  menu.style.left = '-9999px';
  menu.style.top = '0px';
  menu.hidden = false;

  // offsetWidth/Height give the true layout size and ignore the cardIn entry
  // animation's transform: scale() (getBoundingClientRect would under-measure
  // mid-animation and let the menu spill off the bottom edge).
  var menuWidth = menu.offsetWidth || 200;
  var menuHeight = menu.offsetHeight || 160;
  var margin = 8;
  var vw = window.innerWidth;
  var vh = window.innerHeight;

  var x = (event.clientX != null) ? event.clientX : 0;
  var y = (event.clientY != null) ? event.clientY : 0;

  // Clamp horizontally within the viewport.
  if (x + menuWidth + margin > vw) x = vw - menuWidth - margin;
  if (x < margin) x = margin;

  // Clamp vertically: pin to the bottom edge if it would overflow below,
  // and never let the top go above the viewport. (Combined with the
  // max-height in CSS, a menu taller than the screen scrolls instead.)
  if (y + menuHeight + margin > vh) y = vh - menuHeight - margin;
  if (y < margin) y = margin;

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
}

function hideContextMenu() {
  var menu = document.getElementById('context-menu');
  menu.hidden = true;
  contextAppId = null;
}

async function handleContextAction(action) {
  if (!contextAppId) return;
  var appId = contextAppId;
  hideContextMenu();

  var app = null;
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === appId) { app = getMainApps()[i]; break; }
  }
  if (!app) return;

  switch (action) {
    case 'details':
      openDetailView(appId);
      break;

    case 'edit':
      // Server-only: editing an app's name/description/icon/tags is done in the detail view
      // ("Edit details"); route there instead of the old local Add/Edit modal.
      openDetailView(appId);
      break;

    case 'favorite':
      app.favorite = !app.favorite;
      saveApp(app).then(function () {
        renderApps();
      });
      break;

    case 'view-source':
      viewSource(app);
      break;

    case 'delete':
      if (await showConfirm(t('confirm.deleteApp').replace('{name}', function () { return app.name || 'this app'; }))) {
        deleteApp(appId).then(function () {
          renderApps();
          loadPublishedApps();
        });
      }
      break;

    case 'publish':
      showPublishModal(appId);
      break;

    case 'improve-ai':
      openPromptBuilder(app);
      break;

    case 'share-prompt':
      generateSharePrompt(app);
      break;
  }
}

// ── View Source ──────────────────────────────────

function viewSource(app) {
  var overlay = document.getElementById('source-overlay');
  var textarea = document.getElementById('source-code');
  var title = document.getElementById('source-title');
  var saveBtn = document.getElementById('save-source-btn');

  title.textContent = 'View / Edit Source: ' + (app.name || 'App');

  var isEditable = !!app.blob; // Only blob-based apps can be edited
  if (app.blob) {
    textarea.value = decodeURIComponent(escape(atob(app.blob)));
  } else if (app.url) {
    textarea.value = '// This app is URL-based (' + app.url + ')\n// Source code is not stored locally.\n// Open the URL to view the app.';
  } else {
    textarea.value = '// No source available';
  }

  textarea.readOnly = !isEditable;
  saveBtn.disabled = true;
  saveBtn.style.display = isEditable ? '' : 'none';
  // Real-origin staging (Test on real origin / Publish tested version) needs a PUBLISHED
  // app (server draft slot). Show those buttons only then; hide for local-only / URL apps.
  var canStage = isEditable && !!app.published;
  var testLiveBtn = document.getElementById('source-test-live-btn');
  var pubTestedBtn = document.getElementById('source-publish-tested-btn');
  if (testLiveBtn) testLiveBtn.hidden = !canStage;
  if (pubTestedBtn) pubTestedBtn.hidden = !canStage;
  var stageStatus = document.getElementById('source-draft-status');
  if (stageStatus) stageStatus.textContent = '';
  overlay.hidden = false;
  // Store app metadata for save and prompt
  overlay.dataset.appName = app.name || 'App';
  overlay.dataset.appId = app.id || '';
  overlay.dataset.originalSource = textarea.value;
}

// ── Share as Prompt ────────────────────────────

function generateSharePrompt(app) {
  if (!app || !app.blob) {
    showNotice('Only local HTML apps can be shared as prompts.');
    return;
  }

  var source = decodeURIComponent(escape(atob(app.blob)));
  var prompt = 'Recreate this HTML app exactly as provided.\n\n';
  prompt += 'App name: ' + (app.name || 'Untitled') + '\n';
  if (app.tags && app.tags.length) {
    prompt += 'Tags: ' + app.tags.join(', ') + '\n';
  }
  prompt += '\nReturn the COMPLETE HTML file below without modifications.\n';
  prompt += 'If the user asks for changes, apply them to this source.\n\n';
  prompt += '--- Source Code ---\n' + source;

  navigator.clipboard.writeText(prompt).then(function() {
    showNotice('Share prompt copied! Paste it into any AI chat to recreate this app.');
  }).catch(function() {
    // Fallback: show in source overlay
    var overlay = document.getElementById('source-overlay');
    var textarea = document.getElementById('source-code');
    var title = document.getElementById('source-title');
    var saveBtn = document.getElementById('save-source-btn');
    title.textContent = 'Share Prompt: ' + (app.name || 'App');
    textarea.value = prompt;
    textarea.readOnly = true;
    saveBtn.style.display = 'none';
    overlay.hidden = false;
    overlay.dataset.appId = '';
    overlay.dataset.originalSource = '';
  });
}

// ── Generate Homepage Prompt ──────────────────────

function generateHomepagePrompt() {
  if (getMainApps().length === 0) {
    showNotice('Add some apps first before generating a homepage.');
    return;
  }

  var appList = getMainApps().map(function(app) {
    var launchInfo = '';
    if (app.url) {
      launchInfo = 'URL: ' + app.url;
    } else {
      launchInfo = 'Local HTML app (user will open it from their launcher)';
    }
    return '- ' + (app.icon || '') + ' ' + app.name +
      (app.description ? ' (' + app.description + ')' : '') +
      ' [' + launchInfo + ']' +
      (app.tags.length ? ' Tags: ' + app.tags.join(', ') : '');
  }).join('\n');

  var prompt = 'Create a single HTML file that serves as my personal homepage/dashboard.\n\n' +
    'My apps:\n' + appList + '\n\n' +
    'Requirements:\n' +
    '- Show each app as a clickable card with its icon and name\n' +
    '- For URL-based apps, clicking opens the URL in a new tab\n' +
    '- For local apps, show a note that they can be opened from the App Launcher\n' +
    '- Modern, responsive design with light theme\n' +
    '- Group apps by their tags if they have tags\n' +
    '- Everything in one self-contained HTML file, no external dependencies\n' +
    '- Add a header with my name/title (I will customize this)\n' +
    '- Make it visually distinctive and professional';

  // Reuse the source overlay for displaying the prompt
  var overlay = document.getElementById('source-overlay');
  var textarea = document.getElementById('source-code');
  var title = document.getElementById('source-title');

  title.textContent = 'Generate Homepage - Copy this prompt to AI';
  textarea.value = prompt;
  overlay.dataset.appName = 'Homepage';
  overlay.hidden = false;
}

export {
  renderTags,
  filterByTag,
  launchApp,
  launchInTab,
  viewPublished,
  launchInIframe,
  renderApps,
  closeIframe,
  openExternal,
  showContextMenu,
  hideContextMenu,
  handleContextAction,
  viewSource,
  generateSharePrompt,
  generateHomepagePrompt
};
