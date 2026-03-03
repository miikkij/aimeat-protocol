# App Launcher Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone, single-file HTML app launcher that lets users organize and launch their HTML/CSS/JS apps from one place, with optional AIMEAT integration.

**Architecture:** Single `app-launcher.html` file with inline CSS and JS. Uses IndexedDB for app registry storage and localStorage for preferences. ZIP imports use an inline bundler to merge multi-file projects into single HTML blobs. Optional AIMEAT connector fetches apps from `/v1/apps` API.

**Tech Stack:** Vanilla HTML/CSS/JS, IndexedDB API, FileReader API, Blob/URL APIs, JSZip (bundled inline via CDN-free minified version or hand-rolled ZIP parser)

**Design doc:** `docs/plans/2026-03-03-app-launcher-design.md`

**Style reference:** `aimeat/src/static/offline.html` (dark theme, gradients, modern CSS)

---

## Task 1: HTML Scaffold + IndexedDB Core

**Files:**
- Create: `aimeat/src/static/app-launcher.html`

**Step 1: Create the HTML scaffold**

Create the file with:
- HTML5 doctype, UTF-8 charset, viewport meta
- CSS variables for theming (dark default): `--bg: #1a1a2e`, `--surface: #16213e`, `--text: #f0e6ff`, `--accent: #e94560`, `--accent2: #0f3460`
- Basic layout: header (title + action buttons), tag bar, grid container, footer (stats)
- Responsive grid using CSS Grid (`grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`)
- Empty `<script>` section with IIFE wrapper

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Apps</title>
  <style>
    :root { /* CSS variables */ }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background: var(--bg); color: var(--text); font-family: system-ui; }
    /* Header, grid, card, modal, iframe-view styles */
  </style>
</head>
<body>
  <header><!-- title, search, add, settings --></header>
  <nav id="tag-bar"><!-- tag filters --></nav>
  <main id="app-grid"><!-- app cards --></main>
  <footer><!-- stats --></footer>
  <div id="modal-overlay" hidden><!-- modals --></div>
  <div id="iframe-view" hidden><!-- iframe container --></div>
  <script>
  (function() {
    'use strict';
    // All JS here
  })();
  </script>
