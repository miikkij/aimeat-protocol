/**
 * @file detail.js
 * @description The App Detail view — the biggest feature block (status / about+inline-edit /
 *   edit-with-AI loop / versions+restore+fork / fork-lineage / copy-protection / manage-on-server /
 *   skills) plus the thin sign-in-pill wiring (mountLoginPill wraps the shared aimeat-auth SDK pill;
 *   onAuthChanged re-renders on login). Carved out of main.js. Depends on the shared modules by
 *   import; the ~14 main-local functions + the 3 live state getters + the iframe setter it needs are
 *   injected once via initDetail(deps) — so there is no import cycle back through the entry module.
 * @usage import { initDetail, openDetailView, mountLoginPill, ... } from './detail.js'; initDetail({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 7).
 */
import { escapeHtml, jsArg, sourceLabel, sourceLabelText, currentOwnerName } from './util.js';
import { saveApp, deleteApp, getDbMode, setDbMode, closeDbInstance } from './db.js';
import { dtlBtn, showConfirm, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t } from './i18n.js';

// Injected once at bootstrap by main.js. Functions are main-local; the get* return main's LIVE
// state (so reads + in-place mutations propagate across the reassignments main does each render).
let refreshAll, loadPublishedApps, renderApps, updateModeToggle, getCortexOwnerToken, launchApp, viewPublished, viewSource, generateId, generateSharePrompt, openPromptBuilder, showPublishModal, addImportIgnore, removeImportIgnore, getMainApps, getServerState, getServerManifests, getOwnProtection, setIframeUrl, isOperatorSession;
export function initDetail(deps) {
  ({ refreshAll, loadPublishedApps, renderApps, updateModeToggle, getCortexOwnerToken, launchApp, viewPublished, viewSource, generateId, generateSharePrompt, openPromptBuilder, showPublishModal, addImportIgnore, removeImportIgnore, getMainApps, getServerState, getServerManifests, getOwnProtection, setIframeUrl, isOperatorSession } = deps);
}

// ── App Detail View ───────────────────────────────
// One unified overlay per app: merges the local IndexedDB copy with the
// published AppRecord, surfaces every action, and hosts a live AI edit loop
// (describe → /v1/ai/complete on the user's own OpenRouter key → draft local
// version → test → keep/discard → optional one-click publish).

var detailAppId = null;
var detailDraftBlob = null;   // base64 of the pending AI-generated draft (never overwrites app.blob until Keep)
var detailAiAvailable = false;
var detailVersionsHtml = null; // cached rendered versions list, survives re-renders
var detailSkillsHtml = null;   // cached rendered bound-skills list (skills registry, 2d)
var detailEditingAbout = false; // true while the About name/description inline editor is open
var detailEditAboutOnOpen = false; // when set, open the About editor as soon as the detail view renders

function detailGetApp() {
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].id === detailAppId) return getMainApps()[i];
  }
  return null;
}

