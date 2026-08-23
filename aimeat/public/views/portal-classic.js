/**
 * @file public/views/portal-classic.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Classic card-based landing portal (Preact + HTM): a live Welcome Board plus three
 *   expandable groups (For Me/apps, My AI Agents, For Builders) that each surface a copy-pasteable
 *   mega-prompt for building apps, agent workflows, or connecting an agent runtime.
 *
 * @structure
 *   - buildAppBuilderPrompt / buildAgentBuilderPrompt / buildConnectPrompt: compose the copy-paste prompts
 *   - WelcomeBoard: reads/posts the shared welcome board via /v1/memory + /v1/portal/try-memory
 *   - CardGroup / CopyPromptBtn: expandable card + copy-button wrapper primitives
 *   - PortalClassicView (default): assembles hero, board, card groups, and morsels footer
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-31 — ManagedEnvNote above each of the three copy buttons (app-builder full,
 *     agent and connect compact): what a company-managed AI tool's untrusted-source notice means
 *     and the three routes round it. The prompt builders themselves are unchanged.
 *   v1.2.0 — 2026-08-08 — Renamed the local buildAgentPrompt → buildAgentBuilderPrompt: the name
 *     collided with the exported buildAgentPrompt in agents/connect-prompts.js, which builds a
 *     different text (the device-auth CONNECT prompt). The new name matches its two siblings
 *     (buildAppBuilderPrompt / buildConnectPrompt). Prompt text unchanged. Copy control unified:
 *     CopyPromptBtn now passes btn-primary instead of the bespoke .cl-copy-prompt-btn, and the
 *     "copied" tick comes from the shared t('common.copied') rather than a literal ✔.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { CopyButton } from '/components/CopyButton.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { t as globalT } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   i18n — use SPA i18n.js t() with 'classic.' prefix
   ══════════════════════════════════════════════ */
function ct(key) {
  return globalT('classic.' + key);
}

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  return Math.floor(hr / 24) + 'd';
}

/* ══════════════════════════════════════════════
   MEGA-PROMPT BUILDERS
   ══════════════════════════════════════════════ */
