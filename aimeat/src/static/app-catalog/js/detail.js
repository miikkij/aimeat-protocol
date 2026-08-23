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
 *   v1.7.0 — 2026-08-17 — Delete deletes: the Actions button routes an own published app to the
 *     node delete (it only emptied a page-session record before, so the app came back), is hidden
 *     on an app that is not ours, and the duplicate "Remove from server" leaves the manage row.
 *   v1.6.0 — 2026-08-01 — TARGET-058 Phase 3: the Art. 50(1) disclosure above the Edit-with-AI
 *     panel. A person is in a two-way exchange with a model here, so they are told before the first
 *     exchange rather than after it.
 *   v1.5.0 — 2026-07-25 — TARGET-048 edit-model clarity: the STATUS card becomes a WORKING COPY →
 *     PUBLISHED lifecycle band, saving persists (server draft slot) instead of only touching a
 *     transient blob, every save leaves a restorable checkpoint ("Working-copy history"), and the
 *     three meanings of "draft" are split into working copy / try-it / published version.
 *   v1.4.0 — 2026-07-20 — Server-only cutover: drop the local-only favourite star; the detail view
 *     always operates on a server app (materialized in memory on demand for editing).
 *   v1.3.0 — 2026-07-16 — Add openStagingPreview(owner, filename): mint a preview token for an
 *     EXISTING staging draft and open it top-level, driving a library card's "Open staging" button.
 *   v1.3.0 — 2026-07-20 — Cost & Contracts section (EXCHANGE G3 / TARGET-045): own published apps get a
 *     read-only per-app EXCHANGE entitlement surface (cost.js) after Monetize.
 *   v1.2.0 — 2026-07-14 — Monetize section (TARGET-034 phase B): own published apps get the
 *     apps.{appId}.tools tool editor (monetize.js) between Skills and Manage-on-server.
 *   v1.1.0 — 2026-07-11 — Own-published apps: "Edit Access Code" in serverMgmtInner + "Attach skill"
 *     in the Skills section (attach/detach one of the user's own skills; ports skills.js
 *     setSkillBinding frontmatter rewrite so the standalone bundle needs no SPA service layer).
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 7).
 */
import { escapeHtml, jsArg, sourceLabel, sourceLabelText, currentOwnerName } from './util.js';
import { saveApp, deleteApp } from './db.js';
import { dtlBtn, showConfirm, showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t, getLang } from './i18n.js';
import { getPromotion, setPromotion, loadPromoted } from './promote.js';
import { monetizeSectionInner, monetizeOnOpen, odpsSectionInner } from './monetize.js';
import { costSectionInner, costOnOpen } from './cost.js';
import { appManifestAgents } from './app-agents.js';
import { saveWorkingCopy, loadCheckpoints, getCheckpoints, readCheckpoint, deleteCheckpoint, discardWorkingCopy, getDraft } from './workcopy.js';

