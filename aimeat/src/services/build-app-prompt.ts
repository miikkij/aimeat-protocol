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
 *   v1.0.0 — 2026-07-13 — ported verbatim from app-catalog buildPromptFromBuilder() (cortex.js)
 *     so the node becomes the single source of truth (AEB pilot finding: the best app-building
 *     accelerator was locked inside the browser bundle, invisible to agentic coders).
 */
import type { AimeatConfig } from '../config.js';

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

  // Core libraries
  body += '### Available Client Libraries\n';
  body += 'Load with <script src> from the node base ' + nodeUrl + '/v1/libs/. Include ONLY the ones you use. Load aimeat-auth first — the others build on its session.\n\n';
  body += 'Core:\n';
  body += '- aimeat-auth.js — login button, JWT, session (`AIMEAT.auth`, `session.fetch()`)\n';
  body += '- aimeat-data.js — private/public key-value memory + search (`AIMEAT.data`)\n';
  body += '- aimeat-storage.js — file upload/download (`AIMEAT.storage`)\n';
  body += '- aimeat-organism.js — organisms & workspaces: list, normalized workspace read (published + drafts merged per item), write drafts, publish, README, search (`AIMEAT.organism`). Requires aimeat-auth.\n\n';
  body += 'AI (prompt-driven — see the AI section below):\n';
  body += "- aimeat-ai.js — LLM completions on the USER's own OpenRouter key (`AIMEAT.ai.complete`). Requires aimeat-auth.\n\n";
  body += 'Economy & agents:\n';
  body += '- aimeat-wallet.js — morsel balance + transactions (`AIMEAT.wallet`)\n';
  body += '- aimeat-work.js — actions / work requests (`AIMEAT.work`)\n';
  body += "- aimeat-agents.js — commission & watch the owner's AI agents (`AIMEAT.agents`)\n";
  body += '- aimeat-capabilities.js — discover & invoke shared capabilities (`AIMEAT.capabilities`)\n\n';
  body += 'Media & misc:\n';
  body += '- aimeat-audio.js — audio engine: instruments, synth, soundboard\n';
  body += '- aimeat-speech.js — text-to-speech / speech helpers\n';
  body += '- aimeat-markdown.js — render markdown INTO an element: `AIMEAT.md.render(text, target)` (returns an Element — never assign it to innerHTML; use `renderToString(text)` for a string). `await AIMEAT.md.renderRich(text, target)` adds task lists, footnotes, code highlighting, Mermaid diagrams AND live data embeds: a ```aimeat-memory fence (lines `key: <memory key>`, optional `view: table|props|list|value|json`, `fields: a,b`, `title: …`) renders that memory key as a fresh table on every open — perfect for agent-produced data in documents.\n';
  body += '- aimeat-editor.js — markdown editor: `AIMEAT.editor.mount(el, {value, onChange})`, `AIMEAT.editor.toolbar(adapter)`, `AIMEAT.editor.split(el, {value, onChange})` for editor + live preview (pairs with aimeat-markdown.js)\n';
  body += '- aimeat-header.js — drop-in canonical site header (nav + theme)\n';
  body += '- aimeat-tunnel.js — personal-node tunnel client (advanced)\n\n';

  // Ready-made UI building blocks (node-bundled cortex)
  body += 'Ready-made UI (node-bundled — load from ' + nodeUrl + '/v1/cortex/<name>/libs/<name>.js, use only what you need):\n';
  body += '- aimeat-ui-viewers — sortable/filterable DataTable + viewers (`AIMEAT.ui.viewers`)\n';
  body += '- aimeat-ui-forms — form builder with validation (`AIMEAT.ui.forms`)\n';
  body += '- aimeat-ui-layout — responsive layout helpers, master/detail (`AIMEAT.ui.layout`)\n';
  body += '- aimeat-ui-nav — navbars, tabs, menus (`AIMEAT.ui.nav`)\n';
  body += '- aimeat-ui-dialogs — modals, toasts, confirms (`AIMEAT.ui.dialogs`)\n';
  body += '- aimeat-charts — charts / graphs (`AIMEAT.charts`)\n';
  body += '- aimeat-canvas — drawing / freeform canvas (`AIMEAT.canvas`)\n';
  body += 'Example: <script src="' + nodeUrl + '/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></' + 'script>\n\n';

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
  body += '</' + 'script>\n';
  body += '```\n\n';

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
  body += 'Shared feeds, journals, comments and discussions are ALL built this way — one public key per entry, `getPublic()` to read others\'. Never reach for Boards (deprecated, removal-bound) or organism workspaces as an app\'s data layer. When a rule must be enforced server-side (only-author-can-delete, one-vote-per-user), that logic goes into an extension — see the extension guide, not into boards/organisms.\n\n';

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

  // Design guidelines
  body += '### Design Guidelines\n';
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
    full += 'Skip any question I already answered in my idea above. Use my answers to customise everything in Step 2.\n\n';
  }
  full += body;

  return { full, body };
}