</body>
</html>
```

**Step 2: Implement IndexedDB wrapper**

Inside the `<script>`, create a minimal DB module:

```js
const DB_NAME = 'AppLauncherDB';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('apps')) {
        const store = db.createObjectStore('apps', { keyPath: 'id' });
        store.createIndex('tags', 'tags', { multiEntry: true });
        store.createIndex('source', 'source');
        store.createIndex('favorite', 'favorite');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllApps() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('apps', 'readonly');
    const req = tx.objectStore('apps').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveApp(app) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('apps', 'readwrite');
    tx.objectStore('apps').put(app);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteApp(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('apps', 'readwrite');
    tx.objectStore('apps').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

**Step 3: Implement config (localStorage)**

```js
const DEFAULT_CONFIG = {
  theme: 'dark',
  defaultOpenMode: 'tab',
  aimeatUrl: '',
  language: 'en'
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem('appLauncherConfig') || '{}') };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function saveConfig(config) {
  localStorage.setItem('appLauncherConfig', JSON.stringify(config));
}
```

**Step 4: Verify by opening the file in browser**

Open `app-launcher.html` in browser. Open DevTools → Application → IndexedDB. Verify `AppLauncherDB` database is created with `apps` object store.

Run in console to test:
```js
// Should work without errors
await saveApp({ id: 'test-1', name: 'Test', source: 'local', tags: [], openMode: 'tab', addedAt: new Date().toISOString() });
const apps = await getAllApps();
console.log(apps); // Should show the test app
await deleteApp('test-1');
```

**Step 5: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): scaffold app-launcher.html with IndexedDB core"
```

---

## Task 2: Add App UI (URL + File Import)

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Create the "Add App" modal**

Add modal HTML inside `#modal-overlay`:

```html
<div id="add-modal" class="modal" hidden>
  <h2>Add App</h2>
  <div class="tab-buttons">
    <button data-tab="url" class="active">URL</button>
    <button data-tab="file">File</button>
  </div>

  <!-- URL tab -->
  <div id="tab-url" class="tab-content">
    <input type="url" id="app-url" placeholder="https://example.com/app.html">
  </div>

  <!-- File tab -->
  <div id="tab-file" class="tab-content" hidden>
    <div id="drop-zone">
      Drag & drop HTML or ZIP file here
      <input type="file" id="file-input" accept=".html,.htm,.zip" hidden>
      <button id="browse-btn">Browse</button>
    </div>
  </div>

  <!-- Common fields -->
  <input type="text" id="app-name" placeholder="App name">
  <input type="text" id="app-icon" placeholder="Emoji icon (e.g. 📝)" maxlength="4">
  <input type="text" id="app-tags" placeholder="Tags (comma separated)">
  <select id="app-open-mode">
    <option value="tab">Open in new tab</option>
    <option value="iframe">Open in iframe</option>
  </select>
  <div class="modal-actions">
    <button id="save-app-btn">Save</button>
    <button id="cancel-add-btn">Cancel</button>
  </div>
</div>
```

**Step 2: Implement file reading logic**

```js
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // strip data: prefix
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
```

**Step 3: Implement save logic for URL and HTML file apps**

```js
async function addAppFromUrl(name, url, icon, tags, openMode) {
  const app = {
    id: generateId(),
    name: name || new URL(url).hostname,
    description: '',
    source: 'url',
    url,
    blob: null,
    tags: tags.filter(t => t.trim()),
    openMode,
    icon: icon || '🌐',
    screenshot: null,
    favorite: false,
    addedAt: new Date().toISOString(),
    lastOpenedAt: null
  };
  await saveApp(app);
  return app;
}

async function addAppFromFile(name, file, icon, tags, openMode) {
  const content = await readFileAsText(file);
  const app = {
    id: generateId(),
    name: name || file.name.replace(/\.[^.]+$/, ''),
    description: '',
    source: 'local',
    url: null,
    blob: btoa(unescape(encodeURIComponent(content))), // UTF-8 safe base64
    tags: tags.filter(t => t.trim()),
    openMode,
    icon: icon || '📄',
    screenshot: null,
    favorite: false,
    addedAt: new Date().toISOString(),
    lastOpenedAt: null
  };
  await saveApp(app);
  return app;
}
```

**Step 4: Wire up modal events**

```js
// Add button opens modal
document.getElementById('add-btn').addEventListener('click', () => {
  document.getElementById('add-modal').hidden = false;
  document.getElementById('modal-overlay').hidden = false;
});

// Tab switching
document.querySelectorAll('#add-modal .tab-buttons button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#add-modal .tab-content').forEach(t => t.hidden = true);
    document.querySelectorAll('#add-modal .tab-buttons button').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + btn.dataset.tab).hidden = false;
    btn.classList.add('active');
  });
});

// Drag & drop
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelect(file);
});

// Browse button
document.getElementById('browse-btn').addEventListener('click', () => document.getElementById('file-input').click());
document.getElementById('file-input').addEventListener('change', e => {
  if (e.target.files[0]) handleFileSelect(e.target.files[0]);
});

let selectedFile = null;
function handleFileSelect(file) {
  selectedFile = file;
  document.getElementById('app-name').value = file.name.replace(/\.[^.]+$/, '');
  dropZone.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
}

// Save
document.getElementById('save-app-btn').addEventListener('click', async () => {
  const name = document.getElementById('app-name').value.trim();
  const icon = document.getElementById('app-icon').value.trim();
  const tags = document.getElementById('app-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const openMode = document.getElementById('app-open-mode').value;
  const urlTab = !document.getElementById('tab-url').hidden;

  if (urlTab) {
    const url = document.getElementById('app-url').value.trim();
    if (!url) return alert('Please enter a URL');
    await addAppFromUrl(name, url, icon, tags, openMode);
  } else {
    if (!selectedFile) return alert('Please select a file');
    if (selectedFile.name.endsWith('.zip')) {
      // ZIP handling in Task 6
      alert('ZIP support coming soon');
      return;
    }
    await addAppFromFile(name, selectedFile, icon, tags, openMode);
  }

  closeModal();
  renderApps();
});
```

**Step 5: Verify by adding a test app**

1. Open app-launcher.html in browser
2. Click (+) Add button
3. Paste a URL → Save → Should appear in grid
4. Switch to File tab → Drag an HTML file → Save → Should appear in grid
5. Check IndexedDB in DevTools → both apps stored

**Step 6: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add app creation UI with URL and file import"
```

---

## Task 3: Grid View with App Cards

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Implement the renderApps() function**

```js
let allApps = [];
let activeTag = null;
let searchQuery = '';

async function renderApps() {
  allApps = await getAllApps();

  // Sort: favorites first, then by lastOpenedAt or addedAt
  allApps.sort((a, b) => {
    if (a.favorite !== b.favorite) return b.favorite ? 1 : -1;
    const aDate = a.lastOpenedAt || a.addedAt;
    const bDate = b.lastOpenedAt || b.addedAt;
    return bDate.localeCompare(aDate);
  });

  // Filter by tag
  let filtered = activeTag
    ? allApps.filter(a => a.favorite ? activeTag === '⭐' : a.tags.includes(activeTag))
    : allApps;

  // Filter by search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  const grid = document.getElementById('app-grid');
  grid.innerHTML = filtered.map(app => `
    <div class="app-card" data-id="${app.id}" oncontextmenu="showContextMenu(event, '${app.id}')">
      <div class="app-icon">${app.icon || '📱'}</div>
      <div class="app-name">${escapeHtml(app.name)}</div>
      <div class="app-source">${sourceLabel(app.source)}</div>
      <div class="app-actions">
        <button onclick="launchApp('${app.id}', 'tab')" title="Open in tab">▶ Tab</button>
        <button onclick="launchApp('${app.id}', 'iframe')" title="Open in iframe">◻</button>
      </div>
      ${app.favorite ? '<div class="favorite-badge">⭐</div>' : ''}
    </div>
  `).join('');

  // Update stats
  const totalSize = allApps.reduce((sum, a) => sum + (a.blob ? atob(a.blob).length : 0), 0);
  document.getElementById('stats').textContent =
    `${allApps.length} apps | ${(totalSize / 1024 / 1024).toFixed(1)} MB stored`;

  // Update tag bar
  renderTags();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sourceLabel(source) {
  return { local: '📄 local', url: '🌐 url', aimeat: '📦 aimeat', zip: '📦 zip' }[source] || source;
}
```

**Step 2: Add CSS for app cards**

```css
.app-card {
  background: var(--surface);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  padding: 1rem;
  text-align: center;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  position: relative;
}
.app-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(233, 69, 96, 0.2);
}
.app-icon { font-size: 2.5rem; margin-bottom: 0.5rem; }
.app-name { font-weight: 600; margin-bottom: 0.25rem; }
.app-source { font-size: 0.75rem; opacity: 0.6; margin-bottom: 0.5rem; }
.app-actions { display: flex; gap: 0.5rem; justify-content: center; }
.app-actions button {
  background: var(--accent2);
  color: var(--text);
  border: none;
  border-radius: 6px;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  font-size: 0.8rem;
}
.app-actions button:hover { background: var(--accent); }
.favorite-badge { position: absolute; top: 0.5rem; right: 0.5rem; }
```

**Step 3: Wire up search**

```js
document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderApps();
});
```

**Step 4: Call renderApps() on page load**

```js
document.addEventListener('DOMContentLoaded', () => {
  renderApps();
});
```

**Step 5: Verify grid rendering**

1. Open app-launcher.html
2. Previously added apps should appear as cards
3. Type in search box → cards filter in real time
4. Check hover effects on cards

**Step 6: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add grid view with app cards and search"
```