// Injected once at bootstrap by main.js. Functions are main-local; the get* return main's LIVE
// state (so reads + in-place mutations propagate across the reassignments main does each render).
let refreshAll, loadPublishedApps, renderApps, updateModeToggle, getCortexOwnerToken, launchApp, viewPublished, viewSource, generateId, generateSharePrompt, openPromptBuilder, showPublishModal, getMainApps, getServerState, getServerManifests, getOwnProtection, setIframeUrl, isOperatorSession, deleteServerApp;
export function initDetail(deps) {
  ({ refreshAll, loadPublishedApps, renderApps, updateModeToggle, getCortexOwnerToken, launchApp, viewPublished, viewSource, generateId, generateSharePrompt, openPromptBuilder, showPublishModal, getMainApps, getServerState, getServerManifests, getOwnProtection, setIframeUrl, isOperatorSession, deleteServerApp } = deps);
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
var detailEditingAccessCode = false; // true while the access-code editor is open (own published apps)
var detailSkillPickerOpen = false;   // true while the "attach a skill" picker is shown (own published apps)
var detailMySkills = null;           // cached list of the user's own UNBOUND skills (attach options)
var detailBoundSkills = [];          // refs of the skills currently bound to this app (filters the options)
var detailSkillBusy = false;         // guards the Attach button while a bind/unbind republish is in flight
// ── Working copy (TARGET-048) ──
// The working copy is the app's SERVER DRAFT SLOT, not a browser blob: saving persists it, so it
// survives a reload and can be tested on a real origin before it ever becomes a published version.
var detailWorkSavedAt = null;   // ISO time this session last persisted the working copy (null = not yet here)
var detailHasWorkCopy = false;  // a saved (unpublished) working copy exists on the server for this app
var detailCheckpointsHtml = null; // cached rendered checkpoint list, survives re-renders
var detailCheckpointBusy = false; // guards restore/delete while a memory round-trip is in flight
var detailLastChangeNote = '';  // the change request behind the pending AI proposal — labels the checkpoint it replaces
// Bumped whenever the working-copy state changes underneath in-flight async loads (open a different
// app, publish, discard). A late-resolving loader compares the epoch it captured and bails instead
// of writing stale state back — otherwise a draft fetch started before a publish lands after it and
// resurrects "working copy saved" for an app that no longer has one.
var detailEpoch = 0;

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

// True when the signed-in owner owns THIS published app. getServerState() is populated only from
// the owner's own server apps (server-io filters by sameOwner), so its presence for this filename
// is the ownership gate — a community/non-owned app never has an entry here. Used to decide whether
// the "Edit Access Code" + "Attach skill" controls may be shown (own published apps only).
function detailIsOwnPublished(app) {
  return !!(app && app.published && app.publishedFilename
    && getServerState()[app.publishedFilename] && currentOwnerName());
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
  var acLabel = (svrState.accessCode ? '🔒 ' : '') + t('detail.editAccess');
  // Inline access-code editor (opened by the button below). Empty on Save removes protection;
  // a 4–64 char value sets it. Mirrors the About editor pattern used elsewhere in this view.
  var acEditor = detailEditingAccessCode
    ? '<div class="dtl-ac-editor" style="margin-top:10px">' +
        '<label class="dtl-stat-label" for="detail-ac-input">' + t('detail.accessCodeLabel') + '</label>' +
        '<input id="detail-ac-input" class="modal-input" maxlength="64" placeholder="' + escapeHtml(t('detail.accessCodePh')) + '" style="margin:4px 0 6px" />' +
        '<div class="dtl-sync none" style="margin:0 0 8px">' + t('detail.accessCodeRemoveHint') + '</div>' +
        '<div class="dtl-btn-row">' +
          dtlBtn(t('detail.saveDetails'), 'window._launcher.detailAccessCodeSave()', {variant:'primary'}) +
          dtlBtn(t('detail.cancelEdit'), 'window._launcher.detailAccessCodeCancel()') +
        '</div>' +
        '<div class="dtl-ai-status" id="detail-ac-status"></div>' +
      '</div>'
    : '';
  return '<div class="dtl-section">' +
      '<h3>' + t('detail.serverMgmt') + '</h3>' +
      '<div class="dtl-btn-row">' +
        (svrState.parked
          ? dtlBtn(t('card.unpark'), 'window._launcher.toggleParkApp(\'' + fnArg + '\', false)', {title: t('card.unparkHint')})
          : dtlBtn(t('card.park'), 'window._launcher.toggleParkApp(\'' + fnArg + '\', true)', {title: t('card.parkHint')})) +
        dtlBtn(t(svrState.forkable ? 'card.forkableOn' : 'card.forkableOff'), 'window._launcher.toggleForkApp(\'' + fnArg + '\', ' + (svrState.forkable ? 'false' : 'true') + ')', {title: t(svrState.forkable ? 'card.forkableOnHint' : 'card.forkableOffHint')}) +
        dtlBtn(acLabel, 'window._launcher.detailAccessCodeEdit()', {title: t('detail.accessCodeHint')}) +
        dtlBtn((anyProt ? '🛡✓ ' + t('card.protect') : t('card.protect')), 'window._launcher.showProtectionModal(\'' + fnArg + '\')', {title: t('card.protectHint')}) +
        dtlBtn(t('card.versions'), 'window._launcher.showVersionsModal(\'' + ownerArg2 + '\', \'' + fnArg + '\')') +
        // Who did I grant access to this app (H-2 app-grant consents): owner-level, any owner.
        dtlBtn(t('card.consents'), 'window._launcher.openConsents(\'' + ownerArg2 + '\', \'' + fnArg + '\', \'' + jsArg(app.name || app.publishedFilename) + '\')', {title: t('card.consentsHint')}) +
        // Manual subdomain assignment is operator-only (/v1/admin/subdomains); auto-assign covers
        // everyone else, so only show this to operators.
        ((isOperatorSession && isOperatorSession())
          ? dtlBtn(t('card.subdomain'), 'window._launcher.showSubdomainModal(\'' + ownerArg2 + '\', \'' + fnArg + '\')', {title: t('card.subdomainHint')})
          : '') +
        // "Remove from server" used to sit here next to a local-only Delete in Actions. Since the
        // server-only cutover both mean the same thing, so this row keeps the park/protect/versions
        // controls and Delete under Actions is the single door out.
      '</div>' +
      acEditor +
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
  detailEditingAccessCode = false;
  detailSkillPickerOpen = false;
  detailMySkills = null;
  detailBoundSkills = [];
  detailWorkSavedAt = null;
  detailCheckpointsHtml = null;
  detailCheckpointBusy = false;
  detailEpoch++;
  var app = detailGetApp();
  if (!app) return;
  // A working copy saved in an EARLIER session shows up in the server listing as has_draft.
  var wcState = (app.publishedFilename && getServerState()[app.publishedFilename]) || null;
  detailHasWorkCopy = !!(wcState && wcState.hasDraft);
  // Monetize (TARGET-034): reset + async-load the apps.{appId}.tools manifest for OWN published
  // apps before the first render so the section shell picks up the loading state.
  monetizeOnOpen(detailServerOwner(app), app.publishedFilename || '', detailIsOwnPublished(app));
  // Cost & contracts (EXCHANGE G3): async-load this app's EXCHANGE entitlements for OWN published apps.
  costOnOpen(detailServerOwner(app), app.publishedFilename || '', detailIsOwnPublished(app));
  document.getElementById('detail-view').hidden = false;
  renderDetailView();
  // AI availability + published versions load asynchronously and re-render in place.
  detailCheckAiAvailability();
  var owner = currentOwnerName();
  if (app.published && app.publishedFilename && owner) {
    detailLoadVersions(owner, app.publishedFilename);
    detailLoadSkills(detailServerOwner(app) || owner, app.publishedFilename);
    detailLoadCheckpoints(detailServerOwner(app) || owner, app.publishedFilename);
    // A working copy saved earlier lives on the server, but the in-memory blob was materialized
    // from the PUBLISHED bytes. Pull the real working copy in, so the source editor and the AI
    // loop operate on YOUR work — not on the live app wearing its name.
    if (detailHasWorkCopy) detailLoadWorkingCopy(app, detailServerOwner(app) || owner);
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
  // Server-only catalog: the grid is rebuilt from the server on every auth change, so a sign-in /
  // sign-out just re-fetches the owner's apps (their parked/listed apps appear or drop away).
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

  // ── LIFECYCLE (TARGET-048) ──
  // Replaces the old two-number STATUS card. One band answers the question the old card never did:
  // WHERE is my work right now — in an unsaved proposal, in a saved (private) working copy, or
  // published for everyone? Each stop says what it means in plain words; one sentence says what to
  // do next. "Draft" is deliberately absent: it used to mean three different things here.
  var localBytes = app.blob ? Math.round(app.blob.length * 0.75) : 0; // base64 → bytes approx
  var publishedV = app.publishedVersionNumber ? ('v' + app.publishedVersionNumber) : '';
  // Three mutually exclusive working-copy states, in the order the user moves through them.
  var wcState = detailDraftBlob ? 'pending' : (detailHasWorkCopy ? 'saved' : 'clean');
  var wcValue, wcExplain;
  if (wcState === 'pending') {
    wcValue = t('wc.pending');
    wcExplain = t('wc.explainPending');
  } else if (wcState === 'saved') {
    wcValue = detailWorkSavedAt
      ? t('wc.savedAt').replace('{t}', new Date(detailWorkSavedAt).toLocaleTimeString())
      : t('wc.savedEarlier');
    wcExplain = app.published
      ? t('wc.explainSaved').replace('{v}', String((app.publishedVersionNumber || 0) + 1))
      : t('wc.explainSavedUnpublished');
  } else {
    wcValue = app.published ? t('wc.sameAsPublished') : t('wc.nothingYet');
    wcExplain = app.published ? t('wc.explainClean') : t('wc.explainUnpublished');
  }

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
      '<h3>' + t('wc.lifecycle') + '</h3>' +
      '<div class="wc-row">' +
        '<div class="wc-band">' +
          '<div class="wc-stop ' + (wcState === 'clean' ? 'is-idle' : 'is-active') + '">' +
            '<span class="wc-stop-label">' + t('wc.title') + '</span>' +
            '<span class="wc-stop-val">' + escapeHtml(wcValue) + '</span>' +
            '<span class="wc-stop-note">' + t('wc.privateNote') + '</span>' +
          '</div>' +
          '<span class="wc-arrow" aria-hidden="true">→</span>' +
          '<div class="wc-stop ' + (app.published ? 'is-live' : 'is-idle') + '">' +
            '<span class="wc-stop-label">' + t('wc.published') + '</span>' +
            '<span class="wc-stop-val">' + escapeHtml(app.published ? (publishedV || 'v?') : t('wc.notPublishedYet')) + '</span>' +
            '<span class="wc-stop-note">' + (app.published ? t('wc.visibleToOthers') : t('wc.notVisibleYet')) + '</span>' +
          '</div>' +
        '</div>' +
        shotImg +
      '</div>' +
      '<p class="wc-explain">' + escapeHtml(wcExplain) + '</p>' +
      // A saved working copy must never be a dead end: the same three verbs are available right
      // here, so you can try it, publish it, or throw it away without hunting through other menus.
      (wcState === 'saved' && app.published && !isUrlApp
        ? '<div class="dtl-btn-row">' +
            dtlBtn(t('wc.try'), 'window._launcher.detailWorkTry()') +
            dtlBtn(t('wc.publishAs').replace('{v}', String((app.publishedVersionNumber || 0) + 1)), 'window._launcher.detailWorkPublish()', {variant:'success'}) +
            dtlBtn(t('wc.discardWork'), 'window._launcher.detailWorkDiscard()') +
          '</div>'
        : '') +
      (app.blob && !isUrlApp ? '<p class="wc-size">' + escapeHtml(t('detail.size') + ': ' + fmtSize(localBytes)) + '</p>' : '') +
    '</div>';

  // ── ABOUT ──
  // The display name + description are editable in place here (inline editor) —
  // the app's URL is keyed off owner/filename, so a rename never moves the link.
  // Editing is offered for the owner's own apps (a local record always exists once
  // the detail view is open); Save PATCHes the server when the app is published.
  var tags = (app.tags && app.tags.length) ? app.tags.join(', ') : '—';
  var cortex = (app.usesCortex && app.usesCortex.length) ? app.usesCortex.join(', ') : '—';
  var created = app.addedAt ? new Date(app.addedAt).toLocaleString() : '—';
  // Favourites are a Phase-2 (server-backed) feature; the old local-only star was dropped with the
  // server-only cutover so it isn't shown here anymore.
  var favBtn = '';
  var aboutHeader =
    '<h3 style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
      '<span>' + t('detail.about') + '</span>' +
      '<span style="display:flex;align-items:center;gap:8px">' +
        favBtn +
        ((canEditAbout && !detailEditingAbout) ? dtlBtn(t('detail.editDetails'), 'window._launcher.detailAboutEdit()') : '') +
      '</span>' +
    '</h3>';
  // Per-locale descriptions: EN + FI (extensible). Seed from the manifest's descriptions map,
  // falling back to the canonical description for the default language so an app that only ever had
  // a single description pre-fills English.
  var descs = app.descriptions || {};
  var descEnVal = descs.en || (app.description || '');
  var descFiVal = descs.fi || '';
  var aboutBody;
  if (detailEditingAbout) {
    aboutBody =
      '<label class="dtl-stat-label" for="detail-name-input">' + t('detail.nameLabel') + '</label>' +
      '<input id="detail-name-input" class="modal-input" maxlength="120" value="' + escapeHtml(app.name || '') + '" style="margin:4px 0 10px" />' +
      '<label class="dtl-stat-label" for="detail-desc-en">' + t('detail.descEn') + '</label>' +
      '<textarea id="detail-desc-en" class="modal-input" rows="3" maxlength="2000" style="margin:4px 0 6px;resize:vertical">' + escapeHtml(descEnVal) + '</textarea>' +
      '<label class="dtl-stat-label" for="detail-desc-fi">' + t('detail.descFi') + '</label>' +
      '<textarea id="detail-desc-fi" class="modal-input" rows="3" maxlength="2000" style="margin:4px 0 6px;resize:vertical">' + escapeHtml(descFiVal) + '</textarea>' +
      '<div class="dtl-btn-row" style="margin:0 0 4px">' +
        dtlBtn('🌐 ' + t('detail.translateEnFi'), 'window._launcher.detailTranslateDesc(\'en\',\'fi\')', {id:'detail-tr-enfi'}) +
        dtlBtn('🌐 ' + t('detail.translateFiEn'), 'window._launcher.detailTranslateDesc(\'fi\',\'en\')', {id:'detail-tr-fien'}) +
      '</div>' +
      '<div class="dtl-ai-status" id="detail-tr-status" style="margin:0 0 8px"></div>' +
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
    // Show the description in the current UI language, falling back to the canonical one.
    var shownDesc = (app.descriptions && app.descriptions[getLang()]) || app.description || '';
    aboutBody =
      (shownDesc ? '<p class="dtl-desc">' + escapeHtml(shownDesc) + '</p>' : '') +
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
    // Art. 50(1), EU AI Act: this panel is a two-way exchange with a language model, so the person
    // is told BEFORE the first exchange rather than after it. It is not the Art. 50(4) content
    // label (that one belongs on published output and is decided by the node's disclosureFor) and
    // it carries no EU icon, because the official icon set is for labelling content, not for
    // disclosing a conversation. It shows whether or not a key is configured: the statement is
    // about what this panel IS.
    aiHtml +=
      '<div class="dtl-ai-notice" role="note">' +
        '<strong>' + escapeHtml(t('detail.aiInteractionTitle')) + '</strong> ' +
        escapeHtml(t('detail.aiInteractionBody')) +
      '</div>' +
      '<div class="dtl-ai-row">' +
        '<textarea id="detail-ai-input" placeholder="' + escapeHtml(t('detail.editAiPh')) + '"' + (detailAiAvailable ? '' : ' disabled') + '></textarea>' +
        dtlBtn(t('detail.run'), 'window._launcher.detailAiRun()', {variant:'primary', id:'detail-ai-run', disabled: !detailAiAvailable}) +
      '</div>' +
      '<div class="dtl-ai-status" id="detail-ai-status">' + (detailAiAvailable ? '' : escapeHtml(detailAiUnavailableMsg())) + '</div>' +
      '<div class="dtl-ai-draft" id="detail-ai-draft"' + (detailDraftBlob ? '' : ' hidden') + '>' +
        '<div class="dtl-ai-status wc-proposal-head">' + t('detail.draftReady') + '</div>' +
        // The SAME three verbs the source editor uses, in the order you actually move through them:
        // save (private, reversible) → try (real origin, live untouched) → publish (others see it).
        '<div class="dtl-btn-row">' +
          dtlBtn(t('wc.save'), 'window._launcher.detailAiKeep()', {variant:'primary'}) +
          (app.published
            ? dtlBtn(t('wc.try'), 'window._launcher.detailTestDraftLive()') +
              dtlBtn(t('wc.publishAs').replace('{v}', String((app.publishedVersionNumber || 0) + 1)), 'window._launcher.detailPublishTestedDraft()', {variant:'success'})
            // No published app yet → no server slot to stage into; keep the quick sandbox preview.
            : dtlBtn(t('wc.tryLocal'), 'window._launcher.detailAiTest()')) +
          dtlBtn(t('wc.discardProposal'), 'window._launcher.detailAiDiscard()') +
        '</div>' +
        '<p class="wc-verbs-hint">' + t('wc.verbsHint') + '</p>' +
      '</div>';
  }
  aiHtml += '</div>';

  // ── WORKING-COPY HISTORY (checkpoints, TARGET-048) ──
  // Every save leaves the bytes it replaced here, so iterating can never lose earlier work. Kept
  // visually and verbally separate from the published versions below — that pair of look-alike
  // lists was itself a source of the confusion, so each one states who can see it.
  var historyHtml = '';
  if (!isUrlApp && app.published) {
    historyHtml =
      '<div class="dtl-section">' +
        '<h3>' + t('wc.history') + '</h3>' +
        '<p class="dtl-desc">' + t('wc.historyHint') + '</p>' +
        '<div id="detail-checkpoints">' +
          (detailCheckpointsHtml !== null ? detailCheckpointsHtml : '<span class="wc-muted">…</span>') +
        '</div>' +
      '</div>';
  }

  // ── VERSIONS ──
  var versionsHtml =
    '<div class="dtl-section">' +
      '<h3>' + t('detail.versions') + '</h3>' +
      '<p class="dtl-desc">' + t('versions.publishedHint') + '</p>' +
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
        // Offered only where it can do something: our own published app (deleted on the node) or a
        // record that was never published. Someone else's published app is not ours to delete, and
        // the button used to appear there and close the view having changed nothing.
        ((detailIsOwnPublished(app) || !app.published)
          ? dtlBtn(t('ctx.delete'), 'window._launcher.detailDelete()', {variant:'danger', title: t('detail.deleteHint')})
          : '') +
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
    var ownPub = detailIsOwnPublished(app);
    skillsHtml =
      '<div class="dtl-section">' +
        '<h3>' + (t('detail.skills') || 'Skills for this app') + '</h3>' +
        '<div id="detail-skills-list">' +
          (detailSkillsHtml !== null ? detailSkillsHtml
            : '<span style="color:var(--text-muted);font-size:.85rem">…</span>') +
        '</div>' +
        // Own published app → offer attach/detach (a skill teaches agents this app). The detach ×
        // on each user-scope skill is rendered by detailLoadSkills into the list above.
        (ownPub ? '<div id="detail-skill-attach" style="margin-top:8px">' + detailSkillAttachInner() + '</div>' : '') +
      '</div>';
  }

  // ── EXCHANGE & ODPS — is this app on the marketplace, and the ODPS defaults every tool inherits.
  // Sits above Monetize because it frames it: the app-level answer to "is this product for sale".
  // Stable container: monetize.js re-renders #detail-odps in place alongside #detail-monetize.
  var odpsHtml = (app.published && detailIsOwnPublished(app))
    ? '<div class="dtl-section" id="detail-odps">' + odpsSectionInner() + '</div>'
    : '';

  // ── MONETIZE (TARGET-034) — sell tool calls on this app (own published apps only) ──
  // Stable container: monetize.js re-renders #detail-monetize in place after loads/saves.
  var monetizeHtml = (app.published && detailIsOwnPublished(app))
    ? '<div class="dtl-section" id="detail-monetize">' + monetizeSectionInner() + '</div>'
    : '';

  // ── COST & CONTRACTS (EXCHANGE G3 / TARGET-045) — what this app SOURCES (own published apps only) ──
  // Stable container: cost.js re-renders #detail-cost in place after the async load.
  var costHtml = (app.published && detailIsOwnPublished(app))
    ? '<div class="dtl-section" id="detail-cost">' + costSectionInner() + '</div>'
    : '';

  // ── PROMOTE (Phase 2c) — showcase this app on your public profile with EN/FI pitch copy.
  //    Own published apps only; persists to the PUBLIC app-catalog.promoted memory doc.
  var promoteHtml = (app.published && detailIsOwnPublished(app))
    ? buildPromoteSection(app) : '';

  // ── BUNDLED AGENTS (Agent-Bundled Apps) — crew-defs this app ships. The section lists the
  // agent names and opens the shared Bundled-agents modal (inspector + hosted instances with
  // prices + deploy-your-own). Manifest read from the server-manifest cache.
  var agentsHtml = '';
  if (app.published) {
    var agOwner = detailServerOwner(app);
    var agFile = app.publishedFilename || '';
    var agDefs = appManifestAgents(agOwner, agFile);
    if (agDefs.length) {
      agentsHtml =
        '<div class="dtl-section">' +
          '<h3>\u{1F916} ' + (t('agents.title') || 'Bundled agents') + '</h3>' +
          '<div style="font-size:.85rem;color:var(--text-muted);margin-bottom:6px">' + (t('agents.declares') || '') + '</div>' +
          '<div style="margin-bottom:8px">' + agDefs.map(function(d) {
            return '<span class="aga-chip">' + escapeHtml(d.agent_name || '') + '</span>';
          }).join(' ') + '</div>' +
          dtlBtn('\u{1F916} ' + (t('agents.manage') || 'Inspect & deploy'),
            'window._launcher.showAppAgentsModal(\'' + jsArg(agOwner) + '\', \'' + jsArg(agFile) + '\')') +
        '</div>';
    }
  }

  document.getElementById('detail-body').innerHTML =
    statusHtml + aboutHtml + aiHtml + historyHtml + versionsHtml + skillsHtml + agentsHtml + odpsHtml + monetizeHtml + costHtml + promoteHtml + mgmtHtml + actionsHtml;
}

// ── Working-copy history (checkpoints) ────────────────────────────────────────
// Rendered from the cached index (workcopy.js); each row can be previewed in the sandbox or
// restored. Restoring is itself a save, so the state you restore FROM is checkpointed too — there
// is no way to lose work by clicking around in here.

function detailCheckpointRows(app) {
  var owner = detailServerOwner(app);
  var list = getCheckpoints(owner, app.publishedFilename || '');
  if (!list.length) return '<span class="wc-muted">' + t('wc.none') + '</span>';
  var out = '';
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    var when = c.at ? new Date(c.at).toLocaleString() : '';
    var kb = c.size ? (Math.round(c.size / 102.4) / 10) + ' KB' : '';
    var note = c.note ? t('wc.before').replace('{note}', c.note) : t('wc.beforeUnnamed');
    out +=
      '<div class="dtl-version-row">' +
        '<div class="version-meta">' +
          '<span class="wc-ckpt-when">' + escapeHtml(when) + '</span>' +
          '<span class="wc-ckpt-note">' + escapeHtml(note) + (kb ? ' · ' + kb : '') + '</span>' +
        '</div>' +
        '<div class="dtl-btn-row">' +
          dtlBtn(t('wc.preview'), 'window._launcher.detailCheckpointPreview(\'' + jsArg(c.id) + '\')') +
          dtlBtn(t('wc.restore'), 'window._launcher.detailCheckpointRestore(\'' + jsArg(c.id) + '\')', {variant:'primary', disabled: detailCheckpointBusy}) +
          dtlBtn(t('wc.delete'), 'window._launcher.detailCheckpointDelete(\'' + jsArg(c.id) + '\')', {disabled: detailCheckpointBusy}) +
        '</div>' +
      '</div>';
  }
  return out;
}

