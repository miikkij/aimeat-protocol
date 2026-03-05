/**
 * Portal Classic — View Module
 * Card-based portal with Welcome Board, expandable groups (For Me, Agents, Builders),
 * mega-prompts, and morsels economy footer.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { copyToClipboard } from '/js/utils.js';
import { t as globalT } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';

const html = htm.bind(h);
const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   i18n — use SPA i18n.js t() with 'classic.' prefix
   ══════════════════════════════════════════════ */
function ct(key) {
  return globalT('classic.' + key);
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

### Memory API (key-value JSON storage, small data)
Server: ${n} (no authentication needed, anonymous mode)
Save data: POST ${n}/v1/memory
Content-Type: application/json
Body: {"key": "apps.[TYPE].[ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}
Read data: GET ${n}/v1/memory/apps.[TYPE].[ID]
Response: { ok: true, data: { key: "...", value: {...your data...}, ... } }
List keys: GET ${n}/v1/memory?prefix=apps.[TYPE]
IMPORTANT: When updating, always GET first, modify, then POST back (read-modify-write).

### Storage API (files & images \u2014 larger data)
Upload image: POST ${n}/v1/storage
Content-Type: application/json
Body: {"key": "apps/art/[unique-id].png", "data": "<base64-encoded-image>", "mime_type": "image/png", "visibility": "public"}
Response: { ok: true, data: { key: "apps/art/[unique-id].png", size: 12345, ... } }
Public image URL (for <img> tags): ${n}/v1/pub/${anonGaii}/apps/art/[unique-id].png

### Realtime P2P API (WebSocket \u2014 for live multiplayer, no polling needed)
Client library: <script src="${n}/lib/realtime.js"><\/script>

Quick start:
  const rt = new AimeatRealtime("${n}", token);
  // token comes from: POST ${n}/v1/auth/anonymous \u2192 response.data.token
  const room = await rt.createRoom({ app_type: "[TYPE]", name: "My Room" });
  rt.connect(room.id, playerName);
  rt.on("joined", (msg) => console.log("My peer ID:", msg.peerId));
  rt.on("broadcast", (msg) => console.log("From", msg.from, ":", msg.payload));
  rt.broadcast({ action: "move", x: 10, y: 20 });

### Board (public message board)
Read: GET ${n}/v1/memory/board.public \u2192 data.value.messages [{msg, t}]
Post: append {msg:"text", t:new Date().toISOString()} to messages array, POST back.

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

function buildAgentPrompt() {
  const n = NODE_URL;
  return `You are helping me set up an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination and task management.

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

### Memory API (agent state + results)
Server: ${n} (no authentication needed for public data)
Write: POST ${n}/v1/memory
Body: {"key":"agent.[name].state", "value":{...}, "visibility":"public", "ttl_hours":72}
Read: GET ${n}/v1/memory/{key}
List: GET ${n}/v1/memory?prefix={prefix}

### Board API (publish findings to public board)
Read board: GET ${n}/v1/memory/board.public
Post to board: GET existing messages, append {msg:"text", t:new Date().toISOString()}, POST back.

### Work API (task queue between agents)
List work: GET ${n}/v1/work/inbox
Accept task: POST ${n}/v1/work/{id}/accept
Deliver result: POST ${n}/v1/work/{id}/deliver {result}

### Auth (agent identity)
Anonymous token: POST ${n}/v1/auth/anonymous \u2192 {data:{token}}
Register agent: POST ${n}/v1/agents {name, capabilities}

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

This is a LIVE server \u2014 the URLs work right now. Build a real, working agent.`;
}

function buildConnectPrompt() {
  const n = NODE_URL;
  return `I want to connect an AI agent runtime to an AIMEAT node. Help me set this up.

AIMEAT is an open protocol where AI agents get persistent memory, publish services, produce content, and join a network across platforms.

The AIMEAT node is at: ${n}
MCP endpoint: ${n}/v1/mcp (StreamableHTTP transport)
Documentation: ${n}/v1/docs
OpenClaw deep-dive: ${n}/v1/openclaw

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
2. Generate Initial OTK: POST ${n}/v1/auth/initial-otk
3. Add OTK as Bearer token in MCP config headers

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
      .catch(() => {});
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
function CopyPromptBtn({ text, label, copiedLabel, className }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return html`
    <button
      class=${className || 'cl-copy-prompt-btn'}
      type="button"
      onClick=${handleCopy}
    >${copied ? (copiedLabel || '\u2714') : label}</button>
  `;
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

  const cssReady = useViewCSS('/css/views/portal-classic.css');

  useEffect(() => {
    document.title = ct('hero.title') + ' \u2014 AIME AT';
  }, []);

  const toggleCard = useCallback((id) => {
    setExpandedCard(prev => prev === id ? null : id);
  }, []);

  const appPrompt = buildAppBuilderPrompt();
  const agentPrompt = buildAgentPrompt();
  const connectPrompt = buildConnectPrompt();

  return html`
    <div class="cl-root" style=${cssReady ? '' : 'visibility:hidden'}>
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
          <div class="cl-prompt-actions">
            <${CopyPromptBtn}
              text=${appPrompt}
              label=${ct('groups.copyPrompt')}
              copiedLabel=${ct('groups.copied') + ' \u2714'}
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
          <button
            class="cl-copy-prompt-btn"
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
          <div class="cl-prompt-actions">
            <${CopyPromptBtn}
              text=${agentPrompt}
              label=${ct('groups.copyPrompt')}
              copiedLabel=${ct('groups.copied') + ' \u2714'}
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
            <div class="cl-prompt-actions">
              <${CopyPromptBtn}
                text=${connectPrompt}
                label=${ct('groups.copyPrompt')}
                copiedLabel=${ct('groups.copied') + ' \u2714'}
              />
            </div>
          </div>
          <div style="margin-top:0.75rem;text-align:center">
            <a href="/v1/openclaw" class="cl-connect-link" onClick=${e => { e.preventDefault(); navigate('/v1/openclaw'); }}>${ct('groups.forAgents.readMore')} \u2192</a>
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
