import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
import { createT, detectLocale, toLocale, resolveLocale, resolveFlat, LOCALES, type Locale, type TFunction } from '../i18n.js';
import { humanPortalHtml } from './portal-human.js';
import { buildStandaloneSnippetJs } from '../middleware/cookie-consent.js';

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
  variants: PlatformVariant[];
}

const PLATFORMS: AIPlatform[] = [
  {
    id: 'chatgpt', name: 'ChatGPT', vendor: 'OpenAI',
    variants: [
      { id: 'free', name: 'Free', tier: 'C', path: 'browse' },
      { id: 'plus', name: 'Plus', tier: 'A', path: 'mcp' },
      { id: 'pro', name: 'Pro', tier: 'A', path: 'mcp' },
      { id: 'team', name: 'Team', tier: 'A', path: 'mcp' },
      { id: 'enterprise', name: 'Enterprise', tier: 'A', path: 'mcp' },
    ],
  },
  {
    id: 'claude', name: 'Claude', vendor: 'Anthropic',
    variants: [
      { id: 'free', name: 'Free (claude.ai)', tier: 'C', path: 'browse' },
      { id: 'pro', name: 'Pro (claude.ai)', tier: 'A', path: 'mcp' },
      { id: 'max', name: 'Max (claude.ai)', tier: 'A', path: 'mcp' },
      { id: 'code', name: 'Claude Code (CLI)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'githubcopilot', name: 'GitHub Copilot', vendor: 'GitHub',
    variants: [
      { id: 'vscode-mcp', name: 'VS Code (MCP)', tier: 'A', path: 'mcp', notes: 'vscodeSettings' },
      { id: 'vscode-chat', name: 'VS Code (Terminal)', tier: 'B', path: 'api', notes: 'terminal' },
    ],
  },
  {
    id: 'm365copilot', name: 'M365 Copilot', vendor: 'Microsoft',
    variants: [
      { id: 'appbuilder', name: 'M365 App Builder', tier: 'D', path: 'prompt-package' },
      { id: 'browse', name: 'M365 Copilot (Bing browse)', tier: 'C', path: 'browse', notes: 'indexnow' },
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', vendor: 'DeepSeek',
    variants: [
      { id: 'chat', name: 'DeepSeek Chat', tier: 'D', path: 'prompt-package' },
      { id: 'api', name: 'DeepSeek API (external)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'grok', name: 'Grok', vendor: 'xAI',
    variants: [
      { id: 'chat', name: 'Grok (x.com chat)', tier: 'C', path: 'browse' },
      { id: 'code', name: 'Grok (code_execution)', tier: 'B', path: 'api', notes: 'pythonSandbox' },
      { id: 'api', name: 'Grok API (external)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'gemini', name: 'Gemini', vendor: 'Google',
    variants: [
      { id: 'chat', name: 'Gemini Chat', tier: 'D', path: 'prompt-package' },
      { id: 'browse', name: 'Gemini (with browse)', tier: 'C', path: 'browse' },
      { id: 'api', name: 'Gemini API (external)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'lmstudio', name: 'LM Studio', vendor: 'LM Studio',
    variants: [
      { id: 'tools', name: 'LM Studio (tool-capable model)', tier: 'B', path: 'api', notes: 'functionCalling' },
      { id: 'chat', name: 'LM Studio (chat-only model)', tier: 'D', path: 'prompt-package' },
    ],
  },
  {
    id: 'openclaw', name: 'OpenClaw', vendor: 'OpenClaw',
    variants: [
      { id: 'mcp', name: 'OpenClaw (MCP)', tier: 'A', path: 'mcp' },
      { id: 'instance', name: 'OpenClaw (HTTP)', tier: 'B', path: 'api' },
    ],
  },
  {
    id: 'other', name: 'Other / Custom', vendor: 'Various',
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

function buildPromptPackage(config: AimeatConfig, nodeStats: { agents: number; actions: number; boards: number }): string {
  return `# AIMEAT Application Builder

You are helping a human build a web application that connects to an AIMEAT (AI Memory Exchange and Action Transfer) node. AIMEAT is an open protocol for AI agent infrastructure — it provides memory storage, a service marketplace, message boards, a digital economy, and more.

## Your Task
1. Ask the human the interview questions below (Phase 1, 2, 3)
2. Based on their answers, generate a COMPLETE, SELF-CONTAINED HTML file
3. The HTML file will be saved and opened in a browser
4. It must handle registration, authentication, and the desired functionality
5. Include \`<script src="${config.baseUrl}/v1/libs/aimeat-auth.js"></script>\` for authentication — this handles Ed25519 signing, registration, login UI, and JWT management automatically

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

## Authentication — Use the AIMEAT Auth Library

Include this script tag in \`<head>\`:
\`\`\`html
<script src="${config.baseUrl}/v1/libs/aimeat-auth.js"></script>
\`\`\`

This provides \`window.AIMEAT.auth\` with:
- \`.register(username, displayName, opts)\` — Creates owner + agent + authenticates (GHII flow)
- \`.login(username?)\` — Re-authenticates from stored credentials
- \`.logout()\` — Clears session
- \`.hasSession\` / \`.storedGhii\` — Check login state
- \`.fetch(url, opts)\` — Authenticated fetch with auto-refresh
- \`.mountLoginButton(selector, opts)\` — Renders a login/register UI button
- \`.on('login', cb)\` / \`.on('logout', cb)\` — Event hooks

### Quick Registration + Auth Example
\`\`\`javascript
const auth = window.AIMEAT.auth;

// Register a new user (creates owner + agent + gets JWT)
const result = await auth.register('alice', 'Alice');
// result = { ghii: 'alice@node', gaii: 'default#alice@node', token: 'jwt...' }

// Make authenticated API calls
const resp = await auth.fetch('/v1/memory');
const data = await resp.json();

// Or mount a login button that handles everything
auth.mountLoginButton('#login-container');
\`\`\`

### Manual Ed25519 (only if NOT using auth library)
\`\`\`javascript
import * as ed from 'https://esm.sh/@noble/ed25519@2.1.0';
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}
function bytesToHex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
async function signMessage(privKeyHex, msg) {
  return bytesToHex(await ed.signAsync(new TextEncoder().encode(msg), hexToBytes(privKeyHex)));
}
\`\`\`

---

## HTML File Requirements

Generate a SINGLE .html file with these characteristics:

### Structure
- All CSS in a \`<style>\` tag in \`<head>\`
- Include \`<script src="${config.baseUrl}/v1/libs/aimeat-auth.js"></script>\` in \`<head>\`
- All app JS in a \`<script type="module">\` tag before \`</body>\`
- No other external dependencies needed — the auth library handles crypto
- Responsive design (works on mobile and desktop)

### Theme
- Dark theme (navy/slate palette): --bg: #0f172a, --card: #1e293b, --text: #e2e8f0, --accent: #38bdf8
- System fonts: system-ui for body, monospace for code/keys
- If user requested light theme: --bg: #f8fafc, --card: #ffffff, --text: #1e293b, --accent: #0284c7

### Auth UI (use the auth library)
- Use \`AIMEAT.auth.mountLoginButton('#auth-container')\` for the full login/register UI
- Or build custom UI using \`AIMEAT.auth.register()\` and \`AIMEAT.auth.login()\`
- The library handles key generation, JWT storage, and auto-refresh
- "⚠️ Save this key!" warning when showing generated keys (library handles this)
- Auto-login using localStorage on page load (library handles this)

### State Management
- The auth library manages localStorage automatically (GHII, GAII, keys, JWT)
- Use \`AIMEAT.auth.hasSession\` to check login state
- Use \`AIMEAT.auth.on('login', cb)\` / \`AIMEAT.auth.on('logout', cb)\` for reactive updates
- Loading spinners for API calls
- User-friendly error messages

### Security
- NEVER log or display private keys after initial save prompt
- Clear sensitive data from JS variables after use

### After Generating the HTML
Tell the user:
1. "Save this as a file, for example: my-aimeat-app.html"
2. "Open it in your web browser (Chrome, Firefox, Edge)"
3. "The first time, click the login button to register or sign in"
4. "After that, the app will remember your login automatically"
5. "You can also upload this app to the node: POST /v1/apps with the file"

### Browser APIs Available
The app runs in a browser — you can use Canvas, WebGL, Web Audio, WebRTC, Camera, Geolocation, LocalStorage, IndexedDB, Notifications, Drag&Drop, Clipboard, Speech, Fullscreen, Web Workers, CSS Animations, SVG, Gamepad API, Vibration, Share API. Use whatever is appropriate for the user's goal.`;
}

function buildMcpInstructions(config: AimeatConfig): string {
  return `## MCP Setup Instructions

Your AI platform supports the Model Context Protocol (MCP), which provides the richest integration with AIMEAT.

### Setup Steps

1. Open your AI platform's settings/connectors page
2. Add a new MCP server with this URL:
   \`${config.baseUrl}/v1/mcp\`
3. The platform will handle OAuth authentication automatically
4. Once connected, your AI has access to 14 AIMEAT tools:
   - \`aimeat_catalogue_search\` — Search available services
   - \`aimeat_memory_read\` / \`aimeat_memory_write\` — Read/write memory
   - \`aimeat_action_execute\` — Execute actions
   - \`aimeat_work_inbox\` / \`aimeat_work_accept\` / \`aimeat_work_deliver\` — Work queue
   - \`aimeat_wallet_balance\` — Check morsel balance
   - \`aimeat_board_read\` / \`aimeat_board_post\` — Boards
   - \`aimeat_storage_upload\` / \`aimeat_storage_download\` — File storage
   - And more

### Test It
After connecting, try saying: "Check my AIMEAT node catalogue" or "What services are available?"

### What You Get
- Full Tier 1 agent access
- Real-time SSE resource subscriptions
- Automatic token management
- All 14 MCP tools at your fingertips`;
}

function buildApiInstructions(config: AimeatConfig): string {
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

function buildBrowseInstructions(config: AimeatConfig): string {
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
   Dev Portal Translations
   ────────────────────────────────────────────────────────── */

function buildDevPortalTranslations(locale: Locale): Record<string, string> {
  return resolveFlat(locale, 'dev');
}

/* ──────────────────────────────────────────────────────────
   Portal HTML — Self-contained single page
   ────────────────────────────────────────────────────────── */

function portalHtml(config: AimeatConfig, nodeStats: { agents: number; actions: number; boards: number }, locale: Locale): string {
  const platformsJson = JSON.stringify(PLATFORMS);
  const devPortalTranslations = buildDevPortalTranslations(locale);
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="aimeat-node" content="${sanitize(config.baseUrl)}">
<title>${devPortalTranslations['dev.title']} — ${config.nodeId}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>var DT = ${JSON.stringify(devPortalTranslations)};<\/script>
<script src="${sanitize(config.baseUrl)}/v1/libs/aimeat-auth.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f0a14;--card:rgba(30,20,40,.85);--card2:rgba(60,30,60,.7);--text:#f0e6f6;--muted:#c4a6d0;--accent:#ff6b9d;--accent2:#c44569;--border:rgba(255,107,157,.25);--success:#22c55e;--warn:#f59e0b;--danger:#ef4444;--radius:12px;--love1:#ff6b9d;--love2:#c44569;--love3:#ff8a80;--love4:#f48fb1;--love5:#880e4f}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh;overflow-x:hidden}
a{color:var(--love1);text-decoration:none}
a:hover{text-decoration:underline;color:var(--love3)}

/* ── Background system ── */
.bg-layer{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;transition:opacity .8s ease}
.bg-layer.hidden{opacity:0}
body>.topbar,body>.container{position:relative;z-index:1}

/* BG 1: Floating Hearts */
.bg-hearts{background:radial-gradient(ellipse at 50% 0%,#2d1133 0%,#0f0a14 70%)}
.heart-particle{position:absolute;bottom:-60px;opacity:0;font-size:1.2rem;animation:floatUp linear infinite;filter:drop-shadow(0 0 6px rgba(255,107,157,.5))}
@keyframes floatUp{0%{transform:translateY(0) rotate(0deg) scale(1);opacity:0}10%{opacity:.7}90%{opacity:.7}100%{transform:translateY(-110vh) rotate(720deg) scale(.3);opacity:0}}

/* BG 2: Aurora Love */
.bg-aurora{background:#0f0a14}
.aurora-wave{position:absolute;width:200%;height:60%;left:-50%;border-radius:50%;filter:blur(80px);opacity:.35;animation:auroraShift 8s ease-in-out infinite alternate}
.aurora-wave:nth-child(1){top:10%;background:linear-gradient(90deg,#ff6b9d,#c44569,#ff8a80,#f48fb1);animation-duration:8s}
.aurora-wave:nth-child(2){top:30%;background:linear-gradient(90deg,#f48fb1,#880e4f,#ff6b9d,#e91e63);animation-duration:12s;animation-delay:-4s}
.aurora-wave:nth-child(3){top:55%;background:linear-gradient(90deg,#ad1457,#ff6b9d,#f06292,#880e4f);animation-duration:10s;animation-delay:-2s}
@keyframes auroraShift{0%{transform:translateX(-20%) scaleY(1)}50%{transform:translateX(10%) scaleY(1.3)}100%{transform:translateX(-10%) scaleY(.8)}}

/* BG 3: Sparkle Galaxy */
.bg-sparkle{background:radial-gradient(ellipse at 50% 50%,#1a0a24 0%,#0f0a14 100%)}
.sparkle{position:absolute;width:3px;height:3px;border-radius:50%;background:#fff;animation:sparkleAnim ease-in-out infinite}
@keyframes sparkleAnim{0%,100%{opacity:0;transform:scale(0)}50%{opacity:1;transform:scale(1);box-shadow:0 0 8px 2px var(--love1),0 0 20px 4px var(--love4)}}
.nebula-blob{position:absolute;border-radius:50%;filter:blur(100px);opacity:.2;animation:nebulaFloat 15s ease-in-out infinite alternate}
@keyframes nebulaFloat{0%{transform:translate(0,0) scale(1)}100%{transform:translate(40px,-30px) scale(1.2)}}

/* BG selector */
.bg-selector{position:fixed;bottom:1.5rem;right:1.5rem;z-index:200;display:flex;gap:.5rem;background:rgba(15,10,20,.8);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:30px;padding:.4rem .6rem}
.bg-btn{width:36px;height:36px;border-radius:50%;border:2px solid transparent;cursor:pointer;transition:all .25s;display:flex;align-items:center;justify-content:center;font-size:.9rem;background:var(--card2)}
.bg-btn:hover{border-color:var(--love1);transform:scale(1.15)}
.bg-btn.active{border-color:var(--love1);box-shadow:0 0 12px rgba(255,107,157,.5)}

/* Top bar */
.topbar{background:rgba(30,20,40,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:.6rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:.5rem;font-weight:700;font-size:1rem}
.topbar-right{display:flex;align-items:center;gap:.75rem}
#auth-container{display:inline-flex;align-items:center}
.mode-badge{font-size:.75rem;padding:.2rem .5rem;border-radius:4px;font-weight:600}
.mode-anon{background:#7c3aed;color:#fff}
.mode-user{background:var(--success);color:#0f172a}
.lang-toggle{display:flex;gap:2px;margin-right:.5rem}
.lang-btn{padding:4px 10px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:.75rem;font-weight:700;border-radius:4px;transition:all .2s}
.lang-btn:first-child{border-radius:4px 0 0 4px}
.lang-btn:last-child{border-radius:0 4px 4px 0}
.lang-btn.active{background:var(--love1);color:#fff;border-color:var(--love1)}
.lang-btn:hover{color:var(--text)}

.container{max-width:900px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:1.8rem;font-weight:700;margin-bottom:.5rem}
h2{font-size:1.3rem;font-weight:600;margin-bottom:.75rem;color:var(--love1)}
h3{font-size:1.1rem;font-weight:600;margin-bottom:.5rem}
p{margin-bottom:.75rem}
.subtitle{color:var(--muted);font-size:.95rem;margin-bottom:2rem}
.node-badge{display:inline-flex;align-items:center;gap:.5rem;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.4rem .8rem;font-size:.85rem;font-family:monospace;margin-bottom:1.5rem}
.node-badge .dot{width:8px;height:8px;border-radius:50%;background:var(--success);display:inline-block}
.stats{display:flex;gap:1rem;margin-bottom:2rem;flex-wrap:wrap}
.stat{background:var(--card);border-radius:var(--radius);padding:.75rem 1rem;flex:1;min-width:120px;text-align:center}
.stat .num{font-size:1.5rem;font-weight:700;color:var(--love1)}
.stat .label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}

/* Steps */
.step{margin-bottom:2rem}
.step-header{display:flex;align-items:center;gap:.75rem;margin-bottom:1rem}
.step-num{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0;box-shadow:0 0 12px rgba(255,107,157,.3)}
.step-num.done{background:linear-gradient(135deg,var(--success),#16a34a)}
.step-label{font-size:1.1rem;font-weight:600}

/* Platform grid */
.platforms{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.75rem;margin-bottom:1rem}
.platform-card{background:var(--card);border:2px solid transparent;border-radius:var(--radius);padding:1rem;text-align:center;cursor:pointer;transition:all .15s}
.platform-card:hover{border-color:var(--love1);transform:translateY(-2px);box-shadow:0 4px 20px rgba(255,107,157,.15)}
.platform-card.selected{border-color:var(--love1);background:var(--card2);box-shadow:0 0 20px rgba(255,107,157,.2)}
.platform-card .name{font-weight:600;font-size:.9rem}
.platform-card .vendor{color:var(--muted);font-size:.75rem}

/* Variants */
.variants{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem}
.variant-btn{background:var(--card);border:2px solid var(--border);border-radius:8px;padding:.4rem .8rem;cursor:pointer;color:var(--text);font-size:.85rem;transition:all .15s}
.variant-btn:hover{border-color:var(--love1)}
.variant-btn.selected{border-color:var(--love1);background:var(--card2)}
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
.copy-btn{position:absolute;top:.5rem;right:.5rem;background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:6px;padding:.4rem .8rem;cursor:pointer;font-weight:600;font-size:.8rem;z-index:1;transition:all .2s}
.copy-btn:hover{background:linear-gradient(135deg,var(--love3),var(--love1));box-shadow:0 0 12px rgba(255,107,157,.4)}
.copy-btn.copied{background:var(--success)}

/* Goal selector */
.goals{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.5rem;margin-bottom:1rem}

/* Capability tabs */
.cap-tabs{display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border)}
.cap-tab{flex:1;padding:.75rem 1rem;text-align:center;cursor:pointer;background:transparent;border:none;color:var(--muted);font-size:.9rem;font-weight:600;transition:all .2s;border-bottom:3px solid transparent;margin-bottom:-2px;position:relative}
.cap-tab:hover{color:var(--text);background:rgba(255,107,157,.05)}
.cap-tab.active{color:var(--love1);border-bottom-color:var(--love1);background:rgba(255,107,157,.08)}
.cap-tab.recommended{color:var(--success)}
.cap-tab.recommended.active{color:var(--success);border-bottom-color:var(--success)}
.cap-tab .tab-icon{font-size:1.2rem;display:block;margin-bottom:.15rem}
.cap-tab .tab-label{font-size:.8rem;display:block}
.cap-tab .tab-rec{position:absolute;top:2px;right:6px;font-size:.55rem;background:var(--success);color:#fff;padding:1px 5px;border-radius:8px;text-transform:uppercase;letter-spacing:.05em}
.cap-tab.unavail{opacity:.45;cursor:default}
.cap-tab.unavail:hover{background:transparent;color:var(--muted)}
.cap-panel{display:none}
.cap-panel.active{display:block}
.unavail-notice{text-align:center;padding:2rem 1rem;color:var(--muted);font-size:.9rem}
.unavail-notice .unavail-icon{font-size:2rem;margin-bottom:.5rem}
.goal-card{background:var(--card);border:2px solid var(--border);border-radius:8px;padding:.75rem;cursor:pointer;transition:all .15s;font-size:.85rem}
.goal-card:hover{border-color:var(--love1)}
.goal-card.selected{border-color:var(--love1);background:var(--card2)}
.goal-card .goal-icon{font-size:1.3rem;margin-bottom:.25rem}

/* Instructions */
.instructions{background:var(--card);border-radius:var(--radius);padding:1.5rem;border:1px solid var(--border)}
.instructions ol{margin-left:1.5rem;margin-bottom:.75rem}
.instructions li{margin-bottom:.5rem}
.instructions code{background:var(--bg);padding:.15rem .4rem;border-radius:4px;font-size:.85rem;font-family:monospace}

/* Upload area */
.upload-area{border:2px dashed var(--border);border-radius:var(--radius);padding:1.5rem;text-align:center;margin-top:1rem;transition:all .2s}
.upload-area:hover{border-color:var(--love1)}
.upload-area.dragover{border-color:var(--love1);background:rgba(255,107,157,.05)}
.upload-btn{background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:8px;padding:.5rem 1.2rem;cursor:pointer;font-weight:600;font-size:.9rem;transition:all .2s}
.upload-btn:hover{background:linear-gradient(135deg,var(--love3),var(--love1));box-shadow:0 0 16px rgba(255,107,157,.4)}
.upload-btn:disabled{opacity:.5;cursor:not-allowed}
.share-url{display:flex;align-items:center;gap:.5rem;background:var(--bg);border:1px solid var(--success);border-radius:8px;padding:.6rem 1rem;margin-top:.75rem;font-family:monospace;font-size:.85rem}
.share-url input{flex:1;background:none;border:none;color:var(--text);font-family:monospace;font-size:.85rem;outline:none}
.share-copy{background:var(--success);color:#0f172a;border:none;border-radius:6px;padding:.3rem .6rem;cursor:pointer;font-weight:600;font-size:.8rem}

/* Mode notice */
.mode-notice{border-radius:var(--radius);padding:1rem 1.5rem;margin-bottom:1.5rem;font-size:.9rem;display:flex;align-items:flex-start;gap:.75rem}
.mode-notice-anon{background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3)}
.mode-notice-user{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2)}
.mode-notice .icon{font-size:1.3rem;flex-shrink:0}

/* app list */
.app-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.75rem;margin-top:1rem}
.app-item{background:var(--card2);border-radius:8px;padding:1rem;border:1px solid var(--border)}
.app-item .app-name{font-weight:600;margin-bottom:.25rem}
.app-item .app-meta{font-size:.75rem;color:var(--muted)}
.app-item a{display:inline-block;margin-top:.5rem;font-size:.85rem}

/* Hidden */
.hidden{display:none!important}

@media(max-width:600px){
  .platforms{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
  .goals{grid-template-columns:1fr}
  .stats{flex-direction:column}
  h1{font-size:1.4rem}
  .topbar{flex-direction:column;gap:.5rem;text-align:center}
}
</style>
</head>
<body>

<!-- Animated backgrounds -->
<div class="bg-layer bg-hearts hidden" id="bg-hearts"></div>
<div class="bg-layer bg-aurora hidden" id="bg-aurora">
  <div class="aurora-wave"></div>
  <div class="aurora-wave"></div>
  <div class="aurora-wave"></div>
</div>
<div class="bg-layer bg-sparkle" id="bg-sparkle"></div>

<!-- Background selector -->
<div class="bg-selector">
  <button class="bg-btn" onclick="switchBg(1)" title="Floating Hearts">💕</button>
  <button class="bg-btn" onclick="switchBg(2)" title="Aurora Love">🌌</button>
  <button class="bg-btn active" onclick="switchBg(3)" title="Sparkle Galaxy">✨</button>
</div>

<!-- Top bar with auth -->
<div class="topbar">
  <div class="topbar-left">💖 AIMEAT</div>
  <div class="topbar-right">
    <div class="lang-toggle">
      <button class="lang-btn ${locale === 'fi' ? 'active' : ''}" onclick="switchLang('fi')">FI</button>
      <button class="lang-btn ${locale === 'en' ? 'active' : ''}" onclick="switchLang('en')">EN</button>
    </div>
    <a href="/v1/profile" style="font-size:.85rem;color:var(--love4);margin-right:.5rem">\ud83d\udc64 ${devPortalTranslations['dev.profile']}</a>
    <div id="auth-container"></div>
  </div>
</div>

<div class="container">
  <h1>💖 ${devPortalTranslations['dev.title']}</h1>
  <p class="subtitle" style="color:var(--love4)">${devPortalTranslations['dev.subtitle']}</p>
  <div class="node-badge"><span class="dot"></span> ${sanitize(config.nodeId)} &mdash; ${sanitize(config.baseUrl)}</div>

  <div class="stats">
    <div class="stat"><div class="num">${nodeStats.agents}</div><div class="label">${devPortalTranslations['dev.stats.agents']}</div></div>
    <div class="stat"><div class="num">${nodeStats.actions}</div><div class="label">${devPortalTranslations['dev.stats.services']}</div></div>
    <div class="stat"><div class="num">${nodeStats.boards}</div><div class="label">${devPortalTranslations['dev.stats.boards']}</div></div>
  </div>

  <!-- Mode notice — changes based on login state -->
  <div id="mode-notice"></div>

  <!-- Quick start: give this URL to your AI -->
  <div class="panel" style="border-color:var(--love1);background:linear-gradient(135deg,rgba(30,20,40,.9) 0%,rgba(60,10,40,.8) 100%)">
    <h3 style="margin-bottom:.5rem">🚀 ${devPortalTranslations['dev.quickStart.title']}</h3>
    <p style="margin-bottom:.5rem">${devPortalTranslations['dev.quickStart.desc']}</p>
    <div class="prompt-output" style="margin-bottom:0">
      <button class="copy-btn" onclick="copyPrompt(this)">${devPortalTranslations['dev.quickStart.copy']}</button>
      <div class="prompt-text" style="max-height:none;font-size:.85rem">Read this URL and follow the instructions to connect to this AIMEAT node: ${sanitize(config.baseUrl)}/?format=json</div>
    </div>
    <p style="margin-top:.75rem;font-size:.8rem;color:var(--muted)">${devPortalTranslations['dev.quickStart.note']}<br>${devPortalTranslations['dev.quickStart.fallback']}</p>
  </div>

  <!-- Step 1: Platform -->
  <div class="step" id="step1">
    <div class="step-header">
      <div class="step-num" id="step1-num">1</div>
      <div class="step-label">${devPortalTranslations['dev.step1.label']}</div>
    </div>
    <div class="platforms" id="platform-grid"></div>
  </div>

  <!-- Step 2: Variant -->
  <div class="step hidden" id="step2">
    <div class="step-header">
      <div class="step-num" id="step2-num">2</div>
      <div class="step-label">${devPortalTranslations['dev.step2.label']}</div>
    </div>
    <div class="variants" id="variant-list"></div>
    <div class="variant-note hidden" id="variant-note"></div>
  </div>

  <!-- Step 3: Result -->
  <div class="step hidden" id="step3">
    <div class="step-header">
      <div class="step-num">3</div>
      <div class="step-label">${devPortalTranslations['dev.step3.label']}</div>
    </div>
    <div id="result-area"></div>
  </div>

  <!-- Step 4: After generating — share/upload (logged-in only) -->
  <div class="step hidden" id="step4">
    <div class="step-header">
      <div class="step-num">4</div>
      <div class="step-label">${devPortalTranslations['dev.step4.label']}</div>
    </div>
    <div id="share-area"></div>
  </div>

  <!-- Community apps section -->
  <div id="community-apps" class="hidden" style="margin-top:2rem">
    <h2>📦 ${devPortalTranslations['dev.community.title']}</h2>
    <p style="color:var(--muted);font-size:.9rem">${devPortalTranslations['dev.community.desc']}</p>
    <div class="app-list" id="app-list"></div>
  </div>
</div>

<script>
const PLATFORMS = ${platformsJson};
const NODE_URL = ${JSON.stringify(config.baseUrl)};
const NODE_ID = ${JSON.stringify(config.nodeId)};
const PROMPT_API = NODE_URL + '/v1/portal/prompt';

function dt(key) { return DT[key] || key; }

function switchLang(lang) {
  var url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  localStorage.setItem('aimeat_locale', lang);
  window.location.href = url.toString();
}
// Auto-detect stored locale preference
(function() {
  var stored = localStorage.getItem('aimeat_locale');
  if (stored && !new URL(window.location.href).searchParams.has('lang')) {
    var url = new URL(window.location.href);
    url.searchParams.set('lang', stored);
    window.location.replace(url.toString());
  }
})();

let selectedPlatform = null;
let selectedVariant = null;
let currentSession = null;

// ── Auth setup ──
const auth = window.AIMEAT && window.AIMEAT.auth;
if (auth) {
  auth.mountLoginButton('#auth-container', {
    onLogin: function(session) { currentSession = session; updateMode(); },
    onLogout: function() { currentSession = null; updateMode(); },
  });
  // Auto-login
  auth.login().then(function(session) {
    if (session) { currentSession = session; updateMode(); }
    else { updateMode(); }
  }).catch(function() { updateMode(); });
} else {
  updateMode();
}

function isLoggedIn() { return !!currentSession; }

function updateMode() {
  const notice = document.getElementById('mode-notice');

  if (isLoggedIn()) {
    notice.innerHTML = '<div class="mode-notice mode-notice-user">'
      + '<div class="icon">✅</div>'
      + '<div><strong>' + dt('dev.mode.loggedIn') + ' ' + escHtml(currentSession.ghii || currentSession.owner) + '</strong><br>'
      + '<span style="color:var(--muted);font-size:.85rem">' + dt('dev.mode.loggedInDesc') + '</span></div>'
      + '</div>';
  } else {
    notice.innerHTML = '<div class="mode-notice mode-notice-anon">'
      + '<div class="icon">👤</div>'
      + '<div><strong>' + dt('dev.mode.anonymous') + '</strong> — ' + dt('dev.mode.anonymousDesc') + '<br>'
      + '<span style="color:var(--muted);font-size:.85rem">' + dt('dev.mode.anonymousNote') + ' '
      + '<strong>' + dt('dev.mode.signUp') + '</strong> ' + dt('dev.mode.signUpNote') + '</span></div>'
      + '</div>';
  }

  // Show/hide step 4
  updateStep4();
  // Load community apps
  loadCommunityApps();
}

// ── Render platform grid ──
const grid = document.getElementById('platform-grid');
PLATFORMS.forEach(function(p) {
  const card = document.createElement('div');
  card.className = 'platform-card';
  card.innerHTML = '<div class="name">' + escHtml(p.name) + '</div><div class="vendor">' + escHtml(p.vendor) + '</div>';
  card.addEventListener('click', function() { selectPlatform(p); });
  grid.appendChild(card);
});

function selectPlatform(p) {
  selectedPlatform = p;
  selectedVariant = null;
  document.querySelectorAll('.platform-card').forEach(function(c, i) {
    c.classList.toggle('selected', PLATFORMS[i].id === p.id);
  });
  document.getElementById('step1-num').textContent = '\\u2713';
  document.getElementById('step1-num').classList.add('done');
  if (p.variants.length === 1) {
    showStep2(p);
    selectVariant(p.variants[0]);
    return;
  }
  showStep2(p);
  document.getElementById('step3').classList.add('hidden');
  document.getElementById('step4').classList.add('hidden');
}

function showStep2(p) {
  var s2 = document.getElementById('step2');
  s2.classList.remove('hidden');
  var list = document.getElementById('variant-list');
  list.innerHTML = '';
  p.variants.forEach(function(v) {
    var btn = document.createElement('button');
    btn.className = 'variant-btn';
    btn.textContent = v.name;
    btn.addEventListener('click', function() { selectVariant(v); });
    list.appendChild(btn);
  });
}

function selectVariant(v) {
  selectedVariant = v;
  document.querySelectorAll('.variant-btn').forEach(function(b) {
    b.classList.toggle('selected', b.textContent === v.name);
  });
  var note = document.getElementById('variant-note');
  if (v.notes) { note.textContent = dt('dev.platformNotes.' + v.notes); note.classList.remove('hidden'); }
  else { note.classList.add('hidden'); }
  document.getElementById('step2-num').textContent = '\\u2713';
  document.getElementById('step2-num').classList.add('done');
  showResult(v);
}

function showResult(v) {
  var area = document.getElementById('result-area');
  var s3 = document.getElementById('step3');
  s3.classList.remove('hidden');

  // Determine which capabilities are available for this variant
  var hasApps = true; // Always available
  var hasMcp = (v.path === 'mcp');
  var hasApi = (v.path === 'api' || v.path === 'browse' || v.path === 'mcp');

  // Build tabbed interface — Apps always first and selected
  var html = '<div class="cap-tabs">';
  html += '<button class="cap-tab active" data-tab="apps" onclick="switchTab(\\'apps\\')">'
    + '<span class="tab-icon">\\ud83d\\udda5\\ufe0f</span>'
    + '<span class="tab-label">' + dt('dev.tabs.apps') + '</span></button>';
  html += '<button class="cap-tab' + (hasMcp ? '' : ' unavail') + '" data-tab="mcp" onclick="' + (hasMcp ? 'switchTab(\\'mcp\\')' : '') + '">'
    + (hasMcp ? '<span class="tab-rec">\\u2713</span>' : '')
    + '<span class="tab-icon">\\ud83d\\udd0c</span>'
    + '<span class="tab-label">' + dt('dev.tabs.mcp') + '</span></button>';
  html += '<button class="cap-tab' + (hasApi ? '' : ' unavail') + '" data-tab="api" onclick="' + (hasApi ? 'switchTab(\\'api\\')' : '') + '">'
    + '<span class="tab-icon">\\ud83d\\udce1</span>'
    + '<span class="tab-label">' + dt('dev.tabs.api') + '</span></button>';
  html += '</div>';

  // Apps panel (always shown first)
  html += '<div class="cap-panel active" id="tab-apps">' + promptPackagePanel() + '</div>';

  // MCP panel
  html += '<div class="cap-panel" id="tab-mcp">';
  if (hasMcp) { html += mcpPanel(); }
  else { html += '<div class="unavail-notice"><div class="unavail-icon">\\ud83d\\udd12</div><p>' + dt('dev.tabs.unavailable') + '</p><p style="font-size:.8rem;margin-top:.5rem">' + dt('dev.tabs.upgradeForMcp') + '</p></div>'; }
  html += '</div>';

  // API panel
  html += '<div class="cap-panel" id="tab-api">';
  if (hasApi && v.path === 'browse') { html += browsePanel(); }
  else if (hasApi) { html += apiPanel(); }
  else { html += '<div class="unavail-notice"><div class="unavail-icon">\\ud83d\\udd12</div><p>' + dt('dev.tabs.unavailable') + '</p><p style="font-size:.8rem;margin-top:.5rem">' + dt('dev.tabs.upgradeForApi') + '</p></div>'; }
  html += '</div>';

  area.innerHTML = html;
  updateStep4();
  s3.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function switchTab(tabId) {
  document.querySelectorAll('.cap-tab').forEach(function(t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.cap-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'tab-' + tabId);
  });
  // Update step4 visibility based on active tab
  updateStep4();
}

// ── Panels ──

function mcpPanel() {
  return '<div class="panel">'
    + '<h3>' + dt('dev.panel.mcpBadge') + '</h3>'
    + '<div class="instructions"><ol>'
    + '<li>' + dt('dev.panel.mcpStep1') + '</li>'
    + '<li>' + dt('dev.panel.mcpStep2') + '<br><code>' + escHtml(NODE_URL) + '/v1/mcp</code></li>'
    + '<li>' + dt('dev.panel.mcpStep3') + '</li>'
    + '<li>' + dt('dev.panel.mcpStep4') + '</li>'
    + '</ol>'
    + '<p>' + dt('dev.panel.mcpTools') + '</p>'
    + '</div></div>';
}

function apiPanel() {
  return '<div class="panel">'
    + '<h3>' + dt('dev.panel.apiBadge') + '</h3>'
    + '<p>' + dt('dev.panel.apiDesc') + '</p>'
    + '<div class="prompt-output">'
    + '<button class="copy-btn" onclick="copyPrompt(this)">' + dt('dev.copy') + '</button>'
    + '<div class="prompt-text" id="api-prompt">I want you to connect to an AIMEAT node at ' + escHtml(NODE_URL) + '\\n\\n'
    + 'Step 1: Register an owner account\\n'
    + 'POST ' + escHtml(NODE_URL) + '/v1/owners\\n'
    + 'Body: {"name": "myowner", "display_name": "My Name"}\\n'
    + 'SAVE the owner_key from the response!\\n\\n'
    + 'Step 2: Register an agent\\n'
    + 'POST ' + escHtml(NODE_URL) + '/v1/agents\\n'
    + 'Header: X-AIMEAT-Owner-Key: (owner_key from step 1)\\n'
    + 'Body: {"name": "myagent", "owner": "myowner", "display_name": "My Agent", "description": "My first AIMEAT agent"}\\n'
    + 'SAVE the private_key!\\n\\n'
    + 'Step 3: Authenticate \\u2014 sign (gaii+timestamp) with Ed25519, POST to /v1/auth/token\\n\\n'
    + 'Step 4: Use the API \\u2014 GET /v1/catalogue, POST /v1/memory, GET /v1/wallet\\n\\n'
    + 'Full API spec: ' + escHtml(NODE_URL) + '/v1/spec\\n'
    + 'Operating instructions: ' + escHtml(NODE_URL) + '/v1/prompts/tier1'
    + '</div></div></div>';
}

function browsePanel() {
  return '<div class="panel">'
    + '<h3>' + dt('dev.panel.browseBadge') + '</h3>'
    + '<p>' + dt('dev.panel.browseDesc') + '</p>'
    + '<div class="prompt-output">'
    + '<button class="copy-btn" onclick="copyPrompt(this)">' + dt('dev.copy') + '</button>'
    + '<div class="prompt-text" id="browse-prompt">Browse these AIMEAT endpoints and tell me what\\'s available:\\n\\n'
    + 'Catalogue: ' + escHtml(NODE_URL) + '/v1/catalogue\\n'
    + 'Node info: ' + escHtml(NODE_URL) + '/\\n'
    + 'Discovery: ' + escHtml(NODE_URL) + '/.well-known/aimeat\\n\\n'
    + 'You can also browse specific boards and agent profiles once you find them in the catalogue.'
    + '</div></div>'
    + '<h3 style="margin-top:1rem">' + dt('dev.panel.browseUpgradeTitle') + '</h3>'
    + '<ul style="margin-left:1.5rem"><li>' + dt('dev.panel.browseUpgrade1') + '</li>'
    + '<li>' + dt('dev.panel.browseUpgrade2') + '</li>'
    + '<li>' + dt('dev.panel.browseUpgrade3') + '</li></ul></div>';
}

function promptPackagePanel() {
  return '<div class="panel">'
    + '<h3>' + dt('dev.panel.promptBadge') + '</h3>'
    + '<p>' + dt('dev.panel.promptDesc') + '</p>'
    + (isLoggedIn()
      ? '<p style="color:var(--success);font-size:.85rem">\\u2705 ' + dt('dev.panel.promptLoggedIn') + '</p>'
      : '<p style="color:var(--muted);font-size:.85rem">\\ud83d\\udc64 ' + dt('dev.panel.promptAnon') + ' <a href="#" onclick="document.getElementById(\\'auth-container\\').querySelector(\\'button\\')?.click();return false">' + dt('dev.panel.promptSignUp') + '</a> ' + dt('dev.panel.promptSignUpNote') + '</p>')
    + '<div class="goals" id="goal-grid"></div>'
    + '<div class="prompt-output hidden" id="prompt-pkg-output">'
    + '<button class="copy-btn" onclick="copyPrompt(this)">' + dt('dev.copy') + '</button>'
    + '<div class="prompt-text" id="prompt-pkg-text">' + dt('dev.panel.loading') + '</div>'
    + '</div></div>';
}

// ── Step 4: Upload & Share (logged-in) or manual share (anon) ──
function updateStep4() {
  var step4 = document.getElementById('step4');
  var shareArea = document.getElementById('share-area');
  if (!selectedVariant) { step4.classList.add('hidden'); return; }

  // Show upload when Apps tab is active (apps generate HTML files)
  var appsTab = document.getElementById('tab-apps');
  var appsActive = appsTab && appsTab.classList.contains('active');
  if (!appsActive) { step4.classList.add('hidden'); return; }

  step4.classList.remove('hidden');

  if (isLoggedIn()) {
    shareArea.innerHTML = '<div class="panel">'
      + '<h3>\\ud83d\\udce4 ' + dt('dev.upload') + '</h3>'
      + '<p>' + dt('dev.uploadSection.desc') + '</p>'
      + '<div style="margin-bottom:1rem">'
      + '<label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.4rem">' + dt('dev.uploadSection.accessCodeLabel') + '</label>'
      + '<input type="text" id="access-code-input" placeholder="' + dt('dev.uploadSection.accessCodePlaceholder') + '" '
      + 'style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.4rem .6rem;color:var(--text);font-size:.85rem;width:100%;max-width:300px" maxlength="64">'
      + '<p style="font-size:.75rem;color:var(--muted);margin-top:.25rem">' + dt('dev.uploadSection.accessCodeNote') + '</p>'
      + '</div>'
      + '<div class="upload-area" id="upload-drop">'
      + '<p style="margin-bottom:.5rem">' + dt('dev.uploadSection.dragDrop') + '</p>'
      + '<input type="file" id="upload-input" accept=".html,.htm" style="display:none">'
      + '<button class="upload-btn" onclick="document.getElementById(\\'upload-input\\').click()">' + dt('dev.uploadSection.chooseFile') + '</button>'
      + '</div>'
      + '<div id="upload-result" class="hidden"></div>'
      + '</div>';
    setupUploadHandlers();
  } else {
    shareArea.innerHTML = '<div class="panel">'
      + '<h3>\\ud83d\\udccc ' + dt('dev.uploadSection.shareTitle') + '</h3>'
      + '<p>' + dt('dev.uploadSection.shareDesc') + '</p>'
      + '<ol style="margin-left:1.5rem;margin-bottom:1rem">'
      + '<li>' + dt('dev.uploadSection.shareStep1') + '</li>'
      + '<li>' + dt('dev.uploadSection.shareStep2') + '</li>'
      + '<li>' + dt('dev.uploadSection.shareStep3') + '</li>'
      + '</ol>'
      + '<div class="mode-notice mode-notice-anon" style="margin:0">'
      + '<div class="icon">\\ud83d\\udca1</div>'
      + '<div><strong>' + dt('dev.uploadSection.wantEasier') + '</strong> <a href="#" onclick="document.getElementById(\\'auth-container\\').querySelector(\\'button\\')?.click();return false">' + dt('dev.uploadSection.createAccount') + '</a> ' + dt('dev.uploadSection.downloadLinkNote') + '<br>'
      + '<code style="font-size:.8rem;color:var(--accent)">' + escHtml(NODE_URL) + '/v1/apps/yourname/my-app.html</code></div>'
      + '</div>'
      + '</div>';
  }
}

// ── Upload handlers ──
function setupUploadHandlers() {
  var dropZone = document.getElementById('upload-drop');
  var input = document.getElementById('upload-input');
  if (!dropZone || !input) return;

  dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', function() { if (input.files.length > 0) handleUpload(input.files[0]); });
}

async function handleUpload(file) {
  if (!currentSession) { alert(dt('dev.status.signInFirst')); return; }
  var result = document.getElementById('upload-result');
  result.classList.remove('hidden');
  result.innerHTML = '<p style="color:var(--muted)">' + dt('dev.uploading') + ' ' + escHtml(file.name) + '</p>';

  try {
    var arrayBuf = await file.arrayBuffer();
    var bytes = new Uint8Array(arrayBuf);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    var b64 = btoa(binary);

    var accessCode = (document.getElementById('access-code-input') || {}).value || '';

    var resp = await currentSession.fetch('/v1/apps', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, content: b64, mime_type: 'text/html', access_code: accessCode || undefined }),
    });

    if (resp.ok !== undefined ? resp.ok : true) {
      var data = resp.data || resp;
      var downloadUrl = NODE_URL + (data.download_url || '/v1/apps/' + encodeURIComponent(currentSession.owner) + '/' + encodeURIComponent(file.name));
      var isProtected = data.protected;
      result.innerHTML = '<div style="color:var(--success);font-weight:600;margin-bottom:.5rem">\\u2705 ' + dt('dev.uploaded') + (isProtected ? ' \\ud83d\\udd12 ' + dt('dev.uploadSection.protected') : '') + '</div>'
        + '<p>' + dt('dev.shareLink') + ':</p>'
        + '<div class="share-url">'
        + '<input type="text" value="' + escAttr(downloadUrl) + '" readonly id="share-url-input">'
        + '<button class="share-copy" onclick="copyShareUrl()">' + dt('dev.copy') + '</button>'
        + '</div>'
        + '<div style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)">'
        + '<label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.4rem">\\ud83d\\udd11 ' + dt('dev.uploadSection.changeCode') + '</label>'
        + '<div style="display:flex;gap:.4rem;align-items:center">'
        + '<input type="text" id="new-access-code" placeholder="' + (isProtected ? dt('dev.uploadSection.newCodePlaceholder') : dt('dev.uploadSection.setCodePlaceholder')) + '" '
        + 'style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.4rem .6rem;color:var(--text);font-size:.85rem;flex:1;max-width:250px" maxlength="64">'
        + '<button class="upload-btn" style="padding:.4rem .8rem;font-size:.8rem" onclick="updateAccessCode(\\'' + escAttr(file.name) + '\\')">' + dt('dev.uploadSection.updateBtn') + '</button>'
        + '</div>'
        + '<div id="code-update-result" style="font-size:.8rem;margin-top:.35rem"></div>'
        + '</div>'
        + '<p style="font-size:.8rem;color:var(--muted);margin-top:.5rem">' + dt('dev.uploadSection.fileSize') + formatBytes(file.size) + '</p>';
    } else {
      result.innerHTML = '<p style="color:var(--danger)">' + dt('dev.uploadFailed') + ': ' + escHtml(resp.error?.message || 'Unknown error') + '</p>';
    }
  } catch (e) {
    result.innerHTML = '<p style="color:var(--danger)">' + dt('dev.uploadFailed') + ': ' + escHtml(e.message) + '</p>';
  }
}

function copyShareUrl() {
  var input = document.getElementById('share-url-input');
  navigator.clipboard.writeText(input.value).then(function() {
    var btn = input.parentElement.querySelector('.share-copy');
    btn.textContent = dt('dev.copied');
    setTimeout(function() { btn.textContent = dt('dev.copy'); }, 2000);
  });
}

async function updateAccessCode(filename) {
  if (!currentSession) { alert(dt('dev.status.signInFirst')); return; }
  var codeInput = document.getElementById('new-access-code');
  var resultEl = document.getElementById('code-update-result');
  var newCode = codeInput ? codeInput.value.trim() : '';
  resultEl.innerHTML = '<span style="color:var(--muted)">' + dt('dev.status.updating') + '</span>';
  try {
    var resp = await currentSession.fetch('/v1/apps/' + encodeURIComponent(filename), {
      method: 'PATCH',
      body: JSON.stringify({ access_code: newCode || null }),
    });
    if (resp.ok !== undefined ? resp.ok : true) {
      var d = resp.data || resp;
      resultEl.innerHTML = d.protected
        ? '<span style="color:var(--success)">\\u2705 ' + dt('dev.status.codeUpdated') + '</span>'
        : '<span style="color:var(--success)">\\u2705 ' + dt('dev.status.codeRemoved') + '</span>';
    } else {
      resultEl.innerHTML = '<span style="color:var(--danger)">' + escHtml(resp.error?.message || 'Failed') + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
  }
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// ── Community apps ──
async function loadCommunityApps() {
  try {
    var resp = await fetch(NODE_URL + '/v1/apps');
    var data = await resp.json();
    if (data.ok && data.data.apps && data.data.apps.length > 0) {
      var section = document.getElementById('community-apps');
      section.classList.remove('hidden');
      var list = document.getElementById('app-list');
      list.innerHTML = '';
      data.data.apps.forEach(function(app) {
        var item = document.createElement('div');
        item.className = 'app-item';
        var badge = app.protected ? ' <span style="color:var(--warn);font-size:.75rem">\\ud83d\\udd12 ' + dt('dev.appList.protected') + '</span>' : '';
        item.innerHTML = '<div class="app-name">' + escHtml(app.filename) + badge + '</div>'
          + '<div class="app-meta">' + dt('dev.appList.by') + escHtml(app.owner) + ' \\u00b7 ' + formatBytes(app.size) + '</div>';
        if (app.protected) {
          var codeId = 'dlcode-' + app.owner + '-' + app.filename;
          item.innerHTML += '<div style="margin-top:.5rem">'
            + '<input type="text" placeholder="' + dt('dev.appList.accessCode') + '" id="' + escAttr(codeId) + '" '
            + 'style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.25rem .4rem;color:var(--text);font-size:.8rem;width:120px;margin-right:.4rem">'
            + '<a href="#" onclick="downloadProtected(\\'' + escAttr(app.download_url) + '\\',\\'' + escAttr(codeId) + '\\');return false" style="font-size:.85rem">\\u2b07 ' + dt('dev.download') + '</a>'
            + '</div>';
        } else {
          item.innerHTML += '<a href="' + escAttr(NODE_URL + app.download_url) + '" download style="display:inline-block;margin-top:.5rem;font-size:.85rem">\\u2b07 ' + dt('dev.download') + '</a>';
        }
        // Owner controls: change access code
        if (isLoggedIn() && currentSession.owner === app.owner) {
          var manageId = 'manage-' + app.owner + '-' + app.filename;
          item.innerHTML += '<div style="margin-top:.5rem;padding-top:.5rem;border-top:1px solid var(--border)">'
            + '<div style="display:flex;gap:.3rem;align-items:center">'
            + '<input type="text" id="' + escAttr(manageId) + '" placeholder="' + (app.protected ? dt('dev.appList.newCodePlaceholder') : dt('dev.appList.setCodePlaceholder')) + '" '
            + 'style="background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:.2rem .4rem;color:var(--text);font-size:.8rem;width:140px">'
            + '<button style="background:var(--accent);color:var(--bg);border:none;border-radius:4px;padding:.2rem .5rem;cursor:pointer;font-size:.75rem;font-weight:600" '
            + 'onclick="updateAppCode(\\'' + escAttr(app.filename) + '\\',\\'' + escAttr(manageId) + '\\')">\\ud83d\\udd11</button>'
            + '</div>'
            + '<div id="' + escAttr(manageId) + '-result" style="font-size:.75rem;margin-top:.2rem"></div>'
            + '</div>';
        }
        list.appendChild(item);
      });
    }
  } catch (e) { /* silent */ }
}

function downloadProtected(downloadPath, codeInputId) {
  var codeInput = document.getElementById(codeInputId);
  var code = codeInput ? codeInput.value.trim() : '';
  if (!code) { alert(dt('dev.appList.enterCode')); return; }
  var url = NODE_URL + downloadPath + '?code=' + encodeURIComponent(code);
  var a = document.createElement('a');
  a.href = url; a.download = ''; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

async function updateAppCode(filename, inputId) {
  if (!currentSession) return;
  var input = document.getElementById(inputId);
  var resultEl = document.getElementById(inputId + '-result');
  var newCode = input ? input.value.trim() : '';
  resultEl.innerHTML = '<span style="color:var(--muted)">' + dt('dev.status.updating') + '</span>';
  try {
    var resp = await currentSession.fetch('/v1/apps/' + encodeURIComponent(filename), {
      method: 'PATCH',
      body: JSON.stringify({ access_code: newCode || null }),
    });
    if (resp.ok !== undefined ? resp.ok : true) {
      var d = resp.data || resp;
      resultEl.innerHTML = d.protected
        ? '<span style="color:var(--success)">\\u2705 ' + dt('dev.status.codeUpdatedShort') + '</span>'
        : '<span style="color:var(--success)">\\u2705 ' + dt('dev.status.codeRemovedShort') + '</span>';
      loadCommunityApps();
    } else {
      resultEl.innerHTML = '<span style="color:var(--danger)">' + escHtml(resp.error?.message || 'Failed') + '</span>';
    }
  } catch (e) {
    resultEl.innerHTML = '<span style="color:var(--danger)">' + escHtml(e.message) + '</span>';
  }
}

// ── Goal selection (for prompt package) ──
var GOALS = [
  { id: 'dashboard', icon: '\\ud83d\\udccb', label: dt('dev.goals.dashboard') },
  { id: 'notes', icon: '\\ud83d\\udcdd', label: dt('dev.goals.notes') },
  { id: 'game', icon: '\\ud83c\\udfae', label: dt('dev.goals.game') },
  { id: 'news', icon: '\\ud83d\\udcf0', label: dt('dev.goals.news') },
  { id: 'marketplace', icon: '\\ud83d\\uded2', label: dt('dev.goals.marketplace') },
  { id: 'chat', icon: '\\ud83d\\udcac', label: dt('dev.goals.chat') },
  { id: 'iot', icon: '\\ud83d\\udcca', label: dt('dev.goals.iot') },
  { id: 'custom', icon: '\\ud83d\\udd27', label: dt('dev.goals.custom') },
];

var observer = new MutationObserver(function() {
  var goalGrid = document.getElementById('goal-grid');
  if (goalGrid && goalGrid.children.length === 0) {
    GOALS.forEach(function(g) {
      var card = document.createElement('div');
      card.className = 'goal-card';
      card.innerHTML = '<div class="goal-icon">' + g.icon + '</div><div>' + escHtml(g.label) + '</div>';
      card.addEventListener('click', function() { selectGoal(g.id); });
      goalGrid.appendChild(card);
    });
  }
});
observer.observe(document.getElementById('result-area'), { childList: true });

async function selectGoal(goalId) {
  document.querySelectorAll('.goal-card').forEach(function(c, i) {
    c.classList.toggle('selected', GOALS[i].id === goalId);
  });
  var output = document.getElementById('prompt-pkg-output');
  var text = document.getElementById('prompt-pkg-text');
  output.classList.remove('hidden');
  text.textContent = 'Generating prompt package...';
  try {
    var url = PROMPT_API + '/' + encodeURIComponent(selectedPlatform.id + '-' + selectedVariant.id) + '?goal=' + encodeURIComponent(goalId);
    if (isLoggedIn()) url += '&mode=authenticated';
    var resp = await fetch(url);
    var data = await resp.json();
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
  // Switch to Apps tab
  switchTab('apps');
}

// ── Copy to clipboard ──
function copyPrompt(btn) {
  var textEl = btn.parentElement.querySelector('.prompt-text');
  navigator.clipboard.writeText(textEl.textContent).then(function() {
    btn.textContent = dt('dev.copied');
    btn.classList.add('copied');
    setTimeout(function() { btn.textContent = dt('dev.copy'); btn.classList.remove('copied'); }, 2000);
  }).catch(function() {
    var range = document.createRange();
    range.selectNodeContents(textEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Background animations ──
var activeBg = 3;
var heartInterval = null;
var sparkleInterval = null;

function initHearts() {
  var c = document.getElementById('bg-hearts');
  if (heartInterval) clearInterval(heartInterval);
  var hearts = ['\u2764','\ud83d\udc95','\ud83d\udc96','\ud83d\udc97','\ud83d\udc93','\ud83e\ude77','\u2763','\ud83d\udc9e'];
  heartInterval = setInterval(function() {
    if (activeBg !== 1) return;
    var h = document.createElement('div');
    h.className = 'heart-particle';
    h.textContent = hearts[Math.floor(Math.random()*hearts.length)];
    h.style.left = Math.random()*100 + '%';
    h.style.fontSize = (0.8 + Math.random()*1.8) + 'rem';
    h.style.animationDuration = (6 + Math.random()*8) + 's';
    h.style.animationDelay = '0s';
    c.appendChild(h);
    setTimeout(function(){ if(h.parentNode) h.remove(); }, 16000);
  }, 400);
}

function initSparkles() {
  var c = document.getElementById('bg-sparkle');
  c.innerHTML = '';
  // Nebula blobs
  var colors = ['rgba(255,107,157,.3)','rgba(196,69,105,.25)','rgba(244,143,177,.2)','rgba(136,14,79,.2)'];
  for (var n = 0; n < 5; n++) {
    var blob = document.createElement('div');
    blob.className = 'nebula-blob';
    blob.style.width = (150 + Math.random()*250) + 'px';
    blob.style.height = blob.style.width;
    blob.style.left = Math.random()*90 + '%';
    blob.style.top = Math.random()*90 + '%';
    blob.style.background = colors[n % colors.length];
    blob.style.animationDuration = (12 + Math.random()*10) + 's';
    blob.style.animationDelay = (-Math.random()*10) + 's';
    c.appendChild(blob);
  }
  // Sparkle particles
  for (var i = 0; i < 80; i++) {
    var s = document.createElement('div');
    s.className = 'sparkle';
    s.style.left = Math.random()*100 + '%';
    s.style.top = Math.random()*100 + '%';
    s.style.animationDuration = (2 + Math.random()*4) + 's';
    s.style.animationDelay = (-Math.random()*6) + 's';
    s.style.width = (2 + Math.random()*3) + 'px';
    s.style.height = s.style.width;
    c.appendChild(s);
  }
}

function switchBg(num) {
  activeBg = num;
  var layers = ['bg-hearts','bg-aurora','bg-sparkle'];
  layers.forEach(function(id, i) {
    document.getElementById(id).classList.toggle('hidden', i + 1 !== num);
  });
  document.querySelectorAll('.bg-btn').forEach(function(b, i) {
    b.classList.toggle('active', i + 1 === num);
  });
  if (num === 3) initSparkles();
}

// Init
initHearts();
initSparkles();
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

export function portalRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // Cookie consent standalone JS snippet — for manual integration by service builders
  router.get('/v1/portal/cookie-consent.js', (_req, res) => {
    if (!config.cookieConsentEnabled) {
      res.status(404).type('text/plain').send('Cookie consent is not enabled on this node.');
      return;
    }
    res.type('application/javascript').send(buildStandaloneSnippetJs(config));
  });

  // GET /v1/portal — serve the onboarding portal HTML page
  // Default: human-facing portal. ?view=dev shows the developer portal.
  router.get('/v1/portal', async (req, res) => {
    const viewParam = req.query.view as string | undefined;
    const langParam = req.query.lang as string | undefined;
    const locale = resolveLocale(langParam, req.headers.cookie, req.headers['accept-language']);
    if (langParam) res.cookie('aimeat-lang', locale, { maxAge: 365 * 24 * 60 * 60 * 1000, path: '/', sameSite: 'lax' });
    const t = createT(locale);

    const [agents, actions, boards] = await Promise.all([
      storage.listAgents(),
      storage.listActions(),
      storage.listBoards(),
    ]);
    const stats = { agents: agents.length, actions: actions.length, boards: boards.length };

    if (viewParam === 'dev') {
      // Existing developer portal
      res.type('text/html').send(portalHtml(config, stats, locale));
    } else {
      // Human-facing portal (default)
      res.type('text/html').send(humanPortalHtml(config, t, locale, stats));
    }
  });

  // GET /v1/portal/platforms — JSON list of known platforms
  router.get('/v1/portal/platforms', (_req, res) => {
    res.json(success(config.nodeId, { platforms: PLATFORMS }));
  });

  // GET /v1/portal/prompt/:platformId — generate prompt package for a platform
  router.get('/v1/portal/prompt/:platformId', async (req, res) => {
    const platformId = req.params.platformId as string;
    const goal = (req.query.goal as string) || 'dashboard';
    const mode = (req.query.mode as string) || 'anonymous';

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

    // Authenticated users get extra upload instructions in the prompt
    if (path === 'prompt-package' && mode === 'authenticated') {
      prompt += '\n\n## Sharing Your App\n'
        + 'The user has an AIMEAT account. After you generate the HTML file, tell them:\n'
        + '"Go back to the AIMEAT portal and use the upload form in Step 4 to upload this HTML file. '
        + 'You\'ll get a shareable download link like `' + config.baseUrl + '/v1/apps/yourname/app.html` '
        + 'that anyone can use to download and run your app locally."';
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