// Re-render ONLY the checkpoint list in place (keeps scroll + the rest of the detail intact).
function refreshCheckpoints() {
  var app = detailGetApp();
  if (!app) return;
  detailCheckpointsHtml = detailCheckpointRows(app);
  var el = document.getElementById('detail-checkpoints');
  if (el) el.innerHTML = detailCheckpointsHtml;
}

// Load the saved working copy over the materialized published bytes (see the call site). Silent on
// failure: the band still says "saved earlier", and the worst case is the previous behaviour.
function detailLoadWorkingCopy(app, owner) {
  var epoch = detailEpoch;
  getDraft(owner, app.publishedFilename).then(function (d) {
    // Bail if a publish/discard/app-switch happened while this was in flight (see detailEpoch).
    if (!d || !d.content || detailAppId !== app.id || epoch !== detailEpoch) return;
    app.blob = d.content;
    if (d.updated_at) detailWorkSavedAt = d.updated_at;
    saveApp(app).then(function () { if (detailAppId === app.id) renderDetailView(); });
  });
}

function detailLoadCheckpoints(owner, filename) {
  loadCheckpoints(owner, filename)
    .then(function () { if (detailAppId) refreshCheckpoints(); })
    .catch(function () { if (detailAppId) refreshCheckpoints(); });
}

