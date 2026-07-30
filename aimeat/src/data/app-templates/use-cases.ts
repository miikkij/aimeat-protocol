/**
 * @file src/data/app-templates/use-cases.ts
 * @description Full working-scaffold use-case template bodies for the authoring-template registry.
 *   Pure data — each composes app-shells + components into a complete, customisable app.
 *   {{app}} = memory namespace; {{owner-ghii}} = the owner's GHII. Consumed by ../app-templates.ts.
 * @structure USECASE_REALTIME_SOCIAL · USECASE_MARKETPLACE · USECASE_HOMEPAGE · USECASE_APP_IAM
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/data/app-templates.ts (max-file-lines)
 */

// ── Use-case: realtime-social (full working scaffold) ────────────────
// A live room: logged-in users join the realtime room for live presence + chat, with durable
// history persisted to public memory (loaded after login; anon sees the login prompt). Composes
// realtime-room + shared-feed + auth-gated. Models the proven Presence Board pattern.
// {{app}} = memory namespace; customise the {{SLOTS}}.

export const USECASE_REALTIME_SOCIAL = `<!DOCTYPE html>
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

export const USECASE_MARKETPLACE = `<!DOCTYPE html>
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

// ── Use-case: homepage / personal site (full working scaffold) ───────
// A single-writer public site: anyone views the owner's profile + blog/feed; the OWNER edits the
// profile and publishes posts (markdown body, optional image, optional AI-written draft). Profile
// + posts live in public keys read via getPublic (anon-readable). Composes markdown + image-upload
// + ai-action + auth-gated. {{app}} = memory namespace; {{owner-ghii}} = the owner's GHII.

export const USECASE_HOMEPAGE = `<!DOCTYPE html>
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
        var r = await AIMEAT.ai.complete({ prompt: 'Write a short, engaging blog post in markdown about: ' + idea, app_id: '{{app}}' });
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

// ── Use-case: app-iam (members, roles and an owner panel) ────────────
// An app with its OWN member community. The NODE keeps who is a member — it notifies them, keeps the
// list private, and moves their free access with their role — and this app keeps what a role may do.
// Six apps on this node each built this by hand before the platform had it, and disagreed six ways;
// this is that work done once. {{app}} = memory namespace.

export const USECASE_APP_IAM = `<!DOCTYPE html>
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
  <meta name="aimeat-scopes" content="memory:read memory:write" />
  <title>{{App Title}}</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">{{App Title}}</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>

  <main class="max-w-3xl mx-auto p-4 flex flex-col gap-4">
    <!-- What everyone sees. Keep something here: an app that shows a stranger nothing but a refusal
         gives them no way to judge whether it is worth asking for. -->
    <section class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">{{What this app is}}</h2>
      <p class="text-sm opacity-70">{{One paragraph anyone may read, member or not.}}</p>
    </section></div>

    <!-- Members only. can() decides what to PAINT; the extension decides what is allowed. -->
    <section id="members-only" hidden class="card bg-base-200 shadow"><div class="card-body">
      <h2 class="card-title">{{The paid or private surface}}</h2>
      <button id="do-it" class="btn btn-primary self-start">{{Do the thing}}</button>
      <pre id="out" class="text-xs mt-2"></pre>
    </div></section>

    <!-- Shown to anyone who is not yet a member. The OWNER is notified, with Approve and Decline
         on their bell, so a request does not depend on them opening this page. -->
    <div id="join"></div>

    <!-- Owner only: roster, approvals, free access, and this app's own settings in one place. -->
    <div id="members"></div>
  </main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-iam.js"></script>
  <script>
    var APP = '{{owner}}/{{app}}.html';        // the app whose roster the node keeps
    var session = null;

    async function boot(s) {
      session = s;
      // The node keeps the roster; \`roles\` is this app's own vocabulary, which the node does not own.
      var me = await AIMEAT.iam.init({ app: APP, roles: ['member', 'admin'] });

      // A HINT for painting. The gate is server-side: enforce in the action that mutates data.
      AIMEAT.iam.gate('#members-only', 'use');
      document.getElementById('join').hidden = me.member || me.isOwner;
      if (!me.member && !me.isOwner) AIMEAT.iam.JoinPanel({ target: '#join' });

      if (me.isOwner) {
        AIMEAT.iam.MemberAdmin({
          target: '#members',
          appId: APP,
          // Your own settings belong in the panel owners already open, not a second admin screen.
          sections: [
            // { id: 'x', type: 'toggle', label: '{{A setting}}', value: true, onChange: function (v) { AIMEAT.data.set('{{app}}.settings.x', v); } },
          ],
        });
      }
    }

    document.getElementById('do-it').addEventListener('click', async function () {
      // guard() asks the SERVER before running, so a role revoked while this page was open refuses
      // instead of proceeding on a stale answer.
      var ran = await AIMEAT.iam.guard('use', async function () {
        return await AIMEAT.data.get('{{app}}.something');
      });
      document.getElementById('out').textContent = ran === undefined
        ? 'You do not have access to that.'
        : JSON.stringify(ran, null, 2);
    });

    AIMEAT.auth.mountLoginButton('#login', { onLogin: boot, onLogout: function () { location.reload(); } });
    AIMEAT.auth.login().then(function (s) { if (s) boot(s); });
  </script>
</body>
</html>`;

