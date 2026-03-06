# App Catalog & App Launcher — Remaining Features Plan

**Date:** 2026-03-06  
**Status:** Plan  
**Related docs:**
- `docs/plans/2026-03-03-app-launcher-design.md` — Original design  
- `docs/plans/2026-03-03-app-launcher-implementation.md` — Build tasks  
- `docs/nextlevel/aimeat-appstore-plan.md` — AppStore vision  
- `docs/plans/2026-03-05-cortex-extensions-v2-design.md` — Cortex integration  
- `docs/ghii-identity-and-network-plan.md` §9 — Federated catalogue  

---

## Current State Summary

### What's Built — Client Side (`src/static/app-catalog.html`)

3,049-line standalone HTML file with all JS/CSS inline.

| Feature | Status |
|---------|--------|
| IndexedDB storage (`AppLauncherDB`) | ✅ Done |
| Add app via URL link | ✅ Done |
| Add app via HTML file drag & drop | ✅ Done |
| Add app via paste (HTML source code) | ✅ Done |
| ZIP import with inline bundler (DecompressionStream) | ✅ Done |
| AIMEAT node import (fetch `/v1/apps`, link or offline mode) | ✅ Done |
| Grid view with app cards (icon, name, source badge) | ✅ Done |
| Tag-based grouping + favorites | ✅ Done |
| Real-time search/filter | ✅ Done |
| Launch in new tab (blob URL) | ✅ Done |
| Launch in inline iframe (srcdoc, sandbox) | ✅ Done |
| Context menu (edit, delete, favorite, toggle mode, view/edit source, publish) | ✅ Done |
| View / Edit Source modal (view, copy, edit blob apps, copy with AI prompt) | ✅ Done |
| Publish to AIMEAT server (from context menu, with filename + access code) | ✅ Done |
| Unpublish from AIMEAT server | ✅ Done |
| Published Apps section (collapsible, shows published apps with view/remove) | ✅ Done |
| Generate Homepage prompt (creates AI prompt from current app list) | ✅ Done |
| Settings (theme dark/light, default open mode, AIMEAT URL) | ✅ Done |
| Export/Import JSON backup | ✅ Done |
| Clear All Data | ✅ Done |
| Config in localStorage | ✅ Done |
| Dark/light theme with glass-morphism UI | ✅ Done |
| Empty state (no apps / no matches) | ✅ Done |
| Stats footer (app count + storage size) | ✅ Done |
| Cortex Extensions bar (loads active extensions from server) | ✅ Done |
| Cortex popup (shows extension details: libs, schemas, prompts with copy buttons) | ✅ Done |

### What's Built — Server Side (`src/routes/apps.ts`)

| Feature | Status |
|---------|--------|
| `GET /v1/apps` — List all public apps | ✅ Done |
| `GET /v1/apps/:owner/:filename` — Download app file | ✅ Done |
| `GET /v1/apps/:owner/:filename/screenshot` — Serve screenshot | ✅ Done |
| `POST /v1/apps` — Upload app (auth required) | ✅ Done |
| `PATCH /v1/apps/:filename` — Update access code | ✅ Done |
| `DELETE /v1/apps/:filename` — Remove published app (auth required) | ✅ Done |
| Inline serve mode (`?mode=inline`) with CSP headers | ✅ Done |
| Access code protection on apps | ✅ Done |
| Screenshot upload alongside app | ✅ Done |
| Filename validation (safe characters only) | ✅ Done |
| App size limit (`appMaxSizeMb` config) | ✅ Done |

### What's Built — Cortex Extensions v2 (`src/routes/cortex.ts`)

The Cortex extensions backend is **fully implemented** with 11 endpoints, 7 component types, and 35+ E2E tests.

