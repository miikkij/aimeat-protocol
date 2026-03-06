# Admin Dashboard SPA Migration Plan

**Date:** 2026-03-06  
**Status:** Planned  
**Goal:** Replace the 1,779-line SSR monolith (`admin-dashboard.ts`) with a modular Preact SPA using the same architecture as the profile/portal pages.

---

## 1. Background

The admin dashboard is the last remaining SSR page in AIMEAT. It generates the entire HTML page server-side via a single TypeScript function (`buildDashboardHtml`), embedding ~150 lines of CSS and ~1,400 lines of JavaScript in an inline `<script>` block. This architecture causes:

- **Fragile string escaping** — quote escaping bugs (`\'` vs `\\'`) break the entire page silently
- **Zero modularity** — 25 pages in one file, all functions global, no component reuse
- **No caching** — entire page regenerated on every request
- **Inconsistent UX** — different auth flow, different styling, different i18n from the rest of the app
- **Difficult maintenance** — any change risks breaking unrelated functionality

The profile SPA (`public/views/profile.js`) demonstrates the target architecture: 16 Preact tab components, 14 service modules, shared hooks and i18n, all loaded as ES modules via the SPA shell.

---

## 2. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **URL structure** | `/v1/admin?tab=overview` (query params) | Consistent with profile (`/v1/profile?tab=wallet`) |
| **Layout** | Vertical sidebar + content area | 25+ pages need grouped navigation; horizontal tabs won't fit |
| **Auth** | Reuse standard `aimeat-auth.js` | Eliminate duplicate login form; consistent auth experience |
| **Translations** | Reorganize under `admin.dashboard.*` | Clean namespace, no collision with profile keys |
| **Services** | Dedicated `services/admin.js` | Admin endpoints are operator-only; separate from user-facing services |
| **Migration** | Complete replacement, delete old code | No backward compatibility period; old files fully removed |
| **Access control** | Operator role check in view component | Standard AIMEAT auth — if not operator, show access denied |

---

## 3. Architecture

### 3.1 File Structure (New)

```
public/
├── views/
│   ├── admin.js                          # Admin view root (sidebar + tab loader)
│   └── admin/
│       ├── overview-tab.js               # Node health, stats, warnings
│       ├── economy-tab.js                # Morsel economy, mint, burn rates
│       ├── config-tab.js                 # Node configuration editor
│       ├── cors-tab.js                   # CORS management (global + per-entity)
│       ├── maintenance-tab.js            # Maintenance mode + backup/restore
│       ├── hooks-tab.js                  # Extension hook bindings
│       ├── portal-tab.js                 # Portal branding, site settings
│       ├── stats-tab.js                  # Usage statistics + charts
│       ├── owners-tab.js                 # Owner management + role grants
│       ├── agents-tab.js                 # Agent registry + detail views
│       ├── ghii-tab.js                   # GHII user management + verification
│       ├── actions-tab.js                # Published action catalogue
│       ├── boards-tab.js                 # Discussion boards overview
│       ├── chat-instances-tab.js         # Active chat sessions
│       ├── realtime-tab.js              # WebSocket rooms + connections
│       ├── work-tab.js                   # Work queue management
│       ├── email-tab.js                  # Email service status + test
│       ├── push-tab.js                   # Push notification service
│       ├── directory-tab.js              # Directory service + rebuild
│       ├── matching-tab.js               # AI matching engine
│       ├── marketplace-tab.js            # Marketplace statistics
│       ├── csm-tab.js                    # CSM registry + detail views
│       ├── msm-tab.js                    # MSM registry + detail views
│       ├── federation-tab.js             # Federation peering status
│       ├── genesis-tab.js                # Genesis peer management
│       └── shared.js                     # Shared admin components (badges, stat cards, tables)
├── css/
│   └── views/
│       └── admin.css                     # Admin-specific styles (sidebar, cards, stats)
└── js/
    └── services/
        └── admin.js                      # Admin API service layer
```

### 3.2 Component Architecture

```
spa.html (shell)
  └── admin.js (view root)
        ├── <AdminSidebar />              # Navigation with groups + counts
        │   ├── Group: Node               # overview, economy, config, cors, maintenance, hooks, portal, stats
        │   ├── Group: Identity           # owners, agents, ghii
        │   ├── Group: Data               # actions, boards, chatInstances, realtime, work
        │   ├── Group: Infrastructure     # email, push
        │   ├── Group: Services           # directory, matching, marketplace, csm
        │   ├── Group: Integrations       # msm (dynamic items)
        │   └── Group: Federation         # federation, genesis
        └── <ActiveTab />                 # Currently selected tab component
              └── Uses adminService.*()   # Dedicated admin API calls
```