---

## Task 4: Tag System

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Implement tag bar rendering**

```js
function renderTags() {
  const allTags = new Set();
  allApps.forEach(a => a.tags.forEach(t => allTags.add(t)));
  const hasFavorites = allApps.some(a => a.favorite);

  const tagBar = document.getElementById('tag-bar');
  tagBar.innerHTML = `
    <button class="tag-btn ${!activeTag ? 'active' : ''}" onclick="filterByTag(null)">All</button>
    ${hasFavorites ? `<button class="tag-btn ${activeTag === '⭐' ? 'active' : ''}" onclick="filterByTag('⭐')">⭐ Favorites</button>` : ''}
    ${[...allTags].map(tag =>
      `<button class="tag-btn ${activeTag === tag ? 'active' : ''}" onclick="filterByTag('${escapeHtml(tag)}')">${escapeHtml(tag)}</button>`
    ).join('')}
  `;
}

function filterByTag(tag) {
  activeTag = tag;
  renderApps();
}
```

**Step 2: Add tag bar CSS**

```css
#tag-bar {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.tag-btn {
  background: transparent;
  color: var(--text);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 20px;
  padding: 0.3rem 0.8rem;
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.85rem;
}
.tag-btn.active { background: var(--accent); border-color: var(--accent); }
.tag-btn:hover { border-color: var(--accent); }
```

**Step 3: Verify tag filtering**

1. Add apps with different tags
2. Click tag buttons → grid filters correctly
3. Click "All" → shows everything
4. Verify favorites badge and filter work

**Step 4: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add tag-based filtering system"
```

---

## Task 5: App Launching (Tab + Iframe)

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Implement launchApp()**

```js
async function launchApp(id, mode) {
  const app = allApps.find(a => a.id === id);
  if (!app) return;

  // Update lastOpenedAt
  app.lastOpenedAt = new Date().toISOString();
  await saveApp(app);

  if (mode === 'tab') {
    launchInTab(app);
  } else {
    launchInIframe(app);
  }
}

function launchInTab(app) {
  if (app.source === 'url' && app.url) {
    window.open(app.url, '_blank');
  } else if (app.blob) {
    const html = decodeURIComponent(escape(atob(app.blob))); // UTF-8 safe decode
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    // Note: blob URL stays valid as long as the creating document lives
  }
}