| Feature | Status |
|---------|--------|
| `GET /v1/cortex` — List extensions (filter by status, namespace, visibility) | ✅ Done |
| `POST /v1/cortex` — Install from YAML manifest + libraries | ✅ Done |
| `GET /v1/cortex/:name` — Extension details | ✅ Done |
| `DELETE /v1/cortex/:name` — Uninstall (cascade cleanup) | ✅ Done |
| `POST /v1/cortex/:name/activate` / `deactivate` | ✅ Done |
| `POST /v1/cortex/:name/visibility` — Toggle public/private | ✅ Done |
| `GET /v1/cortex/:name/prompts` — List prompts | ✅ Done |
| `GET /v1/cortex/:name/prompts/:promptName` — Get prompt (variable substitution) | ✅ Done |
| `GET /v1/cortex/:name/ontology` — Retrieve ontology | ✅ Done |
| `GET /v1/cortex/:name/libs/:libFile` — Serve JS library (cached) | ✅ Done |
| 7 component types: schema, prompt, action, board-template, ontology, seed-data, lib | ✅ Done |
| SQLite + MongoDB storage | ✅ Done |

### What's Built — Changelog (`src/services/site.ts`)

| Feature | Status |
|---------|--------|
| `SiteChangeLogEntry` type (action, summary, changedBy, changedAt) | ✅ Done |
| `addSiteChangeLog()` / `listSiteChangeLog()` storage methods | ✅ Done |
| Logged on: template upload, delete, import, cache invalidate | ✅ Done |

### What's Built — Integration

| Feature | Status |
|---------|--------|
| Profile page "Apps" tab (upload, manage, link to catalog) | ✅ Done |
| Portal "For Me" group (app creation flow + catalog link) | ✅ Done |
| i18n translations (en.json, fi.json) | ✅ Done |
| App catalog ↔ Cortex bar (shows active extension cards, popup with lib/schema/prompt details) | ✅ Done |

---

## What's NOT Implemented

### Priority 1 — Cortex ↔ App Catalog Prompt Integration

The Cortex bar in app-catalog.html shows active extensions and lets users copy `<script>` tags, API surfaces, and prompts. The missing piece is making Cortex extensions flow into app creation/improvement prompts automatically.

Cortex extensions are **server-side** — already installed on the node via `POST /v1/cortex`. The app catalog queries `GET /v1/cortex?status=active` and lets the user **pick which extensions to include** in each prompt generation. No client-side "install" flag needed.

#### 1.1 Cortex Picker in Prompt Generation Panel

When user triggers "New App", "Improve This App", or "Copy with AI Prompt", a **prompt generation panel** appears with:

1. **App description** text input (for new apps: what do you want the app to do? For improve: what to change?)
2. **"Include Cortex Extensions" checkbox** — when checked, shows the list of active extensions from the server
3. **Extension checkboxes** — user picks which extensions to include (e.g., "📊 Charts", "🎨 Canvas", "🧪 My Custom Extension")
4. **Live preview** — shows the generated prompt updating in real-time as user checks/unchecks extensions

Selected extensions inject: their prompt components (fetched via `GET /v1/cortex/:name/prompts`), `<script src>` tags for libs, and API surface documentation. The prompt tells the AI how to load and use each extension.

For "Improve This App", the current app's HTML source is also included in the prompt.

```
┌─ Generate Prompt ─────────────────────────────┐
│                                                │
│  App: tic-tac-toe.html                        │
│  Action: ○ New App  ● Improve This App        │
│                                                │
│  Description / Requirements:                   │
│  ┌──────────────────────────────────────────┐ │
│  │ Add a score tracker and sound effects    │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ☐ Include Cortex Extensions                  │
│  ┌──────────────────────────────────────────┐ │
│  │ ☑ 📊 Charts (aimeat-charts)             │ │
│  │ ☑ 🎨 Canvas (aimeat-canvas)             │ │
│  │ ☐ 🧪 My Custom Extension                │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  Preview:                                      │
│  ┌──────────────────────────────────────────┐ │
│  │ You are improving an AIMEAT app...       │ │
│  │ Node URL: http://localhost:40050         │ │
│  │                                          │ │
│  │ ## User Requirements                     │ │
│  │ Add a score tracker and sound effects    │ │
│  │                                          │ │
│  │ ## Available Extensions                  │ │
│  │ <script src=".../aimeat-charts.js">      │ │
│  │ API: AIMEAT.charts.ChartBuilder(...)     │ │
│  │ <script src=".../aimeat-canvas.js">      │ │
│  │ API: AIMEAT.canvas.DrawingCanvas(...)    │ │
│  │                                          │ │
│  │ ## Current App Source                    │ │
│  │ <!DOCTYPE html>...                       │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  [📋 Copy Prompt]                [Cancel]      │
└────────────────────────────────────────────────┘
```

