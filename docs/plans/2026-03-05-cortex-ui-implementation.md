# Cortex-Core UI Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Extensions tab to profile.html and Active Extensions bar to app-catalog.html so users can manage and use Cortex extensions.

**Architecture:** Pure frontend changes — add HTML, CSS, and JavaScript to existing static files. No backend changes needed. Profile.html gets a new tab with card grid, detail view, and install modal. App-catalog.html gets an extensions bar with copy-to-clipboard functionality.

**Tech Stack:** Vanilla HTML/CSS/JS, existing `session.fetch()` auth pattern, `data-t` i18n attributes, glass-morphism design system.

**Design doc:** `docs/plans/2026-03-05-cortex-ui-integration-design.md`

---

## Task 1: Add i18n Translation Keys

**Files:**
- Modify: `aimeat/locales/en.json`
- Modify: `aimeat/locales/fi.json`

**Step 1: Add English translations**

Add after the `"apps"` section closes in the `"profile"` object (look for the closing brace of apps, add `"extensions"` as a sibling):

```json
"extensions": {
  "title": "Cortex Extensions",
  "desc": "Install and manage declarative extensions that provide schemas, prompts, ontologies, and UI libraries for your apps.",
  "loading": "Loading extensions...",
  "empty": "No extensions installed yet. Click '+ Install Extension' to add one.",
  "install": "+ Install Extension",
  "installModal": {
    "title": "Install Cortex Extension",
    "manifestLabel": "Manifest",
    "uploadFile": "Upload file",
    "pasteYaml": "Paste YAML",
    "libsLabel": "Library files (optional)",
    "uploadFiles": "Upload files",
    "pasteCode": "Paste code",
    "filenameLabel": "Filename",
    "filenamePlaceholder": "e.g. recipe-ui.js",
    "addLib": "+ Add another lib",
    "cancel": "Cancel",
    "installBtn": "Install",
    "installing": "Installing..."
  },
  "status": {
    "active": "Active",
    "inactive": "Inactive"
  },
  "activate": "Activate",
  "deactivate": "Deactivate",
  "uninstall": "Uninstall",
  "uninstallConfirm": "Are you sure? Seed data will be removed.",
  "detail": {
    "back": "← Back",
    "whatsIncluded": "What's included",
    "copyPrompt": "Copy prompt",
    "copyApi": "Copy API",
    "copyUrl": "Copy URL",
    "copied": "Copied!",
    "exports": "Exports",
    "apiSurface": "API Surface",
    "scriptTag": "Script tag"
  },
  "components": {
    "schema": "Schema",
    "prompt": "Prompt",
    "action": "Action",
    "board-template": "Board",
    "ontology": "Ontology",
    "seed-data": "Seed data",
    "lib": "Library"
  },
  "success": {
    "installed": "Extension installed successfully!",
    "activated": "Extension activated",
    "deactivated": "Extension deactivated",
    "uninstalled": "Extension uninstalled"
  },
  "error": {
    "installFailed": "Installation failed",
    "loadFailed": "Failed to load extensions"
  }
}
```

Also add the tab label. Find `"tabs"` section inside `"profile"` and add:
```json
"extensions": "Extensions"
```

**Step 2: Add Finnish translations**

Same structure in `fi.json`:

```json
"extensions": {
  "title": "Cortex-laajennukset",
  "desc": "Asenna ja hallinnoi deklaratiivisia laajennuksia, jotka tarjoavat skeemoja, prompteja, ontologioita ja UI-kirjastoja sovelluksillesi.",
  "loading": "Ladataan laajennuksia...",
  "empty": "Ei asennettuja laajennuksia. Klikkaa '+ Asenna laajennus' lisätäksesi.",
  "install": "+ Asenna laajennus",
  "installModal": {
    "title": "Asenna Cortex-laajennus",
    "manifestLabel": "Manifesti",
    "uploadFile": "Lataa tiedosto",
    "pasteYaml": "Liitä YAML",
    "libsLabel": "Kirjastotiedostot (valinnainen)",
    "uploadFiles": "Lataa tiedostot",
    "pasteCode": "Liitä koodi",
    "filenameLabel": "Tiedostonimi",
    "filenamePlaceholder": "esim. recipe-ui.js",
    "addLib": "+ Lisää kirjasto",
    "cancel": "Peruuta",
    "installBtn": "Asenna",
    "installing": "Asennetaan..."
  },
  "status": {
    "active": "Aktiivinen",
    "inactive": "Ei käytössä"
  },
  "activate": "Aktivoi",
  "deactivate": "Deaktivoi",
  "uninstall": "Poista",
  "uninstallConfirm": "Oletko varma? Esimerkkidata poistetaan.",
  "detail": {
    "back": "← Takaisin",
    "whatsIncluded": "Sisältö",
    "copyPrompt": "Kopioi prompt",
    "copyApi": "Kopioi API",
    "copyUrl": "Kopioi URL",
    "copied": "Kopioitu!",
    "exports": "Exportit",
    "apiSurface": "API-pinta",
    "scriptTag": "Script-tagi"
  },
  "components": {
    "schema": "Skeema",
    "prompt": "Prompt",
    "action": "Toiminto",
    "board-template": "Keskustelualue",
    "ontology": "Ontologia",
    "seed-data": "Esimerkkidata",
    "lib": "Kirjasto"
  },
  "success": {
    "installed": "Laajennus asennettu!",
    "activated": "Laajennus aktivoitu",
    "deactivated": "Laajennus deaktivoitu",
    "uninstalled": "Laajennus poistettu"
  },
  "error": {
    "installFailed": "Asennus epäonnistui",
    "loadFailed": "Laajennusten lataus epäonnistui"
  }
}
```