### 3.3 Admin Service Layer (`public/js/services/admin.js`)

Wraps all `/v1/admin/*` API endpoints used by the dashboard:

```javascript
// Core dashboard data
export async function getDashboard() { ... }       // GET /v1/admin/dashboard
export async function getConfig() { ... }          // GET /v1/admin/config
export async function updateConfig(changes) { ... } // PUT /v1/admin/config
export async function getStats(period) { ... }     // GET /v1/admin/stats

// Operations
export async function setMaintenance(enabled, message) { ... }  // POST /v1/admin/maintenance
export async function mint(gaii, amount) { ... }                 // POST /v1/admin/mint
export async function backup() { ... }                           // GET /v1/admin/backup
export async function restore(data) { ... }                     // POST /v1/admin/restore

// Identity management
export async function listAgents() { ... }         // GET /v1/admin/agents
export async function listGhiiUsers() { ... }      // GET /v1/admin/ghii
export async function updateGhiiLevel(ghii, level) { ... }
export async function deleteGhii(ghii) { ... }
export async function grantRole(owner, role) { ... } // POST /v1/admin/roles/grant

// Feature services
export async function getEmailStatus() { ... }     // GET /v1/admin/email/status
export async function sendTestEmail(to) { ... }    // POST /v1/admin/email/test
export async function getDirectoryStats() { ... }  // GET /v1/admin/directory/stats
export async function rebuildDirectory() { ... }   // POST /v1/admin/directory/rebuild
export async function getMatchingStatus() { ... }  // GET /v1/admin/matching
export async function runMatching() { ... }        // POST /v1/admin/matching/run
export async function getMarketplace() { ... }     // GET /v1/admin/marketplace
export async function getPushStatus() { ... }      // GET /v1/admin/push

// Hooks
export async function getHooks() { ... }           // GET /v1/admin/hooks
export async function clearHook(name) { ... }      // DELETE /v1/admin/hooks/:name

// Federation
export async function getFederation() { ... }      // GET /v1/admin/federation
export async function getGenesisPeers() { ... }    // GET /v1/admin/genesis-peers
export async function approveGenesisPeer(id) { ... }
export async function suspendGenesisPeer(id) { ... }
export async function removeGenesisPeer(id) { ... }

// CSM/MSM
export async function listCsm() { ... }            // GET /v1/admin/csm
export async function listMsm() { ... }            // GET /v1/admin/msm

// CORS
export async function getGlobalCors() { ... }      // GET /v1/admin/cors
export async function setGlobalCors(origins) { ... }
export async function clearGhiiCors(ghii) { ... }
export async function clearAgentCors(gaii) { ... }

// Portal / Site
export async function getSiteConfig() { ... }      // GET /v1/site
export async function updateSiteConfig(data) { ... }
export async function getSiteTemplate() { ... }    // GET /v1/site/template
export async function getChangelog() { ... }       // GET /v1/site/changelog

// Work, boards, chat, realtime — admin views of existing APIs
export async function listWork() { ... }           // GET /v1/admin/work
export async function listRealtime() { ... }       // GET /v1/admin/realtime
```

### 3.4 Shared Admin Components (`public/views/admin/shared.js`)

Reusable Preact components for admin UI:

| Component | Purpose |
|-----------|---------|
| `StatCard({ label, value, sub, color })` | Single stat box (replaces `sc()`) |
| `StatsGrid({ items })` | Grid of stat cards (replaces `statsGrid()`) |
| `EconRow({ label, value })` | Economy metric row (replaces `er()`) |
| `HealthRow({ label, zone, value })` | Health metric with zone badge (replaces `hRow()`) |
| `DataTable({ headers, rows, opts })` | Sortable data table (replaces `dataTable()`) |
| `Badge({ status })` | Colored status badge (replaces `badge()`) |
| `EmptyState({ message })` | Empty content placeholder (replaces `emptyState()`) |
| `ActionButton({ label, onClick })` | Admin action button (replaces `actionBtn()`) |
| `ConfirmDialog({ message, onConfirm })` | Confirmation modal (replaces `confirm()`) |

---

## 4. Implementation Phases

### Phase 1: Foundation (Shell + Overview)

**Creates the skeleton that all subsequent phases build on.**