function launchInIframe(app) {
  const iframeView = document.getElementById('iframe-view');
  const iframe = document.getElementById('app-iframe');
  const title = document.getElementById('iframe-title');

  title.textContent = app.name;
  iframeView.hidden = false;
  document.getElementById('app-grid').hidden = true;
  document.getElementById('tag-bar').hidden = true;

  if (app.source === 'url' && app.url) {
    iframe.src = app.url;
    iframe.removeAttribute('srcdoc');
  } else if (app.blob) {
    const html = decodeURIComponent(escape(atob(app.blob)));
    iframe.srcdoc = html;
    iframe.removeAttribute('src');
  }

  // Store current app id for "open in tab" button
  iframe.dataset.appId = app.id;
}

function closeIframe() {
  document.getElementById('iframe-view').hidden = true;
  document.getElementById('app-grid').hidden = false;
  document.getElementById('tag-bar').hidden = false;
  const iframe = document.getElementById('app-iframe');
  iframe.removeAttribute('src');
  iframe.removeAttribute('srcdoc');
}
```

**Step 2: Add iframe view HTML**

```html
<div id="iframe-view" hidden>
  <div class="iframe-header">
    <button onclick="closeIframe()">← Back</button>
    <span id="iframe-title"></span>
    <button onclick="launchApp(document.getElementById('app-iframe').dataset.appId, 'tab')">↗ New tab</button>
    <button onclick="closeIframe()">✕</button>
  </div>
  <iframe id="app-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</div>
