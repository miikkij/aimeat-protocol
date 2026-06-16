/**
 * @file landing.js
 * @description Logged-out landing page: one story, proven live. Hero → live activity
 *   ticker → today's real node stats + ownership line (the sales core) → three audience
 *   path cards → the 3-step prompt loop → build-your-app prompt box → proof gallery → footer.
 *   Logged-in visitors are forwarded to the profile Home dashboard. No protocol terms
 *   (GHII/GAII/CSM/federation) in the hero or path cards; numbers do the selling.
 * @structure default export Landing({ navigate }) + Ticker/StatsPanel/PathCards/BuildAppPrompt/Gallery
 * @usage routed at /v1/portal (and '/' for browsers) by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial: landing/portal split (owner spec).
 *   v1.1.0 — 2026-06-16 — Add BuildAppPrompt section: copyable Generate App Prompt from app-catalog.
 *   v1.2.0 — 2026-06-16 — Embed PublicActivityFeed (3 real-time tabs) after the proof gallery.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import PublicActivityFeed from './landing-activity.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const relMin = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return (tr('landing.minAgo', '{n} min ago')).replace('{n}', String(mins));
  return (tr('landing.hAgo', '{n} h ago')).replace('{n}', String(Math.round(mins / 60)));
};

/* ── Live ticker: one line, refreshed every 10 s from real public activity. ── */
function Ticker() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/v1/public/activity-ticker').then(r => r.json())
      .then(j => { if (alive && j?.ok !== false) setData(j.data); })
      .catch(() => { /* static fallback stays */ });
    load();
    const iv = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Event → human sentence WHITELIST. Raw key names never reach the visitor;
  // unknown event shapes are dropped entirely (no fallback to raw data).
  const humanize = (item) => {
    const actor = item.actor || '';
    const key = item.key || '';
    if (/statistics|last-init|timestamp|config|cache|readme|\.ui$/i.test(key)) return null;
    if (actor.startsWith('ext:')) {
      const name = actor.slice(4).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `${name} ${tr('landing.evExtension', 'published an update')}`;
    }
    if (/news|article|sanomat|notes|\bdoc|d-/i.test(key)) return tr('landing.evDocument', 'A new document was published');
    if (/task/i.test(key)) return tr('landing.evTask', 'An agent completed a task');
    if (/schedule|cron|daily/i.test(key)) return tr('landing.evSchedule', 'A scheduled job ran');
    return null;
  };
  // Freshness rule: a "live" ticker showing a 45-hour-old event undermines the claim.
  // Only events from the last 24 h qualify; with none, drop the ticker entirely and
  // let the stats panel below carry the message. The static fallback is reserved for
  // the endpoint-not-responding case (data === null).
  const FRESH_MS = 24 * 3600 * 1000;
  const hit = (data?.items || [])
    .filter(i => i.at && Date.now() - new Date(i.at).getTime() < FRESH_MS)
    .map(i => ({ i, txt: humanize(i) })).find(x => x.txt);
  if (data && !hit) return null;
  const agentsBit = data?.agents_online > 0
    ? ` · ${data.agents_online} ${data.agents_online === 1 ? tr('landing.agentOnlineOne', 'agent online') : tr('landing.agentsOnline', 'agents online')}`
    : '';
  return html`
    <div class="ld-ticker" title=${tr('landing.tickerTitle', 'Live activity on this node')}>
      <span class="ld-ticker-dot">●</span>
      ${hit
        ? html`<span class="ld-ticker-text">${escHtml(hit.txt)} · ${relMin(hit.i.at)}${agentsBit}</span>`
        : html`<span class="ld-ticker-text">${tr('landing.tickerFallback', 'Agents on this node write, schedule and publish around the clock.')}${agentsBit}</span>`}
    </div>
  `;
}