And add to tabs: `"extensions": "Laajennukset"`

**Step 3: Commit**

```bash
git add aimeat/locales/en.json aimeat/locales/fi.json
git commit -m "i18n: add Cortex extension translation keys (en + fi)"
```

---

## Task 2: Add Extensions Tab to profile.html — HTML Structure

**Files:**
- Modify: `aimeat/public/profile.html`

**Step 1: Add tab button**

Find the Data Wallet tab button line:
```html
<button class="tab" data-tab="dataWallet" data-t="profile.tabs.dataWallet">Data Wallet</button>
```

Add BEFORE it (so Extensions appears between Apps and Data Wallet, or wherever appropriate in the tab order):
```html
<button class="tab" data-tab="extensions" data-t="profile.tabs.extensions">Extensions</button>
```

**Step 2: Add tab panel HTML**

Find the closing of the last tab panel (Data Wallet) and add the Extensions panel before the main container closes. The panel contains three views: card grid (default), detail view (hidden), install modal overlay (hidden).

```html
<!-- EXTENSIONS -->
<div class="tab-panel" id="panel-extensions">
  <div class="section-title" data-t="profile.extensions.title">Cortex Extensions</div>
  <div class="section-desc" data-t="profile.extensions.desc">Install and manage declarative extensions.</div>

  <!-- Card Grid View -->
  <div id="ext-grid-view">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <div></div>
      <button class="btn-primary" onclick="showExtInstallModal()" data-t="profile.extensions.install">+ Install Extension</button>
    </div>
    <div id="ext-list" class="ext-grid">
      <div class="empty" data-t="profile.extensions.loading">Loading extensions...</div>
    </div>
  </div>

  <!-- Detail View (hidden by default) -->
  <div id="ext-detail-view" style="display:none">
    <button class="btn-outline" onclick="hideExtDetail()" data-t="profile.extensions.detail.back">← Back</button>
    <div id="ext-detail-content"></div>
  </div>

  <!-- Install Modal Overlay -->
  <div id="ext-install-overlay" style="display:none;position:fixed;inset:0;z-index:500;background:rgba(10,10,18,.7);backdrop-filter:blur(6px);display:none;align-items:center;justify-content:center;padding:24px">
    <div style="background:rgba(22,33,62,.92);backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:32px;max-width:600px;width:100%;max-height:80vh;overflow-y:auto">
      <h3 data-t="profile.extensions.installModal.title">Install Cortex Extension</h3>

      <!-- Manifest input -->
      <div class="form-row" style="margin-top:1rem">
        <label data-t="profile.extensions.installModal.manifestLabel">Manifest</label>
        <div style="display:flex;gap:1rem;margin-bottom:.5rem">
          <label><input type="radio" name="manifest-mode" value="upload" checked onchange="toggleManifestMode()"> <span data-t="profile.extensions.installModal.uploadFile">Upload file</span></label>
          <label><input type="radio" name="manifest-mode" value="paste" onchange="toggleManifestMode()"> <span data-t="profile.extensions.installModal.pasteYaml">Paste YAML</span></label>
        </div>
        <div id="manifest-upload-area">
          <input type="file" id="ext-manifest-file" accept=".yaml,.yml">
        </div>
        <div id="manifest-paste-area" style="display:none">
          <textarea id="ext-manifest-text" rows="12" style="width:100%;font-family:monospace;font-size:13px;background:rgba(0,0,0,.3);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;resize:vertical" placeholder="apiVersion: cortex.aimeat.org/v1&#10;kind: Extension&#10;metadata:&#10;  name: my-extension&#10;  namespace: myname&#10;..."></textarea>
        </div>
      </div>

      <!-- Lib input -->
      <div class="form-row" style="margin-top:1rem">
        <label data-t="profile.extensions.installModal.libsLabel">Library files (optional)</label>
        <div style="display:flex;gap:1rem;margin-bottom:.5rem">
          <label><input type="radio" name="lib-mode" value="upload" checked onchange="toggleLibMode()"> <span data-t="profile.extensions.installModal.uploadFiles">Upload files</span></label>
          <label><input type="radio" name="lib-mode" value="paste" onchange="toggleLibMode()"> <span data-t="profile.extensions.installModal.pasteCode">Paste code</span></label>
        </div>
        <div id="lib-upload-area">
          <input type="file" id="ext-lib-files" accept=".js" multiple>
        </div>
        <div id="lib-paste-area" style="display:none">
          <div id="lib-paste-entries">
            <div class="lib-paste-entry" style="margin-bottom:1rem;padding:1rem;background:rgba(0,0,0,.2);border-radius:8px">
              <input type="text" class="lib-filename" placeholder="recipe-ui.js" style="width:100%;margin-bottom:.5rem;background:rgba(0,0,0,.3);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px">
              <textarea class="lib-code" rows="8" style="width:100%;font-family:monospace;font-size:13px;background:rgba(0,0,0,.3);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;resize:vertical" placeholder="(function(AIMEAT) { ... })(...);"></textarea>
            </div>
          </div>
          <button class="btn-outline" onclick="addLibPasteEntry()" data-t="profile.extensions.installModal.addLib" style="font-size:.85rem">+ Add another lib</button>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:1rem;margin-top:1.5rem">
        <button class="btn-outline" onclick="hideExtInstallModal()" data-t="profile.extensions.installModal.cancel">Cancel</button>
        <button class="btn-primary" id="ext-install-btn" onclick="installExtension()" data-t="profile.extensions.installModal.installBtn">Install</button>
      </div>
    </div>
  </div>
</div>
```

