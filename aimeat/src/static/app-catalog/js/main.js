/**
 * @file main.js
 * @description App-catalog entry module (bundled by scripts/build-app-catalog.ts into the
 *   served src/static/app-catalog.html). Holds catalog state, rendering, actions, and the
 *   window._launcher handler surface consumed by inline onclick in the markup. Carved from
 *   the former single inline <script>; further modules are split out incrementally.
 * @structure  imports (i18n data) → state → api → render → actions → window._launcher → init
 * @usage  built, not loaded raw: pnpm build:app-catalog
 * @version-history
 *   v2.0.0 — 2026-07-20 — Server-only cutover: drop the IndexedDB/Shared-Mine plumbing; wire the
 *     create-flow publish (initAppsIo showPublishModal) and the one-time legacy-local migration.
 */
import { t, getLang, setLang, applyI18n } from './i18n.js';
import { escapeHtml, jsArg, sourceLabel, sourceLabelText, bareOwnerName, sameOwner, filterAttr, isSameOriginUrl, currentOwnerName, generateId, readFileAsText } from './util.js';
import { getAllApps, saveApp, deleteApp } from './db.js';
import { showConfirm, closeConfirm, showNotice, dismissNotice, dtlBtn } from './ui.js';
import { loadConfig, saveConfig } from './config.js';
import { extractZip, bundleZip } from './zip.js';
import { initDetail, refreshServerMgmt, openDetailView, editAppDetails, closeDetailView, detailLaunch, mountLoginPill, detailAboutEdit, detailAboutCancel, detailAboutSave, detailTranslateDesc, detailPromoteSave, detailPromoteClear, detailToggleFavorite, detailAccessCodeEdit, detailAccessCodeCancel, detailAccessCodeSave, detailSkillAttachToggle, detailSkillAttach, detailSkillDetach, detailSetScreenshot, detailRefreshScreenshot, detailAiRun, detailAiTest, detailAiKeep, detailAiDiscard, detailTestDraftLive, detailPublishTestedDraft, detailWorkTry, detailWorkPublish, detailWorkDiscard, detailCheckpointPreview, detailCheckpointRestore, detailCheckpointDelete, saveSourceAsWorkingCopy, openStagingPreview, sourceTestDraftLive, sourcePublishTested, detailEditSource, detailImproveExternal, detailSharePrompt, detailPublish, detailDelete, openPublishedDetail, fetchAppContentBase64, showLineageModal, showProtectionModal, saveProtection, showVersionsModal, restoreVersion, forkVersion } from './detail.js';
import { monetizeAddTool, monetizeEditTool, monetizeCancelEdit, monetizeSaveTool, monetizeDeleteTool,
  odpsToggleDefaultsUi, odpsToggleToolUi, odpsSuggestUi, odpsSaveDefaults } from './monetize.js';
