/**
 * @file cortex.js
 * @description The Cortex surface — the collapsible Active-Extensions bar (loadCortexExtensions /
 *   showCortexPopup / cortexCopy), the Cortex Extension editor (openCortexEditor + lib sections /
 *   save / export), and the Prompt Builder panel (openPromptBuilder / loadPbTemplates /
 *   buildPromptFromBuilder / updatePbPreview). Self-contained: reads config + owner via the shared
 *   modules, holds its own module state, has no back-dependency on the entry module. Carved from main.js.
 * @usage import { loadCortexExtensions, openCortexEditor, openPromptBuilder, getCortexOwnerToken } from './cortex.js'
 * @version-history
 *   v1.0.0 — 2026-07-10 — Initial extraction (TARGET-021 Aalto 3 modularization, phase 8).
 */
import { jsArg, currentOwnerName } from './util.js';
import { showNotice } from './ui.js';
import { loadConfig } from './config.js';
import { t, getLang } from './i18n.js';

// ── Cortex Extensions Bar ─────────────────────────

var cortexToken = null;

function cortexEsc(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Escape extension content for a single-quoted JS arg inside a double-quoted onclick, the same
// as jsArg but preserving newlines as a literal \n (cortexCopy restores them). Escaping '&'
// FIRST is the security-critical bit: without it a payload like &#39; survives into the
// attribute, the HTML parser decodes it to ' and breaks out of the JS string (entity smuggling).
function cortexArg(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '\\n');
}

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
      cortexToken = token;
      // visibility=public: the strip loads via an anonymous token and is a shared showcase.
      // Without this filter the list returns private extensions too, leaking their name/
      // description/lib refs to anyone (the libs are then fetchable). Public-only is correct here.
      return fetch(url + '/v1/cortex?status=active&visibility=public', {
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
          + '<div class="cortex-mini-name">&#x1F4E6; ' + cortexEsc(ext.short_name || ext.name) + '</div>'
          + '<div class="cortex-mini-meta">' + libCount + ' lib &middot; ' + schemaCount + ' schema</div>'
          + '</div>';
      }).join('');
    })
    .catch(function(e) { console.warn('Cortex bar load failed:', e); });
}

function showCortexPopup(encodedName) {
  var config = loadConfig();
  var url = config.aimeatUrl.replace(/\/+$/, '');
  var el = document.getElementById('cortex-popup-content');
  el.innerHTML = '<p>Loading...</p>';
  document.getElementById('cortex-popup-overlay').style.display = 'flex';

  if (!cortexToken) { el.innerHTML = '<p>No auth token available</p>'; return; }

  fetch(url + '/v1/cortex/' + encodedName, {
    headers: { 'Authorization': 'Bearer ' + cortexToken }
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var ext = data.data;
      var comps = ext.components || [];
      var html = '<h2 style="margin-top:0">' + cortexEsc(ext.name) + '</h2>';
      html += '<p style="color:var(--text-muted)">' + cortexEsc(ext.description || '') + '</p>';
      html += '<h3 style="font-size:.9rem">Available for your apps:</h3>';

      // Libs
      comps.filter(function(c) { return c.type === 'lib'; }).forEach(function(lib) {
        var scriptUrl = url + '/v1/cortex/' + encodedName + '/libs/' + encodeURIComponent(lib.filename);
        var tag = '<script src="' + scriptUrl + '"><\/script>';
        html += '<div style="margin-bottom:1rem">'
          + '<div style="font-weight:600;font-size:.85rem">&#x1F4E6; Lib: ' + cortexEsc(lib.filename) + '</div>'
          + '<div style="font-family:monospace;font-size:.75rem;background:var(--hover);padding:8px;border-radius:6px;margin-top:4px;word-break:break-all">' + cortexEsc(tag) + '</div>'
          + '<button onclick="cortexCopy(\'' + cortexArg(tag) + '\',this)" style="font-size:.7rem;margin-top:4px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--text-muted);cursor:pointer">Copy</button>';
        if (lib.api_surface) {
          html += '<div style="font-size:.8rem;font-weight:600;margin-top:8px">API Surface:</div>'
            + '<div style="font-family:monospace;font-size:.75rem;background:var(--hover);padding:8px;border-radius:6px;margin-top:4px;white-space:pre-wrap">' + cortexEsc(lib.api_surface) + '</div>'
            + '<button onclick="cortexCopy(\'' + cortexArg(lib.api_surface) + '\',this)" style="font-size:.7rem;margin-top:4px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--text-muted);cursor:pointer">Copy API</button>';
        }
        html += '</div>';
      });

      // Schemas
      comps.filter(function(c) { return c.type === 'schema'; }).forEach(function(s) {
        html += '<div style="margin-bottom:.5rem;font-size:.85rem">&#x1F4D0; Schema: <code>' + cortexEsc(s.key_pattern) + '</code> &mdash; data validated automatically</div>';
      });

      // Prompts
      comps.filter(function(c) { return c.type === 'prompt'; }).forEach(function(p) {
        var preview = (p.content || '').substring(0, 150);
        html += '<div style="margin-bottom:.5rem">'
          + '<div style="font-size:.85rem">&#x1F4AC; Prompt: ' + cortexEsc(p.name) + '</div>'
          + '<div style="font-size:.75rem;color:var(--text-muted)">&ldquo;' + cortexEsc(preview) + '...&rdquo;</div>'
          + '<button onclick="cortexCopy(\'' + cortexArg(p.content) + '\',this)" style="font-size:.7rem;margin-top:2px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--text-muted);cursor:pointer">Copy Prompt</button>'
          + '</div>';
      });

      // Edit button — only for the OWNER of this extension. The backend export/DELETE/PUT
      // routes enforce ownership too; this just hides a button that would 403 for everyone else.
      var isOwner = false;
      try { var _me = currentOwnerName(); isOwner = !!_me && ext.installed_by === _me; } catch(e) {}
      if (isOwner) {
        html += '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border-subtle)">'
          + '<button onclick="window._launcher.openCortexEditor(\'' + encodedName + '\')" style="padding:6px 16px;border-radius:8px;border:1px solid var(--accent,#34d399);background:transparent;color:var(--accent,#34d399);cursor:pointer;font-size:.85rem">&#x1F6E0;&#xFE0F; Edit Extension</button>'
          + '</div>';
      }

      el.innerHTML = html;
    })
    .catch(function(e) {
      el.innerHTML = '<p>Error: ' + cortexEsc(e.message) + '</p>';
    });
}

