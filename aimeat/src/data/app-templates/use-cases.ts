/**
 * @file src/data/app-templates/use-cases.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Full working-scaffold use-case template bodies for the authoring-template registry.
 *   Pure data — each is a complete, customisable app on the Atelier shell (SHELL_ATELIER in
 *   shells.ts): the kit's components in a.main, the session from the shell's onReady, every string
 *   through AIMEAT.atelier.i18n in en and fi, and the level "proto" (the kit as it comes, no genre,
 *   no register owed). {{app}} = memory namespace; {{owner-ghii}} = the owner's GHII. Consumed by
 *   ../app-templates.ts.
 * @structure USECASE_REALTIME_SOCIAL · USECASE_MARKETPLACE · USECASE_HOMEPAGE (re-exported from
 *   use-cases-homepage.ts) · USECASE_APP_IAM
 * @version-history
 *   v2.0.0 — 2026-11-19 — The four templates are on the Atelier shell since the Classic track was
 *     retired: kit components instead of Classic class markup, the session from the shell instead of a
 *     hand-mounted sign-in, en and fi dictionaries. Data keys, visibility and roles are unchanged.
 *     USECASE_HOMEPAGE moved to use-cases-homepage.ts (pure extraction, 800-line limit).
 *   v1.3.0 — 2026-10-09 — USECASE_REALTIME_SOCIAL opens the room socket with a single-use ticket
 *     (POST /v1/ws/ticket) instead of the session JWT in the URL (secrets audit 2026-10-09, d3).
 *   v1.2.0 — 2026-10-01 — USECASE_APP_IAM: roles as a map of role to capabilities, so an approved
 *     member holds "use" and sees the members-only section; a closing-tag order fixed.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 5: USECASE_HOMEPAGE ships the AI disclosure wired —
 *     `<meta name="aimeat-ai">`, AIMEAT.ai.disclose() on the generated draft, and
 *     AIMEAT.ai.declare() on the published post. A builder who starts from this template and
 *     changes nothing is compliant, which is the only version of this that scales.
 *   v1.0.0 — 2026-07-13 — Extracted from src/data/app-templates.ts (max-file-lines)
 */

// ── Use-case: realtime-social (full working scaffold) ────────────────
// A live room: signed-in users join the realtime room for live presence + chat, with durable
// history persisted to public memory (loaded after sign-in; a signed-out visitor sees the shell's
// sign-in card). The kit's crew stack shows who is online and its thread is the conversation.
// Models the proven Presence Board pattern. {{app}} = memory namespace; customise the {{SLOTS}}.

