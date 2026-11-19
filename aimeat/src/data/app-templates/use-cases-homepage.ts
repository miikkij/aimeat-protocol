/**
 * @file src/data/app-templates/use-cases-homepage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The homepage use-case template body (template id usecase-homepage), on the Atelier
 *   shell. Moved out of use-cases.ts by pure extraction when that file passed the 800-line limit;
 *   use-cases.ts re-exports it, so ../app-templates.ts imports it from the same place as before.
 * @structure USECASE_HOMEPAGE
 * @usage import { USECASE_HOMEPAGE } from './use-cases.js';
 * @version-history
 *   v2.0.0 — 2026-11-19 — Moved here from use-cases.ts, on the Atelier shell since the Classic
 *     track was retired. Earlier history of this template is in use-cases.ts.
 */

// ── Use-case: homepage / personal site (full working scaffold) ───────
// A single-writer public site: anyone views the owner's profile + blog/feed; the OWNER edits the
// profile and publishes posts (markdown body, optional image, optional AI-written draft). Profile
// + posts live in public keys read via getPublic (anon-readable). The kit's hero is the profile,
// its doc block renders the markdown, and a dialog holds each edit form.
// {{app}} = memory namespace; {{owner-ghii}} = the owner's GHII.

export const USECASE_HOMEPAGE = `<!DOCTYPE html>
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
  <!-- EVERY scope the app uses; sign-in asks the person to approve these. ai:use lets the owner's
       "Write with AI" button spend their AI budget. -->
  <meta name="aimeat-scopes" content="memory:read memory:write storage:read storage:write ai:use" />
  <!-- What this app does with a model. The catalogue reads it, and it is what makes the app
       EU-transparency-ready without its author reading Article 50. -->
  <meta name="aimeat-ai" content="generates=text; discloses=yes; public-interest=no" />
  <title>{{App Title}}</title>
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-storage.js"></script>
  <script src="/v1/libs/aimeat-ai.js"></script>
  <script src="/v1/libs/aimeat-markdown.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <script>
    var K = AIMEAT.atelier, i18n = K.i18n, t = i18n.t;
    var OWNER = '{{owner-ghii}}';        // the site owner's GHII (owner@node-id) — content is read from here
    var PROFILE_KEY = '{{app}}.profile';
    var POSTS_KEY = '{{app}}.posts';
    var session = null, profile = {}, posts = [], aiOk = false;
    var parts = [];                      // the components on the screen, destroyed before a repaint

    i18n.use({
      en: {
        title: '{{App Title}}',
        yourName: '{{Your name}}',
        edit: 'Edit profile',
        post: 'New post',
        noPosts: 'No posts yet',
        noPostsOwner: 'Write the first one with New post.',
        pName: 'Your name',
        pBio: 'Bio',
        pBioHint: 'Markdown works here.',
        pAvatar: 'Picture',
        fTitle: 'Title',
        fIdea: 'Idea for the AI',
        fIdeaHint: 'Optional. Without it the AI writes about the title.',
        fBody: 'Text',
        fBodyHint: 'Markdown: ## heading, **bold**, - lists, links, images.',
        fImage: 'Picture',
        dropHint: 'Drop an image here, or press to pick one.',
        ai: 'Write with AI',
        aiWriting: 'The AI is writing…',
        aiNeedIdea: 'Type a title or an idea first.',
        aiFailed: 'The AI could not write the draft',
        cancel: 'Cancel',
        save: 'Save',
        publish: 'Publish',
        saved: 'Saved.',
        published: 'The post is published.',
        failed: 'Could not save'
      },
      fi: {
        title: '{{App Title}}',
        yourName: '{{Nimesi}}',
        edit: 'Muokkaa profiilia',
        post: 'Uusi kirjoitus',
        noPosts: 'Ei vielä kirjoituksia',
        noPostsOwner: 'Kirjoita ensimmäinen painamalla Uusi kirjoitus.',
        pName: 'Nimesi',
        pBio: 'Esittely',
        pBioHint: 'Voit käyttää Markdownia.',
        pAvatar: 'Kuva',
        fTitle: 'Otsikko',
        fIdea: 'Aihe tekoälylle',
        fIdeaHint: 'Vapaaehtoinen. Ilman sitä tekoäly kirjoittaa otsikon aiheesta.',
        fBody: 'Teksti',
        fBodyHint: 'Markdown: ## otsikko, **lihavointi**, - luettelo, linkit, kuvat.',
        fImage: 'Kuva',
        dropHint: 'Pudota kuva tähän tai valitse se painamalla.',
        ai: 'Kirjoita tekoälyllä',
        aiWriting: 'Tekoäly kirjoittaa…',
        aiNeedIdea: 'Kirjoita ensin otsikko tai aihe.',
        aiFailed: 'Tekoäly ei saanut luonnosta kirjoitettua',
        cancel: 'Peru',
        save: 'Tallenna',
        publish: 'Julkaise',
        saved: 'Tallennettu.',
        published: 'Kirjoitus on julkaistu.',
        failed: 'Tallennus ei onnistunut'
      }
    });

    // Everyone reads, so sign-in is off: onReady runs at once (session or null), and a session
    // that arrives later (a restore that finished late, a sign-in from the bar) reaches onSession.
    var a = K.app({
      title: t('title'),
      look: 'editorial',
      requireLogin: false,
      onReady: function (s) { session = s; applyOwnerUi(); load(); },
      onSession: function (s) { session = s; applyOwnerUi(); load(); },
      onLogout: function () { session = null; aiOk = false; render(); }
    });

    function isOwner() { return !!session && session.ghii === OWNER; }
    function upload(file) {
      return AIMEAT.storage.upload(file, { visibility: 'public' }).then(function (up) {
        return '/v1/pub/' + encodeURIComponent(session.ghii) + '/' + encodeURIComponent(up.key);
      });
    }

    function render() {
      parts.forEach(function (p) { p.destroy(); });
      parts = [];
      // The profile is the page's one hero; the owner's two actions sit on it.
      parts.push(K.hero({
        target: a.main,
        title: profile.name || t('yourName'),
        image: profile.avatarUrl || undefined,
        variant: 'center',
        actions: isOwner() ? [
          { id: 'edit', label: t('edit'), kind: 'ghost', onClick: openProfile },
          { id: 'post', label: t('post'), kind: 'primary', onClick: openPost }
        ] : []
      }));
      if (profile.bio) parts.push(K.doc({ target: a.main, markdown: profile.bio, variant: 'plain' }));
      if (!posts.length) {
        parts.push(K.emptyState({ target: a.main, title: t('noPosts'), hint: isOwner() ? t('noPostsOwner') : undefined }));
        return;
      }
      posts.forEach(function (p) {
        var s = K.section({ target: a.main, title: p.title, hint: (p.at || '').slice(0, 10) });
        if (p.imageUrl) K.mediaCard({ target: s.body, item: { id: p.id, title: p.title, image: p.imageUrl } });
        K.doc({ target: s.body, markdown: p.body || '', variant: 'plain' });
        parts.push(s);
      });
    }

    async function load() {
      try { profile = (await AIMEAT.data.getPublic(OWNER, PROFILE_KEY)) || {}; } catch (e) { profile = {}; }
      try { var pp = await AIMEAT.data.getPublic(OWNER, POSTS_KEY); posts = Array.isArray(pp) ? pp.slice() : []; } catch (e) { posts = []; }
      posts.sort(function (x, y) { return (y.at || '').localeCompare(x.at || ''); });
      render();
    }

    // ── owner editing ──
    function applyOwnerUi() {
      if (OWNER.indexOf('{{') === 0 && session && session.ghii) OWNER = session.ghii; // owner-preview before the GHII is baked in
      aiOk = false;
      if (isOwner()) AIMEAT.ai.isAvailable().then(function (ok) { aiOk = !!ok; });
    }

    function openProfile() {
      var form = null, picked = null, saving = false;
      var d = K.dialog({
        title: t('edit'),
        size: 'roomy',
        body: function (host) {
          form = K.form({
            target: host,
            submit: false,
            fields: [
              { name: 'name', label: t('pName'), value: profile.name || '' },
              { name: 'bio', label: t('pBio'), hint: t('pBioHint'), type: 'textarea', value: profile.bio || '' }
            ]
          });
          K.dropzone({ target: host, accept: ['image/*'], label: t('pAvatar'), hint: t('dropHint'), onFiles: function (files) { picked = files[0] || null; } });
        },
        actions: [
          { id: 'cancel', label: t('cancel'), run: function () { d.close(); } },
          { id: 'save', label: t('save'), tone: 'primary', run: save }
        ]
      });

      async function save() {
        if (saving) return;
        saving = true;
        try {
          var avatarUrl = profile.avatarUrl || '';
          if (picked) avatarUrl = await upload(picked);
          var v = form.values();
          profile = { name: String(v.name || '').trim(), bio: String(v.bio || ''), avatarUrl: avatarUrl };
          await AIMEAT.data.set(PROFILE_KEY, profile, { visibility: 'public' });
          d.close(); render();
          K.toast({ title: t('saved'), tone: 'ok' });
        } catch (e) { K.toast({ title: t('failed'), sub: String((e && e.message) || e), tone: 'err' }); }
        saving = false;
      }
    }

    function openPost() {
      var form = null, picked = null, saving = false, writing = false;
      var draftProvenance = null;   // set when the model writes the draft; attached to the saved post
      var label = null;             // the AI label lands here. Empty until the model writes something.
      var actions = [{ id: 'cancel', label: t('cancel'), run: function () { d.close(); } }];
      if (aiOk) actions.push({ id: 'ai', label: t('ai'), run: writeWithAi });
      actions.push({ id: 'publish', label: t('publish'), tone: 'primary', run: publish });
      var d = K.dialog({
        title: t('post'),
        size: 'wide',
        body: function (host) {
          form = K.form({
            target: host,
            submit: false,
            fields: [
              { name: 'title', label: t('fTitle'), required: true },
              { name: 'idea', label: t('fIdea'), hint: t('fIdeaHint') },
              { name: 'body', label: t('fBody'), hint: t('fBodyHint'), type: 'textarea' }
            ]
          });
          label = K.el('div');
          host.appendChild(label);
          K.dropzone({ target: host, accept: ['image/*'], label: t('fImage'), hint: t('dropHint'), onFiles: function (files) { picked = files[0] || null; } });
        },
        actions: actions
      });
      form.gate(d.el.querySelector('[data-ak-action="publish"]'));

      async function writeWithAi() {
        if (writing) return;
        var v = form.values();
        var idea = String(v.idea || '').trim() || String(v.title || '').trim();
        if (!idea) { form.setError('idea', t('aiNeedIdea')); return; }
        writing = true;
        K.toast({ title: t('aiWriting'), ttl: 2500 });
        try {
          var r = await AIMEAT.ai.complete({ prompt: 'Write a short, engaging blog post in markdown about: ' + idea, app_id: '{{app}}' });
          form.setValues({ body: r.content });
          // The reader is entitled to know a model wrote this. One call; it draws nothing when no
          // label is owed, and it follows this app's own theme.
          draftProvenance = r.provenance;
          AIMEAT.ai.disclose(r.provenance, { target: label });
        } catch (e) { K.toast({ title: t('aiFailed'), sub: String((e && e.message) || e), tone: 'err' }); }
        writing = false;
      }

      async function publish() {
        if (saving || !form.ready()) return;
        saving = true;
        try {
          var imageUrl = picked ? await upload(picked) : '';
          var v = form.values();
          var post = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), title: String(v.title || '').trim(), body: String(v.body || ''), imageUrl: imageUrl, at: new Date().toISOString() };
          // The record travels WITH the post, so a reader of the stored data still knows how it was
          // made. declare() returns a copy; it leaves the original alone.
          if (draftProvenance) post = AIMEAT.ai.declare(post, draftProvenance);
          var next = [post].concat(posts);
          await AIMEAT.data.set(POSTS_KEY, next, { visibility: 'public' });
          posts = next;
          d.close(); render();
          K.toast({ title: t('published'), tone: 'ok' });
        } catch (e) { K.toast({ title: t('failed'), sub: String((e && e.message) || e), tone: 'err' }); }
        saving = false;
      }
    }

    // The bar's language switch: new words, same profile and posts.
    i18n.onChange(function () { a.set({ title: t('title') }); if (parts.length) render(); });
  </script>
</body>
</html>`;