// Open a stored checkpoint in the sandbox overlay WITHOUT touching the working copy.
function detailCheckpointPreview(id) {
  var app = detailGetApp();
  if (!app) return;
  readCheckpoint(detailServerOwner(app), app.publishedFilename || '', id).then(function (b64) {
    if (!b64) { showNotice(t('wc.gone')); return; }
    var view = document.getElementById('iframe-view');
    var iframe = document.getElementById('app-iframe');
    document.getElementById('iframe-title').textContent = (app.name || 'App') + ' — ' + t('wc.previewTitle');
    iframe.removeAttribute('src');
    iframe.srcdoc = blobToHtml(b64);
    setIframeUrl('');
    delete iframe.dataset.appId;
    view.hidden = false;
  });
}

// Restore = save the checkpoint's bytes AS the working copy (which checkpoints the current bytes
// first). The published app is untouched until you publish.
async function detailCheckpointRestore(id) {
  var app = detailGetApp();
  if (!app || detailCheckpointBusy) return;
  if (!getCortexOwnerToken()) { showNotice(t('wc.loginNeeded')); return; }
  if (!(await showConfirm(t('wc.confirmRestore')))) return;
  var owner = detailServerOwner(app);
  var filename = app.publishedFilename || '';
  detailCheckpointBusy = true;
  refreshCheckpoints();
  readCheckpoint(owner, filename, id)
    .then(function (b64) {
      if (!b64) throw new Error(t('wc.gone'));
      return saveWorkingCopy({
        owner: owner, filename: filename,
        previousB64: app.blob, nextB64: b64, note: t('wc.noteRestore'),
      }).then(function () { return b64; });
    })
    .then(function (b64) {
      app.blob = b64;
      detailCheckpointBusy = false;
      detailHasWorkCopy = true;
      detailWorkSavedAt = new Date().toISOString();
      return saveApp(app).then(function () {
        renderDetailView();
        refreshCheckpoints();
        showNotice(t('wc.restored'));
      });
    })
    .catch(function (err) {
      detailCheckpointBusy = false;
      refreshCheckpoints();
      showNotice((err && err.message) || t('wc.saveFailed'));
    });
}

