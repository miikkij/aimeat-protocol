/**
 * @file businesslauncher-package.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installable package "businesslauncher" — a shop that exists after one approval.
 *   Installing it registers four components under the owner's own identity: the shop front (opens
 *   with no account), the back office, the sandboxed shop engine that holds stock and reservations,
 *   and the cortex lib both apps reach the engine through.
 *
 *   NOTHING IS SEEDED INTO THE INSTALLER'S MEMORY. Products, prices and pages live in the owner's
 *   OWN organism as workspace records, and the back office finds that workspace by the CONTRACT its
 *   manifest declares rather than by a stored id. An app cannot create an organism (role 'app' may
 *   not), so the back office hands the owner a setup prompt for that one step — the same shape the
 *   signage admin uses.
 *
 *   THE APPS NEVER CALL /v1/ext/. An app may only ask for the scopes in the app-grant vocabulary and
 *   there is no `ext:` word in it; reaching an extension is cortex's job. The app trusts cortex,
 *   cortex trusts the extension, and no layer skips the one below.
 *
 *   GENERATED FILE — do not edit by hand. Edit the sources in packages/businesslauncher/ and re-run
 *   `node packages/build-businesslauncher-pkg.mjs`.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */
import type { ExamplePackageDef } from './example-packages.js';

const APP_SHOP = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: Shop
version: 1.0.0
description: The shop front — what is for sale, what is left, the terms, and a way to get in touch. Opens without an account.
entry: index.html
-->
<!--
  @file app-shop.html
  @description The PUBLIC face of a BUSINESSLAUNCHER shop. Everything a visitor needs to decide is
    readable with no account: the catalogue, how many are left, the delivery and privacy terms, and
    a contact form. Signing in is asked for at exactly one moment — taking a hold on something.

    IT READS, IT DOES NOT DECIDE. The shelf number on a card is a display value from a public
    mirror; the record that decides a sale is private and is read inside the same compare-and-swap
    that takes the units. So a card can be a moment out of date and still never oversell: the
    refusal comes from the shop, not from this page.

    Everything goes through AIMEAT.shop (the cortex lib). This app never calls /v1/ext/ itself.
  @structure boot -> loadPublic -> renderGrid -> openItem -> hold | renderPage | contact
  @usage published app; the address a person gives out is their company's front page.
  @version-history
    v1.0.0 — 2026-08-23 — Initial (TARGET-070).
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- The reads need no session at all. The one scope is for the moment a buyer takes a hold: an
       app grant needs a word, and this is the narrowest one the vocabulary has. -->
  <meta name="aimeat-scopes" content="memory:read" />
  <title>Shop</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-40 gap-2">
    <div class="flex-1 min-w-0">
      <span id="shop-name" class="text-lg font-bold truncate">Shop</span>
    </div>
    <input id="search" class="input input-bordered input-sm w-32 sm:w-64" placeholder="Search" />
    <button id="lang" class="btn-ghost px-3 text-sm">FI</button>
    <span id="login"></span>
  </nav>

  <main class="flex-1 w-full max-w-5xl mx-auto p-4">
    <div id="notice" class="alert mb-4" hidden></div>
    <div id="grid" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"></div>
    <div id="empty" class="text-center opacity-60 py-16" hidden></div>
  </main>

  <footer class="bg-base-200 mt-8 px-4 py-6 text-sm">
    <div class="max-w-5xl mx-auto flex flex-wrap gap-4 items-center">
      <button data-page="delivery" class="btn-ghost px-2 page-link" hidden></button>
      <button data-page="terms" class="btn-ghost px-2 page-link" hidden></button>
      <button data-page="privacy" class="btn-ghost px-2 page-link" hidden></button>
      <button id="contact-btn" class="btn-ghost px-2" hidden></button>
      <span id="updated" class="opacity-60 ml-auto"></span>
    </div>
  </footer>

  <!-- One overlay, three uses: an item, a policy page, the contact form. -->
  <div id="overlay" class="fixed inset-0 bg-black/60 z-50 items-center justify-center p-4" style="display:none">
    <div class="card bg-base-200 max-w-lg w-full max-h-[90vh] overflow-y-auto">
      <div id="overlay-body" class="card-body gap-3"></div>
    </div>
  </div>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-intake.js"></script>
  <script src="/v1/cortex/businesslauncher-shop/libs/businesslauncher-shop.js"></script>
  <script>
  (function () {
    'use strict';

    var T = {
      en: {
        empty: 'Nothing is for sale here yet.',
        left: 'left', soldOut: 'Sold out', hold: 'Hold one while I pay',
        holding: 'Held for you', signIn: 'Sign in to hold this', close: 'Close',
        contact: 'Get in touch', send: 'Send', sent: 'Thank you. We will be in touch.',
        name: 'Your name', email: 'Your email', message: 'What would you like to ask?',
        delivery: 'Delivery', terms: 'Terms', privacy: 'Privacy',
        writtenBy: 'Written by', updated: 'Updated', offline: 'This shop is not set up yet.',
      },
      fi: {
        empty: 'Täällä ei ole vielä mitään myynnissä.',
        left: 'jäljellä', soldOut: 'Loppu', hold: 'Varaa yksi maksun ajaksi',
        holding: 'Varattu sinulle', signIn: 'Kirjaudu varataksesi', close: 'Sulje',
        contact: 'Ota yhteyttä', send: 'Lähetä', sent: 'Kiitos. Palaamme asiaan.',
        name: 'Nimesi', email: 'Sähköpostisi', message: 'Mitä haluaisit kysyä?',
        delivery: 'Toimitusehdot', terms: 'Ehdot', privacy: 'Tietosuoja',
        writtenBy: 'Kirjoittanut', updated: 'Päivitetty', offline: 'Tätä kauppaa ei ole vielä otettu käyttöön.',
      },
    };
    var lang = (navigator.language || 'en').slice(0, 2) === 'fi' ? 'fi' : 'en';
    function t(k) { return (T[lang] && T[lang][k]) || T.en[k] || k; }

    var session = null, cat = null, avail = {}, pages = null, items = [];
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function money(n, currency) {
      if (n == null || isNaN(Number(n))) return '';
      return (Number(n) / 100).toFixed(2) + ' ' + (currency || '');
    }

    function openOverlay(html) { $('overlay-body').innerHTML = html; $('overlay').style.display = 'flex'; }
    function closeOverlay() { $('overlay').style.display = 'none'; }
    $('overlay').onclick = function (e) { if (e.target === $('overlay')) closeOverlay(); };

    function unitsFor(sku) { var n = avail && avail[sku]; return typeof n === 'number' ? n : null; }

    function render() {
      var q = $('search').value.toLowerCase().trim();
      var shown = items.filter(function (it) {
        if (!q) return true;
        return ((it.name || '') + ' ' + (it.description || '')).toLowerCase().indexOf(q) !== -1;
      });
      $('empty').hidden = shown.length > 0;
      $('empty').textContent = cat ? t('empty') : t('offline');
      var grid = $('grid');
      grid.innerHTML = '';
      shown.forEach(function (it) {
        var left = unitsFor(it.sku);
        var card = document.createElement('div');
        card.className = 'card bg-base-200 shadow cursor-pointer hover:ring-2 hover:ring-primary transition';
        card.innerHTML =
          (it.image
            ? '<figure class="aspect-square overflow-hidden"><img src="' + esc(it.image) + '" alt="" class="w-full h-full object-cover" /></figure>'
            : '<figure class="aspect-square bg-base-300 flex items-center justify-center text-4xl opacity-40">·</figure>') +
          '<div class="card-body p-3 gap-1">' +
          '<h3 class="font-semibold text-sm truncate">' + esc(it.name) + '</h3>' +
          '<div class="text-primary font-bold text-sm">' + esc(money(it.priceMinor, cat && cat.currency)) + '</div>' +
          '<div class="text-xs opacity-70">' + (left === null ? '' : (left > 0 ? left + ' ' + t('left') : t('soldOut'))) + '</div>' +
          '</div>';
        card.onclick = function () { openItem(it); };
        grid.appendChild(card);
      });
    }

    function openItem(it) {
      var left = unitsFor(it.sku);
      var canHold = left === null || left > 0;
      openOverlay(
        (it.image ? '<img src="' + esc(it.image) + '" alt="" class="rounded-lg w-full object-contain max-h-72" />' : '') +
        '<h2 class="text-xl font-bold">' + esc(it.name) + '</h2>' +
        '<div class="text-primary font-bold text-lg">' + esc(money(it.priceMinor, cat && cat.currency)) + '</div>' +
        '<p class="whitespace-pre-wrap opacity-90">' + esc(it.description || '') + '</p>' +
        '<div class="text-sm opacity-70">' + (left === null ? '' : (left > 0 ? left + ' ' + t('left') : t('soldOut'))) + '</div>' +
        '<div id="hold-msg" class="text-sm"></div>' +
        '<div class="flex gap-2 justify-end pt-2">' +
        '<button id="ov-close" class="btn-ghost px-4">' + esc(t('close')) + '</button>' +
        (canHold ? '<button id="ov-hold" class="btn-primary px-4">' + esc(session ? t('hold') : t('signIn')) + '</button>' : '') +
        '</div>'
      );
      $('ov-close').onclick = closeOverlay;
      if (canHold) {
        $('ov-hold').onclick = function () { takeHold(it); };
      }
    }

    async function takeHold(it) {
      var msg = $('hold-msg');
      if (!session) {
        try { session = await AIMEAT.auth.login(); } catch (err) { session = null; }
        if (!session) { msg.className = 'text-sm text-warning'; msg.textContent = t('signIn'); return; }
      }
      $('ov-hold').disabled = true;
      var res = await AIMEAT.shop.reserve(session, { sku: it.sku, qty: 1, minutes: 15 })
        .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; });
      if (res && res.ok) {
        msg.className = 'text-sm text-success';
        msg.textContent = t('holding') + ' · ' + res.reservationId;
        // The shelf moved, so the page should say so rather than keep the number it opened with.
        await loadAvailability();
        render();
      } else {
        msg.className = 'text-sm text-error';
        msg.textContent = (res && res.error) || t('soldOut');
        $('ov-hold').disabled = false;
      }
    }

    function openPage(name) {
      var page = pages && pages[name];
      if (!page) return;
      openOverlay(
        '<h2 class="text-xl font-bold">' + esc(page.title || name) + '</h2>' +
        '<div class="whitespace-pre-wrap opacity-90">' + esc(page.markdown) + '</div>' +
        '<div class="text-xs opacity-60 pt-2">' + esc(t('writtenBy')) + ': ' + esc(page.writtenBy || '') + '</div>' +
        '<div class="flex justify-end pt-2"><button id="ov-close" class="btn-ghost px-4">' + esc(t('close')) + '</button></div>'
      );
      $('ov-close').onclick = closeOverlay;
    }

    function openContact() {
      var form = cat && cat.contact;
      if (!form) return;
      openOverlay(
        '<h2 class="text-xl font-bold">' + esc(t('contact')) + '</h2>' +
        '<input id="c-name" class="input input-bordered" placeholder="' + esc(t('name')) + '" />' +
        '<input id="c-email" type="email" class="input input-bordered" placeholder="' + esc(t('email')) + '" />' +
        '<textarea id="c-msg" rows="4" class="textarea textarea-bordered" placeholder="' + esc(t('message')) + '"></textarea>' +
        '<div id="c-result" class="text-sm"></div>' +
        '<div class="flex gap-2 justify-end pt-2">' +
        '<button id="ov-close" class="btn-ghost px-4">' + esc(t('close')) + '</button>' +
        '<button id="c-send" class="btn-primary px-4">' + esc(t('send')) + '</button></div>'
      );
      $('ov-close').onclick = closeOverlay;
      $('c-send').onclick = async function () {
        $('c-send').disabled = true;
        try {
          // Public Intake is the ONE anonymous-write path on this node, and the submission lands as
          // a record owned by the shop rather than by whoever filled the form in.
          await AIMEAT.intake.submit(form.org, form.ws, form.formId, {
            name: $('c-name').value, email: $('c-email').value, message: $('c-msg').value,
          });
          $('c-result').className = 'text-sm text-success';
          $('c-result').textContent = t('sent');
        } catch (err) {
          $('c-result').className = 'text-sm text-error';
          $('c-result').textContent = String(err && err.message || err);
          $('c-send').disabled = false;
        }
      };
    }

    async function loadAvailability() {
      var a = await AIMEAT.shop.availability();
      avail = (a && a.units) || {};
    }

    async function boot() {
      $('lang').textContent = lang === 'fi' ? 'EN' : 'FI';
      $('lang').onclick = function () { lang = lang === 'fi' ? 'en' : 'fi'; paint(); };
      $('search').oninput = render;

      var meta = await AIMEAT.shop.shop();
      if (meta && meta.name) $('shop-name').textContent = meta.name;

      cat = await AIMEAT.shop.catalog();
      items = (cat && Array.isArray(cat.items)) ? cat.items : [];
      pages = await AIMEAT.shop.pages();
      await loadAvailability();

      // A session may already exist (the app-origin bridge). Not having one is normal and costs
      // the visitor nothing until they reach for a hold.
      try { session = await AIMEAT.auth.login(); } catch (err) { session = null; }

      paint();
    }

    function paint() {
      $('lang').textContent = lang === 'fi' ? 'EN' : 'FI';
      $('updated').textContent = cat && cat.updated ? t('updated') + ' ' + String(cat.updated).slice(0, 10) : '';
      Array.prototype.forEach.call(document.querySelectorAll('.page-link'), function (btn) {
        var name = btn.getAttribute('data-page');
        var has = !!(pages && pages[name]);
        btn.hidden = !has;
        if (has) { btn.textContent = t(name); btn.onclick = function () { openPage(name); }; }
      });
      var contactBtn = $('contact-btn');
      contactBtn.hidden = !(cat && cat.contact);
      contactBtn.textContent = t('contact');
      contactBtn.onclick = openContact;
      render();
    }

    boot();
  })();
  </script>