// The owner to use for server calls on a detail app. The owner baked into publishedUrl/aimeatOwner
// can be STALE — e.g. an app re-owned away from the legacy "anonymous" bucket keeps "anonymous" in
// the locally-stored copy, which then 404s screenshot/version calls. So: prefer the signed-in owner
// when it already owns the app, or when the stored owner is the "anonymous" bucket (re-owned to you);
// otherwise keep the stored owner so browsing ANOTHER user's published app still resolves.
function detailServerOwner(app) {
  var sess = currentOwnerName();
  var stored = (app && app.aimeatOwner) || '';
  if (!stored) {
    var pu = (app && (app.publishedUrl || app.viewUrl)) || '';
    var mm = pu.match(/\/v1\/apps\/([^/]+)\//);
    stored = mm ? decodeURIComponent(mm[1]) : '';
  }
  if (sess && (!stored || stored === 'anonymous' || stored === sess)) return sess;
  return stored;
}

function blobToHtml(blob) {
  try { return decodeURIComponent(escape(atob(blob))); } catch (e) { return ''; }
}
function htmlToBlob(html) {
  return btoa(unescape(encodeURIComponent(html)));
}

// The "Manage on server" buttons as inner HTML (empty when the app isn't an own server app).
// Kept separate so a park/fork toggle can re-render JUST these buttons in place — no full detail
// re-render (which would rebuild the whole version list and jump the scroll).
function serverMgmtInner(app) {
  if (!app) return '';
  var isUrlApp = (app.source === 'url' && !app.blob);
  var svrState = (app.publishedFilename && getServerState()[app.publishedFilename]) || null;
  if (!(app.published && app.publishedFilename && svrState && !isUrlApp)) return '';
  var fnArg = jsArg(app.publishedFilename);
  var ownerArg2 = jsArg(svrState.owner || '');
  var p = svrState.protection || {};
  var anyProt = p.obfuscate || p.domainLock || p.watermark || p.noRawDownload;
  return '<div class="dtl-section">' +
      '<h3>' + t('detail.serverMgmt') + '</h3>' +
      '<div class="dtl-btn-row">' +
        (svrState.parked
          ? dtlBtn(t('card.unpark'), 'window._launcher.toggleParkApp(\'' + fnArg + '\', false)', {title: t('card.unparkHint')})
          : dtlBtn(t('card.park'), 'window._launcher.toggleParkApp(\'' + fnArg + '\', true)', {title: t('card.parkHint')})) +
        dtlBtn(t(svrState.forkable ? 'card.forkableOn' : 'card.forkableOff'), 'window._launcher.toggleForkApp(\'' + fnArg + '\', ' + (svrState.forkable ? 'false' : 'true') + ')', {title: t(svrState.forkable ? 'card.forkableOnHint' : 'card.forkableOffHint')}) +
        dtlBtn((anyProt ? '🛡✓ ' + t('card.protect') : t('card.protect')), 'window._launcher.showProtectionModal(\'' + fnArg + '\')', {title: t('card.protectHint')}) +
        dtlBtn(t('card.versions'), 'window._launcher.showVersionsModal(\'' + ownerArg2 + '\', \'' + fnArg + '\')') +
        // Who did I grant access to this app (H-2 app-grant consents): owner-level, any owner.
        dtlBtn(t('card.consents'), 'window._launcher.openConsents(\'' + ownerArg2 + '\', \'' + fnArg + '\', \'' + jsArg(app.name || app.publishedFilename) + '\')', {title: t('card.consentsHint')}) +
        // Manual subdomain assignment is operator-only (/v1/admin/subdomains); auto-assign covers
        // everyone else, so only show this to operators.
        ((isOperatorSession && isOperatorSession())
          ? dtlBtn(t('card.subdomain'), 'window._launcher.showSubdomainModal(\'' + ownerArg2 + '\', \'' + fnArg + '\')', {title: t('card.subdomainHint')})
          : '') +
        dtlBtn(t('card.removeServer'), 'window._launcher.deleteServerApp(\'' + fnArg + '\')', {variant:'danger'}) +
      '</div>' +
    '</div>';
}

// Re-render ONLY the "Manage on server" buttons in place after a park/fork toggle — the rest of
// the open detail (version list, scroll position, screenshot) is left untouched.
function refreshServerMgmt() {
  var c = document.getElementById('detail-server-mgmt');
  if (c) c.innerHTML = serverMgmtInner(detailGetApp());
}

function openDetailView(appId) {
  detailAppId = appId;
  detailDraftBlob = null;
  detailVersionsHtml = null;
  detailSkillsHtml = null;
  detailEditingAbout = false;
  var app = detailGetApp();
  if (!app) return;
  document.getElementById('detail-view').hidden = false;
  renderDetailView();
  // AI availability + published versions load asynchronously and re-render in place.
  detailCheckAiAvailability();
  var owner = currentOwnerName();
  if (app.published && app.publishedFilename && owner) {
    detailLoadVersions(owner, app.publishedFilename);
    detailLoadSkills(detailServerOwner(app) || owner, app.publishedFilename);
  }
  // Opened via a pencil ("edit the name") → jump straight into the About editor.
  if (detailEditAboutOnOpen) {
    detailEditAboutOnOpen = false;
    detailAboutEdit();
  }
}

// Open an app's detail view with the name/description editor already open. Used by
// the pencil icons on the cards so editing starts right where the name is shown.
function editAppDetails(owner, filename, localId, versionNumber) {
  detailEditAboutOnOpen = true;
  openPublishedDetail(owner, filename, localId, versionNumber);
}

function closeDetailView() {
  document.getElementById('detail-view').hidden = true;
  detailAppId = null;
  detailDraftBlob = null;
}

function detailLaunch() {
  var app = detailGetApp();
  if (!app) return;
  // A published app opens TOP-LEVEL on its served URL (clean full page on the app origin), like
  // the old "View" — launching the local blob in the sandbox iframe breaks app-origin apps.
  // Prefer the stored publishedUrl; a materialized server app may only have the filename, so
  // fall back to constructing /v1/apps/<owner>/<filename> from the cached server state.
  if (app.published && (app.publishedUrl || app.publishedFilename)) {
    var base = (loadConfig().aimeatUrl || '').replace(/\/+$/, '');
    var url;
    if (app.publishedUrl) {
      url = base + app.publishedUrl;
    } else {
      var st = getServerState()[app.publishedFilename] || {};
      var owner = st.owner || currentOwnerName() || '';
      url = base + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(app.publishedFilename);
    }
    viewPublished(url + '?mode=inline', app.name);
  } else {
    launchApp(app.id, app.openMode || 'tab');
  }
}


// ── Sign-in control (top bar) — the shared golden login pill ──────────────
// Reuses /v1/libs/aimeat-auth.js (the SAME login pill the SPA + standalone
// header use), mounted into #headerAuth. It owns the in-page login modal,
// session restore, and logout — identical to the rest of AIMEAT. Once it loads,
// currentOwnerName()/getCortexOwnerToken() resolve via window.AIMEAT.auth, and
// publishing an app REQUIRES that session (see submitPublish) so anonymous apps
// never reach the node.
function loadScriptOnce(src) {
  return new Promise(function (resolve, reject) {
    if (document.querySelector('script[src="' + src + '"]')) return resolve();
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { resolve(); };
    s.onerror = function () { reject(new Error('failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

function onAuthChanged() {
  // Personal mode is per-account: if the user signed OUT while in it, fall back to Global — it
  // would otherwise silently show the shared Global DB.
  if (getDbMode() === 'personal' && !currentOwnerName()) {
    setDbMode('global');
  }
  // The per-account IndexedDB changes with the signed-in owner, so re-open it and re-render the
  // LOCAL grid + tags too — not just the server sections (the stale-grid-after-login bug).
  closeDbInstance();
  updateModeToggle();
  try { refreshAll(); } catch (e) { try { loadPublishedApps(); } catch (e2) {} }
  var sub = document.getElementById('publish-submit-btn');
  var st = document.getElementById('publish-status');
  if (sub && document.getElementById('publish-overlay') && !document.getElementById('publish-overlay').hidden) {
    if (getCortexOwnerToken()) { sub.disabled = false; if (st) st.textContent = ''; }
    else { sub.disabled = true; if (st) { st.textContent = t('publish.loginRequired'); st.style.color = 'var(--accent)'; } }
  }
}

async function mountLoginPill() {
  try {
    await loadScriptOnce('/v1/libs/aimeat-auth.js');
    if (window.AIMEAT && window.AIMEAT.auth) {
      // Restore any existing session (refresh cookie / persisted token) first.
      try { await window.AIMEAT.auth.login(); } catch (e) { /* not logged in yet */ }
      if (window.AIMEAT.auth.mountLoginButton) {
        window.AIMEAT.auth.mountLoginButton('#headerAuth', {
          onLogin: onAuthChanged,
          onLogout: onAuthChanged,
          i18n: {
            loggedIn: t('auth.loggedIn'),
            signInBtn: t('auth.signIn'),
            logoutBtn: t('auth.logout')
          }
        });
      }
    }
  } catch (e) { /* pill is best-effort; publishing still hard-gates on the token */ }
}

function fmtSize(bytes) {
  if (!bytes) return '—';
  return bytes < 1024 ? bytes + ' B'
    : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB'
    : (bytes / 1048576).toFixed(1) + ' MB';
}

function renderDetailView() {
  var app = detailGetApp();
  if (!app) return;
  var config = loadConfig();
  var hasServer = !!config.aimeatUrl;
  var icon = app.icon || '\u{1F4DD}';
  var isUrlApp = (app.source === 'url' && !app.blob);
  // The name + description are editable in place (see the About section). A pencil
  // next to the title opens that editor right where the name is shown.
  var canEditAbout = !!app.id && !isUrlApp;

  document.getElementById('detail-title').innerHTML =
    '<span style="font-size:1.3rem">' + escapeHtml(icon) + '</span> ' + escapeHtml(app.name || 'App') +
    ((canEditAbout && !detailEditingAbout) ? ' <button class="rename-pencil" style="font-size:1rem" title="' + escapeHtml(t('detail.editDetails')) + '" onclick="window._launcher.detailAboutEdit()">✏️</button>' : '');

  // ── STATUS ──
  var localBytes = app.blob ? Math.round(app.blob.length * 0.75) : 0; // base64 → bytes approx
  var publishedV = app.publishedVersionNumber ? ('v' + app.publishedVersionNumber) : (app.published ? 'v?' : t('detail.notPublished'));
  var syncClass, syncText;
  if (!app.published) { syncClass = 'none'; syncText = t('detail.notPublished'); }
  else if (detailDraftBlob) { syncClass = 'diff'; syncText = t('detail.localNewer'); }
  else { syncClass = 'ok'; syncText = t('detail.inSync'); }

  // App thumbnail (right side of the Status card). Built from the published path; hides itself if
  // the app has no screenshot yet. Cache-busted so a freshly (re)captured shot isn't shown stale.
  var aimeatBase = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
  var shotOwner = detailServerOwner(app);
  var shotFile = app.publishedFilename || '';
  var shotUrl = (app.published && shotOwner && shotFile && aimeatBase)
    ? (aimeatBase + '/v1/apps/' + encodeURIComponent(shotOwner) + '/' + encodeURIComponent(shotFile) + '/screenshot?t=' + Date.now())
    : '';
  var shotImg = shotUrl
    ? '<img src="' + escapeHtml(shotUrl) + '" alt="App screenshot" loading="lazy" onerror="this.style.display=\'none\'" style="max-width:260px;max-height:160px;border-radius:8px;border:1px solid var(--border-subtle);object-fit:cover;object-position:top center;flex:none" />'
    : '';

  var statusHtml =
    '<div class="dtl-section">' +
      '<h3>' + t('detail.status') + '</h3>' +
      '<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:200px">' +
          '<div class="dtl-status-row">' +
            '<div class="dtl-stat"><span class="dtl-stat-label">' + t('detail.statusLocal') + '</span><span class="dtl-stat-val">' + (app.blob ? fmtSize(localBytes) : (isUrlApp ? 'URL' : '—')) + '</span></div>' +
            '<div class="dtl-stat"><span class="dtl-stat-label">' + t('detail.statusPublished') + '</span><span class="dtl-stat-val">' + escapeHtml(publishedV) + '</span></div>' +
          '</div>' +
          '<span class="dtl-sync ' + syncClass + '">' + escapeHtml(syncText) + '</span>' +
        '</div>' +
        shotImg +
      '</div>' +
    '</div>';

  // ── ABOUT ──
  // The display name + description are editable in place here (inline editor) —
  // the app's URL is keyed off owner/filename, so a rename never moves the link.
  // Editing is offered for the owner's own apps (a local record always exists once
  // the detail view is open); Save PATCHes the server when the app is published.
  var tags = (app.tags && app.tags.length) ? app.tags.join(', ') : '—';
  var cortex = (app.usesCortex && app.usesCortex.length) ? app.usesCortex.join(', ') : '—';
  var created = app.addedAt ? new Date(app.addedAt).toLocaleString() : '—';
  var favBtn = app.blob
    ? '<button class="dtl-fav-btn" title="' + escapeHtml(t(app.favorite ? 'detail.unfavorite' : 'detail.favorite')) + '"'
        + ' onclick="window._launcher.detailToggleFavorite()">' + (app.favorite ? '⭐' : '☆') + '</button>'
    : '';
  var aboutHeader =
    '<h3 style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span>' + t('detail.about') + '</span>' +
      '<span style="display:flex;align-items:center;gap:8px">' +
        favBtn +
        ((canEditAbout && !detailEditingAbout) ? dtlBtn(t('detail.editDetails'), 'window._launcher.detailAboutEdit()') : '') +
      '</span>' +
    '</h3>';
  var aboutBody;
  if (detailEditingAbout) {
    aboutBody =
      '<label class="dtl-stat-label" for="detail-name-input">' + t('detail.nameLabel') + '</label>' +
      '<input id="detail-name-input" class="modal-input" maxlength="120" value="' + escapeHtml(app.name || '') + '" style="margin:4px 0 10px" />' +
      '<label class="dtl-stat-label" for="detail-desc-input">' + t('detail.descLabel') + '</label>' +
      '<textarea id="detail-desc-input" class="modal-input" rows="3" maxlength="2000" style="margin:4px 0 8px;resize:vertical">' + escapeHtml(app.description || '') + '</textarea>' +
      '<label class="dtl-stat-label" for="detail-icon-input">' + t('detail.iconLabel') + '</label>' +
      '<input id="detail-icon-input" class="modal-input" maxlength="4" value="' + escapeHtml(app.icon || '') + '" style="margin:4px 0 10px;text-align:center;font-size:1.2rem" />' +
      '<label class="dtl-stat-label" for="detail-tags-input">' + t('detail.tagsLabel') + '</label>' +
      '<input id="detail-tags-input" class="modal-input" value="' + escapeHtml((app.tags || []).join(', ')) + '" placeholder="tools, productivity" style="margin:4px 0 8px" />' +
      '<div class="dtl-sync none" style="margin:0 0 10px">' + t('detail.renameHint') + '</div>' +
      '<div class="dtl-btn-row">' +
        dtlBtn(t('detail.saveDetails'), 'window._launcher.detailAboutSave()', {variant:'primary'}) +
        dtlBtn(t('detail.cancelEdit'), 'window._launcher.detailAboutCancel()') +
      '</div>';
  } else {
    aboutBody =
      (app.description ? '<p class="dtl-desc">' + escapeHtml(app.description) + '</p>' : '') +
      '<div class="dtl-meta-grid">' +
        metaItem(t('detail.category'), app.category || 'utility') +
        metaItem(t('detail.tags'), tags) +
        metaItem(t('detail.sourceLabel'), sourceLabelText(app.source)) +
        metaItem(t('detail.size'), app.blob ? fmtSize(localBytes) : '—') +
        metaItem(t('detail.created'), created) +
        metaItem(t('detail.usesCortex'), cortex) +
        // Provenance: if this app was forked from another, credit the source app.
        (app.forkedFrom && app.forkedFrom.owner && app.forkedFrom.filename
          ? metaItem(t('detail.forkedFrom'), app.forkedFrom.owner + '/' + app.forkedFrom.filename
              + (app.forkedFrom.version ? ' v' + app.forkedFrom.version : ''))
          : '') +
      '</div>';
  }
  var aboutHtml = '<div class="dtl-section">' + aboutHeader + aboutBody + '</div>';

  // ── EDIT WITH AI ──
  var aiHtml =
    '<div class="dtl-section">' +
      '<h3>' + t('detail.editAi') + '</h3>' +
      '<p class="dtl-desc">' + t('detail.editAiHint') + '</p>';
  if (isUrlApp) {
    aiHtml += '<span class="dtl-sync none">' + t('detail.urlCantEdit') + '</span>';
  } else {
    aiHtml +=
      '<div class="dtl-ai-row">' +
        '<textarea id="detail-ai-input" placeholder="' + escapeHtml(t('detail.editAiPh')) + '"' + (detailAiAvailable ? '' : ' disabled') + '></textarea>' +
        dtlBtn(t('detail.run'), 'window._launcher.detailAiRun()', {variant:'primary', id:'detail-ai-run', disabled: !detailAiAvailable}) +
      '</div>' +
      '<div class="dtl-ai-status" id="detail-ai-status">' + (detailAiAvailable ? '' : escapeHtml(detailAiUnavailableMsg())) + '</div>' +
      '<div class="dtl-ai-draft" id="detail-ai-draft"' + (detailDraftBlob ? '' : ' hidden') + '>' +
        '<div class="dtl-ai-status" style="margin:0 0 8px">' + t('detail.draftReady') + '</div>' +
        '<div class="dtl-btn-row">' +
          // PUBLISHED app → the real-origin staging path (mic/camera work); the old opaque-
          // sandbox "Test" is dropped here to avoid two near-identical "Test" buttons. An
          // UNPUBLISHED app has no server draft slot yet, so it keeps the quick sandbox preview.
          (app.published
            ? dtlBtn(t('detail.testLive'), 'window._launcher.detailTestDraftLive()', {variant:'primary'}) +
              dtlBtn(t('detail.publishTested'), 'window._launcher.detailPublishTestedDraft()', {variant:'success'})
            : dtlBtn(t('detail.test'), 'window._launcher.detailAiTest()', {variant:'primary'})) +
          dtlBtn(t('detail.keep'), 'window._launcher.detailAiKeep()') +
          dtlBtn(t('detail.discard'), 'window._launcher.detailAiDiscard()') +
        '</div>' +
      '</div>';
  }
  aiHtml += '</div>';

  // ── VERSIONS ──
  var versionsHtml =
    '<div class="dtl-section">' +
      '<h3>' + t('detail.versions') + '</h3>' +
      '<div id="detail-versions-list">' +
        (detailVersionsHtml !== null ? detailVersionsHtml :
          (!hasServer ? '<span class="dtl-sync none">' + t('detail.needServerVersions') + '</span>'
           : (app.published ? '<span style="color:var(--text-muted);font-size:.85rem">' + t('detail.loadingVersions') + '</span>'
              : '<span style="color:var(--text-muted);font-size:.85rem">' + t('detail.noVersions') + '</span>'))) +
      '</div>' +
    '</div>';

  // ── ACTIONS ──
  var publishLabel = (app.published && app.publishedVersionNumber)
    ? (t('detail.publishAs') + ' v' + (app.publishedVersionNumber + 1))
    : t('detail.publish');
  var actionsHtml =
    '<div class="dtl-section">' +
      '<h3>' + t('detail.actions') + '</h3>' +
      '<div class="dtl-btn-row">' +
        (isUrlApp ? '' : dtlBtn(t('ctx.viewSource'), 'window._launcher.detailEditSource()')) +
        (isUrlApp ? '' : dtlBtn(t('ctx.improveAi'), 'window._launcher.detailImproveExternal()')) +
        dtlBtn(t('ctx.sharePrompt'), 'window._launcher.detailSharePrompt()') +
        (isUrlApp ? '' : dtlBtn(escapeHtml(publishLabel), 'window._launcher.detailPublish()', {variant:'primary'})) +
        (app.published && !isUrlApp ? dtlBtn('📷 ' + t('detail.setScreenshot'), 'window._launcher.detailSetScreenshot()', {title:'Upload a custom thumbnail for this app'}) : '') +
        (app.published && !isUrlApp ? dtlBtn('🔄 ' + t('detail.refreshScreenshot'), 'window._launcher.detailRefreshScreenshot()', {title:'Clear the screenshot; the node re-takes it on its next scheduled run'}) : '') +
        dtlBtn(t('ctx.delete'), 'window._launcher.detailDelete()', {variant:'danger'}) +
      '</div>' +
    '</div>';

  // ── SERVER MANAGEMENT (own published/parked apps) ──
  // Park/Unpark, fork permission, copy-protection, versions and remove-from-server used to
  // live on the published card; the unified card now shows only Open + Details, so these move
  // here (req: "card buttons 2-3, the rest in detail"). getServerState() is populated by
  // buildLibraryEntries from the authoritative server list.
  // Stable container so a park/fork toggle can re-render JUST these buttons (refreshServerMgmt)
  // instead of rebuilding the whole detail.
  var mgmtHtml = '<div id="detail-server-mgmt">' + serverMgmtInner(app) + '</div>';

  // ── SKILLS (skills registry, 2d) — expertise that teaches agents this app ──
  var skillsHtml = '';
  if (app.published) {
    skillsHtml =
      '<div class="dtl-section">' +
        '<h3>' + (t('detail.skills') || 'Skills for this app') + '</h3>' +
        '<div id="detail-skills-list">' +
          (detailSkillsHtml !== null ? detailSkillsHtml
            : '<span style="color:var(--text-muted);font-size:.85rem">…</span>') +
        '</div>' +
      '</div>';
  }

  document.getElementById('detail-body').innerHTML =
    statusHtml + aboutHtml + aiHtml + versionsHtml + skillsHtml + mgmtHtml + actionsHtml;
}

// Bound skills (skills registry): skills whose frontmatter metadata.binding names this app.
// Anonymous/visitor sessions see only publicly-visible skills; owners manage the bindings in
// the profile Apps tab (attach/detach) or the Skills tab (frontmatter). Best-effort: any
// error renders as "none".
function detailLoadSkills(owner, filename) {
  var config = loadConfig();
  if (!config.aimeatUrl) return;
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var noneHtml = '<span style="color:var(--text-muted);font-size:.85rem">' + (t('detail.noSkills') || 'No skills bound to this app yet. A skill teaches agents how to use the app — bind one from your profile Apps tab.') + '</span>';
  var skillHeaders = {};
  try {
    var jwt = (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession() && window.AIMEAT.auth.getSession().jwt)
      || (JSON.parse(localStorage.getItem('aimeat_session') || '{}').jwt);
    if (jwt) skillHeaders['Authorization'] = 'Bearer ' + jwt;
  } catch (e) {}
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/skills', { headers: skillHeaders })
    .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
    .then(function(json) {
      var listEl = document.getElementById('detail-skills-list');
      var skills = (json.data && json.data.skills) ? json.data.skills : [];
      if (skills.length === 0) { detailSkillsHtml = noneHtml; if (listEl) listEl.innerHTML = detailSkillsHtml; return; }
      var out = '';
      for (var i = 0; i < skills.length; i++) {
        var s = skills[i];
        out += '<div style="margin-bottom:.4rem">' +
          '<code>' + escapeHtml(s.ref || s.name) + '</code>' +
          ' <span style="color:var(--text-muted);font-size:.8rem">v' + escapeHtml(String(s.version || '')) + '</span>' +
          '<div style="color:var(--text-muted);font-size:.85rem">' + escapeHtml(s.description || '') + '</div>' +
        '</div>';
      }
      detailSkillsHtml = out;
      if (listEl) listEl.innerHTML = detailSkillsHtml;
    })
    .catch(function() {
      detailSkillsHtml = noneHtml;
      var listEl = document.getElementById('detail-skills-list');
      if (listEl) listEl.innerHTML = detailSkillsHtml;
    });
}

// ── About: inline name + description editing ──────
// Edit the display name/description right where they are shown. The URL is keyed
// off owner/filename, so this never changes the app link. Save updates the local
// record and, when the app is published, PATCHes /v1/apps/:filename in place.
function detailAboutEdit() {
  if (!detailGetApp()) return;
  detailEditingAbout = true;
  renderDetailView();
  var nameEl = document.getElementById('detail-name-input');
  if (nameEl) { nameEl.focus(); nameEl.select(); }
}

function detailAboutCancel() {
  detailEditingAbout = false;
  renderDetailView();
}

// Favorite toggle in the detail view (parity with the context-menu "Toggle favorite").
// Local metadata on the app record; re-renders the cards + the detail header star.
function detailToggleFavorite() {
  var app = detailGetApp();
  if (!app) return;
  app.favorite = !app.favorite;
  saveApp(app).then(function () {
    renderApps();
    renderDetailView();
  });
}

function detailAboutSave() {
  var app = detailGetApp();
  if (!app) return;
  var nameEl = document.getElementById('detail-name-input');
  var descEl = document.getElementById('detail-desc-input');
  var iconEl = document.getElementById('detail-icon-input');
  var tagsEl = document.getElementById('detail-tags-input');
  var newName = nameEl ? nameEl.value.trim() : '';
  var newDesc = descEl ? descEl.value.trim() : '';
  // icon + tags are LOCAL metadata (same as the context-menu Edit modal) — no server round-trip.
  var newIcon = iconEl ? iconEl.value.trim() : (app.icon || '');
  var newTags = tagsEl
    ? tagsEl.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    : (app.tags || []);
  if (!newName) { showNotice(t('detail.nameRequired') || 'Name cannot be empty.'); if (nameEl) nameEl.focus(); return; }
  if (app.published && !newDesc) { showNotice(t('detail.descRequired') || 'Description cannot be empty.'); if (descEl) descEl.focus(); return; }

  function finishLocal() {
    app.name = newName;
    app.description = newDesc;
    app.icon = newIcon;
    app.tags = newTags;
    saveApp(app).then(function() {
      detailEditingAbout = false;
      renderApps();
      loadPublishedApps();
      renderDetailView();
    });
  }

  // Not published on the server → it's a local-only record; just persist locally.
  if (!app.published || !app.publishedFilename) { finishLocal(); return; }

  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('common.loginRequired') || 'You must be logged in. Sign in first.'); return; }
  var config = loadConfig();
  var aimeatUrl = (config.aimeatUrl || '').replace(/\/+$/, '');
  var owner = detailServerOwner(app);
  var filename = app.publishedFilename;
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(filename), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName, description: newDesc })
  })
    .then(function(resp) { return resp.json().then(function(j) { return { ok: resp.ok, j: j }; }); })
    .then(function(res) {
      if (res.ok && res.j && res.j.ok !== false) {
        // Keep the cached server manifest in sync so a re-render shows the new name.
        var key = owner + '\n' + filename;
        getServerManifests()[key] = getServerManifests()[key] || {};
        getServerManifests()[key].name = newName;
        getServerManifests()[key].description = newDesc;
        finishLocal();
      } else {
        showNotice('Failed: ' + ((res.j && res.j.error && res.j.error.message) || 'Unknown error'));
      }
    })
    .catch(function(err) { showNotice('Error: ' + (err.message || err)); });
}

// Manual override: upload a custom image as this published app's thumbnail. (Bulk auto-capture is
// the server-side `aimeat screenshot-worker`; the browser can't grab the cross-origin sandboxed app
// itself, so this is a file picker, not an in-page capture.)
function detailSetScreenshot() {
  var app = detailGetApp();
  if (!app) return;
  var filename = app.publishedFilename || '';
  if (!filename) {
    var pu = app.publishedUrl || app.viewUrl || '';
    var m = pu.match(/\/v1\/apps\/[^/]+\/([^/?]+)/);
    if (m) filename = decodeURIComponent(m[1]);
  }
  var owner = detailServerOwner(app);
  var token = getCortexOwnerToken();
  if (!owner || !filename) { showNotice('Publish the app first, then you can set a screenshot.'); return; }
  if (!token) { showNotice('Sign in to set a screenshot.'); return; }
  var config = loadConfig();
  var aimeatUrl = (config.aimeatUrl || '').replace(/\/+$/, '');
  if (!aimeatUrl) { showNotice('No server configured.'); return; }
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = function() {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showNotice('Image too large (max 2 MB).'); return; }
    var reader = new FileReader();
    reader.onload = function() {
      var s = String(reader.result);
      var base64 = s.indexOf(',') >= 0 ? s.slice(s.indexOf(',') + 1) : s;
      fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ screenshot: base64, screenshot_mime_type: file.type || 'image/png' })
      })
        .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, j: j }; }); })
        .then(function(res) {
          if (res.ok) { showNotice('Screenshot set. It will show in the catalogue and on the landing wall.'); }
          else { showNotice('Failed: ' + ((res.j && res.j.error && res.j.error.message) || ('HTTP error'))); }
        })
        .catch(function(e) { showNotice('Failed: ' + e.message); });
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// System-side refresh: clear the current screenshot so the node's scheduled batch job re-takes it
// on its next run. Clearing is cheap (no on-demand render), which is what keeps this DoS-safe.
async function detailRefreshScreenshot() {
  var app = detailGetApp();
  if (!app) return;
  var filename = app.publishedFilename || '';
  if (!filename) {
    var pu = app.publishedUrl || app.viewUrl || '';
    var m = pu.match(/\/v1\/apps\/[^/]+\/([^/?]+)/);
    if (m) filename = decodeURIComponent(m[1]);
  }
  var owner = detailServerOwner(app);
  var token = getCortexOwnerToken();
  if (!owner || !filename) { showNotice('Publish the app first, then you can refresh its screenshot.'); return; }
  if (!token) { showNotice('Sign in to refresh the screenshot.'); return; }
  if (!(await showConfirm(t('confirm.clearScreenshot')))) return;
  var config = loadConfig();
  var aimeatUrl = (config.aimeatUrl || '').replace(/\/+$/, '');
  if (!aimeatUrl) { showNotice('No server configured.'); return; }
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/screenshot', {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function(r) { return r.json().then(function(j) { return { ok: r.ok, j: j }; }); })
    .then(function(res) {
      if (res.ok) { showNotice((res.j.data && res.j.data.note) || 'Screenshot cleared. A fresh one will be taken on the next scheduled run.'); }
      else { showNotice('Failed: ' + ((res.j && res.j.error && res.j.error.message) || 'HTTP error')); }
    })
    .catch(function(e) { showNotice('Failed: ' + e.message); });
}

