/**
 * @file main.js
 * @description App-catalog entry module (bundled by scripts/build-app-catalog.ts into the
 *   served src/static/app-catalog.html). Holds catalog state, rendering, actions, and the
 *   window._launcher handler surface consumed by inline onclick in the markup. Carved from
 *   the former single inline <script>; further modules are split out incrementally.
 * @structure  imports (i18n data) → state → db → api → render → actions → window._launcher → init
 * @usage  built, not loaded raw: pnpm build:app-catalog
 */
import { t, getLang, setLang, applyI18n } from './i18n.js';
import { escapeHtml, jsArg, sourceLabel, sourceLabelText, bareOwnerName, sameOwner, filterAttr, isSameOriginUrl, currentOwnerName } from './util.js';
import { getAllApps, saveApp, deleteApp, openDB, getDbName, getDbMode, setDbMode, closeDbInstance } from './db.js';
import { showConfirm, closeConfirm, showNotice, dismissNotice, dtlBtn } from './ui.js';
import { loadConfig, saveConfig } from './config.js';
import { extractZip, bundleZip } from './zip.js';
import { initDetail, refreshServerMgmt, openDetailView, editAppDetails, closeDetailView, detailLaunch, mountLoginPill, detailAboutEdit, detailAboutCancel, detailAboutSave, detailSetScreenshot, detailRefreshScreenshot, detailAiRun, detailAiTest, detailAiKeep, detailAiDiscard, detailEditSource, detailImproveExternal, detailSharePrompt, detailPublish, detailDelete, openPublishedDetail, fetchAppContentBase64, showLineageModal, showProtectionModal, saveProtection, showVersionsModal, restoreVersion, forkVersion } from './detail.js';
import { loadCortexExtensions, showCortexPopup, cortexCopy, getCortexOwnerToken, openCortexEditor, cortexEditorAddLib, cortexEditorSave, cortexEditorExport, closeCortexEditor, openPromptBuilder, closePbPanel, buildPromptFromBuilder, updatePbPreview } from './cortex.js';
import { initSettings, applyTheme, updateThemeToggle, toggleTheme, getThemePref, openSettings, saveSettings, syncConfigToServer, loadConfigFromServer, closeSettings, openHelp, closeHelp, exportBackup, handleImportBackup, jsonImportSelectAll, submitJsonImport, removeDuplicateApps, clearAllData } from './settings.js';
import { initAppsIo, setEditingAppId, addAppFromZip, addAppFromUrl, addAppFromFile, addAppFromSource, showModal, requireSignInThen, parseAppMeta, closeModal, switchTab, handleFileDrop, handleSave } from './apps-io.js';
import { initServerIo, importFromAimeat, processAimeatImport, showPublishModal, submitPublish, toggleCommunity, switchView, showSubdomainModal, submitSubdomainAssign, unassignSubdomain, closeConsents, openConsents, revokeConsent, toggleBackupMenu, toggleCreateMenu, closeCreateMenu, toggleCortexBar, exportBackupZip, importBackupPick, importBackupFile, backupUpdateSummary, backupSelectAll, submitBackupRestore, addImportIgnore, removeImportIgnore, dismissServerImportBanner, showServerImportModal, serverImportSelectAll, submitServerImport, loadPublishedApps, applyServerFilter, unpublishApp, toggleParkApp, toggleForkApp, deleteServerApp } from './server-io.js';


  // ── i18n (en / fi) ─────────────────────────────────
  // Standalone catalogue page: its own translation table + picker, independent
  // of the SPA. Static chrome is annotated with data-i18n / data-i18n-ph /
  // data-i18n-title; JS-rendered strings use t(). Dynamic app data (names,
  // tags) is user content and stays as-is.
  // t() / getLang / setLang / applyI18n live in i18n.js (imported above). setLanguage stays here
  // because it also persists the choice to config and re-renders every dynamic section.
  function setLanguage(lang) {
    setLang(lang);
    try { var config = loadConfig(); config.language = getLang(); saveConfig(config); } catch (e) {}
    applyI18n();
    // Re-render dynamic sections so JS-built strings pick up the new language.
    try { renderApps(); } catch (e) {}
    try { renderTags(); } catch (e) {}
    try { loadPublishedApps(); } catch (e) {}
    try { renderRecentlyOpened(); } catch (e) {}
    try { loadCortexExtensions(); } catch (e) {}
    try { mountLoginPill(); } catch (e) {}  // re-render the golden pill in the new language
  }

  function switchDbMode(mode) {
    if (mode === getDbMode()) return;
    // Personal mode is per-account and meaningless without a session — it would silently show the
    // shared Global DB (the "my apps vanished when I changed browser" confusion). Require sign-in
    // first, keeping the toggle on the current mode until the user actually signs in.
    if (mode === 'personal' && !currentOwnerName()) {
      updateModeToggle();
      requireSignInThen(function () { switchDbMode('personal'); });
      return;
    }
    setDbMode(mode);
    closeDbInstance();
    updateModeToggle();
    refreshAll();
  }

  function updateModeToggle() {
    var globalBtn = document.getElementById('mode-global');
    var personalBtn = document.getElementById('mode-personal');
    if (!globalBtn || !personalBtn) return;
    globalBtn.classList.toggle('active', getDbMode() === 'global');
    personalBtn.classList.toggle('active', getDbMode() === 'personal');
    // Personal needs a session — dim it and explain via the title when logged out.
    var signedIn = !!currentOwnerName();
    personalBtn.classList.toggle('mode-btn-locked', !signedIn);
    personalBtn.title = signedIn ? t('mode.personal.title') : t('mode.personal.needsLogin');
  }

  // ── Config → config.js (loadConfig / saveConfig, imported above) ──

  // ── ID Generator ─────────────────────────────────

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ── File Reading Helper ─────────────────────────

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error);
      };
      reader.readAsText(file);
    });
  }

  // ── ZIP subsystem → zip.js (extractZip / bundleZip, imported above) ──

  // ── App creation (zip/url/file/paste) + Add modal → apps-io.js (imported at top; initAppsIo) ──

  // ── Module-level state ──────────────────────────────

  var allApps = [];
  var activeTag = null;
  var searchQuery = '';

  // ── Helpers ────────────────────────────────────────




  // ── Tag Rendering ─────────────────────────────────

  function renderTags() {
    var tagBar = document.getElementById('tag-bar');
    var tagSet = {};
    var hasFavorites = false;

    for (var i = 0; i < allApps.length; i++) {
      var app = allApps[i];
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
    html += '<button class="tag' + (activeTag === null ? ' active' : '') + '" onclick="window._launcher.filterByTag(null)">' + t('tag.all') + '</button>';

    // Favorites button (only if any favorites exist)
    if (hasFavorites) {
      html += '<button class="tag' + (activeTag === '__favorites__' ? ' active' : '') + '" onclick="window._launcher.filterByTag(\'__favorites__\')">' + t('tag.favorites') + '</button>';
    }

    // One button per unique tag
    for (var k = 0; k < uniqueTags.length; k++) {
      var tag = uniqueTags[k];
      html += '<button class="tag' + (activeTag === tag ? ' active' : '') + '" onclick="window._launcher.filterByTag(\'' + jsArg(tag) + '\')">' + escapeHtml(tag) + '</button>';
    }

    tagBar.innerHTML = html;
  }

  // ── Tag Filtering ─────────────────────────────────

  function filterByTag(tag) {
    activeTag = tag;
    renderApps();
    applyServerFilter();
  }

  // ── Launch App ──────────────────────────────────

  function launchApp(id, mode) {
    var app = null;
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === id) { app = allApps[i]; break; }
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
  var ownServerApps = [];

  // filename -> authoritative server state { parked, forkable, forks, owner, versionNumber,
  // protection }. Populated by buildLibraryEntries so the DETAIL view can offer the owner's
  // server management (park/fork/protect/remove) that used to sit on the published card.
  var serverStateByFilename = {};
  // filename -> current protection object, populated here as own cards render; the detail module
  // (copy-protection modal) reads it via the injected getOwnProtection() getter.
  var ownAppProtection = {};
  var serverAppManifests = {}; // moved out of server-io: SSOT for the owner-app manifest cache (detail reads via getServerManifests)

  // Status of a unified entry, for its badge.
  function libStatus(e) {
    if (e.parked) return 'parked';
    if (e.serverOnly) return 'server';
    if (e.published) return 'published';
    return 'local';
  }
  function libStatusLabel(e) {
    switch (libStatus(e)) {
      case 'parked':    return t('status.parked');
      case 'server':    return t('status.serverOnly');
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
        published: !!la.published, parked: false, serverOnly: false,
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
      var m = fn ? byFilename[fn] : null;
      if (m) {
        m.parked = !!sa.parked;
        m.published = !sa.parked;
        m.owner = sa.owner || m.owner;
        m.versionNumber = sa.version_number || m.versionNumber;
        m.forkable = !!sa.forkable; m.forks = sa.forks || 0;
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
          published: !sa.parked, parked: !!sa.parked, serverOnly: true,
          filename: fn, owner: sa.owner || '',
          versionNumber: sa.version_number || null,
          viewUrl: (base && fn) ? (base + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(fn)) : '',
          forkable: !!sa.forkable, forks: sa.forks || 0, protection: prot
        };
        entries.push(se);
        if (fn) byFilename[fn] = se;
      }
      // Record authoritative server state so the detail view can manage this app.
      if (fn) {
        serverStateByFilename[fn] = {
          parked: !!sa.parked, forkable: !!sa.forkable, forks: sa.forks || 0,
          owner: sa.owner || '', versionNumber: sa.version_number || null, protection: prot
        };
        ownAppProtection[fn] = prot;
      }
    }
    return entries;
  }

  function renderApps() {
    getAllApps().then(function (apps) {
      allApps = apps; // keep the raw local list (openPublishedDetail et al. read allApps)

      // Unified library list: one entry per app (local + own-server, deduped by filename).
      var entries = buildLibraryEntries(apps, ownServerApps);

      // Sort: favorites first, then by explicit sortOrder, then most-recent.
      entries.sort(function (a, b) {
        if (a.favorite && !b.favorite) return -1;
        if (!a.favorite && b.favorite) return 1;
        var oA = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
        var oB = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
        if (oA !== oB) return oA - oB;
        var dateA = a.lastOpenedAt || a.addedAt || '';
        var dateB = b.lastOpenedAt || b.addedAt || '';
        if (dateA > dateB) return -1;
        if (dateA < dateB) return 1;
        return 0;
      });

      // Filter by activeTag
      var filtered = entries;
      if (activeTag === '__favorites__') {
        filtered = entries.filter(function (app) { return app.favorite; });
      } else if (activeTag !== null) {
        var at = activeTag.toLowerCase();
        filtered = entries.filter(function (app) {
          return app.tags && app.tags.some(function (tg) { return String(tg).toLowerCase() === at; });
        });
      }

      // Filter by searchQuery
      if (searchQuery) {
        var q = searchQuery.toLowerCase();
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
        if (!activeTag && !searchQuery && entries.length === 0) {
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

      // Stats: count + total local blob size (server-only apps have no local footprint).
      var statsEl = document.getElementById('stats');
      var totalSize = 0;
      for (var sz = 0; sz < entries.length; sz++) {
        if (entries[sz].blob) totalSize += entries[sz].blob.length;
      }
      var sizeLabel = totalSize < 1024 ? totalSize + ' B'
        : totalSize < 1048576 ? (totalSize / 1024).toFixed(1) + ' KB'
        : (totalSize / 1048576).toFixed(1) + ' MB';
      statsEl.textContent = entries.length + ' ' + t('stats.apps') + ' · ' + sizeLabel + ' ' + t('stats.stored');

      renderTags();
      renderRecentlyOpened();
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
        menuBtn +
        '<div class="app-icon">' + escapeHtml(e.icon || '\u{1F4DD}') + '</div>' +
        '<div class="app-name">' + escapeHtml(e.name) +
          (e.origin === 'ai-published' ? ' <span class="ai-origin-badge">AI</span>' : '') + '</div>' +
        (e.description
          ? '<div class="app-source">' + escapeHtml(e.description) + '</div>'
          : '<div class="app-source">' + sourceLabel(e.source) + '</div>') +
        '<div class="app-actions">' +
          '<button onclick="event.stopPropagation(); ' + openCall + '" title="' + escapeHtml(t('card.openHint')) + '">▶ ' + escapeHtml(t('card.open')) + '</button>' +
          '<button onclick="event.stopPropagation(); ' + detailCall + '">' + escapeHtml(t('ctx.details')) + '</button>' +
        '</div>' +
        (e.favorite ? '<span class="fav-star visible">⭐</span>' : '') +
      '</div>';
  }

  function renderRecentlyOpened() {
    var section = document.getElementById('recent-section');
    var strip = document.getElementById('recent-strip');
    var recent = allApps
      .filter(function(a) { return a.lastOpenedAt; })
      .sort(function(a, b) { return (b.lastOpenedAt || '') > (a.lastOpenedAt || '') ? 1 : -1; })
      .slice(0, 5);
    if (recent.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    strip.innerHTML = recent.map(function(app) {
      var icon = app.icon || '\u{1F4DD}';
      return '<div style="background:var(--surface-glass);border:1px solid var(--border-subtle);border-radius:10px;padding:.6rem .8rem;cursor:pointer;min-width:120px;flex-shrink:0;transition:all .15s" onclick="window._launcher.launchApp(\'' + escapeHtml(app.id) + '\', \'' + escapeHtml(app.openMode || 'tab') + '\')" onmouseover="this.style.borderColor=\'var(--border-hover)\'" onmouseout="this.style.borderColor=\'var(--border-subtle)\'">' +
        '<div style="font-size:1.3rem;text-align:center">' + escapeHtml(icon) + '</div>' +
        '<div style="font-size:.75rem;font-weight:600;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px">' + escapeHtml(app.name) + '</div>' +
      '</div>';
    }).join('');
  }

  // ── Iframe helpers ────────────────────────────────

  var currentIframeUrl = '';

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
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === appId) { app = allApps[i]; break; }
    }
    if (!app) return;

    switch (action) {
      case 'details':
        openDetailView(appId);
        break;

      case 'edit':
        // Open modal pre-filled with app data
        setEditingAppId(appId);
        document.getElementById('modal-title').textContent = 'Edit App';
        document.getElementById('app-name').value = app.name || '';
        document.getElementById('app-icon').value = app.icon || '';
        document.getElementById('app-tags').value = (app.tags || []).join(', ');
        document.getElementById('app-open-mode').value = app.openMode || 'tab';

        // Set the correct source tab
        if (app.source === 'url') {
          switchTab('url');
          document.getElementById('app-url').value = app.url || '';
        } else {
          switchTab('file');
          document.getElementById('selected-file-name').textContent = '(existing file)';
        }

        document.getElementById('modal-overlay').hidden = false;
        break;

      case 'favorite':
        app.favorite = !app.favorite;
        saveApp(app).then(function () {
          renderApps();
        });
        break;

      case 'toggle-mode':
        app.openMode = app.openMode === 'iframe' ? 'tab' : 'iframe';
        saveApp(app).then(function () {
          renderApps();
        });
        break;

      case 'view-source':
        viewSource(app);
        break;

      case 'delete':
        if (await showConfirm(t('confirm.deleteApp').replace('{name}', function () { return app.name || 'this app'; }))) {
          // Tombstone published apps so the server copy isn't re-imported as a
          // "new" AI-published app on the next load.
          if (app.publishedFilename) addImportIgnore(app.publishedFilename);
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
    if (allApps.length === 0) {
      showNotice('Add some apps first before generating a homepage.');
      return;
    }

    var appList = allApps.map(function(app) {
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

  // ── Theme / Settings / Help / Export-Import / dedup / Clear → settings.js (imported at top; initSettings) ──

  // ── Server I/O (import/publish/operator/grants/backup/server-import) → server-io.js (initServerIo) ──

  // ── App Detail view + sign-in pill → detail.js (imported at top; wired via initDetail) ──

  // ── Cortex (bar + editor + prompt builder) → cortex.js (imported at top) ──

  // ── Drag & Drop Reordering ─────────────────────

  var dragSourceId = null;

  function onCardDragStart(e) {
    var card = e.target.closest('.app-card');
    if (!card) return;
    dragSourceId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSourceId);
  }

  function onCardDragEnd(e) {
    var card = e.target.closest('.app-card');
    if (card) card.classList.remove('dragging');
    // Remove all drag-over highlights
    var cards = document.querySelectorAll('.app-card.drag-over');
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('drag-over');
    dragSourceId = null;
  }

  function onCardDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var card = e.target.closest('.app-card');
    if (!card || card.dataset.id === dragSourceId) return;
    // Remove highlight from others
    var cards = document.querySelectorAll('.app-card.drag-over');
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('drag-over');
    card.classList.add('drag-over');
  }

  function onCardDrop(e) {
    e.preventDefault();
    var targetCard = e.target.closest('.app-card');
    if (!targetCard) return;
    var targetId = targetCard.dataset.id;
    if (!dragSourceId || dragSourceId === targetId) return;

    // Find indexes in the currently rendered/sorted allApps
    var srcIdx = -1, tgtIdx = -1;
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === dragSourceId) srcIdx = i;
      if (allApps[i].id === targetId) tgtIdx = i;
    }
    if (srcIdx === -1 || tgtIdx === -1) return;

    // Move the source app to the target position
    var moved = allApps.splice(srcIdx, 1)[0];
    allApps.splice(tgtIdx, 0, moved);

    // Assign sortOrder values based on new positions
    var saves = [];
    for (var j = 0; j < allApps.length; j++) {
      allApps[j].sortOrder = j;
      saves.push(saveApp(allApps[j]));
    }

    // Re-render immediately (no animation delay for reorder)
    var grid = document.getElementById('app-grid');
    var cards = grid.querySelectorAll('.app-card');
    for (var k = 0; k < cards.length; k++) {
      cards[k].classList.remove('drag-over', 'dragging');
    }

    Promise.all(saves).then(function () {
      renderApps();
    });
  }

  // ── Public API ────────────────────────────────────

  window._launcher = {
    openDB: openDB,
    getAllApps: getAllApps,
    saveApp: saveApp,
    deleteApp: deleteApp,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    renderApps: renderApps,
    renderTags: renderTags,
    filterByTag: filterByTag,
    launchApp: launchApp,
    launchInTab: launchInTab,
    launchInIframe: launchInIframe,
    viewPublished: viewPublished,
    closeIframe: closeIframe,
    openExternal: openExternal,
    setCurrentIframeUrl: function (url) { currentIframeUrl = url; },
    showContextMenu: showContextMenu,
    hideContextMenu: hideContextMenu,
    handleContextAction: handleContextAction,
    generateId: generateId,
    readFileAsText: readFileAsText,
    addAppFromUrl: addAppFromUrl,
    addAppFromFile: addAppFromFile,
    addAppFromSource: addAppFromSource,
    addAppFromZip: addAppFromZip,
    showModal: showModal,
    closeModal: closeModal,
    openSettings: openSettings,
    openHelp: openHelp,
    closeHelp: closeHelp,
    saveSettings: saveSettings,
    closeSettings: closeSettings,
    applyTheme: applyTheme,
    exportBackup: exportBackup,
    clearAllData: clearAllData,
    importFromAimeat: importFromAimeat,
    processAimeatImport: processAimeatImport,
    viewSource: viewSource,
    generateHomepagePrompt: generateHomepagePrompt,
    showPublishModal: showPublishModal,
    submitPublish: submitPublish,
    loadPublishedApps: loadPublishedApps,
    toggleCommunity: toggleCommunity,
    switchView: switchView,
    switchDbMode: switchDbMode,
    unpublishApp: unpublishApp,
    deleteServerApp: deleteServerApp,
    toggleParkApp: toggleParkApp,
    toggleForkApp: toggleForkApp,
    detailAboutEdit: detailAboutEdit,
    detailAboutCancel: detailAboutCancel,
    detailAboutSave: detailAboutSave,
    editAppDetails: editAppDetails,
    showSubdomainModal: showSubdomainModal,
    openConsents: openConsents,
    closeConsents: closeConsents,
    revokeConsent: revokeConsent,
    submitSubdomainAssign: submitSubdomainAssign,
    unassignSubdomain: unassignSubdomain,
    jsonImportSelectAll: jsonImportSelectAll,
    submitJsonImport: submitJsonImport,
    removeDuplicateApps: removeDuplicateApps,
    showServerImportModal: showServerImportModal,
    dismissServerImportBanner: dismissServerImportBanner,
    serverImportSelectAll: serverImportSelectAll,
    submitServerImport: submitServerImport,
    toggleBackupMenu: toggleBackupMenu,
    toggleCreateMenu: toggleCreateMenu,
    toggleCortexBar: toggleCortexBar,
    exportBackupZip: exportBackupZip,
    importBackupPick: importBackupPick,
    backupSelectAll: backupSelectAll,
    backupUpdateSummary: backupUpdateSummary,
    submitBackupRestore: submitBackupRestore,
    showVersionsModal: showVersionsModal,
    showLineageModal: showLineageModal,
    showProtectionModal: showProtectionModal,
    saveProtection: saveProtection,
    restoreVersion: restoreVersion,
    forkVersion: forkVersion,
    openDetailView: openDetailView,
    closeDetailView: closeDetailView,
    detailLaunch: detailLaunch,
    detailAiRun: detailAiRun,
    detailAiTest: detailAiTest,
    detailAiKeep: detailAiKeep,
    detailAiDiscard: detailAiDiscard,
    detailEditSource: detailEditSource,
    detailImproveExternal: detailImproveExternal,
    detailSharePrompt: detailSharePrompt,
    detailPublish: detailPublish,
    detailDelete: detailDelete,
    detailSetScreenshot: detailSetScreenshot,
    detailRefreshScreenshot: detailRefreshScreenshot,
    openPublishedDetail: openPublishedDetail,
    renderRecentlyOpened: renderRecentlyOpened,
    loadCortexExtensions: loadCortexExtensions,
    showCortexPopup: showCortexPopup,
    cortexCopy: cortexCopy,
    openCortexEditor: openCortexEditor,
    closeCortexEditor: closeCortexEditor,
    cortexEditorAddLib: cortexEditorAddLib,
    cortexEditorSave: cortexEditorSave,
    cortexEditorExport: cortexEditorExport,
    openPromptBuilder: openPromptBuilder,
    closePbPanel: closePbPanel,
    onCardDragStart: onCardDragStart,
    onCardDragEnd: onCardDragEnd,
    onCardDragOver: onCardDragOver,
    onCardDrop: onCardDrop,
    syncConfigToServer: syncConfigToServer,
    loadConfigFromServer: loadConfigFromServer,
    setLanguage: setLanguage,
    applyI18n: applyI18n,
    toggleTheme: toggleTheme
  };

  // Expose cortex functions globally for inline onclick handlers
  window.showCortexPopup = showCortexPopup;
  window.cortexCopy = cortexCopy;

  function refreshAll() {
    allApps = [];
    renderApps();
    loadPublishedApps();
    renderRecentlyOpened();
  }

  // ── Bootstrap ─────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Wire the detail module's injected deps (main-local fns + live state getters) BEFORE anything
    // can open the detail view or mount the login pill (whose onAuthChanged uses these).
    initDetail({
      refreshAll: refreshAll, loadPublishedApps: loadPublishedApps, renderApps: renderApps,
      updateModeToggle: updateModeToggle, getCortexOwnerToken: getCortexOwnerToken, launchApp: launchApp,
      viewPublished: viewPublished, viewSource: viewSource, generateId: generateId,
      generateSharePrompt: generateSharePrompt, openPromptBuilder: openPromptBuilder,
      showPublishModal: showPublishModal, addImportIgnore: addImportIgnore, removeImportIgnore: removeImportIgnore,
      getMainApps: function () { return allApps; },
      getServerState: function () { return serverStateByFilename; },
      getServerManifests: function () { return serverAppManifests; },
      getOwnProtection: function () { return ownAppProtection; },
      setIframeUrl: function (v) { currentIframeUrl = v; }
    });
    initSettings({ generateId: generateId, renderApps: renderApps, loadPublishedApps: loadPublishedApps });
    initAppsIo({ generateId: generateId, readFileAsText: readFileAsText, renderApps: renderApps, getMainApps: function () { return allApps; } });
    initServerIo({
      getMainApps: function () { return allApps; },
      getServerState: function () { return serverStateByFilename; },
      getServerManifests: function () { return serverAppManifests; },
      setServerManifests: function (v) { serverAppManifests = v; },
      getOwnServerApps: function () { return ownServerApps; },
      setOwnServerApps: function (v) { ownServerApps = v; },
      getActiveTag: function () { return activeTag; },
      getSearchQuery: function () { return searchQuery; },
      generateId: generateId, renderApps: renderApps, refreshAll: refreshAll
    });
    // ── Apply theme + language on load ──────────────
    applyTheme(getThemePref());
    // Keep the header ☀️ in sync when the login pill's ☾ (or another tab) changes the theme.
    try {
      new MutationObserver(updateThemeToggle).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      window.addEventListener('storage', function (ev) { if (ev.key === 'aimeat-theme' && (ev.newValue === 'dark' || ev.newValue === 'light')) applyTheme(ev.newValue); });
    } catch (e) {}
    // A ?lang= override (e.g. the portal "Build an app" link passes the language the
    // user has selected) wins over saved config so the catalog opens in that language.
    var _params = new URLSearchParams(location.search);
    var _urlLang = _params.get('lang');
    setLang((_urlLang === 'fi' || _urlLang === 'en')
      ? _urlLang
      : ((loadConfig().language === 'fi') ? 'fi' : 'en'));
    applyI18n();
    updateModeToggle();
    // Restore the last-used view (Kirjasto / Yhteisö); defaults to Library.
    var _savedView = 'library';
    try { _savedView = localStorage.getItem('appCatalogView') || 'library'; } catch (e) { /* private mode */ }
    switchView(_savedView);
    // Mount the shared golden login pill (loads aimeat-auth.js, restores session).
    mountLoginPill();

    // Brand the "back home" link with this node's own host (so self-hosted nodes
    // show their domain, not a hardcoded aimeat.io). The catalog is served from the
    // node origin, so location.host IS the node.
    try {
      var _homeLabel = document.getElementById('aimeat-home-label');
      if (_homeLabel && location.host) _homeLabel.textContent = location.host.replace(/^apps\./, '');
    } catch (e) { /* keep default label */ }

    renderApps();
    loadPublishedApps();
    loadCortexExtensions();
    loadConfigFromServer();

    // Wire the in-page confirm dialog (OK resolves true; Cancel/backdrop resolve false).
    document.getElementById('confirm-ok-btn').addEventListener('click', function () { closeConfirm(true); });
    document.getElementById('confirm-cancel-btn').addEventListener('click', function () { closeConfirm(false); });
    document.getElementById('confirm-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeConfirm(false);
    });

    // Deep link ?create=1 — open the AI prompt builder ("Build an app") right away.
    if (_params.get('create') === '1') {
      try { openPromptBuilder(null); } catch (e) { /* prompt builder optional */ }
    }

    // ── Search input ─────────────────────────────────
    document.getElementById('search-input').addEventListener('input', function (e) {
      searchQuery = e.target.value.trim();
      renderApps();
      applyServerFilter();
    });

    // ── Add App button ──────────────────────────────
    // Step 0: not signed in → open the sign-in/register dialog first, then the Add dialog.
    document.getElementById('add-btn').addEventListener('click', function () {
      closeCreateMenu();
      requireSignInThen(showModal);
    });

    // ── Generate with AI button ─────────────────────
    document.getElementById('generate-btn').addEventListener('click', function () {
      closeCreateMenu();
      openPromptBuilder(null);
    });

    // ── Settings button ─────────────────────────────
    document.getElementById('settings-btn').addEventListener('click', function () {
      openSettings();
    });

    // ── Settings save / cancel ──────────────────────
    document.getElementById('settings-save-btn').addEventListener('click', function () {
      saveSettings();
    });

    document.getElementById('settings-cancel-btn').addEventListener('click', function () {
      closeSettings();
    });

    // ── Click settings overlay to close ─────────────
    document.getElementById('settings-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        closeSettings();
      }
    });

    // ── Import backup file input ────────────────────
    document.getElementById('import-file-input').addEventListener('change', function () {
      if (this.files && this.files.length > 0) {
        handleImportBackup(this.files[0]);
        this.value = ''; // Reset for re-import
      }
    });

    // ── Click AIMEAT import overlay to close ────────
    document.getElementById('aimeat-import-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });

    // ── Click publish overlay to close ──────────────
    document.getElementById('publish-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });

    // ── Click versions overlay to close ─────────────
    document.getElementById('versions-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });

    // ── Click subdomain overlay to close ────────────
    document.getElementById('subdomain-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });

    // ── Backup: file picker + overlay/menu close ────
    document.getElementById('backup-file-input').addEventListener('change', function () {
      if (this.files && this.files[0]) importBackupFile(this.files[0]);
      this.value = '';
    });
    document.getElementById('backup-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });
    document.getElementById('server-import-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });
    document.getElementById('json-import-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.hidden = true;
      }
    });
    document.addEventListener('click', function (e) {
      var menu = document.getElementById('backup-menu');
      if (!menu.hidden && !menu.contains(e.target) && e.target.id !== 'backup-btn') {
        menu.hidden = true;
      }
      var cmenu = document.getElementById('create-menu');
      if (cmenu && !cmenu.hidden && !cmenu.contains(e.target) && e.target.id !== 'create-btn') {
        cmenu.hidden = true;
      }
    });

    // ── Click cortex popup overlay to close ─────────
    document.getElementById('cortex-popup-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        this.style.display = 'none';
      }
    });

    // ── Click cortex editor overlay to close ────────
    document.getElementById('cortex-editor-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        closeCortexEditor();
      }
    });

    // ── Tab switching ───────────────────────────────
    var tabBtns = document.querySelectorAll('#add-app-modal .modal-tab');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    // ── Drop zone events ────────────────────────────
    var dropZone = document.getElementById('drop-zone');
    var fileInput = document.getElementById('file-input');
    var browseBtn = document.getElementById('browse-btn');

    // Auto-fill the app name from pasted code (AIMEAT manifest / <title>) when the
    // name field is still empty — the description rides along into the publish step.
    var pasteArea = document.getElementById('app-paste-code');
    if (pasteArea) {
      pasteArea.addEventListener('input', function () {
        var nameInput = document.getElementById('app-name');
        if (nameInput && !nameInput.value.trim()) {
          var meta = parseAppMeta(pasteArea.value);
          if (meta.name) nameInput.value = meta.name;
        }
      });
    }

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileDrop(e.dataTransfer.files[0]);
      }
    });

    browseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFileDrop(fileInput.files[0]);
      }
    });

    // ── Modal save / cancel ─────────────────────────
    document.getElementById('modal-save-btn').addEventListener('click', function () {
      handleSave();
    });

    document.getElementById('modal-cancel-btn').addEventListener('click', function () {
      closeModal();
    });

    // ── Click overlay to close ──────────────────────
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target === this) {
        closeModal();
      }
    });

    // ── Context menu action buttons ─────────────────
    var contextMenu = document.getElementById('context-menu');
    var contextBtns = contextMenu.querySelectorAll('button[data-action]');
    contextBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        handleContextAction(btn.getAttribute('data-action'));
      });
    });

    // ── PostMessage auth protocol for sandboxed iframes ──
    window.addEventListener('message', function(e) {
      var iframe = document.getElementById('app-iframe');
      if (!iframe || !iframe.contentWindow) return;
      // Only respond to messages from our iframe
      if (e.source !== iframe.contentWindow) return;
      if (!e.data || e.data.type !== 'aimeat-request-auth') return;

      // Defense in depth: never hand the session token to a cross-origin framed page. After the
      // launchInIframe guard, currentIframeUrl is only ever empty (our own srcdoc blob) or a
      // same-origin apex URL — re-check here so a stray external frame can never receive it.
      if (currentIframeUrl && !isSameOriginUrl(currentIframeUrl)) return;

      // Get JWT from aimeat-auth library if available, else from localStorage
      var jwt = null;
      var nodeUrl = '';
      try {
        if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession()) {
          var session = window.AIMEAT.auth.getSession();
          jwt = session.jwt;
          nodeUrl = session.nodeUrl || '';
        } else {
          var stored = localStorage.getItem('aimeat_session');
          if (stored) {
            var parsed = JSON.parse(stored);
            jwt = parsed.jwt || null;
          }
          var config = loadConfig();
          nodeUrl = config.aimeatUrl || '';
        }
      } catch(err) { /* ignore parse errors */ }

      iframe.contentWindow.postMessage({
        type: 'aimeat-auth',
        jwt: jwt,
        nodeUrl: nodeUrl
      }, '*');
    });

    // ── Click anywhere to close context menu ────────
    document.addEventListener('click', function () {
      hideContextMenu();
    });

    // ── Keyboard shortcuts ──────────────────────────
    document.addEventListener('keydown', function (e) {
      // Escape — close modals / overlays (source-overlay first in cascade)
      if (e.key === 'Escape') {
        if (!document.getElementById('iframe-view').hidden) {
          closeIframe();
        } else if (document.getElementById('cortex-editor-overlay').style.display === 'flex') {
          closeCortexEditor();
        } else if (document.getElementById('prompt-builder-overlay').style.display === 'flex') {
          closePbPanel();
        } else if (!document.getElementById('source-overlay').hidden) {
          document.getElementById('source-overlay').hidden = true;
        } else if (!document.getElementById('context-menu').hidden) {
          hideContextMenu();
        } else if (!document.getElementById('aimeat-import-overlay').hidden) {
          document.getElementById('aimeat-import-overlay').hidden = true;
        } else if (!document.getElementById('publish-overlay').hidden) {
          document.getElementById('publish-overlay').hidden = true;
        } else if (!document.getElementById('subdomain-overlay').hidden) {
          document.getElementById('subdomain-overlay').hidden = true;
        } else if (!document.getElementById('backup-overlay').hidden) {
          document.getElementById('backup-overlay').hidden = true;
        } else if (!document.getElementById('server-import-overlay').hidden) {
          document.getElementById('server-import-overlay').hidden = true;
        } else if (!document.getElementById('json-import-overlay').hidden) {
          document.getElementById('json-import-overlay').hidden = true;
        } else if (!document.getElementById('settings-overlay').hidden) {
          closeSettings();
        } else if (!document.getElementById('modal-overlay').hidden) {
          closeModal();
        } else if (!document.getElementById('detail-view').hidden) {
          closeDetailView();
        }
        return;
      }
      // Ctrl+N / Cmd+N — open Add App modal
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showModal();
        return;
      }
      // Ctrl+F / Cmd+F — focus search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('search-input').focus();
      }
    });

    // ── Long-press for touch devices ─────────────────
    document.getElementById('app-grid').addEventListener('touchstart', function(e) {
      var card = e.target.closest('.app-card');
      if (!card) return;
      var appId = card.getAttribute('data-id');
      card._longPressTimer = setTimeout(function() {
        e.preventDefault();
        window._launcher.showContextMenu(e.touches[0], appId);
      }, 500);
    }, { passive: false });

    document.getElementById('app-grid').addEventListener('touchend', function(e) {
      var card = e.target.closest('.app-card');
      if (card && card._longPressTimer) clearTimeout(card._longPressTimer);
    });

    document.getElementById('app-grid').addEventListener('touchmove', function(e) {
      var card = e.target.closest('.app-card');
      if (card && card._longPressTimer) clearTimeout(card._longPressTimer);
    });

    // ── Copy Source button ───────────────────────────
    document.getElementById('copy-source-btn').addEventListener('click', function() {
      var code = document.getElementById('source-code').value;
      var btn = this;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function() {
          btn.textContent = 'Copied!';
          setTimeout(function() { btn.textContent = 'Copy Source'; }, 1500);
        });
      } else {
        // Fallback: select text in textarea
        var ta = document.getElementById('source-code');
        ta.select();
        document.execCommand('copy');
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = 'Copy Source'; }, 1500);
      }
    });

    // ── Build rich AI prompt with AIMEAT instructions ─
    // ── Copy with AI Prompt button → opens Prompt Builder ───
    document.getElementById('copy-prompt-btn').addEventListener('click', function() {
      var overlay = document.getElementById('source-overlay');
      var appId = overlay.dataset.appId;
      var app = null;
      for (var i = 0; i < allApps.length; i++) {
        if (allApps[i].id === appId) { app = allApps[i]; break; }
      }
      openPromptBuilder(app);
    });

    // ── Enable/disable Save button when source changes ─
    document.getElementById('source-code').addEventListener('input', function() {
      var overlay = document.getElementById('source-overlay');
      var saveBtn = document.getElementById('save-source-btn');
      var original = overlay.dataset.originalSource || '';
      saveBtn.disabled = (this.value === original);
    });

    // ── Save Changes button ──────────────────────────
    document.getElementById('save-source-btn').addEventListener('click', function() {
      var overlay = document.getElementById('source-overlay');
      var textarea = document.getElementById('source-code');
      var appId = overlay.dataset.appId;
      var btn = this;

      if (!appId) {
        showNotice('Cannot save: no app ID found.');
        return;
      }

      var newSource = textarea.value;
      // Encode to base64 blob
      var newBlob = btoa(unescape(encodeURIComponent(newSource)));

      // Find the app in allApps and update it
      var app = null;
      for (var i = 0; i < allApps.length; i++) {
        if (allApps[i].id === appId) {
          app = allApps[i];
          break;
        }
      }

      if (!app) {
        showNotice('App not found in library.');
        return;
      }

      app.blob = newBlob;
      btn.textContent = 'Saving...';
      btn.disabled = true;

      saveApp(app).then(function() {
        btn.textContent = 'Saved!';
        overlay.dataset.originalSource = newSource;
        setTimeout(function() {
          btn.textContent = 'Save Changes';
          btn.disabled = true;
        }, 1500);
        renderApps();
      }).catch(function(err) {
        btn.textContent = 'Save Changes';
        btn.disabled = false;
        showNotice('Failed to save: ' + (err.message || err));
      });
    });

    // ── Close source modal helper ─────────────────────
    async function closeSourceModal() {
      var saveBtn = document.getElementById('save-source-btn');
      if (!saveBtn.disabled) {
        if (!(await showConfirm(t('confirm.unsavedClose')))) return;
      }
      document.getElementById('source-overlay').hidden = true;
    }

    // ── Click source overlay background to close ─────
    document.getElementById('source-overlay').addEventListener('click', function(e) {
      if (e.target === this) closeSourceModal();
    });

    // ── Close button in source modal ─────────────────
    document.getElementById('close-source-btn').addEventListener('click', closeSourceModal);

    // ── Homepage button ──────────────────────────────
    document.getElementById('homepage-btn').addEventListener('click', function () { closeCreateMenu(); generateHomepagePrompt(); });

    // ── Prompt Builder event listeners ───────────────
    document.getElementById('pb-cancel-btn').addEventListener('click', closePbPanel);

    document.getElementById('pb-copy-btn').addEventListener('click', function() {
      var prompt = buildPromptFromBuilder();
      var btn = this;
      // Keep the dialog OPEN after copying so the user can read Step 3 (add & publish).
      var revert = function () { setTimeout(function () { btn.textContent = t('pb.copy'); }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(prompt).then(function() { btn.textContent = '✔ ' + (t('pb.copied') || 'Copied!'); revert(); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = prompt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '✔ ' + (t('pb.copied') || 'Copied!');
        revert();
      }
    });

    // Step 3 — close the prompt builder and open the Add App flow on the PASTE tab
    // (the AI hands back ready-to-paste code; the File tab is right there for a file).
    document.getElementById('pb-add-btn').addEventListener('click', function() {
      // Step 0 (sign-in/register) if needed, then open Add on the Paste tab.
      requireSignInThen(function () {
        closePbPanel();
        showModal();
        try { switchTab('paste'); } catch (e) { /* tab switch is best-effort */ }
      });
    });

    // Mode radios are hidden (mode is implicit) and the cortex-extensions toggle was
    // removed — the helpful aimeat-* cortex UI libs are now always documented in the
    // prompt. Keep the mode radios in sync only for buildPromptFromBuilder's state.
    document.querySelectorAll('input[name="pb-mode"]').forEach(function(radio) {
      radio.addEventListener('change', updatePbPreview);
    });

    document.getElementById('pb-description').addEventListener('input', updatePbPreview);

    document.getElementById('prompt-builder-overlay').addEventListener('click', function(e) {
      if (e.target === this) closePbPanel();
    });
  });


