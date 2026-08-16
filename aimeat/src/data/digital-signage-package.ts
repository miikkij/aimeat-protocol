/**
 * @file digital-signage-package.ts
 * @description Installable package for "digital-signage" — the AGENT-FACED digital signage system
 *   (Template 3, documents edition). Installing it from Profile > Packages registers a per-instance
 *   copy of BOTH apps (admin + kiosk); the owner launches the admin and configures WHICH organism +
 *   workspace it manages (the admin guides creating a private one if none exists). Content lives as
 *   shared workspace DOCUMENTS (one screen = one public document), edited identically by the app and
 *   by any MCP agent, and read by the kiosk with no login. Nothing is seeded into the installer's
 *   memory — signage data lives in the owner's OWN organism (per-user isolation).
 *
 *   GENERATED FILE — do not edit by hand. Edit the sources packages/digital-signage/*.html and re-run
 *   `node packages/build-digital-signage-pkg.mjs`.
 * @version-history
 *   v2.0.0 — 2026-07-11 — Rebuilt from the legacy memory-key package to the agent-faced document model
 *     (TARGET-029). Two apps, no CSM/memory/cortex seeding, per-user organism.
 */
import type { ExamplePackageDef } from './example-packages.js';

const APP_ADMIN = `<!-- AIMEAT App Manifest
name: Signage Admin
version: 2.0.0
description: Manage digital signage screens — same public workspace documents an agent edits (Template 3)
entry: index.html
-->
<!--
  @file app-signage-admin.html
  @description The HUMAN face of the agent-faced digital signage app (Template 3, documents edition).
    A screen is ONE workspace document (space "screen", doc id = human-readable slug) whose body is a
    JSON payload { config, views, announcement }. This app lets the owner create/edit screens, mark them
    public (PUT /workspace/share), copy the no-login kiosk URL, and copy the AGENT PROMPT that lets any
    MCP agent edit the SAME documents. There is no signage-specific backend: both faces write the same
    workspace documents through the workspace's own membership/contributor/publish gate.
    Per-user isolation: each owner runs signage in THEIR OWN organism + workspace. The app cannot create
    the organism (role 'app' can't) — a prompt-driven setup step guides the owner/agent to provision it.
  @structure boot -> start -> (setup guide | pickWorkspace) -> manageScreens -> editScreen
  @usage published app; launch with #aimeat-ws=<org>/<ws> or pick a workspace.
  @version-history
    v2.0.0 — 2026-07-11 — Rewritten from the memory-key admin panel to the workspace-document,
      agent-faced model (per-user org, public kiosk document, generated agent prompt + setup prompt).
-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signage Admin</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 shadow-sm px-4">
    <div class="flex-1"><span class="text-lg font-bold">🖥️ Signage Admin</span>
      <span id="ws-name" class="ml-3 text-sm opacity-70"></span></div>
    <div class="flex-none gap-2">
      <button id="agent-prompt" class="btn btn-outline btn-sm" style="display:none">🤖 Copy agent prompt</button>
      <span id="header-auth"></span>
    </div>
  </nav>
  <div id="app" class="flex-1 p-4 max-w-4xl mx-auto w-full"><p>Loading…</p></div>
  <script>
    'use strict';
    const SPACE = 'screen';           // document space name in the manifest
    const CONTRACT = 'signage';       // manifest objectType contract that marks the signage space
    let CTX = null;                   // { orgId, wsId }
    let NAMESPACE = null;             // the space namespace (e.g. shared.screen)

    const $app = () => document.getElementById('app');
    function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
    function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
    function slugify(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || ('screen-' + Date.now()); }

    function launchContext() {
      const m = /[#&]aimeat-ws=([^/&]+)\\/([^&]+)/.exec(location.hash || '');
      return m ? { orgId: decodeURIComponent(m[1]), wsId: decodeURIComponent(m[2]) } : null;
    }

    async function boot() {
      await loadScript('/v1/libs/aimeat-auth.js');
      await loadScript('/v1/libs/aimeat-organism.js');
      AIMEAT.auth.mountLoginButton('#header-auth', { onLogin: start, onLogout: () => location.reload() });
      let started = false;
      const startOnce = () => { if (!started) { started = true; start(); } };
      AIMEAT.auth.on('login', startOnce);
      const session = await AIMEAT.auth.login();
      if (session) startOnce(); else if (!started) $app().innerHTML = '<p class="opacity-70">Sign in to manage your signage.</p>';
    }

    // Find the signage workspace: launch context, else any accessible workspace whose manifest
    // declares a document space with contract 'signage'. If none, show the setup guide.
    async function start() {
      const ctx = launchContext();
      if (ctx) return openWorkspace(ctx.orgId, ctx.wsId);
      const orgs = await AIMEAT.organism.list().catch(() => []);
      const candidates = [];
      for (const org of orgs) {
        const wss = await AIMEAT.organism.workspaces(org.id).catch(() => []);
        for (const w of wss) {
          if (w.access === 'none') continue;
          const ws = await AIMEAT.organism.read(org.id, w.id).catch(() => null);
          const ot = ws && (ws.manifest?.objectTypes || []).find(o => o.contract === CONTRACT && o.mode === 'document');
          if (ot) candidates.push({ org, w });
        }
      }
      if (candidates.length === 1) return openWorkspace(candidates[0].org.id, candidates[0].w.id);
      if (candidates.length === 0) return renderSetup();
      const el = $app(); el.innerHTML = '<h2 class="text-lg font-bold mb-2">Pick a signage workspace</h2>';
      for (const c of candidates) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-outline btn-block justify-start mb-2';
        btn.textContent = c.org.name + ' / ' + (c.w.name || c.w.id);
        btn.onclick = () => openWorkspace(c.org.id, c.w.id);
        el.appendChild(btn);
      }
    }

    // Prompt-driven setup: the app (role 'app') cannot create an organism, so guide the owner/agent.
    function renderSetup() {
      const el = $app();
      el.innerHTML = '<h2 class="text-lg font-bold mb-2">Set up your signage</h2>' +
        '<p class="opacity-70 mb-3 text-sm">Signage lives in your OWN organism so no one else can see or edit it. ' +
        'This app cannot create the organism for you — paste the prompt below into your AIMEAT-connected AI (Claude, etc.) once, ' +
        'and it will provision your private signage workspace. Then reload this page.</p>' +
        '<div class="mockup-code text-xs whitespace-pre-wrap p-3" id="setup-box"></div>' +
        '<button class="btn btn-primary btn-sm mt-3" id="copy-setup">📋 Copy setup prompt</button>';
      document.getElementById('setup-box').textContent = setupPrompt();
      document.getElementById('copy-setup').onclick = async (e) => {
        await navigator.clipboard.writeText(setupPrompt());
        e.target.textContent = '✓ Copied'; setTimeout(() => { e.target.textContent = '📋 Copy setup prompt'; }, 1500);
      };
    }

    async function openWorkspace(orgId, wsId) {
      CTX = { orgId, wsId };
      const ws = await AIMEAT.organism.read(orgId, wsId);
      document.getElementById('ws-name').textContent = ws.manifest?.name || wsId;
      const ot = (ws.manifest?.objectTypes || []).find(o => o.contract === CONTRACT && o.mode === 'document')
        || (ws.manifest?.objectTypes || []).find(o => o.mode === 'document');
      if (!ot) { $app().innerHTML = '<p>This workspace has no signage document space. See the setup prompt in /llms-full.txt.</p>'; return; }
      NAMESPACE = ot.namespace;
      const space = ws.spaces.find(s => s.name === ot.name);
      const screens = (space?.items || []).map(i => ({ id: i.id || i.value?.id, value: i.value }))
        .filter(s => s.id);
      renderScreens(screens);
      const btn = document.getElementById('agent-prompt');
      btn.style.display = '';
      btn.onclick = async () => { await navigator.clipboard.writeText(agentPrompt()); btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '🤖 Copy agent prompt'; }, 1500); };
    }

    function renderScreens(screens) {
      const el = $app(); el.innerHTML = '<h2 class="text-lg font-bold mb-3">Screens</h2>';
      if (screens.length === 0) el.innerHTML += '<p class="opacity-60 text-sm mb-3">No screens yet. Create one below.</p>';
      for (const s of screens) {
        const payload = parsePayload(s.value?.markdown || '');
        const card = document.createElement('div');
        card.className = 'card bg-base-200 mb-2 p-3';
        card.innerHTML = '<div class="flex items-center justify-between">' +
          '<div><span class="font-semibold">' + esc(s.value?.title || s.id) + '</span>' +
          ' <span class="badge badge-sm ml-2">' + payload.views.length + ' views</span>' +
          ' <span class="opacity-50 text-xs ml-2">' + esc(s.id) + '</span></div></div>';
        const row = document.createElement('div'); row.className = 'flex gap-2 mt-2 flex-wrap';
        const bEdit = document.createElement('button'); bEdit.className = 'btn btn-outline btn-xs'; bEdit.textContent = 'Edit';
        bEdit.onclick = () => editScreen(s.id, s.value?.title || s.id, payload);
        const bKiosk = document.createElement('button'); bKiosk.className = 'btn btn-ghost btn-xs'; bKiosk.textContent = '📺 Copy kiosk URL';
        bKiosk.onclick = async () => { await navigator.clipboard.writeText(kioskUrl(s.id)); bKiosk.textContent = '✓ Copied'; setTimeout(() => { bKiosk.textContent = '📺 Copy kiosk URL'; }, 1500); };
        const bPub = document.createElement('button'); bPub.className = 'btn btn-success btn-xs'; bPub.textContent = 'Make public';
        bPub.onclick = async () => { await markPublic(s.id); bPub.textContent = '✓ Public'; };
        row.append(bEdit, bKiosk, bPub); card.appendChild(row);
        el.appendChild(card);
      }
      const add = document.createElement('button'); add.className = 'btn btn-primary btn-sm mt-3'; add.textContent = '+ New screen';
      add.onclick = () => editScreen(null, '', { config: defaultConfig(), views: [], announcement: null });
      el.appendChild(add);
    }

    function defaultConfig() { return { rotationEnabled: true, rotationIntervalSec: 8, theme: 'dark', accentColor: '#1a1a2e' }; }

    // The screen editor: name + config + a simple views list. Views are edited as JSON for power,
    // with add/remove helpers — the same shape an agent writes, so the two faces stay identical.
    function editScreen(docId, title, payload) {
      const el = $app();
      const isNew = !docId;
      el.innerHTML = '<h2 class="text-lg font-bold mb-3">' + (isNew ? 'New screen' : 'Edit: ' + esc(title)) + '</h2>';
      const form = document.createElement('div'); form.className = 'flex flex-col gap-3';
      form.innerHTML =
        '<label class="text-sm">Screen name<input id="f-title" class="input input-bordered w-full mt-1" value="' + esc(title) + '" placeholder="e.g. Lobby" /></label>' +
        (isNew ? '<label class="text-sm">Readable id (slug)<input id="f-slug" class="input input-bordered w-full mt-1" placeholder="e.g. lobby" /></label>' : '') +
        '<label class="text-sm">Rotation seconds<input id="f-interval" type="number" min="3" class="input input-bordered w-full mt-1" value="' + (payload.config?.rotationIntervalSec || 8) + '" /></label>' +
        '<label class="text-sm">Views (JSON: [{ name, type: image|html|url, content, weight, activeFrom, activeUntil }])' +
        '<textarea id="f-views" class="textarea textarea-bordered w-full mt-1 font-mono text-xs" rows="10">' + esc(JSON.stringify(payload.views || [], null, 2)) + '</textarea></label>' +
        '<div class="flex gap-2"><button id="f-save" class="btn btn-primary btn-sm">Save + publish</button>' +
        '<button id="f-cancel" class="btn btn-ghost btn-sm">Cancel</button></div>' +
        '<div id="f-msg" class="text-sm"></div>';
      el.appendChild(form);
      document.getElementById('f-cancel').onclick = () => openWorkspace(CTX.orgId, CTX.wsId);
      document.getElementById('f-save').onclick = async () => {
        const msg = document.getElementById('f-msg');
        let views;
        try { views = JSON.parse(document.getElementById('f-views').value || '[]'); if (!Array.isArray(views)) throw 0; }
        catch { msg.className = 'text-sm text-error'; msg.textContent = 'Views must be a JSON array.'; return; }
        const name = document.getElementById('f-title').value.trim() || 'Screen';
        const id = docId || slugify(document.getElementById('f-slug')?.value || name);
        const config = { ...defaultConfig(), ...(payload.config || {}), rotationIntervalSec: Math.max(3, Number(document.getElementById('f-interval').value) || 8) };
        const body = { config, views, announcement: payload.announcement || null };
        const markdown = '\`\`\`json\\n' + JSON.stringify(body, null, 2) + '\\n\`\`\`';
        msg.className = 'text-sm opacity-70'; msg.textContent = 'Saving…';
        try {
          const written = await AIMEAT.organism.writeDraft(CTX.orgId, CTX.wsId, NAMESPACE, id, { title: name, markdown });
          const realId = (written && (written.id || written.instanceId)) || id;
          await AIMEAT.organism.publish(CTX.orgId, CTX.wsId, NAMESPACE, realId);
          await markPublic(realId);
          msg.className = 'text-sm text-success'; msg.textContent = 'Saved + published (public).';
          setTimeout(() => openWorkspace(CTX.orgId, CTX.wsId), 700);
        } catch (e) {
          msg.className = 'text-sm text-error';
          msg.textContent = 'Save failed: ' + (e && e.message || 'error') + (e && e.code === 'CONSENT_REQUIRED' ? ' — you need contributor rights on this workspace.' : '');
        }
      };
    }

    // Mark one screen document public via the share meta (creator/admin only — server enforces).
    async function markPublic(docId) {
      const session = AIMEAT.auth.getSession();
      await session.fetch('/v1/organisms/' + encodeURIComponent(CTX.orgId) + '/workspace/share?ws=' + encodeURIComponent(CTX.wsId), {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ docs: { [SPACE + '/' + docId]: true } }),
      });
    }

    function parsePayload(markdown) {
      let text = String(markdown || '').trim();
      const fence = /\`\`\`json\\s*([\\s\\S]*?)\`\`\`/i.exec(text);
      if (fence) text = fence[1].trim();
      try { const d = JSON.parse(text); return { config: d.config || defaultConfig(), views: Array.isArray(d.views) ? d.views : [], announcement: d.announcement || null }; }
      catch { return { config: defaultConfig(), views: [], announcement: null }; }
    }

    function kioskUrl(docId) {
      // Apps are served at <app>.apps.<apex> (public, no-login). Derive the kiosk app-origin from our
      // own host when we run on one; fall back to the raw served path for dev/standalone.
      const m = /\\.apps\\.(.+)$/.exec(location.hostname);
      const base = m ? (location.protocol + '//signage-kiosk.apps.' + m[1] + '/')
                     : (location.origin + '/apps/signage-kiosk.html');
      return base + '?org=' + encodeURIComponent(CTX.orgId) +
        '&ws=' + encodeURIComponent(CTX.wsId) + '&screen=' + encodeURIComponent(docId);
    }

    // The AGENT face is a prompt, not code. Any MCP agent edits the SAME screen documents.
    function agentPrompt() {
      return [
        'You manage digital signage that lives in an AIMEAT workspace. Use your AIMEAT MCP tools.',
        '',
        'Workspace: organism_id "' + CTX.orgId + '", ws "' + CTX.wsId + '", document space "' + SPACE + '".',
        'A SCREEN is ONE document in that space. Its markdown body is a \`\`\`json fenced payload:',
        '  { "config": { "rotationEnabled": true, "rotationIntervalSec": 8, "theme": "dark", "accentColor": "#1a1a2e" },',
        '    "views": [ { "name": "...", "type": "image|html|url", "content": "<url or HTML>", "weight": 1,',
        '                "activeFrom": "<ISO or omit>", "activeUntil": "<ISO or omit>" } ],',
        '    "announcement": { "body": "...", "priority": "normal|urgent|emergency" } }',
        '',
        'To update a screen:',
        '1. Read it: aimeat_workspace_read { organism_id, ws, ids: ["<screen doc id>"] } (list all with aimeat_workspace_read { organism_id, ws }).',
        '2. Parse the \`\`\`json payload from the document markdown. Change ONLY what was asked (e.g. one view\\'s HTML/content).',
        '3. Write it back: aimeat_workspace_write { organism_id, ws, space: "' + SPACE + '", id: "<screen doc id>",',
        '     value: { title: "<screen name>", markdown: "\`\`\`json\\\\n<the updated payload>\\\\n\`\`\`" } }.',
        '4. Publish: aimeat_workspace_publish { organism_id, ws, namespace: "' + NAMESPACE + '", id: "<screen doc id>" }.',
        '   The published + public document is what the kiosk TV shows. If publish is gated, leave the draft and say so.',
        '',
        'Rules: keep every existing view/field you were not asked to change; the payload MUST stay valid JSON inside the \`\`\`json fence.',
      ].join('\\n');
    }

    // Setup prompt: guides the owner/agent to provision their OWN signage organism + workspace.
    // Gives the EXACT manifest so the agent passes it verbatim (aimeat_workspace_create validates it).
    function setupPrompt() {
      const manifest = {
        manifestVersion: '1.0', id: 'screens', name: 'Screens', kind: 'signage', status: 'active',
        objectTypes: [{
          name: SPACE, schemaRef: 'shared.' + SPACE, namespace: 'shared.' + SPACE,
          backing: 'memory', writeRole: 'member', mode: 'document', contract: CONTRACT,
        }],
      };
      return [
        'Set up a private Digital Signage workspace for me on AIMEAT. Use your AIMEAT MCP tools.',
        '',
        '1. Create an organism I own, name "My Signage", visibility private (aimeat_organism_create).',
        '   It is private to me — no one else can see or edit my signage.',
        '2. In that organism, create a workspace (aimeat_workspace_create) with:',
        '     name: "Screens"',
        '     manifest: ' + JSON.stringify(manifest),
        '3. Grant contributor (read+write) on that workspace to any agent that should edit signage',
        '   (aimeat_workspace_member_grant, role "contributor") — including yourself if you will edit it.',
        '4. Tell me the organism_id and the ws id, so I can open the Signage admin at',
        '   #aimeat-ws=<organism_id>/<ws>.',
        '',
        'Each screen will be one document in the "' + SPACE + '" space; the admin app and you both edit the',
        'SAME documents, and each screen is published publicly so a kiosk TV displays it without logging in.',
      ].join('\\n');
    }

    boot();
  </script>
</body>
</html>
`;