function metaItem(label, val) {
  return '<div class="dtl-meta-item"><div class="dtl-meta-label">' + escapeHtml(label) + '</div>' +
    '<div class="dtl-meta-val">' + escapeHtml(val || '—') + '</div></div>';
}


function detailAiUnavailableMsg() {
  return getCortexOwnerToken() ? t('detail.aiUnavailable') : t('detail.aiLoginNeeded');
}

// Probe whether the signed-in owner has an OpenRouter key configured.
function detailCheckAiAvailability() {
  detailAiAvailable = false;
  var config = loadConfig();
  var token = getCortexOwnerToken();
  if (!config.aimeatUrl || !token) { renderDetailView(); return; }
  var url = config.aimeatUrl.replace(/\/+$/, '');
  fetch(url + '/v1/openrouter/settings', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function(r) { return r.json(); })
    .then(function(j) {
      detailAiAvailable = !!(j && j.data && (j.data.hasApiKey || j.data.has_api_key));
      if (detailAppId) renderDetailView();
    })
    .catch(function() { detailAiAvailable = false; if (detailAppId) renderDetailView(); });
}

function detailLoadVersions(owner, filename) {
  var config = loadConfig();
  if (!config.aimeatUrl) return;
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/versions')
    .then(function(resp) { if (!resp.ok) throw new Error('HTTP ' + resp.status); return resp.json(); })
    .then(function(json) {
      var listEl = document.getElementById('detail-versions-list');
      if (!listEl) return;
      var versions = json.data && json.data.versions ? json.data.versions : [];
      if (versions.length === 0) { detailVersionsHtml = '<span style="color:var(--text-muted);font-size:.85rem">' + t('detail.noVersions') + '</span>'; listEl.innerHTML = detailVersionsHtml; return; }
      var ownerArg = "'" + escapeHtml(owner).replace(/'/g, "\\'") + "'";
      var fileArg = "'" + escapeHtml(filename).replace(/'/g, "\\'") + "'";
      var html = '';
      for (var i = 0; i < versions.length; i++) {
        var v = versions[i];
        var isLatest = (i === 0);
        var kb = v.size ? (Math.round(v.size / 102.4) / 10) + ' KB' : '';
        var when = v.created_at ? new Date(v.created_at).toLocaleString() : '';
        var viewU = aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '?version=' + v.version_number + '&mode=inline';
        html +=
          '<div class="dtl-version-row">' +
            '<div class="version-meta"><span class="version-num">v' + v.version_number + (isLatest ? ' <span class="version-current">' + t('versions.current') + '</span>' : '') + '</span> ' +
              '<span class="version-sub" style="color:var(--text-muted);font-size:.8rem">' + (kb ? kb : '') + (when ? ' · ' + when : '') + '</span></div>' +
            '<div class="dtl-btn-row">' +
              dtlBtn(t('card.view'), 'window._launcher.viewPublished(\'' + escapeHtml(viewU) + '\', \'' + jsArg(filename) + '\')') +
              (isLatest ? '' : dtlBtn(t('card.restore'), 'window._launcher.restoreVersion(' + ownerArg + ', ' + fileArg + ', ' + v.version_number + ')')) +
              dtlBtn(t('card.fork'), 'window._launcher.forkVersion(' + ownerArg + ', ' + fileArg + ', ' + v.version_number + ')') +
            '</div>' +
          '</div>';
      }
      detailVersionsHtml = html;
      listEl.innerHTML = html;
    })
    .catch(function() {
      detailVersionsHtml = '<span style="color:var(--text-muted);font-size:.85rem">' + t('detail.noVersions') + '</span>';
      var listEl = document.getElementById('detail-versions-list');
      if (listEl) listEl.innerHTML = detailVersionsHtml;
    });
}

// ── Detail: live AI edit loop ─────────────────────

// Pull a complete HTML document out of a raw model reply (strips markdown
// fences / prose). Returns null if no usable document is present.
function extractHtmlFromAi(content) {
  if (!content) return null;
  var text = String(content).trim();
  // Strip a single leading/trailing markdown fence if present.
  var fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();
  var lower = text.toLowerCase();
  var startDoc = lower.indexOf('<!doctype');
  var startHtml = lower.indexOf('<html');
  var start = startDoc !== -1 ? startDoc : startHtml;
  if (start === -1) {
    // No doc markers — accept it only if it at least looks like markup.
    if (text.indexOf('<') !== -1 && text.indexOf('>') !== -1 && text.length > 30) return text;
    return null;
  }
  return text.slice(start);
}

function detailAiRun() {
  var app = detailGetApp();
  if (!app) return;
  var inputEl = document.getElementById('detail-ai-input');
  var statusEl = document.getElementById('detail-ai-status');
  var runBtn = document.getElementById('detail-ai-run');
  var change = (inputEl.value || '').trim();
  if (!change) { inputEl.focus(); return; }

  var token = getCortexOwnerToken();
  if (!token) { statusEl.textContent = t('detail.aiLoginNeeded'); return; }
  var config = loadConfig();
  if (!config.aimeatUrl) { statusEl.textContent = t('detail.aiUnavailable'); return; }
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');

  var html = app.blob ? blobToHtml(app.blob) : '';
  if (!html) { statusEl.textContent = t('detail.urlCantEdit'); return; }

  // Send the FULL source — no truncation. Modern models take multi-MB context, and cutting the
  // tail silently produced drafts missing the app's end (a big app like LOOM lost content).
  var systemPrompt = 'You are editing a single-file HTML web app that runs on the AIMEAT platform. '
    + 'You will be given the current full HTML source and a change request. '
    + 'Return the COMPLETE updated HTML document and NOTHING else — no explanations, no commentary, no markdown code fences. '
    + 'Preserve every existing AIMEAT integration (script tags loading /v1/libs/*, AIMEAT.* API calls, cortex extension scripts) unless the change specifically requires altering them. '
    + 'Keep the result a single self-contained file that supports both light and dark themes.';
  var userPrompt = 'Change request:\n' + change + '\n\nCurrent HTML source:\n' + html;

  runBtn.disabled = true;
  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = t('detail.running');

  fetch(aimeatUrl + '/v1/ai/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({
      prompt: userPrompt,
      systemPrompt: systemPrompt,
      app_id: 'app-catalog'
    })
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      runBtn.disabled = false;
      if (!json || !json.ok) {
        var code = (json && json.error && json.error.code) || '';
        var msg = (json && json.error && json.error.message) || 'AI request failed';
        statusEl.style.color = 'var(--accent)';
        statusEl.textContent = '✘ ' + (code ? '[' + code + '] ' : '') + msg;
        return;
      }
      var content = json.data && json.data.content ? json.data.content : '';
      var newHtml = extractHtmlFromAi(content);
      if (!newHtml) {
        statusEl.style.color = 'var(--accent)';
        statusEl.textContent = '✘ ' + t('detail.aiNoHtml');
        return;
      }
      detailDraftBlob = htmlToBlob(newHtml);
      statusEl.style.color = '#34d399';
      var usage = json.data && json.data.budget && typeof json.data.budget.spent_today_usd !== 'undefined'
        ? (' · ' + t('detail.aiUsage') + ': $' + Number(json.data.budget.spent_today_usd).toFixed(3)) : '';
      statusEl.textContent = '✔ ' + t('detail.draftReady') + usage;
      renderDetailView();
      // renderDetailView rebuilds the status line; restore the success message after.
      var s2 = document.getElementById('detail-ai-status');
      if (s2) { s2.style.color = '#34d399'; s2.textContent = '✔ ' + t('detail.draftReady') + usage; }
    })
    .catch(function(err) {
      runBtn.disabled = false;
      statusEl.style.color = 'var(--accent)';
      statusEl.textContent = '✘ ' + (err.message || 'AI request failed');
    });
}