**Step 3: Commit**

```bash
git add aimeat/public/profile.html
git commit -m "feat(ui): add Extensions tab HTML structure to profile.html"
```

---

## Task 3: Add Extensions CSS to profile.html

**Files:**
- Modify: `aimeat/public/profile.html` (inside `<style>` tag)

**Step 1: Add CSS styles**

Find the existing CSS section (inside `<style>` tag) and add extension-specific styles:

```css
/* ── Extensions Tab ── */
.ext-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
.ext-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:1.25rem;cursor:pointer;transition:all .2s}
.ext-card:hover{background:rgba(255,255,255,0.09);border-color:rgba(255,255,255,0.18);transform:translateY(-2px)}
.ext-card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.5rem}
.ext-card-name{font-weight:600;font-size:.95rem;color:var(--text)}
.ext-card-version{font-size:.75rem;color:var(--muted);background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:6px}
.ext-card-desc{font-size:.85rem;color:var(--muted);margin-bottom:.75rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ext-card-tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:.75rem}
.ext-comp-tag{font-size:.7rem;padding:2px 8px;border-radius:6px;background:rgba(255,255,255,0.08);color:var(--muted)}
.ext-comp-tag[data-comp="schema"]{color:#60a5fa}
.ext-comp-tag[data-comp="prompt"]{color:#a78bfa}
.ext-comp-tag[data-comp="action"]{color:#f59e0b}
.ext-comp-tag[data-comp="board-template"]{color:#34d399}
.ext-comp-tag[data-comp="ontology"]{color:#f472b6}
.ext-comp-tag[data-comp="seed-data"]{color:#6ee7b7}
.ext-comp-tag[data-comp="lib"]{color:#38bdf8}
.ext-card-footer{display:flex;justify-content:space-between;align-items:center}
.ext-status{font-size:.8rem;display:flex;align-items:center;gap:6px}
.ext-status-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.ext-status-dot.active{background:#4ade80}
.ext-status-dot.inactive{background:#9ca3af}
.ext-card-actions{display:flex;gap:.5rem}
.ext-card-actions button{font-size:.75rem;padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:var(--muted);cursor:pointer;transition:all .15s}
.ext-card-actions button:hover{background:rgba(255,255,255,0.1);color:var(--text)}
.ext-card-actions button.danger{border-color:rgba(239,68,68,0.3);color:#f87171}
.ext-card-actions button.danger:hover{background:rgba(239,68,68,0.15)}

/* Detail view */
.ext-detail-header{margin:1.5rem 0}
.ext-detail-title{font-size:1.3rem;font-weight:700;margin-bottom:.5rem}
.ext-detail-description{font-size:.95rem;color:var(--muted);line-height:1.6;margin-bottom:1rem}
.ext-detail-meta{display:flex;gap:1.5rem;font-size:.85rem;color:var(--muted);margin-bottom:1.5rem;flex-wrap:wrap}
.ext-detail-section{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:1rem;margin-bottom:1rem}
.ext-detail-section-title{font-weight:600;font-size:.85rem;margin-bottom:.75rem;display:flex;align-items:center;gap:8px}
.ext-detail-code{font-family:monospace;font-size:.8rem;background:rgba(0,0,0,.3);padding:10px;border-radius:6px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;color:var(--text);margin-top:.5rem}
.ext-copy-btn{font-size:.7rem;padding:3px 10px;border-radius:5px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:var(--muted);cursor:pointer;float:right}
.ext-copy-btn:hover{background:rgba(255,255,255,0.1);color:var(--text)}
```

**Step 2: Commit**

```bash
git add aimeat/public/profile.html
git commit -m "feat(ui): add Extensions tab CSS styles"
```

---

## Task 4: Add Extensions JavaScript to profile.html

**Files:**
- Modify: `aimeat/public/profile.html` (inside `<script>` tag, at end)

