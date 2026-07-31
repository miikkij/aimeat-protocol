/**
 * @file build-app-prompt.ts
 * @description The canonical "build an AIMEAT app" prompt — the SAME text the app-catalog's
 *   Create-new-app button copies, served from the node so every consumer (app-catalog UI,
 *   agentic coders via GET /v1/prompts/build-app, llms.txt readers) gets one non-drifting
 *   source of truth. The app-catalog composes its dynamic header (user's idea, improve-mode
 *   source app, selected template) around the `body` part; agents take `full` as-is.
 * @structure buildAppPrompt(config, opts) -> { full, body }
 *   - body: the platform-instructions core (heading + libraries + auth + data + AI + realtime
 *     + design + rules [+ publish-back for mode 'new']) — what the app-catalog fetches.
 *   - full: language line + interview header (mode 'new') + body — what agents fetch.
 * @usage import { buildAppPrompt } from '../services/build-app-prompt.js';
 *   const { full, body } = buildAppPrompt(config, { lang: 'en', mode: 'new', idea: '...' });
 * @version-history
 *   2026-07-31 — "Spending the user's money" section (AI calls + agent commissions): one click =
 *     one run on the SDK's own repeat guard, confirm before a batch via AIMEAT.spend.confirm,
 *     budget on screen, no automatic retry of a paid call, a cancel path for a running job — plus
 *     the matching publish check (five fast clicks must produce exactly one request).
 *   2026-07-25 — Fleet-facing app sections, all three born from real DESK build failures: "Reading
 *     data your AGENTS produced" (agent keys live under the agent GAII; an app-grant token needs
 *     ownerScope/agent explicitly, so an unscoped list() returns [] and the app looks empty; meta/
 *     count for listings; the task:<id> tag rather than the optional deliverableKey), "Live updates
 *     without a firehose" (the memory domain is continuous on an active fleet; keyPrefix/minIntervalMs
 *     gates; never repaint a surface the user is reading), and "Before you call it done" (three
 *     viewports incl. 1280x460, repaint count on the open dialog, network log after idle).
 *   2026-07-25 — Theme system v2: the two-axis model (data-theme mode × data-palette look, five
 *     designed palettes), the head restore snippet covers both axes, typography/elevation/motion
 *     tokens documented, the control-cluster rule (language + mode + palette all live in the pill),
 *     and the visual audit gains a non-default-palette spot check.
 *   2026-07-25 — Visual design sections. The prompt's only real design content used to be the GAME
 *     form-language block, which ended by telling every non-game app that a flat daisyUI page was
 *     "the right default" — so the paved path reliably produced identical grey cards, one type size
 *     and no focal point. Adds "Visual design: components are not a design" (focal point, type
 *     scale, colour as meaning, grouping, measure, designed empty/loading states, and the cortex
 *     packs to reach for) and "Verify what it LOOKS like" (both themes, contrast, brand token,
 *     type scale, with a runnable audit snippet). Design Guidelines now states the brand-is-a-token
 *     rule, since /lib/aimeat-theme.css makes --color-primary the coral.
 *   2026-07-19 — Mobile safety checklist section (overflow-x:clip, minmax(0,1fr)+min-width:0,
 *     wrap-wide-content, verify scrollWidth===clientWidth) + viewport meta gains viewport-fit=cover
 *     + interactive-widget=resizes-content. Prevention baked into the paved path.
 *   2026-07-19 — Research-first flow (AppDev KB Phase 7): Step 0 + tier decision tree + finish checklist / appdev-flow prompt / handbook module
 *   v1.5.0 — 2026-07-19 — MCP-agent section: load node:aimeat-app-builder first + curated
 *     pitfall registry pointer (/v1/appdev/pitfalls) (AppDev KB Phase 2)
 *   v1.4.0 — 2026-07-16 — Auth Pattern path 3: AIMEAT.auth.on('login'/'logout') — async logins
 *     (app-subdomain silent SSO, consent-popup return) fire neither onLogin nor a pending
 *     login(); AEB-3 finding aeb3-flow-001 (a 5/5 app stayed hidden after grant on app origin).
 *   v1.3.0 — 2026-07-16 — Library sections generated from the library-pack registry
 *     (src/data/library-packs.ts): SDK groups + Ready-made UI + the NEW "Optional capability
 *     packs" index (vendored libs with fetch-on-demand docs at GET /v1/library-packs/:id).
 *     Design Guidelines now name the self-hosted styling stack; improve mode gains the
 *     conscious-upgrade rule (read the pack changelog, explain, upgrade only with consent).
 *   v1.2.0 — 2026-07-14 — Agent face section (Agent Face phase 3): the three agent surfaces
 *     (read=face, act=WebMCP tools, learn=bound skill), the six face rules, and the
 *     AIMEATAgentFace.publish snippet (aimeat-agentface.js, phase 2)
 *   v1.1.0 — 2026-07-14 — aimeat-commerce.js added to the Economy & agents library group
 *     (checkout sessions, offer prices, micro-unit money formatting; TARGET-033)
 *   v1.0.0 — 2026-07-13 — ported verbatim from app-catalog buildPromptFromBuilder() (cortex.js)
 *     so the node becomes the single source of truth (AEB pilot finding: the best app-building
 *     accelerator was locked inside the browser bundle, invisible to agentic coders).
 *   v1.1.0 — 2026-07-19 — "Game / playful look — form language, not just palette" section
 *     (extruded type via the fonts pack, sticker cards, juice, world-object ambient rule) —
 *     born from pitfall app/candy-palette-alone-is-not-a-game-look.
 */
import type { AimeatConfig } from '../config.js';
// The grantable scope vocabulary — imported so the prompt's scope list can NEVER drift from
// what the authorize endpoint actually accepts (guessed scope names were an AEB-2 finding).
import { APP_GRANTABLE_SCOPES } from '../routes/app-grants.js';
// The library-pack registry — the prompt's library sections are GENERATED from it so the
// lists can never drift from /v1/libs, /v1/library-packs, bootstrap or llms.txt (Phase 1
// of the Library Acceleration Program killed the 4-way hardcoded-list drift).
import { buildPromptLibrarySections } from '../data/library-packs.js';
import { buildResearchStep, buildFinishChecklist } from './appdev-flow-constants.js';

export interface BuildAppPromptOptions {
  /** Conversation/UI language for the generated app. Only 'en' and 'fi' are localized. */
  lang?: string;
  /** 'new' (default): full guided build. 'improve': platform-instructions body only. */
  mode?: 'new' | 'improve';
  /** The user's app idea, embedded into the 'new' header. Defaults to the interview nudge. */
  idea?: string;
}