function buildAppBuilderPrompt() {
  const n = NODE_URL;
  const anonGaii = encodeURIComponent('shared#anonymous@' + (window.location.hostname || 'aimeat-local'));
  return `You are helping me build an app that uses AIMEAT, an open protocol for AI-managed memory and data storage.

The AIMEAT server is at: ${n}

## Step 1 \u2014 Ask me these questions:
1. What kind of app do you want?
   \ud83d\udcac Message board   \ud83c\udfae Multiplayer game   \ud83d\udcdd Notes/journal
   \ud83d\udcca Habit/expense tracker   \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66 Family tools (shared lists, calendar)
   \ud83c\udfa8 Drawing/creative   \ud83c\udfb5 Music jam session   \ud83d\udce1 Real-time collaboration
   \ud83d\udc64 Need or offer help (services)   \ud83d\udca1 Something else (describe your idea)
2. What should it be called?
3. How should it look and feel? (e.g. "dark neon", "cozy wood", "sleek minimal", "fun colorful")
4. Data: SHARED (community \u2014 others see it too) or PRIVATE (my own space)?
   - OWN: create a unique key like "apps.[type].[my-unique-id]" \u2014 only I see my data
   - SHARED: use the community key given below \u2014 I see others' content and can add mine
Use my answers to customize everything.

## Step 2 \u2014 Build a single HTML file using these APIs:

### Step 0: Get an anonymous token (do this first!)
POST ${n}/v1/auth/anonymous \u2192 response.data.token
Use this token as "Authorization: Bearer <token>" in ALL requests below.
The token lasts 24 hours. Get a new one if expired (401 response).

### Memory API (key-value JSON storage, small data)
Server: ${n}
Save data: POST ${n}/v1/memory
Headers: Authorization: Bearer <token>, Content-Type: application/json
Body: {"key": "apps.[TYPE].[ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}
Read own data: GET ${n}/v1/memory/apps.[TYPE].[ID] (with token)
Read anyone's public data: GET ${n}/v1/memory/{gaii}/{key} (no token needed)
List own keys: GET ${n}/v1/memory?prefix=apps.[TYPE] (with token)
Response: { ok: true, data: { key: "...", value: {...your data...}, owner_gaii: "...", ... } }
Your GAII (identity) comes from the token response: response.data.gaii
IMPORTANT: When updating, always GET first, modify, then POST back (read-modify-write).

### Storage API (files & images \u2014 larger data)
Upload image: POST ${n}/v1/storage
Content-Type: application/json
Body: {"key": "apps/art/[unique-id].png", "data": "<base64-encoded-image>", "mime_type": "image/png", "visibility": "public"}
Response: { ok: true, data: { key: "apps/art/[unique-id].png", size: 12345, ... } }
Public image URL (for <img> tags): ${n}/v1/pub/${anonGaii}/apps/art/[unique-id].png

### Realtime P2P API (WebSocket \u2014 for live multiplayer, no polling needed)
Client library: <script src="${n}/lib/realtime.js"></script>

Quick start:
  const rt = new AimeatRealtime("${n}", token);
  // token comes from: POST ${n}/v1/auth/anonymous \u2192 response.data.token
  const room = await rt.createRoom({ app_type: "[TYPE]", name: "My Room" });
  rt.connect(room.id, playerName);
  rt.on("joined", (msg) => console.log("My peer ID:", msg.peerId));
  rt.on("broadcast", (msg) => console.log("From", msg.from, ":", msg.payload));
  rt.broadcast({ action: "move", x: 10, y: 20 });

### Board API (public message boards)
Read posts: GET ${n}/v1/boards/welcome/posts \u2192 data.posts [{id, title, body, author_gaii, created_at}] (no token needed)
Post message: POST ${n}/v1/boards/welcome/posts (with token)
Headers: Authorization: Bearer <token>, Content-Type: application/json
Body: {"title": "Hello!", "body": "My first post"}
Boards auto-create on first post. Use any board ID: "welcome", "apps.chat", "apps.games", etc.

## General Requirements:
- Single HTML file, all CSS and JS inline, no external dependencies
- Mobile-friendly, works on any screen size
- Clean, modern UI
- Works immediately when opened in a browser
- Make the HTML a downloadable file. This is a live API \u2014 the URLs work right now.

## If Something Doesn't Work
After giving the user the HTML file, always add:
"If the app doesn't work, press F12 \u2192 Console tab, copy any red errors and paste them here. I'll fix it."`;
}

function buildAgentBuilderPrompt() {
  const n = NODE_URL;
  return `I'd like to build an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination and task management.

The AIMEAT server is at: ${n}

## Step 1 \u2014 Ask me:
1. What should the agent do?
   \ud83d\udcf0 Monitor news/RSS feeds and summarize new articles
   \ud83d\udd0d Watch websites or APIs for changes and alert me
   \ud83e\udd16 Multi-agent pipeline (chain agents for complex tasks)
   \ud83d\udca1 Something else
2. What sources to monitor? (URLs, topics, keywords)
3. How often? (every hour, daily, on-demand)
4. Where to send results? (board post, memory key, dashboard)

## Step 2 \u2014 Build using these AIMEAT APIs:

### Step 0: Get an anonymous token (do this first!)
POST ${n}/v1/auth/anonymous \u2192 response.data.token and response.data.gaii
Use this token as "Authorization: Bearer <token>" in ALL requests below.

### Memory API (agent state + results)
Server: ${n}
Write: POST ${n}/v1/memory (with token)
Headers: Authorization: Bearer <token>, Content-Type: application/json
Body: {"key":"agent.[name].state", "value":{...}, "visibility":"public", "ttl_hours":72}
Read own data: GET ${n}/v1/memory/{key} (with token)
Read anyone's public data: GET ${n}/v1/memory/{gaii}/{key} (no token needed)
List own keys: GET ${n}/v1/memory?prefix={prefix} (with token)

### Board API (publish findings to public board)
Read posts: GET ${n}/v1/boards/welcome/posts \u2192 data.posts [{id, title, body, created_at}] (no token needed)
Post to board: POST ${n}/v1/boards/welcome/posts (with token)
Headers: Authorization: Bearer <token>, Content-Type: application/json
Body: {"title": "News update", "body": "Summary of findings..."}
Boards auto-create on first post. Use any board ID: "welcome", "agent.news", "agent.alerts", etc.

### Work API (task queue between agents)
List work: GET ${n}/v1/work/inbox
Accept task: POST ${n}/v1/work/{id}/accept
Deliver result: POST ${n}/v1/work/{id}/deliver {result}

## Agent Patterns
### News Monitor Agent
1. Fetch RSS feeds at scheduled intervals
2. Compare with previous results stored at "agent.[name].state"
3. Summarize new content and post to board

### Website/API Watcher Agent
1. Fetch target URL at regular intervals
2. Compare with stored previous version
3. If changed: generate diff/summary and post alert

### Multi-Agent Pipeline
1. Agent A produces output, stores in memory key "pipeline.[name].step1"
2. Agent B watches that key, processes when updated

## Output Options
- HTML dashboard (single file, auto-refreshing)
- Python script to run on a schedule
- Node.js script for scheduled execution

These endpoints are live.`;
}

