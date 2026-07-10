/**
 * @file apps-io.js
 * @description Getting apps INTO the catalog: creation from a ZIP bundle / a URL / an uploaded HTML
 *   file / pasted source, and the "Add app" modal that drives it (open/close/tabs/file-drop/save,
 *   sign-in-gate). editingAppId (which app the modal is editing) lives here; main sets it via the
 *   exported setEditingAppId(). Shared modules by import; main-local fns + the live app-list getter
 *   injected via initAppsIo(deps). Carved from main.js.
 * @usage import { initAppsIo, showModal, addAppFromUrl, setEditingAppId } from './apps-io.js'; initAppsIo({...})
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 10).
 */
import { saveApp } from './db.js';
import { showNotice } from './ui.js';
import { t } from './i18n.js';
import { extractZip, bundleZip } from './zip.js';

// Injected once at bootstrap by main.js (main-local fns + the live allApps getter).
let generateId, readFileAsText, renderApps, getMainApps;
export function initAppsIo(deps) {
  ({ generateId, readFileAsText, renderApps, getMainApps } = deps);
}

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
    for (var i = 0; i < getMainApps().length; i++) {
      if (getMainApps()[i].id === editingAppId) { app = getMainApps()[i]; break; }
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

// main writes editingAppId (context-menu Edit) through this setter.
export function setEditingAppId(v) { editingAppId = v; }

export {
  addAppFromZip,
  addAppFromUrl,
  addAppFromFile,
  addAppFromSource,
  showModal,
  requireSignInThen,
  parseAppMeta,
  closeModal,
  switchTab,
  handleFileDrop,
  handleSave
};