</body>
</html>
`;

const APP_BACK_OFFICE = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: Back office
version: 1.0.0
description: Where the shop is run: products, prices, what is on the shelf, the terms, the enquiries that came in, and the prompt that lets any AI chat do the same work.
entry: index.html
-->
<!--
  @file app-back-office.html
  @description The OWNER's face of a BUSINESSLAUNCHER shop.

    IT OPENS ON WHAT IS MISSING. The first run is a conversation that can be interrupted, and the
    records are the state, so this page is the resume: it lists what is not done yet, in order, and
    a person who closed the chat halfway finishes here instead of starting again.

    THE WORKSPACE IS FOUND BY CONTRACT, NOT BY A STORED ID. It scans the owner's organisms for a
    workspace whose manifest declares \`contract: 'shop'\` — one match opens, none shows the setup
    prompt, several ask which. An app cannot create an organism (role 'app' may not), so the setup
    step hands the owner a prompt their own AI runs once. Same shape as the signage admin.

    Everything reaching the shop engine goes through AIMEAT.shop. This app never calls /v1/ext/.
  @structure boot -> pickWorkspace | renderSetup -> renderHome (what is missing) -> tabs
  @usage published app; launch with #aimeat-ws=<org>/<ws> or let it find the workspace.
  @version-history
    v1.0.0 — 2026-08-23 — Initial (TARGET-070).
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="aimeat-scopes" content="memory:read memory:write organism:read organism:write" />
  <title>Back office</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <nav class="navbar bg-base-200 px-4 shadow-sm gap-2">
    <div class="flex-1 min-w-0"><span class="text-lg font-bold">Back office</span>
      <span id="ws-name" class="opacity-60 text-sm ml-2"></span></div>
    <button id="agent-prompt" class="btn-outline px-3 text-sm" hidden>Copy agent prompt</button>
    <span id="login"></span>
  </nav>

  <div id="tabs" class="tabs tabs-bordered px-4 pt-3" hidden>
    <button class="tab tab-active" data-tab="home">To do</button>
    <button class="tab" data-tab="products">Products</button>
    <button class="tab" data-tab="stock">Shelf</button>
    <button class="tab" data-tab="pages">Pages</button>
    <button class="tab" data-tab="enquiries">Enquiries</button>
  </div>

  <main id="app" class="flex-1 w-full max-w-4xl mx-auto p-4"></main>

  <!-- The crew-defs this app ships with. They travel with the package and wait for a runtime:
       deploying one is a pointer task onto the owner's own fleet, which is not part of this node.
       Read at install time by the component registrar (app-bundled-crews.ts). -->
  <script type="application/json" id="aimeat-crews">
  [
    {
      "agent_name": "shopkeeper",
      "readme_md": "# Shopkeeper\\n\\nThe interview, run by an agent instead of by a form.\\n\\nIt asks what you sell and who buys it, one question at a time, in your language, and writes the answers straight into the shop as they land. It does not fill a blank with something that merely sounds right: what you did not say is left out, which matters most for delivery promises and anything a buyer would rely on.\\n\\n**It never touches money.** Attaching a card and publishing anything public stay with you.",
      "tags": ["businesslauncher", "shop", "interview"],
      "process": "sequential",
      "agents": [
        {
          "role": "Interviewer",
          "goal": "Find out what this person actually sells and who buys it, by asking rather than by guessing.",
          "backstory": "You have spent years helping people describe the thing they do every day, which they are too close to explain. You ask short questions and you wait. You talk to the person in whatever language they write to you in. You never fill a blank with something that merely sounds right: a fact you were not told is a fact you leave out, and that discipline is the whole difference between a shop a buyer can trust and a brochure.",
          "allow_delegation": false
        },
        {
          "role": "Catalogue writer",
          "goal": "Turn what the interview found into products a stranger can understand, stating only what was established.",
          "backstory": "You write the few lines somebody reads before deciding to buy. You name what the thing is, who it is for, and what arrives. An unstated delivery time is an absent line, not a promise of next-day.",
          "allow_delegation": false
        }
      ],
      "tasks": [
        {
          "id": "interview",
          "description": "Interview the owner about what they sell and who buys it. Their own words and context: {{ctx.prompt}}\\n\\nAsk about, roughly in this order and following whatever they raise: what they sell; who buys it and why; whether there is already a list of products somewhere; what a buyer needs to know before deciding; how it reaches the buyer; what it costs and why. Speak to them in their own language. Ask, do not lecture, and stop when you have enough rather than when you have asked everything.",
          "expected_output": "A record of what the person actually said, organised by those areas, with anything they did not answer marked explicitly as not established.",
          "agent": "Interviewer"
        },
        {
          "id": "catalogue",
          "description": "Turn the interview into a product list. Emit a single JSON object shaped {\\"currency\\":\\"EUR\\",\\"items\\":[{sku,name,description,priceMinor,unit}]}. Prices are in minor units (cents). Leave out anything the interview did not establish rather than inventing it.",
          "expected_output": "One JSON object with a currency and an items array, and nothing else.",
          "agent": "Catalogue writer",
          "context": ["interview"]
        }
      ]
    },
    {
      "agent_name": "pricer",
      "readme_md": "# Pricer\\n\\nKeeps the price lists.\\n\\nA shop usually needs more than one: what a person pays, what a trade buyer pays, and what an agent pays per call. This one writes and maintains them, and keeps them in step with the catalogue.\\n\\n**It can set a price. It cannot attach a card, and it cannot list anything publicly.**",
      "tags": ["businesslauncher", "shop", "pricing"],
      "process": "sequential",
      "agents": [
        {
          "role": "Pricer",
          "goal": "Keep the shop's price lists correct, in step with the catalogue, and explainable.",
          "backstory": "You have priced things for people who were about to undercharge. You work from what the thing costs to make and what comparable things go for, and you say which of the two a number came from. You never move a price without saying what moved it.",
          "allow_delegation": false
        }
      ],
      "tasks": [
        {
          "id": "price",
          "description": "Write or update the shop's price lists from the owner's own words: {{ctx.prompt}}\\n\\nProduce a retail list, and a trade list only if the owner sells to trade. Emit JSON shaped {\\"lists\\":[{\\"id\\",\\"label\\",\\"currency\\",\\"validFrom\\",\\"rows\\":[{sku,amountMinor,unit}]}]}. Every row names a sku that exists in the catalogue. Say beside each list what the numbers are based on.",
          "expected_output": "One JSON object with a lists array, plus a short plain sentence per list saying what its numbers rest on.",
          "agent": "Pricer"
        }
      ]
    },
    {
      "agent_name": "scout",
      "readme_md": "# Scout\\n\\nFinds out what comparable things cost, and puts the source next to every number.\\n\\nA figure with no source is an opinion, and this one does not produce those. Where the node can contract a company-register capability it uses it; where it cannot, it says so instead of guessing.\\n\\nRuns on a clock only if you switch it on: it spends tokens, and that is your decision.",
      "tags": ["businesslauncher", "shop", "research"],
      "process": "sequential",
      "agents": [
        {
          "role": "Scout",
          "goal": "Find what comparable things really cost, and make every number checkable.",
          "backstory": "You have watched people price against a competitor they imagined. You look for what is actually published, you quote it with its address and the date you read it, and where you found nothing you write that you found nothing. A number without a source does not go in.",
          "allow_delegation": false
        }
      ],
      "tasks": [
        {
          "id": "research",
          "description": "Research what comparable offerings cost, for this shop: {{ctx.prompt}}\\n\\nUse the capabilities this node can actually reach. Where a company-register capability is contractable, use it; where it is not, say so rather than guessing. Emit JSON shaped {\\"quarter\\":\\"YYYY-Qn\\",\\"findings\\":[{claim,number,unit,source,readAt}]}.",
          "expected_output": "One JSON object with a findings array in which every entry carries a source and the date it was read.",
          "agent": "Scout"
        }
      ]
    }
  ]
  </script>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-intake.js"></script>
  <script src="/v1/cortex/businesslauncher-shop/libs/businesslauncher-shop.js"></script>
  <script>
  (function () {
    'use strict';

    var CONTRACT = 'shop';
    var SPACES = { catalog: 'catalog', pricing: 'pricing', policy: 'policy', leads: 'leads' };

    var session = null, CTX = null, shopMeta = null, tab = 'home';
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function app() { return $('app'); }
    function say(html) { app().innerHTML = html; }

    // ── boot ────────────────────────────────────────────────────────────────
    async function boot() {
      AIMEAT.auth.on('login', function () { start(); });
      session = await AIMEAT.auth.login().catch(function () { return null; });
      if (!session) { say('<p class="opacity-70">Sign in to run your shop.</p>'); return; }
      start();
    }

    var started = false;
    async function start() {
      if (started) return; started = true;
      session = await AIMEAT.auth.login().catch(function () { return null; });
      if (!session) { started = false; return; }

      var launch = /#aimeat-ws=([^/]+)\\/([^&]+)/.exec(location.hash);
      if (launch) return openWorkspace(launch[1], launch[2]);

      var candidates = await findWorkspaces();
      if (candidates.length === 1) return openWorkspace(candidates[0].org, candidates[0].ws);
      if (candidates.length === 0) return renderSetup();
      say('<h2 class="text-lg font-bold mb-3">Which shop?</h2>' + candidates.map(function (c, i) {
        return '<button class="btn-outline w-full justify-start mb-2 px-4" data-pick="' + i + '">' + esc(c.label) + '</button>';
      }).join(''));
      Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function (b) {
        b.onclick = function () { var c = candidates[Number(b.getAttribute('data-pick'))]; openWorkspace(c.org, c.ws); };
      });
    }

    /** Every workspace of the owner's whose manifest declares this contract. */
    async function findWorkspaces() {
      var out = [];
      var orgs = await AIMEAT.organism.list().catch(function () { return []; });
      for (var i = 0; i < orgs.length; i++) {
        var wss = await AIMEAT.organism.workspaces(orgs[i].id).catch(function () { return []; });
        for (var j = 0; j < wss.length; j++) {
          if (wss[j].access === 'none') continue;
          var ws = await AIMEAT.organism.read(orgs[i].id, wss[j].id).catch(function () { return null; });
          var types = (ws && ws.manifest && ws.manifest.objectTypes) || [];
          var hit = types.some(function (o) { return o && o.contract === CONTRACT; });
          if (hit) out.push({ org: orgs[i].id, ws: wss[j].id, label: orgs[i].name + ' / ' + (wss[j].name || wss[j].id) });
        }
      }
      return out;
    }

    // ── setup: the app cannot create an organism, so it hands over a prompt ──
    function setupPrompt() {
      var manifest = {
        manifestVersion: '1.0', id: 'shop', name: 'Shop', kind: 'project', status: 'active',
        objectTypes: [
          { name: SPACES.catalog, namespace: 'shop.catalog', schemaRef: 'shop.catalog', backing: 'memory', writeRole: 'member', mode: 'records', contract: CONTRACT, maxVersions: 5 },
          { name: SPACES.pricing, namespace: 'shop.pricing', schemaRef: 'shop.pricing', backing: 'memory', writeRole: 'member', mode: 'records', maxVersions: 5 },
          { name: SPACES.policy, namespace: 'shop.policy', schemaRef: 'schema:document@1', backing: 'memory', writeRole: 'member', mode: 'document' },
          { name: SPACES.leads, namespace: 'shop.leads', schemaRef: 'shop.leads', backing: 'memory', writeRole: 'member', mode: 'records', maxVersions: 1 }
        ]
      };
      return [
        'Set up the space my shop keeps its things in, on AIMEAT. Use your AIMEAT MCP tools.',
        '',
        '1. Create an organism I own, name "My shop", visibility private (aimeat_organism_create).',
        '2. In it, create a workspace (aimeat_workspace_create) with:',
        '     name: "Shop"',
        '     manifest: ' + JSON.stringify(manifest),
        '3. Tell me the organism id and the ws id.',
        '',
        'The shop back office finds this workspace by itself afterwards — it looks for the contract',
        '"' + CONTRACT + '" in the manifest, so there is nothing to paste back into it.',
      ].join('\\n');
    }

    function renderSetup() {
      say('<h2 class="text-lg font-bold mb-2">One step before the shop can hold anything</h2>' +
        '<p class="opacity-70 mb-3 text-sm">Your shop keeps its products, prices and pages in a space of your own, ' +
        'so nobody else can read or edit them. This app cannot create that space for you. Paste the text below ' +
        'into your own AI once, then reload this page.</p>' +
        '<div class="mockup-code text-xs whitespace-pre-wrap p-3" id="setup-box"></div>' +
        '<button class="btn-primary px-4 mt-3" id="copy-setup">Copy</button>');
      $('setup-box').textContent = setupPrompt();
      $('copy-setup').onclick = async function (e) {
        await navigator.clipboard.writeText(setupPrompt());
        e.target.textContent = 'Copied';
      };
    }

    async function openWorkspace(org, ws) {
      CTX = { org: org, ws: ws };
      var meta = await AIMEAT.organism.read(org, ws).catch(function () { return null; });
      $('ws-name').textContent = (meta && meta.manifest && meta.manifest.name) || ws;
      $('tabs').hidden = false;
      $('agent-prompt').hidden = false;
      $('agent-prompt').onclick = async function (e) {
        await navigator.clipboard.writeText(agentPrompt());
        e.target.textContent = 'Copied';
      };
      Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
        b.onclick = function () {
          tab = b.getAttribute('data-tab');
          Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (x) { x.classList.remove('tab-active'); });
          b.classList.add('tab-active');
          paint();
        };
      });
      shopMeta = await AIMEAT.shop.shop();
      paint();
    }

    /** The agent face is a prompt, not code: any MCP chat edits the same records this page does. */
    function agentPrompt() {
      return [
        'You run a shop that keeps its things in an AIMEAT workspace. Use your AIMEAT MCP tools.',
        '',
        'Workspace: organism_id "' + CTX.org + '", ws "' + CTX.ws + '".',
        'Spaces: "' + SPACES.catalog + '" (records), "' + SPACES.pricing + '" (records), "' + SPACES.policy + '" (documents), "' + SPACES.leads + '" (records, written by the contact form).',
        '',
        'A CATALOGUE is ONE record holding the whole list, not one record per product:',
        '  { "currency": "EUR", "updated": "<ISO>", "items": [ { "sku", "name", "description", "priceMinor", "unit", "image" } ] }',
        'A PRICE LIST is one record the same way: { "currency", "validFrom", "rows": [ { "sku", "amountMinor", "unit" } ] }.',
        '',
        'To change what is for sale:',
        '1. Read it: aimeat_workspace_read { organism_id, ws, ids: ["<catalogue id>"] } (list all with aimeat_workspace_read { organism_id, ws }).',
        '2. Change ONLY what was asked. Keep every field you were not asked to change.',
        '3. Write it back: aimeat_workspace_write { organism_id, ws, space: "' + SPACES.catalog + '", id, value }.',
        '4. Publish: aimeat_workspace_publish { organism_id, ws, namespace: "shop.' + SPACES.catalog + '", id }.',
        '',
        'The workspace is the editable truth. The SHOP FRONT reads a separate public copy, and that',
        'copy only changes when the owner presses Publish in the back office. Do not try to write it:',
        'it is the shop extension\\'s own namespace and only the extension writes there.',
        '',
        'Rules: prices are in minor units (cents). Never invent a delivery time, a guarantee or a',
        'quality claim the owner did not state — an unstated promise is an absent line.',
      ].join('\\n');
    }

    // ── views ───────────────────────────────────────────────────────────────
    async function paint() {
      if (tab === 'home') return paintHome();
      if (tab === 'products') return paintList(SPACES.catalog, 'Products', 'The whole catalogue is one record. Publish sends a copy to the shop front.');
      if (tab === 'pages') return paintList(SPACES.policy, 'Pages', 'Privacy, terms and delivery, as the shop front shows them.');
      if (tab === 'stock') return paintStock();
      if (tab === 'enquiries') return paintList(SPACES.leads, 'Enquiries', 'What came in through the contact form.');
    }

    /** The resume: what is not done yet, in the order it wants doing. */
    async function paintHome() {
      var steps = [];
      if (!shopMeta) steps.push({ label: 'Name your shop', why: 'The shop front shows this above everything else.', act: 'configure' });
      var cat = await AIMEAT.shop.catalog();
      if (!cat || !(cat.items || []).length) steps.push({ label: 'Add what you sell', why: 'The shop front has nothing to show.', act: 'goto:products' });
      var pages = await AIMEAT.shop.pages();
      if (!pages || !pages.terms) steps.push({ label: 'Write your terms', why: 'A buyer should be able to read them before they buy.', act: 'goto:pages' });
      var avail = await AIMEAT.shop.availability();
      if (!avail) steps.push({ label: 'Say what is on the shelf', why: 'Without it the shop cannot hold anything for a buyer.', act: 'goto:stock' });

      if (!steps.length) {
        say('<div class="alert alert-success">Your shop is open and has everything it needs.</div>');
        return;
      }
      say('<h2 class="text-lg font-bold mb-1">What is left</h2>' +
        '<p class="opacity-70 text-sm mb-4">In order. You can stop after any of them and come back.</p>' +
        steps.map(function (s, i) {
          return '<div class="card bg-base-200 mb-3"><div class="card-body p-4 gap-1">' +
            '<div class="font-semibold">' + (i + 1) + '. ' + esc(s.label) + '</div>' +
            '<div class="text-sm opacity-70">' + esc(s.why) + '</div>' +
            '<div class="pt-2"><button class="btn-primary px-4" data-act="' + esc(s.act) + '">Do this</button></div>' +
            '</div></div>';
        }).join(''));
      Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (b) {
        b.onclick = function () { doAct(b.getAttribute('data-act')); };
      });
    }

    async function doAct(act) {
      if (act === 'configure') {
        // The shop already belongs to whoever installed it — the node resolves that from the
        // extension's own record. This only gives it a name and a currency.
        var name = prompt('What is your shop called?', 'My shop');
        if (name === null) return;
        var res = await AIMEAT.shop.admin(session, 'configure', { name: name, currency: 'EUR' });
        shopMeta = await AIMEAT.shop.shop();
        if (!res || !res.ok) alert((res && res.error) || 'Could not save that.');
        return paintHome();
      }
      if (act.indexOf('goto:') === 0) {
        tab = act.slice(5);
        Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (x) {
          x.classList.toggle('tab-active', x.getAttribute('data-tab') === tab);
        });
        return paint();
      }
    }

    async function paintList(space, title, blurb) {
      var index = await AIMEAT.organism.read(CTX.org, CTX.ws).catch(function () { return null; });
      var rows = ((index && index.spaces) || []).filter(function (s) { return s.name === space; })[0];
      var itemsIn = (rows && rows.items) || [];
      say('<h2 class="text-lg font-bold mb-1">' + esc(title) + '</h2>' +
        '<p class="opacity-70 text-sm mb-4">' + esc(blurb) + '</p>' +
        (itemsIn.length
          ? itemsIn.map(function (it) {
            return '<div class="card bg-base-200 mb-2"><div class="card-body p-3 flex-row items-center gap-3">' +
              '<span class="font-mono text-xs opacity-60">' + esc(it.id) + '</span>' +
              '<span class="flex-1 truncate">' + esc((it.value && (it.value.title || it.value.name)) || '') + '</span>' +
              '</div></div>';
          }).join('')
          : '<div class="opacity-60">Nothing here yet. Your AI can fill this in — copy the agent prompt at the top.</div>') +
        (space === SPACES.catalog ? '<button id="publish" class="btn-primary px-4 mt-4">Publish to the shop front</button><div id="pub-msg" class="text-sm mt-2"></div>' : '') +
        (space === SPACES.policy ? '<button id="publish-pages" class="btn-primary px-4 mt-4">Publish the pages</button><div id="pub-msg" class="text-sm mt-2"></div>' : ''));

      if ($('publish')) $('publish').onclick = function () { publishCatalog(itemsIn); };
      if ($('publish-pages')) $('publish-pages').onclick = function () { publishPages(itemsIn); };
    }

    async function publishCatalog(itemsIn) {
      var doc = itemsIn.length ? itemsIn[0].value : null;
      if (!doc) return void ($('pub-msg').textContent = 'There is nothing to publish yet.');
      var res = await AIMEAT.shop.admin(session, 'publish_catalog', { catalog: doc });
      $('pub-msg').className = 'text-sm ' + (res && res.ok ? 'text-success' : 'text-error');
      $('pub-msg').textContent = res && res.ok ? ('Published ' + res.items + ' products.') : ((res && res.error) || 'Could not publish.');
    }

    async function publishPages(itemsIn) {
      var pages = {};
      itemsIn.forEach(function (it) {
        var name = String(it.id).toLowerCase();
        if (name === 'privacy' || name === 'terms' || name === 'delivery') {
          pages[name] = { title: (it.value && it.value.title) || name, markdown: (it.value && it.value.markdown) || '' };
        }
      });
      var res = await AIMEAT.shop.admin(session, 'publish_pages', { pages: pages });
      $('pub-msg').className = 'text-sm ' + (res && res.ok ? 'text-success' : 'text-error');
      $('pub-msg').textContent = res && res.ok ? ('Published: ' + res.pages.join(', ')) : ((res && res.error) || 'Could not publish.');
    }

    async function paintStock() {
      var cat = await AIMEAT.shop.catalog();
      var avail = await AIMEAT.shop.availability();
      var units = (avail && avail.units) || {};
      var itemsIn = (cat && cat.items) || [];
      say('<h2 class="text-lg font-bold mb-1">Shelf</h2>' +
        '<p class="opacity-70 text-sm mb-4">How many of each you have. A hold takes one off here the moment a buyer reaches for it.</p>' +
        (itemsIn.length
          ? itemsIn.map(function (it) {
            return '<div class="flex items-center gap-3 mb-2">' +
              '<span class="flex-1 truncate">' + esc(it.name) + ' <span class="opacity-50 text-xs font-mono">' + esc(it.sku) + '</span></span>' +
              '<input type="number" min="0" class="input input-bordered input-sm w-24 stock-in" data-sku="' + esc(it.sku) + '" value="' + esc(String(units[it.sku] == null ? 0 : units[it.sku])) + '" />' +
              '</div>';
          }).join('') + '<button id="save-stock" class="btn-primary px-4 mt-3">Save</button><div id="stock-msg" class="text-sm mt-2"></div>'
          : '<div class="opacity-60">Add what you sell first.</div>'));
      if ($('save-stock')) $('save-stock').onclick = async function () {
        var out = {};
        Array.prototype.forEach.call(document.querySelectorAll('.stock-in'), function (el) {
          out[el.getAttribute('data-sku')] = Number(el.value) || 0;
        });
        var res = await AIMEAT.shop.admin(session, 'set_stock', { units: out });
        $('stock-msg').className = 'text-sm ' + (res && res.ok ? 'text-success' : 'text-error');
        $('stock-msg').textContent = res && res.ok ? 'Saved.' : ((res && res.error) || 'Could not save.');
      };
    }

    boot();
  })();
  </script>
</body>
</html>
`;