const APP_KIOSK = `<!-- AIMEAT App Manifest
name: Signage Kiosk
version: 2.0.0
description: Full-screen digital signage display — reads one public screen document, no login
entry: index.html
-->
<!--
  @file app-signage-kiosk.html
  @description The KIOSK face of the agent-faced digital signage app (Template 3, documents edition).
    A screen is ONE public workspace document (space "screen", doc id = human-readable slug). Its
    body carries a JSON payload { config, views:[...] }. This page fetches that document over the
    NO-AUTH public endpoint (GET /v1/organisms/:id/workspace/public/document) and rotates the views
    full-screen. There is NO login and NO signage-specific backend: the editable source of truth is
    the same document the admin app + any MCP agent write via aimeat_workspace_write + publish, marked
    public via PUT /workspace/share. The TV only reads.
  @structure boot() -> load(screen) -> render(payload) -> rotate(); polls for changes.
  @usage  https://<node>/apps/signage-kiosk.html?org=<organismId>&ws=<wsId>&screen=<slug>
          (hash form also works: #org=..&ws=..&screen=..)
  @version-history
    v2.0.0 — 2026-07-11 — Rewritten for the workspace-document model (was memory-key kiosk). Public
      document read, client-side rotation, per-view active window + weight, emergency override.
-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Signage</title>
  <style>
    :root { --bg: #101018; --fg: #f5f5fa; --accent: #1a1a2e; --dim: #8a8a9a; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: var(--bg); color: var(--fg);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
    .view { position: absolute; inset: 0; opacity: 0; transition: opacity .6s ease; display: flex;
      align-items: center; justify-content: center; }
    .view.on { opacity: 1; }
    .view img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .view iframe { width: 100%; height: 100%; border: 0; }
    .view .html { width: 100%; height: 100%; overflow: hidden; }
    #banner { position: fixed; left: 0; right: 0; bottom: 0; background: var(--accent);
      padding: 1.2rem 2rem; font-size: 1.6rem; display: none; }
    #banner.urgent { background: #8a5a10; }
    #banner.emergency { background: #7a1515; display: block; }
    #status { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 1rem; text-align: center; padding: 2rem; }
    #status .muted { color: var(--dim); font-size: 1rem; max-width: 40rem; }
    #clock { position: fixed; top: 1.2rem; right: 1.6rem; font-size: 1.4rem; color: var(--dim); }
  </style>
</head>
<body>
  <div id="stage"></div>
  <div id="clock"></div>
  <div id="banner"></div>
  <div id="status">
    <div style="font-size:2rem">Signage</div>
    <div class="muted" id="status-msg">Loading…</div>
  </div>
  <script>
    'use strict';

    // ── config: which screen to show ──────────────────────────────────────
    function params() {
      const q = new URLSearchParams(location.search);
      const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
      const get = (k) => q.get(k) || h.get(k) || '';
      return { org: get('org'), ws: get('ws'), screen: get('screen') };
    }
    const CFG = params();
    const POLL_MS = 30000;   // re-fetch the screen document to pick up edits
    const SPACE = 'screen';  // the document space name in the manifest

    const $ = (id) => document.getElementById(id);
    function showStatus(msg) { $('status').style.display = 'flex'; $('status-msg').textContent = msg; }
    function hideStatus() { $('status').style.display = 'none'; }

    // ── fetch the public screen document (NO AUTH) ────────────────────────
    async function fetchScreen() {
      const url = '/v1/organisms/' + encodeURIComponent(CFG.org) + '/workspace/public/document'
        + '?ws=' + encodeURIComponent(CFG.ws) + '&type=' + encodeURIComponent(SPACE)
        + '&id=' + encodeURIComponent(CFG.screen);
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(r.status === 404 ? 'not-public' : ('http-' + r.status));
      const body = await r.json();
      const doc = body && body.data && body.data.document;
      if (!doc) throw new Error('no-doc');
      return parsePayload(doc.markdown || '');
    }

    // The screen document body is the JSON payload, optionally wrapped in a \`\`\`json fence.
    function parsePayload(markdown) {
      let text = markdown.trim();
      const fence = /\`\`\`json\\s*([\\s\\S]*?)\`\`\`/i.exec(text);
      if (fence) text = fence[1].trim();
      let data;
      try { data = JSON.parse(text); } catch { return { config: {}, views: [] }; }
      return { config: data.config || {}, views: Array.isArray(data.views) ? data.views : [],
        announcement: data.announcement || null };
    }

    // ── render + rotate ───────────────────────────────────────────────────
    let rotateTimer = null, clockTimer = null;

    function activeViews(views) {
      const now = Date.now();
      const inWindow = (v) => (!v.activeFrom || Date.parse(v.activeFrom) <= now)
        && (!v.activeUntil || Date.parse(v.activeUntil) >= now);
      // weight = how many rotation slots a view gets (min 1).
      const list = [];
      for (const v of views.filter(inWindow)) {
        const w = Math.max(1, Number(v.weight) || 1);
        for (let i = 0; i < w; i++) list.push(v);
      }
      return list;
    }

    function makeView(v) {
      const el = document.createElement('div');
      el.className = 'view';
      if (v.type === 'image') {
        const img = document.createElement('img'); img.src = v.content || ''; img.alt = v.name || '';
        el.appendChild(img);
      } else if (v.type === 'url') {
        const f = document.createElement('iframe'); f.src = v.content || '';
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); el.appendChild(f);
      } else { // html
        const box = document.createElement('div'); box.className = 'html'; box.innerHTML = v.content || '';
        el.appendChild(box);
      }
      return el;
    }

    function render(payload) {
      hideStatus();
      const cfg = payload.config || {};
      if (cfg.accentColor) document.documentElement.style.setProperty('--accent', cfg.accentColor);
      if (cfg.theme === 'light') { document.documentElement.style.setProperty('--bg', '#f5f5fa');
        document.documentElement.style.setProperty('--fg', '#101018'); }

      // Emergency / priority banner from an optional announcement.
      const banner = $('banner');
      const a = payload.announcement;
      if (a && a.body) { banner.textContent = a.body; banner.className = a.priority || 'normal';
        banner.style.display = (a.priority === 'emergency' || a.priority === 'urgent') ? 'block' : 'none'; }
      else { banner.style.display = 'none'; }

      const stage = $('stage'); stage.innerHTML = '';
      const views = activeViews(payload.views);
      if (views.length === 0) { showStatus('No active views for this screen.'); return; }

      const nodes = views.map(makeView);
      nodes.forEach((n) => stage.appendChild(n));
      let i = 0;
      const interval = Math.max(3, Number(cfg.rotationIntervalSec) || 8) * 1000;
      const step = () => {
        nodes.forEach((n) => n.classList.remove('on'));
        nodes[i % nodes.length].classList.add('on');
        i++;
      };
      clearInterval(rotateTimer);
      step();
      if (cfg.rotationEnabled !== false && nodes.length > 1) rotateTimer = setInterval(step, interval);
    }

    function startClock() {
      clearInterval(clockTimer);
      const tick = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
      tick(); clockTimer = setInterval(tick, 15000);
    }

    // ── boot + poll ───────────────────────────────────────────────────────
    async function load() {
      try {
        const payload = await fetchScreen();
        render(payload);
      } catch (e) {
        const msg = e && e.message;
        if (msg === 'not-public') showStatus('This screen is not published publicly yet. In the Signage admin, mark it public.');
        else showStatus('Could not load the screen (' + (msg || 'error') + '). Check org / ws / screen.');
      }
    }

    function boot() {
      if (!CFG.org || !CFG.ws || !CFG.screen) {
        showStatus('Missing screen address. Open the kiosk URL with ?org=<id>&ws=<ws>&screen=<slug> (copy it from the Signage admin).');
        return;
      }
      startClock();
      load();
      setInterval(load, POLL_MS);
    }

    boot();
  </script>
</body>
</html>
`;

export function digitalSignagePackage(): ExamplePackageDef {
  return {
    name: 'digital-signage',
    description: 'Agent-faced digital signage: manage screens from the admin app OR from any AI chat/agent, and display them on a kiosk TV with no login. Each screen is one shared workspace document; content lives in your own private organism.',
    category: 'iot',
    tags: ['signage', 'kiosk', 'display', 'agent-faced', 'announcements'],
    visibility: 'public',
    components: [
      { id: 'app-admin', type: 'app', label: 'Signage Admin', content: APP_ADMIN, dependencies: [] },
      { id: 'app-kiosk', type: 'app', label: 'Signage Kiosk', content: APP_KIOSK, dependencies: [] },
    ],
    templateListing: {
      title: 'Digital Signage (agent-faced)',
      description: 'Two apps: a Signage Admin to create and edit screens (also editable by any AIMEAT agent — same documents), and a full-screen Kiosk that shows a screen with no login. Each screen is one public workspace document in your own private organism; the admin guides you to create it on first run.',
      category: 'iot',
      tags: ['signage', 'kiosk', 'display', 'agent-faced'],
    },
  };
}