export const USECASE_REALTIME_SOCIAL = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <meta name="aimeat-track" content="atelier" />
  <!-- A quick prototype: the kit's components as they come. Make it "fine" by forking a genre. -->
  <meta name="aimeat-level" content="proto" />
  <meta name="aimeat-register" content="REPLACE-ME: fork a genre from the Design Book (GET /v1/designbook?kind=genre) or name your own register" />
  <meta name="aimeat-locales" content="en fi" />
  <!-- Your published filename, exactly as you publish it. On an app subdomain the page cannot work it out. -->
  <meta name="aimeat-app" content="{{app}}.html" />
  <!-- EVERY scope the app uses; sign-in asks the person to approve these. -->
  <meta name="aimeat-scopes" content="memory:read memory:write social:write" />
  <title>{{App Title}}</title>
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <script>
    // Realtime protocol (server-defined): connect ws with ?room=&ticket=&nick=, send { type:'chat',
    // payload }, receive { type:'chat', sender, payload } broadcast to all (incl. sender). Presence
    // via { type:'joined', peers:[{nick}] } + { type:'participant', action:'join'|'leave', name }.
    var K = AIMEAT.atelier, i18n = K.i18n, t = i18n.t;
    var FEED_KEY = '{{app}}.feed.';     // durable history (loaded after sign-in: memory search needs auth)
    var ROOM = '{{app}}-lobby';
    var session = null, ws = null, me = null;
    var online = {};                    // name -> true
    var messages = [];                  // the thread's rows: { id, who, label, text, at, mine }
    var people = null, talk = null;     // the two kit components on the screen

    i18n.use({
      en: {
        title: '{{App Title}}',
        tagline: 'A live room: see who is here and talk.',
        online: 'Here now',
        nobody: 'Nobody else is here yet',
        room: 'The room',
        say: 'Say something…',
        empty: 'No messages yet',
        emptyHint: 'Write the first one.',
        notLive: 'Not connected to the live room yet.',
        closed: 'The live room closed. Reload the page to join again.',
        failed: 'Could not join the live room'
      },
      fi: {
        title: '{{App Title}}',
        tagline: 'Live-huone: näet, kuka on paikalla, ja voit jutella.',
        online: 'Paikalla nyt',
        nobody: 'Muita ei ole vielä paikalla',
        room: 'Huone',
        say: 'Kirjoita jotain…',
        empty: 'Ei vielä viestejä',
        emptyHint: 'Kirjoita ensimmäinen.',
        notLive: 'Yhteys live-huoneeseen ei ole vielä auki.',
        closed: 'Live-huone sulkeutui. Lataa sivu uudelleen, niin pääset takaisin.',
        failed: 'Live-huoneeseen liittyminen ei onnistunut'
      }
    });

    // The shell: bar, sign-in pill, language and theme controls, designed states. Sign-in is on by
    // default, so onReady runs with a session and a signed-out visitor sees the sign-in card.
    var a = K.app({
      title: t('title'),
      tagline: t('tagline'),
      look: 'vivid',
      onReady: function (s) { session = s; me = s.owner; render(); joinLive(); },
      onLogout: function () { if (ws) ws.close(); session = null; }
    });

    function crewData() {
      var names = Object.keys(online);
      return { people: names.map(function (n) { return { id: n, label: n }; }), live: names.length };
    }

    function render() {
      if (people) people.destroy();
      if (talk) talk.destroy();
      people = K.crew({ target: a.main, title: t('online'), data: crewData(), empty: { title: t('nobody') } });
      talk = K.thread({
        target: a.main,
        title: t('room'),
        placeholder: t('say'),
        data: { messages: messages },
        onSend: send,
        empty: { title: t('empty'), hint: t('emptyHint') }
      });
    }

    function addMessage(by, text, at) {
      messages.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        who: by, label: by, text: text, at: at || new Date().toISOString(), mine: by === me
      });
      if (talk) talk.set({ data: { messages: messages } });
    }
    function renderPresence() { if (people) people.set({ data: crewData() }); }

    async function loadHistory() {
      try {
        var hits = await AIMEAT.data.search(FEED_KEY);   // search needs auth -> history loads after sign-in
        hits.sort(function (x, y) { return (x.at || '').localeCompare(y.at || ''); });
        var earlier = hits.map(function (m, i) {
          return { id: 'h' + i, who: m.by, label: m.by, text: m.text, at: m.at, mine: m.by === me };
        });
        messages = earlier.concat(messages);   // live lines that arrived meanwhile stay after the history
        if (talk) talk.set({ data: { messages: messages } });
      } catch (e) { /* an empty history is fine */ }
    }

    async function joinLive() {
      loadHistory();   // durable history (needs auth)
      try {
        var room = (await session.fetch('/v1/realtime/rooms', { method: 'POST', body: JSON.stringify({ name: ROOM }) })).data;
        // ws_url already has ?room=ID. A browser WebSocket can't set headers, and a JWT in the URL ends up
        // in proxy logs, so trade it for a single-use 60-second ticket and pass that + nick as query.
        var ticket = (await session.fetch('/v1/ws/ticket', { method: 'POST', body: JSON.stringify({ socket: 'realtime' }) })).data.ticket;
        var wsUrl = location.origin.replace(/^http/, 'ws') + room.ws_url + '&ticket=' + encodeURIComponent(ticket) + '&nick=' + encodeURIComponent(me);
        ws = new WebSocket(wsUrl);
      } catch (e) {
        a.status('error', { title: t('failed'), hint: String((e && e.message) || e), onRetry: function () { a.status('none'); joinLive(); } });
        return;
      }
      ws.onmessage = function (e) {
        var d = JSON.parse(e.data);
        if (d.type === 'joined') { (d.peers || []).forEach(function (p) { online[p.nick] = true; }); online[me] = true; renderPresence(); }
        else if (d.type === 'participant') { if (d.action === 'join') online[d.name] = true; else if (d.action === 'leave') delete online[d.name]; renderPresence(); }
        else if (d.type === 'chat') { addMessage(d.sender, d.payload); }   // server echoes to all incl. sender
      };
      ws.onclose = function () {
        online = {}; renderPresence();
        if (session) K.toast({ title: t('closed'), tone: 'warn' });
      };
    }

    // The thread's composer calls this; Enter sends.
    function send(text) {
      text = String(text || '').trim();
      if (!text) return;
      if (!ws || ws.readyState !== 1) { K.toast({ title: t('notLive'), tone: 'warn' }); return; }
      ws.send(JSON.stringify({ type: 'chat', payload: text }));   // live: the server echoes back, then we render
      var id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      AIMEAT.data.set(FEED_KEY + id, { by: me, text: text, at: new Date().toISOString() }, { visibility: 'public' });  // durable
    }

    // The bar's language switch: new words, same conversation.
    i18n.onChange(function () { a.set({ title: t('title') }); if (session) render(); });
  </script>
