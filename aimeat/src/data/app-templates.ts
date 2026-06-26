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

const COMP_IMAGE_UPLOAD = `// image-upload — upload an image to AIMEAT storage and get a shareable URL (aimeat-storage).
// Load: <script src="/v1/libs/aimeat-storage.js"></script>  (needs aimeat-auth)
async function uploadImage(file) {
  var res = await AIMEAT.storage.upload(file, { public: true }); // public files are served at /v1/pub/...
  return res.url || res.downloadUrl; // save this URL with your item; render with <img src=url>
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

const TEMPLATES: AppTemplate[] = [
  {
    id: 'shell-pure-client',
    kind: 'app-shell',
    tier: 'T1',
    title: 'Pure client app (T1)',
    description: 'Single-file HTML app: login + private/shared memory, self-hosted Tailwind + daisyUI, light/dark theme. The 80% case — notes, trackers, boards, dashboards.',
    libs: ['aimeat-auth', 'aimeat-data'],
    content: SHELL_PURE_CLIENT,
  },
  {
    id: 'shell-cortex',
    kind: 'app-shell',
    tier: 'T2',
    title: 'Client + cortex UI (T2)',
    description: 'T1 plus the bundled cortex UI libraries (DataTable, forms, layouts, charts) for richer structured UIs without hand-rolling components.',
    libs: ['aimeat-auth', 'aimeat-data', 'aimeat-ui-viewers', 'aimeat-ui-forms'],
    content: SHELL_CORTEX,
  },
  {
    id: 'shell-extension',
    kind: 'app-shell',
    tier: 'T3',
    title: 'Client + server extension (T3)',
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
];

/** All authoring templates. */
export function getAppTemplates(): AppTemplate[] {
  return TEMPLATES;
}

/** Lightweight index (no content) — for injecting a menu into a prompt or rendering a picker. */
export function getAppTemplateIndex(): Array<Pick<AppTemplate, 'id' | 'kind' | 'tier' | 'title' | 'description' | 'libs'>> {
  return TEMPLATES.map(({ id, kind, tier, title, description, libs }) => ({ id, kind, tier, title, description, libs }));
}