function detailAiTest() {
  var app = detailGetApp();
  if (!app || !detailDraftBlob) return;
  // Launch the draft in the iframe overlay WITHOUT persisting it.
  var view = document.getElementById('iframe-view');
  var iframe = document.getElementById('app-iframe');
  var title = document.getElementById('iframe-title');
  title.textContent = (app.name || 'App') + ' (draft)';
  iframe.removeAttribute('src');
  iframe.srcdoc = blobToHtml(detailDraftBlob);
  setIframeUrl('');
  delete iframe.dataset.appId;
  view.hidden = false;
}

function detailAiKeep() {
  var app = detailGetApp();
  if (!app || !detailDraftBlob) return;
  app.blob = detailDraftBlob;
  app.source = app.source === 'url' ? 'paste' : (app.source || 'paste');
  app.url = app.url || null;
  detailDraftBlob = null;
  saveApp(app).then(function() {
    renderApps();
    renderDetailView();
    var s2 = document.getElementById('detail-ai-status');
    if (s2) { s2.style.color = '#34d399'; s2.textContent = '✔ ' + t('detail.kept'); }
  });
}

function detailAiDiscard() {
  detailDraftBlob = null;
  renderDetailView();
  var s2 = document.getElementById('detail-ai-status');
  if (s2) s2.textContent = t('detail.discarded');
}

