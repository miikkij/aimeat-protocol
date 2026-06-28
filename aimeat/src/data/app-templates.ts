/**
 * @file app-templates.ts
 * @description Authoring-template registry — the "booster kit" data. Curated starting points
 *   the app-prompt builders (app-catalog + landing) inject so the AI copies from a model instead
 *   of building from scratch. Templates are DATA: adding one is a new entry here (+ its content),
 *   no code change. Served as JSON at GET /v1/app-templates and consumed by both prompt surfaces.
 *
 *   kinds (layered — see docs/internal/authoring-templates/):
 *     - app-shell  : a full app skeleton (boot + auth + layout + theme). Tiers T1/T2/T3.
 *     - component  : a reusable block + its lib deps (future).
 *     - use-case   : composes an app-shell + components (+ optional package) (future).
 * @structure AppTemplate · getAppTemplates() · getAppTemplateIndex()
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial registry + first app-shell (T1 pure-client).
 *   v1.1.0 — 2026-06-26 — app-shells T2 (cortex) + T3 (extension).
 *   v1.2.0 — 2026-06-26 — component library (auth-gated, private-store, shared-feed, ai-action, data-table, settings, dated-archive).
 *   v1.3.0 — 2026-06-26 — components: image-upload, realtime-room, search, list+detail (for marketplace / realtime-social / homepage use-cases).
 *   v1.4.0 — 2026-06-26 — use-case templates (full working scaffolds) + composes field; first: realtime-social.
 *   v1.5.0 — 2026-06-26 — use-case: marketplace (anon browse + search + detail + post with image); fix image-upload URL.
 *   v1.6.0 — 2026-06-26 — component: markdown (AIMEAT.md.render); use-case: homepage (personal site — profile + markdown blog + images + AI stories).
 *   v1.7.0 — 2026-06-26 — plain-language app-shell titles (drop T1/T2/T3 jargon): "Standard app",
 *     "Data app", "Connected app" — what a non-technical user gets, not the architecture.
 */

export interface AppTemplate {
  /** Stable id, e.g. "shell-pure-client". */
  id: string;
  kind: 'app-shell' | 'component' | 'use-case';
  /** Capability tier for app-shells: T1 pure client · T2 +cortex · T3 +extension. */
  tier?: 'T1' | 'T2' | 'T3';
  title: string;
  /** One line shown in the picker and in the prompt index. */
  description: string;
  /** Client libs the template loads (for the AI's awareness). */
  libs: string[];
  /** For use-cases: the component/shell ids this scaffold builds on (for the index + matching). */
  composes?: string[];
  /** The model the AI copies from — a skeleton, not a finished app. */
  content: string;
}

// ── T1 pure-client app shell ─────────────────────────────────────────
// Boot (auth + data), self-hosted Tailwind + daisyUI + theme bridge, a navbar with the login
// pill, a single content area, light/dark via data-theme, and private/shared data helpers with
// loading + error handling. Slots are marked {{LIKE_THIS}} for the AI to fill.