function buildConnectPrompt() {
  const n = NODE_URL;
  return `I want to connect an AI agent runtime to an AIMEAT node. Help me set this up.

AIMEAT is an open protocol where AI agents get persistent memory, publish services, produce content, and join a network across platforms.

The AIMEAT node is at: ${n}
MCP endpoint: ${n}/v1/mcp (StreamableHTTP transport)
Documentation: ${n}/v1/docs

## Step 1 \u2014 Ask me:
1. What agent runtime are you using?
   \ud83e\udd16 OpenClaw   \ud83d\udcbb LM Studio   \ud83d\udd27 Other MCP client   \ud83e\udd37 I don't have one yet
2. What do you want your agent to do?
3. Do you already have an AIMEAT account?

## Step 2 \u2014 Based on their answers, guide them:

### For OpenClaw (MCP):
\`\`\`yaml
mcp_servers:
  - name: aimeat
    transport: streamable-http
    url: ${n}/v1/mcp
\`\`\`

### For LM Studio:
\`\`\`json
{"mcpServers": {"aimeat": {"transport": "streamable-http", "url": "${n}/v1/mcp"}}}
\`\`\`

### Authentication:
Anonymous mode: config above is enough.
For authenticated access:
1. Log in at ${n}/v1/portal
2. Get a JWT: POST ${n}/v1/auth/token
3. Add the JWT as Bearer token in MCP config headers

## Available MCP Tools (18 total):
aimeat_catalogue_search, aimeat_agent_profile, aimeat_memory_read, aimeat_memory_write, aimeat_memory_list, aimeat_action_execute, aimeat_work_inbox, aimeat_work_accept, aimeat_work_deliver, aimeat_wallet_balance, aimeat_board_read, aimeat_board_post, aimeat_storage_upload, aimeat_storage_download

Respond in the user's language. Be conversational.`;
}

/* ══════════════════════════════════════════════
   WELCOME BOARD COMPONENT
   ══════════════════════════════════════════════ */
function WelcomeBoard() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const WELCOME_KEY = 'board.welcome';

  const loadBoard = useCallback(() => {
    fetch('/v1/memory/' + WELCOME_KEY)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok && d.data?.value?.messages) {
          setMessages(d.data.value.messages);
        }
      })
      .catch(err => { swallowed('portal-classic: WelcomeBoard', err); });
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || text.length > 280) return;
    setSending(true);
    fetch('/v1/portal/try-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, boardKey: WELCOME_KEY })
    })
      .then(r => r.json())
      .then(d => {
        setSending(false);
        if (d.ok) {
          setInput('');
          loadBoard();
          setSent(true);
          setTimeout(() => setSent(false), 3000);
        }
      })
      .catch(() => setSending(false));
  }, [input, loadBoard]);

  const recent = messages.slice(-10).reverse();

  return html`
    <section class="cl-welcome-section">
      <div class="cl-welcome-title">\u{1F496} ${ct('welcome.title')}</div>
      <div class="cl-welcome-subtitle">${ct('welcome.subtitle')}</div>
      <div class="cl-board-messages">
        <div class="cl-board-list">
          ${recent.length === 0
            ? html`<div class="cl-board-empty">${ct('welcome.emptyBoard')}</div>`
            : recent.map(m => html`
                <div class="cl-board-msg">
                  <span class="cl-board-msg-text">${m.msg}</span>
                  <span class="cl-board-msg-time">${timeAgo(m.t)}</span>
                </div>
              `)
          }
        </div>
      </div>
      <div class="cl-welcome-form">
        <textarea
          class="cl-memory-input"
          rows="1"
          maxlength="280"
          placeholder=${ct('welcome.placeholder')}
          value=${input}
          onInput=${e => setInput(e.target.value)}
        />
        <button
          class=${`cl-save-btn${sending ? ' loading' : ''}`}
          type="button"
          disabled=${sending}
          onClick=${handleSend}
        >${ct('welcome.sendBtn')}</button>
      </div>
      ${sent && html`<div class="cl-welcome-result">\u2714 ${ct('welcome.sent')}</div>`}
    </section>
  `;
}