**Step 1: Add JavaScript functions**

Add these functions to the JavaScript section of profile.html. Read the existing code first to see where other tab-loading functions are defined (e.g., `loadApps`, `loadAgents`), and add the extension functions in the same area. Also ensure `loadExtensions()` is called when the Extensions tab is activated — find the tab-switching handler and add a case for `extensions`.

```javascript
// ── Extensions Tab ──────────────────────────────────

var extData = [];  // cached extension list

async function loadExtensions() {
  var el = document.getElementById('ext-list');
  el.innerHTML = '<div class="empty">' + t('profile.extensions.loading') + '</div>';
  try {
    var resp = await session.fetch('/v1/cortex');
    var data = await resp.json();
    extData = data && data.data && data.data.extensions ? data.data.extensions : [];
    renderExtGrid();
  } catch(e) {
    el.innerHTML = '<div class="empty">' + t('profile.extensions.error.loadFailed') + '</div>';
  }
}

function renderExtGrid() {
  var el = document.getElementById('ext-list');
  if (!extData.length) {
    el.innerHTML = '<div class="empty">' + t('profile.extensions.empty') + '</div>';
    return;
  }
  el.innerHTML = extData.map(function(ext) {
    var types = (ext.component_types || []).map(function(ct) {
      return '<span class="ext-comp-tag" data-comp="' + ct + '">' + t('profile.extensions.components.' + ct) + '</span>';
    }).join('');
    var isActive = ext.status === 'active';
    var statusDot = '<span class="ext-status-dot ' + ext.status + '"></span>';
    var statusText = t('profile.extensions.status.' + ext.status);
    var toggleBtn = isActive
      ? '<button onclick="event.stopPropagation();deactivateExt(\'' + ext.name + '\')">' + t('profile.extensions.deactivate') + '</button>'
      : '<button onclick="event.stopPropagation();activateExt(\'' + ext.name + '\')">' + t('profile.extensions.activate') + '</button>';
    var deleteBtn = '<button class="danger" onclick="event.stopPropagation();uninstallExt(\'' + ext.name + '\')">' + t('profile.extensions.uninstall') + '</button>';
    return '<div class="ext-card" onclick="showExtDetail(\'' + ext.name + '\')">'
      + '<div class="ext-card-header"><span class="ext-card-name">' + escHtml(ext.name) + '</span><span class="ext-card-version">v' + escHtml(ext.version || '?') + '</span></div>'
      + '<div class="ext-card-desc">' + escHtml(ext.description || '') + '</div>'
      + '<div class="ext-card-tags">' + types + '</div>'
      + '<div class="ext-card-footer"><span class="ext-status">' + statusDot + ' ' + statusText + '</span>'
      + '<span class="ext-card-actions">' + toggleBtn + deleteBtn + '</span></div>'
      + '</div>';
  }).join('');
}

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function showExtDetail(name) {
  document.getElementById('ext-grid-view').style.display = 'none';
  document.getElementById('ext-detail-view').style.display = 'block';
  var el = document.getElementById('ext-detail-content');
  el.innerHTML = '<div class="empty">' + t('profile.extensions.loading') + '</div>';

  try {
    var resp = await session.fetch('/v1/cortex/' + encodeURIComponent(name));
    var data = await resp.json();
    var ext = data.data;

    var comps = ext.components || [];
    var compList = comps.map(function(c) {
      var icon = {schema:'📐',prompt:'💬',action:'⚡','board-template':'📌',ontology:'🧬','seed-data':'🌱',lib:'📦'}[c.type] || '📄';
      var label = t('profile.extensions.components.' + c.type);
      var detail = c.type === 'schema' ? c.key_pattern : (c.name || '');
      return '<div>' + icon + ' ' + label + ': ' + escHtml(detail) + '</div>';
    }).join('');

    var sections = '';

    // Prompts
    var prompts = comps.filter(function(c) { return c.type === 'prompt'; });
    for (var i = 0; i < prompts.length; i++) {
      try {
        var pr = await session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/prompts/' + encodeURIComponent(prompts[i].name));
        var pd = await pr.json();
        var content = pd.data && pd.data.content ? pd.data.content : prompts[i].content || '';
        sections += '<div class="ext-detail-section">'
          + '<div class="ext-detail-section-title">💬 Prompt: ' + escHtml(prompts[i].name)
          + ' <button class="ext-copy-btn" onclick="copyText(this,\'' + escAttr(content) + '\')">' + t('profile.extensions.detail.copyPrompt') + '</button></div>'
          + '<div class="ext-detail-code">' + escHtml(content.substring(0, 500)) + (content.length > 500 ? '...' : '') + '</div>'
          + '</div>';
      } catch(e) {
        sections += '<div class="ext-detail-section"><div class="ext-detail-section-title">💬 Prompt: ' + escHtml(prompts[i].name) + '</div></div>';
      }
    }

    // Libs
    var libs = comps.filter(function(c) { return c.type === 'lib'; });
    for (var j = 0; j < libs.length; j++) {
      var scriptUrl = NODE_URL + '/v1/cortex/' + encodeURIComponent(name) + '/libs/' + encodeURIComponent(libs[j].filename);
      var scriptTag = '<script src="' + scriptUrl + '"><\/script>';
      sections += '<div class="ext-detail-section">'
        + '<div class="ext-detail-section-title">📦 Library: ' + escHtml(libs[j].filename) + '</div>'
        + '<div style="margin-bottom:.5rem;font-size:.85rem;color:var(--muted)">' + t('profile.extensions.detail.exports') + ': ' + escHtml((libs[j].exports || []).join(', ')) + '</div>'
        + '<div style="font-size:.85rem;font-weight:600;margin-bottom:4px">' + t('profile.extensions.detail.scriptTag') + ' <button class="ext-copy-btn" onclick="copyToClipboard(\'' + escAttr(scriptTag) + '\',this)">' + t('profile.extensions.detail.copyUrl') + '</button></div>'
        + '<div class="ext-detail-code">' + escHtml(scriptTag) + '</div>';
      if (libs[j].api_surface) {
        sections += '<div style="font-size:.85rem;font-weight:600;margin-top:.75rem;margin-bottom:4px">' + t('profile.extensions.detail.apiSurface') + ' <button class="ext-copy-btn" onclick="copyToClipboard(\'' + escAttr(libs[j].api_surface) + '\',this)">' + t('profile.extensions.detail.copyApi') + '</button></div>'
          + '<div class="ext-detail-code">' + escHtml(libs[j].api_surface) + '</div>';
      }
      sections += '</div>';
    }

    // Schemas
    var schemas = comps.filter(function(c) { return c.type === 'schema'; });
    if (schemas.length) {
      sections += '<div class="ext-detail-section"><div class="ext-detail-section-title">📐 Schemas</div>';
      schemas.forEach(function(s) {
        sections += '<div style="font-size:.85rem;color:var(--muted);margin-bottom:.25rem">' + escHtml(s.key_pattern) + ' (' + escHtml(s.apply_to) + ')</div>';
      });
      sections += '</div>';
    }

    // Ontology
    try {
      var ontResp = await session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/ontology');
      var ontData = await ontResp.json();
      if (ontData.data && ontData.data.ontologies && ontData.data.ontologies.length) {
        ontData.data.ontologies.forEach(function(ont) {
          var concepts = Object.keys(ont.concepts || {}).map(function(k) {
            var c = ont.concepts[k];
            return escHtml(k) + ' (' + escHtml(c.label && c.label.en ? c.label.en : k) + ')';
          }).join(', ');
          sections += '<div class="ext-detail-section"><div class="ext-detail-section-title">🧬 Ontology: ' + escHtml(ont.name) + '</div>'
            + '<div style="font-size:.85rem;color:var(--muted)">' + concepts + '</div></div>';
        });
      }
    } catch(e) { /* no ontology */ }

    var isActive = ext.status === 'active';
    var toggleBtn = isActive
      ? '<button class="btn-outline" onclick="deactivateExt(\'' + escAttr(ext.name) + '\')">' + t('profile.extensions.deactivate') + '</button>'
      : '<button class="btn-primary" onclick="activateExt(\'' + escAttr(ext.name) + '\')">' + t('profile.extensions.activate') + '</button>';

    el.innerHTML = '<div class="ext-detail-header">'
      + '<div class="ext-detail-title">📦 ' + escHtml(ext.name) + ' <span style="font-size:.8rem;font-weight:400;color:var(--muted)">v' + escHtml(ext.version) + '</span></div>'
      + '<div class="ext-detail-description">' + escHtml(ext.description || '') + '</div>'
      + '<div class="ext-detail-meta">'
      + '<span>Author: ' + escHtml(ext.author || '?') + '</span>'
      + (ext.license ? '<span>License: ' + escHtml(ext.license) + '</span>' : '')
      + '<span><span class="ext-status-dot ' + ext.status + '"></span> ' + t('profile.extensions.status.' + ext.status) + '</span>'
      + '<span>Tags: ' + escHtml((ext.tags || []).join(', ')) + '</span>'
      + '</div>'
      + '</div>'
      + '<div class="ext-detail-section"><div class="ext-detail-section-title">' + t('profile.extensions.detail.whatsIncluded') + '</div>' + compList + '</div>'
      + sections
      + '<div style="display:flex;gap:1rem;margin-top:1.5rem">'
      + toggleBtn
      + '<button class="btn-outline danger" onclick="uninstallExt(\'' + escAttr(ext.name) + '\')" style="border-color:rgba(239,68,68,0.3);color:#f87171">' + t('profile.extensions.uninstall') + '</button>'
      + '</div>';

  } catch(e) {
    el.innerHTML = '<div class="empty">Error: ' + escHtml(e.message) + '</div>';
  }
}

function escAttr(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n'); }

function hideExtDetail() {
  document.getElementById('ext-detail-view').style.display = 'none';
  document.getElementById('ext-grid-view').style.display = 'block';
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text.replace(/\\n/g, '\n')).then(function() {
    var orig = btn.textContent;
    btn.textContent = t('profile.extensions.detail.copied');
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}

// ── Install Modal ──

function showExtInstallModal() {
  var ov = document.getElementById('ext-install-overlay');
  ov.style.display = 'flex';
}

function hideExtInstallModal() {
  document.getElementById('ext-install-overlay').style.display = 'none';
}

function toggleManifestMode() {
  var mode = document.querySelector('input[name="manifest-mode"]:checked').value;
  document.getElementById('manifest-upload-area').style.display = mode === 'upload' ? 'block' : 'none';
  document.getElementById('manifest-paste-area').style.display = mode === 'paste' ? 'block' : 'none';
}

function toggleLibMode() {
  var mode = document.querySelector('input[name="lib-mode"]:checked').value;
  document.getElementById('lib-upload-area').style.display = mode === 'upload' ? 'block' : 'none';
  document.getElementById('lib-paste-area').style.display = mode === 'paste' ? 'block' : 'none';
}

function addLibPasteEntry() {
  var container = document.getElementById('lib-paste-entries');
  var entry = document.createElement('div');
  entry.className = 'lib-paste-entry';
  entry.style.cssText = 'margin-bottom:1rem;padding:1rem;background:rgba(0,0,0,.2);border-radius:8px';
  entry.innerHTML = '<input type="text" class="lib-filename" placeholder="my-lib.js" style="width:100%;margin-bottom:.5rem;background:rgba(0,0,0,.3);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px">'
    + '<textarea class="lib-code" rows="8" style="width:100%;font-family:monospace;font-size:13px;background:rgba(0,0,0,.3);color:var(--text);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px;resize:vertical" placeholder="(function(AIMEAT) { ... })(...);"></textarea>';
  container.appendChild(entry);
}

async function installExtension() {
  var btn = document.getElementById('ext-install-btn');
  btn.disabled = true;
  btn.textContent = t('profile.extensions.installModal.installing');

  try {
    // Read manifest
    var manifestMode = document.querySelector('input[name="manifest-mode"]:checked').value;
    var manifest = '';
    if (manifestMode === 'upload') {
      var file = document.getElementById('ext-manifest-file').files[0];
      if (!file) throw new Error('No manifest file selected');
      manifest = await file.text();
    } else {
      manifest = document.getElementById('ext-manifest-text').value;
      if (!manifest.trim()) throw new Error('Manifest is empty');
    }

    // Read libs
    var libs = {};
    var libMode = document.querySelector('input[name="lib-mode"]:checked').value;
    if (libMode === 'upload') {
      var libFiles = document.getElementById('ext-lib-files').files;
      for (var i = 0; i < libFiles.length; i++) {
        var content = await libFiles[i].text();
        libs[libFiles[i].name] = btoa(unescape(encodeURIComponent(content)));
      }
    } else {
      var entries = document.querySelectorAll('.lib-paste-entry');
      entries.forEach(function(entry) {
        var filename = entry.querySelector('.lib-filename').value.trim();
        var code = entry.querySelector('.lib-code').value;
        if (filename && code) {
          libs[filename] = btoa(unescape(encodeURIComponent(code)));
        }
      });
    }

    var body = { manifest: manifest };
    if (Object.keys(libs).length > 0) body.libs = libs;

    var resp = await session.fetch('/v1/cortex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var data = await resp.json();
    if (!resp.ok) throw new Error(data.error ? data.error.message : 'Install failed');

    hideExtInstallModal();
    showToast(t('profile.extensions.success.installed'));
    loadExtensions();

  } catch(e) {
    alert(t('profile.extensions.error.installFailed') + ': ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('profile.extensions.installModal.installBtn');
  }
}

// ── Lifecycle actions ──

async function activateExt(name) {
  try {
    var resp = await session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/activate', { method: 'POST' });
    if (!resp.ok) { var d = await resp.json(); throw new Error(d.error ? d.error.message : 'Activate failed'); }
    showToast(t('profile.extensions.success.activated'));
    loadExtensions();
    hideExtDetail();
  } catch(e) { alert(e.message); }
}

async function deactivateExt(name) {
  try {
    var resp = await session.fetch('/v1/cortex/' + encodeURIComponent(name) + '/deactivate', { method: 'POST' });
    if (!resp.ok) { var d = await resp.json(); throw new Error(d.error ? d.error.message : 'Deactivate failed'); }
    showToast(t('profile.extensions.success.deactivated'));
    loadExtensions();
    hideExtDetail();
  } catch(e) { alert(e.message); }
}

async function uninstallExt(name) {
  if (!confirm(t('profile.extensions.uninstallConfirm'))) return;
  try {
    var resp = await session.fetch('/v1/cortex/' + encodeURIComponent(name), { method: 'DELETE' });
    if (!resp.ok) { var d = await resp.json(); throw new Error(d.error ? d.error.message : 'Uninstall failed'); }
    showToast(t('profile.extensions.success.uninstalled'));
    loadExtensions();
    hideExtDetail();
  } catch(e) { alert(e.message); }
}
```