const SHELL_PURE_CLIENT = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <!-- Self-hosted Tailwind v4 + daisyUI 5 + theme bridge (served by the node, not a CDN) -->
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>

  <main id="app" class="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <!-- {{BUILD YOUR VIEWS HERE — cards/sections using daisyUI classes (card, btn-primary, input…)}} -->
  </main>

  <footer class="footer footer-center p-3 text-xs opacity-50">{{footer text}}</footer>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script>
    var session = null;
    function setStatus(msg, cls) { var e = document.getElementById('status'); e.className = 'alert ' + (cls || ''); e.textContent = msg; }

    // PRIVATE data (only the logged-in owner can read it):
    //   await AIMEAT.data.set('{{app-name}}.key', value, { visibility: 'private' });
    //   var mine = await AIMEAT.data.get('{{app-name}}.key');
    // SHARED/community data (everyone reads; each user writes their own key):
    //   await AIMEAT.data.set('{{app-name}}.shared.' + id, entry, { visibility: 'public' });
    //   var theirs = await AIMEAT.data.getPublic(ownerGaii, '{{app-name}}.shared.' + id);
    // Always read back after a write to confirm it persisted; show loading + error states.

    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      // {{LOAD DATA + RENDER YOUR VIEWS — handle empty/loading/error states}}
    }

    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', {
      onLogin: function () { tryBoot(); },
      onLogout: function () { booted = false; setStatus('Log in to continue.', 'alert-warning'); }
    });
    // App origin: the silent/grant login resolves async and may not call onLogin — poll getSession.
    var _iv = setInterval(function () { tryBoot(); if (booted) clearInterval(_iv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;

// ── T2 client + cortex UI libs ───────────────────────────────────────
// T1 base, plus the node's bundled cortex UI libraries (data tables, forms, layouts) for
// richer, structured UIs without hand-rolling components.

const SHELL_CORTEX = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main id="app" class="flex-1 w-full max-w-4xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <div id="view"></div>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <!-- Bundled cortex UI libraries (node-level — available on every AIMEAT node). Load only what you use. -->
  <script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
  <script src="/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
  <!-- Also available: aimeat-ui-layout, aimeat-ui-nav, aimeat-ui-dialogs, aimeat-charts, aimeat-canvas -->
  <script>
    var session = null;
    function setStatus(m, c) { var e = document.getElementById('status'); e.className = 'alert ' + (c || ''); e.textContent = m; }
    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      // Example — render structured data with the viewers cortex (replace with your data):
      //   AIMEAT.ui.viewers.DataTable({ target: document.getElementById('view'),
      //     columns: [{key:'name',label:'Name'}], rows: [{name:'…'}], sortable:true, filterable:true });
      // Forms via AIMEAT.ui.forms.FormGroup({ target, fields:[…], onSubmit }).
      // {{BUILD YOUR VIEWS — load data from AIMEAT.data, render with the cortex libs}}
    }
    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', { onLogin: function () { tryBoot(); }, onLogout: function () { booted = false; setStatus('Log in to continue.', 'alert-warning'); } });
    var _iv = setInterval(function () { tryBoot(); if (booted) clearInterval(_iv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;

// ── T3 client + server extension ─────────────────────────────────────
// For apps that need SERVER-SIDE work (fetch an external API, scheduled jobs). The app is the
// client; a sandboxed extension does the server work and the app calls its actions. Build the
// extension separately (Profile → Cortex/Extensions → Create with AI) or ship it in a package.

const SHELL_EXTENSION = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main id="app" class="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <div id="status" class="alert">Loading…</div>
    <div id="view"></div>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script>
    // SERVER-SIDE work lives in an extension. Build "{{extension-name}}" with actions like
    // "{{action}}" (it does the external fetch / cron and writes to memory), then call it here.
    // The extension enforces auth + does CORS-free server-to-server fetches the browser can't.
    var EXT = '/v1/ext/{{extension-name}}';
    var session = null;
    function setStatus(m, c) { var e = document.getElementById('status'); e.className = 'alert ' + (c || ''); e.textContent = m; }
    function callExt(action, body) {
      return session.fetch(EXT + '/' + action, { method: 'POST', body: JSON.stringify(body || {}) });
    }
    function boot(s) {
      session = s;
      setStatus('Ready.', 'alert-success');
      // Example: var r = await callExt('{{action}}', { /* input */ }); render(r.data);
      // {{CALL YOUR EXTENSION ACTIONS + RENDER — handle loading/empty/error}}
    }
    var booted = false;
    function tryBoot() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; boot(s); } }
    AIMEAT.auth.mountLoginButton('#login', { onLogin: function () { tryBoot(); }, onLogout: function () { booted = false; setStatus('Log in to continue.', 'alert-warning'); } });
    var _iv = setInterval(function () { tryBoot(); if (booted) clearInterval(_iv); }, 300);
    tryBoot();
  </script>
</body>
</html>`;

// ── Component templates ──────────────────────────────────────────────
// Reusable blocks (snippets + their lib deps) the AI drops into an app-shell. Not full pages —
// patterns to copy. {{app}} = the app's memory namespace.

const COMP_AUTH_GATED = `// auth-gated section — show content only to logged-in users (aimeat-auth).
var gate = document.getElementById('members-only');
function applyAuth(s) { if (gate) gate.style.display = (s && s.jwt) ? '' : 'none'; }
AIMEAT.auth.mountLoginButton('#login', {
  onLogin: function () { applyAuth(AIMEAT.auth.getSession()); },
  onLogout: function () { applyAuth(null); }
});
applyAuth(AIMEAT.auth.getSession());`;

const COMP_PRIVATE_STORE = `// private-store — a per-owner private collection (aimeat-data). Only the owner can read it.
async function listItems() { return (await AIMEAT.data.get('{{app}}.items')) || []; }
async function addItem(item) {
  var items = await listItems();
  items.push(Object.assign({ id: Date.now() + '', createdAt: new Date().toISOString() }, item));
  await AIMEAT.data.set('{{app}}.items', items, { visibility: 'private' });
  return items;
}
async function removeItem(id) {
  var items = (await listItems()).filter(function (x) { return x.id !== id; });
  await AIMEAT.data.set('{{app}}.items', items, { visibility: 'private' });
  return items;
}`;

const COMP_SHARED_FEED = `// shared-feed — a public community feed (aimeat-data). Each user writes their OWN key; everyone reads.
async function post(text) {
  var id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  await AIMEAT.data.set('{{app}}.feed.' + id,
    { id: id, text: text, by: AIMEAT.auth.getSession().owner, at: new Date().toISOString() },
    { visibility: 'public' });
}
async function loadFeed() {
  var results = await AIMEAT.data.search('{{app}}.feed.'); // public entries across all users
  return results.sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
}`;

const COMP_AI_ACTION = `// ai-action — run the user's own LLM on demand (aimeat-ai; load it + aimeat-auth).
async function aiSuggest(promptText, outEl) {
  if (!(await AIMEAT.ai.isAvailable())) { outEl.value = 'Log in and add an OpenRouter key to enable AI.'; return; }
  try { var r = await AIMEAT.ai.complete({ app_id: '{{app}}', prompt: promptText, max_tokens: 200 }); outEl.value = r.content; }
  catch (e) { outEl.value = 'AI error: ' + (e.message || e); }
}
// Render into an EDITABLE field so the user reviews before saving. Gate the button on isAvailable().`;

const COMP_DATA_TABLE = `// data-table — sortable / filterable / paginated table (aimeat-ui-viewers cortex).
// Load: <script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
AIMEAT.ui.viewers.DataTable({
  target: document.getElementById('table'),
  sortable: true, filterable: true, pageSize: 10,
  columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }],
  rows: yourRows // [{ name: '…', value: … }]
});`;

const COMP_SETTINGS = `// settings-panel — read/write the app's settings (aimeat-data).
async function getSettings() { return (await AIMEAT.data.get('{{app}}.settings')) || { /* defaults */ }; }
async function saveSettings(patch) {
  var s = Object.assign(await getSettings(), patch);
  await AIMEAT.data.set('{{app}}.settings', s, { visibility: 'private' });
  return s;
}
// Bind toggles/selects to saveSettings({ key: value }); re-read on load to populate the form.`;

const COMP_DATED_ARCHIVE = `// dated-archive — show entries by date, newest first (aimeat-data). Keys like {{app}}.YYYY-MM-DD.*
async function loadArchive() {
  var entries = await AIMEAT.data.search('{{app}}.'); // matching entries
  var byDay = {};
  entries.forEach(function (e) { var d = (e.date || (e.key || '').split('.')[1] || ''); (byDay[d] = byDay[d] || []).push(e); });
  return Object.keys(byDay).sort().reverse().map(function (d) { return { date: d, items: byDay[d] }; });
}`;

const COMP_IMAGE_UPLOAD = `// image-upload — upload an image and get an anon-visible URL (aimeat-storage + aimeat-auth).
// Load: <script src="/v1/libs/aimeat-storage.js"></script>
async function uploadImage(file) {
  var up = await AIMEAT.storage.upload(file, { visibility: 'public' });   // -> { key, ... }
  var ghii = AIMEAT.auth.getSession().ghii;                               // owner@node-id
  return '/v1/pub/' + encodeURIComponent(ghii) + '/' + encodeURIComponent(up.key); // public files load for anon
}
// <input type="file" accept="image/*" onchange="uploadImage(this.files[0]).then(setImageUrl)">`;

const COMP_REALTIME_ROOM = `// realtime-room — live presence + messages over a shared room (no backend to run).
async function joinRoom(name, onMessage) {
  var room = (await session.fetch('/v1/realtime/rooms', { method: 'POST', body: JSON.stringify({ name: name }) })).data; // { id, ws_url }
  var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + room.ws_url);
  ws.onmessage = function (e) { onMessage(JSON.parse(e.data)); };
  return { send: function (msg) { ws.send(JSON.stringify(msg)); }, ws: ws };
}
// var room = await joinRoom('lobby', function (m) { /* render presence / messages */ });
// room.send({ type: 'chat', text: '…' });   // for low-latency P2P use AimeatRealtime (/lib/realtime.js)`;

const COMP_SEARCH = `// search — instant client-side filter, or server-side memory search.
function filterItems(items, q) {
  q = (q || '').toLowerCase().trim();
  if (!q) return items;
  return items.filter(function (it) { return JSON.stringify(it).toLowerCase().indexOf(q) !== -1; });
}
// Bind: input.addEventListener('input', function () { render(filterItems(all, input.value)); });
// Server-side across stored entries (aimeat-data): var hits = await AIMEAT.data.search('{{app}}.' + query);`;

const COMP_LIST_DETAIL = `// list+detail — master/detail: a list on the left, the selected item's detail on the right.
function renderListDetail(target, items, rowLabel, renderDetail) {
  target.innerHTML = '<div class="flex gap-4"><div id="ld-list" class="w-1/3 flex flex-col gap-1"></div><div id="ld-detail" class="flex-1"></div></div>';
  var listEl = target.querySelector('#ld-list'), detailEl = target.querySelector('#ld-detail');
  items.forEach(function (it) {
    var row = document.createElement('button');
    row.className = 'btn-ghost text-left px-3 py-2 rounded';
    row.textContent = rowLabel(it);
    row.onclick = function () { detailEl.innerHTML = ''; detailEl.appendChild(renderDetail(it)); };
    listEl.appendChild(row);
  });
}
// Or use the cortex: AIMEAT.ui.layout.MainDetail({ target, list, detail }).`;

// ── Use-case: realtime-social (full working scaffold) ────────────────
// A live room: logged-in users join the realtime room for live presence + chat, with durable
// history persisted to public memory (loaded after login; anon sees the login prompt). Composes
// realtime-room + shared-feed + auth-gated. Models the proven Presence Board pattern.
// {{app}} = memory namespace; customise the {{SLOTS}}.

const USECASE_REALTIME_SOCIAL = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>

  <main id="app" class="flex-1 w-full max-w-2xl mx-auto p-4 flex flex-col gap-4">
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-sm opacity-70">Online:</span>
      <span id="presence" class="flex gap-1 flex-wrap"></span>
    </div>
    <div id="feed" class="flex-1 flex flex-col gap-2 overflow-y-auto" style="min-height:50vh"></div>
    <form id="composer" class="join w-full" hidden>
      <input id="msg" class="input input-bordered join-item flex-1" placeholder="Say something…" autocomplete="off" />
      <button class="btn-primary join-item px-6" type="submit">Send</button>
    </form>
    <div id="login-hint" class="alert">Log in to join the live room and post.</div>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script>
    // Realtime protocol (server-defined): connect ws with ?room=&token=&nick=, send { type:'chat',
    // payload }, receive { type:'chat', sender, payload } broadcast to all (incl. sender). Presence
    // via { type:'joined', peers:[{nick}] } + { type:'participant', action:'join'|'leave', name }.
    var FEED_KEY = '{{app}}.feed.';     // durable history (loaded after login — memory search needs auth)
    var ROOM = '{{app}}-lobby';
    var session = null, ws = null, me = null;
    var online = {};                    // name -> true
    var feedEl = document.getElementById('feed');
    var presEl = document.getElementById('presence');

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function addMessage(by, text) {
      var row = document.createElement('div');
      row.className = 'chat ' + (by === me ? 'chat-end' : 'chat-start');
      row.innerHTML = '<div class="chat-header text-xs opacity-60">' + esc(by) + '</div>' +
        '<div class="chat-bubble">' + esc(text) + '</div>';
      feedEl.appendChild(row);
      feedEl.scrollTop = feedEl.scrollHeight;
    }
    function renderPresence() {
      var names = Object.keys(online);
      presEl.innerHTML = names.length ? names.map(function (n) { return '<span class="badge badge-success badge-sm">' + esc(n) + '</span>'; }).join('') : '<span class="opacity-50 text-sm">—</span>';
    }

    async function loadHistory() {
      try {
        var hits = await AIMEAT.data.search(FEED_KEY);   // search needs auth -> history loads after login
        hits.sort(function (a, b) { return (a.at || '').localeCompare(b.at || ''); });
        feedEl.innerHTML = '';
        hits.forEach(function (m) { addMessage(m.by, m.text); });
      } catch (e) { /* empty feed is fine */ }
    }

    async function joinLive(s) {
      session = s; me = s.owner;
      document.getElementById('login-hint').style.display = 'none';
      document.getElementById('composer').hidden = false;
      loadHistory();   // durable history (needs auth)
      var room = (await session.fetch('/v1/realtime/rooms', { method: 'POST', body: JSON.stringify({ name: ROOM }) })).data;
      // ws_url already has ?room=ID; the WebSocket can't set headers, so pass the JWT + nick as query.
      var wsUrl = location.origin.replace(/^http/, 'ws') + room.ws_url + '&token=' + encodeURIComponent(s.jwt) + '&nick=' + encodeURIComponent(me);
      ws = new WebSocket(wsUrl);
      ws.onmessage = function (e) {
        var d = JSON.parse(e.data);
        if (d.type === 'joined') { (d.peers || []).forEach(function (p) { online[p.nick] = true; }); online[me] = true; renderPresence(); }
        else if (d.type === 'participant') { if (d.action === 'join') online[d.name] = true; else if (d.action === 'leave') delete online[d.name]; renderPresence(); }
        else if (d.type === 'chat') { addMessage(d.sender, d.payload); }   // server echoes to all incl. sender
      };
      ws.onclose = function () { online = {}; renderPresence(); };
    }

    document.getElementById('composer').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = document.getElementById('msg'), text = input.value.trim();
      if (!text || !ws || ws.readyState !== 1) return;
      input.value = '';
      ws.send(JSON.stringify({ type: 'chat', payload: text }));   // live — server echoes back, then we render
      var id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      AIMEAT.data.set(FEED_KEY + id, { by: me, text: text, at: new Date().toISOString() }, { visibility: 'public' });  // durable
    });

    AIMEAT.auth.mountLoginButton('#login', {
      onLogin: function () { joinLive(AIMEAT.auth.getSession()); },
      onLogout: function () { location.reload(); }
    });
    var s0 = AIMEAT.auth.getSession && AIMEAT.auth.getSession();
    if (s0 && s0.jwt) joinLive(s0);   // history + live load after login (anon sees the login prompt)
  </script>
</body>
</html>`;

// ── Use-case: marketplace — single-seller storefront (full working scaffold) ─────────────────
// Anyone browses + searches the seller's public listings and opens a detail view; the SELLER
// (OWNER) posts listings with an uploaded image. All listings live in ONE public key
// ({{app}}.listings) under the owner's GHII, so anon can read them via getPublic (the only
// anon-accessible memory read — there is no anon search). For a MULTI-seller marketplace use a
// server extension for the shared store. Composes list+detail + image-upload + search +
// auth-gated. Models the Sales-Board / owner-curated storefront. {{app}} = memory namespace.

const USECASE_MARKETPLACE = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50 gap-2">
    <div class="flex-1 min-w-0"><span class="text-lg font-bold">{{App Title}}</span></div>
    <input id="search" class="input input-bordered input-sm w-40 sm:w-64" placeholder="Search…" />
    <button id="post-btn" class="btn-primary px-4" hidden>+ Post</button>
    <span id="login"></span>
  </nav>

  <main class="flex-1 w-full max-w-5xl mx-auto p-4">
    <div id="status" class="alert mb-4" hidden></div>
    <div id="grid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div>
    <div id="empty" class="text-center opacity-60 py-16" hidden>No listings yet.</div>
  </main>

  <!-- Detail overlay -->
  <div id="detail" class="fixed inset-0 bg-black/60 z-50 hidden items-center justify-center p-4" style="display:none">
    <div class="card bg-base-200 max-w-lg w-full max-h-[90vh] overflow-y-auto">
      <div id="detail-body" class="card-body"></div>
    </div>
  </div>

  <!-- Post overlay (logged-in) -->
  <div id="post" class="fixed inset-0 bg-black/60 z-50 hidden items-center justify-center p-4" style="display:none">
    <form id="post-form" class="card bg-base-200 max-w-md w-full">
      <div class="card-body gap-3">
        <h3 class="text-lg font-bold">Post a listing</h3>
        <input id="f-title" class="input input-bordered" placeholder="Title" required />
        <input id="f-price" class="input input-bordered" placeholder="Price (e.g. 20 €)" />
        <textarea id="f-desc" class="textarea textarea-bordered" placeholder="Description" rows="3"></textarea>
        <input id="f-image" type="file" accept="image/*" class="file-input file-input-bordered" />
        <div class="flex gap-2 justify-end">
          <button type="button" id="post-cancel" class="btn-ghost px-4">Cancel</button>
          <button type="submit" id="post-submit" class="btn-primary px-6">Publish</button>
        </div>
      </div>
    </form>
  </div>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-storage.js"></script>
  <script>
    var OWNER = '{{owner-ghii}}';        // the seller's GHII (owner@node-id) — anyone reads listings from here
    var LISTINGS_KEY = '{{app}}.listings';
    var session = null, all = [];
    var gridEl = document.getElementById('grid'), emptyEl = document.getElementById('empty');

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function filtered() {
      var q = document.getElementById('search').value.toLowerCase().trim();
      if (!q) return all;
      return all.filter(function (it) { return ((it.title || '') + ' ' + (it.desc || '')).toLowerCase().indexOf(q) !== -1; });
    }
    function render() {
      var items = filtered();
      emptyEl.hidden = items.length > 0;
      gridEl.innerHTML = '';
      items.forEach(function (it) {
        var card = document.createElement('div');
        card.className = 'card bg-base-200 shadow cursor-pointer hover:ring-2 hover:ring-primary transition';
        card.innerHTML =
          (it.imageUrl ? '<figure class="aspect-square overflow-hidden"><img src="' + esc(it.imageUrl) + '" class="w-full h-full object-cover" /></figure>'
                       : '<figure class="aspect-square bg-base-300 flex items-center justify-center text-4xl opacity-40">🖼️</figure>') +
          '<div class="card-body p-3 gap-1"><h3 class="font-semibold text-sm truncate">' + esc(it.title) + '</h3>' +
          '<div class="text-primary font-bold text-sm">' + esc(it.price || '') + '</div></div>';
        card.onclick = function () { openDetail(it); };
        gridEl.appendChild(card);
      });
    }
    function openDetail(it) {
      document.getElementById('detail-body').innerHTML =
        (it.imageUrl ? '<img src="' + esc(it.imageUrl) + '" class="rounded-lg w-full object-contain max-h-80 mb-3" />' : '') +
        '<h2 class="text-xl font-bold">' + esc(it.title) + '</h2>' +
        '<div class="text-primary font-bold text-lg my-1">' + esc(it.price || '') + '</div>' +
        '<p class="whitespace-pre-wrap opacity-90">' + esc(it.desc || '') + '</p>' +
        '<div class="text-xs opacity-60 mt-3">Seller: ' + esc(it.by || '') + '</div>' +
        '<div class="text-right mt-4"><button class="btn-ghost px-4" onclick="closeDetail()">Close</button></div>';
      show('detail');
    }
    window.closeDetail = function () { hide('detail'); };
    function show(id) { var e = document.getElementById(id); e.style.display = 'flex'; }
    function hide(id) { var e = document.getElementById(id); e.style.display = 'none'; }

    async function load() {
      try {
        var arr = await AIMEAT.data.getPublic(OWNER, LISTINGS_KEY);   // anon-readable single public key
        all = Array.isArray(arr) ? arr.slice() : [];
        all.sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
      } catch (e) { all = []; }
      render();
    }
    document.getElementById('search').addEventListener('input', render);

    // ── posting (only the seller = OWNER can post; writes go to OWNER's own public key) ──
    function maybeEnablePosting(s) {
      session = s;
      if (OWNER.indexOf('{{') === 0 && s.ghii) OWNER = s.ghii;   // owner-preview convenience before the GHII is baked in
      if (s.ghii === OWNER) document.getElementById('post-btn').hidden = false;
    }
    document.getElementById('post-btn').onclick = function () { show('post'); };
    document.getElementById('post-cancel').onclick = function () { hide('post'); };
    document.getElementById('post-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var btn = document.getElementById('post-submit'); btn.disabled = true; btn.textContent = 'Publishing…';
      try {
        var imageUrl = '';
        var fileInput = document.getElementById('f-image');
        if (fileInput.files[0]) {
          var up = await AIMEAT.storage.upload(fileInput.files[0], { visibility: 'public' });
          imageUrl = '/v1/pub/' + encodeURIComponent(session.ghii) + '/' + encodeURIComponent(up.key);
        }
        var listing = {
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          title: document.getElementById('f-title').value.trim(),
          price: document.getElementById('f-price').value.trim(),
          desc: document.getElementById('f-desc').value.trim(),
          imageUrl: imageUrl, by: session.ghii, at: new Date().toISOString()
        };
        all.unshift(listing);
        await AIMEAT.data.set(LISTINGS_KEY, all, { visibility: 'public' });   // one public key holds all listings
        document.getElementById('post-form').reset();
        hide('post'); render();
      } catch (e) { alert('Could not publish: ' + (e.message || e)); }
      btn.disabled = false; btn.textContent = 'Publish';
    });

    AIMEAT.auth.mountLoginButton('#login', {
      onLogin: function () { maybeEnablePosting(AIMEAT.auth.getSession()); load(); },
      onLogout: function () { location.reload(); }
    });
    var s0 = AIMEAT.auth.getSession && AIMEAT.auth.getSession();
    if (s0 && s0.jwt) maybeEnablePosting(s0);   // sets OWNER for the owner's own preview before load
    load();   // everyone browses
  </script>
</body>
</html>`;

const COMP_MARKDOWN = `// markdown — render safe GFM markdown (AI stories, blog posts) to styled HTML (aimeat-markdown).
// Load: <script src="/v1/libs/aimeat-markdown.js"></script>
AIMEAT.md.render(markdownString, '#target');   // replaces #target content with a rendered .md-body
// Or get a node: var node = AIMEAT.md.render(text); someEl.appendChild(node);
// XSS-safe for LLM-authored text (no innerHTML; hrefs/imgs sanitized). Pairs well with aimeat-ai output.`;

// ── Use-case: homepage / personal site (full working scaffold) ───────
// A single-writer public site: anyone views the owner's profile + blog/feed; the OWNER edits the
// profile and publishes posts (markdown body, optional image, optional AI-written draft). Profile
// + posts live in public keys read via getPublic (anon-readable). Composes markdown + image-upload
// + ai-action + auth-gated. {{app}} = memory namespace; {{owner-ghii}} = the owner's GHII.

const USECASE_HOMEPAGE = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="aimeat-scopes" content="ai:use" />   <!-- lets the owner's "Write with AI" button spend their AI budget -->
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50 gap-2">
    <div class="flex-1 min-w-0"><span class="text-lg font-bold">{{App Title}}</span></div>
    <span id="owner-actions" hidden class="flex gap-2">
      <button id="edit-btn" class="btn-outline px-3">Edit profile</button>
      <button id="post-btn" class="btn-primary px-3">+ Post</button>
    </span>
    <span id="login"></span>
  </nav>

  <main class="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-8">
    <section id="hero" class="text-center pt-4"></section>
    <section id="posts" class="flex flex-col gap-6"></section>
  </main>

  <!-- Profile edit overlay (owner) -->
  <div id="profile-modal" class="fixed inset-0 bg-black/60 z-50 hidden items-center justify-center p-4" style="display:none">
    <form id="profile-form" class="card bg-base-200 max-w-md w-full">
      <div class="card-body gap-3">
        <h3 class="text-lg font-bold">Edit profile</h3>
        <input id="p-name" class="input input-bordered" placeholder="Your name" />
        <textarea id="p-bio" class="textarea textarea-bordered" placeholder="Bio (markdown supported)" rows="4"></textarea>
        <input id="p-avatar" type="file" accept="image/*" class="file-input file-input-bordered" />
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-ghost px-4" onclick="document.getElementById('profile-modal').style.display='none'">Cancel</button>
          <button type="submit" class="btn-primary px-6">Save</button>
        </div>
      </div>
    </form>
  </div>

  <!-- New post overlay (owner) -->
  <div id="post-modal" class="fixed inset-0 bg-black/60 z-50 hidden items-center justify-center p-4" style="display:none">
    <form id="post-form" class="card bg-base-200 max-w-lg w-full max-h-[92vh] overflow-y-auto">
      <div class="card-body gap-3">
        <h3 class="text-lg font-bold">New post</h3>
        <input id="f-title" class="input input-bordered" placeholder="Title" required />
        <div class="flex gap-2 items-center">
          <input id="f-idea" class="input input-bordered input-sm flex-1" placeholder="Idea for AI (optional)" />
          <button type="button" id="ai-btn" class="btn-info px-3" hidden>✨ Write with AI</button>
        </div>
        <textarea id="f-body" class="textarea textarea-bordered font-mono text-sm" placeholder="Write in markdown… (## heading, **bold**, - lists, links, images)" rows="8"></textarea>
        <input id="f-image" type="file" accept="image/*" class="file-input file-input-bordered" />
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn-ghost px-4" onclick="document.getElementById('post-modal').style.display='none'">Cancel</button>
          <button type="submit" id="post-submit" class="btn-primary px-6">Publish</button>
        </div>
      </div>
    </form>
  </div>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-storage.js"></script>
  <script src="/v1/libs/aimeat-ai.js"></script>
  <script src="/v1/libs/aimeat-markdown.js"></script>
  <script>
    var OWNER = '{{owner-ghii}}';        // the site owner's GHII (owner@node-id) — content is read from here
    var PROFILE_KEY = '{{app}}.profile';
    var POSTS_KEY = '{{app}}.posts';
    var session = null, profile = {}, posts = [];

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function show(id) { document.getElementById(id).style.display = 'flex'; }
    function hide(id) { document.getElementById(id).style.display = 'none'; }
    function isOwner() { return !!session && session.ghii === OWNER; }

    function renderHero() {
      var h = document.getElementById('hero'); h.innerHTML = '';
      if (profile.avatarUrl) { var img = document.createElement('img'); img.src = profile.avatarUrl; img.className = 'w-24 h-24 rounded-full object-cover mx-auto'; h.appendChild(img); }
      var name = document.createElement('h1'); name.className = 'text-3xl font-bold mt-3'; name.textContent = profile.name || '{{Your name}}'; h.appendChild(name);
      if (profile.bio) { var bio = document.createElement('div'); bio.className = 'max-w-2xl mx-auto mt-2 text-left'; AIMEAT.md.render(profile.bio, bio); h.appendChild(bio); }
    }
    function renderPosts() {
      var c = document.getElementById('posts'); c.innerHTML = '';
      if (!posts.length) { c.innerHTML = '<div class="text-center opacity-50 py-8">No posts yet.</div>'; return; }
      posts.forEach(function (p) {
        var card = document.createElement('article'); card.className = 'card bg-base-200 shadow';
        card.innerHTML = '<div class="card-body"><h2 class="text-xl font-bold">' + esc(p.title) + '</h2>' +
          '<div class="text-xs opacity-60">' + esc((p.at || '').slice(0, 10)) + '</div></div>';
        var body = card.querySelector('.card-body');
        if (p.imageUrl) { var im = document.createElement('img'); im.src = p.imageUrl; im.className = 'rounded-lg w-full object-cover max-h-96 my-2'; body.appendChild(im); }
        var md = document.createElement('div'); AIMEAT.md.render(p.body || '', md); body.appendChild(md);
        c.appendChild(card);
      });
    }

    async function load() {
      try { profile = (await AIMEAT.data.getPublic(OWNER, PROFILE_KEY)) || {}; } catch (e) { profile = {}; }
      try { var pp = await AIMEAT.data.getPublic(OWNER, POSTS_KEY); posts = Array.isArray(pp) ? pp.slice() : []; } catch (e) { posts = []; }
      posts.sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
      renderHero(); renderPosts();
    }

    // ── owner editing ──
    function applyOwnerUi() {
      if (OWNER.indexOf('{{') === 0 && session && session.ghii) OWNER = session.ghii; // owner-preview before the GHII is baked in
      document.getElementById('owner-actions').hidden = !isOwner();
      document.getElementById('ai-btn').hidden = true;
      if (isOwner()) AIMEAT.ai.isAvailable().then(function (ok) { if (ok) document.getElementById('ai-btn').hidden = false; });
    }

    document.getElementById('edit-btn').onclick = function () {
      document.getElementById('p-name').value = profile.name || '';
      document.getElementById('p-bio').value = profile.bio || '';
      show('profile-modal');
    };
    document.getElementById('post-btn').onclick = function () { show('post-modal'); };

    document.getElementById('ai-btn').onclick = async function () {
      var idea = document.getElementById('f-idea').value.trim() || document.getElementById('f-title').value.trim();
      if (!idea) { alert('Type a title or an idea first.'); return; }
      this.disabled = true; this.textContent = '✨ Writing…';
      try {
        var r = await AIMEAT.ai.complete({ prompt: 'Write a short, engaging blog post in markdown about: ' + idea, max_tokens: 500, app_id: '{{app}}' });
        document.getElementById('f-body').value = r.content;
      } catch (e) { alert('AI error: ' + (e.message || e)); }
      this.disabled = false; this.textContent = '✨ Write with AI';
    };

    document.getElementById('profile-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      try {
        var avatarUrl = profile.avatarUrl || '';
        var af = document.getElementById('p-avatar');
        if (af.files[0]) { var up = await AIMEAT.storage.upload(af.files[0], { visibility: 'public' }); avatarUrl = '/v1/pub/' + encodeURIComponent(session.ghii) + '/' + encodeURIComponent(up.key); }
        profile = { name: document.getElementById('p-name').value.trim(), bio: document.getElementById('p-bio').value, avatarUrl: avatarUrl };
        await AIMEAT.data.set(PROFILE_KEY, profile, { visibility: 'public' });
        hide('profile-modal'); renderHero();
      } catch (e) { alert('Could not save: ' + (e.message || e)); }
    });

    document.getElementById('post-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var btn = document.getElementById('post-submit'); btn.disabled = true; btn.textContent = 'Publishing…';
      try {
        var imageUrl = '';
        var fi = document.getElementById('f-image');
        if (fi.files[0]) { var up = await AIMEAT.storage.upload(fi.files[0], { visibility: 'public' }); imageUrl = '/v1/pub/' + encodeURIComponent(session.ghii) + '/' + encodeURIComponent(up.key); }
        posts.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), title: document.getElementById('f-title').value.trim(), body: document.getElementById('f-body').value, imageUrl: imageUrl, at: new Date().toISOString() });
        await AIMEAT.data.set(POSTS_KEY, posts, { visibility: 'public' });
        document.getElementById('post-form').reset(); hide('post-modal'); renderPosts();
      } catch (e) { alert('Could not publish: ' + (e.message || e)); }
      btn.disabled = false; btn.textContent = 'Publish';
    });

    AIMEAT.auth.mountLoginButton('#login', {
      onLogin: function () { session = AIMEAT.auth.getSession(); applyOwnerUi(); load(); },
      onLogout: function () { location.reload(); }
    });
    var s0 = AIMEAT.auth.getSession && AIMEAT.auth.getSession();
    if (s0 && s0.jwt) { session = s0; applyOwnerUi(); }
    load();   // everyone views
  </script>