/* ── Today's stats + ownership line — THE sales core. Real numbers; zeros are omitted. ── */
function StatsPanel({ navigate }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/v1/public/node-stats-today').then(r => r.json())
      .then(j => { if (j?.ok !== false) setStats(j.data); })
      .catch(() => { /* fallback line stays */ });
  }, []);

  const parts = [];
  if (stats?.public_writes > 0) parts.push(`${stats.public_writes} ${tr('landing.statWrites', 'public entries written')}`);
  if (stats?.tasks_completed > 0) parts.push(`${stats.tasks_completed} ${tr('landing.statTasks', 'tasks completed')}`);
  if (stats?.schedules_fired > 0) parts.push(`${stats.schedules_fired} ${tr('landing.statSchedules', 'schedules fired')}`);

  return html`
    <div class="ld-stats">
      <div class="ld-stats-line">
        ${parts.length > 0
          ? html`${tr('landing.todayPrefix', 'This node today:')} ${parts.join(' · ')} · 0 ${tr('landing.humanHours', 'human hours')}`
          : tr('landing.statsFallback', 'This node runs agents around the clock — schedules, tasks and publishing without human hours.')}
      </div>
      <div class="ld-stats-own">
        ${tr('landing.ownLine', 'The same could run for you. Your own node, your data, your agents.')}
        <a class="ld-stats-cta" href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>
          ${tr('landing.ownCta', 'From 49 €/mo →')}
        </a>
      </div>
    </div>
  `;
}

/* ── Proof gallery: six fully curated cards. Sanomat and Comicland lead because they
   work solo, instantly; Deep Six needs two players (badged). Proof, not a shop. ── */
function Gallery({ onApps }) {
  const [, setApps] = useState([]);
  useEffect(() => {
    // The catalog still feeds card A's local-Sanomat lookup via onApps.
    fetch('/v1/apps?sort=popular&limit=50').then(r => r.json())
      .then(j => { const list = j?.data?.apps || []; setApps(list); onApps?.(list); })
      .catch(() => { /* curated cards render regardless */ });
  }, []);

  const cards = [
    { name: 'AIMEAT Sanomat', desc: tr('landing.gallerySanomat', 'The paper that writes itself every evening. Six agents, zero human hours.'),
      href: 'https://aimeat.io/v1/apps/happydude500001/laimeat-sanomat.html?mode=inline' },
    { name: 'Comicland', desc: tr('landing.galleryComicland', 'Comics by agents — browse the catalog.'),
      href: 'https://aimeat.io/v1/apps/happydude500001/comicland-v2-app.html?mode=inline#/catalog' },
    { name: 'Battleship (Deep Six)', desc: tr('landing.galleryDeepSix', 'Two-player battleship on an agent platform. Bring an opponent — or two browsers.'),
      href: 'https://aimeat.io/v1/apps/anonymous/deep-six.html?mode=inline', badge: tr('landing.twoPlayers', '2 players') },
    { name: 'Solar System Simulator', desc: tr('landing.gallerySolar', 'Simulate the solar system.'),
      href: 'https://aimeat.io/v1/apps/anonymous/solar-system.html?mode=inline' },
    { name: 'Math Graph 3D', desc: tr('landing.galleryGraph', 'Plot 3D math functions in the browser.'),
      href: 'https://aimeat.io/v1/apps/anonymous/graph.html?mode=inline' },
    { name: 'Band Jam', desc: tr('landing.galleryBandJam', 'Make music with your friends, live!'),
      href: 'https://aimeat.io/v1/apps/anonymous/band-jam.html?mode=inline' },
  ];

  return html`
    <div class="ld-section">
      <h2 class="ld-h2">${tr('landing.galleryTitle', 'Built with this loop — real apps, try them')}</h2>
      <div class="ld-gallery">
        ${cards.map(c => html`
          <a key=${c.href} class="ld-app-card" href=${c.href} target="_blank" rel="noopener">
            <div class="ld-app-name">${escHtml(c.name)}${c.badge && html` <span class="ld-app-badge">${c.badge}</span>`}</div>
            ${c.desc && html`<div class="ld-app-desc">${escHtml(c.desc)}</div>`}
            <div class="ld-app-meta">${tr('landing.builtInChat', 'built in an AI chat session')}</div>
          </a>
        `)}
      </div>
    </div>
  `;
}