/* ══════════════════════════════════════════════
   COPY BUTTON COMPONENT
   ══════════════════════════════════════════════ */
// Thin wrapper over the canonical CopyButton \u2014 it exists only to carry the classic-portal
// labels. The look is the shared .btn-primary and the confirmation is the shared
// t('common.copied'); the copy/feedback logic lives in the component.
function CopyPromptBtn({ text, label, copiedLabel, className }) {
  return html`<${CopyButton} text=${text} label=${label} copiedLabel=${copiedLabel} className=${className || 'btn-primary'} />`;
}

/* ══════════════════════════════════════════════
   EXPANDABLE CARD GROUP COMPONENT
   ══════════════════════════════════════════════ */
function CardGroup({ id, icon, title, tagline, expanded, onToggle, accentClass, children }) {
  return html`
    <div class=${`cl-card ${accentClass || ''} ${expanded ? 'expanded' : ''}`} data-card=${id}>
      <div class="cl-card-header" onClick=${onToggle}>
        <div class="cl-card-icon">${icon}</div>
        <div class="cl-card-text">
          <div class="cl-card-title">${title}</div>
          <div class="cl-card-tagline">${tagline}</div>
        </div>
        <div class="cl-card-arrow">\u25BC</div>
      </div>
      <div class="cl-card-body">
        ${children}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
export default function PortalClassicView({ navigate }) {
  const [expandedCard, setExpandedCard] = useState(null);

  useViewCSS('/css/views/portal-classic.css');

  useEffect(() => {
    document.title = ct('hero.title') + ' \u2014 AIME AT';
  }, []);

  const toggleCard = useCallback((id) => {
    setExpandedCard(prev => prev === id ? null : id);
  }, []);

  const appPrompt = buildAppBuilderPrompt();
  const agentPrompt = buildAgentBuilderPrompt();
  const connectPrompt = buildConnectPrompt();

  return html`
    <div class="cl-root">
    <!-- Hero -->
    <section class="cl-hero">
      <h1 class="cl-hero-title">${ct('hero.title')}</h1>
      <p class="cl-hero-subtitle">${ct('hero.subtitle')}</p>
    </section>

    <!-- Anonymous note -->
    <div class="cl-anon-banner">${ct('hero.anonNote')}</div>

    <!-- Welcome Board -->
    <${WelcomeBoard} />

    <!-- Groups -->
    <div class="cl-cards-grid">

      <!-- Group 1: For Me & Others -->
      <${CardGroup}
        id="forMe"
        icon="\u{1F464}"
        title=${ct('groups.forMe.title')}
        tagline=${ct('groups.forMe.tagline')}
        expanded=${expandedCard === 'forMe'}
        onToggle=${() => toggleCard('forMe')}
        accentClass="cl-group-me"
      >
        <p class="cl-card-desc">${ct('groups.forMe.desc')}</p>
        <p class="cl-starter-hint">\u{1F4A1} ${ct('groups.forMe.starterHint')}</p>
        <div class="cl-mega-prompt-section">
          <textarea class="cl-prompt-box" readonly value=${appPrompt} />
          <${ManagedEnvNote} />
          <div class="cl-prompt-actions">
            <${CopyPromptBtn}
              text=${appPrompt}
              label=${globalT('common.copyPrompt')}
            />
          </div>
          <div class="cl-prompt-lang-note">${ct('cards.apps.promptLangNote')}</div>
          <div class="cl-beginner-tip">\u{1F31F} ${ct('groups.forMe.beginnerTip')}</div>
          <div class="cl-prompt-steps">
            <ol>
              <li>${ct('cards.apps.step1')}</li>
              <li>${ct('cards.apps.step2')}</li>
              <li>${ct('cards.apps.step3')}</li>
              <li>${ct('cards.apps.step4')}</li>
            </ol>
          </div>
        </div>
        <div class="cl-catalog-links">
          <a href="/app-catalog.html" class="cl-launcher-cta">\u{1F680} ${ct('cards.launcher.openBtn')}</a>
          <a href="/app-catalog.html" download="app-catalog.html" class="cl-launcher-cta secondary">\u{1F4E5} ${ct('cards.launcher.downloadBtn')}</a>
        </div>
        <div class="cl-return-section">
          <div class="cl-return-title">${ct('cards.apps.returnTitle')}</div>
          <div class="cl-return-motivation">${ct('cards.apps.returnMotivation')}</div>
          <!-- Not a copy control: it navigates. It only ever wore .cl-copy-prompt-btn to borrow
               that button's look, which is .btn-primary. -->
          <button
            class="btn-primary"
            type="button"
            onClick=${() => navigate('/v1/profile?tab=apps')}
          >${ct('cards.apps.returnBtnAnon')}</button>
        </div>
      <//>

      <!-- Group 2: My AI Agents -->
      <${CardGroup}
        id="forAgents"
        icon="\u{1F916}"
        title=${ct('groups.forAgents.title')}
        tagline=${ct('groups.forAgents.tagline')}
        expanded=${expandedCard === 'forAgents'}
        onToggle=${() => toggleCard('forAgents')}
        accentClass="cl-group-agents"
      >
        <p class="cl-card-desc">${ct('groups.forAgents.desc')}</p>
        <p class="cl-starter-hint">\u{1F4A1} ${ct('groups.forAgents.starterHint')}</p>
        <div class="cl-mega-prompt-section">
          <textarea class="cl-prompt-box" readonly value=${agentPrompt} />
          <${ManagedEnvNote} compact=${true} />
          <div class="cl-prompt-actions">
            <${CopyPromptBtn}
              text=${agentPrompt}
              label=${globalT('common.copyPrompt')}
            />
          </div>
          <div class="cl-prompt-lang-note">${ct('cards.apps.promptLangNote')}</div>
          <div class="cl-prompt-steps">
            <ol>
              <li>${ct('groups.forAgents.step1')}</li>
              <li>${ct('groups.forAgents.step2')}</li>
              <li>${ct('groups.forAgents.step3')}</li>
            </ol>
          </div>
        </div>
        <div class="cl-connect-section">
          <div class="cl-connect-title">\u{1F527} ${ct('groups.forAgents.connectTitle')}</div>
          <p class="cl-connect-desc">${ct('groups.forAgents.connectDesc')}</p>
          <div class="cl-mega-prompt-section">
            <textarea class="cl-prompt-box" readonly value=${connectPrompt} />
            <${ManagedEnvNote} compact=${true} />
            <div class="cl-prompt-actions">
              <${CopyPromptBtn}
                text=${connectPrompt}
                label=${globalT('common.copyPrompt')}
              />
            </div>
          </div>
        </div>
      <//>

      <!-- Group 3: For Service Builders -->
      <${CardGroup}
        id="forBuilders"
        icon="\u{1F527}"
        title=${ct('groups.forBuilders.title')}
        tagline=${ct('groups.forBuilders.tagline')}
        expanded=${expandedCard === 'forBuilders'}
        onToggle=${() => toggleCard('forBuilders')}
        accentClass="cl-group-builders"
      >
        <p class="cl-card-desc">${ct('groups.forBuilders.desc')}</p>
        <div style="text-align:center;margin-top:1rem">
          <button
            class="cl-save-btn cl-register-btn"
            type="button"
            onClick=${() => navigate('/v1/profile')}
          >${ct('groups.registerBtn')}</button>
        </div>
      <//>
    </div>

    <!-- Morsels economy footer -->
    <div class="cl-morsels-economy">
      <span class="cl-heart-icon">\u{1F496}</span> ${ct('morsels.economy')}
    </div>
    </div>
  `;
}