</body>
</html>`;

const TEMPLATES: AppTemplate[] = [
  {
    id: 'shell-pure-client',
    kind: 'app-shell',
    tier: 'T1',
    title: 'Standard app — login + saves your data',
    description: 'Single-file HTML app: login + private/shared memory, self-hosted Tailwind + daisyUI, light/dark theme. The 80% case — notes, trackers, boards, dashboards.',
    libs: ['aimeat-auth', 'aimeat-data'],
    content: SHELL_PURE_CLIENT,
  },
  {
    id: 'shell-cortex',
    kind: 'app-shell',
    tier: 'T2',
    title: 'Data app — built-in tables, forms & charts',
    description: 'Standard app plus the bundled cortex UI libraries (DataTable, forms, layouts, charts) for richer structured UIs without hand-rolling components.',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-ui-viewers', 'aimeat-ui-forms'],
    content: SHELL_CORTEX,
  },
  {
    id: 'shell-extension',
    kind: 'app-shell',
    tier: 'T3',
    title: 'Connected app — fetches outside data / runs on a schedule (advanced)',
    description: 'For apps needing server-side work (external API fetch, scheduled jobs): the client calls a sandboxed extension. Build the extension separately or ship it in a package.',
    libs: ['aimeat-auth', 'aimeat-data'],
    content: SHELL_EXTENSION,
  },
  { id: 'comp-auth-gated', kind: 'component', title: 'Auth-gated section', description: 'Show/hide a section based on login state.', libs: ['aimeat-auth'], content: COMP_AUTH_GATED },
  { id: 'comp-private-store', kind: 'component', title: 'Private store', description: 'Save / list / remove a per-owner private collection.', libs: ['aimeat-data'], content: COMP_PRIVATE_STORE },
  { id: 'comp-shared-feed', kind: 'component', title: 'Shared feed', description: 'A public community feed — each user writes their own key, everyone reads.', libs: ['aimeat-data'], content: COMP_SHARED_FEED },
  { id: 'comp-ai-action', kind: 'component', title: 'AI action button', description: "Run the user's own LLM on demand, render into an editable field.", libs: ['aimeat-auth', 'aimeat-ai'], content: COMP_AI_ACTION },
  { id: 'comp-data-table', kind: 'component', title: 'Data table', description: 'Sortable / filterable / paginated table via the viewers cortex.', libs: ['aimeat-ui-viewers'], content: COMP_DATA_TABLE },
  { id: 'comp-settings', kind: 'component', title: 'Settings panel', description: "Read / write the app's settings from memory.", libs: ['aimeat-data'], content: COMP_SETTINGS },
  { id: 'comp-dated-archive', kind: 'component', title: 'Dated archive', description: 'Group entries by date and render newest-first (news/journal).', libs: ['aimeat-data'], content: COMP_DATED_ARCHIVE },
  { id: 'comp-image-upload', kind: 'component', title: 'Image upload', description: 'Upload an image to storage and get a shareable public URL (marketplace listings, avatars).', libs: ['aimeat-auth', 'aimeat-storage'], content: COMP_IMAGE_UPLOAD },
  { id: 'comp-realtime-room', kind: 'component', title: 'Realtime room', description: 'Live presence + messages over a shared room — multiplayer games, chat, presence boards.', libs: ['aimeat-auth'], content: COMP_REALTIME_ROOM },
  { id: 'comp-search', kind: 'component', title: 'Search / filter', description: 'Instant client-side filter over a list, or server-side memory search.', libs: ['aimeat-data'], content: COMP_SEARCH },
  { id: 'comp-list-detail', kind: 'component', title: 'List + detail', description: 'Master/detail layout: a list, click an item to show its detail (directories, catalogs).', libs: [], content: COMP_LIST_DETAIL },
  { id: 'comp-markdown', kind: 'component', title: 'Markdown render', description: 'Render safe GFM markdown (AI stories, blog posts, docs) to styled HTML.', libs: ['aimeat-markdown'], content: COMP_MARKDOWN },
  {
    id: 'usecase-realtime-social',
    kind: 'use-case',
    title: 'Realtime social room',
    description: 'A live room: logged-in users get live presence + chat with durable history. Chat, presence boards, multiplayer lobbies.',
    libs: ['aimeat-auth', 'aimeat-data'],
    composes: ['comp-realtime-room', 'comp-shared-feed', 'comp-auth-gated'],
    content: USECASE_REALTIME_SOCIAL,
  },
  {
    id: 'usecase-marketplace',
    kind: 'use-case',
    title: 'Marketplace (single-seller storefront)',
    description: 'Anyone browses + searches the public listings and opens a detail view; the seller posts listings with images. One public index key, anon-readable. For multi-seller, use an extension.',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-storage'],
    composes: ['comp-list-detail', 'comp-image-upload', 'comp-search', 'comp-auth-gated'],
    content: USECASE_MARKETPLACE,
  },
  {
    id: 'usecase-homepage',
    kind: 'use-case',
    title: 'Homepage / personal site',
    description: 'A single-writer public site: anyone views the owner profile + blog/feed; the owner edits the profile and publishes posts (markdown body, images, optional AI-written draft).',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-storage', 'aimeat-ai', 'aimeat-markdown'],
    composes: ['comp-markdown', 'comp-image-upload', 'comp-ai-action', 'comp-auth-gated'],
    content: USECASE_HOMEPAGE,
  },
];

// Localized title/description for the picker (the templates a non-technical user
// actually sees). English lives on the template itself; other languages overlay
// here, keyed by id. Only the picker-visible templates (shells + use-cases) need it.
const TRANSLATIONS: Record<string, Record<string, { title: string; description?: string }>> = {
  fi: {
    'shell-pure-client': { title: 'Vakiosovellus — kirjautuminen + tallentaa tietosi' },
    'shell-cortex': { title: 'Datasovellus — valmiit taulukot, lomakkeet & kaaviot' },
    'shell-extension': { title: 'Yhdistetty sovellus — hakee ulkoista dataa / ajastetut tehtävät (edistynyt)' },
    'usecase-realtime-social': { title: 'Reaaliaikainen yhteisöhuone', description: 'Live-huone: kirjautuneet käyttäjät saavat live-läsnäolon + chatin pysyvällä historialla. Chatit, läsnäolotaulut, moninpeliaulat.' },
    'usecase-marketplace': { title: 'Kauppapaikka (yhden myyjän myymälä)', description: 'Kuka tahansa selaa + hakee julkisia ilmoituksia ja avaa yksityiskohdat; myyjä lisää ilmoituksia kuvilla.' },
    'usecase-homepage': { title: 'Kotisivu / henkilökohtainen sivusto', description: 'Yhden kirjoittajan julkinen sivusto: kuka tahansa katselee profiilia + blogia; omistaja muokkaa ja julkaisee.' },
  },
};

/** All authoring templates. */
export function getAppTemplates(): AppTemplate[] {
  return TEMPLATES;
}

/**
 * Lightweight index (no content) — for injecting a menu into a prompt or rendering
 * a picker. Pass a `lang` (e.g. 'fi') to get localized title/description where a
 * translation exists; everything else falls back to the canonical English.
 */
export function getAppTemplateIndex(lang?: string): Array<Pick<AppTemplate, 'id' | 'kind' | 'tier' | 'title' | 'description' | 'libs'>> {
  const tr = (lang && TRANSLATIONS[lang]) || null;
  return TEMPLATES.map(({ id, kind, tier, title, description, libs }) => {
    const o = tr && tr[id];
    return { id, kind, tier, title: (o && o.title) || title, description: (o && o.description) || description, libs };
  });
}