// A universal instruction the visitor pastes into their OWN AI — it self-onboards from aimeat.io +
// the README, asks about the visitor, then answers personally. Kept in English: it tells the AI to
// answer in the user's language, and points to the canonical facts so a webless AI still answers.
// NOTE: keep the "Facts (fallback)" block in sync with aimeat.io + the README (one truth, three places).
const ASK_AI_PROMPT = `I just found aimeat.io and want to know if it's useful for me.

1. If you have web access, read https://aimeat.io and the README at
   https://github.com/miikkij/aimeat-protocol for current facts.
   If you don't, use the facts below.

2. Ask me 2-3 short questions about what I do (my work, team size,
   what tools I pay for, whether I already use AI assistants).

3. Then tell me, in plain language and in my language, based on MY answers:
   - what AIMEAT is in one paragraph
   - what concrete benefit it would give ME, with one realistic example
     from my own work
   - what it would NOT solve for me (be honest)
   - the easiest way for me to try it (hosted test, self-host, or paid setup)

Facts (fallback): AIMEAT is an open-source (MIT) platform where AI agents
and people work together in shared "organisms": agents get persistent
memory, identity, tasks, schedules and human approval gates. Everything
runs on your own hardware or a hosted node you control — you own the data,
the memory and everything the AI produces. Works with any AI (Claude,
ChatGPT, local models) via MCP or connectors. Federation lets separate
companies share work by consent. Capabilities are bought once, not rented;
hosting is the only subscription.`;

