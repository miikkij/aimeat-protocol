/**
 * @file aimeat-marketplace-package.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installable package "aimeat-marketplace" — a MULTI-SELLER marketplace. Delivered as
 *   a package (like aimeat-iam): installing it registers a per-instance scoped extension + app
 *   (`aimeat-marketplace-{owner}-{shortId}-…`), so each install is an independent storefront.
 *
 *   Why a package (not a single-file app): a multi-seller marketplace needs a SHARED, multi-writer,
 *   anon-readable catalog. On AIMEAT the only anon memory read is getPublic(gaii, key) (no anon
 *   search), and app-origin apps (role 'app') cannot write to any shared native surface (boards
 *   need agent/owner role). A sandboxed extension is the one thing app-origin apps CAN invoke
 *   (POST /v1/ext/:name/:action needs only auth) that writes a shared namespace server-side
 *   (ext:{name} memory is stored public → anon reads it via getPublic). So:
 *     - extension `marketplace` — owns the shared listings store; actions post / remove.
 *         post:   any authed user publishes a listing; seller = ctx.caller.gaii.
 *         remove: a seller removes their OWN listing (server-enforced by caller match).
 *     - app `marketplace` — anon browses + searches + opens detail (reads ext:marketplace/listings
 *         via getPublic); logged-in users post with an uploaded image and remove their own.
 *   Install rewrites `marketplace` → the scoped name in both /v1/ext/… and "ext:…" refs
 *   (component-registrar.rewriteComponentRefs).
 * @version-history
 *   v1.0.0 — 2026-06-26 — initial: extension (post/remove) + multi-seller storefront app.
 *   v1.0.1 — 2026-07-30 — action schemas were declared as `input_schema:`/`output_schema:`, but the
 *     extension manifest parser reads `input:`/`output:` (routes/extensions/manifest.ts), so both
 *     schemas were dropped silently and every install advertised an action with no schema. Renamed
 *     to the keys the parser and the authoring prompt actually document. Same bug in
 *     aimeat-iam-package.ts; found while fixing nuotta-iam (TARGET-055).
 */
import type { ExamplePackageDef } from './example-packages.js';

// ── Extension `marketplace` — shared multi-writer store (V8 sandbox: export default async (ctx, input)) ──
// The app generates id + at and passes them in, so the sandbox needs no Date/Math.

const SCRIPT_POST = `export default async function (ctx, input) {
  if (!input || !input.title) return { ok: false, error: 'title required' };
  var listings = (await ctx.memory.get('listings')) || [];
  var listing = {
    id: String(input.id || (listings.length + '-' + (input.at || ''))),
    title: String(input.title).slice(0, 200),
    price: String(input.price || '').slice(0, 60),
    desc: String(input.desc || '').slice(0, 4000),
    imageUrl: String(input.imageUrl || '').slice(0, 500),
    seller: (ctx.caller && ctx.caller.gaii) || null,
    at: String(input.at || '')
  };
  listings.unshift(listing);
  if (listings.length > 500) listings = listings.slice(0, 500);   // cap the shared store
  await ctx.memory.set('listings', listings);
  return { ok: true, id: listing.id };
}`;

const SCRIPT_REMOVE = `export default async function (ctx, input) {
  var caller = (ctx.caller && ctx.caller.gaii) || null;
  var id = input && input.id;
  if (!id) return { ok: false, error: 'id required' };
  var listings = (await ctx.memory.get('listings')) || [];
  var before = listings.length;
  // Server-enforced: only the seller can remove their own listing.
  listings = listings.filter(function (l) { return !(l.id === id && l.seller === caller); });
  await ctx.memory.set('listings', listings);
  return { ok: true, removed: before - listings.length };
}`;