Files to create:
- `public/views/admin.js` — Admin view root with sidebar navigation, tab switching via `?tab=` query params, operator role check, data loading
- `public/views/admin/overview-tab.js` — First tab (node health, counts, economy summary, warnings)
- `public/views/admin/shared.js` — StatCard, StatsGrid, Badge, DataTable, EconRow, HealthRow, EmptyState
- `public/css/views/admin.css` — Admin-specific styles extracted from old dashboard (sidebar layout, cards, tables, stat grids, color scheme)
- `public/js/services/admin.js` — Admin service layer (start with getDashboard, getConfig)

Files to modify:
- `public/spa.html` — Add `/v1/admin` to ROUTES object, add `admin.css` preload
- `src/routes/portal.ts` — Add `/v1/admin` to SPA route serving (serveSpa)
- `locales/en.json` — Add `admin.dashboard.*` translation keys (overview section)
- `locales/fi.json` — Add Finnish translations for overview section

**Validation:** Navigate to `/v1/admin` → see sidebar with all groups, overview page renders with live data.

### Phase 2: Node Management Pages

**Tabs:** economy, config, cors, maintenance, hooks, portal, stats

Files to create:
- `public/views/admin/economy-tab.js` — Morsel economy, mint form, burn rates
- `public/views/admin/config-tab.js` — Dynamic config editor with pending changes
- `public/views/admin/cors-tab.js` — Global CORS + per-GHII/agent CORS overrides
- `public/views/admin/maintenance-tab.js` — Maintenance toggle, backup/restore
- `public/views/admin/hooks-tab.js` — Hook bindings, clear hooks
- `public/views/admin/portal-tab.js` — Site settings, template, changelog
- `public/views/admin/stats-tab.js` — Usage statistics with charts

Files to modify:
- `public/js/services/admin.js` — Add remaining node management endpoints
- `locales/en.json` — Add `admin.dashboard.*` keys for these tabs
- `locales/fi.json` — Finnish translations

**Validation:** All 8 node tabs functional with live data.

### Phase 3: Identity Pages

**Tabs:** owners, agents, ghii

Files to create:
- `public/views/admin/owners-tab.js` — Owner list, role management, grant operator
- `public/views/admin/agents-tab.js` — Agent registry, detail expand, trust scores, CORS
- `public/views/admin/ghii-tab.js` — GHII users, verification levels, TOTP status, delete

Files to modify:
- `public/js/services/admin.js` — Identity management endpoints
- `locales/en.json` / `locales/fi.json` — Identity tab translations

**Validation:** Full identity management through new admin UI.

### Phase 4: Data Pages

**Tabs:** actions, boards, chatInstances, realtime, work

Files to create:
- `public/views/admin/actions-tab.js` — Published actions list
- `public/views/admin/boards-tab.js` — Board list with post loading
- `public/views/admin/chat-instances-tab.js` — Active chat sessions
- `public/views/admin/realtime-tab.js` — WebSocket rooms, connections, close room
- `public/views/admin/work-tab.js` — Work queue, escrow, disputes

Files to modify:
- `public/js/services/admin.js` — Data viewing endpoints
- `locales/en.json` / `locales/fi.json` — Data tab translations

**Validation:** All data pages show live counts and details.

### Phase 5: Infrastructure + Services

**Tabs:** email, push, directory, matching, marketplace, csm, msm

Files to create:
- `public/views/admin/email-tab.js` — Email status, test send
- `public/views/admin/push-tab.js` — Push notifications status, subscriptions
- `public/views/admin/directory-tab.js` — Directory stats, rebuild index
- `public/views/admin/matching-tab.js` — Matching engine, run matching
- `public/views/admin/marketplace-tab.js` — Marketplace stats, listings
- `public/views/admin/csm-tab.js` — CSM registry + inline detail view
- `public/views/admin/msm-tab.js` — MSM registry + inline detail view

Files to modify:
- `public/js/services/admin.js` — Service management endpoints
- `locales/en.json` / `locales/fi.json` — Service tab translations

**Validation:** All infrastructure and service tabs operational.

### Phase 6: Federation

**Tabs:** federation, genesis

Files to create:
- `public/views/admin/federation-tab.js` — Peering requests, node info
- `public/views/admin/genesis-tab.js` — Genesis peer management (approve/suspend/remove)

Files to modify:
- `public/js/services/admin.js` — Federation endpoints
- `locales/en.json` / `locales/fi.json` — Federation tab translations

**Validation:** Federation management fully functional.

### Phase 7: Cleanup — Delete Old Code

