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

  // ── App Creation from ZIP ─────────────────────────

  async function addAppFromZip(name, arrayBuffer, icon, tags, openMode) {
    var files = await extractZip(arrayBuffer);
    var bundledHtml = await bundleZip(files);
    var encoded = btoa(unescape(encodeURIComponent(bundledHtml)));
    var app = {
      id: generateId(),
      name: name,
      description: '',
      source: 'zip',
      url: null,
      blob: encoded,
      tags: tags,
      openMode: openMode,
      icon: icon || '\u{1F4E6}',
      screenshot: null,
      favorite: false,
      addedAt: new Date().toISOString(),
      lastOpenedAt: null
    };
    await saveApp(app);
    return app;
  }

  // ── App Creation from URL ───────────────────────

  function addAppFromUrl(name, url, icon, tags, openMode) {
    var app = {
      id: generateId(),
      name: name,
      description: '',
      source: 'url',
      url: url,
      blob: null,
      tags: tags,
      openMode: openMode,
      icon: icon || '\u{1F4DD}',
      screenshot: null,
      favorite: false,
      addedAt: new Date().toISOString(),
      lastOpenedAt: null
    };
    return saveApp(app).then(function () {
      return app;
    });
  }

  // ── App Creation from File ──────────────────────

  function addAppFromFile(name, file, icon, tags, openMode) {
    return readFileAsText(file).then(function (content) {
      var encoded = btoa(unescape(encodeURIComponent(content)));
      var app = {
        id: generateId(),
        name: name,
        description: '',
        source: 'local',
        url: null,
        blob: encoded,
        tags: tags,
        openMode: openMode,
        icon: icon || '\u{1F4DD}',
        screenshot: null,
        favorite: false,
        addedAt: new Date().toISOString(),
        lastOpenedAt: null
      };
      return saveApp(app).then(function () {
        return app;
      });
    });
  }

  // ── App Creation from Pasted Source ─────────────

  function addAppFromSource(name, sourceCode, icon, tags, openMode) {
    var encoded = btoa(unescape(encodeURIComponent(sourceCode)));
    var app = {
      id: generateId(),
      name: name,
      description: parseAppMeta(sourceCode).description || '',
      source: 'local',
      url: null,
      blob: encoded,
      tags: tags,
      openMode: openMode,
      icon: icon || '\u{1F4DD}',
      screenshot: null,
      favorite: false,
      addedAt: new Date().toISOString(),
      lastOpenedAt: null
    };
    return saveApp(app).then(function () {
      return app;
    });
  }

  // ── Modal State ─────────────────────────────────

  var selectedFile = null;
  var editingAppId = null;

  function showModal() {
    document.getElementById('modal-overlay').hidden = false;
    document.getElementById('modal-title').textContent = t('addModal.title');
    // Default to URL tab
    switchTab('url');
  }

  // Step 0 for not-yet-signed-in users: adding/publishing an app needs an account, so
  // open the shared sign-in/register dialog (the SAME one the golden pill opens —
  // Google one-click or email+password, full registration) and continue once logged in.
  function requireSignInThen(next) {
    if (getCortexOwnerToken()) { next(); return; }
    var done = false;
    function onLogin() {
      if (done) return; done = true;
      try { window.AIMEAT.auth.off('login', onLogin); } catch (e) {}
      next();
    }
    try {
      window.AIMEAT.auth.on('login', onLogin);
      window.AIMEAT.auth.showLoginModal({});
    } catch (e) {
      // Auth lib not ready yet — fall back to the pill's own Sign In button.
      var b = document.querySelector('#headerAuth .aimeat-sign-btn');
      if (b) b.click(); else next();
    }
  }

  // Read the app name + description the templates embed (AIMEAT App Manifest comment),
  // falling back to <title>, so the Add dialog can pre-fill them from pasted code.
  function parseAppMeta(html) {
    var meta = { name: '', description: '' };
    try {
      var m = (html || '').match(/AIMEAT App Manifest([\s\S]*?)-->/i);
      if (m) {
        var nm = m[1].match(/\bname:\s*(.+)/i); if (nm) meta.name = nm[1].trim();
        var dm = m[1].match(/\bdescription:\s*(.+)/i); if (dm) meta.description = dm[1].trim();
      }
      if (!meta.name) { var tt = (html || '').match(/<title>([^<]+)<\/title>/i); if (tt) meta.name = tt[1].trim(); }
    } catch (e) {}
    // Drop unfilled {{template}} placeholders.
    if (/\{\{.*\}\}/.test(meta.name)) meta.name = '';
    if (/\{\{.*\}\}/.test(meta.description)) meta.description = '';
    return meta;
  }

  function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
    // Reset form
    document.getElementById('app-url').value = '';
    document.getElementById('app-name').value = '';
    document.getElementById('app-icon').value = '';
    document.getElementById('app-tags').value = '';
    document.getElementById('app-open-mode').value = 'tab';
    document.getElementById('selected-file-name').textContent = '';
    document.getElementById('file-input').value = '';
    document.getElementById('app-paste-code').value = '';
    selectedFile = null;
    editingAppId = null;
  }

  function switchTab(tabName) {
    // Toggle tab buttons
    var tabs = document.querySelectorAll('.modal-tab');
    tabs.forEach(function (tab) {
      if (tab.getAttribute('data-tab') === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
    // Toggle tab content
    var contents = document.querySelectorAll('.tab-content');
    contents.forEach(function (content) {
      if (content.id === 'tab-' + tabName) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }

  function handleFileDrop(file) {
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.zip')) {
      selectedFile = file;
      document.getElementById('selected-file-name').textContent = file.name;
      var nameInput = document.getElementById('app-name');
      if (!nameInput.value.trim()) {
        nameInput.value = file.name.replace(/\.zip$/i, '');
      }
      return;
    }
    if (!file.name.match(/\.html?$/i)) {
      showNotice('Please select an HTML or ZIP file (.html, .htm, or .zip)');
      return;
    }
    selectedFile = file;
    document.getElementById('selected-file-name').textContent = file.name;
    // Auto-fill name from filename if empty
    var nameInput = document.getElementById('app-name');
    if (!nameInput.value.trim()) {
      nameInput.value = file.name.replace(/\.html?$/i, '');
    }
  }

  function handleSave() {
    var name = document.getElementById('app-name').value.trim();
    var icon = document.getElementById('app-icon').value.trim();
    var tagsRaw = document.getElementById('app-tags').value.trim();
    var openMode = document.getElementById('app-open-mode').value;

    var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];

    // ── Edit mode: update existing app ──
    if (editingAppId) {
      var app = null;
      for (var i = 0; i < allApps.length; i++) {
        if (allApps[i].id === editingAppId) { app = allApps[i]; break; }
      }
      if (!app) {
        closeModal();
        return;
      }
      if (!name) {
        showNotice('Please enter a name');
        return;
      }
      app.name = name;
      app.icon = icon || app.icon;
      app.tags = tags;
      app.openMode = openMode;
      saveApp(app).then(function () {
        closeModal();
        renderApps();
      });
      return;
    }

    // ── Create mode ──
    var activeTab = document.querySelector('.modal-tab.active');
    var tabName = activeTab ? activeTab.getAttribute('data-tab') : 'url';

    if (tabName === 'url') {
      var url = document.getElementById('app-url').value.trim();
      if (!url) {
        showNotice('Please enter a URL');
        return;
      }
      if (!name) {
        // Derive name from URL
        try {
          name = new URL(url).hostname;
        } catch (e) {
          name = url;
        }
      }
      addAppFromUrl(name, url, icon, tags, openMode).then(function () {
        closeModal();
        renderApps();
      });
    } else if (tabName === 'paste') {
      var pastedCode = document.getElementById('app-paste-code').value.trim();
      if (!pastedCode) {
        showNotice('Please paste your HTML source code');
        return;
      }
      if (!name) {
        // Try to extract title from HTML
        var titleMatch = pastedCode.match(/<title[^>]*>([^<]+)<\/title>/i);
        name = titleMatch ? titleMatch[1].trim() : 'Pasted App';
      }
      addAppFromSource(name, pastedCode, icon, tags, openMode).then(function () {
        closeModal();
        renderApps();
      });
    } else if (tabName === 'file') {
      if (!selectedFile) {
        showNotice('Please select a file');
        return;
      }
      if (selectedFile.name.toLowerCase().endsWith('.zip')) {
        // ZIP file — extract and bundle
        if (!name) {
          name = selectedFile.name.replace(/\.zip$/i, '');
        }
        selectedFile.arrayBuffer().then(function (arrayBuffer) {
          return addAppFromZip(name, arrayBuffer, icon, tags, openMode);
        }).then(function () {
          closeModal();
          renderApps();
        }).catch(function (err) {
          showNotice('ZIP import failed: ' + (err.message || err));
        });
      } else {
        // HTML file
        if (!name) {
          name = selectedFile.name.replace(/\.html?$/i, '');
        }
        addAppFromFile(name, selectedFile, icon, tags, openMode).then(function () {
          closeModal();
          renderApps();
        });
      }
    }
  }

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
        editingAppId = appId;
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

  // ── AIMEAT Import ───────────────────────────────

  var aimeatAppsCache = [];

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function importFromAimeat() {
    var config = loadConfig();
    if (!config.aimeatUrl) {
      showNotice('Set AIMEAT server URL in Settings first');
      return;
    }

    var aimeatUrl = config.aimeatUrl.replace(/\/+$/, ''); // strip trailing slash
    closeModal();

    fetch(aimeatUrl + '/v1/apps?include_peers=true')
      .then(function (resp) {
        if (!resp.ok) throw new Error('Server returned ' + resp.status);
        return resp.json();
      })
      .then(function (json) {
        var apps = json.data && json.data.apps ? json.data.apps : [];
        var peerApps = json.data && json.data.peer_apps ? json.data.peer_apps : [];
        // Merge local and peer apps; tag peer apps with source info
        for (var p = 0; p < peerApps.length; p++) {
          peerApps[p]._from_peer = true;
        }
        var allFetched = apps.concat(peerApps);
        if (allFetched.length === 0) {
          showNotice('No apps found on the AIMEAT server');
          return;
        }
        aimeatAppsCache = allFetched;
        showAimeatImportDialog(allFetched, aimeatUrl);
      })
      .catch(function (err) {
        var msg = 'Failed to fetch apps from AIMEAT server.\n\n' + (err.message || err);
        if (err.message && err.message.indexOf('Failed to fetch') !== -1) {
          msg += '\n\nIf the launcher is opened via file://, CORS will block the request. Open it from the AIMEAT server instead.';
        }
        showNotice(msg);
      });
  }

  function showAimeatImportDialog(apps, aimeatUrl) {
    var listEl = document.getElementById('aimeat-app-list');
    var html = '';
    for (var i = 0; i < apps.length; i++) {
      var app = apps[i];
      var displayName = (app.manifest && app.manifest.name) ? app.manifest.name : app.filename;
      var displayAuthor = (app.manifest && app.manifest.authorDisplay) ? app.manifest.authorDisplay : (app.owner || '');
      var displayDesc = (app.manifest && app.manifest.description) ? app.manifest.description : '';
      var displayVer = app.version_number ? 'v' + app.version_number : '';
      var displayCat = (app.manifest && app.manifest.category) ? app.manifest.category : '';
      var peerLabel = app._from_peer && app._peer_node ? ' \u00B7 \uD83C\uDF10 ' + escapeHtml(app._peer_node) : '';
      html +=
        '<div class="aimeat-app-item">' +
          '<input type="checkbox" data-index="' + i + '" checked/>' +
          '<div class="aimeat-app-info">' +
            '<div class="aimeat-app-name">' + escapeHtml(displayName) + (displayVer ? ' <span style="opacity:.5;font-size:.85em">' + escapeHtml(displayVer) + '</span>' : '') + '</div>' +
            '<div class="aimeat-app-size">' + formatFileSize(app.size) + (displayAuthor ? ' \u00B7 ' + escapeHtml(displayAuthor) : '') + (displayCat ? ' \u00B7 ' + escapeHtml(displayCat) : '') + peerLabel + '</div>' +
            (displayDesc ? '<div class="aimeat-app-size" style="opacity:.6">' + escapeHtml(displayDesc.substring(0, 100)) + '</div>' : '') +
          '</div>' +
          '<select data-index="' + i + '">' +
            '<option value="link">Link (online only)</option>' +
            '<option value="download">Download (offline)</option>' +
          '</select>' +
        '</div>';
    }
    listEl.innerHTML = html;
    // Store the aimeatUrl for processing
    listEl.dataset.aimeatUrl = aimeatUrl;
    document.getElementById('aimeat-import-overlay').hidden = false;
  }

  function processAimeatImport() {
    var listEl = document.getElementById('aimeat-app-list');
    var aimeatUrl = listEl.dataset.aimeatUrl;
    var checkboxes = listEl.querySelectorAll('input[type="checkbox"]');
    var selects = listEl.querySelectorAll('select');
    var config = loadConfig();
    var defaultOpenMode = config.defaultOpenMode || 'tab';

    var toImport = [];
    for (var i = 0; i < checkboxes.length; i++) {
      if (checkboxes[i].checked) {
        var idx = parseInt(checkboxes[i].getAttribute('data-index'), 10);
        var mode = selects[i].value;
        toImport.push({ app: aimeatAppsCache[idx], mode: mode });
      }
    }

    if (toImport.length === 0) {
      showNotice('No apps selected');
      return;
    }

    var promises = [];
    for (var j = 0; j < toImport.length; j++) {
      (function (item) {
        var app = item.app;
        var name = (app.manifest && app.manifest.name) ? app.manifest.name : app.filename.replace(/\.html?$/i, '');
        var importedVersion = app.version_number || 1;
        // For peer apps, use the peer's URL as the base
        var baseUrl = (app._from_peer && app._peer_url) ? app._peer_url.replace(/\/+$/, '') : aimeatUrl;

        if (item.mode === 'link') {
          // Link mode: store URL with ?mode=inline, pinned to latest
          var inlineUrl = baseUrl + app.download_url + '?mode=inline';
          promises.push(addAppFromUrl(name, inlineUrl, '\u{1F4E6}', ['aimeat'], defaultOpenMode));
        } else {
          // Download mode: fetch content and store blob (pinned to current version)
          var downloadUrl = baseUrl + app.download_url;
          promises.push(
            fetch(downloadUrl)
              .then(function (resp) {
                if (!resp.ok) throw new Error('Download failed: ' + resp.status);
                return resp.text();
              })
              .then(function (content) {
                var encoded = btoa(unescape(encodeURIComponent(content)));
                var record = {
                  id: generateId(),
                  name: name,
                  description: (app.manifest && app.manifest.description) ? app.manifest.description : '',
                  source: 'aimeat',
                  aimeatOwner: app.owner || null,
                  aimeatFilename: app.filename || null,
                  aimeatVersion: importedVersion,
                  url: null,
                  blob: encoded,
                  tags: ['aimeat'],
                  openMode: defaultOpenMode,
                  icon: '\u{1F4E6}',
                  screenshot: null,
                  favorite: false,
                  addedAt: new Date().toISOString(),
                  lastOpenedAt: null
                };
                return saveApp(record);
              })
          );
        }
      })(toImport[j]);
    }

    Promise.all(promises).then(function () {
      document.getElementById('aimeat-import-overlay').hidden = true;
      renderApps();
    }).catch(function (err) {
      showNotice('Import error: ' + (err.message || err));
    });
  }

  // ── Publish to AIMEAT ───────────────────────────

  var publishAppId = null;

  function showPublishModal(appId) {
    var app = null;
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === appId) { app = allApps[i]; break; }
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
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === publishAppId) { app = allApps[i]; break; }
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
    var grid = document.getElementById('community-grid');
    var hasApps = !!grid && grid.children.length > 0;
    var inCommunity = document.body.getAttribute('data-active-view') === 'community';
    empty.style.display = (!hasApps && inCommunity) ? 'block' : 'none';
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

  // ── Server → local import (user-selected, NEVER automatic) ────
  // Apps published under this owner's account (e.g. via MCP) may exist only on
  // the server. Importing one into the local catalog gives it the exact same
  // management actions (edit, rename, tags, versions, delete) as locally
  // created apps. The import is ALWAYS user-initiated: a banner reports how
  // many published apps are missing locally, and a review modal lets the user
  // pick exactly which ones to import. The tombstone list marks apps the user
  // deleted locally so the banner doesn't nag about them (they stay reachable
  // in the modal, unchecked).

  // The import ignore-list ("Not now" tombstones) is keyed PER catalog DB (mode + owner), the same
  // way the local catalog is — the old single shared key meant a tombstone set in Global re-surfaced
  // the banner in Personal (and vice versa) on every mode switch.
  function importIgnoreKey() { return 'appCatalogImportIgnore.' + getDbName(); }

  function getImportIgnore() {
    try { return JSON.parse(localStorage.getItem(importIgnoreKey()) || '[]'); } catch (e) { return []; }
  }

  function addImportIgnore(filename) {
    var list = getImportIgnore();
    if (list.indexOf(filename) === -1) {
      list.push(filename);
      localStorage.setItem(importIgnoreKey(), JSON.stringify(list));
    }
  }

  function removeImportIgnore(filename) {
    localStorage.setItem(importIgnoreKey(), JSON.stringify(getImportIgnore().filter(function (f) { return f !== filename; })));
  }

  // State for the review modal: own server apps with no local copy.
  var serverImportState = { missing: [], aimeatUrl: '' };

  function updateServerImportState(ownApps, localByFilename, aimeatUrl) {
    serverImportState.missing = ownApps.filter(function (sa) {
      return sa.filename && !localByFilename[sa.filename];
    });
    serverImportState.aimeatUrl = aimeatUrl;
    renderServerImportBanner();
  }

  function renderServerImportBanner() {
    var banner = document.getElementById('server-import-banner');
    if (!banner) return;
    var ignore = getImportIgnore();
    // Tombstoned apps (deleted locally on purpose) don't count toward the nag
    var fresh = serverImportState.missing.filter(function (sa) { return ignore.indexOf(sa.filename) === -1; });
    if (fresh.length === 0 || sessionStorage.getItem('aimeatServerImportDismissed') === '1') {
      banner.style.display = 'none';
      return;
    }
    document.getElementById('server-import-count').textContent = fresh.length;
    banner.style.display = '';
  }

  function dismissServerImportBanner() {
    sessionStorage.setItem('aimeatServerImportDismissed', '1');
    renderServerImportBanner();
  }

  function showServerImportModal() {
    var settingsOv = document.getElementById('settings-overlay');
    if (settingsOv) settingsOv.hidden = true; // may be opened from Settings — don't stack overlays
    var missing = serverImportState.missing || [];
    var body = document.getElementById('server-import-body');
    var ignore = getImportIgnore();
    if (missing.length === 0) {
      body.innerHTML = '<p style="font-size:.85rem;color:var(--text-muted);padding:8px 0">' + t('srvImport.nothingMissing') + '</p>';
      document.getElementById('server-import-status').textContent = '';
      document.getElementById('server-import-overlay').hidden = false;
      return;
    }
    var html = '<p style="font-size:.8rem;color:var(--text-muted);margin:4px 0 8px">' + t('srvImport.desc') + '</p>' +
      '<div class="backup-toolbar-row"><div>' +
        '<button class="backup-link-btn" onclick="window._launcher.serverImportSelectAll(true)">' + t('backup.selectAll') + '</button> / ' +
        '<button class="backup-link-btn" onclick="window._launcher.serverImportSelectAll(false)">' + t('backup.selectNone') + '</button>' +
      '</div></div>' +
      '<table class="backup-table"><tbody>';
    for (var i = 0; i < missing.length; i++) {
      var sa = missing[i];
      var name = (sa.manifest && sa.manifest.name) ? sa.manifest.name : sa.filename;
      // Locally deleted (tombstoned) apps stay reachable here but default to unchecked
      var checked = ignore.indexOf(sa.filename) === -1 ? ' checked' : '';
      html +=
        '<tr>' +
          '<td><input type="checkbox" class="server-import-cb" data-i="' + i + '"' + checked + '/></td>' +
          '<td>' + escapeHtml(name) + '<div class="mono-cell">' + escapeHtml(sa.filename) + '</div></td>' +
          '<td>' + (sa.version_number ? 'v' + sa.version_number : '') + '</td>' +
          '<td>' + (sa.created_at ? new Date(sa.created_at).toLocaleDateString() : '') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    body.innerHTML = html;
    document.getElementById('server-import-status').textContent = '';
    document.getElementById('server-import-overlay').hidden = false;
  }

  function serverImportSelectAll(checked) {
    document.querySelectorAll('.server-import-cb').forEach(function (b) { b.checked = checked; });
  }

  function submitServerImport() {
    var selected = [];
    document.querySelectorAll('.server-import-cb').forEach(function (b) {
      if (b.checked) selected.push(serverImportState.missing[parseInt(b.getAttribute('data-i'), 10)]);
    });
    var statusEl = document.getElementById('server-import-status');
    if (selected.length === 0) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = t('backup.nothingSelected');
      return;
    }
    statusEl.style.color = 'var(--text-muted)';
    statusEl.textContent = t('srvImport.importing');
    importServerApps(selected, serverImportState.aimeatUrl).then(function (res) {
      // Re-opt-in only the apps that ACTUALLY imported (clear their tombstone); keep the failed
      // ones tombstoned so the user can retry, and tell them which failed instead of the old
      // silent drop + "everything succeeded" close.
      var failedNames = {};
      res.failed.forEach(function (f) { failedNames[f.filename] = true; });
      selected.forEach(function (sa) { if (!failedNames[sa.filename]) removeImportIgnore(sa.filename); });
      renderApps();
      loadPublishedApps();
      if (res.failed.length) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = t('srvImport.someFailed') + ' (' + res.failed.length + '): ' + res.failed.map(function (f) { return f.filename; }).join(', ');
      } else {
        document.getElementById('server-import-overlay').hidden = true;
      }
    }).catch(function (e) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = e.message || String(e);
    });
  }

  function importServerApps(toImport, aimeatUrl) {
    if (toImport.length === 0) return Promise.resolve({ imported: 0, failed: [] });
    var failed = [];
    return Promise.all(toImport.map(function (sa) {
      // Fetch the RAW app source (no ?mode=inline). The inline form 301-redirects to
      // the isolated app origin (…apps.<host>) when H-2 app isolation is enabled, and
      // this page's connect-src CSP does not cover http://*.apps.localhost:* — so on a
      // local dev server every import fetch was silently blocked and nothing imported
      // (works on prod only because the CSP's blanket `https:` covers the app origin).
      // The raw form is served same-origin from the apex on every deployment.
      // fetchAppContentBase64 also sends the owner token (imports the owner's own
      // protected/operator-hidden apps) and produces byte-accurate base64.
      return fetchAppContentBase64(aimeatUrl, sa.owner || '', sa.filename)
        .then(function (b64) {
          var manifest = sa.manifest || {};
          var app = {
            id: generateId(),
            name: manifest.name || sa.filename,
            description: manifest.description || '',
            source: 'aimeat',
            origin: 'ai-published',
            url: null,
            blob: b64,
            tags: manifest.tags || [],
            openMode: 'tab',
            icon: manifest.icon || '\u{1F916}',
            screenshot: null,
            favorite: false,
            addedAt: sa.created_at || new Date().toISOString(),
            lastOpenedAt: null,
            published: true,
            publishedFilename: sa.filename,
            publishedAt: sa.created_at || new Date().toISOString(),
            publishedUrl: '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(sa.filename),
            publishedVersionNumber: sa.version_number || 1
          };
          return saveApp(app);
        })
        .catch(function (err) { failed.push({ filename: sa.filename, error: (err && err.message) || String(err) }); return null; });
    })).then(function () { return { imported: toImport.length - failed.length, failed: failed }; });
  }

  // Manifest cache keyed by "owner\nfilename" — lets Restore/Fork reuse the
  // app's metadata (name, description, category, tags, icon) without a re-fetch.
  var serverAppManifests = {};

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
    } catch(e) {}

    getAllApps().then(function(apps) {
      var localPublished = apps.filter(function(a) { return a.published; });

      var localByFilename = {};
      for (var i = 0; i < localPublished.length; i++) {
        var lp = localPublished[i];
        if (lp.publishedFilename) {
          localByFilename[lp.publishedFilename] = lp;
        }
      }

      if (!aimeatUrl) {
        ownServerApps = [];
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
          serverAppManifests = {};
          for (var mi = 0; mi < serverApps.length; mi++) {
            var msa = serverApps[mi];
            serverAppManifests[(msa.owner || '') + '\n' + (msa.filename || '')] = msa.manifest || {};
          }

          var ownApps = currentOwner
            ? serverApps.filter(function(a) { return sameOwner(a.owner, currentOwner); })
            : [];
          var communityApps = currentOwner
            ? serverApps.filter(function(a) { return !sameOwner(a.owner, currentOwner); })
            : serverApps;

          // ownPublished (for the import banner) vs ownParked — both feed the unified grid.
          var ownPublished = ownApps.filter(function(a) { return !a.parked; });

          return loadSubdomainSites().then(function () {
            // Unified Kirjasto grid: cache the owner's server apps (published + parked) so
            // renderApps() merges them with local apps into ONE card per app (deduped by
            // filename; buildLibraryEntries handles the parked/published state). Logged out →
            // no owner server apps (a visitor browses everything under Community).
            ownServerApps = currentOwner ? ownApps : [];
            renderApps();
            renderCommunityApps(communityApps, aimeatUrl, communitySection, communityGrid, communityCountEl, currentOwner);
            applyServerFilter(); // re-apply any active search/tag to the community cards
            // Server-published own apps missing from the local catalog are NEVER imported
            // automatically — the banner offers a review modal to pick which ones to import.
            updateServerImportState(ownPublished, localByFilename, aimeatUrl);
          });
        })
        .catch(function() {
          ownServerApps = [];
          renderApps();
          if (communitySection) communitySection.style.display = 'none';
        });
    });
  }

  // Build a data-filter/data-tags attribute pair so applyServerFilter() can match a server card
  // against the search query (name + tags substring) and the active tag (exact) without a re-fetch.

  // Apply the current searchQuery + activeTag to the Community grid. (Your own apps live in the
  // unified #app-grid, which renderApps() filters directly; Community is the one server section
  // left, so its cards still need this pass so a search matches community apps too.)
  function applyServerFilter() {
    var q = (searchQuery || '').toLowerCase();
    var at = activeTag;
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
    for (var i = 0; i < serverApps.length; i++) {
      var sa = serverApps[i];
      var name = (sa.manifest && sa.manifest.name) ? sa.manifest.name : (sa.filename || '');
      var version = sa.version_number ? 'v' + sa.version_number : '';
      var description = (sa.manifest && sa.manifest.description) ? sa.manifest.description : '';
      var date = sa.created_at ? new Date(sa.created_at).toLocaleDateString() : '';
      var author = (sa.manifest && sa.manifest.authorDisplay) ? sa.manifest.authorDisplay : (sa.owner || '');
      var viewUrl = aimeatUrl + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(sa.filename || '');
      html +=
        '<div class="published-card"' + filterAttr(name, (sa.manifest && sa.manifest.tags) || []) + '>' +
          '<div class="published-card-name">' + escapeHtml(name) + '</div>' +
          (description ? '<div class="published-card-desc">' + escapeHtml(description) + '</div>' : '') +
          '<div class="published-card-footer">' +
            '<div class="published-card-metaline">' +
              '<span class="pcm-main" style="color:var(--accent)">&#x1F464; ' + escapeHtml(author) + '</span>' +
              (date ? '<span class="pcm-date">' + date + '</span>' : '') +
            '</div>' +
            '<div class="published-card-actions">' +
              '<button onclick="window._launcher.viewPublished(\'' + escapeHtml(viewUrl) + '?mode=inline\', \'' + jsArg(name) + '\')">' + t('card.view') + '</button>' +
              // Fork is offered on a community (someone else's) app only when its owner
              // marked it forkable; otherwise the server would reject the fork (403).
              (sa.forkable
                ? '<button onclick="window._launcher.forkVersion(\'' + escapeHtml(sa.owner || '') + '\', \'' + escapeHtml(sa.filename || '') + '\', ' + (sa.version_number || 0) + ')" title="' + escapeHtml(t('card.forkHint')) + '">' + t('card.fork') + '</button>'
                : '') +
            '</div>' +
            ((version || (sa.forks && sa.forks > 0))
              ? '<div class="published-card-badgerow">'
                + ((sa.forks && sa.forks > 0)
                  ? '<span class="pcb-forks" title="' + escapeHtml(t('card.forksHint')) + '" onclick="window._launcher.showLineageModal(\'' + escapeHtml(sa.owner || '') + '\', \'' + escapeHtml(sa.filename || '') + '\')">⑂ ' + sa.forks + '</span>'
                  : '')
                + (version ? '<span class="pcb-version">' + escapeHtml(version) + '</span>' : '')
                + '</div>'
              : '') +
          '</div>' +
        '</div>';
    }
    grid.innerHTML = html;
    updateCommunityEmpty();
  }

  // Render the owner's PARKED apps in their own section. A parked app is hidden from
  // the public catalogue but stays fully usable by the owner; the primary action here
  // is Publish (unpark), which moves it back into Published Apps.
  async function unpublishApp(appId) {
    if (!(await showConfirm(t('confirm.removePublished')))) return;

    var app = null;
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === appId) { app = allApps[i]; break; }
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
          removeImportIgnore(app.publishedFilename);
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
          if (serverStateByFilename[filename]) serverStateByFilename[filename].parked = !!parked;
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
          if (serverStateByFilename[filename]) serverStateByFilename[filename].forkable = !!forkable;
          loadPublishedApps();
          refreshServerMgmt();
        } else {
          showNotice('Failed: ' + (json.error && json.error.message ? json.error.message : 'Unknown error'));
        }
      })
      .catch(function(err) { showNotice('Error: ' + (err.message || err)); });
  }

  async function deleteServerApp(filename) {
    if (!(await showConfirm(t('confirm.deleteFromServer').replace('{file}', function () { return filename; })))) return;
    var config = loadConfig();
    var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
    var token = getCortexOwnerToken();
    if (!token) { showNotice('You must be logged in to delete apps. Sign in first.'); return; }
    fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(filename), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    })
      .then(function(resp) { return resp.json(); })
      .then(function(json) {
        if (json.ok) {
          removeImportIgnore(filename); // a future republish should import again
          loadPublishedApps();
        } else {
          showNotice('Failed to delete: ' + (json.error && json.error.message ? json.error.message : 'Unknown error'));
        }
      })
      .catch(function(err) { showNotice('Error: ' + (err.message || err)); });
  }

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


