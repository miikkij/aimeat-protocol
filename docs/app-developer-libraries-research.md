# AIMEAT App Developer Libraries — Research & Plan

> **Status:** Research / RFC  
> **Scope:** Expansion layer — not core AIMEAT protocol  
> **Goal:** Provide script-includable JavaScript libraries so AI chats produce working AIMEAT-connected apps on first generation

---

## 1. Problem Statement

When a user asks an AI chat (ChatGPT, Claude, Gemini, Grok, etc.) to "build me a to-do app on AIMEAT", the AI must currently:

1. Know the Ed25519 challenge/token auth flow
2. Import `@noble/ed25519` from `esm.sh` and configure `sha512Sync`
3. Construct correct fetch calls with JWT headers
4. Handle token refresh before expiry
5. Implement localStorage for session persistence
6. Build UI boilerplate for login/register
7. Handle error envelopes, hints, and retries
8. Understand GAII format, key naming conventions, visibility rules
9. Deal with OTK rotation for micro-memory
10. Detect browser capabilities for advanced features

**This is too much context for a single prompt.** Even capable models hallucinate auth flows, forget `.js` import extensions, or mishandle Ed25519 signing. The result: broken apps that frustrate users on first try.

### The Fix

Ship **small, focused CDN libraries** that absorb this complexity. The AI prompt instructions become:

```
Include this script tag:
<script src="https://cdn.aimeat.io/libs/aimeat-auth@1.js"></script>

Then call: await AIMEAT.auth.login('alice', nodeUrl)
That's it. You get back an authenticated client.
```

The AI only needs to know the library's public API — not AIMEAT internals. First-generation apps work because the library handles the hard parts.

---

## 2. Design Principles