const EXTENSION_MARKETPLACE = JSON.stringify({
  manifest: [
    'metadata:',
    '  name: marketplace',
    '  version: 1.0.0',
    '  description: Multi-seller marketplace shared store (listings).',
    '  author: operator',
    'required_apis:',
    '  - memory',
    'actions:',
    '  - id: post',
    '    method: POST',
    '    path: /post',
    '    description: Publish a listing. Any authenticated user; the seller is the caller.',
    '    input: { type: object, properties: { title: { type: string }, price: { type: string }, desc: { type: string }, imageUrl: { type: string }, id: { type: string }, at: { type: string } }, required: [title] }',
    '    output: { type: object, properties: { ok: { type: boolean }, id: { type: string } } }',
    '    script: post.js',
    '  - id: remove',
    '    method: POST',
    '    path: /remove',
    '    description: Remove your own listing by id (server-enforced by caller match).',
    '    input: { type: object, properties: { id: { type: string } }, required: [id] }',
    '    output: { type: object, properties: { ok: { type: boolean }, removed: { type: number } } }',
    '    script: remove.js',
  ].join('\n'),
  scripts: {
    'post.js': SCRIPT_POST,
    'remove.js': SCRIPT_REMOVE,
  },
});

// ── App `marketplace` — multi-seller storefront (calls /v1/ext/marketplace/*, reads ext:marketplace) ──

const APP_MARKETPLACE = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: marketplace
version: 1.0.0
description: A multi-seller marketplace — browse + search listings, log in to post your own.
entry: index.html
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Marketplace</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50 gap-2">
    <div class="flex-1 min-w-0"><span class="text-lg font-bold">Marketplace</span></div>
    <input id="search" class="input input-bordered input-sm w-40 sm:w-64" placeholder="Search…" />
    <button id="post-btn" class="btn-primary px-4" hidden>+ Post</button>
    <span id="login"></span>
  </nav>

  <main class="flex-1 w-full max-w-5xl mx-auto p-4">
    <div id="grid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div>
    <div id="empty" class="text-center opacity-60 py-16" hidden>No listings yet.</div>
  </main>

  <div id="detail" class="fixed inset-0 bg-black/60 z-50 hidden items-center justify-center p-4" style="display:none">
    <div class="card bg-base-200 max-w-lg w-full max-h-[90vh] overflow-y-auto"><div id="detail-body" class="card-body"></div></div>
  </div>

  <div id="post" class="fixed inset-0 bg-black/60 z-50 hidden items-center justify-center p-4" style="display:none">
    <form id="post-form" class="card bg-base-200 max-w-md w-full"><div class="card-body gap-3">
      <h3 class="text-lg font-bold">Post a listing</h3>
      <input id="f-title" class="input input-bordered" placeholder="Title" required />
      <input id="f-price" class="input input-bordered" placeholder="Price (e.g. 20 €)" />
      <textarea id="f-desc" class="textarea textarea-bordered" placeholder="Description" rows="3"></textarea>
      <input id="f-image" type="file" accept="image/*" class="file-input file-input-bordered" />
      <div class="flex gap-2 justify-end">
        <button type="button" id="post-cancel" class="btn-ghost px-4">Cancel</button>
        <button type="submit" id="post-submit" class="btn-primary px-6">Publish</button>
      </div>
    </div></form>
  </div>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-storage.js"></script>
  <script>
    var EXT = '/v1/ext/marketplace';     // rewritten to the scoped instance name on install
    var NS = 'ext:marketplace';          // rewritten too — the shared listings namespace
    var session = null, all = [];
    var gridEl = document.getElementById('grid'), emptyEl = document.getElementById('empty');

    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function show(id) { document.getElementById(id).style.display = 'flex'; }
    function hide(id) { document.getElementById(id).style.display = 'none'; }
    function extCall(action, body) {
      return fetch(EXT + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (session && session.jwt) },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); });
    }
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
      var mine = session && it.seller && it.seller === session.ghii;
      document.getElementById('detail-body').innerHTML =
        (it.imageUrl ? '<img src="' + esc(it.imageUrl) + '" class="rounded-lg w-full object-contain max-h-80 mb-3" />' : '') +
        '<h2 class="text-xl font-bold">' + esc(it.title) + '</h2>' +
        '<div class="text-primary font-bold text-lg my-1">' + esc(it.price || '') + '</div>' +
        '<p class="whitespace-pre-wrap opacity-90">' + esc(it.desc || '') + '</p>' +
        '<div class="text-xs opacity-60 mt-3">Seller: ' + esc(it.seller || '') + '</div>' +
        '<div class="flex justify-between mt-4">' +
        (mine ? '<button class="btn-danger px-4" id="rm-btn">Remove</button>' : '<span></span>') +
        '<button class="btn-ghost px-4" onclick="document.getElementById(\\'detail\\').style.display=\\'none\\'">Close</button></div>';
      if (mine) document.getElementById('rm-btn').onclick = function () { removeListing(it.id); };
      show('detail');
    }

    async function load() {
      try { var arr = await AIMEAT.data.getPublic(NS, 'listings'); all = Array.isArray(arr) ? arr.slice() : []; }
      catch (e) { all = []; }
      all.sort(function (a, b) { return (b.at || '').localeCompare(a.at || ''); });
      render();
    }
    document.getElementById('search').addEventListener('input', render);

    async function removeListing(id) {
      try { var r = await extCall('remove', { id: id }); if (r && r.data && r.data.ok) { hide('detail'); await load(); } }
      catch (e) { alert('Could not remove: ' + (e.message || e)); }
    }

    document.getElementById('post-btn').onclick = function () { show('post'); };
    document.getElementById('post-cancel').onclick = function () { hide('post'); };
    document.getElementById('post-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var btn = document.getElementById('post-submit'); btn.disabled = true; btn.textContent = 'Publishing…';
      try {
        var imageUrl = '';
        var fi = document.getElementById('f-image');
        if (fi.files[0]) { var up = await AIMEAT.storage.upload(fi.files[0], { visibility: 'public' }); imageUrl = '/v1/pub/' + encodeURIComponent(session.ghii) + '/' + encodeURIComponent(up.key); }
        var r = await extCall('post', {
          id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          at: new Date().toISOString(),
          title: document.getElementById('f-title').value.trim(),
          price: document.getElementById('f-price').value.trim(),
          desc: document.getElementById('f-desc').value.trim(),
          imageUrl: imageUrl
        });
        var d = (r && r.data) || {};
        if (!d.ok) throw new Error(d.error || 'post failed');
        document.getElementById('post-form').reset(); hide('post'); await load();
      } catch (e) { alert('Could not publish: ' + (e.message || e)); }
      btn.disabled = false; btn.textContent = 'Publish';
    });

    var booted = false;
    function applySession(s) { session = s; document.getElementById('post-btn').hidden = false; }
    function tryAuth() { if (booted) return; var s = AIMEAT.auth.getSession && AIMEAT.auth.getSession(); if (s && s.jwt) { booted = true; applySession(s); } }
    AIMEAT.auth.mountLoginButton('#login', { onLogin: function () { tryAuth(); }, onLogout: function () { location.reload(); } });
    var _iv = setInterval(function () { tryAuth(); if (booted) clearInterval(_iv); }, 300);
    tryAuth();
    load();   // everyone browses (anon reads the public shared store)
  </script>