function cortexCopy(text, btn) {
  navigator.clipboard.writeText(text.replace(/\\n/g, '\n')).then(function() {
    var orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = orig; }, 1500);
  });
}

// ── Cortex Extension Editor ───────────────────────

var cortexEditorExtName = null; // name of extension being edited
var cortexEditorWasActive = false; // was it active before editing?
var cortexEditorLibCounter = 0; // counter for unique lib section IDs

function getCortexOwnerToken() {
  try {
    if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession()) {
      return window.AIMEAT.auth.getSession().jwt;
    }
    var stored = localStorage.getItem('aimeat_session');
    if (stored) {
      var parsed = JSON.parse(stored);
      return parsed.jwt || null;
    }
  } catch(e) {}
  return null;
}

function openCortexEditor(encodedName) {
  var config = loadConfig();
  var url = config.aimeatUrl.replace(/\/+$/, '');
  var token = getCortexOwnerToken();
  if (!token) { showNotice('You must be logged in as an owner to edit extensions.'); return; }

  var statusEl = document.getElementById('cortex-editor-status');
  statusEl.textContent = 'Loading extension data...';
  statusEl.style.color = '#34d399';
  document.getElementById('cortex-editor-manifest').value = '';
  document.getElementById('cortex-editor-libs').innerHTML = '';
  document.getElementById('cortex-editor-name').textContent = '';
  cortexEditorLibCounter = 0;

  // Close the detail popup
  document.getElementById('cortex-popup-overlay').style.display = 'none';
  document.getElementById('cortex-editor-overlay').style.display = 'flex';

  fetch(url + '/v1/cortex/' + encodedName + '/export', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.data) { statusEl.textContent = 'Error: ' + (data.error || 'Unknown error'); statusEl.style.color = 'var(--accent,#e74c6f)'; return; }
      var ext = data.data;
      cortexEditorExtName = ext.name;
      cortexEditorWasActive = (ext.status === 'active');
      document.getElementById('cortex-editor-name').textContent = ext.name + (cortexEditorWasActive ? ' (active)' : ' (inactive)');
      document.getElementById('cortex-editor-manifest').value = ext.manifest || '';

      // Render lib editors
      var libsHtml = '';
      var libs = ext.libs || {};
      var filenames = Object.keys(libs);
      for (var i = 0; i < filenames.length; i++) {
        cortexEditorLibCounter++;
        var fname = filenames[i];
        libsHtml += cortexEditorLibSection(cortexEditorLibCounter, fname, libs[fname]);
      }
      document.getElementById('cortex-editor-libs').innerHTML = libsHtml;
      statusEl.textContent = 'Loaded. ' + filenames.length + ' lib file' + (filenames.length !== 1 ? 's' : '') + '.';
    })
    .catch(function(e) {
      statusEl.textContent = 'Error loading: ' + e.message;
      statusEl.style.color = 'var(--accent,#e74c6f)';
    });
}

