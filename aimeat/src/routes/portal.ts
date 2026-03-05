import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success } from '../middleware/envelope.js';
// i18n imports removed — SPA handles translations client-side
import { buildStandaloneSnippetJs } from '../middleware/cookie-consent.js';

const __dirname_portal = dirname(fileURLToPath(import.meta.url));

/**
 * Unique token set once when the server process starts.
 * Used as a query-string version stamp on all first-party ES module URLs so
 * that every server restart busts the browser's ES-module cache automatically.
 * (HTTP ETag/no-cache alone is insufficient — browsers keep modules in the
 *  module registry for the entire session regardless of HTTP headers.)
 */
const BUILD_ID = Date.now().toString(36);

/**
 * Serve spa.html with:
 *  - Cache-Control: no-cache so the browser always revalidates the shell
 *  - window.__B injected so dynamic import() calls can append ?v=BUILD_ID
 *  - importmap entries stamped with BUILD_ID so ALL first-party modules
 *    (static + dynamic imports from any view) get fresh URLs after restart
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serveSpa(res: any, spaPath: string): void {
  const v = `?v=${BUILD_ID}`;
  let html = readFileSync(spaPath, 'utf-8');

  // Inject window.__B for dynamic import() cache-busting in spa.html scripts
  html = html.replace('</head>', `<script>window.__B="${v}";</script>\n</head>`);

  // Stamp all importmap entries with the build version
  html = html.replace(
    /"preact": "\/lib\/preact\.mjs"/,
    `"preact": "/lib/preact.mjs${v}"`
  ).replace(
    /"preact\/hooks": "\/lib\/preact-hooks\.mjs"/,
    `"preact/hooks": "/lib/preact-hooks.mjs${v}"`
  ).replace(
    /"htm": "\/lib\/htm\.mjs"/,
    `"htm": "/lib/htm.mjs${v}"`
  )
  // Stamp utility module importmap entries (added to spa.html importmap)
  .replace(/"\/js\/i18n\.js": "\/js\/i18n\.js"/, `"/js/i18n.js": "/js/i18n.js${v}"`)
  .replace(/"\/js\/utils\.js": "\/js\/utils\.js"/, `"/js/utils.js": "/js/utils.js${v}"`)
  .replace(/"\/js\/api\.js": "\/js\/api\.js"/, `"/js/api.js": "/js/api.js${v}"`)
  .replace(/"\/js\/hooks\.js": "\/js\/hooks\.js"/, `"/js/hooks.js": "/js/hooks.js${v}"`);

  // Stamp all view CSS hrefs (preloaded in spa.html head) with the build version
  html = html.replace(
    /(<link rel="stylesheet" href=")(\/css\/views\/[^"?]+\.css)(")/g,
    `$1$2${v}$3`
  );
  // Also stamp theme.css
  html = html.replace(
    /(<link rel="stylesheet" href=")(\/css\/theme\.css)(")/,
    `$1$2${v}$3`
  );

  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/html').send(html);
}

/** Resolve a file from public/ directory (works from both src/ and dist/). */
function resolvePublicFile(filename: string): string | null {
  const candidates = [
    join(__dirname_portal, '..', '..', 'public', filename),      // dev: src/routes/../../public
    join(__dirname_portal, '..', '..', '..', 'public', filename), // dist: dist/src/routes/../../../public
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

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

function buildPromptPackage(config: AimeatConfig, nodeStats: { agents: number; chatSessions: number; actions: number; boards: number }): string {
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
- **Chat Sessions:** ${nodeStats.chatSessions}

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

### If Something Doesn't Work
After giving the user the download link or HTML file, always add this message at the end:
"If the app doesn't work as expected or you see errors, don't worry — tell me what happened and we'll fix it together!

Here's how to check for errors:
1. Open the app in your browser
2. Press F12 (or right-click → Inspect) to open Developer Tools
3. Click the 'Console' tab
4. If you see red error messages, copy them and paste them here
5. I'll analyze the errors and give you a fixed version

Even if there are no console errors — just describe what's wrong (e.g. 'the button doesn't do anything', 'I see a blank page', 'the data doesn't save') and I'll investigate."

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

  // GET /v1/portal — serve the SPA shell (handles both main portal and ?view=dev)
  router.get('/v1/portal', (_req, res) => {
    const spaPath = resolvePublicFile('spa.html');
    if (spaPath) {
      serveSpa(res, spaPath);
    } else {
      res.redirect(302, '/spa.html');
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

    const [agents, chatSessions, actions, boards] = await Promise.all([
      storage.listAgents(),
      storage.listChatInstances(),
      storage.listActions(),
      storage.listBoards(),
    ]);
    const stats = { agents: agents.length, chatSessions: chatSessions.length, actions: actions.length, boards: boards.length };

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

  // ── SPA routes — serve spa.html for all portal pages ──
  // The Preact SPA handles client-side routing for all /v1/ portal URLs.

  const spaRoutes = [
    '/v1/profile',
    '/v1/guides',
    '/v1/aimeat-os',
    '/v1/hobbies',
    '/v1/marketplace',
    '/v1/openclaw',
    '/v1/classic',
  ];

  for (const path of spaRoutes) {
    router.get(path, (_req, res) => {
      const spaPath = resolvePublicFile('spa.html');
      if (spaPath) {
        serveSpa(res, spaPath);
      } else {
        res.redirect(302, '/spa.html');
      }
    });
  }

  return router;
}