**Step 2: Add tab switch handler**

Find the tab switching JavaScript (the `document.querySelectorAll('.tab').forEach` handler) and add extension loading. Look for where other tabs trigger data loading (e.g., `if (tab === 'apps') loadApps()`) and add:

```javascript
if (tab === 'extensions') loadExtensions();
```

**Step 3: Verify manually**

Start the dev server and navigate to the profile page. The Extensions tab should:
- Show empty state message
- Open install modal when clicking "+ Install Extension"
- Accept YAML paste and file upload

**Step 4: Commit**

```bash
git add aimeat/public/profile.html
git commit -m "feat(ui): add Extensions tab JavaScript — install, activate, detail view"
```

---

## Task 5: Add Active Extensions Bar to app-catalog.html

**Files:**
- Modify: `aimeat/src/static/app-catalog.html`

**Step 1: Add HTML for extensions bar**

Find the area above the app grid (after the header/search bar, before the app cards container). Add:

```html
<!-- Active Extensions Bar -->
<div id="cortex-bar" style="display:none;margin-bottom:1.5rem">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
    <h3 style="margin:0;font-size:.95rem;color:var(--text-secondary,#aab)">🔌 Active Extensions</h3>
    <button onclick="document.getElementById('cortex-bar-grid').style.display=document.getElementById('cortex-bar-grid').style.display==='none'?'flex':'none'" style="background:none;border:none;color:var(--text-secondary,#aab);cursor:pointer;font-size:.8rem">▼ toggle</button>
  </div>
  <div id="cortex-bar-grid" style="display:flex;gap:.75rem;overflow-x:auto;padding-bottom:.5rem"></div>
</div>

<!-- Extension Popup Overlay -->
<div id="cortex-popup-overlay" hidden>
  <div class="modal" id="cortex-popup-modal" style="max-width:500px">
    <div id="cortex-popup-content"></div>
    <div class="modal-actions" style="margin-top:1rem">
      <button onclick="document.getElementById('cortex-popup-overlay').hidden=true">Close</button>
    </div>
  </div>
</div>
```

