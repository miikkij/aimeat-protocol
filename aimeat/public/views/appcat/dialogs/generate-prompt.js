/**
 * @file public/views/appcat/dialogs/generate-prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The prompt the "Generate App with AI" dialog composes (features F154, F155), word for
 *   word as the old catalogue's cortex.js buildPromptFromBuilder composed it. Atelier: "The app idea, in
 *   the owner's words: …" and the node's Atelier guide, plus the source under "## The app to improve"
 *   in improve mode; until the guide arrives, the line that says it is being fetched. Classic: the
 *   language line; the change (improve) or the idea and the six interview questions (new); the node's
 *   core text, or when the node has none the inline fallback; the source in improve mode; the starting
 *   template; the chosen capability packs with their include lines and their usage docs. The prompt's
 *   own words stay English on purpose: they tell the AI which language to talk and build in.
 * @structure buildPrompt(opts) · classicFallback(nodeUrl, isImprove) · PB_LANGS
 * @usage buildPrompt({ track, app, description, lang, core, coreAtelier, template, packs, atelierLoading })
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), moved from the old cortex.js with its
 *     words unchanged; Spanish joins the language line because appcat shows Spanish.
 */

/** The language the AI is asked to talk and build the interface in. */
export const PB_LANGS = { en: 'English', fi: 'Finnish (Suomi)', es: 'Spanish (Español)' };