</body>
</html>`;

// ── Use-case: marketplace — single-seller storefront (full working scaffold) ─────────────────
// Anyone browses + searches the seller's public listings and opens a detail view; the SELLER
// (OWNER) posts listings with an uploaded image. All listings live in ONE public key
// ({{app}}.listings) under the owner's GHII, so anon can read them via getPublic (the only
// anon-accessible memory read — there is no anon search). For a MULTI-seller marketplace use a
// server extension for the shared store. The kit's hero, searchBar and cardGrid are the browsing
// screen; a dialog holds the detail and the post form. {{app}} = memory namespace.

export const USECASE_MARKETPLACE = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <meta name="aimeat-track" content="atelier" />
  <!-- A quick prototype: the kit's components as they come. Make it "fine" by forking a genre. -->
  <meta name="aimeat-level" content="proto" />
  <meta name="aimeat-register" content="REPLACE-ME: fork a genre from the Design Book (GET /v1/designbook?kind=genre) or name your own register" />
  <meta name="aimeat-locales" content="en fi" />
  <!-- Your published filename, exactly as you publish it. On an app subdomain the page cannot work it out. -->
  <meta name="aimeat-app" content="{{app}}.html" />
  <!-- EVERY scope the app uses; sign-in asks the person to approve these. -->
  <meta name="aimeat-scopes" content="memory:read memory:write storage:read storage:write" />
  <title>{{App Title}}</title>
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-storage.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <script>
    var K = AIMEAT.atelier, i18n = K.i18n, t = i18n.t;
    var OWNER = '{{owner-ghii}}';        // the seller's GHII (owner@node-id) — anyone reads listings from here
    var LISTINGS_KEY = '{{app}}.listings';
    var session = null, all = [], query = '';
    var parts = [], grid = null;         // the components on the screen, destroyed before a repaint
    var gridEmpty = '';                  // which empty state the grid was built with

    i18n.use({
      en: {
        title: '{{App Title}}',
        tagline: '{{What is for sale, in one line}}',
        post: 'Post a listing',
        search: 'Search listings',
        empty: 'No listings yet',
        emptyHint: 'Come back soon.',
        emptySeller: 'Post the first one with the button above.',
        noMatch: 'Nothing matched',
        noMatchHint: 'Try another word.',
        seller: 'Seller: {who}',
        close: 'Close',
        fTitle: 'Title',
        fPrice: 'Price',
        fPriceHint: 'For example 20 €',
        fDesc: 'Description',
        fImage: 'Picture',
        fImageHint: 'Drop an image here, or press to pick one.',
        cancel: 'Cancel',
        publish: 'Publish',
        published: 'The listing is published.',
        failed: 'Could not publish'
      },
      fi: {
        title: '{{App Title}}',
        tagline: '{{Mitä myydään, yhdellä rivillä}}',
        post: 'Lisää ilmoitus',
        search: 'Hae ilmoituksista',
        empty: 'Ei vielä ilmoituksia',
        emptyHint: 'Tule pian uudelleen.',
        emptySeller: 'Lisää ensimmäinen yllä olevalla painikkeella.',
        noMatch: 'Mikään ei osunut',
        noMatchHint: 'Kokeile toista sanaa.',
        seller: 'Myyjä: {who}',
        close: 'Sulje',
        fTitle: 'Otsikko',
        fPrice: 'Hinta',
        fPriceHint: 'Esimerkiksi 20 €',
        fDesc: 'Kuvaus',
        fImage: 'Kuva',
        fImageHint: 'Pudota kuva tähän tai valitse se painamalla.',
        cancel: 'Peru',
        publish: 'Julkaise',
        published: 'Ilmoitus on julkaistu.',
        failed: 'Julkaisu ei onnistunut'
      }
    });

    // Everyone browses, so sign-in is off: onReady runs at once (session or null), and a session
    // that arrives later (a restore that finished late, a sign-in from the bar) reaches onSession.
    var a = K.app({
      title: t('title'),
      tagline: t('tagline'),
      look: 'vivid',
      requireLogin: false,
      onReady: function (s) { if (s) maybeEnablePosting(s); render(); load(); },
      onSession: function (s) { maybeEnablePosting(s); render(); load(); },   // sets OWNER for the owner's own preview, then loads again as them
      onLogout: function () { session = null; render(); }
    });

    function isSeller() { return !!session && session.ghii === OWNER; }
    function filtered() {
      var q = query.toLowerCase().trim();
      if (!q) return all;
      return all.filter(function (it) { return ((it.title || '') + ' ' + (it.desc || '')).toLowerCase().indexOf(q) !== -1; });
    }

    function render() {
      parts.forEach(function (p) { p.destroy(); });
      parts = [];
      parts.push(K.hero({
        target: a.main, title: t('title'), sub: t('tagline'), variant: 'compact',
        actions: isSeller() ? [{ id: 'post', label: t('post'), kind: 'primary', onClick: openPost }] : []
      }));
      parts.push(K.searchBar({ target: a.main, value: query, placeholder: t('search'), label: t('search'), onChange: function (q) { query = q; paint(); } }));
      grid = null;
      paint();
    }

    // The grid shows the filtered listings through set(), so a search moves the cards rather than
    // rebuilding them. It is built again only when its empty state has to say something else:
    // "nothing matched" while searching, "no listings yet" otherwise.
    function paint() {
      var items = filtered().map(function (it) { return { id: it.id, title: it.title, sub: it.price || '', image: it.imageUrl || undefined }; });
      var empty = query ? 'search' : 'none';
      if (grid && empty === gridEmpty) { grid.set({ items: items }); return; }
      if (grid) { grid.destroy(); parts.splice(parts.indexOf(grid), 1); }
      gridEmpty = empty;
      grid = K.cardGrid({
        target: a.main,
        items: items,
        onPick: function (card) { openDetail(card.id); },
        empty: query
          ? { title: t('noMatch'), hint: t('noMatchHint') }
          : { title: t('empty'), hint: isSeller() ? t('emptySeller') : t('emptyHint') }
      });
      parts.push(grid);
    }

    function openDetail(id) {
      var it = all.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      var d = K.dialog({
        title: it.title,
        size: 'roomy',
        body: function (host) {
          K.mediaCard({ target: host, item: { id: it.id, title: it.price || it.title, sub: t('seller', { who: it.by || '' }), image: it.imageUrl || undefined } });
          if (it.desc) host.appendChild(K.el('p', { class: 'ak-section__hint', text: it.desc }));
        },
        actions: [{ id: 'close', label: t('close'), run: function () { d.close(); } }]
      });
    }

    async function load() {
      try {
        var arr = await AIMEAT.data.getPublic(OWNER, LISTINGS_KEY);   // anon-readable single public key
        all = Array.isArray(arr) ? arr.slice() : [];
        all.sort(function (x, y) { return (y.at || '').localeCompare(x.at || ''); });
      } catch (e) { all = []; }
      paint();
    }

    // ── posting (only the seller = OWNER can post; writes go to OWNER's own public key) ──
    function maybeEnablePosting(s) {
      session = s;
      if (OWNER.indexOf('{{') === 0 && s.ghii) OWNER = s.ghii;   // owner-preview convenience before the GHII is baked in
    }

    function openPost() {
      var form = null, picked = null, saving = false;
      var d = K.dialog({
        title: t('post'),
        size: 'roomy',
        body: function (host) {
          form = K.form({
            target: host,
            submit: false,   // the dialog's own Publish button sends it
            fields: [
              { name: 'title', label: t('fTitle'), required: true },
              { name: 'price', label: t('fPrice'), hint: t('fPriceHint'), width: 'short' },
              { name: 'desc', label: t('fDesc'), type: 'textarea' }
            ]
          });
          // The kit's drop zone picks the file; it is uploaded on Publish, never before.
          K.dropzone({ target: host, accept: ['image/*'], label: t('fImage'), hint: t('fImageHint'), onFiles: function (files) { picked = files[0] || null; } });
        },
        actions: [
          { id: 'cancel', label: t('cancel'), run: function () { d.close(); } },
          { id: 'publish', label: t('publish'), tone: 'primary', run: publish }
        ]
      });
      // Publish stays held, with the missing fields named, until the form is right.
      form.gate(d.el.querySelector('[data-ak-action="publish"]'));

      async function publish() {
        if (saving || !form.ready()) return;
        saving = true;
        try {
          var imageUrl = '';
          if (picked) {
            var up = await AIMEAT.storage.upload(picked, { visibility: 'public' });
            imageUrl = '/v1/pub/' + encodeURIComponent(session.ghii) + '/' + encodeURIComponent(up.key);
          }
          var v = form.values();
          var listing = {
            id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
            title: String(v.title || '').trim(),
            price: String(v.price || '').trim(),
            desc: String(v.desc || '').trim(),
            imageUrl: imageUrl, by: session.ghii, at: new Date().toISOString()
          };
          var next = [listing].concat(all);
          await AIMEAT.data.set(LISTINGS_KEY, next, { visibility: 'public' });   // one public key holds all listings
          all = next;
          d.close();
          paint();
          K.toast({ title: t('published'), tone: 'ok' });
        } catch (e) {
          K.toast({ title: t('failed'), sub: String((e && e.message) || e), tone: 'err' });
        }
        saving = false;
      }
    }

    // The bar's language switch: new words, same listings and the same search.
    i18n.onChange(function () { a.set({ title: t('title') }); if (grid) render(); });
  </script>
</body>
</html>`;