Files to delete:
- `src/routes/admin-dashboard.ts` — The entire SSR monolith (1,779 lines)

Files to modify:
- `src/routes/admin.ts` — Remove import of `buildDashboardHtml` and `buildDashboardTranslations`. Remove `/v1/admin/ui` route. Update `/v1/admin/translations` to use the new translation key namespace. Update `dashboard_url` reference in setup response (line 155) from `/v1/admin/ui?token=` to `/v1/admin`
- `src/server.ts` — No changes needed (admin.ts and admin-features.ts stay)
- `src/index.ts` — Verify startup messages still accurate (no changes expected)
- `locales/en.json` — Remove old `dashboard.*` keys (replaced by `admin.dashboard.*`)
- `locales/fi.json` — Remove old `dashboard.*` keys

**Validation:** `npx tsc --noEmit` passes. No references to old admin-dashboard remain. Server starts cleanly. All 25 admin pages work in new SPA.

---

## 5. Sidebar Navigation Structure

The admin sidebar preserves the existing grouping with 7 sections, 25 static items, plus dynamic CSM/MSM entries:

| Group | Tab ID | Icon | Translation Key | Has Count |
|-------|--------|------|-----------------|-----------|
| **Node** | `overview` | 📊 | `admin.dashboard.overview` | No |
| | `economy` | 🪙 | `admin.dashboard.economy` | No |
| | `config` | ⚙ | `admin.dashboard.config` | No |
| | `cors` | 🔒 | `admin.dashboard.cors` | No |
| | `maintenance` | 🚧 | `admin.dashboard.maintenance` | No |
| | `hooks` | 🔗 | `admin.dashboard.hooks` | No |
| | `portal` | 🌐 | `admin.dashboard.portal` | No |
| | `stats` | 📈 | `admin.dashboard.stats` | No |
| **Identity** | `owners` | 👤 | `admin.dashboard.owners` | Yes |
| | `agents` | 🤖 | `admin.dashboard.agents` | Yes |
| | `ghii` | 🔑 | `admin.dashboard.ghii` | Yes |
| **Data** | `actions` | ⚡ | `admin.dashboard.actions` | Yes |
| | `boards` | 📋 | `admin.dashboard.boards` | Yes |
| | `chatInstances` | 💬 | `admin.dashboard.chatInstances` | Yes |
| | `realtime` | 📡 | `admin.dashboard.realtime` | Yes |
| | `work` | 📦 | `admin.dashboard.work` | Yes |
| **Infrastructure** | `email` | ✉ | `admin.dashboard.email` | No |
| | `push` | 🔔 | `admin.dashboard.push` | No |
| **Services** | `directory` | 📖 | `admin.dashboard.directory` | No |
| | `matching` | 🤝 | `admin.dashboard.matching` | No |
| | `marketplace` | 🛒 | `admin.dashboard.marketplace` | No |
| | `csm` | 📦 | `admin.dashboard.csmManagement` | No |
| | *(dynamic CSM entries)* | 📦 | *(from CSM name)* | No |
| **Integrations** | `msm` | 🔌 | `admin.dashboard.msmManagement` | Yes |
| | *(dynamic MSM entries)* | 🔌 | *(from MSM name)* | No |
| **Federation** | `federation` | 🌐 | `admin.dashboard.federation` | Yes |
| | `genesis` | 🌍 | `admin.dashboard.genesis` | Yes |

### Sidebar Features
- Counts update after data load (same as current)
- Dynamic CSM/MSM entries rendered after dashboard data loaded
- Active item highlighted
- Sidebar group labels with translation support
- Language switcher in sidebar header
- Logout button

---

## 6. Translation Migration

### Strategy

Move all ~250 dashboard keys from `dashboard.*` → `admin.dashboard.*` namespace.

**Old format** (server-side, flat):
```json
{
  "dashboard": {
    "title": "AIMEAT Admin",
    "overview": "Overview",
    "economy": "Economy",
    ...
  }
}
```

**New format** (client-side, nested under admin):
```json
{
  "admin": {
    "dashboard": {
      "title": "AIMEAT Admin",
      "overview": "Overview",
      "economy": "Economy",
      "navNode": "Node",
      "navIdentity": "Identity",
      ...
    }
  }
}
```

### Translation Endpoint Update

The `/v1/admin/translations` endpoint will be updated to return from the new namespace, or removed entirely since the SPA uses client-side `t()` from `i18n.js` which loads from `/locales/*.json` directly. The endpoint can be kept temporarily for backward compatibility during development, then removed in Phase 7.