**How Cortex extensions are used** (reference: `aimeat-charts.js`):
- Extension lib served from `/v1/cortex/:name/libs/:file` (cached)
- App loads it via `<script src>` tag
- JS exposes API on `AIMEAT.charts.*` (or `AIMEAT.canvas.*` etc.)
- Extension prompt explains the API surface so the AI knows how to use it
- Apps compose multiple extensions — e.g., a dashboard app uses Charts + Canvas + a custom data extension

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 1.2 Developing/Customizing a Cortex Extension

For users who want to **develop their own version** of a Cortex extension: export the extension's YAML manifest + lib files as editable files, modify them, and re-install via `POST /v1/cortex`.

This is a separate developer workflow — most users just use extensions via the picker.

**Complexity:** High  
**Files:** `src/static/app-catalog.html`, `src/routes/cortex.ts`

---

### Priority 2 — App Versioning

#### 2.1 Version History (Same Filename)

When a user re-publishes an app with the same filename, the previous version is kept as a version entry. The URL always serves the latest version by default.

```
GET /v1/apps/:owner/:filename                — latest version
GET /v1/apps/:owner/:filename?version=2      — specific version
GET /v1/apps/:owner/:filename/versions       — list all versions
DELETE /v1/apps/:owner/:filename?version=2   — delete specific version (owner only)
```

- Version number auto-increments on each publish (1, 2, 3, ...)
- Manifest's `version` field (semver) is display-only metadata
- Old versions are kept indefinitely — someone else might still be using them (especially if they purchased that version)
- Only the owner can delete specific old versions
- When an app is fully deleted (all versions), users who imported it or purchased it still have their copy (in their IndexedDB or marketplace transaction)

**Storage:** Each version is a separate blob in the apps storage table with a version number. The `apps` listing endpoint returns only the latest version's metadata.

**Complexity:** Medium  
**Files:** `src/routes/apps.ts`, storage layer

#### 2.2 Version Pinning on Import

When a user imports an app from another node's catalogue (via the AIMEAT tab in app-catalog.html), store the version number alongside the app in IndexedDB. Enable "Check for updates" that compares the local version with the latest on the source node.

**Complexity:** Easy  
**Files:** `src/static/app-catalog.html`

---

### Priority 3 — Client-Side UX Gaps

Missing features in `app-catalog.html` from the original design.

#### 3.1 Keyboard Shortcuts

Add global keyboard shortcuts:
- `Ctrl+N` / `Cmd+N` — Open "Add App" dialog
- `Ctrl+F` / `Cmd+F` — Focus search input
- `Escape` — Close iframe view or modal

**Complexity:** Easy  
**Files:** `src/static/app-catalog.html`

#### 3.2 Drag & Drop Reordering

Allow users to drag app cards to custom positions. Persist order in IndexedDB (add `sortOrder` field to app records).

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 3.3 "Recently Opened" Section

Show a horizontal strip of recently launched apps at the top of the grid. Uses existing `lastOpenedAt` field — just needs a UI section showing the 5 most recent.

**Complexity:** Easy  
**Files:** `src/static/app-catalog.html`

#### 3.4 AIMEAT Memory Sync

Sync launcher config to AIMEAT Memory key `app-launcher/config` so preferences persist across devices/browsers. When AIMEAT URL is configured and user is authenticated:
- On settings save → `PUT /v1/memory/app-launcher/config`
- On page load → `GET /v1/memory/app-launcher/config` → merge with localStorage

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 3.5 Improvement/Iteration Prompts