/** The inline Classic instructions, for a node that serves no core text (offline, or an older node). */
export function classicFallback(nodeUrl, isImprove) {
  let prompt = isImprove ? '## AIMEAT Platform Instructions\n\n' : '## Step 2 — Build it (once I have answered)\n\n';
  prompt += 'This app runs in the AIMEAT ecosystem. Here is what you need to know:\n\n';

  prompt += '### Available Client Libraries\n';
  prompt += 'Load with <script src> from the node base ' + nodeUrl + '/v1/libs/. Include ONLY the ones you use. Load aimeat-auth first — the others build on its session.\n\n';
  prompt += 'Core:\n';
  prompt += '- aimeat-auth.js — login button, JWT, session (`AIMEAT.auth`, `session.fetch()`)\n';
  prompt += '- aimeat-data.js — private/public key-value memory + search (`AIMEAT.data`)\n';
  prompt += '- aimeat-storage.js — file upload/download (`AIMEAT.storage`)\n';
  prompt += '- aimeat-organism.js — organisms & workspaces: list, normalized workspace read (published + drafts merged per item), write drafts, publish, README, search (`AIMEAT.organism`). Requires aimeat-auth.\n\n';
  prompt += 'AI (prompt-driven — see the AI section below):\n';
  prompt += '- aimeat-ai.js — LLM completions on the USER\'s own OpenRouter key (`AIMEAT.ai.complete`). Requires aimeat-auth.\n\n';
  prompt += 'Economy & agents:\n';
  prompt += '- aimeat-wallet.js — morsel balance + transactions (`AIMEAT.wallet`)\n';
  prompt += '- aimeat-work.js — actions / work requests (`AIMEAT.work`)\n';
  prompt += '- aimeat-agents.js — commission & watch the owner\'s AI agents (`AIMEAT.agents`)\n';
  prompt += '- aimeat-capabilities.js — discover & invoke shared capabilities (`AIMEAT.capabilities`)\n\n';
  prompt += 'Media & misc:\n';
  prompt += '- aimeat-audio.js — audio engine: instruments, synth, soundboard\n';
  prompt += '- aimeat-speech.js — text-to-speech / speech helpers\n';
  prompt += '- aimeat-markdown.js — render markdown INTO an element: `AIMEAT.md.render(text, target)` (returns an Element — never assign it to innerHTML; use `renderToString(text)` for a string). `await AIMEAT.md.renderRich(text, target)` adds task lists, footnotes, code highlighting, Mermaid diagrams AND live data embeds: a ```aimeat-memory fence (lines `key: <memory key>`, optional `view: table|props|list|value|json`, `fields: a,b`, `title: …`) renders that memory key as a fresh table on every open — perfect for agent-produced data in documents.\n';
  prompt += '- aimeat-editor.js — markdown editor: `AIMEAT.editor.mount(el, {value, onChange})`, `AIMEAT.editor.toolbar(adapter)`, `AIMEAT.editor.split(el, {value, onChange})` for editor + live preview (pairs with aimeat-markdown.js)\n';
  prompt += '- aimeat-header.js — drop-in canonical site header (nav + theme)\n';
  prompt += '- aimeat-tunnel.js — personal-node tunnel client (advanced)\n\n';

  prompt += 'Ready-made UI (node-bundled — load from ' + nodeUrl + '/v1/cortex/<name>/libs/<name>.js, use only what you need):\n';
  prompt += '- aimeat-ui-viewers — sortable/filterable DataTable + viewers (`AIMEAT.ui.viewers`)\n';
  prompt += '- aimeat-ui-forms — form builder with validation (`AIMEAT.ui.forms`)\n';
  prompt += '- aimeat-ui-layout — responsive layout helpers, master/detail (`AIMEAT.ui.layout`)\n';
  prompt += '- aimeat-ui-nav — navbars, tabs, menus (`AIMEAT.ui.nav`)\n';
  prompt += '- aimeat-ui-dialogs — modals, toasts, confirms (`AIMEAT.ui.dialogs`)\n';
  prompt += '- aimeat-charts — charts / graphs (`AIMEAT.charts`)\n';
  prompt += '- aimeat-canvas — drawing / freeform canvas (`AIMEAT.canvas`)\n';
  prompt += 'Example: <script src="' + nodeUrl + '/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></' + 'script>\n\n';

  prompt += '### Auth Pattern\n';
  prompt += 'Handle BOTH login paths: a fresh sign-in click (the onLogin callback) AND a page that loads already signed in (restore the session yourself). `onLogin` fires ONLY on a fresh sign-in — it does NOT fire on reload when a session already exists, so a page that relies on onLogin alone shows nothing to an already-logged-in returning user.\n';
  prompt += '```html\n';
  prompt += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  prompt += '<script>\n';
  prompt += 'function showApp(session) { /* session.owner, session.jwt, session.fetch() */ }\n';
  prompt += 'function hideApp() { /* hide content, show a "Sign in" message */ }\n';
  prompt += '\n';
  prompt += '// Path 1 — fresh sign-in / sign-out via the login button:\n';
  prompt += 'AIMEAT.auth.mountLoginButton("#login", {\n';
  prompt += '  onLogin: showApp,   // fires ONLY on a fresh sign-in click, NOT on reload\n';
  prompt += '  onLogout: hideApp\n';
  prompt += '});\n';
  prompt += '\n';
  prompt += '// Path 2 — already signed in when the page loads. Restore the stored session\n';
  prompt += '// explicitly; login() returns the session (or null if not signed in).\n';
  prompt += 'AIMEAT.auth.login().then(function (session) { if (session) showApp(session); });\n';
  prompt += '</' + 'script>\n';
  prompt += '```\n\n';

  prompt += '### Data Storage\n';
  prompt += 'Match the PRIVATE vs SHARED choice from Step 1:\n';
  prompt += '```javascript\n';
  prompt += '// PRIVATE — scoped to the logged-in owner, only they can read it:\n';
  prompt += 'await AIMEAT.data.set("myapp.notes", data, { visibility: "private", tags: ["myapp"] });\n';
  prompt += 'const mine = await AIMEAT.data.get("myapp.notes");\n';
  prompt += '// SHARED/community — public so everyone can read; each user writes their own key:\n';
  prompt += 'await AIMEAT.data.set("myapp.shared.<unique-id>", entry, { visibility: "public" });\n';
  prompt += 'const theirs = await AIMEAT.data.getPublic(ownerGaii, "myapp.shared.<id>");  // read others\n';
  prompt += 'const results = await AIMEAT.data.search("query");\n';
  prompt += '```\n';
  prompt += 'Works only when logged in. After a write, read it back to confirm it persisted.\n\n';

  prompt += '### AI (prompt-driven)\n';
  prompt += 'aimeat-ai runs an LLM on the LOGGED-IN USER\'s own OpenRouter key — free for the app, and the user controls spend. Load aimeat-auth first, then gate every "Use AI" control on isAvailable().\n';
  prompt += '```html\n';
  prompt += '<script src="' + nodeUrl + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  prompt += '<script src="' + nodeUrl + '/v1/libs/aimeat-ai.js"></' + 'script>\n';
  prompt += '```\n';
  prompt += '```javascript\n';
  prompt += 'if (await AIMEAT.ai.isAvailable()) {            // false until login + key configured\n';
  prompt += '  const r = await AIMEAT.ai.complete({ app_id: "my-app", prompt: "Summarise:\\n" + text });\n';
  prompt += '  render(r.content);                            // also: r.model, r.usage, r.budget\n';
  prompt += '} else { showHint("Log in and add an AI key to enable this."); }\n';
  prompt += '// Structured output: const { parsed } = await AIMEAT.ai.completeJson({ app_id, prompt, schema });\n';
  prompt += '```\n';
  prompt += 'Always handle isAvailable()===false and catch errors; never hardcode an API key in the app.\n\n';

  prompt += '### Real-time / multiplayer (optional)\n';
  prompt += 'For shared live state (presence boards, 1v1 games) use realtime rooms via your authenticated session.fetch:\n';
  prompt += '```javascript\n';
  prompt += '// 1) create or join a room\n';
  prompt += 'const room = (await session.fetch("/v1/realtime/rooms", { method: "POST",\n';
  prompt += '  body: JSON.stringify({ name: "my-room" }) })).data;   // → { id, ws_url }\n';
  prompt += '// 2) open a WebSocket for live presence + messages\n';
  prompt += 'const ws = new WebSocket(location.origin.replace(/^http/, "ws") + room.ws_url);\n';
  prompt += 'ws.onmessage = (e) => handle(JSON.parse(e.data));\n';
  prompt += '// 3) for low-latency P2P, GET /v1/realtime/ice-servers and use WebRTC\n';
  prompt += '```\n';
  prompt += 'Simpler apps can skip rooms and just observe shared AIMEAT.data keys on a timer.\n\n';

  prompt += '### Design Guidelines\n';
  prompt += 'Use CSS variables so the app themes cleanly, and RESPECT the user\'s AIMEAT theme: the light/dark choice they made in the AIMEAT pill is saved in localStorage "aimeat-theme" ("light"|"dark"). Define light as the default and dark under [data-theme="dark"], then set that attribute from the saved choice on load (fall back to the OS preference, and live-update if it changes):\n';
  prompt += '```css\n';
  prompt += ':root { --bg:#fafaf8; --card:#fff; --text:#1a1a2e; --accent:#e8564a; --border:#e5e7eb; --radius:12px; }\n';
  prompt += ':root[data-theme="dark"] { --bg:#14141c; --card:#1e1e2a; --text:#ececf4; --border:#2e2e40; }\n';
  prompt += '```\n';
  prompt += '```js\n';
  prompt += '(function(){ function apply(t){ document.documentElement.setAttribute("data-theme", t==="dark"?"dark":"light"); }\n';
  prompt += '  apply(localStorage.getItem("aimeat-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));\n';
  prompt += '  addEventListener("storage", function(e){ if(e.key==="aimeat-theme" && e.newValue) apply(e.newValue); }); })();\n';
  prompt += '```\n';
  prompt += 'Always include <meta name="viewport" content="width=device-width, initial-scale=1.0">. Mobile-first, single self-contained HTML file with embedded CSS + JS.\n\n';

  prompt += '### Important Rules\n';
  prompt += '- Return the COMPLETE HTML file, not fragments\n';
  prompt += '- Never use literal closing script tags in JS comments or strings\n';
  prompt += '- Keep it as a single self-contained HTML file\n';
  prompt += '- Load only the libraries you actually use; load aimeat-auth before libs that need a session\n';
  prompt += '- Gate AI features on AIMEAT.ai.isAvailable() and handle the logged-out / no-key case\n';
  prompt += '- Theme with CSS variables; respect the user\'s AIMEAT light/dark choice (localStorage "aimeat-theme") with an OS-preference fallback\n';
  prompt += '- Include error handling and loading states for API calls\n\n';

  if (!isImprove) {
    prompt += '## When the app is ready — tell me how to publish it\n';
    prompt += 'After you hand me the finished single HTML file, END your reply by telling me (in my language) to do exactly this:\n';
    prompt += '1. Open ' + nodeUrl + '/app-catalog.html\n';
    prompt += '2. Click "+ Add" → open the "Paste" tab → paste the HTML (or drop it as a file). The app name + description fill in automatically.\n';
    prompt += '3. Click Publish.\n';
    prompt += 'I will be asked to sign in first — it is fast: one click with Google, or a quick email + password, and a brand-new account is created right there in seconds.\n';
    prompt += 'What I get: once published, the app is LIVE on my own AIMEAT node and PUBLIC — anyone can find it in the community catalogue and use it, and I get a link to share. From my catalogue I can launch it, publish updates (older versions are always kept), park it (hide it from the public), or delete it. It keeps working with my AIMEAT login, saved data, files, AI and realtime features.\n\n';
  }
  return prompt;
}