---

## 7. Auth Migration

### Current Flow
1. Dashboard served at `/v1/admin/ui?token=<JWT>`
2. Token from query string stored in `localStorage`
3. If no token, custom password login form shown
4. Login calls `/v1/ghii/login`, gets JWT, stores it

### New Flow
1. Admin SPA served at `/v1/admin` via `serveSpa()`
2. Standard `aimeat-auth.js` handles auth (already in spa.html)
3. If not logged in, standard AIMEAT login UI appears
4. Admin view component checks `session.roles.includes('operator')`
5. If not operator → show "Access denied — operator role required" message
6. No custom login form needed

### Setup URL Update
In `src/index.ts` line 296, the startup message currently prints:
```
Admin Setup: http://localhost:40050/v1/admin/setup?pw=...
```
This URL is for initial owner registration (handled by `src/routes/admin.ts`). It remains unchanged — it's a JSON API endpoint, not the dashboard UI. However, `admin.ts` line 155 returns `dashboard_url: /v1/admin/ui?token=...` in the setup response — this needs updating to `/v1/admin`.

---

## 8. CSS Strategy

### Extract from SSR
The current admin CSS (~150 lines embedded in admin-dashboard.ts) defines:
- Sidebar layout (`.layout`, `.sidebar`, `.main`)
- Navigation items (`.nav-item`, `.nav-group-label`, `.count`)
- Cards and grids (`.card`, `.grid`, `.grid-2`, `.grid-4`)
- Stats display (`.stat`, `.stat-label`, `.econ-row`)
- Tables (`.scrollable`, `table`, `th`, `td`)
- Badges (`.badge`, `.badge-healthy`, `.badge-critical`)
- Health rows (`.health-row`, `.health-metric`, `.health-value`)
- Action buttons (`.action-btn`, `.expand-btn`, `.refresh`)
- Login form (`.login-box`)
- Dark theme colors

### New File: `public/css/views/admin.css`
- Extract and clean up the above styles
- Use CSS custom properties from `theme.css` (already imported by spa.html)
- Add admin-specific layout: sidebar + content with responsive breakpoints
- Remove the login form styles (handled by aimeat-auth.js)

### Integration
- Add `<link rel="stylesheet" href="/css/views/admin.css">` to spa.html head section
- `serveSpa()` will auto-stamp with `?v=BUILD_ID` for cache-busting

---

## 9. Data Loading Strategy

### Current Approach
The old dashboard calls `loadAll()` on startup which fires 10+ API calls in parallel via `Promise.allSettled`, stores everything in a global `D` object, then calls `render()`.

### New Approach
Each tab component is responsible for loading its own data:

```javascript
// Example: overview-tab.js
export default function OverviewTab({ session }) {
  const { data, loading, error, reload } = useApiCall('/v1/admin/dashboard');
  if (loading) return html`<${Spinner} />`;
  if (error) return html`<div class="alert-error">${error}</div>`;
  return html`...render overview using data...`;
}
```

**Benefits:**
- Only loads data for the active tab (faster initial load)
- Each tab can independently reload its data
- Loading/error states per tab, not global
- No global mutable state

**Dashboard overview exception:** The overview tab needs counts from multiple endpoints. It uses the single `/v1/admin/dashboard` endpoint which already aggregates all overview data server-side.

**Sidebar counts:** The admin root component (`admin.js`) loads dashboard counts once on mount and passes them to the sidebar. Individual tabs don't need to update sidebar counts.

---

## 10. Migration Mapping

Complete 1:1 mapping from old render functions to new tab components:

