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
 *   v2.1.0 — 2026-08-17 — The card menu's Delete goes to the node for a published app instead of
 *     emptying the page-session record, which left the app published and the card in place.
 *   v2.2.0 — 2026-08-19 — a "Loading apps…" state until the first listing lands. An empty grid used to say
 *     "No apps yet. Add your first app", which is an answer, for the whole fetch.
 *   v3.0.0 — 2026-08-28 — The showroom skin: the grid of cards becomes a list of rows (rows.js), the
 *     tag bar becomes a rail with counts and a fold, plus a state filter (listed / unlisted / draft
 *     waiting), a sort order (newest / most opened / A→Z) and the header sticker with the counts.
 *     Built to the design canvas "App Catalog Alternate".
 *   v3.1.0 — 2026-08-28 — The poster face (design canvas "App Catalog Poster"): the rows are a
 *     numbered index that opens in place, the header sticker becomes the band with the numbers
 *     (plus the opens total) and the masthead's mono line, and the foot carries the count.
 *   v3.2.0 — 2026-09-13 — The source editor opens through dialogs.js (the site's one dialog).
 *   v3.3.0 — 2026-09-22 — Drawn from the site's one set (parts-html.js): the menu rows are the
 *     navigation ListRow, the empty and loading states are Text in a Stack without the rocket and
 *     magnifier emoji, the AI and agent markers are chips (the robot emoji leaves), the order words
 *     are found by data-sort and pressed with aria-pressed, and the hidden parts use `hidden`. The
 *     card the list replaced leaves; its note on why a published app opens top-level moves to the row.
 *     The context menu and the prompt outputs move to render-menu.js by pure extraction (the file
 *     was past the line ceiling) and are re-exported from here.
 */
import { escapeHtml, jsArg, isSameOriginUrl } from './util.js';
import { listRow, action, chip, text, stack } from './parts-html.js';
import { getAllApps, saveApp } from './db.js';
import { loadConfig } from './config.js';
import { t, getLang } from './i18n.js';
import { favStarHtml } from './favorites.js';
import { setEditingAppId, switchTab } from './apps-io.js';
import { openPublishedDetail } from './detail.js';
import { applyServerFilter, getCommunityApps, getFavoriteServerApps, rerenderServerLists } from './server-io.js';
import { rowHtml, fmtKb, fmtDate } from './rows.js';
// The context menu and the prompt outputs live in render-menu.js (pure extraction, 2026-09-22);
// they are re-exported below, so the callers still import them from here.

// browser-local list + filter state stay main-owned; injected once via initRender at bootstrap.
let getMainApps, setAllApps, getActiveTag, setActiveTag, getSearchQuery;
export function initRender(deps) {
  ({ getMainApps, setAllApps, getActiveTag, setActiveTag, getSearchQuery } = deps);
}

// external writers (server-io, detail) set these owned vars through the setters.
export function setServerManifests(v) { serverAppManifests = v; }
export function setOwnServerApps(v) { ownServerApps = v; }
export function setIframeUrl(v) { currentIframeUrl = v; }

// ── The rail: the state filter and the tags, each with its count ──────────────────────────
// The view and the search are main-owned; these three are the rail's own.
let activeState = null;      // null | 'listed' | 'unlisted' | 'draft' | one of KUNTO_KEYS — library view only
let sortMode = 'newest';     // 'newest' | 'opens' | 'name' — every list
let tagsExpanded = false;    // the tag list folds after TAGS_FOLDED rows
let lastEntries = [];        // the owner's entries from the last render, for a re-count without a re-fetch
const TAGS_FOLDED = 8;
export function getSortMode() { return sortMode; }

// ── The condition rows: what an app is missing, from the same list the grid is built from ──
// The profile's Apps page counts the same seven things and links here with ?filter=<key>, so a
// number on that page opens exactly these rows. The keys are the contract between the two pages.
export const KUNTO_KEYS = ['noMap', 'noAi', 'specOff', 'seoOff', 'stale60', 'noShot', 'noSkill'];
// The apps a skill is bound to ("owner/filename"), read once per listing by server-io: the seventh
// row cannot be answered from the app list alone.
let boundSkillApps = {};
export function setBoundSkillApps(v) { boundSkillApps = v || {}; }
function kuntoFlags(sa) {
  var m = sa.manifest || {};
  var spec = sa.spec_check && sa.spec_check.status;
  var age = sa.created_at ? (Date.now() - Date.parse(sa.created_at)) : 0;
  return {
    noMap: !(sa.data_map && sa.data_map.missing === false),
    noAi: !(sa.ai_posture || m.aiPosture),
    specOff: spec === 'missing' || spec === 'stale',
    seoOff: sa.seo_state === 'off',
    stale60: age > 60 * 864e5,
    noShot: !sa.has_screenshot,
    noSkill: !boundSkillApps[(sa.owner || '') + '/' + (sa.filename || '')]
  };
}

// One row of the menu: the set's navigation row (a compact ListRow), its count as the value, the
// chosen one on the sun. data-rail-pick lets the phone's menu dialog close after a choice.
function railItem(label, count, on, onclick) {
  return listRow({ density: 'compact', name: escapeHtml(label), onOpen: onclick, selected: on,
    value: typeof count === 'number' ? String(count) : '', rowAttrs: ' data-rail-pick' });
}
function railLabel(label) {
  return text({ kind: 'label' }, escapeHtml(label));
}

// What the tags count: in the library the owner's entries, in the community the other people's
// apps, in the favourites the starred ones. A tag's count is then the number of rows under it.
function railCollection(entries) {
  var view = document.body.getAttribute('data-active-view') || 'library';
  var pick = function (sa) { return { tags: (sa.manifest && sa.manifest.tags) || [] }; };
  if (view === 'community') return getCommunityApps().map(pick);
  if (view === 'favorites') return getFavoriteServerApps().map(pick);
  return entries || [];
}

function renderTags(entries) {
  var tagBar = document.getElementById('tag-bar');
  if (!tagBar) return;
  var coll = railCollection(entries === undefined ? lastEntries : entries);
  var counts = {}, casing = {};
  for (var i = 0; i < coll.length; i++) {
    var tags = coll[i].tags || [], seen = {};
    for (var j = 0; j < tags.length; j++) {
      // Case-insensitive dedup — "Tools" and "tools" are one tag; first-seen casing wins.
      var lc = String(tags[j]).toLowerCase();
      if (seen[lc]) continue;
      seen[lc] = true;
      if (!(lc in casing)) casing[lc] = String(tags[j]);
      counts[lc] = (counts[lc] || 0) + 1;
    }
  }
  var keys = Object.keys(counts).sort(function (a, b) { return (counts[b] - counts[a]) || a.localeCompare(b); });
  var active = getActiveTag();
  var activeLc = (active && active !== '__favorites__') ? String(active).toLowerCase() : null;
  var html = railLabel(t('rail.tags'));
  html += railItem(t('tag.all'), coll.length, active === null, 'window._launcher.filterByTag(null)');
  var shown = tagsExpanded ? keys : keys.slice(0, TAGS_FOLDED);
  // An active tag past the fold stays on screen, or the reader cannot see why the list is short.
  if (activeLc && shown.indexOf(activeLc) < 0 && keys.indexOf(activeLc) >= 0) shown = shown.concat([activeLc]);
  for (var k = 0; k < shown.length; k++) {
    var key = shown[k];
    html += railItem(casing[key], counts[key], activeLc === key, 'window._launcher.filterByTag(\'' + jsArg(casing[key]) + '\')');
  }
  if (keys.length > TAGS_FOLDED) {
    html += '<div>' + action({ kind: 'text', onclick: 'window._launcher.toggleAllTags()', expanded: tagsExpanded },
      escapeHtml(tagsExpanded ? t('rail.fewerTags') : t('rail.allTags').replace('{n}', String(keys.length)))) + '</div>';
  }
  tagBar.innerHTML = html;
}

// The state rows (Listed / Unlisted / Draft waiting) and the header sticker say the same numbers.
function renderStateBar(entries) {
  var listed = 0, unlisted = 0, drafts = 0;
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].parked) unlisted++; else if (entries[i].published) listed++;
    if (entries[i].hasDraft) drafts++;
  }
  var bar = document.getElementById('state-bar');
  if (bar) {
    // The condition rows count the same entries; a row with nothing behind it stays off the rail,
    // and the whole group waits for the listing, or it would show seven zeros before the first load.
    var kuntoHtml = '';
    if (listingLoaded && entries.length) {
      for (var k = 0; k < KUNTO_KEYS.length; k++) {
        var key = KUNTO_KEYS[k];
        var n = 0;
        for (var j = 0; j < entries.length; j++) if (entries[j].kunto && entries[j].kunto[key]) n++;
        if (n) kuntoHtml += railItem(t('kunto.' + key), n, activeState === key, 'window._launcher.filterByState(\'' + key + '\')');
      }
    }
    bar.innerHTML = railLabel(t('rail.state')) +
      railItem(t('state.listed'), listed, activeState === 'listed', 'window._launcher.filterByState(\'listed\')') +
      railItem(t('state.unlisted'), unlisted, activeState === 'unlisted', 'window._launcher.filterByState(\'unlisted\')') +
      railItem(t('state.draft'), drafts, activeState === 'draft', 'window._launcher.filterByState(\'draft\')') +
      (kuntoHtml ? railLabel(t('rail.kunto')) + kuntoHtml : '');
  }
  // The band under the masthead says the same numbers, plus how often the apps were opened.
  var opensTotal = 0;
  for (var o = 0; o < entries.length; o++) opensTotal += entries[o].opens || 0;
  var band = document.getElementById('cat-band');
  if (band) {
    var setN = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    setN('cat-band-apps', String(entries.length));
    setN('cat-band-listed', String(listed));
    setN('cat-band-drafts', String(drafts));
    setN('cat-band-opens', opensTotal.toLocaleString());
    band.hidden = !(listingLoaded && entries.length > 0);
  }
  var mast = document.getElementById('cat-mastline');
  if (mast) {
    var owner = (entries[0] && (entries[0].owner || entries[0].aimeatOwner)) || '';
    var host = (typeof location !== 'undefined' && location.host) ? location.host.replace(/^apps\./, '') : '';
    mast.textContent = (listingLoaded && entries.length > 0)
      ? t('mast.line').replace('{owner}', owner).replace('{n}', String(entries.length)).replace('{host}', host)
      : '';
  }
  var railCount = document.getElementById('rail-count-library');
  if (railCount) railCount.textContent = listingLoaded ? String(entries.length) : '';
}