// ── Use-case: homepage / personal site ── in use-cases-homepage.ts (moved by pure extraction
// when this file passed the 800-line limit), re-exported here so the registry's import is unchanged.
export { USECASE_HOMEPAGE } from './use-cases-homepage.js';

// ── Use-case: app-iam (members, roles and an owner panel) ────────────
// An app with its OWN member community. The NODE keeps who is a member — it notifies them, keeps the
// list private, and moves their free access with their role — and this app keeps what a role may do.
// Six apps on this node each built this by hand before the platform had it, and disagreed six ways;
// this is that work done once. The kit draws it over AIMEAT.iam: accessState is the members-only
// area (with the ask for everybody else), members is the owner's roster. {{app}} = memory namespace.

export const USECASE_APP_IAM = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: {{app-name}}
version: 1.0.0
description: {{one-line description — REQUIRED for publishing}}
entry: index.html
-->
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <meta name="aimeat-track" content="atelier" />
  <!-- A quick prototype: the kit's components as they come. Make it "fine" by forking a genre. -->
  <meta name="aimeat-level" content="proto" />
  <meta name="aimeat-register" content="REPLACE-ME: fork a genre from the Design Book (GET /v1/designbook?kind=genre) or name your own register" />
  <meta name="aimeat-locales" content="en fi" />
  <!-- Your published filename, exactly as you publish it. On an app subdomain the page cannot work it out. -->
  <meta name="aimeat-app" content="{{app}}.html" />
  <!-- EVERY scope the app uses; sign-in asks the person to approve these. -->
  <meta name="aimeat-scopes" content="memory:read memory:write" />
  <title>{{App Title}}</title>
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-iam.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <script>
    var K = AIMEAT.atelier, i18n = K.i18n, t = i18n.t;
    var APP = '{{owner}}/{{app}}.html';        // the app whose roster the node keeps
    // The node keeps the roster; ROLES is this app's own vocabulary, which the node does not own:
    // each role and what it may do. One click on Approve in the owner's panel grants the role with
    // the least power, here member.
    var ROLES = { member: ['use'], admin: ['use', 'manage'] };
    var session = null, parts = [], round = 0;

    i18n.use({
      en: {
        title: '{{App Title}}',
        aboutTitle: '{{What this app is}}',
        aboutText: '{{One paragraph anyone may read, member or not.}}',
        lockedTitle: '{{The paid or private surface}}',
        privateTitle: '{{The paid or private surface}}',
        privateHint: '{{What a member does here}}',
        doIt: '{{Do the thing}}',
        result: 'Result',
        denied: 'You do not have access to that.'
      },
      fi: {
        title: '{{App Title}}',
        aboutTitle: '{{Mikä tämä sovellus on}}',
        aboutText: '{{Kappale, jonka kuka tahansa saa lukea, jäsen tai ei.}}',
        lockedTitle: '{{Maksullinen tai yksityinen osa}}',
        privateTitle: '{{Maksullinen tai yksityinen osa}}',
        privateHint: '{{Mitä jäsen tekee täällä}}',
        doIt: '{{Tee se}}',
        result: 'Tulos',
        denied: 'Sinulla ei ole pääsyä tähän.'
      }
    });

    // What everyone sees comes first, so sign-in is off: an app that shows a stranger nothing but a
    // refusal gives them no way to judge whether it is worth asking for. onReady runs at once
    // (session or null); a session that arrives later reaches onSession.
    var a = K.app({
      title: t('title'),
      tagline: t('aboutText'),
      look: 'calm-card',
      requireLogin: false,
      onReady: function (s) { boot(s); },
      onSession: function (s) { boot(s); },
      onLogout: function () { boot(null); }
    });

    async function boot(s) {
      session = s;
      var mine = ++round;   // a later boot wins over one still waiting for the node
      parts.forEach(function (p) { p.destroy(); });
      parts = [];

      // What everyone sees.
      parts.push(K.section({ target: a.main, title: t('aboutTitle'), hint: t('aboutText') }));

      var me = null;
      if (s) me = await AIMEAT.iam.init({ app: APP, roles: ROLES });
      if (mine !== round) return;

      // Members only. accessState decides what to PAINT: for a role that holds "use" (and for the
      // owner) it draws render(); for everybody else it draws the ask, and the OWNER is notified,
      // with Approve and Decline on their bell, so a request does not depend on them opening this
      // page. The extension decides what is allowed.
      parts.push(K.accessState({
        target: a.main, app: APP, roles: ROLES, cap: 'use', title: t('lockedTitle'),
        render: function (host) {
          var out = null;
          K.mediaCard({
            target: host,
            item: { id: 'private', title: t('privateTitle'), sub: t('privateHint') },
            actions: [{ id: 'do', label: t('doIt'), kind: 'primary', onClick: function () { doIt(out); } }]
          });
          out = K.section({ target: host, title: t('result') });
        }
      }));

      // Owner only: roster, approvals, free access, and this app's own settings in one place.
      if (me && me.isOwner) {
        parts.push(K.members({
          target: a.main,
          app: APP,
          roles: ROLES,
          // Your own settings belong in the panel owners already open, not a second admin screen.
          sections: [
            // { id: 'x', type: 'toggle', label: t('aSetting'), value: true, onChange: function (v) { AIMEAT.data.set('{{app}}.settings.x', v); } },
          ]
        }));
      }
    }

    async function doIt(out) {
      // guard() asks the SERVER before running, so a role revoked while this page was open refuses
      // instead of proceeding on a stale answer.
      var ran = await AIMEAT.iam.guard('use', async function () {
        return await AIMEAT.data.get('{{app}}.something');
      });
      K.clear(out.body);
      out.body.appendChild(K.el('pre', { text: ran === undefined ? t('denied') : JSON.stringify(ran, null, 2) }));
    }

    // The bar's language switch: the page is drawn again in the new words.
    i18n.onChange(function () { a.set({ title: t('title') }); boot(session); });
  </script>
</body>
</html>`;