/**
 * The whole prompt.
 * @param {{ track: 'classic'|'atelier', app?: { name?: string, html?: string }|null, description: string,
 *   lang: string, core: { new: string|null, improve: string|null },
 *   coreAtelier: { new: string|null, improve: string|null }, template?: { content?: string }|null,
 *   packs: Array<{ id: string, title?: string, include?: string[], ai_doc?: string }>,
 *   atelierLoading: string, nodeUrl?: string }} o
 */
export function buildPrompt(o) {
  const nodeUrl = o.nodeUrl || location.origin;
  const isImprove = !!o.app;
  const description = String(o.description || '').trim();
  const source = isImprove && typeof o.app.html === 'string' ? o.app.html : null;

  // Atelier: the node's guide is the whole prompt (it carries its own interview); the two never mix.
  if (o.track === 'atelier') {
    const aCore = o.coreAtelier[isImprove ? 'improve' : 'new'];
    if (!aCore) return o.atelierLoading;
    let out = description ? "The app idea, in the owner's words: " + description + '\n\n' + aCore : aCore;
    if (source !== null) out += '\n## The app to improve\n--- Source Code ---\n' + source;
    return out;
  }

  const pbLang = PB_LANGS[o.lang] || 'English';
  let prompt = 'Language: talk to me and write ALL user-facing text (UI labels, buttons, messages) in ' + pbLang + '. These build instructions are in English, but converse with me and build the app interface in ' + pbLang + '.\n\n';

  if (isImprove) {
    prompt += 'Here is an HTML app called "' + (o.app.name || 'Untitled') + '".\n';
    prompt += 'I want to change it: ' + (description || '(I will describe the change — ask me if it is not clear)') + '\n\n';
    prompt += 'If anything about the change is ambiguous, ask me first. Then return the COMPLETE updated HTML file — do not omit any parts.\n\n';
  } else {
    prompt += 'Help me build a single-file HTML app that runs on AIMEAT.\n';
    prompt += 'My initial idea: ' + (description || '(not given yet — ask me what to build)') + '\n\n';
    prompt += '## Step 1 — Interview me first\n';
    prompt += 'If I have not described my idea above, your FIRST reply must ask me what I want to build. Then ask me these in ONE message and wait for my answers:\n';
    prompt += '1. What kind of app? (message board · multiplayer game · notes/journal · habit or expense tracker · family tools like shared lists/calendar · drawing/creative · music jam · real-time collaboration · offer or need help/services · something else)\n';
    prompt += '2. What should it be called?\n';
    prompt += '3. How should it look and feel? (e.g. dark neon · cozy · sleek minimal · fun colorful) — it must support BOTH light and dark.\n';
    prompt += '4. Data: SHARED (a community space others can see and add to) or PRIVATE (only mine)?\n';
    prompt += '5. Should it use AI features (summaries, suggestions, generation)? If yes I can enable them via aimeat-ai.\n';
    prompt += '6. Does it need any special capabilities? (charts/graphs · editable flow or mindmap diagrams · static text-defined diagrams · a game or heavy 2D animation · generative art / creative canvas · 3D · live multi-user/realtime) — each maps to a capability pack in Step 2; include only what I pick.\n';
    prompt += 'Skip any question I already answered in my idea above. Use my answers to customise everything in Step 2.\n\n';
  }

  const core = o.core[isImprove ? 'improve' : 'new'];
  prompt += core || classicFallback(nodeUrl, isImprove);

  if (source !== null) prompt += '--- Source Code ---\n' + source;

  if (o.template && o.template.content) {
    prompt += '\n## Starting template (copy from this)\nUse this skeleton as your base — keep its boot, login pill, and self-hosted theme wiring intact; fill the {{...}} slots; build your views inside <main>. Return the COMPLETE single HTML file based on it.\n```html\n' + o.template.content + '\n```\n';
  }

  const packs = (o.packs || []).filter(Boolean);
  if (packs.length > 0) {
    prompt += '\n## Selected capability packs (self-hosted on my node — use these, never a CDN)\n';
    for (const pack of packs) {
      prompt += '\n### Pack: ' + pack.id + ' — ' + (pack.title || '') + '\n';
      prompt += 'Include (in order):\n' + (pack.include || []).join('\n') + '\n';
      if (pack.ai_doc) prompt += 'Usage:\n' + pack.ai_doc + '\n';
    }
  }
  return prompt;
}