// ── Draft (staging) on a REAL origin ──────────────────────────────────────────
// The old "Test draft" runs the pending edit in the sandbox iframe (opaque origin),
// where getUserMedia (mic/camera) is impossible. These two save the pending edit as a
// SERVER draft — a staging slot that leaves the live app untouched — and open it TOP-
// LEVEL on the isolated app origin, where it behaves exactly like the published app
// will (mic/camera prompts work). "Publish tested version" promotes the exact tested
// bytes to a new live version. Solves "test v19 before publishing, without breaking v18".

function draftApi(method, owner, filename, sub, body) {
  var cfg = loadConfig();
  if (!cfg.aimeatUrl) return Promise.reject(new Error('Set the AIMEAT server URL in Settings first'));
  var base = cfg.aimeatUrl.replace(/\/+$/, '');
  var path = '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/' + sub;
  return fetch(base + path, {
    method: method,
    headers: { 'Authorization': 'Bearer ' + getCortexOwnerToken(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(function (resp) {
    return resp.json().then(function (json) {
      if (!json.ok) throw new Error((json.error && (json.error.message || json.error.code)) || ('HTTP ' + resp.status));
      return json.data;
    });
  });
}

// Staging needs a PUBLISHED app (the server draft slot keys off owner/filename) and a
// signed-in owner. Returns { owner, filename } or null (with a notice) if not eligible.
function draftStageTarget(app, statusEl) {
  if (!app || !app.published || !app.publishedFilename) {
    if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = t('detail.draftNeedsPublished'); }
    else showNotice(t('detail.draftNeedsPublished'));
    return null;
  }
  if (!getCortexOwnerToken()) {
    if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = t('detail.draftNeedsSignin'); }
    else showNotice(t('detail.draftNeedsSignin'));
    return null;
  }
  return { owner: detailServerOwner(app), filename: app.publishedFilename };
}

// PUT the CURRENT working bytes (base64) as the server draft, mint a preview URL, and open
// it TOP-LEVEL on the real app origin (mic/camera work; the live app is untouched). One
// path shared by the AI loop AND the source editor — whatever bytes you hand it get staged.
function stageDraftAndPreview(app, contentB64, statusEl) {
  var tgt = draftStageTarget(app, statusEl);
  if (!tgt) return Promise.resolve(false);
  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('detail.draftUploading'); }
  return draftApi('PUT', tgt.owner, tgt.filename, 'draft', { content: contentB64 })
    .then(function () { return draftApi('POST', tgt.owner, tgt.filename, 'draft/preview-token'); })
    .then(function (data) {
      window.open(data.preview_url, '_blank', 'noopener');
      if (statusEl) { statusEl.style.color = '#34d399'; statusEl.textContent = '✔ ' + t('detail.draftOpened'); }
      return true;
    })
    .catch(function (err) {
      if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + (err.message || 'Draft preview failed'); }
      return false;
    });
}