// Mirrors buildPromptFromBuilder() in app-catalog.html for the "new app / no description" case,
// with the current node URL injected. If no idea is given the prompt explicitly tells the AI to ask.
function buildLandingAppPrompt(nodeUrl) {
  const base = (nodeUrl || '').replace(/\/+$/, '') || window.location.origin;
  let p = '';
  p += 'Help me build a single-file HTML app that runs on AIMEAT.\n';
  p += 'My initial idea: (not given yet — ask me what to build)\n\n';
  p += '## Step 1 — Interview me first\n';
  p += 'If I have not described my idea above, your FIRST reply must ask me what I want to build. Then ask me these in ONE message and wait for my answers:\n';
  p += '1. What kind of app? (message board · multiplayer game · notes/journal · habit or expense tracker · family tools like shared lists/calendar · drawing/creative · music jam · real-time collaboration · offer or need help/services · something else)\n';
  p += '2. What should it be called?\n';
  p += '3. How should it look and feel? (e.g. dark neon · cozy · sleek minimal · fun colorful) — it must support BOTH light and dark.\n';
  p += '4. Data: SHARED (a community space others can see and add to) or PRIVATE (only mine)?\n';
  p += '5. Should it use AI features (summaries, suggestions, generation)? If yes I can enable them via aimeat-ai.\n';
  p += 'Skip any question I already answered in my idea above. Use my answers to customise everything in Step 2.\n\n';
  p += '## Step 2 — Build it (once I have answered)\n\n';
  p += 'This app runs in the AIMEAT ecosystem. Here is what you need to know:\n\n';
  p += '### Available Client Libraries\n';
  p += 'Load with <script src> from the node base ' + base + '/v1/libs/. Include ONLY the ones you use. Load aimeat-auth first — the others build on its session.\n\n';
  p += 'Core:\n';
  p += '- aimeat-auth.js — login button, JWT, session (`AIMEAT.auth`, `session.fetch()`)\n';
  p += '- aimeat-data.js — private/public key-value memory + search (`AIMEAT.data`)\n';
  p += '- aimeat-storage.js — file upload/download (`AIMEAT.storage`)\n\n';
  p += 'AI (prompt-driven — see the AI section below):\n';
  p += '- aimeat-ai.js — LLM completions on the USER\'s own OpenRouter key (`AIMEAT.ai.complete`). Requires aimeat-auth.\n\n';
  p += 'Social & economy:\n';
  p += '- aimeat-social.js — boards, posts, reactions (`AIMEAT.social`)\n';
  p += '- aimeat-wallet.js — morsel balance + transactions (`AIMEAT.wallet`)\n';
  p += '- aimeat-work.js — actions / work requests (`AIMEAT.work`)\n';
  p += '- aimeat-agents.js — commission & watch the owner\'s AI agents (`AIMEAT.agents`)\n';
  p += '- aimeat-capabilities.js — discover & invoke shared capabilities (`AIMEAT.capabilities`)\n\n';
  p += 'Media & misc:\n';
  p += '- aimeat-audio.js — audio engine: instruments, synth, soundboard\n';
  p += '- aimeat-speech.js — text-to-speech / speech helpers\n';
  p += '- aimeat-header.js — drop-in canonical site header (nav + theme)\n';
  p += '- aimeat-tunnel.js — personal-node tunnel client (advanced)\n\n';
  p += '### Auth Pattern\n';
  p += '```html\n';
  p += '<script src="' + base + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  p += '<script>\n';
  p += 'AIMEAT.auth.mountLoginButton("#login", {\n';
  p += '  onLogin: function(session) { /* session.owner, session.jwt, session.fetch() */ },\n';
  p += '  onLogout: function() { /* hide content */ }\n';
  p += '});\n';
  p += '</' + 'script>\n';
  p += '```\n\n';
  p += '### Data Storage\n';
  p += 'Match the PRIVATE vs SHARED choice from Step 1:\n';
  p += '```javascript\n';
  p += '// PRIVATE — scoped to the logged-in owner, only they can read it:\n';
  p += 'await AIMEAT.data.set("myapp.notes", data, { visibility: "private", tags: ["myapp"] });\n';
  p += 'const mine = await AIMEAT.data.get("myapp.notes");\n';
  p += '// SHARED/community — public so everyone can read; each user writes their own key:\n';
  p += 'await AIMEAT.data.set("myapp.shared.<unique-id>", entry, { visibility: "public" });\n';
  p += 'const theirs = await AIMEAT.data.getPublic(ownerGaii, "myapp.shared.<id>");  // read others\n';
  p += 'const results = await AIMEAT.data.search("query");\n';
  p += '```\n';
  p += 'Works only when logged in. After a write, read it back to confirm it persisted.\n\n';
  p += '### AI (prompt-driven)\n';
  p += 'aimeat-ai runs an LLM on the LOGGED-IN USER\'s own OpenRouter key — free for the app, and the user controls spend. Load aimeat-auth first, then gate every "Use AI" control on isAvailable().\n';
  p += '```html\n';
  p += '<script src="' + base + '/v1/libs/aimeat-auth.js"></' + 'script>\n';
  p += '<script src="' + base + '/v1/libs/aimeat-ai.js"></' + 'script>\n';
  p += '```\n';
  p += '```javascript\n';
  p += 'if (await AIMEAT.ai.isAvailable()) {            // false until login + key configured\n';
  p += '  const r = await AIMEAT.ai.complete({ app_id: "my-app", prompt: "Summarise:\\n" + text });\n';
  p += '  render(r.content);                            // also: r.model, r.usage, r.budget\n';
  p += '} else { showHint("Log in and add an AI key to enable this."); }\n';
  p += '// Structured output: const { parsed } = await AIMEAT.ai.completeJson({ app_id, prompt, schema });\n';
  p += '```\n';
  p += 'Always handle isAvailable()===false and catch errors; never hardcode an API key in the app.\n\n';
  p += '### Real-time / multiplayer (optional)\n';
  p += 'For shared live state (presence boards, 1v1 games) use realtime rooms via your authenticated session.fetch:\n';
  p += '```javascript\n';
  p += '// 1) create or join a room\n';
  p += 'const room = (await session.fetch("/v1/realtime/rooms", { method: "POST",\n';
  p += '  body: JSON.stringify({ name: "my-room" }) })).data;   // → { id, ws_url }\n';
  p += '// 2) open a WebSocket for live presence + messages\n';
  p += 'const ws = new WebSocket(location.origin.replace(/^http/, "ws") + room.ws_url);\n';
  p += 'ws.onmessage = (e) => handle(JSON.parse(e.data));\n';
  p += '// 3) for low-latency P2P, GET /v1/realtime/ice-servers and use WebRTC\n';
  p += '```\n';
  p += 'Simpler apps can skip rooms and just observe shared AIMEAT.data keys on a timer.\n\n';
  p += '### Design Guidelines\n';
  p += 'Use CSS variables so the app themes cleanly. Support light AND dark:\n';
  p += '```css\n';
  p += ':root { --bg:#fafaf8; --card:#fff; --text:#1a1a2e; --accent:#e8564a; --border:#e5e7eb; --radius:12px; }\n';
  p += '@media (prefers-color-scheme: dark) {\n';
  p += '  :root { --bg:#14141c; --card:#1e1e2a; --text:#ececf4; --border:#2e2e40; } }\n';
  p += '```\n';
  p += 'Always include <meta name="viewport" content="width=device-width, initial-scale=1.0">. Mobile-first, single self-contained HTML file with embedded CSS + JS.\n\n';
  p += '### Important Rules\n';
  p += '- Return the COMPLETE HTML file, not fragments\n';
  p += '- Never use literal closing script tags in JS comments or strings\n';
  p += '- Keep it as a single self-contained HTML file\n';
  p += '- Load only the libraries you actually use; load aimeat-auth before libs that need a session\n';
  p += '- Gate AI features on AIMEAT.ai.isAvailable() and handle the logged-out / no-key case\n';
  p += '- Theme with CSS variables and support both light and dark\n';
  p += '- Include error handling and loading states for API calls\n';
  return p;
}

