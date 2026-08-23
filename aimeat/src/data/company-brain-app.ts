/**
 * @file company-brain-app.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The company brain app of the COMPANY BRAIN package, inlined for install.
 *
 *   GENERATED FILE — do not edit by hand. Edit packages/company-brain/app-brain.html and re-run
 *   `node packages/build-company-brain-pkg.mjs`.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-071).
 */
export const APP_BRAIN = `<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: Company brain
version: 1.0.0
description: What your company knows, where each piece came from, what needs checking again, and what feeds it. Your details become its first facts, and it says out loud what its sources do not cover.
entry: index.html
-->
<!--
  @file app-brain.html
  @description The company brain: three questions on one page — what do we know, where did it come
    from, and what is waiting for me.

    IT KNOWS WHICH COMPANY IT IS FROM THE ADDRESS IT WAS OPENED AT. Served at
    \`{slug}.co.<apex>\`, the first label of the host IS the company slug, and one pass over
    GET /v1/companies turns it into the record. No stored id, no launch parameter, nothing to paste.
    That is what lets one owner install this once per company and have each copy know itself. On any
    other address it falls back to asking, because guessing which company somebody meant is worse
    than a question.

    AGEING IS DECIDED WHEN THIS PAGE RENDERS. An anchored fact points at a document the owner holds
    and never falls due; an observed one carries review_after and is compared with today, here, in
    the browser. Nothing sweeps facts. What DOES need a clock is a feed that has gone quiet, because
    silence leaves no record of itself, and that is the caretaker's one job.

    THE SOURCE REGISTER SHOWS WHAT EACH SOURCE DOES NOT COVER, and shows the row even when the
    source has produced nothing. A register that hides its empty rows is how one import quietly
    becomes "everything we know".

    Everything reaching the caretaker goes through AIMEAT.brain. This app never calls /v1/ext/.
  @structure boot -> pickCompany -> findWorkspace | renderSetup -> render (three sections)
  @usage published app; open it at your company's address, or let it ask which company.
  @version-history
    v1.0.0 — 2026-08-23 — Initial (TARGET-071).
-->
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- company:write is here for ONE field: pointing the company at the organism its knowledge lives
       in, once, during setup. Without that link a brain sits beside a company that has never heard
       of it, which is the exact state every company on this platform was in before this app.
       memory:delete is here for ONE act: clearing findings the owner has already decided about.
       Measured reason, not tidiness — a published record costs two keys and the default ceiling is
       a thousand, and findings are the only space here that grows without anybody choosing to grow
       it. Without this the queue is a one-way door. -->
  <meta name="aimeat-scopes" content="memory:read memory:write memory:delete organism:read organism:write company:read company:write" />
  <title>Company brain</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
  <!-- The node paints two permanent marks over the bottom corners of every served app and tells the
       app how tall that strip is. Reserving the space is the app's job, and reading the variable is
       the contract: a hardcoded number is wrong on the next viewport. -->
  <style>
    .chrome-clear { padding-bottom: calc(var(--aimeat-chrome-bottom, 56px) + 12px); }
  </style>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col">
  <!-- The bar runs full width, its CONTENT shares the same max-w-3xl column as the page below. -->
  <nav class="navbar bg-base-200 shadow-sm">
    <div class="max-w-3xl mx-auto w-full px-4 flex items-center gap-2">
      <!-- Two deliberate lines, each truncating, rather than three accidental ones. Side by side
           they wrapped word by word as soon as the login pill took its width, which at 390 ate a
           third of the first screen. -->
      <!-- Two deliberate lines, each truncating, rather than three accidental ones. Side by side
           they wrapped word by word as soon as the login pill took its width, which at 390 ate a
           third of the first screen. The bar carries the title and the sign-in state and nothing
           else: a third control here left "Comp…" over "Kaisan Ku…" at 1280, and the one that was
           squeezing them is an action about the WORK, so it moved down beside the work. -->
      <div class="flex-1 min-w-0">
        <div class="text-lg font-bold leading-tight truncate">Company brain</div>
        <div id="co-name" class="opacity-60 text-sm truncate"></div>
      </div>
      <span id="login"></span>
    </div>
  </nav>

  <main id="app" class="flex-1 w-full max-w-3xl mx-auto p-4 chrome-clear"></main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-organism.js"></script>
  <script src="/v1/cortex/company-brain/libs/company-brain.js"></script>
  <script>
  (function () {
    'use strict';

    var CONTRACT = 'brain';
    var NS = {
      fact: 'brain.fact', entity: 'brain.entity', gap: 'brain.gap',
      commitment: 'brain.commitment', finding: 'brain.finding', brief: 'brain.brief',
    };
    /** The twelve registry fields, and the words a person would use for each. */
    var IDENTITY = [
      ['businessId', 'Business ID'], ['vatId', 'VAT ID'],
      ['streetAddress', 'Street address'], ['postalCode', 'Postal code'], ['city', 'City'],
      ['country', 'Country'], ['email', 'Email'], ['phone', 'Phone'],
      ['iban', 'IBAN'], ['bic', 'BIC'],
      ['einvoiceAddress', 'E-invoice address'], ['einvoiceOperator', 'E-invoice operator'],
    ];

    var session = null, company = null, companies = [], CTX = null, brainState = null, records = {}, schedules = [];
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
    function app() { return $('app'); }
    function say(html) { app().innerHTML = html; }
    function today() { return new Date().toISOString().slice(0, 10); }

    // ── boot ────────────────────────────────────────────────────────────────
    async function boot() {
      // The control has to be on the screen that asks for it. Telling somebody to sign in while
      // rendering nothing they can press is the same as telling them nothing.
      AIMEAT.auth.mountLoginButton('#login', { compactPill: true });
      AIMEAT.auth.on('login', function () { started = false; start(); });
      session = await AIMEAT.auth.login().catch(function () { return null; });
      if (!session) {
        say('<h2 class="text-lg font-bold mb-2">Your company’s own knowledge</h2>' +
          '<p class="opacity-70">Sign in to open it — the button is at the top right. ' +
          'What is in here is yours and nobody else can read it.</p>');
        return;
      }
      start();
    }

    var started = false;
    async function start() {
      if (started) return; started = true;
      session = await AIMEAT.auth.login().catch(function () { return null; });
      if (!session) { started = false; return; }
      say('<p class="opacity-60">Opening…</p>');

      companies = await listCompanies();
      if (!companies.length) return renderNoCompany();

      // THE ADDRESS IS THE PARAMETER. On {slug}.co.<apex> the first label of the host is the
      // company slug, so a copy installed for one company knows which one without being told.
      var label = String(location.hostname || '').split('.')[0].toLowerCase();
      var byHost = companies.filter(function (c) { return String(c.slug).toLowerCase() === label; });
      if (byHost.length === 1) return open(byHost[0]);
      if (companies.length === 1) return open(companies[0]);
      return renderPickCompany();
    }

    async function listCompanies() {
      var res = await session.fetch('/v1/companies?per_page=100').catch(function () { return null; });
      var data = (res && res.data) ? res.data : res;
      return (data && data.companies) || [];
    }

    function renderNoCompany() {
      say('<h2 class="text-lg font-bold mb-2">Register your company first</h2>' +
        '<p class="opacity-70 mb-3">This brain hangs off a company, because the company’s own ' +
        'details are the first thing it knows. A name is enough to start, and the address is ' +
        'reserved straight away.</p>' +
        '<a class="btn btn-primary px-4" href="/v1/profile?tab=companies" target="_top">Register a company</a>');
    }

    function renderPickCompany() {
      say('<h2 class="text-lg font-bold mb-3">Which company?</h2>' + companies.map(function (c, i) {
        return '<button class="btn btn-outline w-full justify-start mb-2 px-4" data-pick="' + i + '">' +
          esc(c.name) + '<span class="opacity-50 ml-2 text-xs">' + esc(c.address || c.slug) + '</span></button>';
      }).join(''));
      Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function (b) {
        b.onclick = function () { open(companies[Number(b.getAttribute('data-pick'))]); };
      });
    }

    // ── finding, or making, the space the knowledge lives in ────────────────
    async function open(co) {
      company = co;
      $('co-name').textContent = co.name;
      say('<p class="opacity-60">Looking for this company’s knowledge…</p>');
      var found = await findWorkspace(co);
      if (!found) return renderSetup();
      CTX = found;
      await load();
    }

    /**
     * The workspace is found by CONTRACT, not by a stored id: a workspace whose manifest declares
     * \`contract: 'brain'\`. When the company already points at an organism only that one is searched,
     * which is both faster and right — two companies must not share one brain.
     */
    async function findWorkspace(co) {
      var orgs = [];
      if (co.organismId) {
        var one = await AIMEAT.organism.get(co.organismId).catch(function () { return null; });
        orgs = one ? [{ id: co.organismId, name: (one && one.name) || co.name }] : [];
      }
      if (!orgs.length) orgs = await AIMEAT.organism.list().catch(function () { return []; });
      for (var i = 0; i < orgs.length; i++) {
        var wss = await AIMEAT.organism.workspaces(orgs[i].id).catch(function () { return []; });
        for (var j = 0; j < wss.length; j++) {
          if (wss[j].access === 'none') continue;
          var ws = await AIMEAT.organism.read(orgs[i].id, wss[j].id).catch(function () { return null; });
          var types = (ws && ws.manifest && ws.manifest.objectTypes) || [];
          var hit = types.some(function (o) { return o && o.contract === CONTRACT; });
          if (hit) return { org: orgs[i].id, ws: wss[j].id };
        }
      }
      return null;
    }

    function manifest() {
      return {
        manifestVersion: '1.0', id: 'brain', name: company.name + ' — brain',
        kind: 'project', status: 'active',
        objectTypes: [
          { name: 'fact', namespace: NS.fact, schemaRef: 'brain.fact', backing: 'memory', writeRole: 'member', mode: 'records', contract: CONTRACT, maxVersions: 5 },
          { name: 'entity', namespace: NS.entity, schemaRef: 'brain.entity', backing: 'memory', writeRole: 'member', mode: 'records', maxVersions: 5 },
          { name: 'gap', namespace: NS.gap, schemaRef: 'brain.gap', backing: 'memory', writeRole: 'member', mode: 'records', maxVersions: 3 },
          { name: 'commitment', namespace: NS.commitment, schemaRef: 'brain.commitment', backing: 'memory', writeRole: 'member', mode: 'records', maxVersions: 3 },
          { name: 'finding', namespace: NS.finding, schemaRef: 'brain.finding', backing: 'memory', writeRole: 'member', mode: 'records', maxVersions: 1 },
          { name: 'brief', namespace: NS.brief, schemaRef: 'schema:document@1', backing: 'memory', writeRole: 'member', mode: 'document' },
        ],
      };
    }

    function schemas() {
      var s = {};
      s[NS.fact] = {
        type: 'object', additionalProperties: true,
        required: ['id', 'claim', 'kind', 'as_of'],
        properties: {
          id: { type: 'string' }, claim: { type: 'string' },
          // The whole life cycle in one field. Anchored points at something the owner holds and
          // never falls due; observed is somebody having looked at the world, and it wears out.
          kind: { type: 'string', enum: ['anchored', 'observed'] },
          source_ref: { type: 'string' }, as_of: { type: 'string' },
          review_after: { type: 'string' }, note: { type: 'string' },
        },
      };
      s[NS.entity] = {
        type: 'object', additionalProperties: true, required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, note: { type: 'string' } },
      };
      s[NS.gap] = {
        type: 'object', additionalProperties: true, required: ['id', 'what'],
        properties: { id: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' }, since: { type: 'string' } },
      };
      s[NS.commitment] = {
        type: 'object', additionalProperties: true, required: ['id', 'what'],
        properties: { id: { type: 'string' }, what: { type: 'string' }, who: { type: 'string' }, due: { type: 'string' }, status: { type: 'string' } },
      };
      // source_url IS REQUIRED, and that is the whole point of the space. A finding is somebody
      // reporting what they read somewhere; without the somewhere it is an assertion wearing a
      // research coat, and this schema refuses to store one.
      s[NS.finding] = {
        type: 'object', additionalProperties: true,
        required: ['id', 'claim', 'source_url', 'accessed'],
        properties: {
          id: { type: 'string' }, claim: { type: 'string' },
          source_url: { type: 'string' }, accessed: { type: 'string' },
          found_by: { type: 'string' }, supersedes: { type: 'string' },
          status: { type: 'string', enum: ['new', 'promoted', 'discarded'] },
        },
      };
      return s;
    }

    function renderSetup() {
      var org = company.organismId;
      say('<h2 class="text-lg font-bold mb-2">One step, and this company has a memory</h2>' +
        '<p class="opacity-70 mb-3 text-sm">Everything it learns is kept in a space of your own, ' +
        'private to you, and exportable whenever you want it elsewhere. Your company’s ' +
        'registered details become its first facts, each one pointing back at the entry you wrote.</p>' +
        '<button class="btn btn-primary px-4" id="do-setup">Set it up</button> ' +
        '<span id="setup-note" class="opacity-60 text-sm ml-2"></span>' +
        '<details class="mt-6"><summary class="cursor-pointer opacity-70 text-sm">Rather have your own AI do it</summary>' +
        '<div class="mockup-code text-xs whitespace-pre-wrap p-3 mt-2" id="setup-box"></div>' +
        '<button class="btn btn-outline px-4 mt-2" id="copy-setup">Copy</button></details>');
      $('setup-box').textContent = setupPrompt();
      $('copy-setup').onclick = async function (e) {
        await navigator.clipboard.writeText(setupPrompt()); e.target.textContent = 'Copied';
      };
      $('do-setup').onclick = async function (e) {
        e.target.disabled = true;
        var note = $('setup-note');
        try {
          note.textContent = org ? 'Making the space…' : 'Making a space of your own…';
          if (!org) {
            var created = await AIMEAT.organism.create(company.name, { visibility: 'private', description: 'Everything ' + company.name + ' knows.' });
            org = (created && (created.id || (created.organism && created.organism.id))) || null;
            if (!org) throw new Error('the space could not be created');
            // Point the company at it, so the next copy and every finance record agree on where
            // this company's things live. A brain beside a company that has never heard of it is
            // exactly the state this whole target was written to end.
            // PUT, and only this one field: the route merges what it is sent and leaves the rest of
            // the record alone. Sending the whole company back would be the same act with a much
            // larger blast radius, since a stale copy of the identity fields would overwrite
            // whatever the owner changed while this page was open.
            await session.fetch('/v1/companies/' + encodeURIComponent(company.id), {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ organism_id: org }),
            }).catch(function () { /* the brain still works; the link is a convenience */ });
          }
          var ws = await AIMEAT.organism.createWorkspace(org, company.name + ' — brain', manifest(), schemas());
          var wsId = (ws && (ws.ws || ws.id)) || null;
          if (!wsId) throw new Error('the workspace could not be created');
          CTX = { org: org, ws: wsId };
          await AIMEAT.brain.configure(session, { company: company.name, org: org, ws: wsId }).catch(function () { return null; });
          note.textContent = 'Reading your company details…';
          await seedIdentity();
          await load();
        } catch (err) {
          note.textContent = String((err && err.message) || err);
          e.target.disabled = false;
        }
      };
    }

    function setupPrompt() {
      return [
        'Set up the space my company brain keeps its knowledge in, on AIMEAT. Use your AIMEAT MCP tools.',
        '',
        '1. Create an organism I own, name "' + company.name + '", visibility private (aimeat_organism_create).',
        '2. Point the company at it: aimeat_company_update { company_id: "' + company.id + '", organism_id: "<org>" }.',
        '3. In it, create a workspace (aimeat_workspace_create) with:',
        '     name: "' + company.name + ' — brain"',
        '     manifest: ' + JSON.stringify(manifest()),
        '',
        'The brain finds this workspace by itself afterwards — it looks for the contract',
        '"' + CONTRACT + '" in the manifest, so there is nothing to paste back into it.',
      ].join('\\n');
    }

    // ── the registered details become the first anchored facts ──────────────
    /**
     * One fact per FILLED IN field, and none for an empty one. An empty field is not knowledge with
     * a blank value; it is something nobody has told this company yet, and writing it as a fact
     * would be the brain inventing its own first lie.
     */
    async function seedIdentity() {
      var made = 0;
      for (var i = 0; i < IDENTITY.length; i++) {
        var key = IDENTITY[i][0], label = IDENTITY[i][1];
        var value = company[key];
        if (value == null || String(value).trim() === '') continue;
        var id = 'fact-company-' + key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        var fact = {
          id: id, claim: label + ': ' + String(value), kind: 'anchored',
          // It points back at the registry entry the owner wrote themselves, which is why it never
          // falls due: the document is theirs and it is not going anywhere.
          source_ref: 'company:' + company.id, as_of: today(),
          note: 'From your company registration.',
        };
        await AIMEAT.organism.writeDraft(CTX.org, CTX.ws, NS.fact, id, fact).catch(function () { return null; });
        await AIMEAT.organism.publish(CTX.org, CTX.ws, NS.fact, id).catch(function () { return null; });
        made++;
      }
      // The company record is source number one, always, and its coverage note says what a
      // registration does not tell you — which is most of what a company knows.
      await AIMEAT.brain.putSource(session, {
        id: 'company-registration', kind: 'company', ref: company.id,
        feeds: 'The legal identity: name, ids, address, bank and e-invoicing.',
        cadence_days: 0,
        coverage_note: 'Says nothing about customers, money, people, commitments or anything that changed after you typed it.',
        last_ok_at: new Date().toISOString(),
      }).catch(function () { return null; });
      return made;
    }

    // ── reading everything the page shows ───────────────────────────────────
    async function load() {
      say('<p class="opacity-60">Reading…</p>');
      var ws = await AIMEAT.organism.read(CTX.org, CTX.ws).catch(function () { return null; });
      records = {};
      var spaces = (ws && ws.spaces) || [];
      for (var i = 0; i < spaces.length; i++) {
        records[spaces[i].namespace || spaces[i].name] = (spaces[i].items || []).map(function (it) {
          // \`value\` is the DRAFT when there is one, which is what makes the findings section work
          // at all: an agent writes findings as drafts on purpose, and a reader that only saw
          // published records would show an empty page while the queue filled up behind it.
          var v = it.value || {};
          v.__draft = it.status === 'draft' || it.status === 'draft+published';
          return v;
        });
      }
      brainState = await AIMEAT.brain.state(session).catch(function () { return null; });
      // THE LIVE STATE, JOINED AT READ TIME. GET /v1/schedules needs no scope beyond being signed
      // in, so a stopped clock shows the second somebody opens this page rather than a week later
      // when the caretaker next runs. The caretaker itself is in this list too.
      var sch = await session.fetch('/v1/schedules').catch(function () { return null; });
      var sd = (sch && sch.data) ? sch.data : sch;
      schedules = Array.isArray(sd) ? sd : ((sd && sd.schedules) || []);
      render();
    }

    /** One schedule by id, or null. */
    function scheduleById(id) {
      if (!id) return null;
      for (var i = 0; i < schedules.length; i++) if (schedules[i] && schedules[i].id === id) return schedules[i];
      return null;
    }

    /**
     * What a source's clock is doing, in the words somebody would use about it.
     *
     * Returns null when the source names no clock, which is a real answer and not a gap: an upload
     * somebody brings by hand has no clock and should not be nagged about one.
     */
    function clockLine(s) {
      if (!s || !s.schedule_id) return null;
      var job = scheduleById(s.schedule_id);
      // NAMED A CLOCK THAT IS NOT THERE. Worth saying out loud: the schedule was deleted, or the
      // id was never right, and either way this feed is waiting for something that will not come.
      if (!job) return { text: 'It names a clock this account does not have.', bad: true };
      if (!job.enabled) return { text: 'Its clock is switched off.', bad: true };
      if (job.lastRunResult === 'error') {
        return { text: 'Its clock ran and failed' + (job.lastRunError ? ': ' + job.lastRunError : '.'), bad: true };
      }
      var last = job.lastRunAt ? 'last ran ' + String(job.lastRunAt).slice(0, 10) : 'has not run yet';
      var next = job.nextRunAt ? ', next ' + String(job.nextRunAt).slice(0, 10) : '';
      return { text: 'Its clock is running: ' + last + next + '.', bad: false };
    }

    function facts() { return records[NS.fact] || records.fact || []; }
    function gaps() { return records[NS.gap] || records.gap || []; }
    function findings() { return records[NS.finding] || records.finding || []; }
    function sources() { return (brainState && brainState.sources) || []; }

    /** Findings nobody has decided about yet. A promoted or discarded one has left the queue. */
    function openFindings() {
      return findings().filter(function (f) { return f && f.source_url && (f.status || 'new') === 'new'; });
    }

    /**
     * Findings already decided, still stored.
     *
     * Worth offering to clear, and the reason is a measured number rather than tidiness: a published
     * record costs TWO keys, the live one and the version beside it, and the default ceiling is a
     * thousand per person. An agent that looks every week writes every week, so findings are the
     * one space here that grows without anybody choosing to grow it. A promoted one has already
     * done its job — the fact it became carries the address it came from.
     */
    function settledFindings() {
      return findings().filter(function (f) { return f && f.id && (f.status === 'promoted' || f.status === 'discarded'); });
    }

    /**
     * When an observed fact should be looked at again, offered rather than assumed.
     *
     * Six months is a guess and it is shown as an editable date for exactly that reason: the right
     * interval belongs to whoever knows the subject, and a hidden default would be this app
     * deciding how long somebody else's knowledge stays true.
     */
    function defaultReview() {
      var d = new Date();
      d.setDate(d.getDate() + 180);
      return d.toISOString().slice(0, 10);
    }

    // ── what is waiting for the person ──────────────────────────────────────
    /**
     * ONE thing, in the order that respects their time: something broken beats something stale,
     * and a fact that has fallen due beats a question nobody has answered. A list of everything
     * outstanding is a list people stop reading; one thing is a thing people do.
     */
    function waiting() {
      var broken = sources().filter(function (s) { return s && s.status === 'broken'; });
      if (broken.length) {
        return { what: 'A source has stopped: ' + broken[0].id, why: broken[0].last_error || 'It reported a failure.' };
      }
      var due = facts().filter(function (f) { return AIMEAT.brain.staleness(f, today()) === 'due'; });
      if (due.length) {
        return { what: 'Check whether this is still true: ' + due[0].claim, why: 'It was due for a look on ' + String(due[0].review_after).slice(0, 10) + '.' };
      }
      var quiet = sources().filter(function (s) { return s && s.status === 'late'; });
      if (quiet.length) {
        return { what: quiet[0].id + ' has gone quiet', why: quiet[0].last_ok_at ? 'Last delivered ' + String(quiet[0].last_ok_at).slice(0, 10) + '.' : 'It has never delivered anything.' };
      }
      var fresh = openFindings();
      if (fresh.length) {
        return {
          what: 'Somebody went and looked, and this is waiting on you: ' + fresh[0].claim,
          why: 'Say whether it is true, or discard it. Until you do, it is not part of what this company knows.',
        };
      }
      var open = gaps();
      if (open.length) return { what: open[0].what, why: open[0].why || 'Nobody has filled this in yet.' };
      if (!sources().length) return { what: 'Nothing feeds this brain yet', why: 'Add a source below, so it learns something after today.' };
      return null;
    }

    function chip(kind) {
      if (kind === 'anchored') return '<span class="badge badge-sm badge-outline">anchored</span>';
      if (kind === 'due') return '<span class="badge badge-sm badge-warning">needs checking</span>';
      if (kind === 'unknown') return '<span class="badge badge-sm badge-ghost">no review date</span>';
      return '<span class="badge badge-sm badge-ghost">checked</span>';
    }

    function render() {
      var w = waiting();
      var fs = facts(), ss = sources(), rep = brainState && brainState.report;

      var html = '';

      // ── waiting for you ──
      html += '<section class="mb-6"><h2 class="text-lg font-bold mb-2">Waiting for you</h2>';
      html += w
        ? '<div class="alert"><div><div class="font-medium">' + esc(w.what) + '</div>' +
          '<div class="opacity-70 text-sm">' + esc(w.why) + '</div></div></div>'
        : '<p class="opacity-70 text-sm">Nothing. Everything that feeds this is delivering, and nothing has fallen due.</p>';
      html += '</section>';

      // ── what we know ──
      html += '<section class="mb-6"><h2 class="text-lg font-bold mb-2">What we know ' +
        '<span class="opacity-50 text-sm font-normal">' + fs.length + '</span></h2>';
      if (!fs.length) {
        html += '<p class="opacity-70 text-sm">Nothing yet.</p>';
      } else {
        html += '<ul class="divide-y divide-base-300">' + fs.map(function (f) {
          var st = AIMEAT.brain.staleness(f, today());
          return '<li class="py-2"><div class="flex items-start gap-2">' +
            '<div class="flex-1 min-w-0"><div>' + esc(f.claim) + '</div>' +
            '<div class="opacity-60 text-xs mt-0.5">' + esc(f.as_of || '') +
            (f.source_ref ? ' · ' + esc(f.source_ref) : '') + '</div></div>' +
            chip(st === 'anchored' ? 'anchored' : st) + '</div></li>';
        }).join('') + '</ul>';
      }
      html += '</section>';

      // ── what somebody found, still waiting on you ──
      //
      // A FINDING IS NOT A FACT, and this section is where that distinction earns its keep. An
      // agent that went and looked writes findings, as drafts, and the schema refuses one with no
      // source_url. Turning a finding into a fact is the owner's move and nobody else's: the
      // moment an agent could do it, the brain would start filling with things it decided were
      // true, and the whole provenance story would be decoration.
      var open = openFindings();
      if (open.length) {
        html += '<section class="mb-6"><h2 class="text-lg font-bold mb-2">Somebody went and looked ' +
          '<span class="opacity-50 text-sm font-normal">' + open.length + '</span></h2>' +
          '<p class="opacity-70 text-sm mb-2">Drafts. Nothing here is part of what you know until you say so.</p>';
        html += '<ul class="divide-y divide-base-300">' + open.map(function (f, i) {
          return '<li class="py-3"><div>' + esc(f.claim) + '</div>' +
            '<div class="opacity-60 text-xs mt-0.5">' +
            (f.found_by ? esc(f.found_by) + ' · ' : '') + esc(f.accessed || '') + '</div>' +
            // The address is the point of the record, so it is a link rather than a footnote: the
            // owner deciding whether this is true will want to open it.
            '<div class="text-xs mt-0.5"><a class="link" target="_blank" rel="noopener noreferrer" href="' +
            esc(f.source_url) + '">' + esc(f.source_url) + '</a></div>' +
            '<div class="flex gap-2 items-center flex-wrap mt-2">' +
            '<button class="btn btn-primary btn-sm px-3" data-promote="' + i + '">Yes, this is true</button>' +
            '<input type="date" class="input input-bordered input-sm" data-review="' + i + '" value="' + esc(defaultReview()) + '" title="Check again after" />' +
            '<button class="btn btn-ghost btn-sm px-3" data-discard="' + i + '">Discard</button>' +
            '</div></li>';
        }).join('') + '</ul></section>';
      }

      var settled = settledFindings();
      if (settled.length) {
        html += '<div class="mb-6 flex items-center gap-3 flex-wrap">' +
          '<button class="btn btn-ghost btn-sm px-3" id="clear-settled">Clear ' + settled.length + ' settled</button>' +
          '<span class="opacity-70 text-sm">Already decided. Clearing them frees room; the facts they became keep their sources.</span>' +
          '</div>';
      }

      // ── where this comes from ──
      html += '<section class="mb-6"><h2 class="text-lg font-bold mb-2">Where this comes from</h2>';
      if (!ss.length) {
        html += '<p class="opacity-70 text-sm">Nothing feeds this yet.</p>';
      } else {
        html += '<ul class="divide-y divide-base-300">' + ss.map(function (s) {
          var when = s.last_ok_at ? String(s.last_ok_at).slice(0, 10) : 'never';
          return '<li class="py-2" data-src="' + esc(s.id) + '">' +
            '<div class="flex items-start gap-2"><div class="flex-1 min-w-0">' +
            '<div class="font-medium">' + esc(s.id) + ' <span class="opacity-50 text-xs font-normal">' + esc(s.kind) + '</span></div>' +
            (s.feeds ? '<div class="opacity-70 text-sm">' + esc(s.feeds) + '</div>' : '') +
            // ALWAYS RENDERED, including when it is empty. A blank coverage note is the thing worth
            // seeing: it means nobody has written down what this source leaves out.
            '<div class="text-sm mt-0.5 ' + (s.coverage_note ? 'opacity-70' : 'text-warning') + '">' +
            (s.coverage_note ? 'Does not cover: ' + esc(s.coverage_note) : 'Nobody has said what this does not cover.') +
            '</div>' +
            '<div class="opacity-60 text-xs mt-0.5">Last delivered ' + esc(when) +
            (s.last_error ? ' · ' + esc(s.last_error) : '') + '</div>' +
            // JOINED WHEN THIS RENDERS, against the owner's live schedule list. A clock that was
            // switched off yesterday says so now, rather than staying quiet until the caretaker's
            // next weekly run notices the silence.
            (function () {
              var c = clockLine(s);
              if (c) return '<div class="text-xs mt-0.5 ' + (c.bad ? 'text-warning' : 'opacity-60') + '">' + esc(c.text) + '</div>';
              // A connected account's health is not readable from here: an app may ask to PUBLISH to
              // the accounts somebody connected, and there is no word in the grant vocabulary for
              // reading the list. Rather than guess, point at the place that knows.
              if (s.kind === 'connection') {
                return '<div class="text-xs mt-0.5 opacity-60">A connected account. ' +
                  '<a class="link" target="_top" href="/v1/profile?tab=connections">Check it in your profile</a>.</div>';
              }
              return '<div class="text-xs mt-0.5 opacity-60">No clock. You feed this by hand.</div>';
            })() + '</div>' +
            '<span class="badge badge-sm ' + (s.status === 'broken' ? 'badge-error' : s.status === 'late' ? 'badge-warning' : 'badge-ghost') + '">' +
            esc(s.status || 'ok') + '</span></div></li>';
        }).join('') + '</ul>';
      }
      // The caretaker is a schedule like any other, so its own state is in the list we just read.
      // Saying when it next runs is what makes "Never checked" reassuring rather than alarming.
      var keeper = schedules.filter(function (j) { return j && /-ext-brain$/.test(String(j.extensionName || '')); })[0];
      html += '<div class="mt-3 flex gap-2 items-center flex-wrap">' +
        '<button class="btn btn-outline btn-sm px-3" id="check-now">Check now</button>' +
        '<span class="opacity-60 text-xs" id="check-note">' +
        (rep ? 'Last checked ' + esc(String(rep.generatedAt).slice(0, 10)) + ' · ' + rep.checked + ' looked at, ' + rep.late + ' quiet, ' + rep.broken + ' broken' : 'Never checked') +
        (keeper && keeper.enabled && keeper.nextRunAt ? ' · checks itself again ' + esc(String(keeper.nextRunAt).slice(0, 10)) : '') +
        (keeper && !keeper.enabled ? ' · its weekly check is switched off' : '') +
        '</span></div>';
      html += '</section>';

      // ── adding things ──
      html += '<details class="mb-3"><summary class="cursor-pointer font-medium">Add something you know</summary>' +
        '<div class="mt-2 flex flex-col gap-2">' +
        '<input id="f-claim" class="input input-bordered w-full" placeholder="What is true? e.g. Our biggest customer is Acme Ltd" />' +
        '<div class="flex gap-2 items-center flex-wrap">' +
        '<select id="f-kind" class="select select-bordered">' +
        '<option value="observed">Somebody looked and saw this</option>' +
        '<option value="anchored">It is written in a document I hold</option></select>' +
        '<input id="f-review" type="date" class="input input-bordered" title="Check again after" />' +
        '<button class="btn btn-primary px-4" id="f-add">Add</button></div>' +
        '<p class="opacity-60 text-xs">A document you hold never goes stale. Anything somebody ' +
        'observed does, so give it a date to look again.</p></div></details>';

      html += '<details class="mb-3"><summary class="cursor-pointer font-medium">Add something that feeds this</summary>' +
        '<div class="mt-2 flex flex-col gap-2">' +
        '<input id="s-id" class="input input-bordered w-full" placeholder="A short name, e.g. bank-statements" />' +
        '<input id="s-feeds" class="input input-bordered w-full" placeholder="What does it tell you?" />' +
        '<input id="s-cover" class="input input-bordered w-full" placeholder="What does it NOT cover?" />' +
        '<div class="flex gap-2 items-center flex-wrap">' +
        '<select id="s-kind" class="select select-bordered">' +
        '<option value="upload">A file I bring</option><option value="connection">A connected account</option>' +
        '<option value="web">Something on the web</option><option value="chat">A conversation</option>' +
        '<option value="extension">Something running here</option></select>' +
        '<input id="s-days" type="number" min="0" class="input input-bordered w-28" placeholder="Every N days" />' +
        // Naming the clock is what makes "its clock stopped" possible on the next open. Offered as
        // the owner's OWN schedules rather than a text field, because an id typed from memory is a
        // pointer at nothing, and this page would then report that as a fault in the feed.
        '<select id="s-sched" class="select select-bordered"><option value="">No clock</option>' +
        schedules.map(function (j) {
          return '<option value="' + esc(j.id) + '">' + esc(j.displayName || j.name || j.id) + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-primary px-4" id="s-add">Add</button></div></div></details>';

      // The chat path, which is the one we prefer. It sits with the work rather than in the title
      // bar: it is a thing you do to this brain, not a thing about this page.
      html += '<div class="mt-6 pt-4 border-t border-base-300 flex items-center gap-3 flex-wrap">' +
        '<button class="btn btn-outline px-4" id="agent-prompt">Copy agent prompt</button>' +
        '<span class="opacity-70 text-sm">Hand this to your own AI and it can feed this brain from any chat.</span>' +
        '</div>';

      say(html);
      wire();
    }

    /**
     * A finding becomes a fact. The claim carries over, the ADDRESS becomes the fact's source, and
     * the kind is always 'observed': somebody looked at the world and reported what they saw, so it
     * wears out and it says when to look again. Nothing an agent found is ever anchored — anchored
     * means a document the owner holds, and a web page is not that however good it is.
     *
     * The finding is then marked promoted rather than deleted. Where a fact came from is part of
     * what the fact is, and removing the finding would leave the fact pointing at an address with
     * no record of who fetched it, when, or what else they saw.
     */
    async function promote(f, reviewAfter) {
      var id = 'fact-' + Date.now().toString(36);
      await AIMEAT.organism.writeDraft(CTX.org, CTX.ws, NS.fact, id, {
        id: id, claim: f.claim, kind: 'observed',
        source_ref: f.source_url, as_of: today(),
        review_after: reviewAfter || defaultReview(),
        note: f.found_by ? 'Found by ' + f.found_by + '.' : 'Promoted from a finding.',
      });
      await AIMEAT.organism.publish(CTX.org, CTX.ws, NS.fact, id).catch(function () { return null; });
      await settle(f, 'promoted');
    }

    /** Mark a finding decided, and publish it so it stops being a draft in somebody's queue. */
    async function settle(f, status) {
      var next = {};
      for (var k in f) { if (Object.prototype.hasOwnProperty.call(f, k) && k !== '__draft') next[k] = f[k]; }
      next.status = status;
      await AIMEAT.organism.writeDraft(CTX.org, CTX.ws, NS.finding, f.id, next);
      await AIMEAT.organism.publish(CTX.org, CTX.ws, NS.finding, f.id).catch(function () { return null; });
    }

    function wire() {
      $('agent-prompt').onclick = async function (e) {
        await navigator.clipboard.writeText(agentPrompt()); e.target.textContent = 'Copied';
      };
      var open = openFindings();
      Array.prototype.forEach.call(document.querySelectorAll('[data-promote]'), function (b) {
        b.onclick = async function () {
          b.disabled = true;
          var i = Number(b.getAttribute('data-promote'));
          var picked = document.querySelector('[data-review="' + i + '"]');
          await promote(open[i], picked && picked.value);
          await load();
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-discard]'), function (b) {
        b.onclick = async function () {
          b.disabled = true;
          await settle(open[Number(b.getAttribute('data-discard'))], 'discarded');
          await load();
        };
      });
      if ($('clear-settled')) {
        $('clear-settled').onclick = async function (e) {
          e.target.disabled = true;
          await AIMEAT.organism.deleteRecords(CTX.org, CTX.ws, NS.finding,
            settledFindings().map(function (f) { return f.id; })).catch(function () { return null; });
          await load();
        };
      }
      $('check-now').onclick = async function (e) {
        e.target.disabled = true;
        $('check-note').textContent = 'Checking…';
        await AIMEAT.brain.sweep(session).catch(function () { return null; });
        await load();
      };
      $('f-add').onclick = async function (e) {
        var claim = $('f-claim').value.trim();
        if (!claim) return;
        e.target.disabled = true;
        var kind = $('f-kind').value;
        var id = 'fact-' + Date.now().toString(36);
        var fact = { id: id, claim: claim, kind: kind, as_of: today(), source_ref: 'chat:owner' };
        var review = $('f-review').value;
        if (kind === 'observed' && review) fact.review_after = review;
        await AIMEAT.organism.writeDraft(CTX.org, CTX.ws, NS.fact, id, fact);
        await AIMEAT.organism.publish(CTX.org, CTX.ws, NS.fact, id).catch(function () { return null; });
        await load();
      };
      $('s-add').onclick = async function (e) {
        var id = $('s-id').value.trim();
        if (!id) return;
        e.target.disabled = true;
        await AIMEAT.brain.putSource(session, {
          id: id, kind: $('s-kind').value, feeds: $('s-feeds').value.trim(),
          coverage_note: $('s-cover').value.trim(),
          cadence_days: Number($('s-days').value || 0),
          schedule_id: $('s-sched').value,
        });
        await load();
      };
    }

    /** The same work, for whoever brought their own AI. The chat path is the one we prefer. */
    function agentPrompt() {
      return [
        'You keep the company brain for "' + company.name + '" on AIMEAT. Use your AIMEAT MCP tools.',
        '',
        'Workspace: organism_id "' + CTX.org + '", ws "' + CTX.ws + '".',
        '',
        'What is in there:',
        '  ' + NS.fact + '    what we know. kind "anchored" (a document we hold, never goes stale)',
        '                    or "observed" (somebody looked; give it review_after).',
        '  ' + NS.entity + '  the people and organisations it is about.',
        '  ' + NS.gap + '     what we know we do not know.',
        '  ' + NS.finding + '  something you found out there. source_url is REQUIRED — a claim',
        '                    with no address is refused by the schema, on purpose.',
        '',
        'How to work:',
        '1. Read what is there first: aimeat_workspace_read { organism_id, ws }.',
        '2. Write findings as drafts: aimeat_workspace_write { organism_id, ws, space: "finding", id, value }.',
        '   Leave them as drafts. Turning a finding into a fact is mine to decide, not yours.',
        '3. Never invent a source. If you cannot say where something came from, it is a gap, not a fact.',
      ].join('\\n');
    }

    boot();
  })();
  </script>
</body>
</html>
`;