Two prompt buttons in the app catalog that open the Cortex picker panel (1.1):
1. **"Improve this app"** — pre-fills the panel with "Improve" mode and the app's source
2. **"Generate new app idea"** — pre-fills the panel with "New App" mode and empty description

These directly use the Cortex picker panel from 1.1, so they automatically include the user's description, selected extensions, and live preview.

**Complexity:** Medium (builds on 1.1)  
**Files:** `src/static/app-catalog.html`

---

### Priority 4 — API Enhancements

Server-side features from the AppStore plan.

#### 4.1 App Manifest

Add a structured manifest alongside each app file. The manifest is required for search, categories, marketplace pricing, and version display.

```typescript
interface AppManifest {
  app_id: string;              // URL-safe slug (= filename without .html)
  name: string;                // Human-readable name
  description: string;         // 1–2 sentence description
  version: string;             // Semver (display-only, version number auto-increments)
  category: string;            // game, productivity, social, dashboard, utility, etc.
  tags: string[];              // Freeform tags
  icon?: string;               // Emoji or URL
  author_display: string;      // Display name
  author_gaii: string;         // Agent GAII
  uses_memory: boolean;        // AIMEAT feature flags
  uses_boards: boolean;
  uses_storage: boolean;
  uses_wallet: boolean;
  uses_cortex: string[];       // Cortex extensions used (e.g., ["aimeat-charts", "aimeat-canvas"])
  published_at: string;        // ISO timestamp
  updated_at: string;          // ISO timestamp of latest version
  version_number: number;      // Auto-incremented version (1, 2, 3, ...)
  downloads: number;           // Counter
  price_morsels?: number;      // Marketplace price (0 or absent = free)
  license_type?: 'single' | 'lifetime';  // Marketplace license type
}
```

Manifest is submitted as part of `POST /v1/apps` body alongside the HTML content.

**Complexity:** High  
**Files:** `src/routes/apps.ts`, storage layer

#### 4.2 Catalogue Search & Filter API

The current `GET /v1/apps` returns a flat list. Add query parameters:

```
GET /v1/apps
  ?category=game          — filter by category tag
  ?q=tic-tac              — search name/description
  ?tag=multiplayer        — filter by tag
  ?sort=newest|popular    — sort order
  ?limit=20&offset=0      — pagination
  ?free_only=true         — exclude paid apps
```

Requires manifest data (4.1) to be stored server-side.

**Complexity:** Medium  
**Files:** `src/routes/apps.ts`, storage layer  
**Dependencies:** 4.1 (manifest)

#### 4.3 Download Counter

Increment a download counter each time `GET /v1/apps/:owner/:filename` is called. Surface it in `GET /v1/apps` listing and in the manifest.

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`, storage layer

#### 4.4 Board Announcement on Publish

When an app is published via `POST /v1/apps`, optionally auto-post an announcement to the `apps` board. Opt-in via `announce: true` flag in the POST body.

**Complexity:** Medium  
**Files:** `src/routes/apps.ts`

#### 4.5 App Changelog Integration

Extend the existing `SiteChangeLogEntry` system (currently used for portal template operations) to also log app publish/unpublish/update events. The infrastructure already exists in `src/services/site.ts`.

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`, `src/services/site.ts`

---

### Priority 5 — Marketplace (Morsel Economy)

App marketplace with morsel-based payments. Enabled via `AIMEAT_APP_MARKETPLACE_PAYMENTS` config flag. When disabled, all apps are free to browse/download. When enabled, apps CAN have a price and the payment flow kicks in.

#### 5.1 Marketplace Config Flag

```env
AIMEAT_APP_MARKETPLACE_PAYMENTS=false   # default: disabled
```

When `false`: all marketplace-related fields in manifest are ignored. `GET /v1/apps` returns all apps freely. No payment UI.

When `true`: apps with `price_morsels > 0` require payment before download. Free apps are unaffected.

**Complexity:** Easy  
**Files:** `src/config.ts`, `.env.example`, `src/routes/apps.ts`

#### 5.2 License Types

Two license models (kept simple):