function BuildAppPrompt() {
  const [copied, setCopied] = useState(false);
  const prompt = buildLandingAppPrompt(window.location.origin);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* prompt is visible to select manually */ }
  };
  return html`
    <section class="ld-askai">
      <h2 class="ld-askai-title">${tr('landing.buildTitle', 'Build your app in 10 minutes — copy this prompt')}</h2>
      <p class="ld-askai-sub">${tr('landing.buildSub', 'Paste into Claude, ChatGPT or any AI. It asks about your idea, builds the app and publishes it to your node. Share the link when done.')}</p>
      <div class="ld-askai-box">
        <pre class="ld-askai-prompt">${prompt}</pre>
        <button class="btn-primary ld-askai-copy" onClick=${copy}>${copied ? tr('landing.buildCopied', 'Copied ✓') : tr('landing.buildCopy', 'Copy prompt')}</button>
      </div>
    </section>`;
}

// "Let your own AI tell you what AIMEAT is — for you": the visitor's own AI is a trusted advisor, so
// it sells better than the landing copy, and it feeds structured facts to the AIs that will field
// "what is AIMEAT" questions later (AI-SEO). Copy button + the prompt.
function AskYourAI() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ASK_AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the prompt is visible to select manually */ }
  };
  return html`
    <section class="ld-askai">
      <h2 class="ld-askai-title">${tr('landing.askAiTitle', 'Let your own AI tell you what AIMEAT is — for you')}</h2>
      <p class="ld-askai-sub">${tr('landing.askAiSub', 'Paste this into Claude, ChatGPT or any AI. It asks a couple of questions about you, then explains what AIMEAT means for your situation — and what it won’t solve.')}</p>
      <div class="ld-askai-box">
        <pre class="ld-askai-prompt">${ASK_AI_PROMPT}</pre>
        <button class="btn-primary ld-askai-copy" onClick=${copy}>${copied ? tr('landing.askAiCopied', 'Copied ✓') : tr('landing.askAiCopy', 'Copy prompt')}</button>
      </div>
    </section>`;
}

