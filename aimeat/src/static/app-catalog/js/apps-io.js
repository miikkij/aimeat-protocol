/**
 * @file apps-io.js
 * @description Getting apps INTO the catalog. Server-only: creation from an uploaded HTML file, a
 *   pasted source, or a ZIP bundle builds a TRANSIENT record and hands it straight to the publish
 *   flow — it is published to the owner's account (UNLISTED) on the server. There is no browser-local
 *   catalog anymore, so there is no "add a URL bookmark" and nothing is persisted in the browser.
 *   Owns the Add-app modal (open/close/tabs/file-drop/save, sign-in gate) + editingAppId. Shared
 *   modules by import; main-local fns injected via initAppsIo(deps). Carved from main.js.
 * @usage import { initAppsIo, showModal, setEditingAppId } from './apps-io.js'; initAppsIo({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 10).
 *   v2.0.0 — 2026-07-20 — Server-only cutover: drop the local writers (URL/file/paste/zip → IndexedDB);
 *     creation now builds a transient record and publishes it to the server as an unlisted app.
 */
import { saveApp } from './db.js';
import { showNotice } from './ui.js';
import { t } from './i18n.js';
import { extractZip, bundleZip } from './zip.js';
import { getCortexOwnerToken } from './cortex.js';   // sign-in gate in requireSignInThen (runtime-only call, no import cycle)

// Injected once at bootstrap by main.js (main-local fns + the live working-set getter + the publish
// modal opener from server-io, injected to avoid an apps-io ↔ server-io import cycle).
let generateId, readFileAsText, renderApps, getMainApps, showPublishModal;
export function initAppsIo(deps) {
  ({ generateId, readFileAsText, renderApps, getMainApps, showPublishModal } = deps);
}

// ── Create → publish straight to the server (unlisted) ─────────────────────────
// Build a transient in-memory record from raw HTML and open the publish modal for it. The publish
// modal collects filename/description/access-code and POSTs to /v1/apps; the create flow parks the
// result so the new app lands UNLISTED (on the server, not yet public). Nothing is stored locally.
function createAppFromHtml(name, html, icon, tags, description) {
  var encoded = btoa(unescape(encodeURIComponent(html)));
  var app = {
    id: generateId(),
    name: name,
    description: description || '',
    source: 'create',
    url: null,
    blob: encoded,
    tags: tags || [],
    icon: icon || '\u{1F4DD}',
    published: false,
    addedAt: new Date().toISOString()
  };
  return saveApp(app).then(function () {
    // showPublishModal resolves the app from the main working-set (getMainApps), so make the
    // transient record visible there too before opening it (same pattern as openPublishedDetail).
    try { getMainApps().push(app); } catch (e) { /* getter optional */ }
    if (typeof showPublishModal === 'function') showPublishModal(app.id, { unlisted: true });
    return app;
  });
}

// ── Modal State ─────────────────────────────────

var selectedFile = null;
var editingAppId = null;

function showModal() {
  document.getElementById('modal-overlay').hidden = false;
  document.getElementById('modal-title').textContent = t('addModal.title');
  // Server-only: there is no URL-bookmark tab — default to pasting source.
  switchTab('paste');
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

// Everything the Add dialog can learn from the file itself: the AIMEAT App Manifest comment the
// templates embed, then the ordinary HTML head. Measured against six apps published on aimeat.io
// before writing this: four carry a <title>, three carry a manifest, and NOT ONE carries a favicon
// or a keywords meta. So the name is the field this reliably fills; icon and tags are read where
// they exist and left empty where they do not, rather than guessed at.
function parseAppMeta(html) {
  var meta = { name: '', description: '', icon: '', tags: '' };
  var src = html || '';
  try {
    var m = src.match(/AIMEAT App Manifest([\s\S]*?)-->/i);
    if (m) {
      var nm = m[1].match(/\bname:\s*(.+)/i); if (nm) meta.name = nm[1].trim();
      var dm = m[1].match(/\bdescription:\s*(.+)/i); if (dm) meta.description = dm[1].trim();
      var im = m[1].match(/\bicon:\s*(.+)/i); if (im) meta.icon = im[1].trim();
      var gm = m[1].match(/\btags:\s*(.+)/i); if (gm) meta.tags = gm[1].trim();
    }
    var titleText = '';
    var tt = src.match(/<title>([^<]+)<\/title>/i);
    if (tt) titleText = tt[1].trim();
    if (!meta.name && titleText) meta.name = titleText;
    // A leading emoji in the title is the icon nearly every single-file app actually has, and it
    // belongs in the icon field rather than doubled into the name.
    if (!meta.icon && titleText) {
      var lead = titleText.match(/^(\p{Extended_Pictographic}️?)\s+/u);
      if (lead) {
        meta.icon = lead[1];
        if (meta.name === titleText) meta.name = titleText.slice(lead[0].length).trim();
      }
    }
    // The other real source: an emoji drawn into a data-URI SVG favicon.
    if (!meta.icon) {
      var fav = src.match(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i);
      if (fav) {
        var glyph = decodeURIComponent(fav[0]).match(/<text[^>]*>([^<]+)<\/text>/i);
        if (glyph) meta.icon = glyph[1].trim();
      }
    }
    if (!meta.tags) {
      var kw = src.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i);
      if (kw) meta.tags = kw[1].trim();
    }
  } catch (e) { /* a half-written file still publishes; the fields just stay empty */ }
  // Drop unfilled {{template}} placeholders.
  if (/\{\{.*\}\}/.test(meta.name)) meta.name = '';
  if (/\{\{.*\}\}/.test(meta.description)) meta.description = '';
  if (/\{\{.*\}\}/.test(meta.icon)) meta.icon = '';
  if (/\{\{.*\}\}/.test(meta.tags)) meta.tags = '';
  return meta;
}