import { loadCortexExtensions, showCortexPopup, cortexCopy, getCortexOwnerToken, openCortexEditor, cortexEditorAddLib, cortexEditorSave, cortexEditorExport, closeCortexEditor, openPromptBuilder, closePbPanel, buildPromptFromBuilder, updatePbPreview } from './cortex.js';
import { initSettings, applyTheme, updateThemeToggle, toggleTheme, getThemePref, openSettings, saveSettings, syncConfigToServer, loadConfigFromServer, closeSettings, openHelp, closeHelp } from './settings.js';
import { initAppsIo, setEditingAppId, showModal, requireSignInThen, parseAppMeta, closeModal, switchTab, handleFileDrop, handleSave } from './apps-io.js';
import { initServerIo, isOperatorSession, showPublishModal, submitPublish, toggleCommunity, switchView, showSubdomainModal, submitSubdomainAssign, unassignSubdomain, closeConsents, openConsents, revokeConsent, toggleBackupMenu, toggleCreateMenu, closeCreateMenu, toggleCortexBar, exportBackupZip, importBackupPick, importBackupFile, backupUpdateSummary, backupSelectAll, submitBackupRestore, loadPublishedApps, refreshFavoritesUI, applyServerFilter, unpublishApp, toggleParkApp, toggleForkApp, deleteServerApp } from './server-io.js';
import { initRender, setServerManifests, setOwnServerApps, setIframeUrl, serverStateByFilename, serverAppManifests, ownAppProtection, ownServerApps, currentIframeUrl, renderTags, filterByTag, launchApp, launchInTab, viewPublished, launchInIframe, renderApps, closeIframe, openExternal, showContextMenu, hideContextMenu, handleContextAction, viewSource, generateSharePrompt, generateHomepagePrompt } from './render.js';
import { initAppAgents, showAppAgentsModal, agentsDeploy, agentsUndeploy } from './app-agents.js';
import { checkLegacyLocalApps } from './migrate.js';
import { toggleFavorite } from './favorites.js';


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
    try { loadCortexExtensions(); } catch (e) {}
    try { mountLoginPill(); } catch (e) {}  // re-render the golden pill in the new language
  }

  // ── Config → config.js (loadConfig / saveConfig, imported above) ──

  // ── generateId / readFileAsText → util.js (imported above) ──

  // ── ZIP subsystem → zip.js (extractZip / bundleZip, imported above) ──

  // ── App creation (zip/url/file/paste) + Add modal → apps-io.js (imported at top; initAppsIo) ──

  // ── Module-level state ──────────────────────────────

  var allApps = [];
  var activeTag = null;
  var searchQuery = '';

  // ── Helpers ────────────────────────────────────────




  // ── Rendering / tags / launch / context-menu / drag → render.js (initRender; owns server-derived state) ──

  // ── Theme / Settings / Help / Export-Import / dedup / Clear → settings.js (imported at top; initSettings) ──

  // ── Server I/O (publish/operator/grants/backup) → server-io.js (initServerIo) ──

  // ── App Detail view + sign-in pill → detail.js (imported at top; wired via initDetail) ──

  // ── Cortex (bar + editor + prompt builder) → cortex.js (imported at top) ──

  // ── Drag & Drop → render.js (onCardDrag*, imported) ──

  // ── Public API ────────────────────────────────────

  window._launcher = {
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
    setCurrentIframeUrl: function (url) { setIframeUrl(url); },
    showContextMenu: showContextMenu,
    hideContextMenu: hideContextMenu,
    handleContextAction: handleContextAction,
    generateId: generateId,
    readFileAsText: readFileAsText,
    showModal: showModal,
    closeModal: closeModal,
    openSettings: openSettings,
    openHelp: openHelp,
    closeHelp: closeHelp,
    saveSettings: saveSettings,
    closeSettings: closeSettings,
    applyTheme: applyTheme,
    viewSource: viewSource,
    generateHomepagePrompt: generateHomepagePrompt,
    showPublishModal: showPublishModal,
    submitPublish: submitPublish,
    loadPublishedApps: loadPublishedApps,
    // Toggle a server-backed favourite (ref = "owner/filename"), then re-render the ⭐ group + stars.
    toggleFavorite: function (ref) { toggleFavorite(ref).then(function () { try { refreshFavoritesUI(); } catch (e) {} }); },
    toggleCommunity: toggleCommunity,
    switchView: switchView,
    unpublishApp: unpublishApp,
    deleteServerApp: deleteServerApp,
    toggleParkApp: toggleParkApp,
    toggleForkApp: toggleForkApp,
    detailAboutEdit: detailAboutEdit,
    detailAboutCancel: detailAboutCancel,
    detailAboutSave: detailAboutSave,
    detailTranslateDesc: detailTranslateDesc,
    detailPromoteSave: detailPromoteSave,
    detailPromoteClear: detailPromoteClear,
    detailToggleFavorite: detailToggleFavorite,
    detailAccessCodeEdit: detailAccessCodeEdit,
    detailAccessCodeCancel: detailAccessCodeCancel,
    detailAccessCodeSave: detailAccessCodeSave,
    detailSkillAttachToggle: detailSkillAttachToggle,
    detailSkillAttach: detailSkillAttach,
    detailSkillDetach: detailSkillDetach,
    monetizeAddTool: monetizeAddTool,
    monetizeEditTool: monetizeEditTool,
    monetizeCancelEdit: monetizeCancelEdit,
    monetizeSaveTool: monetizeSaveTool,
    monetizeDeleteTool: monetizeDeleteTool,
    odpsToggleDefaults: odpsToggleDefaultsUi,
    odpsToggleTool: odpsToggleToolUi,
    odpsSuggest: odpsSuggestUi,
    odpsSaveDefaults: odpsSaveDefaults,
    editAppDetails: editAppDetails,
    showSubdomainModal: showSubdomainModal,
    openConsents: openConsents,
    closeConsents: closeConsents,
    revokeConsent: revokeConsent,
    submitSubdomainAssign: submitSubdomainAssign,
    unassignSubdomain: unassignSubdomain,
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
    showAppAgentsModal: showAppAgentsModal,
    agentsDeploy: agentsDeploy,
    agentsUndeploy: agentsUndeploy,
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
    detailTestDraftLive: detailTestDraftLive,
    detailPublishTestedDraft: detailPublishTestedDraft,
    detailWorkTry: detailWorkTry,
    detailWorkPublish: detailWorkPublish,
    detailWorkDiscard: detailWorkDiscard,
    detailCheckpointPreview: detailCheckpointPreview,
    detailCheckpointRestore: detailCheckpointRestore,
    detailCheckpointDelete: detailCheckpointDelete,
    openStagingPreview: openStagingPreview,
    detailEditSource: detailEditSource,
    detailImproveExternal: detailImproveExternal,
    detailSharePrompt: detailSharePrompt,
    detailPublish: detailPublish,
    detailDelete: detailDelete,
    detailSetScreenshot: detailSetScreenshot,
    detailRefreshScreenshot: detailRefreshScreenshot,
    openPublishedDetail: openPublishedDetail,
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
  }

  // ── Bootstrap ─────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Wire the detail module's injected deps (main-local fns + live state getters) BEFORE anything
    // can open the detail view or mount the login pill (whose onAuthChanged uses these).
    initDetail({
      refreshAll: refreshAll, loadPublishedApps: loadPublishedApps, renderApps: renderApps,
      updateModeToggle: function () {}, getCortexOwnerToken: getCortexOwnerToken, launchApp: launchApp,
      viewPublished: viewPublished, viewSource: viewSource, generateId: generateId,
      generateSharePrompt: generateSharePrompt, openPromptBuilder: openPromptBuilder,
      showPublishModal: showPublishModal,
      getMainApps: function () { return allApps; },
      getServerState: function () { return serverStateByFilename; },
      getServerManifests: function () { return serverAppManifests; },
      getOwnProtection: function () { return ownAppProtection; },
      setIframeUrl: setIframeUrl, isOperatorSession: isOperatorSession
    });
    initAppAgents({ getServerManifests: function () { return serverAppManifests; } });
    initSettings({ generateId: generateId, renderApps: renderApps, loadPublishedApps: loadPublishedApps });
    initAppsIo({ generateId: generateId, readFileAsText: readFileAsText, renderApps: renderApps, getMainApps: function () { return allApps; }, showPublishModal: showPublishModal });
    initServerIo({
      getMainApps: function () { return allApps; },
      getServerState: function () { return serverStateByFilename; },
      getServerManifests: function () { return serverAppManifests; },
      setServerManifests: setServerManifests,
      getOwnServerApps: function () { return ownServerApps; },
      setOwnServerApps: setOwnServerApps,
      getActiveTag: function () { return activeTag; },
      getSearchQuery: function () { return searchQuery; },
      generateId: generateId, renderApps: renderApps, refreshAll: refreshAll
    });
    initRender({
      getMainApps: function () { return allApps; },
      setAllApps: function (v) { allApps = v; },
      getActiveTag: function () { return activeTag; },
      setActiveTag: function (v) { activeTag = v; },
      getSearchQuery: function () { return searchQuery; }
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

    // One-time migration off the retired browser-local catalog: offer a JSON export of any apps
    // left in the old IndexedDB store, so the server-only cutover never silently loses them.
    try { checkLegacyLocalApps(); } catch (e) { /* migration is best-effort */ }

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
        } else if (!document.getElementById('publish-overlay').hidden) {
          document.getElementById('publish-overlay').hidden = true;
        } else if (!document.getElementById('subdomain-overlay').hidden) {
          document.getElementById('subdomain-overlay').hidden = true;
        } else if (!document.getElementById('backup-overlay').hidden) {
          document.getElementById('backup-overlay').hidden = true;
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

    // ── Save working copy ────────────────────────────
    // Delegates to detail.js saveSourceAsWorkingCopy: checkpoint the replaced bytes, then persist
    // to the app's server draft slot. (It used to only overwrite a transient in-memory blob, which
    // a reload discarded — the root of "my edits kept disappearing".)
    document.getElementById('save-source-btn').addEventListener('click', function() {
      var overlay = document.getElementById('source-overlay');
      var textarea = document.getElementById('source-code');
      var btn = this;
      if (!overlay.dataset.appId) { showNotice('Cannot save: no app ID found.'); return; }

      var newSource = textarea.value;
      var idle = t('source.save');
      btn.textContent = t('wc.saving');
      btn.disabled = true;

      saveSourceAsWorkingCopy().then(function() {
        btn.textContent = t('wc.savedShort');
        overlay.dataset.originalSource = newSource;
        setTimeout(function() { btn.textContent = idle; btn.disabled = true; }, 1500);
      }).catch(function(err) {
        btn.textContent = idle;
        btn.disabled = false;
        showNotice((t('wc.saveFailed') || 'Failed to save') + ': ' + ((err && err.message) || err));
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

    // ── Source-editor real-origin staging (published apps): same server-draft path as the
    //    AI loop, but from the edited textarea — test on a real origin, then publish. ──
    document.getElementById('source-test-live-btn').addEventListener('click', function () { sourceTestDraftLive(); });
    document.getElementById('source-publish-tested-btn').addEventListener('click', function () { sourcePublishTested(); });

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