function cortexEditorLibSection(id, filename, content) {
  return '<div id="cortex-lib-' + id + '" style="margin-bottom:1rem;border:1px solid var(--border-subtle);border-radius:8px;padding:12px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">'
    + '<label style="font-size:.85rem;font-weight:600">Lib: <input type="text" value="' + cortexEsc(filename) + '" data-lib-name="' + id + '" style="background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 6px;color:var(--text);font-family:monospace;font-size:.8rem;width:200px" /></label>'
    + '<button onclick="document.getElementById(\'cortex-lib-' + id + '\').remove()" style="font-size:.7rem;padding:2px 8px;border-radius:4px;border:1px solid rgba(232,86,74,.3);background:transparent;color:#E8564A;cursor:pointer">Remove</button>'
    + '</div>'
    + '<textarea data-lib-content="' + id + '" spellcheck="false" style="width:100%;min-height:150px;background:var(--bg-subtle);color:var(--text);border:1px solid var(--border-subtle);border-radius:8px;padding:10px;font-family:monospace;font-size:.78rem;resize:vertical;tab-size:2">' + cortexEsc(content || '') + '</textarea>'
    + '</div>';
}

function cortexEditorAddLib() {
  cortexEditorLibCounter++;
  var container = document.getElementById('cortex-editor-libs');
  container.insertAdjacentHTML('beforeend', cortexEditorLibSection(cortexEditorLibCounter, 'new-lib.js', ''));
}

function cortexEditorCollectLibs() {
  var libs = {};
  var container = document.getElementById('cortex-editor-libs');
  var nameInputs = container.querySelectorAll('input[data-lib-name]');
  for (var i = 0; i < nameInputs.length; i++) {
    var id = nameInputs[i].getAttribute('data-lib-name');
    var fname = nameInputs[i].value.trim();
    var contentEl = container.querySelector('textarea[data-lib-content="' + id + '"]');
    if (fname && contentEl) {
      libs[fname] = contentEl.value;
    }
  }
  return libs;
}

function cortexEditorSave() {
  var config = loadConfig();
  var url = config.aimeatUrl.replace(/\/+$/, '');
  var token = getCortexOwnerToken();
  if (!token) { showNotice('No auth token available.'); return; }

  var manifest = document.getElementById('cortex-editor-manifest').value;
  if (!manifest.trim()) { showNotice('Manifest cannot be empty.'); return; }

  var libs = cortexEditorCollectLibs();
  var statusEl = document.getElementById('cortex-editor-status');
  var saveBtn = document.getElementById('cortex-editor-save-btn');
  var name = cortexEditorExtName;

  statusEl.textContent = 'Saving...';
  statusEl.style.color = '#34d399';
  saveBtn.disabled = true;

  // Atomic in-place replace: PUT swaps the manifest + libs and PRESERVES lifecycle fields
  // (status, installedBy), so an active extension stays active with no delete-then-reinstall
  // window, and the server enforces owner + namespace. Replaces the old DELETE -> POST ->
  // activate dance, which could DESTROY the extension if the reinstall failed — and which
  // misread the response envelope (`data.status`, a field that does not exist) as a failure
  // on every success. The name is the identity; editing it in the manifest is a NAME_MISMATCH.
  fetch(url + '/v1/cortex/' + encodeURIComponent(name), {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest: manifest, libs: libs })
  })
  .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
  .then(function(res) {
    saveBtn.disabled = false;
    var data = res.data || {};
    if (!res.ok || data.ok === false) {
      var err = data.error || {};
      var msg = err.message || err.code || 'Save failed';
      if (err.details && err.details.errors) msg += ': ' + err.details.errors.join('; ');
      statusEl.textContent = 'Error: ' + msg;
      statusEl.style.color = '#E8564A';
      return;
    }
    if (data.data && data.data.name) cortexEditorExtName = data.data.name;
    statusEl.textContent = 'Saved successfully!';
    statusEl.style.color = '#34d399';
    // Refresh the cortex bar
    loadCortexExtensions();
  })
  .catch(function(e) {
    saveBtn.disabled = false;
    statusEl.textContent = 'Error: ' + e.message;
    statusEl.style.color = '#E8564A';
  });
}