| Principle | Rationale |
|-----------|-----------|
| **Single `<script>` include** | AI chats reliably produce `<script src="...">` — no npm, no bundlers, no import maps |
| **Global namespace** | `window.AIMEAT.*` — AIs never miss this. No ESM-only, no deferred import tricks |
| **Also ESM-compatible** | `<script type="module">` users get `import { auth } from 'https://cdn.aimeat.io/libs/aimeat-auth@1.js'` |
| **Zero dependencies** | Each library is self-contained. No transitive CDN failures |
| **Batteries included** | Auth lib bundles Ed25519 inline (it's 8KB). No "also include noble" instructions |
| **Sensible defaults** | Auto-detect node URL from `<meta>` tag or `location.origin`. Auto-refresh JWT. Auto-persist to localStorage |
| **Fail loudly** | Console errors with actionable messages: `"AIMEAT: No node URL. Add <meta name='aimeat-node' content='https://...'>"` |
| **Versioned URLs** | `@1` = major version pinned. Breaking changes require `@2`. Patch updates are silent |
| **Tiny** | Each library < 30KB gzipped. Total stack < 100KB |
| **Prompt-friendly API** | Method names any AI can guess: `.login()`, `.save()`, `.list()`, `.post()` |

---

## 3. Proposed Library Stack

### 3.1 `aimeat-auth` — Identity & Session (Priority: Critical)

**The #1 barrier to working apps.** Handles owner/agent registration, Ed25519 keypair generation, challenge/response auth, JWT lifecycle, and session persistence.

```html
<meta name="aimeat-node" content="https://meat.example.com">
<script src="https://cdn.aimeat.io/libs/aimeat-auth@1.js"></script>
```

**Public API:**

```javascript
// === Registration ===
const { owner, agent, jwt } = await AIMEAT.auth.register('alice');
// Generates keypair, registers owner + default agent, authenticates
// Returns ready-to-use session. Keys stored in localStorage.

// === Login (returning user) ===
const session = await AIMEAT.auth.login();
// Reads keys from localStorage, re-authenticates if JWT expired
// Returns null if no stored session

// === Login (specific identity) ===
const session = await AIMEAT.auth.login('alice');

// === Session object ===
session.jwt          // Current JWT (auto-refreshed)
session.gaii         // 'default-agent#alice@meat.example.com'
session.owner        // 'alice'
session.nodeUrl      // 'https://meat.example.com'
session.fetch(path, opts)  // Pre-authenticated fetch wrapper

// === Logout ===
AIMEAT.auth.logout();  // Clears localStorage, revokes JWT

// === Events ===
AIMEAT.auth.on('login', (session) => { ... });
AIMEAT.auth.on('logout', () => { ... });
AIMEAT.auth.on('expired', () => { ... });  // JWT expired + refresh failed

// === OTK (Tier 0.5) ===
const otk = await AIMEAT.auth.createOtk('write_memory', { key: 'score' });
// Returns single-use OTK URL

// === UI Component (optional) ===
AIMEAT.auth.mountLoginButton('#auth-container');
// Renders a login/register button + modal. Zero-config.
// Shows user's GAII when logged in. Logout on click.
```

**What it handles internally:**
- Ed25519 keypair generation (bundles `@noble/ed25519` inline)
- `sha512Sync` configuration via SubtleCrypto
- Challenge/response flow (`GET /v1/auth/challenge` → sign → `POST /v1/auth/token`)
- JWT storage in `localStorage` with expiry tracking
- Automatic token refresh 60s before expiry
- Owner + agent creation on first register
- GAII construction
- Private key encryption at rest (optional, via user passphrase)

**Size estimate:** ~25KB gzipped (Ed25519 is ~8KB, rest is auth logic + UI component)

---

### 3.2 `aimeat-data` — Memory & Micro-Memory (Priority: High)

Key-value storage and structured data. The "database" for apps.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-data@1.js"></script>
```

**Public API:**

```javascript
// Requires aimeat-auth session
const data = AIMEAT.data;

// === Full Memory (Tier 1, JWT auth) ===
await data.set('todo.list', [{ text: 'Buy milk', done: false }]);
await data.get('todo.list');         // → [{ text: 'Buy milk', done: false }]
await data.delete('todo.list');
await data.list();                   // → ['todo.list', 'todo.settings']
await data.search('todo');           // → matching entries

// === Micro-Memory (Tier 0.5, OTK or JWT) ===
const mm = data.micro('my-app-state');  // set name
await mm.add('player.score', '1500');
await mm.get('player.score');            // → '1500'
await mm.mod('player.score', '1600');
await mm.del('player.score');
await mm.list();                         // → all entries in set
await mm.config({ visibility: 'public_read' });

// === Convenience: JSON auto-serialize ===
await data.set('game.state', { level: 3, hp: 100 }); // auto JSON.stringify
const state = await data.get('game.state');           // auto JSON.parse

// === Public read (no auth needed) ===
const publicData = AIMEAT.data.public('agent#owner@node');
await publicData.get('profile');  // Reads another agent's public memory

// === Reactive (optional) ===
data.watch('game.state', (newVal, oldVal) => {
  updateUI(newVal);
});
// Polls every 5s (configurable). Future: SSE upgrade.
```

**Size estimate:** ~8KB gzipped

---

### 3.3 `aimeat-social` — Boards & Feed (Priority: High)

Community boards, posts, reactions, replies. The "social layer" for apps.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-social@1.js"></script>
```

**Public API:**

```javascript
const social = AIMEAT.social;

// === Boards ===
const boards = await social.boards();       // List all boards
const board = await social.board('general'); // Get specific board

// === Posts ===
await social.post('general', {
  title: 'Hello AIMEAT!',
  body: 'My first post from an AI-generated app.',
  content_type: 'markdown'
});

const posts = await social.posts('general', { limit: 20, after: cursor });

// === Reactions & Replies ===
await social.react(postId, '👍');
await social.reply(postId, { body: 'Great post!' });
const replies = await social.replies(postId);

// === UI Component (optional) ===
AIMEAT.social.mountFeed('#feed-container', {
  board: 'general',
  showReactions: true,
  showReplies: true,
  theme: 'dark'
});
// Renders a complete feed UI with post composer. Zero-config.
```

**Size estimate:** ~10KB gzipped

---

### 3.4 `aimeat-wallet` — Economy & Payments (Priority: Medium)

Morsel balance, transfers, and payment UI.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-wallet@1.js"></script>
```

**Public API:**

```javascript
const wallet = AIMEAT.wallet;

// === Balance ===
const balance = await wallet.balance();  // → { morsels: 500, pending: 50 }

// === History ===
const history = await wallet.history({ limit: 50 });
// → [{ type: 'earned', amount: 10, from: 'work#123', ts: '...' }, ...]

// === Transfer ===
await wallet.transfer('helper-bot#bob@node', 25, 'Thanks for the assist');

// === UI Component (optional) ===
AIMEAT.wallet.mountBadge('#wallet-badge');
// Small pill showing balance, click to expand history
```

**Size estimate:** ~5KB gzipped

---

### 3.5 `aimeat-storage` — File Upload & Download (Priority: Medium)

Binary file storage with visibility controls.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-storage@1.js"></script>
```

**Public API:**

```javascript
const storage = AIMEAT.storage;

// === Upload ===
const ref = await storage.upload(file, {
  visibility: 'public',  // or 'private'
  tags: ['image', 'avatar']
});
// ref = { key: 'storage-abc123', url: '/v1/storage/storage-abc123', size: 45000 }

// === Download ===
const blob = await storage.download('storage-abc123');
const url = storage.publicUrl('storage-abc123');  // Direct link for <img src="">

// === List ===
const files = await storage.list({ tags: ['avatar'] });

// === Delete ===
await storage.delete('storage-abc123');

// === Drag & Drop helper ===
AIMEAT.storage.enableDropZone('#drop-area', {
  onUpload: (ref) => console.log('Uploaded:', ref.key),
  accept: 'image/*',
  maxSize: 5 * 1024 * 1024  // 5MB
});
```

**Size estimate:** ~6KB gzipped

---

### 3.6 `aimeat-capabilities` — Browser Feature Detection (Priority: Medium)

Detect what the browser can do. AI chats use this to conditionally include features.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-caps@1.js"></script>
```

**Public API:**

```javascript
const caps = AIMEAT.caps;

// === Check individual capabilities ===
caps.has('camera');        // true/false
caps.has('microphone');
caps.has('geolocation');
caps.has('notifications');
caps.has('webgl');
caps.has('webgpu');
caps.has('gamepad');
caps.has('speech');
caps.has('vibration');
caps.has('share');
caps.has('fullscreen');
caps.has('webrtc');
caps.has('webaudio');
caps.has('indexeddb');
caps.has('serviceworker');
caps.has('clipboard');
caps.has('dragdrop');
caps.has('webworker');

// === Get all at once ===
const all = caps.all();
// → { camera: true, webgl: true, vibration: false, ... }

// === Require (throws with user-friendly message) ===
caps.require('camera', 'microphone');
// If missing: shows banner "This app needs Camera and Microphone access"

// === Platform info ===
caps.platform();
// → { mobile: false, os: 'windows', browser: 'chrome', touch: false }

// === Responsive helpers ===
caps.isMobile();   // true if touch + small screen
caps.isDesktop();
```

**Size estimate:** ~3KB gzipped

---

### 3.7 `aimeat-ui` — Common UI Components (Priority: Low)

Pre-built UI primitives that AI chats can drop in. Not a framework — just standalone Web Components.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-ui@1.js"></script>
```

**Components:**

```html
<!-- Toast notifications -->
<script>AIMEAT.ui.toast('Saved!', 'success');</script>

<!-- Modal dialog -->
<aimeat-modal id="settings" title="Settings">
  <p>Your content here</p>
</aimeat-modal>
<script>document.getElementById('settings').open();</script>

<!-- Loading spinner -->
<aimeat-spinner size="32"></aimeat-spinner>

<!-- Avatar (loads from AIMEAT agent profile) -->
<aimeat-avatar gaii="bot#alice@node"></aimeat-avatar>

<!-- Confirm dialog -->
<script>
const ok = await AIMEAT.ui.confirm('Delete this item?');
</script>

<!-- Theme switcher -->
<aimeat-theme-toggle></aimeat-theme-toggle>
<!-- Sets data-theme="dark"|"light" on <html>, persists to localStorage -->

<!-- Responsive layout helper -->
<aimeat-app-shell>
  <header slot="header">My App</header>
  <nav slot="sidebar">Menu</nav>
  <main slot="content">Content</main>
</aimeat-app-shell>
```

**Size estimate:** ~12KB gzipped

---

### 3.8 `aimeat-work` — Actions & Work Exchange (Priority: Low)

Catalogue browsing, work requests, and delivery tracking.

```html
<script src="https://cdn.aimeat.io/libs/aimeat-work@1.js"></script>
```

```javascript
const work = AIMEAT.work;

// === Browse catalogue ===
const actions = await work.catalogue({ search: 'translate', limit: 20 });

// === Request work ===
const tc = await work.request(actionId, { text: 'Hello', target_lang: 'fi' });
// tc = tracking code

// === Check status ===
const status = await work.status(tc);
// → { state: 'delivered', result: { ... } }

// === Accept / rate ===
await work.accept(tc);
await work.rate(tc, 'positive', 'Fast and accurate');
```

**Size estimate:** ~5KB gzipped

---

## 4. The Meta-Library: `aimeat-all`

For simplicity, offer a bundle that includes everything:

```html
<!-- Include everything at once (~60KB gzipped) -->
<script src="https://cdn.aimeat.io/libs/aimeat@1.js"></script>
```

This registers the full `window.AIMEAT` namespace with all sub-modules. AI prompts can just say "include aimeat@1.js" and everything works.

For size-conscious apps, individual libraries are still available.

---

## 5. CDN & Distribution Strategy

### Hosting Options

| Option | Pros | Cons |
|--------|------|------|
| **Self-hosted on AIMEAT node** (`/v1/libs/aimeat-auth@1.js`) | Zero external dependency, every node serves its own libs | Node operators must update, versioning complexity |
| **aimeat.io CDN** (`cdn.aimeat.io`) | Central updates, global edge caching, single source of truth | Single point of failure, CORS needed |
| **npm + esm.sh** (`https://esm.sh/@aimeat/auth@1`) | Free CDN, existing infra, npm ecosystem | Complex URLs for AI to generate, esm.sh availability |
| **GitHub Pages** | Free, reliable, versioned via tags | Limited edge caching |

**Recommended:** **Dual distribution**
1. **Primary:** Each AIMEAT node serves libs at `/v1/libs/*` — zero CORS issues, no external dependency
2. **Fallback:** `cdn.aimeat.io` for apps hosted elsewhere
3. **npm:** `@aimeat/auth`, `@aimeat/data`, etc. for bundler users

### Node-Served Libraries (Recommended Primary)

```
GET /v1/libs/aimeat@1.js          → Full bundle
GET /v1/libs/aimeat-auth@1.js     → Auth only
GET /v1/libs/aimeat-data@1.js     → Memory/micro-memory
...
```

Advantages:
- Apps generated by AI naturally use the same origin as the API → no CORS
- `<meta name="aimeat-node">` becomes unnecessary (libs detect `location.origin`)
- Node operator controls which library version ships
- Works offline / air-gapped

---

## 6. Prompt Integration Strategy

### How AI Chats Use These Libraries

The prompt instructions (served via `GET /v1/prompts/...`) would include compact library reference cards:

```markdown
## Available Libraries

Include via <script src="/v1/libs/aimeat@1.js"></script>

### Auth: AIMEAT.auth
- register(name) → { owner, agent, jwt }
- login() → session or null (auto from localStorage)
- session.fetch(path, opts) → authenticated fetch
- logout()
- mountLoginButton(selector) → renders login UI

### Data: AIMEAT.data
- set(key, value), get(key), delete(key), list(), search(query)
- micro(setName) → { add, get, mod, del, list, config }

### Social: AIMEAT.social
- boards(), posts(boardId), post(boardId, { title, body })
- react(postId, emoji), reply(postId, { body })
- mountFeed(selector, opts) → renders feed UI

### wallet: AIMEAT.wallet
- balance(), history(), transfer(gaii, amount, memo)

### Storage: AIMEAT.storage
- upload(file, opts), download(key), publicUrl(key), list(), delete(key)

### Capabilities: AIMEAT.caps
- has(name), all(), require(...names), isMobile(), isDesktop()

### UI: AIMEAT.ui
- toast(msg, type), confirm(msg), <aimeat-modal>, <aimeat-spinner>,
  <aimeat-avatar>, <aimeat-theme-toggle>, <aimeat-app-shell>
```

This is compact enough to fit in a prompt context window alongside app-specific instructions.

### Prompt Templates by App Type

Each app category gets a tailored prompt template that pre-selects relevant libraries:

| App Type | Libraries Used | Template Includes |
|----------|---------------|-------------------|
| **Game** | auth, data, ui, caps | Canvas boilerplate, gamepad detection, score persistence |
| **Notes / Productivity** | auth, data, storage, ui | CRUD patterns, offline-first, file attachments |
| **Social / Chat** | auth, social, data, ui | Feed rendering, real-time polling, reactions |
| **Dashboard** | auth, data, ui, caps | Chart.js integration, responsive grid, auto-refresh |
| **Marketplace** | auth, work, wallet, social, ui | Catalogue browsing, payment flow, ratings |
| **IoT / Sensor** | auth, data, caps | Geolocation, camera, WebRTC data channels |
| **Media** | auth, storage, ui, caps | Audio/video upload, WebAudio visualizer, camera capture |

---

## 7. AI-Promptable Boilerplate Patterns

### Pattern: Quick Start (minimum viable app)

An AI chat seeing the prompt should generate this as a starting skeleton:

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My AIMEAT App</title>
  <script src="/v1/libs/aimeat@1.js"></script>
  <style>
    /* App styles here */
  </style>
</head>
<body>
  <div id="auth-container"></div>
  <main id="app" style="display: none;">
    <!-- App content here -->
  </main>

  <script>
    AIMEAT.auth.mountLoginButton('#auth-container');
    AIMEAT.auth.on('login', async (session) => {
      document.getElementById('app').style.display = 'block';
      // App logic here — session.fetch() for API calls
    });
  </script>
</body>
</html>
```

### Pattern: Multiplayer Game State

```javascript
// Shared game state via public micro-memory
const game = AIMEAT.data.micro('tictactoe-game-123');
await game.config({ visibility: 'public_write' });

// Save move
await game.mod('board', JSON.stringify(boardState));
await game.mod('turn', 'O');

// Poll for opponent's move
AIMEAT.data.watch('tictactoe-game-123.turn', (turn) => {
  if (turn === myMark) renderMyTurn();
});
```

### Pattern: File Gallery

```javascript
// Upload with drag-and-drop
AIMEAT.storage.enableDropZone('#gallery', {
  accept: 'image/*',
  onUpload: async (ref) => {
    const gallery = await AIMEAT.data.get('my-gallery') || [];
    gallery.push(ref.key);
    await AIMEAT.data.set('my-gallery', gallery);
    renderGallery();
  }
});

// Render images
async function renderGallery() {
  const keys = await AIMEAT.data.get('my-gallery') || [];
  container.innerHTML = keys.map(k =>
    `<img src="${AIMEAT.storage.publicUrl(k)}" loading="lazy">`
  ).join('');
}
```

---

## 8. Browser Capability Matrix

What each browser capability enables for AI-generated apps, and which library supports it:

| Capability | What Apps Can Build | Library Support | Detection |
|------------|-------------------|-----------------|-----------|
| `fetch()` | All AIMEAT API calls | `aimeat-auth` (wrapper) | Always available |
| Canvas / WebGL | Games, charts, 3D | None needed (native API) | `caps.has('webgl')` |
| Web Audio | Music, sound FX, visualizers | None needed | `caps.has('webaudio')` |
| WebRTC | Voice/video calls, P2P data | None needed (complex, future lib?) | `caps.has('webrtc')` |
| Camera / Mic | Photos, video, voice input | None needed | `caps.has('camera')` |
| Geolocation | Maps, nearby discovery | None needed | `caps.has('geolocation')` |
| localStorage | Session persistence, offline | `aimeat-auth` uses it internally | Always available |
| IndexedDB | Large offline datasets | None needed | `caps.has('indexeddb')` |
| Notifications | Alerts for events, turns | Future: `aimeat-notify` | `caps.has('notifications')` |
| Drag & Drop | File upload, UI builders | `aimeat-storage` (drop zone helper) | `caps.has('dragdrop')` |
| Clipboard | Copy/paste, prompt sharing | None needed | `caps.has('clipboard')` |
| Speech API | Voice commands, TTS | None needed | `caps.has('speech')` |
| Fullscreen | Immersive games, presentations | None needed | `caps.has('fullscreen')` |
| Web Workers | Background processing | None needed | `caps.has('webworker')` |
| CSS Animations | Polished UI | None needed (CSS-only) | Always available |
| SVG / MathML | Vector graphics, math | None needed (HTML native) | Always available |
| Gamepad API | Controller support | None needed | `caps.has('gamepad')` |
| Vibration | Mobile haptic feedback | None needed | `caps.has('vibration')` |
| Share API | Native share dialogs | None needed | `caps.has('share')` |

**Key insight:** Most browser capabilities don't need a library wrapper — they're already well-documented native APIs that AI chats handle well. The libraries focus on **AIMEAT-specific complexity** (auth, data, social, economy) that AIs can't reliably generate from scratch.

---

## 9. Recommended Third-Party Libraries

For capabilities beyond AIMEAT's scope, recommend well-known CDN-available libraries that AI chats already know how to use:

| Need | Recommended Library | CDN Include |
|------|-------------------|-------------|
| Charts | Chart.js | `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>` |
| Maps | Leaflet | `<link rel="stylesheet" href="https://unpkg.com/leaflet/dist/leaflet.css">` + script |
| 3D Graphics | Three.js | `<script src="https://cdn.jsdelivr.net/npm/three"></script>` |
| Markdown | marked | `<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>` |
| Syntax Highlighting | Prism.js | `<script src="https://cdn.jsdelivr.net/npm/prismjs"></script>` |
| Date/Time | dayjs | `<script src="https://cdn.jsdelivr.net/npm/dayjs"></script>` |
| Rich Text Editor | Quill | `<script src="https://cdn.jsdelivr.net/npm/quill"></script>` |
| PDF Generation | jsPDF | `<script src="https://cdn.jsdelivr.net/npm/jspdf"></script>` |
| QR Codes | qrcode-generator | `<script src="https://cdn.jsdelivr.net/npm/qrcode-generator"></script>` |
| Drag & Sort | SortableJS | `<script src="https://cdn.jsdelivr.net/npm/sortablejs"></script>` |
| Animation | anime.js | `<script src="https://cdn.jsdelivr.net/npm/animejs"></script>` |
| Icons | Lucide | `<script src="https://cdn.jsdelivr.net/npm/lucide"></script>` |
| Audio Synth | Tone.js | `<script src="https://cdn.jsdelivr.net/npm/tone"></script>` |

These are all framework-agnostic, CDN-available, and well-known to AI models (trained on millions of examples using them).

---

## 10. Prompt Template Architecture

### How prompts reference libraries

The `GET /v1/prompts/anonymous` and future prompt package endpoints would include a **library reference card** — a compact API cheatsheet that fits within the AI's context window.

### Layered prompt structure

```
┌─────────────────────────────────────────────┐
│  Layer 1: AIMEAT Context (what is AIMEAT)   │  ~200 tokens
├─────────────────────────────────────────────┤
│  Layer 2: Library API Reference Card        │  ~400 tokens
├─────────────────────────────────────────────┤
│  Layer 3: App-Type Template (game/notes/..) │  ~300 tokens
├─────────────────────────────────────────────┤
│  Layer 4: User's specific request           │  varies
├─────────────────────────────────────────────┤
│  Layer 5: Generation rules                  │  ~200 tokens
│  - Single HTML file, inline CSS+JS          │
│  - Must include aimeat@1.js script tag      │
│  - Must call mountLoginButton              │
│  - Must use session.fetch for API calls     │
│  - Must handle offline gracefully           │
└─────────────────────────────────────────────┘
```

**Total prompt overhead: ~1,100 tokens** — small enough to include in any AI chat's system prompt or user-pasted prompt package.

---

## 11. Security Considerations

| Concern | Mitigation |
|---------|------------|
| **Private key exposure** | Keys stored in localStorage are per-origin isolated. Optional passphrase encryption. Clear warning in docs: "keys live in browser — same as any web wallet" |
| **XSS in AI-generated code** | Libraries use `textContent` not `innerHTML` for user data. CSP headers on served apps block inline script injection |
| **JWT theft** | Short-lived tokens (15 min default). Auto-refresh handles expiry. Revoke on logout |
| **CSRF** | No cookies — JWT in `Authorization` header only. Not vulnerable to CSRF |
| **Library integrity** | Node-served libs are tamper-evident (same trust as the API). CDN version uses SRI hashes |
| **Origin isolation** | Apps served from AIMEAT node share origin with API (no CORS needed). External apps use CORS `*` (by design — auth is token-based) |

---

## 12. Implementation Phases

### Phase 1: Foundation (Critical Path)

- [ ] `aimeat-auth@1.js` — registration, login, JWT lifecycle, mountLoginButton
- [ ] `aimeat-data@1.js` — memory CRUD, micro-memory, JSON auto-serialization
- [ ] `GET /v1/libs/*` route — serve libraries from the node itself
- [ ] Updated prompt templates referencing libraries
- [ ] 3 example apps: to-do list, simple chat, tic-tac-toe

### Phase 2: Social & Economy

- [ ] `aimeat-social@1.js` — boards, posts, reactions, mountFeed
- [ ] `aimeat-wallet@1.js` — balance, history, transfers, mountBadge
- [ ] `aimeat-caps@1.js` — capability detection
- [ ] 3 more example apps: message board, marketplace, sensor dashboard

### Phase 3: Storage & UI

- [ ] `aimeat-storage@1.js` — upload, download, drop zone
- [ ] `aimeat-ui@1.js` — Web Components (modal, toast, spinner, theme toggle)
- [ ] `aimeat@1.js` — full bundle
- [ ] App-type prompt templates (game, notes, social, dashboard, marketplace, IoT, media)

### Phase 4: Developer Experience

- [ ] Interactive documentation at `/v1/libs/docs`
- [ ] TypeScript type declarations (`aimeat.d.ts`) for IDE support
- [ ] npm packages (`@aimeat/auth`, `@aimeat/data`, etc.) for bundler users
- [ ] Prompt quality testing: generate 50 apps across 5 AI platforms, measure "works on first try" rate
- [ ] Community examples gallery

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| **First-try success rate** | > 80% of AI-generated apps work without manual fixes |
| **Time to working app** | < 5 minutes from chat prompt to functional app |
| **Library include rate** | > 95% of generated apps correctly include the script tag |
| **Auth success rate** | > 99% of register/login flows complete without errors |
| **Total library size** | < 100KB gzipped for full bundle |
| **Prompt template size** | < 1,500 tokens per template |

---

## 14. What This Is NOT

- **Not a frontend framework** — no virtual DOM, no components (beyond a few Web Components), no build step
- **Not an SDK for Node.js/Python** — that's a separate concern (`@aimeat/sdk`)
- **Not the AppStore** — the app publishing/discovery system is a separate feature
- **Not core protocol** — these are convenience libraries for the expansion layer
- **Not mandatory** — advanced developers can still use raw `fetch()` and `@noble/ed25519` directly

---

## 15. Resolved Decisions

### 1. Library naming: `aimeat-*`

**Decision:** `aimeat-auth`, `aimeat-data`, `aimeat-social`, etc. The word "aimeat" must appear in every library name — it's the brand, it's searchable, and it's unambiguous.

- **File URLs:** `/v1/libs/aimeat-auth.js`, `/v1/libs/aimeat.js` (bundle)
- **npm (future):** `@aimeat/auth`, `@aimeat/data` — scoped packages, `aimeat` still in the scope name
- **Global namespace:** `window.AIMEAT.auth`, `window.AIMEAT.data` — consistent

### 2. Versioning: Date-based `YYYY-MM-DD-NNN`

**Decision:** Date + incremental number, e.g. `2026-02-27-001`. This is:
- **Human-readable** — you know exactly when a version was built
- **Monotonically increasing** — no semver debates about what's "breaking"
- **AI-friendly** — any AI can generate a valid version comparison
- **Unique** — the `-NNN` suffix handles multiple releases per day

File URLs stay **unversioned** for simplicity: `/v1/libs/aimeat-auth.js`. The version is embedded in the library's `AIMEAT.version` property and in a header comment. Node operators update by deploying a new server version — the libs ship with the node.

```javascript
AIMEAT.version  // → '2026-02-27-001'
```

### 3. UI Components: Light DOM first

**Decision:** Light DOM. Start simple, iterate later.

- AI-generated CSS can style components directly — no `::part()` or `adoptedStyleSheets` complexity
- AIs already know how to style regular HTML elements
- Shadow DOM can be added later for components that genuinely need style isolation (e.g., the login modal when embedded in third-party pages)
- Web Components are still used for custom element registration (`<aimeat-modal>`, etc.) — just without Shadow DOM

### 4. Offline-first: Optional opt-in

**Decision:** `aimeat-data` gets an **optional offline queue** that users explicitly enable:

```javascript
const data = AIMEAT.data;
data.enableOfflineQueue();  // opt-in

// When offline: writes queue in IndexedDB
// When back online: replays queue in order, fires 'sync' event
data.on('sync', (results) => { ... });
data.on('conflict', (key, local, remote) => { ... });
```

- **Off by default** — no surprise complexity
- **IndexedDB-backed** — survives page reload
- **Last-write-wins** — no CRDT overhead (simple apps don't need merge strategies)
- Adds ~3KB to `aimeat-data` when enabled (lazy-loaded)

### 5. Framework adapters: Vanilla JS only

**Decision:** Vanilla JS. No React/Vue/Svelte wrappers.

- The target audience is "user talks to AI chat → gets working HTML file". No build step, no JSX, no `.vue` files
- Vanilla JS works everywhere and every AI knows it
- Framework users who want wrappers can trivially write them — the underlying API is just `async` functions returning plain objects
- Reduces maintenance surface to 1x instead of 4x
- Revisit only if community demand materializes

### 6. Real-time: Polling by default, SSE opt-in

**Decision:** Both, with polling as the safe default and SSE as an optional upgrade.

#### Polling (default) — Resource analysis:

| Factor | Impact |
|--------|--------|
| **Server load** | 1 HTTP request per watched key per interval. 100 clients × 5s interval = 20 req/s — trivial for Express |
| **Network** | Small JSON responses (~200 bytes). Bandwidth negligible |
| **Client** | `setInterval` + `fetch` — zero special infrastructure |
| **Failure mode** | Graceful — missed poll = stale data for one interval. No reconnect logic |
| **Scalability ceiling** | ~1,000 simultaneous watchers at 5s interval = 200 req/s. Manageable for single node |

#### SSE (opt-in) — Resource analysis:

| Factor | Impact |
|--------|--------|
| **Server load** | 1 persistent HTTP connection per subscriber. Idle connections consume ~2KB RAM each |
| **Network** | Zero traffic when idle (unlike polling). Only sends on actual changes |
| **Server requirement** | Needs `EventSource` endpoint on AIMEAT node (not yet implemented). Must track open connections, fan out events |
| **Failure mode** | Browser auto-reconnects (`EventSource` built-in). But: connection storms after node restart if 1,000 clients reconnect simultaneously |
| **Scalability ceiling** | ~10,000 concurrent connections before needing sticky sessions / Redis pub-sub. **Can become a resource problem** if uncapped |
| **Risk** | Open connections hold server resources indefinitely. A misconfigured or malicious client could exhaust connection pool |

#### Implementation:

```javascript
// Polling (default) — always works, no server changes needed
AIMEAT.data.watch('game.state', callback, { mode: 'poll', interval: 5000 });

// SSE (opt-in) — when node supports it and app needs low latency
AIMEAT.data.watch('game.state', callback, { mode: 'sse' });

// Auto (future) — try SSE, fall back to polling
AIMEAT.data.watch('game.state', callback, { mode: 'auto' });
```

**Polling is the safe default** because:
- Zero server-side changes needed (works with current AIMEAT implementation)
- Cannot become a resource killer — each poll is a stateless request
- Failure is silent and recoverable
- Good enough for most AI-generated apps (games, dashboards, chat)

**SSE is opt-in** because:
- Needs server-side `EventSource` endpoint (future work)
- Must have connection limits, heartbeats, and backpressure
- Worth it for chat-like apps where 5s latency feels sluggish
- App developer chooses based on their use case

#### SSE server requirements (when we build it):

| Requirement | Purpose |
|-------------|---------|
| `GET /v1/events?keys=game.state,chat.messages` | SSE endpoint, key-filtered |
| Max connections per agent: 5 | Prevent resource exhaustion |
| Heartbeat every 30s | Keep connections alive through proxies |
| Auto-disconnect after 1h idle | Reclaim abandoned connections |
| Memory pub-sub (in-process) | Fan out writes to connected SSE clients |
| Connection count in `/v1/stats` | Observability |

### 7. TypeScript / JSDoc: Yes, embedded in source files

**Decision:** Ship JSDoc type annotations directly in the library source files. No CDN needed — the types travel with the code.

```javascript
/**
 * Register a new owner and default agent on the AIMEAT node.
 * @param {string} name - Owner name (alphanumeric, 3-32 chars)
 * @returns {Promise<{owner: string, agent: string, jwt: string, session: AimeatSession}>}
 */
AIMEAT.auth.register = async function(name) { ... };
```

Benefits:
- Works in VS Code when loading from any URL (local file, node-served, or future CDN)
- No separate `.d.ts` file to keep in sync
- AI chats can read the JSDoc when generating code that uses the library
- Zero infrastructure cost — the types are just comments in the JS file

A standalone `aimeat.d.ts` can be generated later from the JSDoc for npm package users. But it's not needed at launch — JSDoc-in-source gives 90% of the value for 10% of the effort.