const EXT_SHOP = `{"manifest":"metadata:\\n  name: businesslauncher-shop\\n  version: 1.0.0\\n  description: The shop's engine — the public catalogue a visitor reads with no login, and the stock and holds behind it.\\n  author: operator\\nrequired_apis:\\n  - memory\\nactions:\\n  - id: admin\\n    method: POST\\n    path: /admin\\n    description: Owner operations, refused for anyone but the person who installed this shop. op configure (the shop's name and currency), publish_catalog (write the public copy the storefront reads), publish_pages (privacy, terms and delivery as the storefront shows them), set_stock (units on the shelf, absolute), commit (a sale completed, drop the hold without returning units), sweep (expired holds go back on the shelf).\\n    input: { type: object, properties: { op: { type: string }, name: { type: string }, currency: { type: string }, catalog: { type: object }, pages: { type: object }, units: { type: object }, reservationId: { type: string } }, required: [op] }\\n    output: { type: object, properties: { ok: { type: boolean }, error: { type: string } } }\\n    script: admin.js\\n  - id: reserve\\n    method: POST\\n    path: /reserve\\n    description: Hold units of one sku under an id the caller generates, until expiresAt. One compare-and-swap, so two buyers cannot both take the last unit. Calling twice with the same id is the same hold, not a second one.\\n    input: { type: object, properties: { sku: { type: string }, qty: { type: number }, reservationId: { type: string }, expiresAt: { type: string } }, required: [sku, reservationId, expiresAt] }\\n    output: { type: object, properties: { ok: { type: boolean }, reservationId: { type: string }, left: { type: number }, error: { type: string } } }\\n    script: reserve.js\\n  - id: release\\n    method: POST\\n    path: /release\\n    description: Put a hold's units back on the shelf. The person who took the hold may release it, and so may the shop owner.\\n    input: { type: object, properties: { reservationId: { type: string } }, required: [reservationId] }\\n    output: { type: object, properties: { ok: { type: boolean }, released: { type: string }, left: { type: number }, error: { type: string } } }\\n    script: release.js\\n","scripts":{"admin.js":"export default async function (ctx, input) {\\n  // Everything lives inside this function on purpose: a top-level const/let/function crashes the\\n  // sandbox. That is why the helpers below are re-declared in each action script rather than shared.\\n  const op = String((input && input.op) || '');\\n  const now = ctx.now();\\n  const caller = (ctx.caller && ctx.caller.gaii) || null;\\n  if (!caller) return { ok: false, error: 'not authenticated' };\\n\\n  const MAX_RETRIES = 5;\\n\\n  // WHO OWNS THIS SHOP IS NOT A RACE. \`ctx.extension.owner\` is resolved by the node from the\\n  // extension's own record and cannot be reached by anything a caller sends, so the shop belongs to\\n  // whoever installed it from the first second. A \\"whoever calls first claims it\\" step would mean a\\n  // shop somebody else can take between the install and the owner opening the back office.\\n  // Absent means the road did not know the record, and that reads as \\"not the owner\\", never as\\n  // permission.\\n  const shopOwner = (ctx.extension && ctx.extension.owner) || null;\\n  if (!shopOwner) return { ok: false, error: 'this shop cannot tell who owns it' };\\n  if ((ctx.caller && ctx.caller.owner) !== shopOwner) {\\n    return { ok: false, error: 'only the shop owner may do that' };\\n  }\\n\\n  let shop = await ctx.memory.get('shop');\\n\\n  // ── configure ────────────────────────────────────────────────────────────\\n  // The shop's own details. Not a claim: it changes nothing about who owns this.\\n  if (op === 'configure') {\\n    shop = {\\n      owner: shopOwner,\\n      name: String((input && input.name) || (shop && shop.name) || 'Shop'),\\n      currency: String((input && input.currency) || (shop && shop.currency) || 'EUR'),\\n      updated: now,\\n    };\\n    await ctx.memory.set('shop', shop);\\n    return { ok: true, shop: shop };\\n  }\\n\\n  if (!shop) shop = { owner: shopOwner, currency: 'EUR' };\\n\\n  // ── publish_catalog ──────────────────────────────────────────────────────\\n  // The PUBLIC copy the storefront reads with no login. The editable truth lives in the owner's\\n  // workspace; this is the mirror, and it is written only when the owner publishes.\\n  if (op === 'publish_catalog') {\\n    const catalog = (input && input.catalog) || null;\\n    if (!catalog || typeof catalog !== 'object') return { ok: false, error: 'catalog must be an object' };\\n    const items = Array.isArray(catalog.items) ? catalog.items : [];\\n    await ctx.memory.set('catalog', {\\n      currency: String(catalog.currency || shop.currency || 'EUR'),\\n      updated: now,\\n      items: items,\\n    });\\n    return { ok: true, items: items.length, updated: now };\\n  }\\n\\n  // ── publish_pages ────────────────────────────────────────────────────────\\n  // Privacy, terms and delivery, as the storefront shows them. Public for the same reason the\\n  // catalogue is: a visitor must be able to read the terms before they buy, without an account.\\n  // Who wrote the text travels with it, because a skeleton the operator filled in is a starting\\n  // point they own and not advice from us.\\n  if (op === 'publish_pages') {\\n    const pages = (input && input.pages) || null;\\n    if (!pages || typeof pages !== 'object') return { ok: false, error: 'pages must be an object' };\\n    const clean = {};\\n    const allowed = ['privacy', 'terms', 'delivery'];\\n    for (const name of allowed) {\\n      const page = pages[name];\\n      if (!page) continue;\\n      if (typeof page.markdown !== 'string' || !page.markdown.trim()) {\\n        return { ok: false, error: 'page \\"' + name + '\\" needs markdown' };\\n      }\\n      clean[name] = {\\n        title: String(page.title || name),\\n        markdown: page.markdown,\\n        writtenBy: String(page.writtenBy || shop.owner),\\n        updated: now,\\n      };\\n    }\\n    if (Object.keys(clean).length === 0) return { ok: false, error: 'nothing to publish' };\\n    await ctx.memory.set('pages', clean);\\n    return { ok: true, pages: Object.keys(clean) };\\n  }\\n\\n  // ── set_stock ────────────────────────────────────────────────────────────\\n  // Absolute units per sku, not a delta: the owner is stating what is on the shelf. Written through\\n  // a compare-and-swap so it cannot clobber a reservation taken while the form was open.\\n  if (op === 'set_stock') {\\n    const units = (input && input.units) || null;\\n    if (!units || typeof units !== 'object') return { ok: false, error: 'units must be an object of sku -> count' };\\n    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {\\n      const read = await ctx.memory.getVersioned('inventory');\\n      const inv = read ? read.value : { stock: {}, reservations: {} };\\n      const stock = Object.assign({}, inv.stock || {});\\n      for (const sku of Object.keys(units)) {\\n        const n = Number(units[sku]);\\n        if (!(n >= 0)) return { ok: false, error: 'units must be zero or more: ' + sku };\\n        stock[sku] = Math.floor(n);\\n      }\\n      const next = { stock: stock, reservations: inv.reservations || {} };\\n      // PRIVATE: this record names who holds what, and an ext namespace is world-readable by\\n      // default. The public shelf number goes in \`availability\`, counts only, no identities.\\n      const wrote = read\\n        ? await ctx.memory.set('inventory', next, { ifVersion: read.version, visibility: 'private' })\\n        : await ctx.memory.set('inventory', next, { ifVersion: 0, visibility: 'private' });\\n      if (wrote.ok) {\\n        await ctx.memory.set('availability', { units: stock, updated: now });\\n        return { ok: true, stock: stock };\\n      }\\n    }\\n    return { ok: false, error: 'too much contention on the inventory — try again' };\\n  }\\n\\n  // ── commit ───────────────────────────────────────────────────────────────\\n  // The sale completed. The units were already taken out of stock when the reservation was made, so\\n  // committing only drops the hold; it must NOT return them.\\n  if (op === 'commit') {\\n    const id = String((input && input.reservationId) || '');\\n    if (!id) return { ok: false, error: 'reservationId required' };\\n    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {\\n      const read = await ctx.memory.getVersioned('inventory');\\n      if (!read) return { ok: false, error: 'no inventory' };\\n      const inv = read.value;\\n      const reservations = Object.assign({}, inv.reservations || {});\\n      if (!reservations[id]) return { ok: false, error: 'no such reservation' };\\n      delete reservations[id];\\n      const wrote = await ctx.memory.set('inventory', {\\n        stock: inv.stock || {}, reservations: reservations,\\n      }, { ifVersion: read.version, visibility: 'private' });\\n      // No availability mirror here on purpose: committing a sale drops the hold and returns\\n      // nothing to the shelf, so the public number did not move.\\n      if (wrote.ok) return { ok: true, committed: id };\\n    }\\n    return { ok: false, error: 'too much contention on the inventory — try again' };\\n  }\\n\\n  // ── sweep ────────────────────────────────────────────────────────────────\\n  // Expired holds go back on the shelf. Runs on a clock as an \`extension\` schedule, which costs no\\n  // tokens; a scheduled run arrives with the owner as its own caller, so the check above passes.\\n  // ISO-8601 UTC strings compare correctly as strings, which is why no Date is needed in here.\\n  if (op === 'sweep') {\\n    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {\\n      const read = await ctx.memory.getVersioned('inventory');\\n      if (!read) return { ok: true, expired: 0 };\\n      const inv = read.value;\\n      const stock = Object.assign({}, inv.stock || {});\\n      const reservations = Object.assign({}, inv.reservations || {});\\n      const expired = [];\\n      for (const id of Object.keys(reservations)) {\\n        const r = reservations[id];\\n        if (r && typeof r.expiresAt === 'string' && r.expiresAt <= now) {\\n          stock[r.sku] = (Number(stock[r.sku]) || 0) + (Number(r.qty) || 0);\\n          expired.push(id);\\n          delete reservations[id];\\n        }\\n      }\\n      if (expired.length === 0) return { ok: true, expired: 0 };\\n      const wrote = await ctx.memory.set('inventory', {\\n        stock: stock, reservations: reservations,\\n      }, { ifVersion: read.version, visibility: 'private' });\\n      if (wrote.ok) {\\n        await ctx.memory.set('availability', { units: stock, updated: now });\\n        return { ok: true, expired: expired.length, ids: expired };\\n      }\\n    }\\n    return { ok: false, error: 'too much contention on the inventory — try again' };\\n  }\\n\\n  return { ok: false, error: 'unknown op: ' + op };\\n}\\n","release.js":"export default async function (ctx, input) {\\n  // Put a hold's units back on the shelf. The person who took the hold may release it, and so may\\n  // the shop owner — nobody else, or one buyer could free another buyer's basket.\\n  const caller = (ctx.caller && ctx.caller.gaii) || null;\\n  if (!caller) return { ok: false, error: 'not authenticated' };\\n\\n  const id = String((input && input.reservationId) || '');\\n  if (!id) return { ok: false, error: 'reservationId required' };\\n\\n  // The owner comes from the extension's own record, not from a record a caller could have written.\\n  const isOwner = !!(ctx.extension && ctx.extension.owner)\\n    && (ctx.caller && ctx.caller.owner) === ctx.extension.owner;\\n\\n  for (let attempt = 0; attempt < 5; attempt++) {\\n    const read = await ctx.memory.getVersioned('inventory');\\n    if (!read) return { ok: false, error: 'no inventory' };\\n    const inv = read.value;\\n    const reservations = Object.assign({}, inv.reservations || {});\\n    const held = reservations[id];\\n    // Already gone: released, committed or swept. Answering ok keeps a retry from reading as a\\n    // failure the caller has to handle.\\n    if (!held) return { ok: true, released: id, already: true };\\n    if (!isOwner && held.by !== caller) return { ok: false, error: 'that hold is not yours' };\\n\\n    const stock = Object.assign({}, inv.stock || {});\\n    stock[held.sku] = (Number(stock[held.sku]) || 0) + (Number(held.qty) || 0);\\n    delete reservations[id];\\n\\n    const wrote = await ctx.memory.set('inventory', {\\n      stock: stock, reservations: reservations,\\n    }, { ifVersion: read.version, visibility: 'private' });\\n    if (wrote.ok) {\\n      await ctx.memory.set('availability', { units: stock, updated: ctx.now() });\\n      return { ok: true, released: id, left: stock[held.sku] };\\n    }\\n  }\\n  return { ok: false, error: 'too much contention on the inventory — try again' };\\n}\\n","reserve.js":"export default async function (ctx, input) {\\n  // Take units off the shelf and hold them under an id, in ONE compare-and-swap. Stock and holds\\n  // live in the same record precisely so that the two halves cannot land separately: a decrement\\n  // that survived while its hold was lost would sell a unit nobody can claim.\\n  const caller = (ctx.caller && ctx.caller.gaii) || null;\\n  if (!caller) return { ok: false, error: 'not authenticated' };\\n\\n  const sku = String((input && input.sku) || '');\\n  const qty = Math.floor(Number((input && input.qty) || 1));\\n  const id = String((input && input.reservationId) || '');\\n  const expiresAt = String((input && input.expiresAt) || '');\\n  if (!sku) return { ok: false, error: 'sku required' };\\n  if (!(qty >= 1)) return { ok: false, error: 'qty must be at least 1' };\\n  if (!id) return { ok: false, error: 'reservationId required — the caller generates it' };\\n  if (!expiresAt) return { ok: false, error: 'expiresAt required (ISO-8601 UTC)' };\\n  // A hold that never expires is a unit taken off the shelf for good, so the sweep must be able to\\n  // reach it. Refusing a past date keeps a caller from \\"reserving\\" something already released.\\n  if (expiresAt <= ctx.now()) return { ok: false, error: 'expiresAt is already in the past' };\\n\\n  for (let attempt = 0; attempt < 5; attempt++) {\\n    const read = await ctx.memory.getVersioned('inventory');\\n    if (!read) return { ok: false, error: 'nothing is stocked yet' };\\n    const inv = read.value;\\n    const stock = Object.assign({}, inv.stock || {});\\n    const reservations = Object.assign({}, inv.reservations || {});\\n\\n    // Idempotent: the same id twice is the same hold, not a second one. A retry after a dropped\\n    // response must not take a second unit.\\n    if (reservations[id]) return { ok: true, reservationId: id, already: true, left: Number(stock[sku]) || 0 };\\n\\n    const have = Number(stock[sku]) || 0;\\n    if (have < qty) return { ok: false, error: 'not enough left', left: have };\\n\\n    stock[sku] = have - qty;\\n    reservations[id] = { sku: sku, qty: qty, expiresAt: expiresAt, by: caller, at: ctx.now() };\\n\\n    // PRIVATE: this record names who holds what, and an ext namespace is world-readable by default.\\n    const wrote = await ctx.memory.set('inventory', {\\n      stock: stock, reservations: reservations,\\n    }, { ifVersion: read.version, visibility: 'private' });\\n    if (wrote.ok) {\\n      // The public shelf number, carrying counts and no identities. A display value: the binding\\n      // refusal happens above, against the private record, so a stale mirror cannot oversell.\\n      await ctx.memory.set('availability', { units: stock, updated: ctx.now() });\\n      return { ok: true, reservationId: id, left: stock[sku], expiresAt: expiresAt };\\n    }\\n    // Somebody else moved the inventory. Read it again and decide against what is really there.\\n  }\\n  return { ok: false, error: 'too much contention on the inventory — try again' };\\n}\\n"}}`;