```

**Step 3: Add iframe CSS**

```css
#iframe-view {
  position: fixed; inset: 0;
  background: var(--bg);
  z-index: 100;
  display: flex; flex-direction: column;
}
.iframe-header {
  display: flex; align-items: center; gap: 1rem;
  padding: 0.5rem 1rem;
  background: var(--surface);
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.iframe-header span { flex: 1; font-weight: 600; }
#app-iframe { flex: 1; border: none; width: 100%; }
```

**Step 4: Verify launching**

1. Click "▶ Tab" on a URL app → opens in new browser tab
2. Click "▶ Tab" on a local (blob) app → opens blob URL in new tab
3. Click "◻" on any app → iframe view appears with app content
4. Click "← Back" → returns to grid
5. Click "↗ New tab" while in iframe → opens the same app in a new tab

**Step 5: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add tab and iframe app launching"
```

---

## Task 6: Context Menu

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Add context menu HTML**

```html
<div id="context-menu" class="context-menu" hidden>
  <button onclick="editApp()">✏️ Edit</button>
  <button onclick="toggleFavorite()">⭐ Toggle favorite</button>
  <button onclick="toggleOpenMode()">🔄 Switch open mode</button>
  <hr>
  <button onclick="deleteAppConfirm()" class="danger">🗑️ Delete</button>
</div>
```

**Step 2: Implement context menu logic**

```js
let contextAppId = null;

function showContextMenu(event, id) {
  event.preventDefault();
  contextAppId = id;
  const menu = document.getElementById('context-menu');
  menu.hidden = false;
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
}

document.addEventListener('click', () => {
  document.getElementById('context-menu').hidden = true;
});

async function toggleFavorite() {
  const app = allApps.find(a => a.id === contextAppId);
  if (!app) return;
  app.favorite = !app.favorite;
  await saveApp(app);
  renderApps();
}

async function toggleOpenMode() {
  const app = allApps.find(a => a.id === contextAppId);
  if (!app) return;
  app.openMode = app.openMode === 'tab' ? 'iframe' : 'tab';
  await saveApp(app);
  renderApps();
}

async function deleteAppConfirm() {
  if (!confirm('Delete this app?')) return;
  await deleteApp(contextAppId);
  renderApps();
}

function editApp() {
  const app = allApps.find(a => a.id === contextAppId);
  if (!app) return;
  // Reuse add modal in edit mode
  document.getElementById('app-name').value = app.name;
  document.getElementById('app-icon').value = app.icon || '';
  document.getElementById('app-tags').value = app.tags.join(', ');
  document.getElementById('app-open-mode').value = app.openMode;
  document.getElementById('add-modal').hidden = false;
  document.getElementById('modal-overlay').hidden = false;
  // Set edit mode flag
  document.getElementById('add-modal').dataset.editId = app.id;
}
```

**Step 3: Update save handler to support edit mode**

In the save button click handler, check for edit mode:

```js
// At the start of save handler:
const editId = document.getElementById('add-modal').dataset.editId;
if (editId) {
  const app = allApps.find(a => a.id === editId);
  if (app) {
    app.name = name || app.name;
    app.icon = icon || app.icon;
    app.tags = tags;
    app.openMode = openMode;
    await saveApp(app);
    delete document.getElementById('add-modal').dataset.editId;
    closeModal();
    renderApps();
    return;
  }
}
```

**Step 4: Add context menu CSS**

```css
.context-menu {
  position: fixed;
  background: var(--surface);
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 8px;
  padding: 0.25rem;
  z-index: 200;
  min-width: 160px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
.context-menu button {
  display: block; width: 100%;
  background: transparent; color: var(--text);
  border: none; padding: 0.5rem 0.75rem;
  text-align: left; cursor: pointer;
  border-radius: 4px; font-size: 0.85rem;
}
.context-menu button:hover { background: rgba(255,255,255,0.1); }
.context-menu .danger:hover { background: rgba(233, 69, 96, 0.3); }
.context-menu hr { border-color: rgba(255,255,255,0.1); margin: 0.25rem 0; }
```

**Step 5: Verify context menu**

1. Right-click an app card → context menu appears at cursor
2. Click "Toggle favorite" → star badge appears/disappears
3. Click "Edit" → modal opens with current values
4. Click "Delete" → confirmation → app removed
5. Click elsewhere → menu closes

**Step 6: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add context menu with edit, favorite, delete"
```

---

## Task 7: ZIP Inline Bundler

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Add a minimal ZIP parser**

Rather than bundling the full JSZip library (~100KB), implement a minimal ZIP reader that handles the basic ZIP format (local file headers). This keeps the file size small. If this proves insufficient, switch to embedding a minified JSZip.

```js
// Minimal ZIP extractor for standard ZIP files
// Supports: Store (no compression) and Deflate
async function extractZip(arrayBuffer) {
  // Use the browser's built-in DecompressionStream for deflate
  const view = new DataView(arrayBuffer);
  const files = [];
  let offset = 0;

  while (offset < view.byteLength - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // Not a local file header

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset + 30, nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const rawData = new Uint8Array(arrayBuffer, dataStart, compressedSize);

    let data;
    if (compressionMethod === 0) {
      data = rawData; // Stored (no compression)
    } else if (compressionMethod === 8) {
      // Deflate — use DecompressionStream
      const ds = new DecompressionStream('raw');
      const writer = ds.writable.getWriter();
      writer.write(rawData);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      data = new Uint8Array(totalLen);
      let pos = 0;
      for (const chunk of chunks) { data.set(chunk, pos); pos += chunk.length; }
    } else {
      throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }

    if (!name.endsWith('/')) { // Skip directories
      files.push({ name, data });
    }
    offset = dataStart + compressedSize;
  }

  return files;
}
```

**Step 2: Implement inline bundler**

```js
function mimeFromExtension(name) {
  const ext = name.split('.').pop().toLowerCase();
  return {
    'css': 'text/css', 'js': 'text/javascript', 'mjs': 'text/javascript',
    'json': 'application/json', 'svg': 'image/svg+xml',
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
    'gif': 'image/gif', 'webp': 'image/webp', 'ico': 'image/x-icon',
    'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf',
  }[ext] || 'application/octet-stream';
}

function toBase64(uint8arr) {
  let binary = '';
  for (let i = 0; i < uint8arr.length; i++) binary += String.fromCharCode(uint8arr[i]);
  return btoa(binary);
}

async function bundleZip(files) {
  // Find index.html
  let indexFile = files.find(f => f.name === 'index.html')
    || files.find(f => f.name.endsWith('.html'));
  if (!indexFile) throw new Error('No HTML file found in ZIP');

  let html = new TextDecoder().decode(indexFile.data);
  const basePath = indexFile.name.includes('/') ? indexFile.name.substring(0, indexFile.name.lastIndexOf('/') + 1) : '';

  // Build a map of relative paths to file data
  const fileMap = new Map();
  for (const f of files) {
    let relPath = f.name;
    if (basePath && relPath.startsWith(basePath)) relPath = relPath.slice(basePath.length);
    fileMap.set(relPath, f);
    // Also store with ./ prefix
    fileMap.set('./' + relPath, f);
  }

  // Inline <link rel="stylesheet" href="...">
  html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi, (match, href) => {
    const file = fileMap.get(href);
    if (!file) return match;
    const css = new TextDecoder().decode(file.data);
    return `<style>/* ${href} */\n${css}</style>`;
  });

  // Inline <script src="...">
  html = html.replace(/<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi, (match, src) => {
    const file = fileMap.get(src);
    if (!file) return match;
    const js = new TextDecoder().decode(file.data);
    return `<script>/* ${src} */\n${js}</script>`;
  });

  // Inline images: <img src="..."> → data: URL
  html = html.replace(/(src|href)=["']([^"']+\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf))["']/gi, (match, attr, path, ext) => {
    const file = fileMap.get(path);
    if (!file) return match;
    const mime = mimeFromExtension(path);
    const b64 = toBase64(file.data);
    return `${attr}="data:${mime};base64,${b64}"`;
  });

  // Inline CSS url(...) references
  html = html.replace(/url\(["']?([^"')]+\.(png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf))["']?\)/gi, (match, path, ext) => {
    const file = fileMap.get(path);
    if (!file) return match;
    const mime = mimeFromExtension(path);
    const b64 = toBase64(file.data);
    return `url("data:${mime};base64,${b64}")`;
  });

  return html;
}
```

**Step 3: Wire up ZIP handling in add modal**

Update the save handler's ZIP branch:

```js
if (selectedFile.name.endsWith('.zip')) {
  const arrayBuffer = await selectedFile.arrayBuffer();
  const files = await extractZip(arrayBuffer);
  const bundledHtml = await bundleZip(files);

  const app = {
    id: generateId(),
    name: name || selectedFile.name.replace('.zip', ''),
    description: '',
    source: 'zip',
    url: null,
    blob: btoa(unescape(encodeURIComponent(bundledHtml))),
    tags: tags.filter(t => t.trim()),
    openMode,
    icon: icon || '📦',
    screenshot: null,
    favorite: false,
    addedAt: new Date().toISOString(),
    lastOpenedAt: null
  };
  await saveApp(app);
  closeModal();
  renderApps();
  return;
}
```

**Step 4: Verify ZIP import**

Create a test ZIP with:
```
test-app/
├── index.html (with <link href="style.css"> and <script src="app.js">)
├── style.css
└── app.js
```

1. Drag ZIP into launcher → auto-detected as ZIP
2. Save → app appears with 📦 icon
3. Click "▶ Tab" → opens bundled HTML with inlined CSS/JS
4. Verify styles and JS work correctly in the opened page

**Step 5: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add ZIP import with inline bundler"
```