function cortexEditorExport() {
  var manifest = document.getElementById('cortex-editor-manifest').value;
  var libs = cortexEditorCollectLibs();
  var name = (cortexEditorExtName || 'extension').replace(/\//g, '-');

  // Download manifest
  var manifestBlob = new Blob([manifest], { type: 'text/yaml' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(manifestBlob);
  a.download = name + '.yaml';
  a.click();
  URL.revokeObjectURL(a.href);

  // Download each lib file
  var filenames = Object.keys(libs);
  for (var i = 0; i < filenames.length; i++) {
    var libBlob = new Blob([libs[filenames[i]]], { type: 'application/javascript' });
    var b = document.createElement('a');
    b.href = URL.createObjectURL(libBlob);
    b.download = filenames[i];
    b.click();
    URL.revokeObjectURL(b.href);
  }
}

function closeCortexEditor() {
  document.getElementById('cortex-editor-overlay').style.display = 'none';
  cortexEditorExtName = null;
}

// ── Prompt Builder Panel ──────────────────────────

var pbSourceApp = null; // app being improved (null = new app mode)

function openPromptBuilder(app) {
  pbSourceApp = app || null;
  var overlay = document.getElementById('prompt-builder-overlay');
  var desc = document.getElementById('pb-description');

  // Reset state
  desc.value = '';
  window.pbTemplate = null;
  var tplSel0 = document.getElementById('pb-template');
  if (tplSel0) tplSel0.value = '';

  // Mode is implicit: "improve" when opened from an app, else "new". The radios
  // stay in the DOM (hidden) so buildPromptFromBuilder reads the right mode; instead
  // of a confusing toggle we show a plain "Improving: <name>" note when relevant.
  var radios = document.querySelectorAll('input[name="pb-mode"]');
  var improving = document.getElementById('pb-improving');
  if (pbSourceApp) {
    radios[1].checked = true;
    if (improving) {
      improving.textContent = '✏️ ' + (t('pb.improving') || 'Improving') + ': ' + (pbSourceApp.name || pbSourceApp.filename || 'this app');
      improving.style.display = '';
    }
  } else {
    radios[0].checked = true;
    if (improving) improving.style.display = 'none';
  }
  desc.placeholder = t('pb.descPh');

  // Load authoring templates (booster-kit) into the "Start from a template" picker
  loadPbTemplates();
  // Load the canonical platform-instructions core from the node (single source of truth)
  loadPbCore();

  overlay.style.display = 'flex';
  desc.focus();
  updatePbPreview();
}

function closePbPanel() {
  document.getElementById('prompt-builder-overlay').style.display = 'none';
  pbSourceApp = null;
}

// The canonical platform-instructions core, fetched from the node (GET /v1/prompts/build-app —
// the node is the single source of truth; the inline text in buildPromptFromBuilder is only the
// offline / older-node fallback). Keyed by mode; refreshed each time the builder opens.
var pbCore = { new: null, improve: null };
function loadPbCore() {
  var config = loadConfig();
  if (!config.aimeatUrl) return;
  var base = config.aimeatUrl.replace(/\/+$/, '');
  ['new', 'improve'].forEach(function (mode) {
    fetch(base + '/v1/prompts/build-app?mode=' + mode + '&lang=' + encodeURIComponent(getLang()))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var body = d && d.data && d.data.body;
        if (body && typeof body === 'string') { pbCore[mode] = body; updatePbPreview(); }
      })
      .catch(function () { /* older node without the endpoint — inline fallback is used */ });
  });
}

// Booster-kit: populate the "Start from a template" picker from /v1/app-templates and, on
// selection, fetch that template's content into window.pbTemplate (injected by buildPromptFromBuilder).
function loadPbTemplates() {
  var sel = document.getElementById('pb-template');
  if (!sel) return;
  var config = loadConfig();
  if (!config.aimeatUrl) return;
  var base = config.aimeatUrl.replace(/\/+$/, '');
  fetch(base + '/v1/app-templates?lang=' + encodeURIComponent(getLang()))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      // Starting points only: full use-case scaffolds first, then blank app-shells (not components).
      var list = ((d.data && d.data.templates) || []).filter(function (t) { return t.kind !== 'component'; });
      list.sort(function (a, b) { return (a.kind === 'use-case' ? 0 : 1) - (b.kind === 'use-case' ? 0 : 1); });
      sel.innerHTML = '<option value="">' + t('pb.noneTemplate') + '</option>';
      list.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.id;
        var prefix = t.kind === 'use-case' ? '★ ' : '';
        // Use-case titles are short ("Marketplace") so append a snippet of their description;
        // app-shell titles are now self-describing ("Standard app — login + saves your data"),
        // so don't tack on a second em-dash clause.
        o.textContent = prefix + t.title + (t.kind === 'use-case' && t.description ? ' — ' + t.description.slice(0, 70) : '');
        sel.appendChild(o);
      });
      sel.onchange = function () {
        var id = sel.value;
        if (!id) { window.pbTemplate = null; updatePbPreview(); return; }
        fetch(base + '/v1/app-templates/' + encodeURIComponent(id))
          .then(function (r) { return r.json(); })
          .then(function (d2) { window.pbTemplate = (d2.data && d2.data.template) || null; updatePbPreview(); })
          .catch(function () { window.pbTemplate = null; });
      };
    })
    .catch(function () { /* templates are optional */ });
}

