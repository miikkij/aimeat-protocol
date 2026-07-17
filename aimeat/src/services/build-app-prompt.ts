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
 */
import type { AimeatConfig } from '../config.js';
// The grantable scope vocabulary — imported so the prompt's scope list can NEVER drift from
// what the authorize endpoint actually accepts (guessed scope names were an AEB-2 finding).
import { APP_GRANTABLE_SCOPES } from '../routes/app-grants.js';
// The library-pack registry — the prompt's library sections are GENERATED from it so the
// lists can never drift from /v1/libs, /v1/library-packs, bootstrap or llms.txt (Phase 1
// of the Library Acceleration Program killed the 4-way hardcoded-list drift).
import { buildPromptLibrarySections } from '../data/library-packs.js';

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
  body += 'For rich UIs use the self-hosted styling stack (the same one the app-shell templates use) instead of hand-rolling a CSS framework: the `styling` capability pack — daisyUI v5 components + Tailwind v4 utilities + the AIMEAT theme bridge, all loaded from this node (see the capability packs list above). For minimal pages plain CSS variables are fine.\n';
  body += "Use CSS variables so the app themes cleanly, and RESPECT the user's AIMEAT theme: the light/dark choice they made in the AIMEAT pill is saved in localStorage \"aimeat-theme\" (\"light\"|\"dark\"). Define light as the default and dark under [data-theme=\"dark\"], then set that attribute from the saved choice on load (fall back to the OS preference, and live-update if it changes):\n";
  body += '```css\n';
  body += ':root { --bg:#fafaf8; --card:#fff; --text:#1a1a2e; --accent:#e8564a; --border:#e5e7eb; --radius:12px; }\n';
  body += ':root[data-theme="dark"] { --bg:#14141c; --card:#1e1e2a; --text:#ececf4; --border:#2e2e40; }\n';
  body += '```\n';
  body += '```js\n';
  body += '(function(){ function apply(t){ document.documentElement.setAttribute("data-theme", t==="dark"?"dark":"light"); }\n';
  body += '  apply(localStorage.getItem("aimeat-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));\n';
  body += '  addEventListener("storage", function(e){ if(e.key==="aimeat-theme" && e.newValue) apply(e.newValue); }); })();\n';
  body += '```\n';
  body += 'Always include <meta name="viewport" content="width=device-width, initial-scale=1.0">. Mobile-first, single self-contained HTML file with embedded CSS + JS.\n\n';

  // Rules
  body += '### Important Rules\n';
  body += '- Return the COMPLETE HTML file, not fragments\n';
  body += '- Never use literal closing script tags in JS comments or strings\n';
  body += '- Keep it as a single self-contained HTML file\n';
  body += '- Load only the libraries you actually use; load aimeat-auth before libs that need a session\n';
  body += '- Gate AI features on AIMEAT.ai.isAvailable() and handle the logged-out / no-key case\n';
  body += "- Theme with CSS variables; respect the user's AIMEAT light/dark choice (localStorage \"aimeat-theme\") with an OS-preference fallback\n";
  body += '- Include error handling and loading states for API calls\n\n';

  // Conscious-upgrade rule (improve mode): library packs version consciously, never silently.
  if (isImprove) {
    body += '### Library packs in the app you are improving\n';
    body += 'If the app loads a capability pack (a /lib/ or /v1/cortex/ script from the list above), fetch that pack\'s detail first: GET ' + nodeUrl + '/v1/library-packs/<id> — read `ai_doc` (current usage) and `changelog`. If the changelog shows changes since the app was built, EXPLAIN them to the user (what changed and what it means for this app) and upgrade the app\'s usage only with their consent — never silently rewrite working library code to a newer idiom. Major versions ship as NEW files (e.g. chartjs@4.js stays forever when chartjs@5.js appears), so an app that keeps its current include lines keeps working.\n\n';
  }

  // Agentic-coder note: MCP-connected agents publish directly instead of the human paste flow.
  body += '### If you are an agentic coder with AIMEAT MCP tools\n';
  body += 'When `aimeat_*` MCP tools are available in your environment (Claude Code, Cursor, any MCP client), they are already authenticated as the user — USE THEM for node operations instead of raw HTTP: `aimeat_app_publish` to publish/update the app (upload mode for files > 1 KB), `aimeat_storage_upload` for files, `aimeat_memory_write`/`aimeat_memory_read` for data, `aimeat_discover` for discovery. Register throwaway accounts only for cross-user testing; the app itself is published under the user\'s own account via MCP. The publish walkthrough below is for HUMANS pasting in a chat — skip telling it to an MCP-equipped agent, just publish.\n';
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
