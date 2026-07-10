/**
 * @file main.js
 * @description App-catalog entry module (bundled by scripts/build-app-catalog.ts into the
 *   served src/static/app-catalog.html). Holds catalog state, rendering, actions, and the
 *   window._launcher handler surface consumed by inline onclick in the markup. Carved from
 *   the former single inline <script>; further modules are split out incrementally.
 * @structure  imports (i18n data) → state → db → api → render → actions → window._launcher → init
 * @usage  built, not loaded raw: pnpm build:app-catalog
 */
import { I18N } from './i18n-data.js';
import { escapeHtml, jsArg, sourceLabel, sourceLabelText, bareOwnerName, sameOwner, filterAttr, isSameOriginUrl } from './util.js';
import { getAllApps, saveApp, deleteApp, openDB, getDbName, getDbMode, setDbMode, closeDbInstance } from './db.js';


  // ── i18n (en / fi) ─────────────────────────────────
  // Standalone catalogue page: its own translation table + picker, independent
  // of the SPA. Static chrome is annotated with data-i18n / data-i18n-ph /
  // data-i18n-title; JS-rendered strings use t(). Dynamic app data (names,
  // tags) is user content and stays as-is.
  var currentLang = 'en';

  function t(key) {
    var table = I18N[currentLang] || I18N.en;
    if (table[key] != null) return table[key];
    if (I18N.en[key] != null) return I18N.en[key];
    return key;
  }

  function applyI18n() {
    var i, nodes;
    nodes = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    nodes = document.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('placeholder', t(nodes[i].getAttribute('data-i18n-ph')));
    nodes = document.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) nodes[i].setAttribute('title', t(nodes[i].getAttribute('data-i18n-title')));
    document.documentElement.lang = currentLang;
    document.title = t('header.title') + ' — AIMEAT';
    updateLangToggle();
  }

  function updateLangToggle() {
    var btns = document.querySelectorAll('#lang-toggle .lang-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-lang') === currentLang);
    }
  }

  function setLanguage(lang) {
    currentLang = (lang === 'fi') ? 'fi' : 'en';
    try { var config = loadConfig(); config.language = currentLang; saveConfig(config); } catch (e) {}
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

  // ── Config (localStorage) ─────────────────────────

  const DEFAULT_CONFIG = {
    theme: 'light',
    defaultOpenMode: 'tab',
    aimeatUrl: window.location.origin,
    language: 'en'
  };

  function loadConfig() {
    var cfg;
    try {
      cfg = Object.assign({}, DEFAULT_CONFIG, JSON.parse(localStorage.getItem('appLauncherConfig') || '{}'));
    } catch (e) {
      cfg = Object.assign({}, DEFAULT_CONFIG);
    }
    // The catalog is SERVED BY its node and talks to it same-origin. The old "download it and point
    // it at any node" standalone story is retired: it forced CORS `*`, could never sign in from a
    // foreign origin (auth-lib loads same-origin), and is increasingly blocked by browsers' Private/
    // Local Network Access. localhost / aimeat-desktop / federation all work because each node serves
    // its OWN catalog same-origin. Always use the serving origin as the node URL.
    cfg.aimeatUrl = window.location.origin;
    return cfg;
  }

  function saveConfig(config) {
    localStorage.setItem('appLauncherConfig', JSON.stringify(config));
  }

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

  // ── ZIP Helpers ────────────────────────────────

  function mimeFromExtension(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    var map = {
      html: 'text/html', htm: 'text/html',
      css: 'text/css',
      js: 'application/javascript', mjs: 'application/javascript',
      json: 'application/json',
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      ico: 'image/x-icon',
      woff: 'font/woff', woff2: 'font/woff2',
      ttf: 'font/ttf', otf: 'font/otf',
      eot: 'application/vnd.ms-fontobject',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
      mp4: 'video/mp4', webm: 'video/webm',
      xml: 'application/xml',
      txt: 'text/plain',
      pdf: 'application/pdf'
    };
    return map[ext] || 'application/octet-stream';
  }

  function toBase64(uint8arr) {
    var binary = '';
    for (var i = 0; i < uint8arr.length; i++) {
      binary += String.fromCharCode(uint8arr[i]);
    }
    return btoa(binary);
  }

  // ── Minimal ZIP Parser ────────────────────────────

  async function extractZip(arrayBuffer) {
    var view = new DataView(arrayBuffer);
    var files = [];

    // Parse via the CENTRAL DIRECTORY, not the local headers: when the data-descriptor bit
    // (general-purpose flag bit 3) is set — git archive, GitHub "Download ZIP", streamed zips —
    // the local header carries compressedSize 0 (the real size lives in a trailing descriptor),
    // which used to truncate every file to zero bytes. The central directory always has the
    // authoritative sizes.
    // 1. Find the End Of Central Directory record (0x06054b50), scanning back from the end.
    var eocd = -1;
    for (var p = view.byteLength - 22; p >= 0; p--) {
      if (view.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
    }
    if (eocd === -1) throw new Error('Not a valid ZIP (no end-of-central-directory record)');
    var cdCount = view.getUint16(eocd + 10, true);
    var cdPos = view.getUint32(eocd + 16, true);

    for (var n = 0; n < cdCount && cdPos + 46 <= view.byteLength; n++) {
      if (view.getUint32(cdPos, true) !== 0x02014b50) break; // central-directory file header
      var compressionMethod = view.getUint16(cdPos + 10, true);
      var compressedSize = view.getUint32(cdPos + 20, true);
      var nameLen = view.getUint16(cdPos + 28, true);
      var extraLen = view.getUint16(cdPos + 30, true);
      var commentLen = view.getUint16(cdPos + 32, true);
      var localOffset = view.getUint32(cdPos + 42, true);
      var name = new TextDecoder().decode(new Uint8Array(arrayBuffer, cdPos + 46, nameLen));
      cdPos += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/')) continue; // directory
      if (view.getUint32(localOffset, true) !== 0x04034b50) continue; // not a local header

      // The data starts after the LOCAL header's name + extra fields (its extra length can
      // differ from the central directory's), but its SIZE comes from the central directory.
      var lNameLen = view.getUint16(localOffset + 26, true);
      var lExtraLen = view.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + lNameLen + lExtraLen;
      var rawData = new Uint8Array(arrayBuffer, dataStart, compressedSize);

      var data;
      if (compressionMethod === 0) {
        data = rawData; // Stored (no compression)
      } else if (compressionMethod === 8) {
        // Deflate — use browser's DecompressionStream
        var ds = new DecompressionStream('raw');
        var writer = ds.writable.getWriter();
        writer.write(rawData);
        writer.close();
        var reader = ds.readable.getReader();
        var chunks = [];
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          chunks.push(result.value);
        }
        var totalLen = chunks.reduce(function (s, c) { return s + c.length; }, 0);
        data = new Uint8Array(totalLen);
        var dpos = 0;
        for (var ci = 0; ci < chunks.length; ci++) {
          data.set(chunks[ci], dpos);
          dpos += chunks[ci].length;
        }
      } else {
        throw new Error('Unsupported compression method: ' + compressionMethod);
      }

      files.push({ name: name, data: data });
    }

    return files;
  }

  // ── ZIP Inline Bundler ────────────────────────────

  async function bundleZip(files) {
    // 1. Find index.html or any .html file as the base
    var htmlFile = null;
    for (var i = 0; i < files.length; i++) {
      var lowerName = files[i].name.toLowerCase();
      if (lowerName === 'index.html' || lowerName.endsWith('/index.html')) {
        htmlFile = files[i];
        break;
      }
    }
    if (!htmlFile) {
      for (var i = 0; i < files.length; i++) {
        if (files[i].name.toLowerCase().match(/\.html?$/)) {
          htmlFile = files[i];
          break;
        }
      }
    }
    if (!htmlFile) {
      throw new Error('No HTML file found in ZIP');
    }

    // 2. Determine the base path (directory containing the HTML file)
    var lastSlash = htmlFile.name.lastIndexOf('/');
    var basePath = lastSlash >= 0 ? htmlFile.name.substring(0, lastSlash + 1) : '';

    // 3. Build a map of relative file paths to file data
    var fileMap = {};
    for (var i = 0; i < files.length; i++) {
      var fname = files[i].name;
      // Store path relative to base
      if (basePath && fname.startsWith(basePath)) {
        fileMap[fname.substring(basePath.length)] = files[i].data;
      }
      // Also store the full path for lookup
      fileMap[fname] = files[i].data;
    }

    // Helper: resolve a reference relative to the HTML file's directory
    function resolveRef(ref) {
      // Strip leading ./
      var cleaned = ref.replace(/^\.\//, '');
      // Try direct lookup
      if (fileMap[cleaned]) return fileMap[cleaned];
      // Try with basePath prepended
      if (fileMap[basePath + cleaned]) return fileMap[basePath + cleaned];
      return null;
    }

    // Helper: get file content as text
    function fileAsText(data) {
      return new TextDecoder().decode(data);
    }

    // Helper: get file content as data URL
    function fileAsDataUrl(ref, data) {
      var mime = mimeFromExtension(ref);
      return 'data:' + mime + ';base64,' + toBase64(data);
    }

    var html = fileAsText(htmlFile.data);

    // 4. Replace <link rel="stylesheet" href="..."> with inline <style>
    html = html.replace(/<link\s+[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi, function (tag) {
      var hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (!hrefMatch) return tag;
      var href = hrefMatch[1];
      var fileData = resolveRef(href);
      if (!fileData) return tag; // keep original if file not found
      var cssContent = fileAsText(fileData);
      // Inline CSS url() references within the stylesheet
      cssContent = inlineCssUrls(cssContent);
      return '<style>/* ' + href + ' */\n' + cssContent + '</style>';
    });

    // 5. Replace script-src tags with inline script blocks
    html = html.replace(/<script\s+[^>]*src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi, function (tag, src) {
      var fileData = resolveRef(src);
      if (!fileData) return tag; // keep original if file not found
      return '<script>/* ' + src + ' */\n' + fileAsText(fileData) + '<\/script>';
    });

    // 6. Replace src="..." and href="..." pointing to binary assets with data URLs
    html = html.replace(/(src|href)\s*=\s*["']([^"']+)["']/gi, function (match, attr, ref) {
      // Skip data: URLs, http(s) URLs, # anchors, and javascript:
      if (ref.match(/^(data:|https?:|#|javascript:|mailto:)/i)) return match;
      // Skip already-inlined stylesheets and scripts (they won't match since already replaced)
      var fileData = resolveRef(ref);
      if (!fileData) return match;
      var mime = mimeFromExtension(ref);
      // Only inline binary/image/font assets, not html/css/js (already handled above)
      if (mime.match(/^(image|font|audio|video)\//)) {
        return attr + '="' + fileAsDataUrl(ref, fileData) + '"';
      }
      return match;
    });

    // 7. Replace CSS url(...) references in inline <style> blocks
    html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function (tag, cssContent) {
      var inlined = inlineCssUrls(cssContent);
      if (inlined !== cssContent) {
        return tag.replace(cssContent, inlined);
      }
      return tag;
    });

    function inlineCssUrls(css) {
      return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, function (match, ref) {
        if (ref.match(/^(data:|https?:|#)/i)) return match;
        var fileData = resolveRef(ref);
        if (!fileData) return match;
        return 'url("' + fileAsDataUrl(ref, fileData) + '")';
      });
    }

    return html;
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

  // ── Theme ────────────────────────────────────────

  function applyTheme(theme) {
    // Light is the default (:root). Dark applies the [data-theme="dark"] overrides.
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#14141C' : '#FAFAF8');
    updateThemeToggle();
  }

  function updateThemeToggle() {
    // Show the icon for the mode you'd switch TO: moon while light, sun while dark.
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = dark ? '☀️' : '🌙';
  }

  // Quick light/dark switch from the header. Flips from the LIVE data-theme so it agrees with the
  // login pill's ☾ (which may have changed the theme without touching the catalog's own config).
  function toggleTheme() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(dark ? 'light' : 'dark');
  }

  // Single source of truth for the theme: the shared AIMEAT key `aimeat-theme` (what the login
  // pill's ☾ and every generated app read) — kept in sync with the catalog's own config so the two
  // toggles never disagree (the old split wrote config.theme here but aimeat-theme in the pill,
  // leaving data-theme=dark and aimeat-theme=light at the same time).
  function setTheme(theme) {
    try { localStorage.setItem('aimeat-theme', theme); } catch (e) {}
    var config = loadConfig();
    config.theme = theme;
    saveConfig(config);
    applyTheme(theme);
    var sel = document.getElementById('setting-theme');
    if (sel) sel.value = theme;
  }

  function getThemePref() {
    try { var t = localStorage.getItem('aimeat-theme'); if (t === 'dark' || t === 'light') return t; } catch (e) {}
    var c = loadConfig().theme;
    if (c === 'dark' || c === 'light') return c;
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) {}
    return 'light';
  }

  // ── Settings ────────────────────────────────────

  function openSettings() {
    var config = loadConfig();
    document.getElementById('setting-theme').value = config.theme || 'light';
    document.getElementById('setting-language').value = currentLang;
    document.getElementById('setting-open-mode').value = config.defaultOpenMode || 'tab';
    document.getElementById('setting-aimeat-url').value = config.aimeatUrl || '';
    document.getElementById('settings-overlay').hidden = false;
  }

  function saveSettings() {
    var config = loadConfig();
    config.theme = document.getElementById('setting-theme').value;
    config.defaultOpenMode = document.getElementById('setting-open-mode').value;
    config.aimeatUrl = document.getElementById('setting-aimeat-url').value.trim();
    saveConfig(config);
    try { localStorage.setItem('aimeat-theme', config.theme); } catch (e) {}
    applyTheme(config.theme);
    document.getElementById('settings-overlay').hidden = true;
    // Sync config to server (best-effort)
    syncConfigToServer(config);
  }

  function syncConfigToServer(config) {
    var url = config.aimeatUrl;
    if (!url) return;
    url = url.replace(/\/+$/, '');
    // Only sync safe fields, not the URL itself
    var syncPayload = {
      theme: config.theme,
      defaultOpenMode: config.defaultOpenMode,
      language: config.language || 'en'
    };
    fetch(url + '/v1/auth/anonymous', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (auth) {
        var token = auth.data && auth.data.token;
        if (!token) return;
        return fetch(url + '/v1/memory', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            key: 'app-launcher/config',
            value: syncPayload,
            visibility: 'private'
          })
        });
      })
      .catch(function () { /* best-effort */ });
  }

  function loadConfigFromServer() {
    var config = loadConfig();
    var url = config.aimeatUrl;
    if (!url) return;
    url = url.replace(/\/+$/, '');
    fetch(url + '/v1/auth/anonymous', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (auth) {
        var token = auth.data && auth.data.token;
        if (!token) return;
        var gaii = auth.data.gaii || auth.data.sub || '';
        if (!gaii) return;
        return fetch(url + '/v1/memory/app-launcher%2Fconfig', {
          headers: { 'Authorization': 'Bearer ' + token }
        }).then(function (r) {
          if (!r.ok) return null;
          return r.json();
        });
      })
      .then(function (json) {
        if (!json || !json.data || !json.data.value) return;
        var remote = json.data.value;
        var local = loadConfig();
        var changed = false;
        // Merge remote into local (remote wins for preferences, but don't overwrite aimeatUrl)
        if (remote.theme && remote.theme !== local.theme) {
          local.theme = remote.theme;
          changed = true;
        }
        if (remote.defaultOpenMode && remote.defaultOpenMode !== local.defaultOpenMode) {
          local.defaultOpenMode = remote.defaultOpenMode;
          changed = true;
        }
        if (remote.language && remote.language !== local.language) {
          local.language = remote.language;
          changed = true;
        }
        if (changed) {
          saveConfig(local);
          applyTheme(local.theme);
        }
      })
      .catch(function () { /* best-effort */ });
  }

  function closeSettings() {
    document.getElementById('settings-overlay').hidden = true;
  }

  function openHelp() { document.getElementById('help-overlay').hidden = false; }
  function closeHelp() { document.getElementById('help-overlay').hidden = true; }

  // In-page confirm dialog (replaces native confirm()). Promise-based so call sites stay linear:
  //   if (!(await showConfirm(msg))) return;   (make the enclosing handler `async`).
  // OK resolves true, Cancel/backdrop resolves false. Wired in bootstrap.
  var _confirmResolve = null;
  function showConfirm(message) {
    return new Promise(function (resolve) {
      _confirmResolve = resolve;
      document.getElementById('confirm-message').textContent = message;
      document.getElementById('confirm-overlay').hidden = false;
    });
  }
  function closeConfirm(result) {
    document.getElementById('confirm-overlay').hidden = true;
    var r = _confirmResolve; _confirmResolve = null;
    if (r) r(!!result);
  }

  // In-page toast notice — replaces showNotice() (no native boxes). Non-blocking, auto-dismisses
  // (errors linger), click to close. Type is auto-detected from the message when omitted.
  function showNotice(message, type) {
    message = String(message == null ? '' : message);
    if (!type) {
      if (/\b(fail|failed|error|invalid|denied|unable|not found|wrong|expired)\b/i.test(message)) type = 'error';
      else if (/\b(copied|done|success|saved|cleared|removed|imported|updated|added)\b/i.test(message)) type = 'success';
      else type = 'info';
    }
    var stack = document.getElementById('notice-stack');
    if (!stack) { return; }
    var el = document.createElement('div');
    el.className = 'notice notice-' + type;
    el.setAttribute('role', 'status');
    el.textContent = message;
    el.addEventListener('click', function () { dismissNotice(el); });
    stack.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    el._timer = setTimeout(function () { dismissNotice(el); }, type === 'error' ? 6500 : 3500);
    return el;
  }
  function dismissNotice(el) {
    if (!el || el._dismissed) return;
    el._dismissed = true;
    if (el._timer) clearTimeout(el._timer);
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 250);
  }

  // ── Export / Import ─────────────────────────────

  function exportBackup() {
    getAllApps().then(function (apps) {
      var config = loadConfig();
      var backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        config: config,
        apps: apps
      };
      var json = JSON.stringify(backup, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'app-catalog-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Identity key for duplicate detection: a published app is the same app
  // regardless of its local id; unpublished ones match by name + content size.
  function localAppKey(a) {
    if (a.publishedFilename) return 'pf:' + a.publishedFilename;
    return 'nm:' + (a.name || '') + '|' + (a.blob ? a.blob.length : (a.url || ''));
  }

  // Parsed JSON backup awaiting user selection: { backup, rows: [{app, isDup}] }
  var jsonImportState = null;

  function handleImportBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var backup;
      try {
        backup = JSON.parse(reader.result);
      } catch (e) {
        showNotice('Failed to parse backup file: ' + (e.message || e));
        return;
      }
      if (!backup.apps || !Array.isArray(backup.apps)) {
        showNotice('Invalid backup file: missing apps array');
        return;
      }
      // Inspect-before-write: compare against the current catalog and let the
      // user choose. Duplicates default to unchecked — nothing is imported
      // (and no setting is changed) without an explicit selection.
      getAllApps().then(function (existing) {
        var existingKeys = {};
        existing.forEach(function (a) { existingKeys[localAppKey(a)] = true; });
        jsonImportState = {
          backup: backup,
          rows: backup.apps.map(function (a) {
            return { app: a, isDup: !!existingKeys[localAppKey(a)] };
          }),
        };
        renderJsonImportModal();
      });
    };
    reader.readAsText(file);
  }

  function renderJsonImportModal() {
    var rows = jsonImportState.rows;
    var body = document.getElementById('json-import-body');
    var html = '<p style="font-size:.8rem;color:var(--text-muted);margin:4px 0 8px">' + t('jsonImport.desc') + '</p>' +
      '<div class="backup-toolbar-row"><div>' +
        '<button class="backup-link-btn" onclick="window._launcher.jsonImportSelectAll(true)">' + t('backup.selectAll') + '</button> / ' +
        '<button class="backup-link-btn" onclick="window._launcher.jsonImportSelectAll(false)">' + t('backup.selectNone') + '</button>' +
      '</div></div>' +
      '<table class="backup-table"><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i].app;
      html +=
        '<tr>' +
          '<td><input type="checkbox" class="json-import-cb" data-i="' + i + '"' + (rows[i].isDup ? '' : ' checked') + '/></td>' +
          '<td>' + escapeHtml(a.name || a.publishedFilename || 'Untitled') +
            (a.publishedFilename ? '<div class="mono-cell">' + escapeHtml(a.publishedFilename) + '</div>' : '') + '</td>' +
          '<td>' + sourceLabel(a.source) + '</td>' +
          '<td>' + (rows[i].isDup
            ? '<span class="backup-status-badge backup-status-exists">' + t('jsonImport.statusDup') + '</span>'
            : '<span class="backup-status-badge backup-status-new">' + t('backup.statusNew') + '</span>') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    if (jsonImportState.backup.config && typeof jsonImportState.backup.config === 'object') {
      html += '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:.85rem">' +
        '<input type="checkbox" id="json-import-config"/> ' + t('jsonImport.config') + '</label>';
    }
    body.innerHTML = html;
    document.getElementById('json-import-status').textContent = '';
    document.getElementById('json-import-btn').style.display = '';
    document.getElementById('json-import-overlay').hidden = false;
  }

  function jsonImportSelectAll(checked) {
    document.querySelectorAll('.json-import-cb').forEach(function (b) { b.checked = checked; });
  }

  function submitJsonImport() {
    var statusEl = document.getElementById('json-import-status');
    var selected = [];
    document.querySelectorAll('.json-import-cb').forEach(function (b) {
      if (b.checked) selected.push(jsonImportState.rows[parseInt(b.getAttribute('data-i'), 10)].app);
    });
    var configCb = document.getElementById('json-import-config');
    var importConfig = !!(configCb && configCb.checked);
    if (selected.length === 0 && !importConfig) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = t('backup.nothingSelected');
      return;
    }
    if (importConfig) {
      var merged = Object.assign({}, loadConfig(), jsonImportState.backup.config);
      saveConfig(merged);
      applyTheme(merged.theme);
    }
    Promise.all(selected.map(function (a) {
      var app = Object.assign({}, a);
      app.id = generateId(); // new id — the source backup may collide with existing ids
      return saveApp(app);
    })).then(function () {
      statusEl.style.color = '#34d399';
      statusEl.textContent = '✔ ' + t('jsonImport.done') + ': ' + selected.length;
      document.getElementById('json-import-btn').style.display = 'none';
      renderApps();
      loadPublishedApps();
    });
  }

  // ── Remove duplicate apps (cleanup after legacy blind imports) ──

  function removeDuplicateApps() {
    getAllApps().then(async function (apps) {
      var groups = {};
      apps.forEach(function (a) {
        var k = localAppKey(a);
        (groups[k] = groups[k] || []).push(a);
      });
      var toDelete = [];
      Object.keys(groups).forEach(function (k) {
        var g = groups[k];
        if (g.length < 2) return;
        // Keep the best copy: favorites first, then the earliest added
        g.sort(function (x, y) {
          if (!!y.favorite !== !!x.favorite) return (y.favorite ? 1 : 0) - (x.favorite ? 1 : 0);
          return (x.addedAt || '') < (y.addedAt || '') ? -1 : 1;
        });
        toDelete = toDelete.concat(g.slice(1));
      });
      if (toDelete.length === 0) { showNotice(t('dedup.none')); return; }
      if (!(await showConfirm(t('dedup.confirm') + ' ' + toDelete.length))) return;
      Promise.all(toDelete.map(function (a) { return deleteApp(a.id); })).then(function () {
        renderApps();
        loadPublishedApps();
        showNotice(t('dedup.done') + ': ' + toDelete.length);
      });
    });
  }

  // ── Clear All Data ──────────────────────────────

  async function clearAllData() {
    if (!(await showConfirm(t('confirm.clearAll1')))) return;
    if (!(await showConfirm(t('confirm.clearAll2')))) return;

    openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).then(function () {
      localStorage.removeItem('appLauncherConfig');
      applyTheme('dark');
      renderApps();
      document.getElementById('settings-overlay').hidden = true;
      showNotice('All data cleared');
    });
  }

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
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].id === detailAppId) return allApps[i];
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
    var svrState = (app.publishedFilename && serverStateByFilename[app.publishedFilename]) || null;
    if (!(app.published && app.publishedFilename && svrState && !isUrlApp)) return '';
    var fnArg = jsArg(app.publishedFilename);
    var ownerArg2 = jsArg(svrState.owner || '');
    var p = svrState.protection || {};
    var anyProt = p.obfuscate || p.domainLock || p.watermark || p.noRawDownload;
    return '<div class="dtl-section">' +
        '<h3>' + t('detail.serverMgmt') + '</h3>' +
        '<div class="dtl-btn-row">' +
          (svrState.parked
            ? '<button class="dtl-btn" onclick="window._launcher.toggleParkApp(\'' + fnArg + '\', false)" title="' + escapeHtml(t('card.unparkHint')) + '">' + t('card.unpark') + '</button>'
            : '<button class="dtl-btn" onclick="window._launcher.toggleParkApp(\'' + fnArg + '\', true)" title="' + escapeHtml(t('card.parkHint')) + '">' + t('card.park') + '</button>') +
          '<button class="dtl-btn" onclick="window._launcher.toggleForkApp(\'' + fnArg + '\', ' + (svrState.forkable ? 'false' : 'true') + ')" title="' + escapeHtml(t(svrState.forkable ? 'card.forkableOnHint' : 'card.forkableOffHint')) + '">' + t(svrState.forkable ? 'card.forkableOn' : 'card.forkableOff') + '</button>' +
          '<button class="dtl-btn" onclick="window._launcher.showProtectionModal(\'' + fnArg + '\')" title="' + escapeHtml(t('card.protectHint')) + '">' + (anyProt ? '🛡✓ ' + t('card.protect') : t('card.protect')) + '</button>' +
          '<button class="dtl-btn" onclick="window._launcher.showVersionsModal(\'' + ownerArg2 + '\', \'' + fnArg + '\')">' + t('card.versions') + '</button>' +
          '<button class="dtl-btn danger" onclick="window._launcher.deleteServerApp(\'' + fnArg + '\')">' + t('card.removeServer') + '</button>' +
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
        var st = serverStateByFilename[app.publishedFilename] || {};
        var owner = st.owner || currentOwnerName() || '';
        url = base + '/v1/apps/' + encodeURIComponent(owner) + '/' + encodeURIComponent(app.publishedFilename);
      }
      viewPublished(url + '?mode=inline', app.name);
    } else {
      launchApp(app.id, app.openMode || 'tab');
    }
  }

  function currentOwnerName() {
    try {
      if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.getSession()) {
        return window.AIMEAT.auth.getSession().owner || null;
      }
      var stored = localStorage.getItem('aimeat_session');
      if (stored) return JSON.parse(stored).owner || null;
    } catch (e) {}
    return null;
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
    var aboutHeader =
      '<h3 style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<span>' + t('detail.about') + '</span>' +
        ((canEditAbout && !detailEditingAbout) ? '<button class="dtl-btn" onclick="window._launcher.detailAboutEdit()">' + t('detail.editDetails') + '</button>' : '') +
      '</h3>';
    var aboutBody;
    if (detailEditingAbout) {
      aboutBody =
        '<label class="dtl-stat-label" for="detail-name-input">' + t('detail.nameLabel') + '</label>' +
        '<input id="detail-name-input" class="modal-input" maxlength="120" value="' + escapeHtml(app.name || '') + '" style="margin:4px 0 10px" />' +
        '<label class="dtl-stat-label" for="detail-desc-input">' + t('detail.descLabel') + '</label>' +
        '<textarea id="detail-desc-input" class="modal-input" rows="3" maxlength="2000" style="margin:4px 0 8px;resize:vertical">' + escapeHtml(app.description || '') + '</textarea>' +
        '<div class="dtl-sync none" style="margin:0 0 10px">' + t('detail.renameHint') + '</div>' +
        '<div class="dtl-btn-row">' +
          '<button class="dtl-btn primary" onclick="window._launcher.detailAboutSave()">' + t('detail.saveDetails') + '</button>' +
          '<button class="dtl-btn" onclick="window._launcher.detailAboutCancel()">' + t('detail.cancelEdit') + '</button>' +
        '</div>';
    } else {
      aboutBody =
        (app.description ? '<p class="dtl-desc">' + escapeHtml(app.description) + '</p>' : '') +
        '<div class="dtl-meta-grid">' +
          metaItem(t('detail.category'), app.category || 'utility') +
          metaItem(t('detail.tags'), tags) +
          metaItem(t('detail.sourceLabel'), sourceLabelText(app.source)) +
          metaItem(t('detail.openModeLabel'), app.openMode || 'tab') +
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
          '<button class="dtl-btn primary" id="detail-ai-run" onclick="window._launcher.detailAiRun()"' + (detailAiAvailable ? '' : ' disabled') + '>' + t('detail.run') + '</button>' +
        '</div>' +
        '<div class="dtl-ai-status" id="detail-ai-status">' + (detailAiAvailable ? '' : escapeHtml(detailAiUnavailableMsg())) + '</div>' +
        '<div class="dtl-ai-draft" id="detail-ai-draft"' + (detailDraftBlob ? '' : ' hidden') + '>' +
          '<div class="dtl-ai-status" style="margin:0 0 8px">' + t('detail.draftReady') + '</div>' +
          '<div class="dtl-btn-row">' +
            '<button class="dtl-btn" onclick="window._launcher.detailAiTest()">' + t('detail.test') + '</button>' +
            '<button class="dtl-btn success" onclick="window._launcher.detailAiKeep()">' + t('detail.keep') + '</button>' +
            '<button class="dtl-btn" onclick="window._launcher.detailAiDiscard()">' + t('detail.discard') + '</button>' +
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
          (isUrlApp ? '' : '<button class="dtl-btn" onclick="window._launcher.detailEditSource()">' + t('ctx.viewSource') + '</button>') +
          (isUrlApp ? '' : '<button class="dtl-btn" onclick="window._launcher.detailImproveExternal()">' + t('ctx.improveAi') + '</button>') +
          '<button class="dtl-btn" onclick="window._launcher.detailSharePrompt()">' + t('ctx.sharePrompt') + '</button>' +
          (isUrlApp ? '' : '<button class="dtl-btn primary" onclick="window._launcher.detailPublish()">' + escapeHtml(publishLabel) + '</button>') +
          (app.published && !isUrlApp ? '<button class="dtl-btn" onclick="window._launcher.detailSetScreenshot()" title="Upload a custom thumbnail for this app">📷 ' + t('detail.setScreenshot') + '</button>' : '') +
          (app.published && !isUrlApp ? '<button class="dtl-btn" onclick="window._launcher.detailRefreshScreenshot()" title="Clear the screenshot; the node re-takes it on its next scheduled run">🔄 ' + t('detail.refreshScreenshot') + '</button>' : '') +
          '<button class="dtl-btn danger" onclick="window._launcher.detailDelete()">' + t('ctx.delete') + '</button>' +
        '</div>' +
      '</div>';

    // ── SERVER MANAGEMENT (own published/parked apps) ──
    // Park/Unpark, fork permission, copy-protection, versions and remove-from-server used to
    // live on the published card; the unified card now shows only Open + Details, so these move
    // here (req: "card buttons 2-3, the rest in detail"). serverStateByFilename is populated by
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

  function detailAboutSave() {
    var app = detailGetApp();
    if (!app) return;
    var nameEl = document.getElementById('detail-name-input');
    var descEl = document.getElementById('detail-desc-input');
    var newName = nameEl ? nameEl.value.trim() : '';
    var newDesc = descEl ? descEl.value.trim() : '';
    if (!newName) { showNotice(t('detail.nameRequired') || 'Name cannot be empty.'); if (nameEl) nameEl.focus(); return; }
    if (app.published && !newDesc) { showNotice(t('detail.descRequired') || 'Description cannot be empty.'); if (descEl) descEl.focus(); return; }

    function finishLocal() {
      app.name = newName;
      app.description = newDesc;
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
          serverAppManifests[key] = serverAppManifests[key] || {};
          serverAppManifests[key].name = newName;
          serverAppManifests[key].description = newDesc;
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
                '<button class="dtl-btn" onclick="window._launcher.viewPublished(\'' + escapeHtml(viewU) + '\', \'' + jsArg(filename) + '\')">' + t('card.view') + '</button>' +
                (isLatest ? '' : '<button class="dtl-btn" onclick="window._launcher.restoreVersion(' + ownerArg + ', ' + fileArg + ', ' + v.version_number + ')">' + t('card.restore') + '</button>') +
                '<button class="dtl-btn" onclick="window._launcher.forkVersion(' + ownerArg + ', ' + fileArg + ', ' + v.version_number + ')">' + t('card.fork') + '</button>' +
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
    currentIframeUrl = '';
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
    for (var i = 0; i < allApps.length; i++) {
      if (allApps[i].publishedFilename === filename) { openDetailView(allApps[i].id); return; }
    }
    var config = loadConfig();
    if (!config.aimeatUrl) { showNotice('Set the AIMEAT server URL in Settings first'); return; }
    var aimeatUrl = config.aimeatUrl.replace(/\/+$/, '');
    var meta = serverAppManifests[owner + '\n' + filename] || {};

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
          allApps.push(app);
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
  // filename -> current protection object, populated as own cards render (avoids
  // escaping a JSON object through an inline onclick).
  var ownAppProtection = {};
  var protectionTarget = null;
  function showProtectionModal(filename) {
    protectionTarget = { filename: filename };
    var p = ownAppProtection[filename] || {};
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

    var meta = serverAppManifests[owner + '\n' + filename] || {};
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

    overlay.style.display = 'flex';
    desc.focus();
    updatePbPreview();
  }

  function closePbPanel() {
    document.getElementById('prompt-builder-overlay').style.display = 'none';
    pbSourceApp = null;
  }

  // Booster-kit: populate the "Start from a template" picker from /v1/app-templates and, on
  // selection, fetch that template's content into window.pbTemplate (injected by buildPromptFromBuilder).
  function loadPbTemplates() {
    var sel = document.getElementById('pb-template');
    if (!sel) return;
    var config = loadConfig();
    if (!config.aimeatUrl) return;
    var base = config.aimeatUrl.replace(/\/+$/, '');
    fetch(base + '/v1/app-templates?lang=' + encodeURIComponent(currentLang))
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
    var pbLang = PB_LANGS[currentLang] || 'English';
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

    // Build instructions — framed as Step 2 for new apps.
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
    prompt += 'Social & economy:\n';
    prompt += '- aimeat-social.js — boards, posts, reactions (`AIMEAT.social`)\n';
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
    currentLang = (_urlLang === 'fi' || _urlLang === 'en')
      ? _urlLang
      : ((loadConfig().language === 'fi') ? 'fi' : 'en');
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