function buildPromptFromBuilder() {
  var config = loadConfig();
  var nodeUrl = config.aimeatUrl ? config.aimeatUrl.replace(/\/+$/, '') : 'https://your-aimeat-node.example';
  var mode = document.querySelector('input[name="pb-mode"]:checked').value;
  var description = document.getElementById('pb-description').value.trim();

  var prompt = '';

  // Converse + build the UI in the language the user is browsing in (the build
  // instructions below stay in English, but the conversation + app text should match).
  var PB_LANGS = { en: 'English', fi: 'Finnish (Suomi)' };
  var pbLang = PB_LANGS[getLang()] || 'English';
  prompt += 'Language: talk to me and write ALL user-facing text (UI labels, buttons, messages) in ' + pbLang + '. These build instructions are in English, but converse with me and build the app interface in ' + pbLang + '.\n\n';

  // Header
  var isImprove = (mode === 'improve' && pbSourceApp);
  if (isImprove) {
    prompt += 'Here is an HTML app called "' + (pbSourceApp.name || 'Untitled') + '".\n';
    prompt += 'I want to change it: ' + (description || '(I will describe the change — ask me if it is not clear)') + '\n\n';
    prompt += 'If anything about the change is ambiguous, ask me first. Then return the COMPLETE updated HTML file — do not omit any parts.\n\n';
  } else {
    prompt += 'Help me build a single-file HTML app that runs on AIMEAT.\n';
    prompt += 'My initial idea: ' + (description || '(not given yet — ask me what to build)') + '\n\n';
    prompt += '## Step 1 — Interview me first\n';
    prompt += 'If I have not described my idea above, your FIRST reply must ask me what I want to build. Then ask me these in ONE message and wait for my answers:\n';
    prompt += '1. What kind of app? (message board · multiplayer game · notes/journal · habit or expense tracker · family tools like shared lists/calendar · drawing/creative · music jam · real-time collaboration · offer or need help/services · something else)\n';
    prompt += '2. What should it be called?\n';
    prompt += '3. How should it look and feel? (e.g. dark neon · cozy · sleek minimal · fun colorful) — it must support BOTH light and dark.\n';
    prompt += '4. Data: SHARED (a community space others can see and add to) or PRIVATE (only mine)?\n';
    prompt += '5. Should it use AI features (summaries, suggestions, generation)? If yes I can enable them via aimeat-ai.\n';
    prompt += 'Skip any question I already answered in my idea above. Use my answers to customise everything in Step 2.\n\n';
  }

  // Build instructions — framed as Step 2 for new apps. Prefer the node-served canonical
  // core (GET /v1/prompts/build-app, fetched by loadPbCore — single source of truth); the
  // inline text below is the offline / older-node fallback and may lag behind the node's.
  var core = pbCore[isImprove ? 'improve' : 'new'];
  if (core) {
    prompt += core;
  } else {
  prompt += isImprove ? '## AIMEAT Platform Instructions\n\n' : '## Step 2 — Build it (once I have answered)\n\n';
  prompt += 'This app runs in the AIMEAT ecosystem. Here is what you need to know:\n\n';

  // Core libraries
  prompt += '### Available Client Libraries\n';
  prompt += 'Load with <script src> from the node base ' + nodeUrl + '/v1/libs/. Include ONLY the ones you use. Load aimeat-auth first — the others build on its session.\n\n';
  prompt += 'Core:\n';
  prompt += '- aimeat-auth.js — login button, JWT, session (`AIMEAT.auth`, `session.fetch()`)\n';
  prompt += '- aimeat-data.js — private/public key-value memory + search (`AIMEAT.data`)\n';
  prompt += '- aimeat-storage.js — file upload/download (`AIMEAT.storage`)\n';
  prompt += '- aimeat-organism.js — organisms & workspaces: list, normalized workspace read (published + drafts merged per item), write drafts, publish, README, search (`AIMEAT.organism`). Requires aimeat-auth.\n\n';
  prompt += 'AI (prompt-driven — see the AI section below):\n';
  prompt += '- aimeat-ai.js — LLM completions on the USER\'s own OpenRouter key (`AIMEAT.ai.complete`). Requires aimeat-auth.\n\n';
  prompt += 'Economy & agents:\n';
  prompt += '- aimeat-wallet.js — morsel balance + transactions (`AIMEAT.wallet`)\n';
  prompt += '- aimeat-work.js — actions / work requests (`AIMEAT.work`)\n';
  prompt += '- aimeat-agents.js — commission & watch the owner\'s AI agents (`AIMEAT.agents`)\n';
  prompt += '- aimeat-capabilities.js — discover & invoke shared capabilities (`AIMEAT.capabilities`)\n\n';
  prompt += 'Media & misc:\n';
  prompt += '- aimeat-audio.js — audio engine: instruments, synth, soundboard\n';
  prompt += '- aimeat-speech.js — text-to-speech / speech helpers\n';
  prompt += '- aimeat-markdown.js — render markdown INTO an element: `AIMEAT.md.render(text, target)` (returns an Element — never assign it to innerHTML; use `renderToString(text)` for a string). `await AIMEAT.md.renderRich(text, target)` adds task lists, footnotes, code highlighting, Mermaid diagrams AND live data embeds: a ```aimeat-memory fence (lines `key: <memory key>`, optional `view: table|props|list|value|json`, `fields: a,b`, `title: …`) renders that memory key as a fresh table on every open — perfect for agent-produced data in documents.\n';
  prompt += '- aimeat-editor.js — markdown editor: `AIMEAT.editor.mount(el, {value, onChange})`, `AIMEAT.editor.toolbar(adapter)`, `AIMEAT.editor.split(el, {value, onChange})` for editor + live preview (pairs with aimeat-markdown.js)\n';
  prompt += '- aimeat-header.js — drop-in canonical site header (nav + theme)\n';
  prompt += '- aimeat-tunnel.js — personal-node tunnel client (advanced)\n\n';

  // Ready-made UI building blocks (node-bundled cortex) — ALWAYS offered so the AI can
  // reach for them instead of hand-rolling tables/forms/charts. Load only what's used.
  prompt += 'Ready-made UI (node-bundled — load from ' + nodeUrl + '/v1/cortex/<name>/libs/<name>.js, use only what you need):\n';
  prompt += '- aimeat-ui-viewers — sortable/filterable DataTable + viewers (`AIMEAT.ui.viewers`)\n';
  prompt += '- aimeat-ui-forms — form builder with validation (`AIMEAT.ui.forms`)\n';
  prompt += '- aimeat-ui-layout — responsive layout helpers, master/detail (`AIMEAT.ui.layout`)\n';
  prompt += '- aimeat-ui-nav — navbars, tabs, menus (`AIMEAT.ui.nav`)\n';
  prompt += '- aimeat-ui-dialogs — modals, toasts, confirms (`AIMEAT.ui.dialogs`)\n';
  prompt += '- aimeat-charts — charts / graphs (`AIMEAT.charts`)\n';
  prompt += '- aimeat-canvas — drawing / freeform canvas (`AIMEAT.canvas`)\n';
  prompt += 'Example: <script src="' + nodeUrl + '/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></' + 'script>\n\n';

  // Auth pattern
  prompt += '### Auth Pattern\n';
  prompt += 'Handle BOTH login paths: a fresh sign-in click (the onLogin callback) AND a page that loads already signed in (restore the session yourself). `onLogin` fires ONLY on a fresh sign-in — it does NOT fire on reload when a session already exists, so a page that relies on onLogin alone shows nothing to an already-logged-in returning user.\n';
  prompt += '```html\n';
  prompt += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  prompt += '<script>\n';
  prompt += 'function showApp(session) { /* session.owner, session.jwt, session.fetch() */ }\n';
  prompt += 'function hideApp() { /* hide content, show a "Sign in" message */ }\n';
  prompt += '\n';
  prompt += '// Path 1 — fresh sign-in / sign-out via the login button:\n';
  prompt += 'AIMEAT.auth.mountLoginButton("#login", {\n';
  prompt += '  onLogin: showApp,   // fires ONLY on a fresh sign-in click, NOT on reload\n';
  prompt += '  onLogout: hideApp\n';
  prompt += '});\n';
  prompt += '\n';
  prompt += '// Path 2 — already signed in when the page loads. Restore the stored session\n';
  prompt += '// explicitly; login() returns the session (or null if not signed in).\n';
  prompt += 'AIMEAT.auth.login().then(function (session) { if (session) showApp(session); });\n';
  prompt += '</' + 'script>\n';
  prompt += '```\n\n';

  // Data storage
  prompt += '### Data Storage\n';
  prompt += 'Match the PRIVATE vs SHARED choice from Step 1:\n';
  prompt += '```javascript\n';
  prompt += '// PRIVATE — scoped to the logged-in owner, only they can read it:\n';
  prompt += 'await AIMEAT.data.set("myapp.notes", data, { visibility: "private", tags: ["myapp"] });\n';
  prompt += 'const mine = await AIMEAT.data.get("myapp.notes");\n';
  prompt += '// SHARED/community — public so everyone can read; each user writes their own key:\n';
  prompt += 'await AIMEAT.data.set("myapp.shared.<unique-id>", entry, { visibility: "public" });\n';
  prompt += 'const theirs = await AIMEAT.data.getPublic(ownerGaii, "myapp.shared.<id>");  // read others\n';
  prompt += 'const results = await AIMEAT.data.search("query");\n';
  prompt += '```\n';
  prompt += 'Works only when logged in. After a write, read it back to confirm it persisted.\n\n';

  // AI — prompt-driven completions on the user's own key
  prompt += '### AI (prompt-driven)\n';
  prompt += 'aimeat-ai runs an LLM on the LOGGED-IN USER\'s own OpenRouter key — free for the app, and the user controls spend. Load aimeat-auth first, then gate every "Use AI" control on isAvailable().\n';
  prompt += '```html\n';
  prompt += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  prompt += '<script src="' + nodeUrl + '/v1/libs/aimeat-ai.js"></' + 'script>\n';
  prompt += '```\n';
  prompt += '```javascript\n';
  prompt += 'if (await AIMEAT.ai.isAvailable()) {            // false until login + key configured\n';
  prompt += '  const r = await AIMEAT.ai.complete({ app_id: "my-app", prompt: "Summarise:\\n" + text });\n';
  prompt += '  render(r.content);                            // also: r.model, r.usage, r.budget\n';
  prompt += '} else { showHint("Log in and add an AI key to enable this."); }\n';
  prompt += '// Structured output: const { parsed } = await AIMEAT.ai.completeJson({ app_id, prompt, schema });\n';
  prompt += '```\n';
  prompt += 'Always handle isAvailable()===false and catch errors; never hardcode an API key in the app.\n\n';

  // Real-time / multiplayer
  prompt += '### Real-time / multiplayer (optional)\n';
  prompt += 'For shared live state (presence boards, 1v1 games) use realtime rooms via your authenticated session.fetch:\n';
  prompt += '```javascript\n';
  prompt += '// 1) create or join a room\n';
  prompt += 'const room = (await session.fetch("/v1/realtime/rooms", { method: "POST",\n';
  prompt += '  body: JSON.stringify({ name: "my-room" }) })).data;   // → { id, ws_url }\n';
  prompt += '// 2) open a WebSocket for live presence + messages\n';
  prompt += 'const ws = new WebSocket(location.origin.replace(/^http/, "ws") + room.ws_url);\n';
  prompt += 'ws.onmessage = (e) => handle(JSON.parse(e.data));\n';
  prompt += '// 3) for low-latency P2P, GET /v1/realtime/ice-servers and use WebRTC\n';
  prompt += '```\n';
  prompt += 'Simpler apps can skip rooms and just observe shared AIMEAT.data keys on a timer.\n\n';

  // Design guidelines
  prompt += '### Design Guidelines\n';
  prompt += 'Use CSS variables so the app themes cleanly, and RESPECT the user\'s AIMEAT theme: the light/dark choice they made in the AIMEAT pill is saved in localStorage "aimeat-theme" ("light"|"dark"). Define light as the default and dark under [data-theme="dark"], then set that attribute from the saved choice on load (fall back to the OS preference, and live-update if it changes):\n';
  prompt += '```css\n';
  prompt += ':root { --bg:#fafaf8; --card:#fff; --text:#1a1a2e; --accent:#e8564a; --border:#e5e7eb; --radius:12px; }\n';
  prompt += ':root[data-theme="dark"] { --bg:#14141c; --card:#1e1e2a; --text:#ececf4; --border:#2e2e40; }\n';
  prompt += '```\n';
  prompt += '```js\n';
  prompt += '(function(){ function apply(t){ document.documentElement.setAttribute("data-theme", t==="dark"?"dark":"light"); }\n';
  prompt += '  apply(localStorage.getItem("aimeat-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));\n';
  prompt += '  addEventListener("storage", function(e){ if(e.key==="aimeat-theme" && e.newValue) apply(e.newValue); }); })();\n';
  prompt += '```\n';
  prompt += 'Always include <meta name="viewport" content="width=device-width, initial-scale=1.0">. Mobile-first, single self-contained HTML file with embedded CSS + JS.\n\n';

  // Rules
  prompt += '### Important Rules\n';
  prompt += '- Return the COMPLETE HTML file, not fragments\n';
  prompt += '- Never use literal closing script tags in JS comments or strings\n';
  prompt += '- Keep it as a single self-contained HTML file\n';
  prompt += '- Load only the libraries you actually use; load aimeat-auth before libs that need a session\n';
  prompt += '- Gate AI features on AIMEAT.ai.isAvailable() and handle the logged-out / no-key case\n';
  prompt += '- Theme with CSS variables; respect the user\'s AIMEAT light/dark choice (localStorage "aimeat-theme") with an OS-preference fallback\n';
  prompt += '- Include error handling and loading states for API calls\n\n';

  // After-build: have the AI walk me through publishing — closes the loop for newcomers.
  if (!isImprove) {
    prompt += '## When the app is ready — tell me how to publish it\n';
    prompt += 'After you hand me the finished single HTML file, END your reply by telling me (in my language) to do exactly this:\n';
    prompt += '1. Open ' + nodeUrl + '/app-catalog.html\n';
    prompt += '2. Click "+ Add" → open the "Paste" tab → paste the HTML (or drop it as a file). The app name + description fill in automatically.\n';
    prompt += '3. Click Publish.\n';
    prompt += 'I will be asked to sign in first — it is fast: one click with Google, or a quick email + password, and a brand-new account is created right there in seconds.\n';
    prompt += 'What I get: once published, the app is LIVE on my own AIMEAT node and PUBLIC — anyone can find it in the community catalogue and use it, and I get a link to share. From my catalogue I can launch it, publish updates (older versions are always kept), park it (hide it from the public), or delete it. It keeps working with my AIMEAT login, saved data, files, AI and realtime features.\n\n';
  }
  }

  // Source code for improve mode
  if (mode === 'improve' && pbSourceApp && pbSourceApp.blob) {
    var source = decodeURIComponent(escape(atob(pbSourceApp.blob)));
    prompt += '--- Source Code ---\n' + source;
  }

  // Booster-kit: if the user picked a starting template, hand the AI the skeleton to copy from.
  if (window.pbTemplate && window.pbTemplate.content) {
    prompt += '\n## Starting template (copy from this)\nUse this skeleton as your base — keep its boot, login pill, and self-hosted theme wiring intact; fill the {{...}} slots; build your views inside <main>. Return the COMPLETE single HTML file based on it.\n```html\n' + window.pbTemplate.content + '\n```\n';
  }

  return prompt;
}

function updatePbPreview() {
  var preview = document.getElementById('pb-preview');
  // Show the full prompt — the preview box scrolls. "Copy Prompt" copies this
  // same text verbatim.
  preview.textContent = buildPromptFromBuilder();
}

export {
  loadCortexExtensions,
  showCortexPopup,
  cortexCopy,
  getCortexOwnerToken,
  openCortexEditor,
  cortexEditorAddLib,
  cortexEditorSave,
  cortexEditorExport,
  closeCortexEditor,
  openPromptBuilder,
  closePbPanel,
  buildPromptFromBuilder,
  updatePbPreview
};