// PUT the CURRENT working bytes THEN publish-draft — always promotes exactly these bytes,
// so there is no stale-slot window (you never publish an older staged version by accident).
// Confirms first. onDone(data) runs on success.
function publishDraftBytes(app, contentB64, statusEl, onDone) {
  var tgt = draftStageTarget(app, statusEl);
  if (!tgt) return;
  Promise.resolve(showConfirm(t('detail.draftPublishConfirm'))).then(function (ok) {
    if (!ok) return;
    if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('detail.draftUploading'); }
    draftApi('PUT', tgt.owner, tgt.filename, 'draft', { content: contentB64 })
      .then(function () { return draftApi('POST', tgt.owner, tgt.filename, 'publish-draft'); })
      .then(function (data) {
        if (statusEl) { statusEl.style.color = '#34d399'; statusEl.textContent = t('detail.draftPublished').replace('{v}', data.version_number); }
        if (onDone) onDone(data);
      })
      .catch(function (err) {
        if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + (err.message || 'Publish failed'); }
      });
  });
}

// ── AI-loop wrappers (stage the pending AI candidate `detailDraftBlob`) ──
function detailTestDraftLive() {
  var app = detailGetApp();
  if (!app || !detailDraftBlob) return;
  stageDraftAndPreview(app, detailDraftBlob, document.getElementById('detail-ai-status'));
}
function detailPublishTestedDraft() {
  var app = detailGetApp();
  if (!app || !detailDraftBlob) return;
  publishDraftBytes(app, detailDraftBlob, document.getElementById('detail-ai-status'), function () {
    detailDraftBlob = null;
    refreshAll();
    renderDetailView();
  });
}

// ── Source-editor wrappers (stage the CURRENT textarea content) ──
// The source editor is a global overlay opened from the context menu OR the detail view;
// it carries the app id in its dataset, so these look the app up there (not via detailAppId).
function sourceOverlayApp() {
  var overlay = document.getElementById('source-overlay');
  var id = overlay && overlay.dataset ? overlay.dataset.appId : '';
  if (!id) return null;
  var apps = getMainApps();
  for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return apps[i];
  return null;
}
function sourceCurrentB64() {
  var ta = document.getElementById('source-code');
  if (!ta) return null;
  try { return btoa(unescape(encodeURIComponent(ta.value))); } catch (e) { return null; }
}
function sourceTestDraftLive() {
  var app = sourceOverlayApp();
  var c = sourceCurrentB64();
  if (!app || c == null) return;
  stageDraftAndPreview(app, c, document.getElementById('source-draft-status'));
}
function sourcePublishTested() {
  var app = sourceOverlayApp();
  var c = sourceCurrentB64();
  if (!app || c == null) return;
  publishDraftBytes(app, c, document.getElementById('source-draft-status'), function () {
    // Keep the local working copy in sync with what we just published.
    app.blob = c;
    saveApp(app);
    refreshAll();
  });
}