async function detailCheckpointDelete(id) {
  var app = detailGetApp();
  if (!app || detailCheckpointBusy) return;
  if (!(await showConfirm(t('wc.confirmDelete')))) return;
  detailCheckpointBusy = true;
  refreshCheckpoints();
  deleteCheckpoint(detailServerOwner(app), app.publishedFilename || '', id)
    .catch(function () { /* index already updated locally */ })
    .then(function () { detailCheckpointBusy = false; refreshCheckpoints(); });
}

// The Promote section: a short EN/FI pitch that surfaces this app on the owner's public profile.
// Saving writes the PUBLIC app-catalog.promoted doc; clearing both fields un-promotes the app.
function promoteRef(app) { return detailServerOwner(app) + '/' + (app.publishedFilename || ''); }
function buildPromoteSection(app) {
  var ref = promoteRef(app);
  var cur = getPromotion(ref) || {};
  var on = !!(cur.en || cur.fi);
  return '<div class="dtl-section" id="detail-promote">' +
      '<h3 style="display:flex;align-items:center;gap:8px">📣 ' + t('promote.title') +
        (on ? ' <span class="dtl-badge-on">' + t('promote.on') + '</span>' : '') + '</h3>' +
      '<p class="dtl-desc">' + t('promote.hint') + '</p>' +
      '<label class="dtl-stat-label" for="detail-promo-en">' + t('promote.en') + '</label>' +
      '<textarea id="detail-promo-en" class="modal-input" rows="2" maxlength="500" style="margin:4px 0 6px;resize:vertical">' + escapeHtml(cur.en || '') + '</textarea>' +
      '<label class="dtl-stat-label" for="detail-promo-fi">' + t('promote.fi') + '</label>' +
      '<textarea id="detail-promo-fi" class="modal-input" rows="2" maxlength="500" style="margin:4px 0 6px;resize:vertical">' + escapeHtml(cur.fi || '') + '</textarea>' +
      '<div class="dtl-btn-row" style="margin:0 0 4px">' +
        dtlBtn('🌐 ' + t('detail.translateEnFi'), 'window._launcher.detailTranslateDesc(\'en\',\'fi\',\'detail-promo-\',\'detail-promo-tr-status\')') +
        dtlBtn('🌐 ' + t('detail.translateFiEn'), 'window._launcher.detailTranslateDesc(\'fi\',\'en\',\'detail-promo-\',\'detail-promo-tr-status\')') +
      '</div>' +
      '<div class="dtl-ai-status" id="detail-promo-tr-status" style="margin:0 0 8px"></div>' +
      '<div class="dtl-btn-row">' +
        dtlBtn(t('promote.save'), 'window._launcher.detailPromoteSave()', {variant:'primary'}) +
        (on ? dtlBtn(t('promote.remove'), 'window._launcher.detailPromoteClear()') : '') +
      '</div>' +
      '<div class="dtl-ai-status" id="detail-promo-status"></div>' +
    '</div>';
}

function detailPromoteSave() {
  var app = detailGetApp();
  if (!app || !detailIsOwnPublished(app)) return;
  var en = (document.getElementById('detail-promo-en') || {}).value || '';
  var fi = (document.getElementById('detail-promo-fi') || {}).value || '';
  var statusEl = document.getElementById('detail-promo-status');
  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('promote.saving'); }
  setPromotion(promoteRef(app), { en: en, fi: fi }).then(function (nowOn) {
    renderApps();
    renderDetailView();
    var s2 = document.getElementById('detail-promo-status');
    if (s2) { s2.style.color = '#34d399'; s2.textContent = nowOn ? '✔ ' + t('promote.saved') : '✔ ' + t('promote.removed'); }
  });
}

function detailPromoteClear() {
  var en = document.getElementById('detail-promo-en'); if (en) en.value = '';
  var fi = document.getElementById('detail-promo-fi'); if (fi) fi.value = '';
  detailPromoteSave();
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
      // Track bound refs so the attach picker can exclude already-bound skills (parity with profile).
      detailBoundSkills = skills.map(function(s) { return s.ref; });
      // Detach (×) is offered only on the owner's own published app AND only for user-scope skills
      // (node/workspace skills are read-only here — you can't rewrite their frontmatter).
      var ownPub = detailIsOwnPublished(detailGetApp());
      if (skills.length === 0) { detailSkillsHtml = noneHtml; if (listEl) listEl.innerHTML = detailSkillsHtml; return; }
      var out = '';
      for (var i = 0; i < skills.length; i++) {
        var s = skills[i];
        var detach = (ownPub && s.scope === 'user')
          ? ' <button class="rename-pencil" title="' + escapeHtml(t('detail.skillDetach')) + '" onclick="window._launcher.detailSkillDetach(\'' + jsArg(s.name) + '\')">×</button>'
          : '';
        out += '<div style="margin-bottom:.4rem">' +
          '<code>' + escapeHtml(s.ref || s.name) + '</code>' +
          ' <span style="color:var(--text-muted);font-size:.8rem">v' + escapeHtml(String(s.version || '')) + '</span>' + detach +
          '<div style="color:var(--text-muted);font-size:.85rem">' + escapeHtml(s.description || '') + '</div>' +
        '</div>';
      }
      detailSkillsHtml = out;
      if (listEl) listEl.innerHTML = detailSkillsHtml;
    })
    .catch(function() {
      detailBoundSkills = [];
      detailSkillsHtml = noneHtml;
      var listEl = document.getElementById('detail-skills-list');
      if (listEl) listEl.innerHTML = detailSkillsHtml;
    });
}

// ── Access code (own published apps): set / clear the optional access code ──────
// The published-app record only ever exposes a `protected` boolean (never the code itself), so the
// editor never pre-fills — you type a NEW code to set one, or Save empty to remove protection.
// PATCH /v1/apps/:filename { access_code: "<code>" | null } (server validates 4–64 chars).
function detailAccessCodeEdit() {
  var app = detailGetApp();
  if (!detailIsOwnPublished(app)) return;
  detailEditingAccessCode = true;
  refreshServerMgmt();
  var el = document.getElementById('detail-ac-input');
  if (el) el.focus();
}

function detailAccessCodeCancel() {
  detailEditingAccessCode = false;
  refreshServerMgmt();
}

function detailAccessCodeSave() {
  var app = detailGetApp();
  if (!detailIsOwnPublished(app)) return;
  var token = getCortexOwnerToken();
  if (!token) { showNotice(t('common.loginRequired') || 'You must be logged in. Sign in first.'); return; }
  var input = document.getElementById('detail-ac-input');
  var statusEl = document.getElementById('detail-ac-status');
  var code = input ? input.value.trim() : '';
  if (code && (code.length < 4 || code.length > 64)) {
    if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + t('detail.accessCodeLen'); }
    return;
  }
  var config = loadConfig();
  var aimeatUrl = (config.aimeatUrl || '').replace(/\/+$/, '');
  var filename = app.publishedFilename;
  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('detail.savingAccess'); }
  fetch(aimeatUrl + '/v1/apps/' + encodeURIComponent(filename), {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(code ? { access_code: code } : { access_code: null })
  })
    .then(function(resp) { return resp.json().then(function(j) { return { ok: resp.ok, j: j }; }); })
    .then(function(res) {
      if (res.ok && res.j && res.j.ok !== false) {
        // Reflect the new protection state in the cached server state so the button's 🔒 badge updates.
        var st = getServerState()[filename];
        if (st) st.accessCode = !!code;
        detailEditingAccessCode = false;
        loadPublishedApps();
        refreshServerMgmt();
        showNotice(code ? t('detail.accessCodeSet') : t('detail.accessCodeCleared'));
      } else {
        if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + ((res.j && res.j.error && res.j.error.message) || 'Failed'); }
      }
    })
    .catch(function(err) { if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + (err.message || 'Error'); } });
}

