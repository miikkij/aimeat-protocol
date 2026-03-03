# App Launcher - Personal Dashboard Design

**Date:** 2026-03-03
**Status:** Approved
**Branch:** feat/agent-chat-separation

## Problem

Users create multiple HTML+CSS+JS apps (via AI or manually) and need a single place to organize, manage, and launch them. Currently apps are scattered across directories and bookmarks.

## Solution

A **standalone HTML file** (`app-launcher.html`) that serves as a personal app launcher. It runs entirely client-side, stores app data in IndexedDB, and optionally connects to AIMEAT's `/v1/apps` API for importing server-hosted apps.

## Architecture

```
app-launcher.html (single file, pure client-side)
├── App Registry (IndexedDB)
│   ├── apps store: app records with metadata
│   └── config store: user preferences
├── UI Layer
│   ├── Grid/List view with app cards
│   ├── Tag-based grouping
│   ├── Search/filter
│   └── Settings panel
├── Inline Bundler (for ZIP imports)
│   └── Extracts ZIP → merges into single HTML blob
└── AIMEAT Connector (optional)
    └── Fetches GET /v1/apps when server URL configured
```

## Data Model

### App Record (IndexedDB)

```js
{
  id: "uuid",              // auto-generated
  name: "Todo App",        // user-editable
  description: "",         // optional
  source: "local"|"url"|"aimeat"|"zip",
  url: "https://..." | null,           // for URL-based apps
  blob: "base64..." | null,            // for stored apps (HTML content)
  tags: ["productivity", "tools"],      // user-defined groups
  openMode: "tab" | "iframe",          // per-app preference
  icon: "emoji or base64",             // visual identifier
  screenshot: "base64..." | null,      // optional preview
  favorite: false,                      // sticky top
  addedAt: "ISO date",
  lastOpenedAt: "ISO date"
}
```

### Config (localStorage)

```js
{
  theme: "dark" | "light",
  defaultOpenMode: "tab" | "iframe",
  aimeatUrl: "" | "http://localhost:40050",
  language: "en" | "fi"
}
```

## App Sources

### 1. URL Link
User pastes a URL. Only the URL is stored. App opens directly from the URL.

### 2. HTML File (drag & drop / file input)
File content is read via FileReader API and stored as base64 in IndexedDB. Works offline after import.

### 3. ZIP Package (inline bundler)
ZIP is extracted client-side (using JSZip or equivalent bundled inline). All files are merged into a single HTML blob:
- `<link href="style.css">` → `<style>...file contents...</style>`
- `<script src="app.js">` → `<script>...file contents...</script>`
- `<img src="logo.png">` → `<img src="data:image/png;base64,...">`

The resulting HTML blob is stored in IndexedDB like a single-file app.

**Limitations:**
- Dynamic `import()` calls won't resolve
- `fetch('./local-file.json')` won't work within bundled apps
- Very large assets inflate the blob size

### 4. AIMEAT Import
When AIMEAT server URL is configured, user clicks "Import from AIMEAT" which:
1. Fetches `GET {aimeatUrl}/v1/apps`
2. Shows available apps in a selection dialog
3. User picks apps and chooses: link mode (store URL) or offline mode (download content to IndexedDB)

## App Launching

| Mode | URL-based app | IndexedDB-stored app |
|------|--------------|---------------------|
| New tab | `window.open(url)` | `URL.createObjectURL(new Blob([html], {type:'text/html'}))` → `window.open(blobUrl)` |
| Iframe | `<iframe src="url">` | `iframe.srcdoc = htmlContent` (single-file) or blob URL |

Iframe uses `sandbox="allow-scripts allow-same-origin"` for security.

## UI Layout

### Main View (Grid)
```
┌─────────────────────────────────────────────────┐
│  My Apps                        [Search] [+] [⚙]│
│─────────────────────────────────────────────────│
│  [All] [Favorites] [Work] [Games] [+tag]        │
│─────────────────────────────────────────────────│
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ icon     │  │ icon     │  │ icon     │      │
│  │ App Name │  │ App Name │  │ App Name │      │
│  │ source   │  │ source   │  │ source   │      │
│  │ [Tab][⬜]│  │ [Tab][⬜]│  │ [Tab][⬜]│      │
│  └──────────┘  └──────────┘  └──────────┘      │
│─────────────────────────────────────────────────│
│  N apps  |  X MB used                           │
└─────────────────────────────────────────────────┘
```

### Iframe View
```
┌─────────────────────────────────────────────────┐
│  ← Back    App Name                      [↗][✕] │
│─────────────────────────────────────────────────│
│  ┌─────────────────────────────────────────────┐│
│  │              App content (iframe)           ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### Settings Panel
- Theme (dark/light)
- Default open mode (tab/iframe)
- AIMEAT server URL
- Export/Import backup (JSON)
- Clear all data

### Context Menu (right-click on app card)
- Edit (name, description, icon, tags)
- Delete
- Toggle open mode (tab ↔ iframe)
- Toggle favorite
- Open in opposite mode

## Implementation Priorities

| Priority | Feature | Complexity |
|----------|---------|-----------|
| P0 (MVP) | IndexedDB storage, URL add, drag&drop HTML, tab open, grid view | Medium |
| P0 (MVP) | Tag grouping, search, emoji icons | Easy |
| P1 | Iframe open, context menu | Medium |
| P1 | ZIP inline bundler | High |
| P2 | AIMEAT integration, export/import | Medium |
| P2 | Theme, drag&drop reorder | Easy |

## AI Prompt Strategy

### Prompt to generate the launcher:

> "Create a single HTML file called `app-launcher.html` that works as a personal app launcher. It stores an app registry in IndexedDB. Features:
> - Add apps via: URL link, HTML file drag & drop, or ZIP package import (inline bundler that merges ZIP into single HTML)
> - Grid view with app cards (name, emoji icon, source type, tags)
> - Tag-based grouping + favorites
> - Open in new tab (blob URL) or iframe (srcdoc)
> - Real-time search filter
> - Settings: theme (dark/light), default open mode, export/import JSON backup
> - Optional AIMEAT integration: if server URL is set, 'Import from AIMEAT' button fetches GET /v1/apps
> - Context menu (right-click): edit, delete, change open mode
> - Everything in one file, no external dependencies"

### Iterative prompts for enhancement:

1. "Add keyboard shortcuts (Ctrl+N = new app, Ctrl+F = search, Esc = close iframe)"
2. "Add drag & drop reordering of app cards"
3. "Add a 'recently opened' section at the top"
4. "Add AIMEAT Memory sync: save config to AIMEAT Memory key 'app-launcher/config'"

## Constraints & Risks

1. **IndexedDB size:** Browser-dependent (50MB to unlimited). Hundreds of apps fit easily.
2. **Blob URL lifecycle:** Created URLs persist for the session. Tab opening keeps them alive until tab closes.
3. **`file://` CORS:** AIMEAT connector won't work if launcher is opened via `file://`. Solution: AIMEAT integration only works when served from a web server, or add CORS headers to AIMEAT server.
4. **Security:** Iframe sandbox prevents loaded apps from accessing launcher data.
5. **ZIP bundler limitations:** Only works for static assets. Dynamic imports and fetch() to local files won't resolve in the bundled blob.

## Future Extensions

- **Service Worker:** When launcher is served from AIMEAT (`/v1/my-apps`), register a SW for full multi-file app support with virtual file system
- **AIMEAT Memory sync:** Persist launcher config to server for cross-device sync
- **App sharing:** One-click publish to AIMEAT app gallery
- **App templates:** Pre-built app starters users can customize