// ── Detail: action shortcuts (reuse existing flows) ──

function detailEditSource() { var app = detailGetApp(); if (app) viewSource(app); }
function detailImproveExternal() { var app = detailGetApp(); if (app) openPromptBuilder(app); }
function detailSharePrompt() { var app = detailGetApp(); if (app) generateSharePrompt(app); }
function detailPublish() { if (detailAppId) showPublishModal(detailAppId); }
async function detailDelete() {
  var app = detailGetApp();
  if (!app) return;
  if (!(await showConfirm(t('confirm.deleteApp').replace('{name}', function () { return app.name || 'this app'; })))) return;
  if (app.publishedFilename) addImportIgnore(app.publishedFilename);
  var id = app.id;
  deleteApp(id).then(function() {
    closeDetailView();
    renderApps();
    loadPublishedApps();
  });
}

// Open Details for an OWN published card. If a local copy exists, open it
// directly. Otherwise the app was uploaded server-side (MCP/agent/VSCode) with
// no local copy — materialize one ON DEMAND (explicit user click, not a page-load
// import) by downloading the published HTML, so it shows up on the local side and
// becomes fully editable + republishable.
function openPublishedDetail(owner, filename, localId, versionNumber) {
  if (localId) { openDetailView(localId); return; }
  // Guard against a second materialize if one already maps to this filename.
  for (var i = 0; i < getMainApps().length; i++) {
    if (getMainApps()[i].publishedFilename === filename) { openDetailView(getMainApps()[i].id); return; }
  }
  var config = loadConfig();
  if (!config.aimeatUrl) { showNotice('Set the AIMEAT server URL in Settings first'); return; }
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var meta = getServerManifests()[owner + '\n' + filename] || {};

  fetchAppContentBase64(aimeatUrl, owner, filename)
    .then(function(b64) {
      var app = {
        id: generateId(),
        name: meta.name || filename.replace(/\.html?$/i, ''),
        description: meta.description || '',
        category: meta.category || 'utility',
        tags: meta.tags || [],
        usesCortex: meta.usesCortex || [],
        forkedFrom: meta.forkedFrom || null,
        icon: meta.icon || '\u{1F4DD}',
        source: 'aimeat',
        url: null,
        blob: b64,
        favorite: false,
        openMode: 'tab',
        addedAt: new Date().toISOString(),
        lastOpenedAt: null,
        published: true,
        publishedFilename: filename,
        publishedUrl: '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename),
        publishedVersionNumber: versionNumber || 1,
        publishedAt: new Date().toISOString(),
        aimeatOwner: owner,
        aimeatFilename: filename
      };
      removeImportIgnore(filename); // this app is now intentionally present locally
      return saveApp(app).then(function() {
        getMainApps().push(app);
        renderApps();
        loadPublishedApps();
        openDetailView(app.id);
      });
    })
    .catch(function(err) { showNotice('Could not load the published app: ' + (err.message || err)); });
}

// ── App Versions / Restore / Fork ─────────────────

// Fetch one app version's raw bytes and return them base64-encoded. Chunked
// String.fromCharCode avoids a call-stack overflow on large apps.
function fetchAppContentBase64(aimeatUrl, owner, filename, version) {
  var url = aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + (version ? '?version=' + version : '');
  var token = getCortexOwnerToken();
  var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
  return fetch(url, { headers: headers }).then(function(resp) {
    if (!resp.ok) throw new Error('Could not fetch app content (HTTP ' + resp.status + ')');
    return resp.arrayBuffer();
  }).then(function(buf) {
    var bytes = new Uint8Array(buf);
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

// ── Fork lineage: cross-owner tree of forks (ancestry + descendants) ──
function showLineageModal(owner, filename) {
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
  if (!aimeatUrl) { showNotice('Set AIMEAT server URL in Settings first'); return; }
  document.getElementById('lineage-title').textContent = filename;
  var summaryEl = document.getElementById('lineage-summary');
  var statusEl = document.getElementById('lineage-status');
  var treeEl = document.getElementById('lineage-tree');
  summaryEl.textContent = '';
  statusEl.textContent = t('lineage.loading') || 'Loading lineage…';
  statusEl.style.color = 'var(--text-muted)';
  treeEl.innerHTML = '';
  document.getElementById('lineage-overlay').hidden = false;

  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/lineage')
    .then(function(resp) { if (!resp.ok) throw new Error('Server returned ' + resp.status); return resp.json(); })
    .then(function(json) {
      var d = json.data || {};
      var nodes = d.nodes || [], edges = d.edges || [];
      statusEl.textContent = '';
      summaryEl.textContent = (t('lineage.direct') || 'Direct forks') + ': ' + (d.directForkCount || 0)
        + ' · ' + (t('lineage.total') || 'total descendants') + ': ' + (d.descendantCount || 0);
      if (nodes.length <= 1 && edges.length === 0) {
        treeEl.innerHTML = '<div style="color:var(--text-muted)">' + (t('lineage.none') || 'No forks yet — this app has not been forked.') + '</div>';
        return;
      }
      treeEl.innerHTML = renderLineageTree(d);
    })
    .catch(function(err) { statusEl.textContent = '✘ ' + (err.message || 'Failed to load lineage'); statusEl.style.color = 'var(--accent)'; });
}

function renderLineageTree(d) {
  var byId = {}; (d.nodes || []).forEach(function(n) { byId[n.id] = n; });
  var children = {}; var hasParent = {};
  (d.edges || []).forEach(function(e) { (children[e.from] = children[e.from] || []).push(e.to); hasParent[e.to] = true; });
  var roots = (d.nodes || []).filter(function(n) { return !hasParent[n.id]; }).map(function(n) { return n.id; });
  if (!roots.length && d.self) roots = [d.self];
  var seen = {};
  function renderNode(id, depth) {
    if (seen[id]) return ''; seen[id] = true;
    var n = byId[id]; if (!n) return '';
    var isSelf = (id === d.self);
    var when = n.forkedAt ? '<span class="lineage-when">' + escapeHtml(new Date(n.forkedAt).toLocaleDateString()) + '</span>' : '';
    var statusTxt = t('lineage.status.' + n.status) || n.status;
    var line = '<div class="lineage-node' + (isSelf ? ' self' : '') + '" style="margin-left:' + (depth * 16) + 'px">'
      + (depth > 0 ? '↳ ' : '') + escapeHtml(n.owner + '/' + n.filename) + (isSelf ? ' ●' : '')
      + '<span class="lineage-status ' + escapeHtml(n.status) + '">' + escapeHtml(statusTxt) + '</span>' + when
      + '</div>';
    var kids = children[id] || [];
    for (var i = 0; i < kids.length; i++) line += renderNode(kids[i], depth + 1);
    return line;
  }
  var html = '';
  for (var r = 0; r < roots.length; r++) html += renderNode(roots[r], 0);
  return html;
}

// ── Copy protection (opt-in, per-app) ──
// The filename -> protection map lives in main (populated as own cards render); read here via the
// injected getOwnProtection() getter (avoids escaping a JSON object through an inline onclick).
var protectionTarget = null;
function showProtectionModal(filename) {
  protectionTarget = { filename: filename };
  var p = getOwnProtection()[filename] || {};
  document.getElementById('protect-obfuscate').checked = !!p.obfuscate;
  document.getElementById('protect-domainLock').checked = !!p.domainLock;
  document.getElementById('protect-watermark').checked = !!p.watermark;
  document.getElementById('protect-noRawDownload').checked = !!p.noRawDownload;
  document.getElementById('protection-title').textContent = filename;
  document.getElementById('protection-status').textContent = '';
  document.getElementById('protection-overlay').hidden = false;
}

function saveProtection() {
  if (!protectionTarget) return;
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('common.loginRequired') || 'You must be logged in.'); return; }
  var protection = {
    obfuscate: document.getElementById('protect-obfuscate').checked,
    domainLock: document.getElementById('protect-domainLock').checked,
    watermark: document.getElementById('protect-watermark').checked,
    noRawDownload: document.getElementById('protect-noRawDownload').checked
  };
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var statusEl = document.getElementById('protection-status');
  statusEl.textContent = t('protect.saving') || 'Saving…';
  statusEl.style.color = 'var(--text-muted)';
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(protectionTarget.filename), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ protection: protection })
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        statusEl.textContent = '✔ ' + (t('protect.saved') || 'Saved');
        statusEl.style.color = '#34d399';
        loadPublishedApps();
        setTimeout(function() { document.getElementById('protection-overlay').hidden = true; }, 800);
      } else {
        statusEl.textContent = '✘ ' + ((json.error && json.error.message) || 'Failed');
        statusEl.style.color = 'var(--accent)';
      }
    })
    .catch(function(err) { statusEl.textContent = '✘ ' + (err.message || 'Error'); statusEl.style.color = 'var(--accent)'; });
}

