/**
 * @file src/data/app-templates/components.ts
 * @description Reusable component-template bodies (snippets + their lib deps) for the
 *   authoring-template registry. Pure data — patterns the AI drops into an app-shell.
 *   {{app}} = the app's memory namespace. Consumed by ../app-templates.ts.
 * @structure COMP_AUTH_GATED · COMP_PRIVATE_STORE · COMP_SHARED_FEED · COMP_AI_ACTION ·
 *   COMP_DATA_TABLE · COMP_SETTINGS · COMP_DATED_ARCHIVE · COMP_IMAGE_UPLOAD ·
 *   COMP_REALTIME_ROOM · COMP_SEARCH · COMP_LIST_DETAIL · COMP_MARKDOWN ·
 *   COMP_MERMAID_DIAGRAM · COMP_THREE_SCENE · COMP_P5_SKETCH · COMP_PIXI_STAGE · COMP_PHASER_ARCADE ·
 *   COMP_FLOW_EDITOR
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/data/app-templates.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — COMP_MERMAID_DIAGRAM + COMP_THREE_SCENE (library-pack demos)
 *   v1.2.0 — 2026-07-16 — COMP_P5_SKETCH + COMP_PIXI_STAGE + COMP_PHASER_ARCADE (Wave 1 packs)
 *   v1.3.0 — 2026-07-16 — COMP_FLOW_EDITOR (aimeat-flow pack demo)
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

export const COMP_MERMAID_DIAGRAM = `// mermaid-diagram — render a text-defined diagram (flowchart/sequence/gantt/mindmap).
// Load the self-hosted pack: <script src="/lib/mermaid/mermaid.min.js"></script>  (pack id: mermaid)
var diagramSeq = 0;
function initMermaid() {
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
}
async function renderDiagram(definition, targetEl) {
  initMermaid(); // re-init picks up the current light/dark theme
  try {
    var out = await mermaid.render('mmd-' + (++diagramSeq), definition); // unique id per call
    targetEl.innerHTML = out.svg;
  } catch (e) { targetEl.textContent = 'Diagram error: ' + (e.message || e); }
}
// Save/load the DEFINITION (text), not the SVG: AIMEAT.data.set('{{app}}.diagrams.' + id, { def: definition })
// Example: renderDiagram('flowchart TD\n  A[Idea] --> B{Works?}\n  B -->|yes| C[Ship]\n  B -->|no| A', el);
// For diagrams the user EDITS by dragging nodes, use the aimeat-flow pack instead of mermaid.`;

export const COMP_THREE_SCENE = `// three-scene — a themed, resizable 3D scene (three.js r128 UMD — window.THREE).
// Load the self-hosted pack: <script src="/lib/three.min.js"></script>  (pack id: three — r128 API, no OrbitControls addon)
function mountScene(container) {
  var w = container.clientWidth, h = container.clientHeight || 360;
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000); camera.position.set(0, 1.5, 4);
  var renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); container.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var sun = new THREE.DirectionalLight(0xffffff, 0.8); sun.position.set(3, 5, 2); scene.add(sun);
  var cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe8564a }));
  scene.add(cube);
  function themeBg() { scene.background = new THREE.Color(document.documentElement.getAttribute('data-theme') === 'dark' ? 0x14141c : 0xfafaf8); }
  themeBg(); addEventListener('storage', function (e) { if (e.key === 'aimeat-theme') themeBg(); });
  addEventListener('resize', function () { w = container.clientWidth; camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); });
  (function loop() { requestAnimationFrame(loop); cube.rotation.y += 0.01; renderer.render(scene, camera); })();
  return { scene: scene, camera: camera, renderer: renderer };
}
// r128 gotchas: no bundled OrbitControls — implement pointer-drag orbit yourself; dispose() removed meshes.`;

export const COMP_P5_SKETCH = `// p5-sketch — an instance-mode p5.js sketch mounted into a container (p5 pack: /lib/p5@1.min.js).
// INSTANCE MODE always (global mode pollutes window and collides with AIMEAT libs).
function mountSketch(el, params) {
  return new p5(function (s) {
    s.setup = function () { s.createCanvas(el.clientWidth, 400).parent(el); s.noStroke(); };
    s.windowResized = function () { s.resizeCanvas(el.clientWidth, 400); };
    s.draw = function () {
      s.background(getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#fafaf8');
      for (var i = 0; i < (params.count || 40); i++) {
        var t = s.frameCount * 0.01 + i;
        s.fill(232, 86, 74, 120);
        s.ellipse(s.width / 2 + s.cos(t) * i * 6, s.height / 2 + s.sin(t * 1.3) * i * 4, params.size || 14);
      }
    };
  });
}
// Persist the PARAMETERS (seed/config), not pixels: AIMEAT.data.set('{{app}}.sketch', params)
// Export an image: el.querySelector('canvas').toBlob(function (b) { AIMEAT.storage.upload(b, { key: '{{app}}/art.png', visibility: 'public' }); });`;

export const COMP_PIXI_STAGE = `// pixi-stage — a PixiJS v8 stage (pixi pack: /lib/pixi@8.min.js). NOTE: v8 API — async init, app.canvas.
async function mountStage(el) {
  var app = new PIXI.Application();                       // v8: no options in the constructor
  await app.init({ background: '#14141c', resizeTo: el }); // v8: async init
  el.appendChild(app.canvas);                              // v8: app.canvas (NOT app.view)
  var sprites = [];
  for (var i = 0; i < 200; i++) {
    var g = new PIXI.Graphics().circle(0, 0, 2 + Math.random() * 4).fill(0xe8564a); // v8: shape().fill()
    g.x = Math.random() * app.screen.width; g.y = Math.random() * app.screen.height;
    g.vx = (Math.random() - 0.5) * 2; g.vy = (Math.random() - 0.5) * 2;
    app.stage.addChild(g); sprites.push(g);
  }
  app.ticker.add(function (ticker) {
    sprites.forEach(function (p) {
      p.x = (p.x + p.vx * ticker.deltaTime + app.screen.width) % app.screen.width;
      p.y = (p.y + p.vy * ticker.deltaTime + app.screen.height) % app.screen.height;
    });
  });
  return app; // call app.destroy(true) when removing the view
}
// Textures: await PIXI.Assets.load(url). Rendering only — for physics/input/scenes use the phaser pack.`;

export const COMP_PHASER_ARCADE = `// phaser-arcade — a Phaser 3 arcade shell with an AIMEAT high-score board (phaser pack: /lib/phaser@3.min.js).
// Generated textures (no external assets), FIT scaling, arcade physics; save scores via aimeat-auth + aimeat-data.
function bootGame(el, onGameOver) {
  return new Phaser.Game({
    type: Phaser.AUTO, parent: el,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 800, height: 600 },
    physics: { default: 'arcade', arcade: { gravity: { y: 0 } } },
    scene: {
      create: function () {
        var g = this.add.graphics(); g.fillStyle(0xe8564a, 1).fillRect(0, 0, 32, 32);
        g.generateTexture('block', 32, 32); g.destroy();          // texture from code, no asset files
        this.score = 0;
        this.scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '20px', color: '#ffffff' });
        var self = this;
        this.time.addEvent({ delay: 700, loop: true, callback: function () {
          var b = self.physics.add.sprite(Phaser.Math.Between(20, 780), -20, 'block');
          b.setVelocityY(150); b.setInteractive();
          b.on('pointerdown', function () { b.destroy(); self.score += 1; self.scoreText.setText('Score: ' + self.score); });
        } });
      },
      update: function () { /* end conditions -> onGameOver(this.score) */ }
    }
  });
}
async function saveHighScore(score) { // one public key per player -> a leaderboard everyone can read
  var s = AIMEAT.auth.getSession(); if (!s) return;
  var prev = (await AIMEAT.data.get('{{app}}.highscore')) || { score: 0 };
  if (score > (prev.score || 0)) await AIMEAT.data.set('{{app}}.highscore', { score: score, by: s.owner, at: new Date().toISOString() }, { visibility: 'public' });
}
async function leaderboard() { return (await AIMEAT.data.search('{{app}}.highscore')).sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).slice(0, 10); }`;

export const COMP_FLOW_EDITOR = `// flow-editor — an editable drag-and-drop flow/mindmap (aimeat-flow cortex; engine stays internal).
// Load IN ORDER: <link rel="stylesheet" href="/lib/drawflow@0.min.css">
//               <script src="/lib/drawflow@0.min.js"></script>
//               <script src="/v1/cortex/aimeat-flow/libs/aimeat-flow.js"></script>
// Host needs a size: <div id="editor" style="height:420px"></div>  (or a CSS class with a height)
var flow = AIMEAT.flow.create('#editor', {
  preset: 'process',                       // 'process' | 'mindmap' | 'orgchart'
  onChange: function (envelope) { /* enable a dirty-indicator / autosave here */ }
});
var a = flow.addNode({ label: 'Order received', x: 60, y: 140 });
var b = flow.addNode({ label: 'Pack & ship', x: 340, y: 140 });
flow.connect(a, b);                         // users drag nodes, connect ports, dblclick to rename
async function saveFlow() { await flow.save('{{app}}.flow:main'); }     // needs aimeat-auth + aimeat-data + login
async function loadFlow() { await flow.load('{{app}}.flow:main'); }
// Mindmap preset: var root = flow.addNode({ label: 'Idea', outputs: 1 }); flow.addChild(root, 'Branch');
// NEVER touch flow.engine — the wrapper API is the contract, the engine can be swapped.`;