</body>
</html>`;

// ── Package definition ───────────────────────────────────────────────

export function aimeatMarketplacePackage(): ExamplePackageDef {
  return {
    name: 'aimeat-marketplace',
    description: 'A multi-seller marketplace. Anyone browses + searches listings and opens a detail view; logged-in users post their own listings with an uploaded image and remove them. A sandboxed extension owns the shared, multi-writer listings store (server-enforced ownership); the app reads it publicly so even anonymous visitors see the catalog. Install creates your own independent storefront instance.',
    category: 'marketplace',
    tags: ['marketplace', 'listings', 'multi-seller', 'storefront', 'commerce', 'extension'],
    visibility: 'public',
    components: [
      { id: 'extension-marketplace', type: 'extension', label: 'Marketplace Store Extension', content: EXTENSION_MARKETPLACE, dependencies: [] },
      { id: 'app-marketplace', type: 'app', label: 'Marketplace', content: APP_MARKETPLACE, dependencies: ['extension-marketplace'] },
    ],
    templateListing: {
      title: 'aimeat-marketplace — Multi-seller Marketplace',
      description: 'A turnkey multi-seller marketplace: anonymous visitors browse, search, and open listings; logged-in users post their own items with photos and remove them. A sandboxed extension owns the shared listings store and enforces that sellers can only remove their own posts — solving the multi-writer + anonymous-read problem a single-file app cannot. Install to get your own independent storefront.',
      category: 'marketplace',
      tags: ['marketplace', 'listings', 'multi-seller', 'storefront', 'commerce'],
    },
  };
}