| Type | Behavior |
|------|----------|
| `single` | Buyer pays once, gets the **specific version** at time of purchase forever. New versions require a new purchase. |
| `lifetime` | Buyer pays once, gets **all future versions** for free. The cryptographic transaction event records the license type. |

Default: `single` (if not specified in manifest).

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`, manifest schema

#### 5.3 Marketplace Transaction Storage

**Domain separation:**

| Domain | Responsibility | Storage |
|--------|----------------|---------|
| **Wallet** (`src/services/morsel.ts`) | Balance tracking, morsel transfers, transaction history (amounts, from/to, reason) | Existing wallet tables |
| **Marketplace** (`src/routes/marketplace.ts`) | Purchase records, license verification, app content snapshots, cryptographic proofs | New `marketplace_transactions` table |

The wallet transaction references the marketplace transaction ID (e.g., `reason: "app_purchase"`, `reference: "mktx_abc123"`). The marketplace transaction contains the full data.

```typescript
interface MarketplaceTransaction {
  transaction_id: string;           // unique ID (e.g., "mktx_...")
  buyer_ghii: string;               // purchaser GHII identity
  seller_ghii: string;              // publisher GHII identity
  app_filename: string;             // original filename
  app_name: string;                 // display name from manifest
  app_version_number: number;       // version at time of purchase
  license_type: 'single' | 'lifetime';
  price_morsels: number;            // what was paid
  purchased_at: string;             // ISO timestamp

  // FULL CONTENT — not references. Self-contained so the purchase
  // survives even if the app is deleted, unpublished, or the seller's node goes offline.
  app_content: string;              // complete HTML (base64)
  app_manifest: object;             // full manifest snapshot
  app_screenshot?: string;          // screenshot if any (base64)

  // Cryptographic proof
  signature: string;                // Ed25519 signature over the above fields
  node_id: string;                  // originating node ID
  node_public_key: string;          // node's public key for verification
}
```

**Key principle:** The marketplace transaction is a **self-contained immutable receipt**. It contains the complete app content, not just a reference. Even if the seller unpublishes the app or the seller's node goes offline, the buyer still has their purchased version with cryptographic proof of legitimate purchase.

**Complexity:** High  
**Files:** new `src/routes/marketplace.ts`, `src/storage/interface.ts`, storage implementations, `src/services/morsel.ts` (wallet reference)

#### 5.4 Purchase Flow

```
POST /v1/marketplace/purchase
{
  "app_filename": "cool-game.html",
  "app_owner": "seller-name"
}
```

Server-side flow:
1. Verify `AIMEAT_APP_MARKETPLACE_PAYMENTS` is enabled
2. Look up app manifest → get `price_morsels` and `license_type`
3. Check if buyer already has a valid license (lifetime license = skip payment for updates)
4. Debit buyer's wallet (`morselBalance -= price_morsels`)
5. Credit seller's wallet (`morselBalance += price_morsels`)
6. Create marketplace transaction with full app content snapshot
7. Create wallet transaction referencing the marketplace transaction
8. Return the marketplace transaction (buyer receives their copy)

```
GET /v1/marketplace/purchases              — list buyer's purchases
GET /v1/marketplace/purchases/:txId        — get specific purchase (includes full content)
GET /v1/marketplace/sales                  — list seller's sales
```

**Complexity:** High  
**Files:** `src/routes/marketplace.ts`, `src/services/morsel.ts`

---

### Priority 6 — Documentation & Prompts

#### 6.1 In-App Publish Button Documentation

Document in AIMEAT-OS.md that AI-generated apps should include a "Publish" button using `document.documentElement.outerHTML` self-capture → `POST /v1/apps`. The API already supports this.

**Complexity:** Easy (documentation)  
**Files:** `public/aimeat-os.md`

#### 6.2 Purpose-Specific Prompt Packages (Dynamic API)

Serve pre-built prompt packages via API. The server dynamically fills in the user's node URL, available Cortex extensions, owner name, etc. before returning the prompt. Base templates also ship in AIMEAT-OS.md.

```
GET /v1/portal/prompts                     — list available prompt packages
GET /v1/portal/prompts/:promptId           — get prompt (node values auto-filled)
```

| Prompt ID | Purpose | Output |
|-----------|---------|--------|
| `app-builder-general` | Custom app | User interview → bespoke app |
| `app-builder-game` | Multiplayer game | Game with lobby, turns, scoreboard |
| `app-builder-notes` | Note-taking app | Notes with folders, tags, search |
| `app-builder-dashboard` | Data dashboard | Charts + tables + live data (uses Cortex) |
| `app-builder-chat` | Chat room | Real-time messaging via boards |

Prompt packages can reference multiple Cortex extensions. A "dashboard builder" prompt would tell the AI to use aimeat-charts for data visualization and aimeat-canvas for annotations. Apps are compositions of Cortex building blocks.

**Complexity:** Medium  
**Files:** `src/routes/portal.ts` or new `src/routes/prompts.ts`, `public/aimeat-os.md`

#### 6.3 "Share This App" Prompt Generation

A button in apps that generates a prompt describing the app, so another user can paste it into any AI and get a functionally equivalent app regenerated. Enables prompt-based app distribution as an alternative to file sharing.

**Complexity:** Easy (prompt/documentation)  
**Files:** AIMEAT-OS.md, prompt templates

---

### Priority 7 — Security Hardening

For multi-user / public-facing nodes.

#### 7.1 Sandbox Iframe Serving

Current state: iframe uses `sandbox="allow-scripts allow-forms allow-popups"` (no `allow-same-origin` — already more secure than originally documented). Verify this is sufficient and document the security model.

**Complexity:** Easy (audit + documentation)  
**Files:** `src/static/app-catalog.html`

#### 7.2 PostMessage Auth Protocol

For sandbox iframe mode, apps can't access the parent's JWT from localStorage. Define a `postMessage` protocol:
- App iframe sends: `{ type: 'aimeat-request-auth' }`
- Parent responds: `{ type: 'aimeat-auth', jwt: '...' }`

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`, AIMEAT-OS.md