// Fill what the person has not typed, and never touch what they have. Typing beats the file:
// someone who names their app before pasting it meant that name.
function prefillFromHtml(html, fallbackName) {
  var meta = parseAppMeta(html);
  var setIfEmpty = function (id, value) {
    var el = document.getElementById(id);
    if (el && !el.value.trim() && value) el.value = value;
  };
  setIfEmpty('app-name', meta.name || fallbackName || '');
  setIfEmpty('app-icon', meta.icon);
  setIfEmpty('app-tags', meta.tags);
  return meta;
}

function closeModal() {
  document.getElementById('modal-overlay').hidden = true;
  // Reset form
  document.getElementById('app-name').value = '';
  document.getElementById('app-icon').value = '';
  document.getElementById('app-tags').value = '';
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
  // Read the file, not its name. Naming an app after its file is how a wall ends up full of
  // nuotta.html; the <title> inside is the name its author actually chose. The filename stays
  // as the fallback for a file that carries no title at all.
  var fallback = file.name.replace(/\.html?$/i, '');
  readFileAsText(file)
    .then(function (html) { prefillFromHtml(html, fallback); })
    .catch(function () {
      var nameInput = document.getElementById('app-name');
      if (nameInput && !nameInput.value.trim()) nameInput.value = fallback;
    });
}

function handleSave() {
  var name = document.getElementById('app-name').value.trim();
  var icon = document.getElementById('app-icon').value.trim();
  var tagsRaw = document.getElementById('app-tags').value.trim();
  var tags = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];

  // ── Edit mode: update a transient record's display metadata in place ──
  if (editingAppId) {
    var app = null;
    for (var i = 0; i < getMainApps().length; i++) {
      if (getMainApps()[i].id === editingAppId) { app = getMainApps()[i]; break; }
    }
    if (!app) { closeModal(); return; }
    if (!name) { showNotice('Please enter a name'); return; }
    app.name = name;
    app.icon = icon || app.icon;
    app.tags = tags;
    saveApp(app).then(function () {
      closeModal();
      renderApps();
    });
    return;
  }

  // ── Create mode → publish to the server (unlisted) ──
  var activeTab = document.querySelector('.modal-tab.active');
  var tabName = activeTab ? activeTab.getAttribute('data-tab') : 'paste';

  if (tabName === 'paste') {
    var pastedCode = document.getElementById('app-paste-code').value.trim();
    if (!pastedCode) {
      showNotice('Please paste your HTML source code');
      return;
    }
    var meta = parseAppMeta(pastedCode);
    if (!name) name = meta.name || 'Pasted App';
    closeModal();
    createAppFromHtml(name, pastedCode, icon, tags, meta.description);
  } else if (tabName === 'file') {
    if (!selectedFile) {
      showNotice('Please select a file');
      return;
    }
    var file = selectedFile;
    if (file.name.toLowerCase().endsWith('.zip')) {
      if (!name) name = file.name.replace(/\.zip$/i, '');
      file.arrayBuffer()
        .then(function (arrayBuffer) { return extractZip(arrayBuffer); })
        .then(function (files) { return bundleZip(files); })
        .then(function (html) { closeModal(); return createAppFromHtml(name, html, icon, tags, parseAppMeta(html).description); })
        .catch(function (err) { showNotice('ZIP import failed: ' + (err.message || err)); });
    } else {
      if (!name) name = file.name.replace(/\.html?$/i, '');
      readFileAsText(file).then(function (html) {
        closeModal();
        createAppFromHtml(name, html, icon, tags, parseAppMeta(html).description);
      });
    }
  }
}

// main writes editingAppId (context-menu Edit) through this setter.
export function setEditingAppId(v) { editingAppId = v; }

export {
  showModal,
  requireSignInThen,
  parseAppMeta,
  prefillFromHtml,
  closeModal,
  switchTab,
  handleFileDrop,
  handleSave
};