---

## Task 8: AIMEAT Integration

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`
- Modify: `aimeat/src/routes/apps.ts` (add inline serve mode)

**Step 1: Add inline serve mode to apps.ts**

The current download endpoint uses `Content-Disposition: attachment`. Add a `?mode=inline` query parameter option:

In `aimeat/src/routes/apps.ts`, in the GET `/v1/apps/:owner/:filename` handler, replace the static `attachment` header with a conditional:

```typescript
// Line ~115-119 in apps.ts, replace Content-Disposition logic:
const mode = req.query.mode as string | undefined;
if (mode === 'inline') {
  // Serve inline (for iframe embedding) — but use sandbox CSP
  res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' data: blob:");
} else {
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}
```

**Step 2: Add AIMEAT connector to launcher**

```js
async function importFromAimeat() {
  const config = loadConfig();
  if (!config.aimeatUrl) {
    alert('Set AIMEAT server URL in Settings first');
    return;
  }

  try {
    const resp = await fetch(`${config.aimeatUrl}/v1/apps`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const apps = json.data?.apps || [];

    if (apps.length === 0) {
      alert('No apps found on AIMEAT server');
      return;
    }

    showAimeatImportDialog(apps);
  } catch (err) {
    alert(`Failed to connect to AIMEAT: ${err.message}`);
  }
}

function showAimeatImportDialog(aimeatApps) {
  // Create a selection dialog listing available apps
  const dialog = document.createElement('div');
  dialog.className = 'modal';
  dialog.innerHTML = `
    <h2>Import from AIMEAT</h2>
    <p>${aimeatApps.length} apps available</p>
    <div class="aimeat-app-list">
      ${aimeatApps.map((a, i) => `
        <label class="aimeat-app-item">
          <input type="checkbox" value="${i}">
          <span>${escapeHtml(a.filename)} (${(a.size/1024).toFixed(1)} KB)</span>
          <select>
            <option value="link">Link (online only)</option>
            <option value="offline">Download (offline)</option>
          </select>
        </label>
      `).join('')}
    </div>
    <div class="modal-actions">
      <button id="import-selected">Import Selected</button>
      <button onclick="this.closest('.modal').remove()">Cancel</button>
    </div>
  `;

  dialog.querySelector('#import-selected').addEventListener('click', async () => {
    const config = loadConfig();
    const items = dialog.querySelectorAll('.aimeat-app-item');
    for (const item of items) {
      const checkbox = item.querySelector('input');
      if (!checkbox.checked) continue;
      const idx = parseInt(checkbox.value);
      const mode = item.querySelector('select').value;
      const aimeatApp = aimeatApps[idx];

      if (mode === 'link') {
        await addAppFromUrl(
          aimeatApp.filename.replace(/\.[^.]+$/, ''),
          `${config.aimeatUrl}${aimeatApp.download_url}?mode=inline`,
          '📦', ['aimeat'], loadConfig().defaultOpenMode
        );
      } else {
        // Download content and store locally
        const resp = await fetch(`${config.aimeatUrl}${aimeatApp.download_url}`);
        const text = await resp.text();
        const app = {
          id: generateId(),
          name: aimeatApp.filename.replace(/\.[^.]+$/, ''),
          description: '',
          source: 'aimeat',
          url: `${config.aimeatUrl}${aimeatApp.download_url}`,
          blob: btoa(unescape(encodeURIComponent(text))),
          tags: ['aimeat'],
          openMode: loadConfig().defaultOpenMode,
          icon: '📦',
          screenshot: null,
          favorite: false,
          addedAt: new Date().toISOString(),
          lastOpenedAt: null
        };
        await saveApp(app);
      }
    }
    dialog.remove();
    renderApps();
  });

  document.getElementById('modal-overlay').hidden = false;
  document.getElementById('modal-overlay').appendChild(dialog);
}
```

**Step 3: Add AIMEAT import button to header or add modal**

Add an "Import from AIMEAT" tab in the add modal:

```html
<button data-tab="aimeat">AIMEAT</button>
<!-- ... -->
<div id="tab-aimeat" class="tab-content" hidden>
  <p>Import apps from your AIMEAT server</p>
  <button onclick="importFromAimeat()">Fetch Available Apps</button>
</div>
```

**Step 4: Verify AIMEAT integration**

1. Start AIMEAT server (`pnpm dev` in aimeat/)
2. Upload a test app to AIMEAT via API
3. Open launcher → (+) → AIMEAT tab → Fetch → apps appear
4. Select an app with "Link" mode → imports as URL
5. Select an app with "Download" mode → imports with blob content
6. Verify both modes launch correctly

**Step 5: Commit**

```bash
git add aimeat/src/static/app-launcher.html aimeat/src/routes/apps.ts
git commit -m "feat(launcher): add AIMEAT integration with import dialog"
```

---

## Task 9: Settings + Export/Import

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`

**Step 1: Add settings modal**

```html
<div id="settings-modal" class="modal" hidden>
  <h2>Settings</h2>
  <label>
    Theme
    <select id="setting-theme">
      <option value="dark">Dark</option>
      <option value="light">Light</option>
    </select>
  </label>
  <label>
    Default open mode
    <select id="setting-open-mode">
      <option value="tab">New tab</option>
      <option value="iframe">Iframe</option>
    </select>
  </label>
  <label>
    AIMEAT Server URL
    <input type="url" id="setting-aimeat-url" placeholder="http://localhost:40050">
  </label>
  <hr>
  <h3>Backup</h3>
  <button onclick="exportBackup()">Export JSON</button>
  <button onclick="document.getElementById('import-file').click()">Import JSON</button>
  <input type="file" id="import-file" accept=".json" hidden>
  <hr>
  <button onclick="clearAllData()" class="danger">Clear all data</button>
  <div class="modal-actions">
    <button onclick="saveSettings()">Save</button>
    <button onclick="closeSettingsModal()">Cancel</button>
  </div>
</div>
```

**Step 2: Implement settings logic**

```js
function openSettings() {
  const config = loadConfig();
  document.getElementById('setting-theme').value = config.theme;
  document.getElementById('setting-open-mode').value = config.defaultOpenMode;
  document.getElementById('setting-aimeat-url').value = config.aimeatUrl;
  document.getElementById('settings-modal').hidden = false;
  document.getElementById('modal-overlay').hidden = false;
}

function saveSettings() {
  const config = loadConfig();
  config.theme = document.getElementById('setting-theme').value;
  config.defaultOpenMode = document.getElementById('setting-open-mode').value;
  config.aimeatUrl = document.getElementById('setting-aimeat-url').value.replace(/\/+$/, '');
  saveConfig(config);
  applyTheme(config.theme);
  closeSettingsModal();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
```

**Step 3: Implement export/import**

```js
async function exportBackup() {
  const apps = await getAllApps();
  const config = loadConfig();
  const backup = { version: 1, exportedAt: new Date().toISOString(), config, apps };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `app-launcher-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await readFileAsText(file);
    const backup = JSON.parse(text);
    if (!backup.version || !backup.apps) throw new Error('Invalid backup format');

    if (!confirm(`Import ${backup.apps.length} apps? This will add to your existing apps.`)) return;

    for (const app of backup.apps) {
      app.id = generateId(); // New IDs to avoid conflicts
      await saveApp(app);
    }
    if (backup.config) {
      saveConfig({ ...loadConfig(), ...backup.config });
    }
    renderApps();
    alert(`Imported ${backup.apps.length} apps`);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

async function clearAllData() {
  if (!confirm('Delete ALL apps and settings? This cannot be undone.')) return;
  if (!confirm('Are you really sure?')) return;
  const db = await openDB();
  const tx = db.transaction('apps', 'readwrite');
  tx.objectStore('apps').clear();
  tx.oncomplete = () => {
    localStorage.removeItem('appLauncherConfig');
    renderApps();
    alert('All data cleared');
  };
}
```

**Step 4: Add light theme CSS**

```css
[data-theme="light"] {
  --bg: #f5f5f5;
  --surface: #ffffff;
  --text: #1a1a2e;
  --accent: #e94560;
  --accent2: #a8d8ea;
}
```

**Step 5: Verify settings and backup**

1. Open Settings → change theme to Light → Save → UI switches
2. Set AIMEAT URL → verify it persists after page reload
3. Click Export → JSON file downloads
4. Clear all data → all apps gone
5. Import the exported JSON → apps restored

**Step 6: Commit**

```bash
git add aimeat/src/static/app-launcher.html
git commit -m "feat(launcher): add settings, export/import backup, theme switching"
```

---

## Task 10: Polish and Final Integration

**Files:**
- Modify: `aimeat/src/static/app-launcher.html`
- Modify: `aimeat/locales/en.json` (add launcher translations)
- Modify: `aimeat/locales/fi.json` (add launcher translations)

**Step 1: Add keyboard shortcuts**

```js
document.addEventListener('keydown', (e) => {
  // Ctrl+N / Cmd+N = New app
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    document.getElementById('add-btn').click();
  }
  // Ctrl+F / Cmd+F = Focus search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    document.getElementById('search-input').focus();
  }
  // Escape = Close modal or iframe
  if (e.key === 'Escape') {
    if (!document.getElementById('iframe-view').hidden) closeIframe();
    else closeModal();
  }
});
```

**Step 2: Add empty state**

When no apps exist, show a helpful message:

```js
// In renderApps(), after filtering:
if (filtered.length === 0 && allApps.length === 0) {
  grid.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">🚀</div>
      <h2>No apps yet</h2>
      <p>Add your first app using the + button above</p>
      <p>Supports: HTML files, URLs, ZIP packages, AIMEAT imports</p>
    </div>
  `;
  return;
}
```

**Step 3: Add loading states and error handling**

Wrap all async operations with try/catch and show user-friendly errors.

**Step 4: Add i18n entries to locales**

In `aimeat/locales/en.json`, add under a new `"launcher"` key:

```json
{
  "launcher": {
    "title": "My Apps",
    "addApp": "Add App",
    "settings": "Settings",
    "search": "Search apps...",
    "noApps": "No apps yet",
    "noAppsHint": "Add your first app using the + button above",
    "importAimeat": "Import from AIMEAT",
    "export": "Export Backup",
    "import": "Import Backup",
    "clearAll": "Clear All Data",
    "confirmDelete": "Delete this app?",
    "confirmClear": "Delete ALL apps and settings? This cannot be undone."
  }
}
```

In `aimeat/locales/fi.json`, add equivalent:

```json
{
  "launcher": {
    "title": "Omat Sovellukset",
    "addApp": "Lisää sovellus",
    "settings": "Asetukset",
    "search": "Hae sovelluksia...",
    "noApps": "Ei sovelluksia vielä",
    "noAppsHint": "Lisää ensimmäinen sovellus +-painikkeella",
    "importAimeat": "Tuo AIMEAT:sta",
    "export": "Vie varmuuskopio",
    "import": "Tuo varmuuskopio",
    "clearAll": "Tyhjennä kaikki",
    "confirmDelete": "Poista tämä sovellus?",
    "confirmClear": "Poista KAIKKI sovellukset ja asetukset? Tätä ei voi perua."
  }
}
```

**Step 5: Final verification**

1. Open `app-launcher.html` directly via `file://` → works standalone
2. Add apps via all 3 methods (URL, HTML file, ZIP)
3. Test tag filtering, search, favorites
4. Test tab and iframe launching
5. Test context menu (edit, delete, favorite, toggle mode)
6. Test settings (theme, AIMEAT URL)
7. Test export → clear all → import → apps restored
8. Test keyboard shortcuts (Ctrl+N, Ctrl+F, Escape)
9. Test on mobile viewport (responsive grid)
10. Run `npx tsc --noEmit` from aimeat/ to verify no TS compilation issues

**Step 6: Commit**

```bash
git add aimeat/src/static/app-launcher.html aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "feat(launcher): polish UI, keyboard shortcuts, i18n, empty state"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | HTML scaffold + IndexedDB | app-launcher.html (create) |
| 2 | Add App UI (URL + file) | app-launcher.html |
| 3 | Grid view with cards | app-launcher.html |
| 4 | Tag system | app-launcher.html |
| 5 | Tab + iframe launching | app-launcher.html |
| 6 | Context menu | app-launcher.html |
| 7 | ZIP inline bundler | app-launcher.html |
| 8 | AIMEAT integration | app-launcher.html + apps.ts |
| 9 | Settings + export/import | app-launcher.html |
| 10 | Polish + i18n | app-launcher.html + locales |

**Total: 10 tasks, ~10 commits, 1 new file + 3 modified files**