const PB_LANGS: Record<string, string> = { en: 'English', fi: 'Finnish (Suomi)' };
const DEFAULT_IDEA = '(not given yet — ask me what to build)';

/** Compose the canonical build-an-app prompt. Text mirrors the app-catalog prompt builder. */
export function buildAppPrompt(
  config: AimeatConfig,
  opts: BuildAppPromptOptions = {},
): { full: string; body: string } {
  const nodeUrl = config.baseUrl.replace(/\/+$/, '');
  const mode = opts.mode === 'improve' ? 'improve' : 'new';
  const isImprove = mode === 'improve';
  const idea = (opts.idea || '').trim().slice(0, 500) || DEFAULT_IDEA;
  const pbLang = PB_LANGS[opts.lang || 'en'] || 'English';

  // ── body: platform instructions (heading + core [+ publish-back for 'new']) ──
  let body = '';
  body += isImprove ? '## AIMEAT Platform Instructions\n\n' : '## Step 2 — Build it (once I have answered)\n\n';
  body += 'This app runs in the AIMEAT ecosystem. Here is what you need to know:\n\n';

  // Tier decision tree — the shape decision comes BEFORE any code (AppDev KB Phase 7).
  body += "### Choose the app's shape (T1/T2/T3)\n";
  body += 'Decide the tier first; start from the matching shell at GET ' + nodeUrl + '/v1/app-templates:\n';
  body += '- **T1 — pure client** (shell-pure-client): auth + data + UI in one HTML file. The default; most apps end here.\n';
  body += '- **T2 — +cortex** (shell-cortex): the app leans on ready-made cortex UI libs (DataTable, forms, charts). Pick when the UI is data-heavy.\n';
  body += '- **T3 — +extension** (shell-extension): the app needs SERVER-side work — a third-party API (ctx.fetch), server-enforced rules (only-author-can-delete, one-vote-per-user), or its own `ext:` data. Only tier that ships an extension.\n';
  body += '- **Own users/roles?** If the app has its own member community (roles, levels, approval) start from the **usecase-app-iam** template (`/v1/app-templates`), which wires the node roster, the owner panel and the applicant form together; the pack is only needed when the gate must live in an extension: `MemberAdmin({target})` is the roster and approval panel, and `sections` puts your own settings in it instead of a second admin screen. Decide at framing time; a hand-rolled auth list in memory keys is painful to retrofit. Two rules that are NOT obvious and have already cost rework: a role belongs to the PERSON, so the agents of a member inherit it (never key a role to the acting agent), and `can()` only paints while the extension enforces, in the action that mutates data.\n\n';

  // Libraries: the whole section (SDK groups + Ready-made UI cortex + Optional capability
  // packs) is generated from the library-pack registry — src/data/library-packs.ts — so this
  // prompt can never drift from GET /v1/libs, GET /v1/library-packs, bootstrap or llms.txt.
  body += buildPromptLibrarySections(nodeUrl);

  // Auth pattern
  body += '### Auth Pattern\n';
  body += 'Handle BOTH login paths: a fresh sign-in click (the onLogin callback) AND a page that loads already signed in (restore the session yourself). `onLogin` fires ONLY on a fresh sign-in — it does NOT fire on reload when a session already exists, so a page that relies on onLogin alone shows nothing to an already-logged-in returning user.\n';
  body += 'The login bar is the ONLY interactive sign-in path: on an app origin `AIMEAT.auth.login()` is silent-only (it restores an existing session and returns null otherwise). Never hand-roll a sign-in button that calls login() — mount the login bar; a custom button must delegate its click to the login bar\'s own button.\n';
  body += '```html\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  body += '<script>\n';
  body += 'function showApp(session) { /* session.owner, session.jwt, session.fetch() */ }\n';
  body += 'function hideApp() { /* hide content, show a "Sign in" message */ }\n';
  body += '\n';
  body += '// Path 1 — fresh sign-in / sign-out via the login button:\n';
  body += 'AIMEAT.auth.mountLoginButton("#login", {\n';
  body += '  onLogin: showApp,   // fires ONLY on a fresh sign-in click, NOT on reload\n';
  body += '  onLogout: hideApp\n';
  body += '});\n';
  body += '\n';
  body += '// Path 2 — already signed in when the page loads. Restore the stored session\n';
  body += '// explicitly; login() returns the session (or null if not signed in).\n';
  body += 'AIMEAT.auth.login().then(function (session) { if (session) showApp(session); });\n';
  body += '\n';
  body += '// Path 3 — ASYNC logins (app-subdomain silent SSO, consent-popup return): these\n';
  body += '// fire neither onLogin nor the login() promise above. The login EVENT covers every\n';
  body += "// path — always add it, or a published app stays hidden after the user grants access.\n";
  body += "AIMEAT.auth.on('login', showApp);\n";
  body += "AIMEAT.auth.on('logout', hideApp);\n";
  body += '</' + 'script>\n';
  body += '```\n\n';

  // App permissions — the scope vocabulary, generated from the authorize endpoint's own constant
  // The language control. Every app used to hand-roll its own EN/FI switch — a text button here, a
  // select there, a pair of links elsewhere — against three different storage keys. It now travels
  // in the login pill exactly as the theme toggle does. (Reported 2026-07-25: "it is ALWAYS
  // different in every single app".)
  body += '### Language: declare it, never build the switch\n';
  body += 'A bilingual app does NOT build its own language button. The login pill carries the platform control cluster — a segmented language switch (every declared language visible, one click to any), the light/dark switch and the palette picker — so every app on the node has the identical controls in the identical place. You declare which languages you have and react to the change:\n';
  body += '```html\n';
  body += '<meta name="aimeat-locales" content="en fi">\n';
  body += '```\n';
  body += '```javascript\n';
  body += 'var lang = AIMEAT.auth.getLang();                 // "en" | "fi" — resolved ?lang= > localStorage > cookie > navigator\n';
  body += 'window.addEventListener("aimeat-lang-change", function (e) { lang = e.detail.lang; render(); });\n';
  body += '```\n';
  body += 'Declare one language (or none) and no control renders. The choice is stored under the ONE platform key `aimeat-lang`, the same one the AIMEAT SPA and the sign-in modal use, so an app and the site agree. `AIMEAT.auth.setLang("fi")` sets it programmatically. Do not invent a second key, a second control, or a `?locale=` parameter.\n\n';

  body += '### App permissions (scopes)\n';
  body += 'An app that declares nothing gets the DEFAULT grant: `memory:read memory:write storage:read storage:write`. If the app needs more, declare EVERY scope it uses in the head — the user approves them at sign-in:\n';
  body += '```html\n';
  body += '<meta name="aimeat-scopes" content="memory:read memory:write storage:read storage:write memory:delete ai:use">\n';
  body += '```\n';
  body += 'The complete grantable vocabulary on this node (requesting ANY name outside this list fails sign-in with INVALID_SCOPE — take names from here, never guess; live list: GET ' + nodeUrl + '/v1/app-grants/scopes):\n';
  for (const [s, d] of Object.entries(APP_GRANTABLE_SCOPES)) {
    body += '- `' + s + '` — ' + d + '\n';
  }
  body += 'Notes: deleting memory keys needs `memory:delete` (NOT in the defaults). File DELETION is covered by `storage:write` — there is NO storage:delete scope. AI features need `ai:use`.\n\n';

  // Data storage
  body += '### Data Storage\n';
  body += 'Match the PRIVATE vs SHARED choice from Step 1:\n';
  body += '```javascript\n';
  body += '// PRIVATE — scoped to the logged-in owner, only they can read it:\n';
  body += 'await AIMEAT.data.set("myapp.notes", data, { visibility: "private", tags: ["myapp"] });\n';
  body += 'const mine = await AIMEAT.data.get("myapp.notes");\n';
  body += '// SHARED/community — public so everyone can read; each user writes their own key:\n';
  body += 'await AIMEAT.data.set("myapp.shared.<unique-id>", entry, { visibility: "public" });\n';
  body += 'const theirs = await AIMEAT.data.getPublic(ownerGaii, "myapp.shared.<id>");  // read others\n';
  body += 'const results = await AIMEAT.data.search("query");\n';
  body += '```\n';
  body += 'Works only when logged in. After a write, read it back to confirm it persisted.\n';
  body += 'A key is a plain string: `get(key)` / `getPublic(gaii, key)` always return the LATEST value — never append a version, index or `:0`/`:N` suffix to a key, and read back the SAME key you wrote (a store-as-`x` / read-as-`x:0` mismatch just 404s and your UI shows nothing). To page a large list, store it as ONE array under one key (or shard with your OWN explicit id scheme), not a magic version suffix.\n';
  body += 'Shared feeds, journals, comments and discussions are ALL built this way — one public key per entry, `getPublic()` to read others\'. Never reach for Boards (deprecated, removal-bound) or organism workspaces as an app\'s data layer. When a rule must be enforced server-side (only-author-can-delete, one-vote-per-user), that logic goes into an extension — see the extension guide, not into boards/organisms.\n\n';

  // Reading what the owner's AGENTS produced. This is the single most common "my app shows
  // nothing" cause for fleet-facing apps: agent output is NOT in the owner's namespace, and an
  // app-grant token gets no automatic broadening, so an unscoped list() legitimately returns [].
  body += '### Reading data your AGENTS produced (not your own keys)\n';
  body += 'An agent publishes under **its own** namespace (`agentname#owner@node`), NOT the owner\'s. Your app token is role `app`, which gets no automatic owner-scope broadening — so a plain `list({prefix})` returns NOTHING for agent data and the app looks empty while the data is right there. Say which namespace you mean:\n';
  body += '```javascript\n';
  body += '// every same-owner namespace (owner GHII + all their agents) — the usual choice:\n';
  body += 'const { items } = await AIMEAT.data.list({ prefix: "crews.", ownerScope: true, meta: true });\n';
  body += '// one specific agent (full GAII), e.g. from AIMEAT.agents.list():\n';
  body += 'const mine = await AIMEAT.data.list({ prefix: "watch.", agent: "uutisankka#alice@node-id" });\n';
  body += 'const value = await AIMEAT.data.get(items[0].key, { agent: items[0].owner_gaii });\n';
  body += '```\n';
  body += '**`meta: true` on any listing you render as a table/board/archive.** The default response inlines EVERY value, so a fleet-wide prefix can be megabytes on each load; `meta` returns keys + `bytes` + `tags` + `updated_at` and you fetch a value only when the user opens that row. `count: true` (or `AIMEAT.data.count({prefix})`) returns just a number — the cheap way to ask "did anything change?".\n';
  body += 'Each listed item carries `owner_gaii` (which namespace it lives in) and `tags`. Agent task-runners commonly tag their published output `task:<taskId>`, which is how you tie a record back to the task that produced it — `task.deliverableKey` is OPTIONAL and many agents never set it, so never require that field to find a result. `AIMEAT.agents.deliverable()` already falls back to the tag.\n\n';

  // Public Intake — the ONLY way an anonymous (not-logged-in) visitor can submit data into an owner's
  // space. Every other write path requires auth, so lead/contact/feedback/RSVP/survey forms need this.
  body += '### Collecting input from anonymous visitors (Public Intake)\n';
  body += 'Published apps render for logged-OUT visitors, but every write path requires auth — so a stranger cannot save anything directly. For public **lead forms, contact forms, feedback, questionnaires, quizzes, RSVP, waitlists, support intake**, use the Public Intake capability (`AIMEAT.intake`, load `/v1/libs/aimeat-intake.js`). The OWNER defines a form once (server-side, pinned to a destination + an allow-list of fields); anyone then submits with NO login. The node honeypot-screens, per-IP rate-limits, resolves the owner server-side, allow-lists fields, validates against the destination schema, and writes ONE owner-owned record — never exposing other data. Submissions are normal records, so the app reads/aggregates them (stats, dashboards) and agents can triage them.\n';
  body += '```javascript\n';
  body += '// OWNER (once, logged in): define a form → get a shareable link\n';
  body += 'const { form_id, submit_url } = await AIMEAT.intake.defineForm({\n';
  body += '  organism_id, ws, namespace: "crm.contacts",       // destination (a schema-locked workspace namespace)\n';
  body += '  form_id: "contact-us",                             // omit to get an unguessable frm_ token (private link)\n';
  body += '  allowed_fields: ["nimi", "email", "viesti"],       // ONLY these may be set by a submitter\n';
  body += '  required_fields: ["email"], defaults: { tila: "uusi", lahde: "public-form" },\n';
  body += '  honeypot_field: "company_url", mode: "publish",    // "draft" = owner reviews before it goes live\n';
  body += '  title: "Contact us", fields: [{ key: "nimi", label: "Name" }, { key: "email", label: "Email" }] });\n';
  body += '// PUBLIC form page (NO login): render from the descriptor, then submit\n';
  body += 'const form = await AIMEAT.intake.getForm(organism_id, ws, "contact-us");   // title + fields to draw\n';
  body += 'await AIMEAT.intake.submit(organism_id, ws, "contact-us", { nimi, email, viesti });   // works anonymously\n';
  body += '```\n';
  body += 'The form page can be a generic renderer OR your own branded/custom page (multi-step, quiz logic, thank-you upsell) — both call the same two public methods. Never try to write owner data from an anonymous session any other way.\n\n';

  // Images & files — the cross-user display pattern (the #1 storage mistake is base64 embeds)
  body += '### Images & files (cross-user display)\n';
  body += 'Upload files with `visibility: "public"` and display them to OTHER users via the anonymous public URL. Never embed images as base64 data URLs inside memory values — store the file once, reference its URL.\n';
  body += '```javascript\n';
  body += 'const key = "myapp/img-" + Date.now() + ".png";\n';
  body += 'await AIMEAT.storage.upload(file, { key, visibility: "public" });\n';
  body += '// The URL ANYONE (other users, even signed-out) can load in <img src>:\n';
  body += 'const url = "' + nodeUrl + '/v1/pub/" + encodeURIComponent(session.ghii) + "/" + key;\n';
  body += "// Save that url (or { owner: session.ghii, key }) in the entry's memory record.\n";
  body += '```\n';
  body += "Gotcha: `AIMEAT.storage.publicUrl(key)` returns the OWNER's `/v1/storage/...` URL, which requires the owner's auth — it will NOT load for other users. Cross-user image display always uses `/v1/pub/<owner-ghii>/<key>`.\n\n";

  // AI
  body += '### AI (prompt-driven)\n';
  body += "aimeat-ai runs an LLM on the LOGGED-IN USER's own OpenRouter key — free for the app, and the user controls spend. Load aimeat-auth first, then gate every \"Use AI\" control on isAvailable().\n";
  body += '```html\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-ai.js"></' + 'script>\n';
  body += '```\n';
  body += '```javascript\n';
  body += 'if (await AIMEAT.ai.isAvailable()) {            // false until login + key configured\n';
  body += '  const r = await AIMEAT.ai.complete({ app_id: "my-app", prompt: "Summarise:\\n" + text });\n';
  body += '  render(r.content);                            // also: r.model, r.usage, r.budget\n';
  body += '} else { showHint("Log in and add an AI key to enable this."); }\n';
  body += '// Structured output: const { parsed } = await AIMEAT.ai.completeJson({ app_id, prompt, schema });\n';
  body += '```\n';
  body += 'Always handle isAvailable()===false and catch errors; never hardcode an API key in the app.\n\n';

  // Spending guard. Both money paths (the user's OpenRouter credit via aimeat-ai, an agent run via
  // aimeat-agents) are one click away, and the classic accident is five clicks on a button that
  // showed no feedback = five paid runs of the same job. The libs collapse repeats themselves; this
  // section tells the builder to keep that, to ask before a batch, and to show the cost.
  body += '### Spending the user\'s money (AI calls and agent commissions)\n';
  body += "Two things here spend real money on the signed-in user's own account: an `AIMEAT.ai.*` call (their OpenRouter credit) and an `AIMEAT.agents.createTask()`/`run()` commission (an agent run, plus that agent's own model spend). Every control that triggers one is a spending control — build it like one:\n";
  body += '- **One click, one run.** Both libraries already collapse repeats: an identical `ai.complete()` that is still in flight returns the SAME promise, and an identical commission returns THAT task for 60 seconds instead of queueing a second one. Keep that default — pass `allowDuplicate: true` only when the user genuinely asked for a second, parallel run. On top of it, disable the control while its call runs and show the in-flight state, so the screen says what actually happened.\n';
  body += '- **Ask before a batch, and before commissioning an agent.** One summary the user just clicked: run it. "Summarise all 200 rows", "commission the agent", "regenerate everything": confirm first, naming the count and the cost.\n';
  body += '```javascript\n';
  body += 'const r = await AIMEAT.ai.complete({ app_id: "my-app", prompt,\n';
  body += '  confirm: { what: "Summarise " + rows.length + " rows", estimate: "~" + rows.length + " AI calls" } });\n';
  body += 'const task = await AIMEAT.agents.createTask("news-agent", { description }, { confirm: true });\n';
  body += 'if (task.deduplicated) show("That run is already going — here it is.");   // see below\n';
  body += '// Your own flows (buying, bidding, anything paid): AIMEAT.spend.confirm returns true/false\n';
  body += 'if (!await AIMEAT.spend.confirm({ what, detail, estimate, remember: "myapp:bulk" })) return;\n';
  body += '```\n';
  body += 'The dialog is theme-aware, arms its confirm button late (a double-click cannot travel through it), and with `remember` it offers "don\'t ask again in this session". A cancel rejects with `.code === "SPEND_CANCELLED"` — catch that and just return; it is a choice, not an error to report.\n';
  body += '- **A user action starts a spend — never the page.** No AI call on load, none from an `AIMEAT.live` event, none on a timer, none on every keystroke. If a field feeds AI, debounce it AND require an explicit button.\n';
  body += "- **Show the cost and what is left.** Every completion returns `r.budget` (`spent_today_usd`, `remaining_usd`, `daily_budget_usd`) — put it near the AI control (\"$0.29 of $1.00 used today\"), and the confirm dialog will show the last figure it saw automatically. `AIMEAT.ai.usage()` gives today's snapshot to owner sessions.\n";
  body += '- **A failure gets a message, never an automatic retry.** `QUOTA_EXHAUSTED` / `APP_QUOTA_EXHAUSTED` / `RATE_LIMITED` mean stop and tell the user what happened; a retry loop around a paid call burns the budget it is reacting to. Let the user click again.\n';
  body += '- **Give a running job a way out.** After a commission, show the task and its status (`AIMEAT.agents.watch()`), and offer `AIMEAT.agents.cancelTask(name, id)`. An app that fires an agent and shows nothing invites the user to fire it again.\n';
  body += '- **Say when the node hands back a run you already have.** The page-level guard is blind across a reload or a second tab, so the NODE holds the same line: while an identical commission is still open it returns THAT task and sets `task.deduplicated` (with `task.deduplicated_reason`). Show it — "that run is already going, here it is" — instead of reporting a queue that never happened. Name the job yourself with `{ idempotencyKey: "order-" + row.id }` when the wording varies but the work is the same, and use `{ allowDuplicate: true }` for a genuine parallel run.\n\n';

  // Real-time / multiplayer
  body += '### Real-time / multiplayer (optional)\n';
  body += 'For shared live state (presence boards, 1v1 games) use realtime rooms via your authenticated session.fetch:\n';
  body += '```javascript\n';
  body += '// 1) create or join a room\n';
  body += 'const room = (await session.fetch("/v1/realtime/rooms", { method: "POST",\n';
  body += '  body: JSON.stringify({ name: "my-room" }) })).data;   // → { id, ws_url }\n';
  body += '// 2) open a WebSocket for live presence + messages\n';
  body += 'const ws = new WebSocket(location.origin.replace(/^http/, "ws") + room.ws_url);\n';
  body += 'ws.onmessage = (e) => handle(JSON.parse(e.data));\n';
  body += '// 3) for low-latency P2P, GET /v1/realtime/ice-servers and use WebRTC\n';
  body += '```\n';
  body += 'Simpler apps can skip rooms and just observe shared AIMEAT.data keys on a timer.\n\n';

  // Live updates — the firehose trap. Correct-looking code that makes the app poll forever
  // and repaint over the user, on any account with more than a couple of active agents.
  body += '### Live updates without a firehose (aimeat-live.js)\n';
  body += '`AIMEAT.live.subscribe(["memory"], reload)` means "call me whenever ANY of this owner\'s memory changed". On an account with an active agent fleet that is near-continuous, so a handler that re-fetches a full listing turns one agent\'s activity into a permanent poll. Gate it:\n';
  body += '```javascript\n';
  body += '// fire only when the number of keys under a prefix actually changed:\n';
  body += 'AIMEAT.live.subscribe(["memory"], reload, { keyPrefix: "crews.", ownerScope: true });\n';
  body += 'AIMEAT.live.subscribe(["memory"], reload, { minIntervalMs: 10000 });   // or just rate-limit\n';
  body += '```\n';
  body += 'The change frame carries a DOMAIN name, never the key that changed, so `keyPrefix` is a client-side count gate: it catches a NEW key, not an in-place update of an existing one. Use `minIntervalMs` for update-sensitive views.\n';
  body += '**Never let a live event repaint a surface the user is currently reading.** If a dialog/detail view is open, refresh its data in the background and leave the visible content alone — only an explicit user action should replace it. Rebuilding a list or blanking a pane to "Loading…" on every event is what makes an app flicker, and it looks like a crash, not a refresh. Also: render into a detached element and swap it in one operation instead of clearing then filling.\n\n';

  // Agent face — the markdown read-surface agents get on the app URL
  body += '### Agent face (markdown read-surface for agents)\n';
  body += 'A published app has THREE surfaces for AI agents: READ — its agent face, the markdown document the node serves on the app URL when a request prefers text/markdown (Accept header, or ?format=md); ACT — its WebMCP tools (GET /v1/apps/{owner}/{filename}/webmcp); LEARN — its bound skill (GET /v1/apps/{owner}/{filename}/skills). Give your app a good face and agents can use it without scraping the DOM.\n';
  body += 'The face is ONE public memory record, apps.{filename}.agentface, published by the app owner. When the app declares none, the node falls back to converting the app HTML; either way the node appends an "Agent affordances" footer (tools, skills, catalog, agent registration) automatically — never write that footer yourself.\n';
  body += 'Rules:\n';
  body += '- State lives in records, not the DOM — the face points agents at the public keys, it does not screenshot the UI\n';
  body += '- Update the face on the SAME writes that update the visible view, so agents and humans always see the same state\n';
  body += '- Content + affordances only — headings, data, links; no UI chrome, buttons, or styling talk\n';
  body += '- Public data only — the face is served to anonymous readers; never put private values in it\n';
  body += '- Actions go through tools — link the WebMCP tools for anything an agent should DO, never describe clicks\n';
  body += '- Bind a skill for anything longer than the face can teach (app-bound skills, metadata.binding)\n';
  body += '```html\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  body += '<script src="' + nodeUrl + '/v1/libs/aimeat-agentface.js"></' + 'script>\n';
  body += '```\n';
  body += '```javascript\n';
  body += '// In the same function that saves data and re-renders the view:\n';
  body += 'await AIMEAT.data.set("myapp.entries." + entry.id, entry, { visibility: "public" });\n';
  body += 'await AIMEATAgentFace.publish({\n';
  body += '  title: "My App",\n';
  body += '  sections: [\n';
  body += '    { heading: "Latest entries", body: entries.map(e => "- " + e.title).join("\\n") },\n';
  body += '    { heading: "Data", body: "Entries are public records under myapp.entries.* — read with AIMEAT.data.getPublic(ownerGaii, key)." },\n';
  body += '  ],\n';
  body += '}, { app: "my-app.html" });\n';
  body += '// A plain markdown string works too: AIMEATAgentFace.publish("# My App\\n...", { app: "my-app.html" })\n';
  body += '```\n';
  body += 'Pass { app: "my-app.html" } (your published filename) explicitly — on per-app subdomain origins the filename cannot be derived from the URL (alternatively add <meta name="aimeat-app" content="my-app.html"> to the page). publish() requires a signed-in session (aimeat-auth), and the node serves ONLY the record written by the APP OWNER — a visitor\'s publish lands in their own namespace and is never served, so it is safe to call on every save.\n\n';

  // Design guidelines
  body += '### Design Guidelines\n';
  body += 'For rich UIs use the self-hosted styling stack (the same one the app-shell templates use) instead of hand-rolling a CSS framework: the `styling` capability pack — daisyUI v5 components + Tailwind v4 utilities + the AIMEAT daisyUI theme + the cortex theme bridge, all loaded from this node (see the capability packs list above). For minimal pages plain CSS variables are fine.\n';
  body += '**The brand is a token, never a hex.** The theme sets `--color-primary` to the AIMEAT coral (#E8564A light, #FF6F62 dark, each with the right readable text colour on top). Write `btn-primary`, `text-primary`, `border-primary` and the brand appears correctly in BOTH modes and under EVERY palette. If you find yourself typing a brand hex into an app, you are creating something that will be wrong the moment the user switches look.\n';
  body += "**The theme system has two axes, and both belong to the user.** `data-theme` on `<html>` is the light/dark MODE (localStorage `aimeat-theme`); `data-palette` is the designed LOOK (localStorage `aimeat-palette`: `aimeat` coral default, `paper` warm editorial serif, `circuit` cold technical mono, `contrast` high-contrast accessible, `mist` quiet neutral — every one defines both modes, its own display face and radii, all contrast-verified; preview them at /lib/samples/themes.html). Style with the daisyUI/theme tokens and all ten combinations work for free. Restore both axes in <head> so there is no flash of the wrong look:\n";
  body += '```js\n';
  body += '(function(){ function mode(t){ document.documentElement.setAttribute("data-theme", t==="dark"?"dark":"light"); }\n';
  body += '  function pal(p){ if(p && p!=="aimeat") document.documentElement.setAttribute("data-palette", p); else document.documentElement.removeAttribute("data-palette"); }\n';
  body += '  mode(localStorage.getItem("aimeat-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));\n';
  body += '  pal(localStorage.getItem("aimeat-palette"));\n';
  body += '  addEventListener("storage", function(e){ if(e.key==="aimeat-theme" && e.newValue) mode(e.newValue);\n';
  body += '    if(e.key==="aimeat-palette" && e.newValue) pal(e.newValue); }); })();\n';
  body += '```\n';
  body += 'An app may SUGGEST a palette that fits its character (a reading app might default to `paper` for first-time visitors via `AIMEAT.auth.setPalette("paper")` before any stored choice exists) — but it never overrides a stored user choice and never builds its own picker: the login pill already carries one.\n';
  body += '**Typography is part of the theme.** Body text is Inter, headings and `.card-title` get the palette display face, `code`/`pre` get JetBrains Mono — automatically, self-hosted, with Finnish ä/ö covered. Never link an external font CDN (the app CSP forbids it) and never fight the display face with a hardcoded `font-family` on headings. Type-scale tokens when you size things yourself: `var(--text-hero)` for the one biggest thing on the page, `--text-title`, `--text-body`, `--text-fine` (13px floor). Elevation tokens for depth: `box-shadow: var(--elev-card)` resting, `--elev-raise` on hover, `--elev-pop` for menus/dialogs. Motion tokens: `var(--motion-fast|base|slow)` with `var(--ease-out)`.\n';
  body += 'Always include the viewport meta: `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">` (the last part makes the on-screen keyboard resize the layout instead of hiding bottom inputs). Mobile-first, single self-contained HTML file with embedded CSS + JS.\n\n';

  // Visual design for NON-game apps. Before this section the prompt's only real design content was
  // the game form-language block, which ended by telling every tool app that a flat daisyUI page was
  // "the right default" — so the paved path reliably produced nine identical grey cards with one type
  // size and no focal point. Components are not design; hierarchy is. (ODPS app review, 2026-07-25.)
  // The surface ladder, said out loud. base-100 is the PAGE and the fill daisyUI puts inside form
  // controls; base-200 is the raised card. Ten published apps wrote `card bg-base-100` before that
  // was written down anywhere, and on 2026-07-25 base-100 moved from near-white to the page beige
  // — at which point every one of those cards became exactly the colour of the page behind it.
  body += '### Surfaces — which base is which\n';
  body += 'The theme ladder is fixed and worth memorising, because getting it backwards makes an app look broken rather than merely plain: **`base-100` is the PAGE** (and the fill daisyUI puts inside inputs and selects), **`base-200` is a raised CARD**, and **`base-300` is wells, dividers and borders**. So a card is `card bg-base-200`, never `bg-base-100`: painting a card with the page colour makes it vanish into the background, and the inputs inside it go with it, because they are filled with that same colour. Never hardcode a hex value for any of these — five palettes ship and they move underneath you.\n\n';
  body += '### Visual design — components are not a design\n';
  body += 'daisyUI gives you correct, accessible COMPONENTS. It does not give you a design, and a page of stacked `card bg-base-200` blocks with one type size reads as unfinished no matter how good the logic underneath is. Six rules turn components into something worth looking at. They cost minutes, not hours:\n';
  body += '- **One focal point per screen.** Decide the single most important thing (the verdict, the number, the next action) and make it visually dominant — bigger, heavier, or the only saturated colour in view. If everything is the same weight, the eye has nowhere to land and the page reads as a wall.\n';
  body += '- **Use at least three type steps, and mean them.** A key metric set in the same 14px run as the sentence around it is invisible. Give numbers that matter display treatment: large, `font-semibold`, `tabular-nums`, tight tracking. Labels go small and `uppercase tracking-wide opacity-60`. Body text stays one comfortable size.\n';
  body += '- **Colour carries meaning or it carries nothing.** Default to neutral surfaces and reserve saturation for state and the primary action. Prefer the quiet variants (`badge-soft`, `alert-soft`, `btn-soft`, `badge-outline`) and keep ONE solid fill for the thing that genuinely has to shout.\n';
  body += '- **Group, do not stack.** Related facts belong in ONE card with internal structure, not one card each. A vertical run of more than about five sibling cards is a sign the content was never grouped. Give cards an edge (`card-border` / `border border-base-300`): the surface step alone makes a card read as a lighter patch, the hairline makes it read as a card.\n';
  body += '- **Cap the measure, use the space.** Long prose past ~70 characters per line is tiring, and a single `max-w-5xl` column on a wide screen is mostly empty gutters. Either keep the container narrower or put the freed width to work (a summary rail, a two-column split via `AIMEAT.ui.layout`).\n';
  body += '- **Design the empty, loading and error states.** They are most of what a new user sees. Use `AIMEAT.ui.motion.skeleton()` rather than a spinner (shimmer in the SHAPE of the coming content reads as fast; a spinner reads as stuck), and say what an empty state means plus what to do about it.\n';
  body += 'Reach for the cortex UI packs before hand-rolling: `aimeat-ui-motion` (`statTiles()` for a KPI row with count-up numbers and sparklines, `skeleton()`, `staggerIn()` for lists), `aimeat-ui-viewers` (`DataTable`, `List`, `Timeline`), `aimeat-ui-layout` (`MainDetail`, `DashboardGrid`, `Split`). Hand-rolling a `<ul>` where `statTiles` was one script tag away is the single most common reason an AIMEAT app looks poorer than it is.\n\n';

  // Mobile safety checklist — the recurring "it looks tiny / overflows on a phone" class of bug,
  // as positive DO-rules. The app-shell templates already bake these in; hand-rolled layouts must
  // follow them. (Distilled from the curated mobile pitfalls — auth-pill-overflow, grid-track-blowout.)
  body += '### Mobile safety checklist (do these — they prevent the #1 phone bug)\n';
  body += 'One element wider than the screen makes mobile browsers shrink-to-fit the WHOLE page, so every font renders tiny. Prevent it:\n';
  body += '- **`body { overflow-x: clip; }`** — a belt-and-braces guard against horizontal overflow. Use `clip`, NOT `hidden` (hidden makes body a scroll container and breaks `position: sticky` headers).\n';
  body += '- **The login pill is already mobile-safe** — `mountLoginButton` renders a compact account button + popover on phones automatically on an app origin. Do NOT put other fixed-width widgets in the header row next to it; let header children shrink (`min-width: 0`).\n';
  body += '- **CSS grid: use `grid-template-columns: … minmax(0,1fr)` and `min-width: 0` on grid/flex children.** A plain `1fr` is `minmax(auto,1fr)`, so a wide non-wrapping child (a table, `<pre>`, long code) inflates the track and overflows the page even inside an `overflow-x:auto` wrapper. `minmax(0,…)` + `min-width:0` let it shrink so the wrapper actually scrolls.\n';
  body += '- **Wrap wide content** — put tables / code blocks / diagrams in a `overflow-x:auto` container, and `flex-wrap: wrap` any toolbar/nav row whose item count can grow (tabs, pager dots).\n';
  body += '- **Verify**: at 390px (portrait) AND ~844px (landscape), `document.documentElement.scrollWidth === clientWidth` (zero horizontal overflow) and body text stays ≥14px.\n';
  body += 'For a focused view (chat/editor/wizard) on ≤760px, go full-screen (`position:fixed; inset:0` gated on an is-active class) with a Back affordance, rather than sharing the screen with app chrome.\n\n';

  // Visual verification. The mobile checklist proved a machine-checkable rule beats good intentions
  // (scrollWidth === clientWidth). These are the same idea for appearance: an app can pass every
  // functional test and still ship an unreadable dark theme, because nobody ever opened it.
  body += '### Verify what it LOOKS like, not just that it works\n';
  body += 'An app can pass every functional check and still be unreadable, because the builder developed in one theme and never opened the other. Before calling a UI finished, run these on the real page:\n';
  body += '- **Open BOTH modes.** Set `data-theme` to `light` AND `dark` and look at each. A dark screenshot is not optional — it is where hardcoded colours, invisible card edges and solid-fill badges go wrong. If you used only tokens, spot-check one non-default palette too (`document.documentElement.setAttribute("data-palette","circuit")`): a token-clean app passes every palette for free, and a hardcoded colour shows up immediately.\n';
  body += '- **Contrast**: body text ≥ 4.5:1 against its own background, large/bold text and UI components ≥ 3:1. The AIMEAT theme tokens are pre-verified in both themes, so if you only used tokens you are done; the moment you hardcode a colour you own its contrast.\n';
  body += '- **Brand present**: `getComputedStyle(document.documentElement).getPropertyValue("--color-primary")` resolves to the AIMEAT coral, and the primary action on screen actually uses it.\n';
  body += '- **Type scale real**: at least three distinct rendered font sizes, and the largest one is on the thing that matters most — not on a decorative page title above a wall of identical 14px text.\n';
  body += '- **No horizontal overflow** at 390px and ~844px (the mobile checklist above).\n';
  body += 'This one-liner returns the audit; run it in each theme:\n';
  body += '```js\n';
  body += '(() => { // elements carrying their OWN text — a leaf-only filter misses "31" inside <div>31<span>%</span></div>\n';
  body += '  const el = [...document.querySelectorAll("body *")].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()));\n';
  body += '  const px = e => parseFloat(getComputedStyle(e).fontSize);\n';
  body += '  const sizes = [...new Set(el.map(px))].sort((a,b) => b-a);\n';
  body += '  const d = document.documentElement;\n';
  body += '  return { theme: d.getAttribute("data-theme"), primary: getComputedStyle(d).getPropertyValue("--color-primary").trim(),\n';
  body += '    typeSteps: sizes, biggestText: el.find(e => px(e) === sizes[0])?.textContent.trim().slice(0,60),\n';
  body += '    smallestText: sizes[sizes.length-1], overflowPx: d.scrollWidth - d.clientWidth }; })()\n';
  body += '```\n';
  body += 'Pass: `typeSteps.length >= 3`, `overflowPx === 0`, `primary` resolves to the active palette\'s brand token (the coral under the default palette), `biggestText` is genuinely the most important thing on the page (if it is a decorative glyph or the page title, your hierarchy is upside down), and `smallestText >= 11` — note daisyUI renders `badge-xs` at 10px, so prefer `badge-sm` for anything a user has to read.\n\n';

  // Publish gate for dialogs + live data. Both bugs this encodes shipped from checks that
  // PASSED: an overlay verified only at 390px (it rendered below the footer on desktop), and a
  // "0 console errors" reading on an app that repainted its open dialog every second. Proxy
  // measurements generalise badly; these three are the actual behaviours.
  body += '### Before you call it done: measure it, do not glance at it\n';
  body += 'A clean console, compiling JS and one screenshot at one size prove almost nothing. If the app has a **dialog/overlay** or reads **live data**, run these three and report the numbers:\n';
  body += '1. **Three viewports, every interactive surface**: 390x844, 1280x900 and **1280x460**. The short one is the one that catches it: a centred/overlay panel that looks perfect at 900px high often clips its own top, becomes unscrollable, or renders below the page at 460px. Check `document.documentElement.scrollWidth - clientWidth === 0` at each, and that the dialog\'s top edge is >= 0 and its close control reachable.\n';
  body += '2. **Live channel connected, dialog open, count the repaints.** Put a `MutationObserver` on the open panel\'s content node and watch for 20 seconds while other work is happening on the account. Expected: **zero**. Anything above zero means a live event is repainting a surface the user is reading.\n';
  body += '3. **Read the network log after 60 idle seconds.** A repeating full listing is a bug even when nothing visibly breaks: it is a poll you did not intend. Gate it (see the live-updates section) so an idle app is idle.\n';
  body += '4. **If anything in the app costs money** (an AI call, an agent commission): open the network log, click that control FIVE times as fast as you can, and count the requests. Expected: **one**. Then RELOAD the page and commission the same job again — the node answers with the run you already have (`task.deduplicated`), and your UI must say so rather than claim a new one. Report both.\n';
  body += 'Verify the FEATURE too, not just the render: perform the real interaction (commission the thing, save the thing, delete the thing) and confirm the result actually appears and persists. "It did not crash" is not a pass.\n\n';

  // Game form language — palette alone reads as a dashboard; the FORM LANGUAGE makes the game.
  // Born from pitfall app/candy-palette-alone-is-not-a-game-look (TOWER TETRIS, 2026-07-19).
  body += '### Game / playful look — form language, not just palette\n';
  body += 'A game styled with only bright colors on white rounded cards still reads as a SaaS dashboard. Users judge this instantly. If the app is a game (or wants a playful/energetic feel), change the FORM LANGUAGE:\n';
  body += '- **Display type**: load the `fonts` pack (self-hosted Baloo 2 + Bangers — never an external font CDN) and give headings/numbers/buttons EXTRUDED depth: an 8-direction outline + a hard shade + a soft drop via layered text-shadow. A candy logo = per-letter colored <span>s with small individual rotations.\n';
  body += "- **Sticker cards**: 3px solid border (white in light / dark-tinted in dark) + an OFFSET color shadow (e.g. 6px 6px 0 rgba(...)) + a slight rotate(±1-2deg) per card + gradient tint backgrounds — instead of flat white panels.\n";
  body += '- **Frame the play area**: wrap the game canvas in a gradient border div; give its interior life (checkerboard tint, inner glow) instead of a plain background.\n';
  body += "- **Juice**: screen-shake keyframes on big events, scale-pop on changing numbers, a shine-sweep ::after on primary buttons, floating combo text. Small, cheap, and they carry most of the game feel.\n";
  body += '- **Ambient life lives IN the scene**: with a 3D/canvas view, decorations must be world objects (orbiting meshes, drifting sprites INSIDE the canvas) — never flat absolutely-positioned CSS elements over the canvas; those do not parallax and read as mistakes. CSS sky layers (clouds/stars) BEHIND a transparent canvas are fine.\n';
  body += 'Non-game apps: skip THIS section, but do not skip design — apply "Visual design: components are not a design" above. A tool app still needs a focal point, a real type scale and grouped content; it just gets there with restraint instead of stickers and juice.\n\n';

  // Rules
  body += '### Important Rules\n';
  body += '- Return the COMPLETE HTML file, not fragments\n';
  body += '- Never use literal closing script tags in JS comments or strings\n';
  body += '- Keep it as a single self-contained HTML file\n';
  body += '- Load only the libraries you actually use; load aimeat-auth before libs that need a session\n';
  body += '- Gate AI features on AIMEAT.ai.isAvailable() and handle the logged-out / no-key case\n';
  body += '- Treat every paid control (AI call, agent commission) as spending: one click = one run, confirm before a batch, show the budget, never retry a failed paid call automatically\n';
  body += "- Theme with the platform tokens; respect BOTH user choices — light/dark mode (localStorage \"aimeat-theme\", OS-preference fallback) and palette (localStorage \"aimeat-palette\") — and never build your own theme/language/palette control (the login pill carries the cluster)\n";
  body += '- Include error handling and loading states for API calls\n\n';

  // Conscious-upgrade rule (improve mode): library packs version consciously, never silently.
  if (isImprove) {
    body += '### Library packs in the app you are improving\n';
    body += 'If the app loads a capability pack (a /lib/ or /v1/cortex/ script from the list above), fetch that pack\'s detail first: GET ' + nodeUrl + '/v1/library-packs/<id> — read `ai_doc` (current usage) and `changelog`. If the changelog shows changes since the app was built, EXPLAIN them to the user (what changed and what it means for this app) and upgrade the app\'s usage only with their consent — never silently rewrite working library code to a newer idiom. Major versions ship as NEW files (e.g. chartjs@4.js stays forever when chartjs@5.js appears), so an app that keeps its current include lines keeps working.\n\n';
  }

  // Agentic-coder note: MCP-connected agents publish directly instead of the human paste flow.
  body += '### If you are an agentic coder with AIMEAT MCP tools\n';
  body += 'When `aimeat_*` MCP tools are available in your environment (Claude Code, Cursor, OpenHands, any MCP client), they are already authenticated as the user — USE THEM for node operations instead of raw HTTP: `aimeat_app_publish` to publish/update the app (upload mode for files > 1 KB), `aimeat_storage_upload` for files, `aimeat_memory_write`/`aimeat_memory_read` for data, `aimeat_discover` for discovery. Register throwaway accounts only for cross-user testing; the app itself is published under the user\'s own account via MCP. The publish walkthrough below is for HUMANS pasting in a chat — skip telling it to an MCP-equipped agent, just publish.\n';
  body += 'Load the paved-path skill first: `aimeat_skill_get` with ref `node:aimeat-app-builder` (spec-first workflow, research-before-building, publish checklist). Research with ONE call: `aimeat_appdev_overview` (pass your OWN model id — self-identify, never ask the user) — your existing apps + template proposals, library packs with per-model proofs, curated + learned pitfalls. Skim the pitfalls for the areas you touch before you hit them.\n';
  body += buildFinishChecklist();
  body += 'Namespace rule: data written through MCP tools is stored under the AGENT\'s identity (GAII, `name#owner@node`), NOT the human owner\'s — so a browser app reading the signed-in owner\'s keys will NOT see it. When agents seed or share data the app must read: store the author identity inside each record, write such keys with public visibility and read them with `AIMEAT.data.getPublic(<full agent GAII>, key)`, or add `?owner_scope=true` to memory reads (resolves the owner\'s agents\' keys too).\n\n';

  // After-build publish walkthrough (new-app mode only)
  if (!isImprove) {
    body += '## When the app is ready — tell me how to publish it\n';
    body += 'After you hand me the finished single HTML file, END your reply by telling me (in my language) to do exactly this:\n';
    body += '1. Open ' + nodeUrl + '/app-catalog.html\n';
    body += '2. Click "+ Add" → open the "Paste" tab → paste the HTML (or drop it as a file). The app name + description fill in automatically.\n';
    body += '3. Click Publish.\n';
    body += 'I will be asked to sign in first — it is fast: one click with Google, or a quick email + password, and a brand-new account is created right there in seconds.\n';
    body += 'What I get: once published, the app is LIVE on my own AIMEAT node and PUBLIC — anyone can find it in the community catalogue and use it, and I get a link to share. From my catalogue I can launch it, publish updates (older versions are always kept), park it (hide it from the public), or delete it. It keeps working with my AIMEAT login, saved data, files, AI and realtime features.\n\n';
  }

  // ── full: language line + header (new mode) + body ──
  let full = 'Language: talk to me and write ALL user-facing text (UI labels, buttons, messages) in ' + pbLang + '. These build instructions are in English, but converse with me and build the app interface in ' + pbLang + '.\n\n';
  if (!isImprove) {
    full += 'Help me build a single-file HTML app that runs on AIMEAT.\n';
    full += 'My initial idea: ' + idea + '\n\n';
    full += buildResearchStep();
    full += '## Step 1 — Interview me first\n';
    full += 'If I have not described my idea above, your FIRST reply must ask me what I want to build. Then ask me these in ONE message and wait for my answers:\n';
    full += '1. What kind of app? (message board · multiplayer game · notes/journal · habit or expense tracker · family tools like shared lists/calendar · drawing/creative · music jam · real-time collaboration · offer or need help/services · something else)\n';
    full += '2. What should it be called?\n';
    full += '3. How should it look and feel? (e.g. dark neon · cozy · sleek minimal · fun colorful) — it must support BOTH light and dark.\n';
    full += '4. Data: SHARED (a community space others can see and add to) or PRIVATE (only mine)?\n';
    full += '5. Should it use AI features (summaries, suggestions, generation)? If yes I can enable them via aimeat-ai.\n';
    full += '6. Does it need any special capabilities? (charts/graphs · editable flow or mindmap diagrams · static text-defined diagrams · a game or heavy 2D animation · generative art / creative canvas · 3D · live multi-user/realtime) — each maps to a capability pack in Step 2; include only what I pick.\n';
    full += 'Skip any question I already answered in my idea above. Use my answers to customise everything in Step 2.\n\n';
  }
  full += body;

  return { full, body };
}