// ── Attach skill (own published apps): bind one of the user's own skills to this app ──────
// The bound-skills list is read-only for everyone; the attach picker + detach × are shown only for
// the owner's own published app. Binding lives in the SKILL's frontmatter (metadata.binding:
// app:{owner}/{filename}); attach/detach rewrites it and republishes (skillSetBinding).
function detailSkillAttachInner() {
  var toggleBtn = dtlBtn('+ ' + t('detail.skillAttach'), 'window._launcher.detailSkillAttachToggle()');
  if (!detailSkillPickerOpen) return toggleBtn;
  var picker;
  if (detailMySkills === null) {
    picker = '<span style="color:var(--text-muted);font-size:.85rem">…</span>';
  } else if (detailMySkills.length === 0) {
    picker = '<span style="color:var(--text-muted);font-size:.85rem">' + t('detail.skillNoneToAttach') + '</span>';
  } else {
    var opts = '';
    for (var i = 0; i < detailMySkills.length; i++) {
      var s = detailMySkills[i];
      var desc = (s.description || '').slice(0, 50);
      opts += '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + (desc ? ' — ' + escapeHtml(desc) : '') + '</option>';
    }
    picker = '<select id="detail-skill-select" class="modal-input" style="max-width:340px;margin:0">' + opts + '</select>' +
      dtlBtn(t('detail.skillAttachConfirm'), 'window._launcher.detailSkillAttach()', {variant:'primary', disabled: detailSkillBusy});
  }
  return '<div class="dtl-btn-row" style="align-items:center;flex-wrap:wrap;gap:8px">' + toggleBtn + picker + '</div>' +
    '<div class="dtl-ai-status" id="detail-skill-status"></div>';
}

// Re-render ONLY the attach picker container (button + select) — leaves the bound list untouched.
function refreshSkillAttach() {
  var c = document.getElementById('detail-skill-attach');
  if (c) c.innerHTML = detailSkillAttachInner();
}

function detailSkillAttachToggle() {
  var app = detailGetApp();
  if (!detailIsOwnPublished(app)) return;
  detailSkillPickerOpen = !detailSkillPickerOpen;
  if (detailSkillPickerOpen && detailMySkills === null) {
    refreshSkillAttach(); // show the … placeholder while the list loads
    skillListMine()
      .then(function(mine) {
        var bound = {};
        for (var i = 0; i < detailBoundSkills.length; i++) bound[detailBoundSkills[i]] = true;
        detailMySkills = mine.filter(function(s) { return !bound[s.ref]; });
        refreshSkillAttach();
      })
      .catch(function() { detailMySkills = []; refreshSkillAttach(); });
  } else {
    refreshSkillAttach();
  }
}

function detailSkillAttach() {
  var app = detailGetApp();
  if (!detailIsOwnPublished(app)) return;
  var sel = document.getElementById('detail-skill-select');
  var name = sel ? sel.value : '';
  if (!name || detailSkillBusy) return;
  var statusEl = document.getElementById('detail-skill-status');
  var owner = detailServerOwner(app);
  var filename = app.publishedFilename;
  var binding = 'app:' + owner + '/' + filename;
  detailSkillBusy = true;
  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('detail.skillAttaching'); }
  skillSetBinding(name, binding)
    .then(function() {
      detailSkillBusy = false;
      detailSkillPickerOpen = false;
      detailMySkills = null;
      detailLoadSkills(owner, filename);
      refreshSkillAttach();
      showNotice(t('detail.skillAttached'));
    })
    .catch(function(err) {
      detailSkillBusy = false;
      if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + t('detail.skillAttachError') + ': ' + (err.message || err); }
    });
}

function detailSkillDetach(name) {
  var app = detailGetApp();
  if (!detailIsOwnPublished(app) || detailSkillBusy) return;
  var owner = detailServerOwner(app);
  var filename = app.publishedFilename;
  detailSkillBusy = true;
  skillSetBinding(name, null)
    .then(function() {
      detailSkillBusy = false;
      detailMySkills = null;
      detailLoadSkills(owner, filename);
      refreshSkillAttach();
      showNotice(t('detail.skillDetached'));
    })
    .catch(function(err) {
      detailSkillBusy = false;
      showNotice(t('detail.skillAttachError') + ': ' + (err.message || err));
    });
}

// ── Skills registry API (authed, own user scope) ──────────────────────────────
// Ported from public/js/services/skills.js so the standalone catalog (its own esbuild bundle, no
// access to the SPA /js service layer) can bind/unbind a skill's app binding. The node schema wins
// on any mismatch — keep skillSetBinding's frontmatter rewrite in step with the SPA service.
function skillApiBase() {
  var cfg = loadConfig();
  return cfg.aimeatUrl ? cfg.aimeatUrl.replace(/\/+$/, '') : '';
}
function skillAuthHeaders(withJson) {
  var h = {};
  var tok = getCortexOwnerToken();
  if (tok) h['Authorization'] = 'Bearer ' + tok;
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}
function skillListMine() {
  var base = skillApiBase();
  if (!base) return Promise.reject(new Error('No server configured'));
  return fetch(base + '/v1/skills?scope=user', { headers: skillAuthHeaders(false) })
    .then(function(r) { return r.json(); })
    .then(function(j) { return (j.data && j.data.skills) ? j.data.skills : []; });
}
function skillGetMine(name) {
  var base = skillApiBase();
  return fetch(base + '/v1/skills/' + encodeURIComponent(name) + '?scope=user', { headers: skillAuthHeaders(false) })
    .then(function(r) { return r.json(); })
    .then(function(j) { return (j.data && j.data.skill) || null; });
}
function skillPublish(skillMd, files) {
  var base = skillApiBase();
  var body = { skill_md: skillMd };
  if (files && Object.keys(files).length) body.files = files;
  return fetch(base + '/v1/skills', { method: 'POST', headers: skillAuthHeaders(true), body: JSON.stringify(body) })
    .then(function(r) { return r.json().then(function(j) {
      if (!j.ok) throw new Error((j.error && (j.error.message || j.error.code)) || ('HTTP ' + r.status));
      return (j.data && j.data.skill) || null;
    }); });
}
// Set/clear a skill's app binding by rewriting the SKILL.md frontmatter and republishing.
// Textual rewrite (no YAML lib): handles the three shapes the contract allows. Ported verbatim
// from public/js/services/skills.js setSkillBinding.
function skillSetBinding(name, binding) {
  return skillGetMine(name).then(function(skill) {
    if (!skill) throw new Error('Skill not found: ' + name);
    var md = (skill.fileContents && skill.fileContents['SKILL.md']) || '';
    var m = md.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)([\s\S]*)$/);
    if (!m) throw new Error('SKILL.md has no frontmatter');
    var fm = m[2];
    var hasBindingLine = /^\s{2,}binding:.*$/m.test(fm);
    var hasMetadata = /^metadata:\s*$/m.test(fm);
    if (binding) {
      if (hasBindingLine) fm = fm.replace(/^(\s{2,})binding:.*$/m, '$1binding: ' + binding);
      else if (hasMetadata) fm = fm.replace(/^metadata:\s*$/m, 'metadata:\n  binding: ' + binding);
      else fm = fm + '\nmetadata:\n  binding: ' + binding;
    } else {
      fm = fm.replace(/^\s{2,}binding:.*\r?\n?/m, '');
      // An emptied metadata block would be YAML null (invalid per contract) — drop the header too.
      if (/^metadata:\s*$/m.test(fm) && !/^metadata:\s*\r?\n\s{2,}\S/m.test(fm)) {
        fm = fm.replace(/^metadata:\s*\r?\n?/m, '');
      }
    }
    var files = Object.assign({}, skill.fileContents);
    delete files['SKILL.md'];
    return skillPublish(m[1] + fm + m[3] + m[4], files);
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
  var enEl = document.getElementById('detail-desc-en');
  var fiEl = document.getElementById('detail-desc-fi');
  var iconEl = document.getElementById('detail-icon-input');
  var tagsEl = document.getElementById('detail-tags-input');
  var newName = nameEl ? nameEl.value.trim() : '';
  var enDesc = enEl ? enEl.value.trim() : '';
  var fiDesc = fiEl ? fiEl.value.trim() : '';
  // Per-locale map (drop blanks); the canonical description is the English one, or Finnish when
  // English is blank, so an app always has a non-empty fallback description.
  var newDescriptions = {};
  if (enDesc) newDescriptions.en = enDesc;
  if (fiDesc) newDescriptions.fi = fiDesc;
  var newDesc = enDesc || fiDesc || '';
  // icon + tags are LOCAL metadata (same as the context-menu Edit modal) — no server round-trip.
  var newIcon = iconEl ? iconEl.value.trim() : (app.icon || '');
  var newTags = tagsEl
    ? tagsEl.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    : (app.tags || []);
  if (!newName) { showNotice(t('detail.nameRequired') || 'Name cannot be empty.'); if (nameEl) nameEl.focus(); return; }
  if (app.published && !newDesc) { showNotice(t('detail.descRequired') || 'Description cannot be empty.'); if (enEl) enEl.focus(); return; }

  function finishLocal() {
    app.name = newName;
    app.description = newDesc;
    app.descriptions = newDescriptions;
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
    body: JSON.stringify({ name: newName, description: newDesc, descriptions: newDescriptions })
  })
    .then(function(resp) { return resp.json().then(function(j) { return { ok: resp.ok, j: j }; }); })
    .then(function(res) {
      if (res.ok && res.j && res.j.ok !== false) {
        // Keep the cached server manifest in sync so a re-render shows the new name + descriptions.
        var key = owner + '\n' + filename;
        getServerManifests()[key] = getServerManifests()[key] || {};
        getServerManifests()[key].name = newName;
        getServerManifests()[key].description = newDesc;
        getServerManifests()[key].descriptions = newDescriptions;
        finishLocal();
      } else {
        showNotice('Failed: ' + ((res.j && res.j.error && res.j.error.message) || 'Unknown error'));
      }
    })
    .catch(function(err) { showNotice('Error: ' + (err.message || err)); });
}