| Old Function | Lines | New Component | New File |
|---|---|---|---|
| `renderOverview()` | 672–709 | `OverviewTab` | `overview-tab.js` |
| `renderEconomy()` | 816–862 | `EconomyTab` | `economy-tab.js` |
| `renderConfig()` | 993–1068 | `ConfigTab` | `config-tab.js` |
| `renderCors()` | 1069–1201 | `CorsTab` | `cors-tab.js` |
| `renderMaintenance()` | 863–937 | `MaintenanceTab` | `maintenance-tab.js` |
| `renderHooks()` | 965–992 | `HooksTab` | `hooks-tab.js` |
| `renderPortal()` | 1502–1673 | `PortalTab` | `portal-tab.js` |
| `renderStats()` | 1674–1779 | `StatsTab` | `stats-tab.js` |
| `renderOwners()` | 711–739 | `OwnersTab` | `owners-tab.js` |
| `renderAgents()` | 740–758 | `AgentsTab` | `agents-tab.js` |
| `renderGhii()` | 1309–1330 | `GhiiTab` | `ghii-tab.js` |
| `renderActions()` | 759–776 | `ActionsTab` | `actions-tab.js` |
| `renderBoards()` | 777–795 | `BoardsTab` | `boards-tab.js` |
| `renderChatInstances()` | 1202–1220 | `ChatInstancesTab` | `chat-instances-tab.js` |
| `renderRealtime()` | 1221–1308 | `RealtimeTab` | `realtime-tab.js` |
| `renderWork()` | 796–815 | `WorkTab` | `work-tab.js` |
| `renderEmail()` | 1331–1345 | `EmailTab` | `email-tab.js` |
| `renderPush()` | 1392–1403 | `PushTab` | `push-tab.js` |
| `renderDirectory()` | 1346–1357 | `DirectoryTab` | `directory-tab.js` |
| `renderMatching()` | 1358–1370 | `MatchingTab` | `matching-tab.js` |
| `renderMarketplace()` | 1371–1391 | `MarketplaceTab` | `marketplace-tab.js` |
| `renderCsm()` + `renderCsmDetail()` | 1404–1483 | `CsmTab` | `csm-tab.js` |
| `renderMsm()` + `renderMsmDetail()` | 1416–1501 | `MsmTab` | `msm-tab.js` |
| `renderFederation()` | 938–964 | `FederationTab` | `federation-tab.js` |
| `renderGenesis()` | 1435–1466 | `GenesisTab` | `genesis-tab.js` |

**Helper function mapping:**

| Old Function | New Component | Location |
|---|---|---|
| `sc()` | `StatCard` | `shared.js` |
| `statsGrid()` | `StatsGrid` | `shared.js` |
| `er()` | `EconRow` | `shared.js` |
| `hRow()` | `HealthRow` | `shared.js` |
| `badge()` | `Badge` | `shared.js` |
| `dataTable()` | `DataTable` | `shared.js` |
| `emptyState()` | `EmptyState` | `shared.js` |
| `actionBtn()` | `ActionButton` | `shared.js` |
| `esc()` | Not needed | Preact auto-escapes |
| `num()` | `formatNumber()` | `shared.js` |
| `dt()` | `formatDate()` | `shared.js` |
| `fmtUp()` | `formatUptime()` | `shared.js` |
| `fmtBytes()` | `formatBytes()` | `shared.js` |

---

## 11. Files Affected Summary

### New Files (30)
- `public/views/admin.js` (view root)
- `public/views/admin/*.js` (25 tab components + shared.js)
- `public/css/views/admin.css`
- `public/js/services/admin.js`

### Modified Files (5)
- `public/spa.html` — Add admin route + CSS preload
- `src/routes/portal.ts` — Serve SPA for `/v1/admin`
- `src/routes/admin.ts` — Remove `buildDashboardHtml` import, remove `/v1/admin/ui` route, update `dashboard_url`
- `locales/en.json` — Add `admin.dashboard.*` keys, remove old `dashboard.*` keys
- `locales/fi.json` — Same translation updates

### Deleted Files (1)
- `src/routes/admin-dashboard.ts` — The SSR monolith (1,779 lines)

---

## 12. Verification Checklist

After completing all phases:

- [ ] `npx tsc --noEmit` — TypeScript compiles cleanly
- [ ] No references to `admin-dashboard.ts` or `buildDashboardHtml` anywhere in codebase
- [ ] No `dashboard.*` translation keys in locale files (all moved to `admin.dashboard.*`)
- [ ] `/v1/admin` loads the new SPA admin view
- [ ] `/v1/admin/ui` returns 404 (old route removed)
- [ ] All 25 tabs render with live data
- [ ] Sidebar counts update after data load
- [ ] Dynamic CSM/MSM entries appear in sidebar
- [ ] Language switching works (en/fi)
- [ ] Auth uses standard aimeat-auth.js flow
- [ ] Non-operator users see "access denied" message
- [ ] Tab state preserved in URL query params (`?tab=economy`)
- [ ] Browser back/forward works for tab navigation
- [ ] `src/index.ts` startup message unchanged (`/v1/admin/setup?pw=...` still valid)
- [ ] `admin.ts` setup response `dashboard_url` points to `/v1/admin`
- [ ] E2E tests pass (if admin-related tests exist)
- [ ] No console errors in browser
