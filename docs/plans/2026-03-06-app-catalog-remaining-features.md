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

### Priority 1 — Cortex ↔ App Catalog Integration (Deeper)

The Cortex bar in app-catalog.html currently shows active extensions and lets users copy `<script>` tags, API surfaces, and prompts. But the integration can go deeper.

#### 1.1 Auto-Include Cortex Prompts in "New App" / "Improve App" Flows

**What "install" means:** When a user "installs" a Cortex extension in the app catalog context, it means the extension's **prompt instructions** are automatically included when generating a "New App" or "Improve App" prompt. The user doesn't download the extension code — they get the prompt snippets that tell the AI to use the extension's libraries, schemas, and patterns.

Implementation:
- Add an "installed" flag per Cortex extension in the app catalog's IndexedDB config
- When "Copy with AI Prompt" is used from View Source, or when generating a new app idea, automatically append the installed extensions' prompt components and lib `<script>` tags
- Cortex popup should have an "Install" toggle (not download — just marks it as active for prompt generation)

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 1.2 Cortex Extension as Prompt Add-On for App Creation

When creating a new app (via the AI prompt flow), the catalog should let the user pick which Cortex extensions to include. Selected extensions' prompts + lib references are appended to the generated prompt automatically.

Example flow:
1. User clicks "Generate new app" or "Improve this app"
2. Catalog shows checkboxes for installed Cortex extensions (e.g., "📊 Charts", "🎨 Canvas")
3. Checked extensions' prompt components + `<script src="...">` tags are injected into the prompt
4. User pastes prompt into AI → AI uses the extension libraries

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 1.3 Developing/Customizing a Cortex Extension

For users who want to **develop their own version** of a Cortex extension (not just use it): provide a download flow that exports the extension's manifest + libs as editable files, and a re-upload flow to install the modified version.

This is a separate workflow from "install for prompt use" — it's for extension developers.

**Complexity:** High  
**Files:** `src/static/app-catalog.html`, `src/routes/cortex.ts`

---

### Priority 2 — Client-Side UX Gaps

Missing features in `app-catalog.html` from the original design.

#### 2.1 Keyboard Shortcuts

Add global keyboard shortcuts:
- `Ctrl+N` / `Cmd+N` — Open "Add App" dialog
- `Ctrl+F` / `Cmd+F` — Focus search input
- `Escape` — Close iframe view or modal

**Complexity:** Easy  
**Files:** `src/static/app-catalog.html`

#### 2.2 Drag & Drop Reordering

Allow users to drag app cards to custom positions. Persist order in IndexedDB (add `sortOrder` field to app records).

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 2.3 "Recently Opened" Section

Show a horizontal strip of recently launched apps at the top of the grid. Uses existing `lastOpenedAt` field — just needs a UI section showing the 5 most recent.

**Complexity:** Easy  
**Files:** `src/static/app-catalog.html`

#### 2.4 AIMEAT Memory Sync

Sync launcher config to AIMEAT Memory key `app-launcher/config` so preferences persist across devices/browsers. When AIMEAT URL is configured and user is authenticated:
- On settings save → `PUT /v1/memory/app-launcher/config`
- On page load → `GET /v1/memory/app-launcher/config` → merge with localStorage

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

#### 2.5 Improvement/Iteration Prompts

**Source:** `jounis_ideas.md` lines 195–196