// Translate one language field to another via the owner's OpenRouter key (/v1/ai/complete).
// srcLang/dstLang are 'en'|'fi'; fills the destination textarea in place. `prefix` picks the field
// pair ('detail-desc-' for the description editor, 'detail-promo-' for the promotion editor);
// `statusId` picks the status line. Reused by both the description and promotion editors.
function detailTranslateDesc(srcLang, dstLang, prefix, statusId) {
  prefix = prefix || 'detail-desc-';
  var srcEl = document.getElementById(prefix + srcLang);
  var dstEl = document.getElementById(prefix + dstLang);
  var statusEl = document.getElementById(statusId || 'detail-tr-status');
  if (!srcEl || !dstEl) return;
  var text = (srcEl.value || '').trim();
  if (!text) { if (statusEl) statusEl.textContent = t('detail.trNeedSource'); return; }
  var token = getCortexOwnerToken();
  if (!token) { if (statusEl) statusEl.textContent = t('detail.aiLoginNeeded'); return; }
  var config = loadConfig();
  var aimeatUrl = (config.aimeatUrl || '').replace(/\/+$/, '');
  if (!aimeatUrl) { if (statusEl) statusEl.textContent = t('detail.aiUnavailable'); return; }
  var langName = { en: 'English', fi: 'Finnish' };
  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('detail.translating'); }
  var systemPrompt = 'You are a professional translator for short app-store copy. '
    + 'Translate the text from ' + (langName[srcLang] || srcLang) + ' to ' + (langName[dstLang] || dstLang) + '. '
    + 'Return ONLY the translated text — no quotes, no notes, no explanation. Keep it concise and natural.';
  fetch(aimeatUrl + '/v1/ai/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ prompt: text, systemPrompt: systemPrompt, app_id: 'app-catalog' })
  })
    .then(function(resp) { return resp.json(); })
    .then(function(json) {
      if (!json || !json.ok) {
        var msg = (json && json.error && json.error.message) || 'Translation failed';
        if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + msg; }
        return;
      }
      var out = (json.data && json.data.content ? json.data.content : '').trim();
      if (!out) { if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + t('detail.trEmpty'); } return; }
      dstEl.value = out;
      if (statusEl) { statusEl.style.color = '#34d399'; statusEl.textContent = '✔ ' + t('detail.trDone'); }
    })
    .catch(function(err) {
      if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + (err.message || 'Translation failed'); }
    });
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
      // The published version number was only ever written by THIS browser, at the moment it
      // published. Publish from an agent, from MCP, from another machine, and the number here
      // stayed where this browser left it: the band said "PUBLISHED v5" beside a list whose top
      // entry was v9, and the publish button offered v6 when the server would have made it v10.
      // This list comes from the server, so its newest entry IS the current version. Adopt it.
      if (versions.length) {
        var latestNum = versions[0].version_number || 0;
        var cur = detailGetApp();
        if (latestNum && cur && cur.publishedVersionNumber !== latestNum) {
          cur.publishedVersionNumber = latestNum;
          try { saveApp(cur); } catch (e) { /* the corrected number still shows for this session */ }
          renderDetailView();
        }
      }
      if (versions.length === 0) { detailVersionsHtml = '<span style="color:var(--text-muted);font-size:.85rem">' + t('detail.noVersions') + '</span>'; listEl.innerHTML = detailVersionsHtml; return; }
      var ownerArg = "'" + jsArg(owner) + "'";
      var fileArg = "'" + jsArg(filename) + "'";
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
      detailLastChangeNote = change;
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