**Step 2: Add CSS for extension cards in the bar**

Add to the `<style>` section:

```css
.cortex-mini-card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:.75rem 1rem;cursor:pointer;min-width:160px;flex-shrink:0;transition:all .15s}
.cortex-mini-card:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.18)}
.cortex-mini-name{font-weight:600;font-size:.85rem;margin-bottom:.25rem;white-space:nowrap}
.cortex-mini-meta{font-size:.7rem;color:var(--text-secondary,#889)}
```

**Step 3: Add JavaScript to fetch and render extensions**

Add to the JavaScript section:

```javascript
// ── Cortex Extensions Bar ──

function loadCortexExtensions() {
  var config = loadConfig();
  if (!config.aimeatUrl) return;
  var url = config.aimeatUrl.replace(/\/+$/, '');

  // Get anonymous token first (same pattern as AIMEAT import)
  fetch(url + '/v1/auth/anonymous', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(authData) {
      var token = authData.data && authData.data.token;
      if (!token) return;
      return fetch(url + '/v1/cortex?status=active', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
    })
    .then(function(r) { return r ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.data || !data.data.extensions) return;
      var exts = data.data.extensions;
      if (!exts.length) return;

      document.getElementById('cortex-bar').style.display = 'block';
      var grid = document.getElementById('cortex-bar-grid');
      grid.innerHTML = exts.map(function(ext) {
        var types = ext.component_types || [];
        var libCount = types.filter(function(t) { return t === 'lib'; }).length;
        var schemaCount = types.filter(function(t) { return t === 'schema'; }).length;
        return '<div class="cortex-mini-card" onclick="showCortexPopup(\'' + encodeURIComponent(ext.name) + '\')">'
          + '<div class="cortex-mini-name">📦 ' + (ext.short_name || ext.name) + '</div>'
          + '<div class="cortex-mini-meta">' + libCount + ' lib · ' + schemaCount + ' schema</div>'
          + '</div>';
      }).join('');
    })
    .catch(function(e) { console.warn('Cortex bar load failed:', e); });
}

function showCortexPopup(encodedName) {
  var config = loadConfig();
  var url = config.aimeatUrl.replace(/\/+$/, '');
  var name = decodeURIComponent(encodedName);
  var el = document.getElementById('cortex-popup-content');
  el.innerHTML = '<p>Loading...</p>';
  document.getElementById('cortex-popup-overlay').hidden = false;

  fetch(url + '/v1/auth/anonymous', { method: 'POST' })
    .then(function(r) { return r.json(); })
    .then(function(authData) {
      var token = authData.data && authData.data.token;
      return fetch(url + '/v1/cortex/' + encodedName, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var ext = data.data;
      var comps = ext.components || [];
      var html = '<h2 style="margin-top:0">' + esc(ext.name) + '</h2>';
      html += '<p style="color:var(--text-secondary,#889)">' + esc(ext.description || '') + '</p>';
      html += '<h3 style="font-size:.9rem">Available for your apps:</h3>';

      // Libs
      comps.filter(function(c) { return c.type === 'lib'; }).forEach(function(lib) {
        var scriptUrl = url + '/v1/cortex/' + encodedName + '/libs/' + encodeURIComponent(lib.filename);
        var tag = '<script src="' + scriptUrl + '"><\/script>';
        html += '<div style="margin-bottom:1rem">'
          + '<div style="font-weight:600;font-size:.85rem">📦 Lib: ' + esc(lib.filename) + '</div>'
          + '<div style="font-family:monospace;font-size:.75rem;background:rgba(0,0,0,.3);padding:8px;border-radius:6px;margin-top:4px;word-break:break-all">' + esc(tag) + '</div>'
          + '<button onclick="navigator.clipboard.writeText(\'' + tag.replace(/'/g, "\\'") + '\');this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'Copy\';}.bind(this),1500)" style="font-size:.7rem;margin-top:4px;padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#aab;cursor:pointer">Copy</button>';
        if (lib.api_surface) {
          html += '<div style="font-size:.8rem;font-weight:600;margin-top:8px">API Surface:</div>'
            + '<div style="font-family:monospace;font-size:.75rem;background:rgba(0,0,0,.3);padding:8px;border-radius:6px;margin-top:4px;white-space:pre-wrap">' + esc(lib.api_surface) + '</div>'
            + '<button onclick="navigator.clipboard.writeText(\'' + (lib.api_surface || '').replace(/'/g, "\\'").replace(/\n/g, '\\n') + '\');this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'Copy API\';}.bind(this),1500)" style="font-size:.7rem;margin-top:4px;padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#aab;cursor:pointer">Copy API</button>';
        }
        html += '</div>';
      });

      // Schemas
      comps.filter(function(c) { return c.type === 'schema'; }).forEach(function(s) {
        html += '<div style="margin-bottom:.5rem;font-size:.85rem">📐 Schema: <code>' + esc(s.key_pattern) + '</code> — data validated automatically</div>';
      });

      // Prompts
      comps.filter(function(c) { return c.type === 'prompt'; }).forEach(function(p) {
        var preview = (p.content || '').substring(0, 150);
        html += '<div style="margin-bottom:.5rem">'
          + '<div style="font-size:.85rem">💬 Prompt: ' + esc(p.name) + '</div>'
          + '<div style="font-size:.75rem;color:var(--text-secondary,#889)">"' + esc(preview) + '..."</div>'
          + '<button onclick="navigator.clipboard.writeText(\'' + (p.content || '').replace(/'/g, "\\'").replace(/\n/g, '\\n') + '\');this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'Copy Prompt\';}.bind(this),1500)" style="font-size:.7rem;margin-top:2px;padding:2px 8px;border-radius:4px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#aab;cursor:pointer">Copy Prompt</button>'
          + '</div>';
      });

      el.innerHTML = html;
    })
    .catch(function(e) {
      el.innerHTML = '<p>Error: ' + esc(e.message) + '</p>';
    });
}

function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
```