const CORTEX_SHOP = `{"manifest":"metadata:\\n  name: businesslauncher-shop\\n  namespace: businesslauncher\\n  description: The shop's browser surface. Reads the public catalogue, shelf numbers and policy pages with no session, and calls the shop extension for holds and owner operations.\\n  author: operator\\n  tags: [shop, commerce, businesslauncher]\\ncomponents:\\n  - type: lib\\n    name: businesslauncher-shop\\n    filename: businesslauncher-shop.js\\n    exports:\\n      - shop\\n      - catalog\\n      - availability\\n      - pages\\n      - reserve\\n      - release\\n      - admin\\n      - newId\\n    api_surface: |\\n      AIMEAT.shop.catalog()      -> { currency, updated, items:[...] } | null   (no session)\\n      AIMEAT.shop.availability() -> { units: { sku: n }, updated } | null       (no session)\\n      AIMEAT.shop.pages()        -> { privacy?, terms?, delivery? } | null      (no session)\\n      AIMEAT.shop.shop()         -> { owner, currency, claimedAt } | null       (no session)\\n\\n      AIMEAT.shop.reserve(session, { sku, qty?, minutes?, reservationId? })\\n        Holds units while the buyer pays. The id and expiry come from the caller, so a retry\\n        after a dropped connection is the same hold rather than a second one.\\n      AIMEAT.shop.release(session, reservationId)\\n      AIMEAT.shop.admin(session, op, payload)\\n        op: claim | publish_catalog | publish_pages | set_stock | commit | sweep\\n\\n      Requires: /v1/libs/aimeat-data.js for the reads, and a signed-in session for the writes.\\n      availability() is a DISPLAY number: the record that decides a sale is private and is read\\n      inside the same compare-and-swap that takes the units.\\n","libs":{"businesslauncher-shop.js":"/**\\n * @file businesslauncher-shop.js\\n * @author Jouni Miikki\\n * SPDX-License-Identifier: MIT\\n * @description The shop's browser surface: \`AIMEAT.shop.*\`. Both apps in this package talk to the\\n *   extension through here and never to \`/v1/ext/\` themselves.\\n *\\n *   WHY THIS LAYER EXISTS AT ALL, rather than the apps calling the extension directly: an app may\\n *   only ask for the scopes in the node's app-grant vocabulary, and there is no \`ext:\` word in it.\\n *   Reaching an extension is cortex's job — the app trusts cortex, cortex trusts the extension, and\\n *   no layer skips the one below.\\n *\\n *   THE READS TAKE NO SESSION. A shop has to be browsable by somebody who has never heard of this\\n *   node, so the catalogue, the shelf numbers and the policy pages are read straight from the\\n *   extension's public namespace with no auth at all. Only the writes need a session.\\n *\\n *   The short names \`businesslauncher-shop\` below are rewritten to the per-instance registered names\\n *   when the package is installed, in this file as in the apps. Leave them exactly as they are.\\n * @structure AIMEAT.shop: catalog · availability · pages · reserve · release · admin\\n * @version-history\\n *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).\\n */\\n(function (AIMEAT) {\\n  'use strict';\\n\\n  var EXT = 'ext:businesslauncher-shop';\\n  var ACTION = '/v1/ext/businesslauncher-shop/';\\n\\n  /** One public record, or null. Never throws: an empty shop is a state, not an error. */\\n  function readPublic(key) {\\n    if (!AIMEAT.data || !AIMEAT.data.getPublic) {\\n      return Promise.reject(new Error('aimeat-data is not loaded — add /v1/libs/aimeat-data.js'));\\n    }\\n    return AIMEAT.data.getPublic(EXT, key).catch(function () { return null; });\\n  }\\n\\n  /** The shop's own record: who owns it and which currency it prices in. */\\n  function shop() { return readPublic('shop'); }\\n\\n  /** What is for sale, as the owner last published it. \`{ currency, updated, items: [...] }\`. */\\n  function catalog() { return readPublic('catalog'); }\\n\\n  /**\\n   * How many of each sku are on the shelf: \`{ units: { sku: n }, updated }\`.\\n   *\\n   * A DISPLAY number. The record that decides a sale is private and is read inside the same\\n   * compare-and-swap that takes the units, so a stale number here cannot oversell — it can only be\\n   * a moment out of date. Show it as availability, never as a promise.\\n   */\\n  function availability() { return readPublic('availability'); }\\n\\n  /** Privacy, terms and delivery as the owner published them, each carrying who wrote it. */\\n  function pages() { return readPublic('pages'); }\\n\\n  /** POST one extension action with the caller's session. */\\n  function call(session, action, body) {\\n    if (!session || typeof session.fetch !== 'function') {\\n      return Promise.reject(new Error('sign in first'));\\n    }\\n    return session.fetch(ACTION + action, {\\n      method: 'POST',\\n      headers: { 'Content-Type': 'application/json' },\\n      body: JSON.stringify(body || {}),\\n    }).then(function (res) {\\n      return res.json().then(function (envelope) {\\n        // The action's own answer is inside the node's envelope. A refusal from the shop (sold out,\\n        // not yours) arrives as ok:false in there, not as an HTTP error, so it is handed back as it\\n        // is rather than thrown: \\"sold out\\" is an answer the caller renders, not an exception.\\n        var out = (envelope && envelope.data) ? envelope.data : envelope;\\n        if (out && typeof out === 'object' && 'result' in out) return out.result;\\n        return out;\\n      });\\n    });\\n  }\\n\\n  /**\\n   * Hold units while the buyer pays. The caller owns the id and the expiry, so a retry after a\\n   * dropped connection is the same hold rather than a second one.\\n   */\\n  function reserve(session, opts) {\\n    var minutes = (opts && opts.minutes) || 15;\\n    var id = (opts && opts.reservationId) || newId();\\n    return call(session, 'reserve', {\\n      sku: opts.sku,\\n      qty: opts.qty || 1,\\n      reservationId: id,\\n      expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),\\n    });\\n  }\\n\\n  /** Give a hold back. The person who took it may do this, and so may the shop owner. */\\n  function release(session, reservationId) {\\n    return call(session, 'release', { reservationId: reservationId });\\n  }\\n\\n  /** Owner operations: claim, publish_catalog, publish_pages, set_stock, commit, sweep. */\\n  function admin(session, op, payload) {\\n    var body = { op: op };\\n    for (var k in (payload || {})) { if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k]; }\\n    return call(session, 'admin', body);\\n  }\\n\\n  /** A reservation id the buyer's own browser generates. */\\n  function newId() {\\n    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();\\n    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);\\n  }\\n\\n  var exports = {\\n    shop: shop,\\n    catalog: catalog,\\n    availability: availability,\\n    pages: pages,\\n    reserve: reserve,\\n    release: release,\\n    admin: admin,\\n    newId: newId,\\n  };\\n\\n  if (AIMEAT.register) AIMEAT.register('businesslauncher-shop', exports);\\n  if (!AIMEAT.shop) AIMEAT.shop = exports;\\n\\n})(window.AIMEAT || (window.AIMEAT = {}));\\n"}}`;