// Accept the AI proposal INTO the working copy. This used to only overwrite the in-memory blob —
// which a reload silently threw away. Now it checkpoints the bytes being replaced and persists the
// new ones to the server draft slot, so "saved" actually means saved. The live app is untouched.
function detailAiKeep() {
  var app = detailGetApp();
  if (!app || !detailDraftBlob) return;
  var next = detailDraftBlob;
  var prev = app.blob;
  var statusEl = document.getElementById('detail-ai-status');

  function finishLocal() {
    app.blob = next;
    app.source = app.source === 'url' ? 'paste' : (app.source || 'paste');
    app.url = app.url || null;
    detailDraftBlob = null;
    return saveApp(app).then(function () {
      renderApps();
      renderDetailView();
    });
  }

  // No published app (no server slot) or signed out → in-memory only, and say so plainly.
  if (!app.published || !app.publishedFilename || !getCortexOwnerToken()) {
    finishLocal().then(function () {
      var s2 = document.getElementById('detail-ai-status');
      if (s2) { s2.style.color = 'var(--text-muted)'; s2.textContent = t('wc.keptLocalOnly'); }
    });
    return;
  }

  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('wc.saving'); }
  saveWorkingCopy({
    owner: detailServerOwner(app),
    filename: app.publishedFilename,
    previousB64: prev,
    nextB64: next,
    note: detailLastChangeNote,
  })
    .then(function () {
      detailHasWorkCopy = true;
      detailWorkSavedAt = new Date().toISOString();
      return finishLocal();
    })
    .then(function () {
      refreshCheckpoints();
      var s2 = document.getElementById('detail-ai-status');
      if (s2) { s2.style.color = '#34d399'; s2.textContent = '✔ ' + t('wc.saved'); }
    })
    .catch(function (err) {
      var s2 = document.getElementById('detail-ai-status');
      if (s2) { s2.style.color = 'var(--accent)'; s2.textContent = '✘ ' + ((err && err.message) || t('wc.saveFailed')); }
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

// Open the EXISTING staging draft of a published app (no re-save). Mints a short-lived,
// owner-only preview token and opens the draft top-level on the real app origin, so the
// owner can try the unpublished staging version instead of the live one. Called straight
// from a library card's "Open staging" button when the listing reported has_draft.
function openStagingPreview(owner, filename) {
  if (!getCortexOwnerToken()) { showNotice(t('detail.draftNeedsSignin')); return; }
  if (!owner || !filename) { showNotice(t('detail.draftNeedsPublished')); return; }
  draftApi('POST', owner, filename, 'draft/preview-token')
    .then(function (data) { window.open(data.preview_url, '_blank', 'noopener'); })
    .catch(function (err) { showNotice(err.message || 'Draft preview failed'); });
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

// ── Saved working copy: try / publish / discard ───────────────────────────────
// These act on the SERVER draft slot, which is authoritative. Publishing must NOT re-upload
// app.blob: after a reload the in-memory blob is materialized from the PUBLISHED bytes, so
// PUT-then-publish would silently overwrite the saved working copy with the live version. The
// AI-proposal path is the only one that stages bytes first (they are not on the server yet).

function detailWorkTry() {
  var app = detailGetApp();
  if (!app || !app.publishedFilename) return;
  openStagingPreview(detailServerOwner(app), app.publishedFilename);
}

async function detailWorkPublish() {
  var app = detailGetApp();
  if (!app || !app.publishedFilename) return;
  if (!getCortexOwnerToken()) { showNotice(t('wc.loginNeeded')); return; }
  if (!(await showConfirm(t('detail.draftPublishConfirm')))) return;
  var owner = detailServerOwner(app);
  draftApi('POST', owner, app.publishedFilename, 'publish-draft')
    .then(function (data) {
      detailEpoch++;
      detailHasWorkCopy = false;
      detailWorkSavedAt = null;
      app.publishedVersionNumber = data.version_number || app.publishedVersionNumber;
      showNotice(t('detail.draftPublished').replace('{v}', data.version_number));
      // Render BEFORE refreshAll: it empties the working set synchronously, after which
      // detailGetApp() is null and renderDetailView() bails, leaving the pre-publish DOM on screen.
      renderDetailView();
      detailLoadVersions(owner, app.publishedFilename);
      refreshAll();
    })
    .catch(function (err) { showNotice('✘ ' + ((err && err.message) || 'Publish failed')); });
}

// Throw the working copy away and pull the live bytes back in, so what you see afterwards really
// IS the published app (rather than a stale in-memory copy of what you just discarded).
async function detailWorkDiscard() {
  var app = detailGetApp();
  if (!app || !app.publishedFilename) return;
  if (!(await showConfirm(t('wc.confirmDiscardWork')))) return;
  var owner = detailServerOwner(app);
  var cfg = loadConfig();
  var aimeatUrl = (cfg.aimeatUrl || '').replace(/\/+$/, '');
  discardWorkingCopy(owner, app.publishedFilename)
    .then(function () { return fetchAppContentBase64(aimeatUrl, owner, app.publishedFilename); })
    .then(function (b64) { app.blob = b64; return saveApp(app); })
    .catch(function () { /* keep whatever we have if the re-fetch fails */ })
    .then(function () {
      detailEpoch++;
      detailHasWorkCopy = false;
      detailWorkSavedAt = null;
      renderDetailView(); // before refreshAll — see detailWorkPublish
      refreshAll();
      showNotice(t('wc.discardedWork'));
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
  publishDraftBytes(app, detailDraftBlob, document.getElementById('detail-ai-status'), function (data) {
    // Published: the slot is cleared server-side, so the working copy is level with the live app.
    detailEpoch++;
    app.blob = detailDraftBlob;
    detailDraftBlob = null;
    detailHasWorkCopy = false;
    detailWorkSavedAt = null;
    if (data && data.version_number) app.publishedVersionNumber = data.version_number;
    saveApp(app);
    renderDetailView(); // before refreshAll — see detailWorkPublish
    refreshAll();
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
// "Save working copy" in the source editor — the SAME contract as the AI loop's save: checkpoint
// the bytes being replaced, then persist to the server draft slot. Previously this button only
// reassigned a transient in-memory blob, so the edit was gone on the next reload. Returns a promise
// so main.js can drive the button's label/disabled state.
function saveSourceAsWorkingCopy() {
  var app = sourceOverlayApp();
  var b64 = sourceCurrentB64();
  if (!app || b64 == null) return Promise.reject(new Error('No app'));
  var statusEl = document.getElementById('source-draft-status');
  var prev = app.blob;
  var isOpenInDetail = (detailAppId === app.id);

  function localOnly() {
    app.blob = b64;
    return saveApp(app).then(function () { renderApps(); });
  }

  // Unpublished app or signed out → no server slot exists; keep the old in-memory behaviour but
  // say plainly that it will not survive a reload.
  if (!app.published || !app.publishedFilename || !getCortexOwnerToken()) {
    return localOnly().then(function () {
      if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('wc.keptLocalOnly'); }
      return { persisted: false };
    });
  }

  if (statusEl) { statusEl.style.color = 'var(--text-muted)'; statusEl.textContent = t('wc.saving'); }
  return saveWorkingCopy({
    owner: detailServerOwner(app),
    filename: app.publishedFilename,
    previousB64: prev,
    nextB64: b64,
    note: t('wc.noteManual'),
  })
    .then(function () { return localOnly(); })
    .then(function () {
      if (isOpenInDetail) {
        detailHasWorkCopy = true;
        detailWorkSavedAt = new Date().toISOString();
        renderDetailView();
        refreshCheckpoints();
      }
      if (statusEl) { statusEl.style.color = '#34d399'; statusEl.textContent = '✔ ' + t('wc.saved'); }
      return { persisted: true };
    })
    .catch(function (err) {
      if (statusEl) { statusEl.style.color = 'var(--accent)'; statusEl.textContent = '✘ ' + ((err && err.message) || t('wc.saveFailed')); }
      throw err;
    });
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
// Delete this app. A published app of ours lives ON THE NODE, so the delete has to go there: before
// the server-only cutover the catalog also held a browser copy and dropping that copy WAS the
// delete, which since then only emptied a page-session record — the app stayed published and came
// back with the next list, so the view just closed and nothing was gone. The server-delete owns the
// confirmation (server-io), and the local record goes only after the node confirms.
async function detailDelete() {
  var app = detailGetApp();
  if (!app) return;
  var id = app.id;
  if (detailIsOwnPublished(app)) {
    var removed = await deleteServerApp(app.publishedFilename, app.name || app.publishedFilename);
    if (!removed) return; // declined at the prompt, or the node refused — leave the detail open
    await deleteApp(id);
    closeDetailView();
    renderApps();
    return;
  }
  if (!(await showConfirm(t('confirm.deleteApp').replace('{name}', function () { return app.name || 'this app'; })))) return;
  await deleteApp(id);
  closeDetailView();
  renderApps();
  loadPublishedApps();
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
        descriptions: meta.descriptions || null,
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

      var ownerArg = "'" + jsArg(owner) + "'";
      var fileArg = "'" + jsArg(filename) + "'";
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
        descriptions: meta.descriptions || null,
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
  detailTranslateDesc,
  detailPromoteSave,
  detailPromoteClear,
  detailToggleFavorite,
  detailAccessCodeEdit,
  detailAccessCodeCancel,
  detailAccessCodeSave,
  detailSkillAttachToggle,
  detailSkillAttach,
  detailSkillDetach,
  detailSetScreenshot,
  detailRefreshScreenshot,
  detailAiRun,
  detailAiTest,
  detailAiKeep,
  detailAiDiscard,
  detailTestDraftLive,
  detailPublishTestedDraft,
  detailWorkTry,
  detailWorkPublish,
  detailWorkDiscard,
  detailCheckpointPreview,
  detailCheckpointRestore,
  detailCheckpointDelete,
  saveSourceAsWorkingCopy,
  openStagingPreview,
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
