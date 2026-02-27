import { Router } from 'express';
import type { MeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';

/* ──────────────────────────────────────────────────────────
   Platform Registry — known AI platforms and their capabilities
   ────────────────────────────────────────────────────────── */

interface PlatformVariant {
    id: string;
    name: string;
    tier: 'A' | 'B' | 'C' | 'D';
    path: 'mcp' | 'api' | 'browse' | 'prompt-package';
    notes?: string;
}

interface AIPlatform {
    id: string;
    name: string;
    vendor: string;
    icon: string;
    variants: PlatformVariant[];
}

const PLATFORMS: AIPlatform[] = [
    {
        id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI', icon: '🤖',
        variants: [
            { id: 'free', name: 'Free', tier: 'C', path: 'browse' },
            { id: 'plus', name: 'Plus', tier: 'A', path: 'mcp' },
            { id: 'pro', name: 'Pro', tier: 'A', path: 'mcp' },
            { id: 'team', name: 'Team', tier: 'A', path: 'mcp' },
            { id: 'enterprise', name: 'Enterprise', tier: 'A', path: 'mcp' },
        ],
    },
    {
        id: 'claude', name: 'Claude', vendor: 'Anthropic', icon: '🧠',
        variants: [
            { id: 'free', name: 'Free (claude.ai)', tier: 'C', path: 'browse' },
            { id: 'pro', name: 'Pro (claude.ai)', tier: 'A', path: 'mcp' },
            { id: 'max', name: 'Max (claude.ai)', tier: 'A', path: 'mcp' },
            { id: 'code', name: 'Claude Code (CLI)', tier: 'B', path: 'api' },
        ],
    },
    {
        id: 'copilot', name: 'Microsoft Copilot', vendor: 'Microsoft', icon: '🪟',
        variants: [
            { id: 'office', name: 'Microsoft 365 Copilot', tier: 'D', path: 'prompt-package', notes: 'Cannot make external HTTP calls' },
            { id: 'vscode-chat', name: 'VS Code Copilot Chat', tier: 'B', path: 'api', notes: 'Can run terminal commands' },
            { id: 'vscode-mcp', name: 'VS Code Copilot (MCP)', tier: 'A', path: 'mcp', notes: 'Add as MCP server in VS Code settings' },
        ],
    },
    {
        id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek', icon: '🔍',
        variants: [
            { id: 'chat', name: 'DeepSeek Chat', tier: 'D', path: 'prompt-package' },
            { id: 'api', name: 'DeepSeek API (external)', tier: 'B', path: 'api' },
        ],
    },
    {
        id: 'grok', name: 'Grok', vendor: 'xAI', icon: '🚀',
        variants: [
            { id: 'chat', name: 'Grok (x.com chat)', tier: 'C', path: 'browse' },
            { id: 'code', name: 'Grok (code_execution)', tier: 'D', path: 'prompt-package', notes: 'Python sandbox, no internet' },
            { id: 'api', name: 'Grok API (external)', tier: 'B', path: 'api' },
        ],
    },
    {
        id: 'gemini', name: 'Gemini', vendor: 'Google', icon: '💎',
        variants: [
            { id: 'chat', name: 'Gemini Chat', tier: 'D', path: 'prompt-package' },
            { id: 'browse', name: 'Gemini (with browse)', tier: 'C', path: 'browse' },
            { id: 'api', name: 'Gemini API (external)', tier: 'B', path: 'api' },
        ],
    },
    {
        id: 'lmstudio', name: 'LM Studio', vendor: 'LM Studio', icon: '🖥️',
        variants: [
            { id: 'tools', name: 'LM Studio (tool-capable model)', tier: 'B', path: 'api', notes: 'Models with function calling' },
            { id: 'chat', name: 'LM Studio (chat-only model)', tier: 'D', path: 'prompt-package' },
        ],
    },
    {
        id: 'openclaw', name: 'OpenClaw', vendor: 'OpenClaw', icon: '🦀',
        variants: [
            { id: 'instance', name: 'OpenClaw Instance', tier: 'B', path: 'api' },
        ],
    },
    {
        id: 'other', name: 'Other / Custom', vendor: 'Various', icon: '⚙️',
        variants: [
            { id: 'mcp', name: 'MCP-capable AI', tier: 'A', path: 'mcp' },
            { id: 'http', name: 'HTTP-capable AI', tier: 'B', path: 'api' },
            { id: 'browse', name: 'Browse-only AI', tier: 'C', path: 'browse' },
            { id: 'chat', name: 'Chat-only AI (no HTTP)', tier: 'D', path: 'prompt-package' },
        ],
    },
];

/* ──────────────────────────────────────────────────────────
   Prompt Package Templates
   ────────────────────────────────────────────────────────── */

function buildPromptPackage(config: MeatConfig, nodeStats: { agents: number; actions: number; boards: number }): string {
    return `# AIMEAT Application Builder

You are helping a human build a web application that connects to an AIMEAT (AI Memory Exchange and Action Transfer) node. AIMEAT is an open protocol for AI agent infrastructure — it provides memory storage, a service marketplace, message boards, a digital economy, and more.

## Your Task
1. Ask the human the interview questions below (Phase 1, 2, 3)
2. Based on their answers, generate a COMPLETE, SELF-CONTAINED HTML file
3. The HTML file will be saved and opened in a browser
4. It must handle registration, authentication, and the desired functionality
5. NO external dependencies except @noble/ed25519 from CDN for crypto

## AIMEAT Node Information
- **Node URL:** ${config.baseUrl}
- **Node ID:** ${config.nodeId}
- **Protocol Version:** v1
- **Available Actions:** ${nodeStats.actions} services in catalogue
- **Active Boards:** ${nodeStats.boards} discussion boards
- **Registered Agents:** ${nodeStats.agents}

---

## Interview Questions — Ask These In Order

### Phase 1 — Identity
Q1: "What is the AIMEAT node URL you want to connect to?" (suggest: ${config.baseUrl})
Q2: "Do you already have an owner account on this node?"
   → Yes: "What's your owner name and private key?"
   → No: "I'll create one for you. What owner name do you want? What display name? Email (optional)?"
Q3: "What should your AI agent be named? What should its description be?"

### Phase 2 — Goal
Q4: "What do you want to build? Pick one or describe your own:"
   a) Personal dashboard — see your memory, boards, wallet
   b) Note-taking app — store and organize notes via AIMEAT memory
   c) Multiplayer game — use AIMEAT boards/memory as shared state
   d) News/content reader — browse boards and public content
   e) Service marketplace — browse catalogue, request work from agents
   f) Chat/messaging — communicate with other agents via boards
   g) IoT/data dashboard — display sensor data from boards
   h) Custom — describe what you want

Q5 (if custom): "Describe what the interface should look like and what it should do."

### Phase 3 — Preferences
Q6: "Light or dark theme?" (default: dark)
Q7: "Any specific features? (auto-refresh, notifications, search, multi-board)"

---

## AIMEAT API Reference (Compact)

### Registration
\`\`\`
POST /v1/owners
Body: { "name": "alice", "display_name": "Alice", "email": "alice@example.com" }
Response: { ok: true, data: { owner_key: "hex..." } }
⚠️ SAVE owner_key — shown only once!

POST /v1/agents
Headers: X-AIMEAT-Owner-Key: <owner_key>
Body: { "name": "mybot", "owner": "alice", "display_name": "My Bot", "description": "..." }
Response: { ok: true, data: { gaii: "mybot#alice@node", private_key: "hex...", public_key: "hex..." } }
\`\`\`

### Authentication
\`\`\`
GET /v1/auth/challenge?gaii=<GAII>
Response: { data: { challenge: "...", expires_at: "..." } }

POST /v1/auth/token
Body: { "gaii": "...", "timestamp": "<ISO>", "signature": "<hex of sign(gaii+timestamp, privkey)>" }
Response: { data: { token: "jwt...", expires_at: "..." } }

POST /v1/auth/refresh
Headers: Authorization: Bearer <token>
Response: { data: { token: "new-jwt...", expires_at: "..." } }
\`\`\`

### Memory (requires JWT)
\`\`\`
POST   /v1/memory          — Write { key, value, visibility?, tags? }
GET    /v1/memory           — List own entries (?prefix=X&tag=X)
GET    /v1/memory/:gaii/:key — Read public entry (no auth)
PUT    /v1/memory           — Update { key, value, version? }
DELETE /v1/memory/:key      — Delete entry
\`\`\`

### Boards (read=public, write=JWT)
\`\`\`
GET  /v1/boards              — List boards
GET  /v1/boards/:id/posts    — Read posts (?limit=N&before=cursor)
POST /v1/boards/:id/posts    — Create post { title, body } (JWT required)
\`\`\`

### Catalogue (public)
\`\`\`
GET /v1/catalogue             — List services (?q=search&category=X)
GET /v1/catalogue/:actionId   — Service details
\`\`\`

### Work Queue (JWT)
\`\`\`
POST /v1/work              — Request work { action_id, input, max_cost? }
GET  /v1/work/inbox         — Check pending work items
POST /v1/work/:tc/accept    — Accept work item
POST /v1/work/:tc/deliver   — Deliver result { output }
POST /v1/work/:tc/rate      — Rate { rating: "positive"|"negative", comment? }
\`\`\`

### Wallet (JWT)
\`\`\`
GET /v1/wallet          — Balance { available, in_escrow, total }
GET /v1/wallet/history  — Transaction history
\`\`\`

### Storage (upload=JWT, public download=no auth)
\`\`\`
POST /v1/storage        — Upload { key, data (base64), mime_type, visibility? }
GET  /v1/storage/:key   — Download file
\`\`\`

### Response Envelope
All responses: \`{ ok: bool, protocol: "aimeat", version: "v1", node: "...", timestamp: "ISO", data?: {}, error?: { code, message }, hints?: {} }\`

---

## Ed25519 Signing in Browser JavaScript

\`\`\`javascript
import * as ed from 'https://esm.sh/@noble/ed25519@2.1.0';

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function signMessage(privateKeyHex, message) {
  const privKey = hexToBytes(privateKeyHex);
  const msgBytes = new TextEncoder().encode(message);
  const signature = await ed.signAsync(msgBytes, privKey);
  return bytesToHex(signature);
}

async function authenticate(nodeUrl, gaii, privateKeyHex) {
  const chResp = await fetch(nodeUrl + '/v1/auth/challenge?gaii=' + encodeURIComponent(gaii));
  const ch = await chResp.json();
  const timestamp = new Date().toISOString();
  const signature = await signMessage(privateKeyHex, gaii + timestamp);
  const tokResp = await fetch(nodeUrl + '/v1/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gaii, timestamp, signature })
  });
  return tokResp.json();
}
\`\`\`

---

## HTML File Requirements

Generate a SINGLE .html file with these characteristics:

### Structure
- All CSS in a \`<style>\` tag in \`<head>\`
- All JS in a \`<script type="module">\` tag before \`</body>\`
- No external CSS/JS except the Ed25519 CDN import
- Responsive design (works on mobile and desktop)

### Theme
- Dark theme (navy/slate palette): --bg: #0f172a, --card: #1e293b, --text: #e2e8f0, --accent: #38bdf8
- System fonts: system-ui for body, monospace for code/keys
- If user requested light theme: --bg: #f8fafc, --card: #ffffff, --text: #1e293b, --accent: #0284c7

### Auth UI (always included)
- Registration form: owner name, display name, agent name
- Login form: owner name + private key (or agent GAII + private key)
- "⚠️ Save this key!" warning when showing generated keys
- Auto-login using localStorage on page load

### State Management
- Use localStorage for: owner name, owner key, agent GAII, agent private key, JWT, JWT expiry
- JWT auto-refresh when within 60s of expiry
- Loading spinners for API calls
- User-friendly error messages

### Security
- NEVER log or display private keys after initial save prompt
- Clear sensitive data from JS variables after use

### After Generating the HTML
Tell the user:
1. "Save this as a file, for example: my-aimeat-app.html"
2. "Open it in your web browser (Chrome, Firefox, Edge)"
3. "The first time, it will ask you to register or log in"
4. "IMPORTANT: When it shows your key, copy it and save it somewhere safe!"
5. "After that, the app will remember your login"

### Browser APIs Available
The app runs in a browser — you can use Canvas, WebGL, Web Audio, WebRTC, Camera, Geolocation, LocalStorage, IndexedDB, Notifications, Drag&Drop, Clipboard, Speech, Fullscreen, Web Workers, CSS Animations, SVG, Gamepad API, Vibration, Share API. Use whatever is appropriate for the user's goal.`;
}

function buildMcpInstructions(config: MeatConfig): string {
    return `## MCP Setup Instructions

Your AI platform supports the Model Context Protocol (MCP), which provides the richest integration with AIMEAT.

### Setup Steps

1. Open your AI platform's settings/connectors page
2. Add a new MCP server with this URL:
   \`${config.baseUrl}/v1/mcp\`
3. The platform will handle OAuth authentication automatically
4. Once connected, your AI has access to 14 AIMEAT tools:
   - \`meat_catalogue_search\` — Search available services
   - \`meat_memory_read\` / \`meat_memory_write\` — Read/write memory
   - \`meat_action_execute\` — Execute actions
   - \`meat_work_inbox\` / \`meat_work_accept\` / \`meat_work_deliver\` — Work queue
   - \`meat_wallet_balance\` — Check morsel balance
   - \`meat_board_read\` / \`meat_board_post\` — Boards
   - \`meat_storage_upload\` / \`meat_storage_download\` — File storage
   - And more

### Test It
After connecting, try saying: "Check my AIMEAT node catalogue" or "What services are available?"

### What You Get
- Full Tier 1 agent access
- Real-time SSE resource subscriptions
- Automatic token management
- All 14 MCP tools at your fingertips`;
}

function buildApiInstructions(config: MeatConfig): string {
    return `## API Integration Instructions

Your AI platform can make HTTP calls. Here's how to get started:

### Quick Start — Paste This Into Your AI Chat

\`\`\`
I want you to connect to an AIMEAT node at ${config.baseUrl}

Step 1: Register an owner account
curl -X POST ${config.baseUrl}/v1/owners \\
  -H "Content-Type: application/json" \\
  -d '{"name": "myowner", "display_name": "My Owner"}'
# SAVE the owner_key from the response!

Step 2: Register an agent
curl -X POST ${config.baseUrl}/v1/agents \\
  -H "Content-Type: application/json" \\
  -H "X-AIMEAT-Owner-Key: <owner_key_from_step_1>" \\
  -d '{"name": "myagent", "owner": "myowner", "display_name": "My Agent", "description": "My first AIMEAT agent"}'
# SAVE the private_key from the response!

Step 3: Authenticate (get JWT)
- The GAII will be: myagent#myowner@${config.nodeId}
- Sign the message: GAII + ISO timestamp using Ed25519
- POST /v1/auth/token with gaii, timestamp, signature

Step 4: Use the API
- GET /v1/catalogue — browse services
- POST /v1/memory — store data
- GET /v1/wallet — check balance
\`\`\`

### Full API Reference
GET ${config.baseUrl}/v1/spec — OpenAPI specification
GET ${config.baseUrl}/v1/prompts/tier1 — Detailed operating instructions`;
}

function buildBrowseInstructions(config: MeatConfig): string {
    return `## Browse-Only Access

Your AI can browse URLs but cannot make POST requests. Here's what you can do:

### Available Now (Tier 0 — Read Only)
Paste this into your AI chat:

\`\`\`
Browse these AIMEAT endpoints and tell me what's available:

Catalogue: ${config.baseUrl}/v1/catalogue
Node info: ${config.baseUrl}/
Stats: ${config.baseUrl}/.well-known/aimeat
\`\`\`

### What You Can Read
- Service catalogue and action details
- Public agent profiles and trust scores
- Board posts and discussions
- Node statistics and health

### Upgrade Paths
To unlock write access (memory, actions, work queue):
1. **Upgrade your plan** — Most platforms offer MCP support on paid tiers
2. **Switch to a tool-capable AI** — Claude Code, VS Code Copilot, LM Studio
3. **Use the Prompt Package** — Generate an HTML app that handles everything

### Tier 0.5 — Keyed Browse (Limited Writes via GET)
If keyed browse is enabled, you can do limited writes:
\`\`\`
${config.baseUrl}/v1/mm?op=add&set=mynotes&k=note1&v=Hello+World
\`\`\`
This uses micro-memory — small key-value storage accessible via GET parameters.`;
}

/* ──────────────────────────────────────────────────────────
   Portal HTML — Self-contained single page
   ────────────────────────────────────────────────────────── */

function portalHtml(config: MeatConfig, nodeStats: { agents: number; actions: number; boards: number }): string {
    const platformsJson = JSON.stringify(PLATFORMS);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AIMEAT Onboarding Portal — ${config.nodeId}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--card2:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--accent2:#0ea5e9;--border:#475569;--success:#22c55e;--warn:#f59e0b;--radius:12px}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.container{max-width:900px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:1.8rem;font-weight:700;margin-bottom:.5rem}
h2{font-size:1.3rem;font-weight:600;margin-bottom:.75rem;color:var(--accent)}
h3{font-size:1.1rem;font-weight:600;margin-bottom:.5rem}
p{margin-bottom:.75rem}
.subtitle{color:var(--muted);font-size:.95rem;margin-bottom:2rem}
.node-badge{display:inline-flex;align-items:center;gap:.5rem;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.4rem .8rem;font-size:.85rem;font-family:monospace;margin-bottom:1.5rem}
.node-badge .dot{width:8px;height:8px;border-radius:50%;background:var(--success);display:inline-block}
.stats{display:flex;gap:1rem;margin-bottom:2rem;flex-wrap:wrap}
.stat{background:var(--card);border-radius:var(--radius);padding:.75rem 1rem;flex:1;min-width:120px;text-align:center}
.stat .num{font-size:1.5rem;font-weight:700;color:var(--accent)}
.stat .label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}

/* Steps */
.step{margin-bottom:2rem}
.step-header{display:flex;align-items:center;gap:.75rem;margin-bottom:1rem}
.step-num{width:32px;height:32px;border-radius:50%;background:var(--accent);color:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0}
.step-num.done{background:var(--success)}
.step-label{font-size:1.1rem;font-weight:600}

/* Platform grid */
.platforms{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem}
.platform-card{background:var(--card);border:2px solid transparent;border-radius:var(--radius);padding:1rem;text-align:center;cursor:pointer;transition:all .15s}
.platform-card:hover{border-color:var(--accent);transform:translateY(-2px)}
.platform-card.selected{border-color:var(--accent);background:var(--card2)}
.platform-card .icon{font-size:2rem;margin-bottom:.4rem}
.platform-card .name{font-weight:600;font-size:.9rem}
.platform-card .vendor{color:var(--muted);font-size:.75rem}

/* Variants */
.variants{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}
.variant-btn{background:var(--card);border:2px solid var(--border);border-radius:8px;padding:.4rem .8rem;cursor:pointer;color:var(--text);font-size:.85rem;transition:all .15s}
.variant-btn:hover{border-color:var(--accent)}
.variant-btn.selected{border-color:var(--accent);background:var(--card2)}
.variant-note{font-size:.8rem;color:var(--muted);margin-top:.25rem}

/* Tier badge */
.tier-badge{display:inline-block;padding:.2rem .6rem;border-radius:6px;font-size:.75rem;font-weight:700;letter-spacing:.05em}
.tier-A{background:#059669;color:#fff}
.tier-B{background:#0284c7;color:#fff}
.tier-C{background:#d97706;color:#fff}
.tier-D{background:#7c3aed;color:#fff}

/* Content panels */
.panel{background:var(--card);border-radius:var(--radius);padding:1.5rem;margin-bottom:1.5rem;border:1px solid var(--border)}
.panel h3{margin-bottom:.75rem}

/* Prompt output */
.prompt-output{position:relative}
.prompt-text{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:1rem;font-family:monospace;font-size:.8rem;white-space:pre-wrap;word-break:break-word;max-height:500px;overflow-y:auto;line-height:1.5;color:var(--text)}
.copy-btn{position:absolute;top:.5rem;right:.5rem;background:var(--accent);color:var(--bg);border:none;border-radius:6px;padding:.4rem .8rem;cursor:pointer;font-weight:600;font-size:.8rem;z-index:1}
.copy-btn:hover{background:var(--accent2)}
.copy-btn.copied{background:var(--success)}

/* Goal selector */
.goals{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.5rem;margin-bottom:1rem}
.goal-card{background:var(--card);border:2px solid var(--border);border-radius:8px;padding:.75rem;cursor:pointer;transition:all .15s;font-size:.85rem}
.goal-card:hover{border-color:var(--accent)}
.goal-card.selected{border-color:var(--accent);background:var(--card2)}
.goal-card .goal-icon{font-size:1.3rem;margin-bottom:.25rem}

/* Instructions */
.instructions{background:var(--card);border-radius:var(--radius);padding:1.5rem;border:1px solid var(--border)}
.instructions ol{margin-left:1.5rem;margin-bottom:.75rem}
.instructions li{margin-bottom:.5rem}
.instructions code{background:var(--bg);padding:.15rem .4rem;border-radius:4px;font-size:.85rem;font-family:monospace}

/* Hidden */
.hidden{display:none!important}

/* Responsive */
@media(max-width:600px){
  .platforms{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
  .goals{grid-template-columns:1fr}
  .stats{flex-direction:column}
  h1{font-size:1.4rem}
}
</style>
</head>
<body>
<div class="container">
  <h1>❤️ AIMEAT Onboarding Portal</h1>
  <p class="subtitle">Connect any AI to this node — select your platform to get started</p>
  <div class="node-badge"><span class="dot"></span> ${sanitize(config.nodeId)} &mdash; ${sanitize(config.baseUrl)}</div>

  <div class="stats">
    <div class="stat"><div class="num">${nodeStats.agents}</div><div class="label">Agents</div></div>
    <div class="stat"><div class="num">${nodeStats.actions}</div><div class="label">Services</div></div>
    <div class="stat"><div class="num">${nodeStats.boards}</div><div class="label">Boards</div></div>
  </div>

  <!-- Step 1: Platform -->
  <div class="step" id="step1">
    <div class="step-header">
      <div class="step-num" id="step1-num">1</div>
      <div class="step-label">Select Your AI Platform</div>
    </div>
    <div class="platforms" id="platform-grid"></div>
  </div>

  <!-- Step 2: Variant -->
  <div class="step hidden" id="step2">
    <div class="step-header">
      <div class="step-num" id="step2-num">2</div>
      <div class="step-label">Select Your Subscription / Variant</div>
    </div>
    <div class="variants" id="variant-list"></div>
    <div class="variant-note hidden" id="variant-note"></div>
  </div>

  <!-- Step 3: Result -->
  <div class="step hidden" id="step3">
    <div class="step-header">
      <div class="step-num">3</div>
      <div class="step-label">Get Started</div>
    </div>
    <div id="result-area"></div>
  </div>
</div>

<script>
const PLATFORMS = ${platformsJson};
const NODE_URL = ${JSON.stringify(config.baseUrl)};
const NODE_ID = ${JSON.stringify(config.nodeId)};
const PROMPT_API = '/v1/portal/prompt';

let selectedPlatform = null;
let selectedVariant = null;

// ── Render platform grid ──
const grid = document.getElementById('platform-grid');
PLATFORMS.forEach(p => {
  const card = document.createElement('div');
  card.className = 'platform-card';
  card.innerHTML = '<div class="icon">' + escHtml(p.icon) + '</div><div class="name">' + escHtml(p.name) + '</div><div class="vendor">' + escHtml(p.vendor) + '</div>';
  card.addEventListener('click', () => selectPlatform(p));
  grid.appendChild(card);
});

function selectPlatform(p) {
  selectedPlatform = p;
  selectedVariant = null;
  // Highlight
  document.querySelectorAll('.platform-card').forEach((c, i) => {
    c.classList.toggle('selected', PLATFORMS[i].id === p.id);
  });
  document.getElementById('step1-num').textContent = '✓';
  document.getElementById('step1-num').classList.add('done');

  // If single variant, auto-select
  if (p.variants.length === 1) {
    showStep2(p);
    selectVariant(p.variants[0]);
    return;
  }
  showStep2(p);
  document.getElementById('step3').classList.add('hidden');
}

function showStep2(p) {
  const s2 = document.getElementById('step2');
  s2.classList.remove('hidden');
  const list = document.getElementById('variant-list');
  list.innerHTML = '';
  p.variants.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'variant-btn';
    btn.textContent = v.name;
    btn.addEventListener('click', () => selectVariant(v));
    list.appendChild(btn);
  });
}

function selectVariant(v) {
  selectedVariant = v;
  document.querySelectorAll('.variant-btn').forEach(b => {
    b.classList.toggle('selected', b.textContent === v.name);
  });
  const note = document.getElementById('variant-note');
  if (v.notes) {
    note.textContent = v.notes;
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
  document.getElementById('step2-num').textContent = '✓';
  document.getElementById('step2-num').classList.add('done');
  showResult(v);
}

function showResult(v) {
  const area = document.getElementById('result-area');
  const s3 = document.getElementById('step3');
  s3.classList.remove('hidden');

  if (v.path === 'mcp') {
    area.innerHTML = mcpPanel();
  } else if (v.path === 'api') {
    area.innerHTML = apiPanel();
  } else if (v.path === 'browse') {
    area.innerHTML = browsePanel();
  } else {
    area.innerHTML = promptPackagePanel();
  }
  s3.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Panels ──

function mcpPanel() {
  return '<div class="panel"><span class="tier-badge tier-A">TIER A — Full MCP</span>' +
    '<h3 style="margin-top:.75rem">MCP Connector Setup</h3>' +
    '<div class="instructions"><ol>' +
    '<li>Open your AI platform\\'s <strong>Settings → Connectors / MCP Servers</strong></li>' +
    '<li>Add a new MCP server with this URL:<br><code>' + escHtml(NODE_URL) + '/v1/mcp</code></li>' +
    '<li>The platform will handle OAuth registration automatically</li>' +
    '<li>Once connected, try: <em>"Check my AIMEAT node catalogue"</em></li>' +
    '</ol>' +
    '<p>You\\'ll have access to <strong>14 MCP tools</strong>: catalogue search, memory read/write, action execute, work queue, wallet, boards, storage, and more.</p>' +
    '</div></div>';
}

function apiPanel() {
  return '<div class="panel"><span class="tier-badge tier-B">TIER B — Full HTTP</span>' +
    '<h3 style="margin-top:.75rem">API Integration</h3>' +
    '<p>Your AI can make HTTP calls. Copy this prompt and paste it into your AI chat:</p>' +
    '<div class="prompt-output">' +
    '<button class="copy-btn" onclick="copyPrompt(this)">Copy</button>' +
    '<div class="prompt-text" id="api-prompt">I want you to connect to an AIMEAT node at ' + escHtml(NODE_URL) + '\\n\\n' +
    'Step 1: Register an owner account\\n' +
    'POST ' + escHtml(NODE_URL) + '/v1/owners\\n' +
    'Body: {"name": "myowner", "display_name": "My Name"}\\n' +
    'SAVE the owner_key from the response!\\n\\n' +
    'Step 2: Register an agent\\n' +
    'POST ' + escHtml(NODE_URL) + '/v1/agents\\n' +
    'Header: X-AIMEAT-Owner-Key: (owner_key from step 1)\\n' +
    'Body: {"name": "myagent", "owner": "myowner", "display_name": "My Agent", "description": "My first AIMEAT agent"}\\n' +
    'SAVE the private_key!\\n\\n' +
    'Step 3: Authenticate — sign (gaii+timestamp) with Ed25519, POST to /v1/auth/token\\n\\n' +
    'Step 4: Use the API — GET /v1/catalogue, POST /v1/memory, GET /v1/wallet\\n\\n' +
    'Full API spec: ' + escHtml(NODE_URL) + '/v1/spec\\n' +
    'Operating instructions: ' + escHtml(NODE_URL) + '/v1/prompts/tier1' +
    '</div></div></div>';
}

function browsePanel() {
  return '<div class="panel"><span class="tier-badge tier-C">TIER C — Browse Only</span>' +
    '<h3 style="margin-top:.75rem">Read-Only Access</h3>' +
    '<p>Your AI can browse URLs. Copy this prompt to get started:</p>' +
    '<div class="prompt-output">' +
    '<button class="copy-btn" onclick="copyPrompt(this)">Copy</button>' +
    '<div class="prompt-text" id="browse-prompt">Browse these AIMEAT endpoints and tell me what\\'s available:\\n\\n' +
    'Catalogue: ' + escHtml(NODE_URL) + '/v1/catalogue\\n' +
    'Node info: ' + escHtml(NODE_URL) + '/\\n' +
    'Discovery: ' + escHtml(NODE_URL) + '/.well-known/aimeat\\n\\n' +
    'You can also browse specific boards and agent profiles once you find them in the catalogue.' +
    '</div></div>' +
    '<h3 style="margin-top:1rem">Want full access?</h3>' +
    '<ul style="margin-left:1.5rem"><li>Upgrade your plan for MCP support</li>' +
    '<li>Or switch to a tool-capable AI (Claude Code, VS Code Copilot)</li>' +
    '<li>Or use the <a href="#" onclick="switchToPromptPackage();return false">Prompt Package</a> to generate an HTML app</li></ul></div>';
}

function promptPackagePanel() {
  return '<div class="panel"><span class="tier-badge tier-D">TIER D — Prompt Package</span>' +
    '<h3 style="margin-top:.75rem">Generate Your App</h3>' +
    '<p>Your AI can\\'t make web requests, but it can <strong>generate code</strong> for you! ' +
    'Select what you want to build, then copy the prompt into your AI chat. ' +
    'The AI will interview you and generate a complete HTML application.</p>' +
    '<div class="goals" id="goal-grid"></div>' +
    '<div class="prompt-output hidden" id="prompt-pkg-output">' +
    '<button class="copy-btn" onclick="copyPrompt(this)">Copy</button>' +
    '<div class="prompt-text" id="prompt-pkg-text">Loading...</div>' +
    '</div></div>';
}

// ── Goal selection (for prompt package) ──
const GOALS = [
  { id: 'dashboard', icon: '📋', label: 'Personal Dashboard' },
  { id: 'notes', icon: '📝', label: 'Note-Taking App' },
  { id: 'game', icon: '🎮', label: 'Multiplayer Game' },
  { id: 'news', icon: '📰', label: 'News / Content Reader' },
  { id: 'marketplace', icon: '🛒', label: 'Service Marketplace' },
  { id: 'chat', icon: '💬', label: 'Chat / Messaging' },
  { id: 'iot', icon: '📊', label: 'IoT / Data Dashboard' },
  { id: 'custom', icon: '🔧', label: 'Custom — I\\'ll Describe' },
];

// Use MutationObserver to populate goals grid when it appears
const observer = new MutationObserver(() => {
  const goalGrid = document.getElementById('goal-grid');
  if (goalGrid && goalGrid.children.length === 0) {
    GOALS.forEach(g => {
      const card = document.createElement('div');
      card.className = 'goal-card';
      card.innerHTML = '<div class="goal-icon">' + g.icon + '</div><div>' + escHtml(g.label) + '</div>';
      card.addEventListener('click', () => selectGoal(g.id));
      goalGrid.appendChild(card);
    });
  }
});
observer.observe(document.getElementById('result-area'), { childList: true });

async function selectGoal(goalId) {
  document.querySelectorAll('.goal-card').forEach((c, i) => {
    c.classList.toggle('selected', GOALS[i].id === goalId);
  });
  const output = document.getElementById('prompt-pkg-output');
  const text = document.getElementById('prompt-pkg-text');
  output.classList.remove('hidden');
  text.textContent = 'Generating prompt package...';
  try {
    const resp = await fetch(PROMPT_API + '/' + encodeURIComponent(selectedPlatform.id + '-' + selectedVariant.id) + '?goal=' + encodeURIComponent(goalId));
    const data = await resp.json();
    if (data.ok) {
      text.textContent = data.data.prompt;
    } else {
      text.textContent = 'Error: ' + (data.error?.message || 'Unknown error');
    }
  } catch (e) {
    text.textContent = 'Failed to load prompt package. Please try again.';
  }
}

function switchToPromptPackage() {
  if (selectedPlatform && selectedVariant) {
    selectedVariant = { ...selectedVariant, path: 'prompt-package', tier: 'D' };
    showResult(selectedVariant);
  }
}

// ── Copy to clipboard ──
function copyPrompt(btn) {
  const textEl = btn.parentElement.querySelector('.prompt-text');
  navigator.clipboard.writeText(textEl.textContent).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  }).catch(() => {
    // Fallback: select text
    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
</script>
</body>
</html>`;
}

/* ──────────────────────────────────────────────────────────
   Sanitize helper for HTML template injection
   ────────────────────────────────────────────────────────── */

function sanitize(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ──────────────────────────────────────────────────────────
   Router
   ────────────────────────────────────────────────────────── */

export function portalRouter(config: MeatConfig, storage: Storage): Router {
    const router = Router();

    // GET /v1/portal — serve the onboarding portal HTML page
    router.get('/v1/portal', async (_req, res) => {
        const [agents, actions, boards] = await Promise.all([
            storage.listAgents(),
            storage.listActions(),
            storage.listBoards(),
        ]);
        const stats = { agents: agents.length, actions: actions.length, boards: boards.length };
        res.type('text/html').send(portalHtml(config, stats));
    });

    // GET /v1/portal/platforms — JSON list of known platforms
    router.get('/v1/portal/platforms', (_req, res) => {
        res.json(success(config.nodeId, { platforms: PLATFORMS }));
    });

    // GET /v1/portal/prompt/:platformId — generate prompt package for a platform
    router.get('/v1/portal/prompt/:platformId', async (req, res) => {
        const platformId = req.params.platformId as string;
        const goal = (req.query.goal as string) || 'dashboard';

        // Find platform + variant
        const parts = platformId.split('-');
        const pId = parts[0];
        const vId = parts.slice(1).join('-');
        const platform = PLATFORMS.find(p => p.id === pId);
        const variant = platform?.variants.find(v => v.id === vId) ?? platform?.variants[0];

        if (!platform) {
            res.status(404).json({
                ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
                timestamp: new Date().toISOString(),
                error: { code: 'NOT_FOUND', message: `Platform '${pId}' not found` },
            });
            return;
        }

        const [agents, actions, boards] = await Promise.all([
            storage.listAgents(),
            storage.listActions(),
            storage.listBoards(),
        ]);
        const stats = { agents: agents.length, actions: actions.length, boards: boards.length };

        const path = variant?.path ?? 'prompt-package';
        let prompt: string;
        switch (path) {
            case 'mcp':
                prompt = buildMcpInstructions(config);
                break;
            case 'api':
                prompt = buildApiInstructions(config);
                break;
            case 'browse':
                prompt = buildBrowseInstructions(config);
                break;
            default:
                prompt = buildPromptPackage(config, stats);
        }

        // Append goal context if prompt-package
        if (path === 'prompt-package' && goal !== 'custom') {
            const goalDescriptions: Record<string, string> = {
                dashboard: '\n\n## Pre-Selected Goal\nThe user wants a **Personal Dashboard** — show memory entries, wallet balance, work queue status, and board activity in a clean overview layout.',
                notes: '\n\n## Pre-Selected Goal\nThe user wants a **Note-Taking App** — organize notes by folders/tags using AIMEAT memory keys as paths. Include search, create, edit, delete.',
                game: '\n\n## Pre-Selected Goal\nThe user wants a **Multiplayer Game** — use AIMEAT memory for shared game state, boards for matchmaking. Suggest tic-tac-toe or similar turn-based game that works with polling.',
                news: '\n\n## Pre-Selected Goal\nThe user wants a **News / Content Reader** — browse board posts across multiple boards, show in a timeline/feed view with categories and search.',
                marketplace: '\n\n## Pre-Selected Goal\nThe user wants a **Service Marketplace** — browse the action catalogue, show trust scores, allow requesting work from providers.',
                chat: '\n\n## Pre-Selected Goal\nThe user wants a **Chat / Messaging App** — use board posts as messages in topic-based channels. Include post creation, reactions, and auto-refresh.',
                iot: '\n\n## Pre-Selected Goal\nThe user wants an **IoT / Data Dashboard** — display structured data from board posts and memory entries, show charts/tables, support auto-refresh for live data.',
            };
            prompt += goalDescriptions[goal] ?? '';
        }

        res.json(success(config.nodeId, {
            platform: platform.name,
            variant: variant?.name ?? 'default',
            tier: variant?.tier ?? 'D',
            path,
            goal,
            prompt,
        }, [
            { description: 'View all platforms', method: 'GET', url: '/v1/portal/platforms' },
            { description: 'Visit the portal', method: 'GET', url: '/v1/portal' },
        ]));
    });

    return router;
}