/** A state row pressed twice clears the filter. */
export function filterByState(state) {
  activeState = (activeState === state) ? null : state;
  renderApps();
}

/** The order of every list: the library re-renders here, the community and favourites through theirs. */
export function setSort(mode) {
  if (mode !== 'opens' && mode !== 'name') mode = 'newest';
  sortMode = mode;
  // The order words are the set's tabs: the chosen one is on (is-on, as Action emits it) and pressed.
  var btns = document.querySelectorAll('#cat-sort [data-sort]');
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].getAttribute('data-sort') === mode;
    btns[i].classList.toggle('is-on', on);
    btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  renderApps();
  rerenderServerLists();
}

export function toggleAllTags() {
  tagsExpanded = !tagsExpanded;
  renderTags();
}

/** newest keeps the server's order (newest first); the other two sort in place. */
export function sortRows(list, getOpens, getName) {
  if (sortMode === 'opens') list.sort(function (a, b) { return (getOpens(b) || 0) - (getOpens(a) || 0); });
  else if (sortMode === 'name') list.sort(function (a, b) { return String(getName(a) || '').localeCompare(String(getName(b) || ''), undefined, { sensitivity: 'base' }); });
  return list;
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
// The viewer's OWN protected app gets its access code appended (a plain navigation carries no
// Bearer, so without the code the owner would land on the unlock page for their own app).
function viewPublished(url, name) {
  try {
    var u = new URL(url, window.location.origin);
    var parts = u.pathname.split('/'); // ['', 'v1', 'apps', owner, filename]
    if (parts[1] === 'v1' && parts[2] === 'apps' && parts[3] && parts[4]) {
      var key = decodeURIComponent(parts[3]) + '/' + decodeURIComponent(parts[4]);
      var codeVal = ownAppAccessCodes[key];
      if (codeVal && !u.searchParams.has('code')) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'code=' + encodeURIComponent(codeVal);
      }
    }
  // eslint-disable-next-line aimeat/no-silent-catch -- an unparseable url just opens as-is; the server still answers with the unlock page
  } catch (err) { void err; }
  window.open(url, '_blank', 'noopener');
}