#### 7.3 Per-App Storage Quota

Add a limit on number of apps per agent. The global `appMaxSizeMb` config already limits per-upload size, but there's no limit on count.

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`

---

### Priority 8 — Federated App Catalogue

Cross-node app discovery when nodes are peered.

#### 8.1 Federated App Listing

When two nodes peer with `catalogue.includeApps: true`, browsing `/v1/apps` on Node B also shows apps from Node A. Apps are always served from their home node.

```
GET /v1/apps?include_peers=true
```

**Complexity:** High  
**Files:** `src/routes/apps.ts`, peering configuration, federation layer  
**Dependencies:** Node peering must be implemented first

#### 8.2 Cross-Node App Search

Forward search queries to peered nodes and aggregate results.

**Complexity:** High  
**Files:** `src/routes/apps.ts`, federation layer  
**Dependencies:** 8.1, node peering

---

## Implementation Roadmap

### Phase A — Quick Wins (UX + API) ✅ COMPLETED

| Task | Items | Status |
|------|-------|--------|
| A1 | Keyboard shortcuts (3.1) | ✅ Done |
| A2 | "Recently Opened" section (3.3) | ✅ Done |
| A3 | Download counter (4.3) | ✅ Done |
| A4 | App changelog integration (4.5) | ✅ Done |
| A5 | Security audit of iframe sandbox (7.1) | ✅ Done — blob URL launch, CSP hardened |

### Phase B — Cortex ↔ Catalog Integration ✅ COMPLETED

| Task | Items | Status |
|------|-------|--------|
| B1 | Cortex picker in prompt generation panel (1.1) | ✅ Done — full Prompt Builder overlay |
| B2 | Improvement/iteration prompt buttons using the picker (3.5) | ✅ Done — ✨ Generate with AI, Improve with AI |

### Phase C — Versioning & Manifest ✅ COMPLETED

| Task | Items | Status |
|------|-------|--------|
| C1 | App manifest support (4.1) | ✅ Done — AppManifest type, storage, routes |
| C2 | Version history — same filename, version number (2.1) | ✅ Done — apps table, auto-increment, /versions endpoint |
| C3 | Catalogue search/filter API (4.2) | ✅ Done — category, q, tag, sort, limit, offset, free_only |
| C4 | Version pinning on import (2.2) | ✅ Done — aimeatOwner, aimeatFilename, aimeatVersion stored in IndexedDB |

### Phase D — UX Polish

| Task | Items |
|------|-------|
| D1 | Drag & drop reordering (3.2) |
| D2 | AIMEAT Memory sync (3.4) |

### Phase E — Marketplace

| Task | Items |
|------|-------|
| E1 | Marketplace config flag `AIMEAT_APP_MARKETPLACE_PAYMENTS` (5.1) |
| E2 | License types — single + lifetime (5.2) |
| E3 | Marketplace transaction storage — dedicated table (5.3) |
| E4 | Purchase flow + wallet integration (5.4) |

### Phase F — Documentation & Prompts

| Task | Items |
|------|-------|
| F1 | In-app publish button docs (6.1) |
| F2 | Purpose-specific prompt packages — dynamic API (6.2) |
| F3 | "Share This App" prompt generation (6.3) |
| F4 | Board announcement on publish (4.4) |

### Phase G — Security

| Task | Items |
|------|-------|
| G1 | PostMessage auth protocol (7.2) |
| G2 | Per-app storage quota (7.3) |

### Phase H — Federation

| Task | Items |
|------|-------|
| H1 | Federated app listing (8.1) |
| H2 | Cross-node app search (8.2) |

### Phase X — Lower Priority

| Task | Items |
|------|-------|
| X1 | Cortex extension developer workflow — export/modify/re-install (1.2) |

**Dependencies:**
- Phase C (versioning) should come before Phase E (marketplace) — marketplace needs version numbers for license tracking
- Phase H requires node peering to be implemented
- Phase B (Cortex picker) should come before Phase F (prompt packages) — packages use the same picker infrastructure

---

## Domain Responsibilities

| Domain | Owns | Doesn't Own |
|--------|------|-------------|
| **Wallet** (`morsel.ts`) | Balance tracking, morsel transfers between agents, transaction history (amounts, from/to, reason, reference ID) | App content, license verification, purchase proofs |
| **Marketplace** (`marketplace.ts`) | Purchase records, license verification (has buyer purchased this app?), full app content snapshots, cryptographic proofs, seller sales history | Balance changes — delegates to wallet for actual morsel transfer |
| **Apps** (`apps.ts`) | App storage, versioning, manifest, search, publish/unpublish | Payment — delegates to marketplace when price > 0 |
| **Cortex** (`cortex.ts`) | Extension lifecycle, prompts, libs, schemas | App creation — only provides building blocks for apps |

---

## Files Reference

| File | Role |
|------|------|
| `aimeat/src/static/app-catalog.html` | Client-side app catalog (standalone HTML, 3,049 lines) |
| `aimeat/src/routes/apps.ts` | Server-side app API routes (6 endpoints + versioning) |
| `aimeat/src/routes/cortex.ts` | Cortex extensions backend (11 endpoints, fully implemented) |
| `aimeat/src/routes/marketplace.ts` | Marketplace transactions (NEW — to be created) |
| `aimeat/src/routes/profile.ts` | Profile "Apps" tab integration |
| `aimeat/src/routes/portal-human.ts` | Portal app creation flow |
| `aimeat/src/services/site.ts` | Site changelog service |
| `aimeat/src/services/morsel.ts` | Morsel economy / wallet service |
| `aimeat/src/storage/repositories/node.repository.ts` | Storage (SQLite/MongoDB) |
| `aimeat/src/config.ts` | Config (add `AIMEAT_APP_MARKETPLACE_PAYMENTS`) |
| `aimeat/locales/en.json` | English translations |
| `aimeat/locales/fi.json` | Finnish translations |
| `aimeat/public/aimeat-os.md` | App development guide (prompt reference) |
| `aimeat/test/cortex-e2e.ts` | Cortex E2E tests (35+ cases) |