function showVersionsModal(owner, filename) {
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : '';
  if (!aimeatUrl) { showNotice('Set AIMEAT server URL in Settings first'); return; }

  document.getElementById('versions-title').textContent = filename;
  var statusEl = document.getElementById('versions-status');
  var listEl = document.getElementById('versions-list');
  statusEl.textContent = 'Loading versions…';
  statusEl.style.color = 'var(--text-muted)';
  listEl.innerHTML = '';
  document.getElementById('versions-overlay').hidden = false;

  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/versions')
    .then(function(resp) {
      if (!resp.ok) throw new Error('Server returned ' + resp.status);
      return resp.json();
    })
    .then(function(json) {
      var versions = json.data && json.data.versions ? json.data.versions : [];
      if (versions.length === 0) { statusEl.textContent = 'No versions found.'; return; }
      statusEl.textContent = versions.length + ' ' + t('versions.stored');
      statusEl.style.color = 'var(--text-muted)';

      var ownerArg = "'" + escapeHtml(owner).replace(/'/g, "\\'") + "'";
      var fileArg = "'" + escapeHtml(filename).replace(/'/g, "\\'") + "'";
      var html = '';
      for (var i = 0; i < versions.length; i++) {
        var v = versions[i];
        var isLatest = (i === 0);
        var kb = v.size ? (Math.round(v.size / 102.4) / 10) + ' KB' : '';
        var when = v.created_at ? new Date(v.created_at).toLocaleString() : '';
        var viewU = aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '?version=' + v.version_number + '&mode=inline';
        html +=
          '<div class="version-row">' +
            '<div class="version-meta">' +
              '<span class="version-num">v' + v.version_number + (isLatest ? ' <span class="version-current">' + t('versions.current') + '</span>' : '') + '</span>' +
              '<span class="version-sub">' + escapeHtml(v.version || '') + (kb ? ' · ' + kb : '') + (when ? ' · ' + when : '') + '</span>' +
            '</div>' +
            '<div class="version-actions">' +
              '<button onclick="window._launcher.viewPublished(\'' + escapeHtml(viewU) + '\', \'' + jsArg(filename) + '\')">' + t('card.view') + '</button>' +
              (isLatest ? '' : '<button onclick="window._launcher.restoreVersion(' + ownerArg + ', ' + fileArg + ', ' + v.version_number + ')" title="Re-publish this version as the new latest">' + t('card.restore') + '</button>') +
              '<button onclick="window._launcher.forkVersion(' + ownerArg + ', ' + fileArg + ', ' + v.version_number + ')" title="Copy this version into a new app">' + t('card.fork') + '</button>' +
            '</div>' +
          '</div>';
      }
      listEl.innerHTML = html;
    })
    .catch(function(err) {
      statusEl.textContent = '✘ ' + (err.message || 'Failed to load versions');
      statusEl.style.color = 'var(--accent)';
    });
}

async function restoreVersion(owner, filename, version) {
  if (!(await showConfirm(t('confirm.restoreVersion').replace('{version}', String(version)).replace('{file}', function () { return filename; })))) return;
  var token = getCortexOwnerToken();
  if (!token) { showNotice('You must be logged in as the owner to restore a version. Sign in first.'); return; }
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var statusEl = document.getElementById('versions-status');
  statusEl.textContent = 'Restoring version ' + version + '…';
  statusEl.style.color = '#34d399';

  var meta = getServerManifests()[owner + '\n' + filename] || {};
  fetchAppContentBase64(aimeatUrl, owner, filename, version)
    .then(function(b64) {
      var body = {
        filename: filename,
        content: b64,
        mime_type: 'text/html',
        name: meta.name || filename.replace(/\.html?$/i, ''),
        description: meta.description || '',
        category: meta.category || 'utility',
        tags: meta.tags || [],
        uses_cortex: meta.usesCortex || []
      };
      if (meta.icon) body.icon = meta.icon;
      return fetch(aimeatUrl + '/v1/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(body)
      });
    })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        statusEl.textContent = '✔ Restored — now published as v' + (json.data.version_number || '?');
        statusEl.style.color = '#34d399';
        loadPublishedApps();
        setTimeout(function() { showVersionsModal(owner, filename); }, 500);
      } else {
        statusEl.textContent = '✘ ' + ((json.error && json.error.message) || 'Restore failed');
        statusEl.style.color = 'var(--accent)';
      }
    })
    .catch(function(err) {
      statusEl.textContent = '✘ ' + (err.message || 'Restore failed');
      statusEl.style.color = 'var(--accent)';
    });
}

function forkVersion(owner, filename, version) {
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('common.loginRequired') || 'You must be logged in to fork an app into your own catalogue. Sign in first.'); return; }
  var base = (filename || 'app').replace(/\.html?$/i, '');
  var suggested = base + '-fork.html';
  var newName = prompt(t('fork.prompt') || ('Fork "' + filename + '" into a new app.\n\nNew filename:'), suggested);
  if (!newName) return;
  newName = newName.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(newName)) {
    showNotice('Invalid filename. Use letters, numbers, dots, hyphens, underscores (max 100 chars).');
    return;
  }
  var config = loadConfig();
  var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
  var statusEl = document.getElementById('versions-status');
  var inVersionsModal = !document.getElementById('versions-overlay').hidden;
  if (inVersionsModal) { statusEl.textContent = 'Forking…'; statusEl.style.color = '#34d399'; }

  // Server-side fork: the server copies the source bytes + manifest, enforces the
  // forkable / paid-license gates, and records provenance (manifest.forkedFrom + a
  // lineage event). The client no longer downloads the bytes itself.
  var body = { new_filename: newName };
  if (version) body.version = version;
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(filename) + '/fork', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body)
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (json.ok) {
        var msg = '✔ ' + (t('fork.success') || 'Forked to') + ' "' + newName + '"';
        if (inVersionsModal) { statusEl.textContent = msg; statusEl.style.color = '#34d399'; }
        else showNotice(msg);
        loadPublishedApps();
      } else {
        var err = (json.error && json.error.message) || 'Fork failed';
        if (inVersionsModal) { statusEl.textContent = '✘ ' + err; statusEl.style.color = 'var(--accent)'; }
        else showNotice((t('fork.failed') || 'Fork failed') + ': ' + err);
      }
    })
    .catch(function(err) {
      var m = err.message || 'Fork failed';
      if (inVersionsModal) { statusEl.textContent = '✘ ' + m; statusEl.style.color = 'var(--accent)'; }
      else showNotice('Error: ' + m);
    });
}

export {
  refreshServerMgmt,
  openDetailView,
  editAppDetails,
  closeDetailView,
  detailLaunch,
  mountLoginPill,
  detailAboutEdit,
  detailAboutCancel,
  detailAboutSave,
  detailToggleFavorite,
  detailSetScreenshot,
  detailRefreshScreenshot,
  detailAiRun,
  detailAiTest,
  detailAiKeep,
  detailAiDiscard,
  detailTestDraftLive,
  detailPublishTestedDraft,
  sourceTestDraftLive,
  sourcePublishTested,
  detailEditSource,
  detailImproveExternal,
  detailSharePrompt,
  detailPublish,
  detailDelete,
  openPublishedDetail,
  fetchAppContentBase64,
  showLineageModal,
  showProtectionModal,
  saveProtection,
  showVersionsModal,
  restoreVersion,
  forkVersion
};