// Hide the "open in new tab" affordance whenever the framed content is same-origin
// (apex-hosted or blob) — opening it top-level would re-introduce H-2.
function updateOpenExternalBtn() {
  var btn = document.getElementById('iframe-external-btn');
  if (!btn) return;
  btn.hidden = !(currentIframeUrl && !isSameOriginUrl(currentIframeUrl));
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
// "owner/filename" -> the ACCESS CODE of the viewer's OWN protected app. The listing exposes the
// code only to the app's owner; viewPublished appends it so the owner's own Open never lands on
// the unlock page (UX-remake v3, P6). Other people's apps are never in this map.
export let ownAppAccessCodes = {};
export let serverAppManifests = {}; // moved out of server-io: SSOT for the owner-app manifest cache (detail reads via getServerManifests)

// Has the FIRST listing come back yet? Until it has, an empty grid means "we have not asked and
// answered", not "you own nothing" — and the catalogue used to render "No apps yet. Add your first
// app" for the whole wait, which on the production node is several seconds and reads as the answer.
// Flipped once, by loadPublishedApps, on success AND on failure: a failed fetch has still finished.
let listingLoaded = false;
export function setListingLoaded(v) { listingLoaded = !!v; }
export function isListingLoaded() { return listingLoaded; }

/** The grid's "still fetching" block — the same shape as the empty state, so nothing jumps. */
function loadingStateHtml() {
  return emptyStateHtml(t('loading.apps'), t('loading.appsHint'), '', 'status');
}

/** An empty list says why, in the set's words: a heading, the sentence under it, a quiet line. */
function emptyStateHtml(title, desc, note, role) {
  return stack({ density: 'compact', align: 'start', role: role },
    text({ kind: 'heading', size: 'small' }, title) +
    text({ kind: 'body', tone: 'muted' }, desc) +
    (note ? text({ kind: 'caption', tone: 'muted' }, note) : ''));
}

/**
 * The card's AI markers (TARGET-058).
 *
 * TWO different things, and they are deliberately not one badge:
 *   - GENERATIVE — this app makes text/images/audio/video with a model. Public, on every card,
 *     because it is a property of the app that anyone choosing it should be able to see.
 *   - UNLABELLED — the publish check found the app asks for `ai:use` and tells its users nothing.
 *     The node only sends that to the app's OWNER, so its presence here already means "yours".
 *     It is a nudge to fix, never a public scarlet letter.
 */
function aiPostureMarkers(e) {
  var p = e.aiPosture;
  if (!p) return '';
  var out = '';
  if (p.generates && p.generates.length) {
    out += ' ' + chip(escapeHtml(t('card.aiGenerative')), 'plain', t('card.aiGenerativeHint'));
  }
  if (p.gap) {
    out += ' ' + chip(escapeHtml(t('card.aiUnlabelled')), 'coral', t('card.aiUnlabelledHint'));
  }
  return out;
}

// Merge local apps with the owner's server apps into ONE entry per app (deduped by the
// published filename). Local apps own favorites/drag-drop/openMode; the server copy supplies
// the authoritative published/parked/version state; a server app with no local twin becomes a
// read-only "server-only" entry.
export function buildLibraryEntries(localApps, serverApps) {
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
      m.aiPosture = sa.ai_posture || null;
      m.protection = prot;
      m.opens = sa.downloads || 0; m.createdAt = sa.created_at || null; m.size = sa.size || 0;
      // EXACTLY what the old "View" used: the CONSTRUCTED served URL (aimeatUrl/v1/apps/<owner>/<file>),
      // NOT the local publishedUrl — so Open opens the app top-level on its origin (and it SSOs)
      // identically to the old published card's View button.
      m.viewUrl = base + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(fn);
      if (!m.description && sa.manifest && sa.manifest.description) m.description = sa.manifest.description;
    } else {
      var se = {
        hasLocal: false, localId: null,
        name: (sa.manifest && sa.manifest.name) || fn,
        // The app's own icon where it has one; the same fallback the detail title uses.
        icon: sa.icon || (sa.manifest && sa.manifest.icon) || '\u{1F4DD}',
        description: (sa.manifest && sa.manifest.description) || '',
        descriptions: (sa.manifest && sa.manifest.descriptions) || null,
        tags: (sa.manifest && sa.manifest.tags) || [],
        favorite: false, sortOrder: undefined, openMode: 'tab',
        source: 'server', origin: null,
        aimeatOwner: sa.owner || null, aimeatFilename: fn,
        published: !sa.parked, parked: !!sa.parked, serverOnly: true, hasDraft: !!sa.has_draft,
        filename: fn, owner: sa.owner || '',
        versionNumber: sa.version_number || null,
        viewUrl: (base && fn) ? (base + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(fn)) : '',
        forkable: !!sa.forkable, forks: sa.forks || 0, protection: prot, hasAgents: shipsAgent,
        // TARGET-058: what the app says about the AI inside it. The node strips the publish check's
        // gap for everyone but the owner, so a gap arriving here IS the viewer's own app.
        aiPosture: sa.ai_posture || null,
        // The row's facts: how often opened, when the current version landed, how big the file is.
        opens: sa.downloads || 0, createdAt: sa.created_at || null, size: sa.size || 0,
        // What the app is missing, for the condition rows in the rail (KUNTO_KEYS).
        kunto: kuntoFlags(sa)
      };
      entries.push(se);
      if (fn) byFilename[fn] = se;
    }
    // Record authoritative server state so the detail view can manage this app.
    if (fn) {
      serverStateByFilename[fn] = {
        parked: !!sa.parked, forkable: !!sa.forkable, forks: sa.forks || 0,
        owner: sa.owner || '', versionNumber: sa.version_number || null, protection: prot,
        // A saved (unpublished) working copy from ANY earlier session — the detail view's
        // lifecycle band reads this to say "working copy saved" instead of "same as published".
        hasDraft: !!sa.has_draft,
        // `protected` is the ACCESS-CODE flag (distinct from copy-`protection`); the detail view's
        // access-code editor reads it to show whether the app currently requires a code.
        accessCode: !!sa.protected,
        // The detail hero's facts tiles.
        downloads: sa.downloads || 0, size: sa.size || 0, createdAt: sa.created_at || null, category: sa.category || ''
      };
      ownAppProtection[fn] = prot;
      if (sa.access_code) ownAppAccessCodes[(sa.owner || '') + '/' + fn] = sa.access_code;
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

    // The order: the server returns newest-first, which "Newest" keeps; the other two sort here.
    // Listed and Unlisted are no longer grouped — the state rows in the rail do that on request.
    lastEntries = entries;
    sortRows(entries, function (e) { return e.opens; }, function (e) { return e.name; });

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

    // Filter by the rail's state row
    if (activeState === 'listed') filtered = filtered.filter(function (e) { return e.published && !e.parked; });
    else if (activeState === 'unlisted') filtered = filtered.filter(function (e) { return !!e.parked; });
    else if (activeState === 'draft') filtered = filtered.filter(function (e) { return !!e.hasDraft; });
    else if (activeState && KUNTO_KEYS.indexOf(activeState) >= 0) filtered = filtered.filter(function (e) { return !!(e.kunto && e.kunto[activeState]); });

    // Filter by getSearchQuery(): the name, a tag, or what it does
    if (getSearchQuery()) {
      var q = getSearchQuery().toLowerCase();
      filtered = filtered.filter(function (app) {
        if (app.name && app.name.toLowerCase().indexOf(q) !== -1) return true;
        if (app.description && app.description.toLowerCase().indexOf(q) !== -1) return true;
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
      localHeader.hidden = !(entries.length > 0);
      if (localCount) localCount.textContent = String(entries.length);
    }

    if (filtered.length === 0) {
      if (!listingLoaded) {
        grid.innerHTML = loadingStateHtml();
      } else if (!getActiveTag() && !getSearchQuery() && entries.length === 0) {
        grid.innerHTML = emptyStateHtml(t('empty.noApps'), t('empty.noAppsDesc'), t('empty.formats'));
      } else {
        grid.innerHTML = emptyStateHtml(t('empty.noMatch'), t('empty.noMatchDesc'));
      }
    } else {
      var html = '';
      for (var j = 0; j < filtered.length; j++) {
        html += libraryRowHtml(filtered[j], j + 1);
      }
      grid.innerHTML = html;
    }

    // The foot's first fact carries the count. Before the first listing lands the count is a
    // claim we cannot make yet, so the line stays blank.
    var statsEl = document.getElementById('stats');
    statsEl.textContent = listingLoaded ? t('foot.p1').replace('{n}', String(entries.length)) : '';

    renderStateBar(entries);
    renderTags(entries);
  });
}

// One row per app (rows.js draws it). Management (publish, park, fork, protect, versions, remove,
// consents) lives in the detail view — the row carries the state pill, Open (or Open + Draft when
// a working copy waits) and the ⋯ that opens the details.
function libraryRowHtml(e, i) {
  var detailCall = (e.filename)
    ? 'window._launcher.openPublishedDetail(\'' + jsArg(e.owner || '') + '\', \'' + jsArg(e.filename) + '\', \'' + jsArg(e.hasLocal ? e.localId : '') + '\', ' + (e.versionNumber || 0) + ')'
    : 'window._launcher.openDetailView(\'' + jsArg(e.localId) + '\')';
  // Open: a PUBLISHED/PARKED/server app opens TOP-LEVEL on its served URL (clean full page on the
  // app origin) — like the old "View". Launching its local blob (a materialized twin) in the apex
  // sandbox iframe breaks app-origin apps (frame-ancestors CSP). Only a purely-local app launches
  // its local copy. When a working copy waits, Open stays the released version and "Open the draft"
  // is its own word, so the two are never confused; openStagingPreview mints a short-lived
  // owner-only preview URL for the draft and opens it top-level.
  var openCall = ((e.published || e.parked || e.serverOnly) && e.viewUrl)
    ? 'window._launcher.viewPublished(\'' + jsArg(e.viewUrl) + '?mode=inline\', \'' + jsArg(e.name) + '\')'
    : (e.hasLocal
        ? 'window._launcher.launchApp(\'' + jsArg(e.localId) + '\', \'' + jsArg(e.openMode || 'tab') + '\')'
        : detailCall);
  var actions = [{ label: t('card.open'), onclick: openCall, title: t(e.hasDraft ? 'card.openReleasedHint' : 'card.openHint'), kind: 'slab' }];
  if (e.hasDraft && e.viewUrl) {
    actions.push({ label: t('card.openDraft'), onclick: 'window._launcher.openStagingPreview(\'' + jsArg(e.owner || '') + '\', \'' + jsArg(e.filename || '') + '\')', title: t('card.openStagingHint'), kind: 'word' });
  }
  actions.push({ label: t('card.details'), onclick: detailCall, title: t('ctx.details'), kind: 'word' });
  var metaParts = [];
  if (e.versionNumber) metaParts.push('v' + e.versionNumber);
  var when = fmtDate(e.createdAt); if (when) metaParts.push(when);
  var kb = fmtKb(e.size); if (kb) metaParts.push(kb);
  var nameExtra = (e.origin === 'ai-published' ? ' ' + chip('AI') : '') +
    (e.hasAgents ? ' ' + chip(escapeHtml(t('card.agent')), 'plain', t('card.agentHint')) : '') +
    aiPostureMarkers(e);
  // The one line in the panel: where the work is.
  var line = e.hasDraft ? t('row.lineDraft')
    : (e.parked ? t('row.lineUnlisted')
      : (e.published ? t('row.linePublished').replace('{v}', e.versionNumber ? 'v' + e.versionNumber : '').replace('{date}', when || '')
        : t('row.lineLocal')));
  return rowHtml({
    n: i, icon: e.icon, name: e.name, nameExtra: nameExtra,
    favStar: e.filename ? favStarHtml((e.owner || e.aimeatOwner || '') + '/' + e.filename) : '',
    meta: metaParts.join(' · '),
    desc: (e.descriptions && e.descriptions[getLang()]) || e.description || '',
    state: e.parked ? 'unlisted' : (e.published ? 'listed' : 'local'),
    draft: !!e.hasDraft, opens: e.opens, tags: e.tags, line: line, actions: actions
  });
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

export {
  getMainApps,
  renderTags,
  filterByTag,
  launchApp,
  launchInTab,
  viewPublished,
  launchInIframe,
  renderApps,
  closeIframe,
  openExternal
};