**Step 4: Call `loadCortexExtensions()` on page load**

Find where the app catalog initializes (the DOMContentLoaded handler or equivalent). Add:

```javascript
loadCortexExtensions();
```

**Step 5: Commit**

```bash
git add aimeat/src/static/app-catalog.html
git commit -m "feat(ui): add Active Extensions bar to app-catalog"
```

---

## Task 6: Manual Testing & Polish

**Step 1: Start dev server**

```bash
cd aimeat && pnpm dev
```

**Step 2: Test profile.html Extensions tab**

1. Navigate to profile page, log in
2. Click Extensions tab — should show empty state
3. Click "+ Install Extension"
4. Paste the recipe-collection.yaml fixture content
5. Switch to "Paste code" for libs, enter filename `recipe-ui.js` and paste the fixture JS
6. Click Install — should succeed
7. Card should appear with "Inactive" status
8. Click "Activate" — should turn green "Active"
9. Click the card — detail view should show description, prompts, libs, schemas, ontology
10. Test "Copy" buttons work
11. Click "Deactivate" — should work
12. Click "Uninstall" — should confirm and remove

**Step 3: Test app-catalog.html**

1. Navigate to app-catalog
2. Ensure AIMEAT server URL is configured in settings
3. Active Extensions bar should appear if any extensions are active
4. Click an extension card — popup should show lib URLs, API surface, schemas
5. Test "Copy" buttons work

**Step 4: Fix any issues found**

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix(ui): polish Extensions tab and app-catalog integration"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | i18n translation keys (en + fi) | locales/en.json, fi.json |
| 2 | Extensions tab HTML structure | public/profile.html |
| 3 | Extensions tab CSS | public/profile.html |
| 4 | Extensions tab JavaScript | public/profile.html |
| 5 | App-catalog extensions bar | src/static/app-catalog.html |
| 6 | Manual testing & polish | Various |

**Total: 6 tasks**