export function businesslauncherPackage(): ExamplePackageDef {
  return {
    name: 'businesslauncher',
    description: 'A shop that opens without an account: what you sell, what is left, your own terms, and a way for people to get in touch. Products and prices live in your own space, and the back office shows what is still missing so you can stop and come back.',
    category: 'commerce',
    tags: ['shop', 'commerce', 'storefront', 'businesslauncher', 'stock'],
    visibility: 'public',
    components: [
      // The engine and the lib register FIRST: the apps' `/v1/ext/`, `/v1/cortex/` and `ext:`
      // references are rewritten to these components' per-instance names as each app registers.
      { id: 'ext-shop', type: 'extension', label: 'Shop engine', content: EXT_SHOP, dependencies: [] },
      { id: 'cortex-shop', type: 'cortex', label: 'Shop lib', content: CORTEX_SHOP, dependencies: ['ext-shop'] },
      { id: 'app-shop', type: 'app', label: 'Shop', content: APP_SHOP, dependencies: ['ext-shop', 'cortex-shop'] },
      { id: 'app-back-office', type: 'app', label: 'Back office', content: APP_BACK_OFFICE, dependencies: ['ext-shop', 'cortex-shop'] },
    ],
    templateListing: {
      title: 'Shop (BUSINESSLAUNCHER)',
      description: 'Two apps and an engine: a shop front anyone can browse without signing in, and a back office where you keep the products, the shelf, your terms and the enquiries that came in. The last unit can only be sold once. Your AI can do the same work from any chat — the back office hands you the prompt.',
      category: 'commerce',
      tags: ['shop', 'commerce', 'storefront', 'stock'],
    },
  };
}
