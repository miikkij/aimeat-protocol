/**
 * @file src/data/app-templates/components.ts
 * @description Reusable component-template bodies (snippets + their lib deps) for the
 *   authoring-template registry. Pure data — patterns the AI drops into an app-shell.
 *   {{app}} = the app's memory namespace. Consumed by ../app-templates.ts.
 * @structure COMP_AUTH_GATED · COMP_PRIVATE_STORE · COMP_SHARED_FEED · COMP_AI_ACTION ·
 *   COMP_DATA_TABLE · COMP_SETTINGS · COMP_DATED_ARCHIVE · COMP_IMAGE_UPLOAD ·
 *   COMP_REALTIME_ROOM · COMP_SEARCH · COMP_LIST_DETAIL · COMP_MARKDOWN
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/data/app-templates.ts (max-file-lines)
 */

// ── Component templates ──────────────────────────────────────────────
// Reusable blocks (snippets + their lib deps) the AI drops into an app-shell. Not full pages —
// patterns to copy. {{app}} = the app's memory namespace.

export const COMP_AUTH_GATED = `// auth-gated section — show content only to logged-in users (aimeat-auth).
var gate = document.getElementById('members-only');
function applyAuth(s) { if (gate) gate.style.display = (s && s.jwt) ? '' : 'none'; }
AIMEAT.auth.mountLoginButton('#login', {
  onLogin: function () { applyAuth(AIMEAT.auth.getSession()); },
  onLogout: function () { applyAuth(null); }
});
applyAuth(AIMEAT.auth.getSession());`;

export const COMP_PRIVATE_STORE = `// private-store — a per-owner private collection (aimeat-data). Only the owner can read it.
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

export const COMP_SHARED_FEED = `// shared-feed — a public community feed (aimeat-data). Each user writes their OWN key; everyone reads.
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

export const COMP_AI_ACTION = `// ai-action — run the user's own LLM on demand (aimeat-ai; load it + aimeat-auth).
async function aiSuggest(promptText, outEl) {
  if (!(await AIMEAT.ai.isAvailable())) { outEl.value = 'Log in and add an OpenRouter key to enable AI.'; return; }
  try { var r = await AIMEAT.ai.complete({ app_id: '{{app}}', prompt: promptText }); outEl.value = r.content; }
  catch (e) { outEl.value = 'AI error: ' + (e.message || e); }
}
// Render into an EDITABLE field so the user reviews before saving. Gate the button on isAvailable().`;

export const COMP_DATA_TABLE = `// data-table — sortable / filterable / paginated table (aimeat-ui-viewers cortex).
// Load: <script src="/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
AIMEAT.ui.viewers.DataTable({
  target: document.getElementById('table'),
  sortable: true, filterable: true, pageSize: 10,
  columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }],
  rows: yourRows // [{ name: '…', value: … }]
});`;

export const COMP_SETTINGS = `// settings-panel — read/write the app's settings (aimeat-data).
async function getSettings() { return (await AIMEAT.data.get('{{app}}.settings')) || { /* defaults */ }; }
async function saveSettings(patch) {
  var s = Object.assign(await getSettings(), patch);
  await AIMEAT.data.set('{{app}}.settings', s, { visibility: 'private' });
  return s;
}
// Bind toggles/selects to saveSettings({ key: value }); re-read on load to populate the form.`;

export const COMP_DATED_ARCHIVE = `// dated-archive — show entries by date, newest first (aimeat-data). Keys like {{app}}.YYYY-MM-DD.*
async function loadArchive() {
  var entries = await AIMEAT.data.search('{{app}}.'); // matching entries
  var byDay = {};
  entries.forEach(function (e) { var d = (e.date || (e.key || '').split('.')[1] || ''); (byDay[d] = byDay[d] || []).push(e); });
  return Object.keys(byDay).sort().reverse().map(function (d) { return { date: d, items: byDay[d] }; });
}`;

export const COMP_IMAGE_UPLOAD = `// image-upload — upload an image and get an anon-visible URL (aimeat-storage + aimeat-auth).
// Load: <script src="/v1/libs/aimeat-storage.js"></script>
async function uploadImage(file) {
  var up = await AIMEAT.storage.upload(file, { visibility: 'public' });   // -> { key, ... }
  var ghii = AIMEAT.auth.getSession().ghii;                               // owner@node-id
  return '/v1/pub/' + encodeURIComponent(ghii) + '/' + encodeURIComponent(up.key); // public files load for anon
}
// <input type="file" accept="image/*" onchange="uploadImage(this.files[0]).then(setImageUrl)">`;

export const COMP_REALTIME_ROOM = `// realtime-room — live presence + messages over a shared room (no backend to run).
async function joinRoom(name, onMessage) {
  var room = (await session.fetch('/v1/realtime/rooms', { method: 'POST', body: JSON.stringify({ name: name }) })).data; // { id, ws_url }
  var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + room.ws_url);
  ws.onmessage = function (e) { onMessage(JSON.parse(e.data)); };
  return { send: function (msg) { ws.send(JSON.stringify(msg)); }, ws: ws };
}
// var room = await joinRoom('lobby', function (m) { /* render presence / messages */ });
// room.send({ type: 'chat', text: '…' });   // for low-latency P2P use AimeatRealtime (/lib/realtime.js)`;

export const COMP_SEARCH = `// search — instant client-side filter, or server-side memory search.
function filterItems(items, q) {
  q = (q || '').toLowerCase().trim();
  if (!q) return items;
  return items.filter(function (it) { return JSON.stringify(it).toLowerCase().indexOf(q) !== -1; });
}
// Bind: input.addEventListener('input', function () { render(filterItems(all, input.value)); });
// Server-side across stored entries (aimeat-data): var hits = await AIMEAT.data.search('{{app}}.' + query);`;

export const COMP_LIST_DETAIL = `// list+detail — master/detail: a list on the left, the selected item's detail on the right.
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

export const COMP_MARKDOWN = `// markdown — render safe GFM markdown (AI stories, blog posts) to styled HTML (aimeat-markdown).
// Load: <script src="/v1/libs/aimeat-markdown.js"></script>
AIMEAT.md.render(markdownString, '#target');   // replaces #target content with a rendered .md-body
// Or get a node: var node = AIMEAT.md.render(text); someEl.appendChild(node);
// XSS-safe for LLM-authored text (no innerHTML; hrefs/imgs sanitized). Pairs well with aimeat-ai output.`;