Two prompt buttons in the app catalog:
1. **"Improve this app"** — generates a prompt users can paste into any AI to enhance an existing app (includes the app's current HTML + any installed Cortex extension prompts as context)
2. **"Generate new app idea"** — generates a brainstorming prompt that produces fresh app concepts based on existing apps and user interests

Note: "Copy with AI Prompt" already exists in View Source, but it needs to integrate with Cortex extension prompts (see 1.1).

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`

---

### Priority 3 — API Enhancements

Server-side features from the AppStore plan.

#### 3.1 Catalogue Search & Filter API

The current `GET /v1/apps` returns a flat list. Add query parameters:

```
GET /v1/apps
  ?category=game          — filter by category tag
  ?q=tic-tac              — search name/description
  ?tag=multiplayer        — filter by tag
  ?sort=newest|popular    — sort order
  ?limit=20&offset=0      — pagination
```

This requires storing app metadata (category, tags, description, download count) server-side. Currently only filename, owner, size, and mime_type are available.

**Complexity:** Medium  
**Files:** `src/routes/apps.ts`, `src/storage/repositories/node.repository.ts`

#### 3.2 App Manifest Support

**Design ref:** `aimeat-appstore-plan.md` §5

Add a structured manifest alongside each app file:

```typescript
interface AppManifest {
  app_id: string;              // URL-safe slug
  name: string;                // Human-readable name
  description: string;         // 1–2 sentence description
  version: string;             // Semver
  category: string;            // game, productivity, social, dashboard, utility, etc.
  tags: string[];              // Freeform tags
  icon?: string;               // Emoji or URL
  author_display: string;      // Display name
  author_gaii: string;         // Agent GAII
  uses_memory: boolean;        // AIMEAT feature flags
  uses_boards: boolean;
  uses_storage: boolean;
  uses_wallet: boolean;
  published_at: string;        // ISO timestamp
  downloads: number;           // Counter
}
```

**Complexity:** High  
**Files:** `src/routes/apps.ts`, storage layer

#### 3.3 Download Counter

Increment a download counter each time `GET /v1/apps/:owner/:filename` is called. Surface it in `GET /v1/apps` listing.

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`, storage layer

#### 3.4 Board Announcement on Publish

When an app is published via `POST /v1/apps`, optionally auto-post an announcement to the `apps` board. Could be an opt-in `announce: true` flag in the POST body.

**Complexity:** Medium  
**Files:** `src/routes/apps.ts`

#### 3.5 App Changelog Integration

Extend the existing `SiteChangeLogEntry` system (currently used for portal template operations) to also log app publish/unpublish/update events. The infrastructure already exists in `src/services/site.ts`.

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`, `src/services/site.ts`

---

### Priority 4 — Documentation & Prompts

#### 4.1 In-App Publish Button Documentation

Document in AIMEAT-OS.md that AI-generated apps should include a "Publish" button using `document.documentElement.outerHTML` self-capture → `POST /v1/apps`. The API already supports this.

**Complexity:** Easy (documentation)  
**Files:** `public/aimeat-os.md`

#### 4.2 Purpose-Specific Prompt Packages

**Design ref:** `aimeat-appstore-plan.md` §10

Serve pre-built prompt packages for common app types:

| Prompt ID | Purpose | Output |
|-----------|---------|--------|
| `app-builder-general` | Custom app | User interview → bespoke app |
| `app-builder-game` | Multiplayer game | Game with lobby, turns, scoreboard |
| `app-builder-notes` | Note-taking app | Notes with folders, tags, search |
| `app-builder-dashboard` | Data dashboard | Charts, tables, live data |
| `app-builder-chat` | Chat room | Real-time messaging via boards |

**Complexity:** Medium  
**Files:** `src/routes/portal.ts` or new `src/routes/prompts.ts`

#### 4.3 "Share This App" Prompt Generation

A button in apps that generates a prompt describing the app, so another user can paste it into any AI and get a functionally equivalent app regenerated. Enables prompt-based app distribution.

**Complexity:** Easy (prompt/documentation)  
**Files:** AIMEAT-OS.md, prompt templates

---

### Priority 5 — Security Hardening

For multi-user / public-facing nodes.

#### 5.1 Sandbox Iframe Serving

Current state: iframe uses `sandbox="allow-scripts allow-forms allow-popups"` (no `allow-same-origin` — already more secure than originally documented). Verify this is sufficient and document the security model.

**Complexity:** Easy (audit + documentation)  
**Files:** `src/static/app-catalog.html`

#### 5.2 PostMessage Auth Protocol

For sandbox iframe mode, apps can't access the parent's JWT from localStorage. Define a `postMessage` protocol:
- App iframe sends: `{ type: 'aimeat-request-auth' }`
- Parent responds: `{ type: 'aimeat-auth', jwt: '...' }`

**Complexity:** Medium  
**Files:** `src/static/app-catalog.html`, AIMEAT-OS.md

#### 5.3 Per-App Storage Quota

Add a limit on number of apps per agent. The global `appMaxSizeMb` config already limits per-upload size, but there's no limit on count.

**Complexity:** Easy  
**Files:** `src/routes/apps.ts`

---

### Priority 6 — Federated App Catalogue

Cross-node app discovery when nodes are peered.

#### 6.1 Federated App Listing

**Design ref:** `docs/ghii-identity-and-network-plan.md` §9.1

When two nodes peer with `catalogue.includeApps: true`, browsing `/v1/apps` on Node B should also show apps from Node A. Apps are always served from their home node.

```
GET /v1/apps?include_peers=true
```

**Complexity:** High  
**Files:** `src/routes/apps.ts`, peering configuration, federation layer  
**Dependencies:** Node peering must be implemented first

#### 6.2 Cross-Node App Search

Forward search queries to peered nodes and aggregate results.

**Complexity:** High  
**Files:** `src/routes/apps.ts`, federation layer  
**Dependencies:** 6.1, node peering

---

## Implementation Roadmap

### Phase A — Quick Wins (UX + API)

| Task | Items |
|------|-------|
| A1 | Keyboard shortcuts (2.1) |
| A2 | "Recently Opened" section (2.3) |
| A3 | Download counter (3.3) |
| A4 | App changelog integration (3.5) |
| A5 | Security audit of iframe sandbox (5.1) |

### Phase B — Cortex ↔ Catalog Integration

| Task | Items |
|------|-------|
| B1 | Auto-include Cortex prompts in app creation flows (1.1) |
| B2 | Cortex extension picker in new/improve app prompt (1.2) |
| B3 | Improvement/iteration prompt buttons with Cortex support (2.5) |

### Phase C — API & Publishing

| Task | Items |
|------|-------|
| C1 | Catalogue search/filter API (3.1) |
| C2 | App manifest support (3.2) |
| C3 | Board announcement on publish (3.4) |
| C4 | In-app publish button docs (4.1) |

### Phase D — UX Polish

| Task | Items |
|------|-------|
| D1 | Drag & drop reordering (2.2) |
| D2 | AIMEAT Memory sync (2.4) |

### Phase E — Security

| Task | Items |
|------|-------|
| E1 | PostMessage auth protocol (5.2) |
| E2 | Per-app storage quota (5.3) |

### Phase F — Prompts & Ecosystem

| Task | Items |
|------|-------|
| F1 | Purpose-specific prompt packages (4.2) |
| F2 | "Share This App" prompt generation (4.3) |

### Phase G — Federation

| Task | Items |
|------|-------|
| G1 | Federated app listing (6.1) |
| G2 | Cross-node app search (6.2) |

**Dependencies:** Phase G requires node peering to be implemented. Cortex extension developer workflow (1.3) is lower priority and can be done alongside phase F.

---

## Files Reference

| File | Role |
|------|------|
| `aimeat/src/static/app-catalog.html` | Client-side app catalog (standalone HTML, 3,049 lines) |
| `aimeat/src/routes/apps.ts` | Server-side app API routes (6 endpoints) |
| `aimeat/src/routes/cortex.ts` | Cortex extensions backend (11 endpoints, fully implemented) |
| `aimeat/src/routes/profile.ts` | Profile "Apps" tab integration |
| `aimeat/src/routes/portal-human.ts` | Portal app creation flow |
| `aimeat/src/services/site.ts` | Site changelog service |
| `aimeat/src/storage/repositories/node.repository.ts` | Storage (SQLite/MongoDB) |
| `aimeat/locales/en.json` | English translations |
| `aimeat/locales/fi.json` | Finnish translations |
| `aimeat/public/aimeat-os.md` | App development guide (prompt reference) |
| `aimeat/test/cortex-e2e.ts` | Cortex E2E tests (35+ cases) |