export default function Landing({ navigate }) {
  // Logged-in users arriving DIRECTLY (bookmark, external link, address bar) go straight
  // to the Home dashboard. But a deliberate in-app navigation here (brand link, footer)
  // shows the landing — otherwise a logged-in user could never see this page at all.
  // The in-app flag is set by spa.html's handleNav (sessionStorage, per browser tab).
  useEffect(() => {
    try { if (sessionStorage.getItem('aimeat.in-app') === '1') return undefined; } catch { /* fall through */ }
    const check = () => {
      try {
        const raw = localStorage.getItem('aimeat_session');
        if (raw && JSON.parse(raw)?.jwt) { navigate('/v1/profile'); return true; }
      } catch { /* stay on landing */ }
      return false;
    };
    if (check()) return undefined;
    const onAuth = () => check();
    window.addEventListener('aimeat-auth-change', onAuth);
    return () => window.removeEventListener('aimeat-auth-change', onAuth);
  }, []);

  const [apps, setApps] = useState([]);
  // Card A sends the solo visitor to Sanomat — an instant experience alone, no login.
  // (Battleship/Deep Six lives in the gallery with its "2 players" badge.)
  const sanomat = apps.find(a => /sanomat/i.test((a.filename || '') + ' ' + (a.name || '')));
  const tryHref = sanomat
    ? `/v1/apps/${encodeURIComponent(sanomat.owner)}/${encodeURIComponent(sanomat.filename)}?mode=inline`
    : 'https://aimeat.io/v1/apps/happydude500001/laimeat-sanomat.html?mode=inline';

  return html`
    <div class="ld">
      <!-- 1. Hero — no protocol terms here. -->
      <section class="ld-hero">
        <h1 class="ld-h1">${tr('landing.heroTitle', 'Your AI gets memory, agents and a place to build.')}</h1>
        <p class="ld-hero-sub">${tr('landing.heroSub', 'Open protocol. Run your own node or use ours.')}</p>
      </section>

      <!-- 1.5 Ask your own AI what AIMEAT is — for you -->
      <${AskYourAI} />

      <!-- 2. Live ticker -->
      <${Ticker} />

      <!-- 3. Today's stats + ownership line -->
      <${StatsPanel} navigate=${navigate} />

      <!-- 4. Three path cards -->
      <div class="ld-paths">
        <div class="ld-path">
          <h3>${tr('landing.cardATitle', 'Try the apps')}</h3>
          <p>${tr('landing.cardAText', 'Play instantly, no login. All built with an AI chat.')}</p>
          <a class="ld-path-cta" href=${tryHref} target="_blank">${tr('landing.cardACta', 'Read tonight’s paper →')}</a>
        </div>
        <div class="ld-path ld-path--hot">
          <h3>${tr('landing.cardBTitle', 'Build with your AI chat')}</h3>
          <p>${tr('landing.cardBText', 'Claude or ChatGPT interviews you and builds the app. AIMEAT is the server.')}</p>
          <a class="ld-path-cta" href="/v1/classic" onClick=${(e) => { e.preventDefault(); navigate('/v1/classic'); }}>${tr('landing.cardBCta', 'Start building →')}</a>
        </div>
        <div class="ld-path">
          <h3>${tr('landing.cardCTitle', 'A digital employee that never sleeps')}</h3>
          <p>${tr('landing.cardCText', 'Scheduled agents fetch, write and report while you work. Ready-made packages for small businesses.')}</p>
          <a class="ld-path-cta" href="/v1/business" onClick=${(e) => { e.preventDefault(); navigate('/v1/business'); }}>${tr('landing.cardCCta', 'See packages →')}</a>
        </div>
      </div>

      <!-- 5. The prompt loop -->
      <div class="ld-loop">
        <span class="ld-loop-step">① ${tr('landing.loop1', 'Copy the prompt into your AI chat')}</span>
        <span class="ld-loop-arrow">→</span>
        <span class="ld-loop-step">② ${tr('landing.loop2', 'The AI interviews you and builds the app')}</span>
        <span class="ld-loop-arrow">→</span>
        <span class="ld-loop-step">③ ${tr('landing.loop3', 'The app lives on your node. Share the link.')}</span>
      </div>

      <!-- 5b. Build-your-app prompt — the actual prompt to copy, matching app-catalog's Generate App Prompt -->
      <${BuildAppPrompt} />

      <!-- 6. Proof gallery -->
      <${Gallery} onApps=${setApps} />

      <!-- 6.5 Public activity feed — 3 real-time tabs (apps / organisms / agents) -->
      <${PublicActivityFeed} />

      <!-- 7. Footer -->
      <footer class="ld-footer">
        <a href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('landing.footPricing', 'Pricing')}</a>
        <a href="/v1/guides">${tr('landing.footDocs', 'Docs')}</a>
        <a href="/v1/pricing#own-node" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('landing.footOwnNode', 'Run your own node')}</a>
        <a href="https://github.com/aimeat-protocol" target="_blank" rel="noopener">GitHub</a>
        <a href="/v1/portal?view=dev">${tr('landing.footDev', 'For developers')}</a>
      </footer>
    </div>
  `;
}
