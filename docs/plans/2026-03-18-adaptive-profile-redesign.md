# Adaptive Profile Redesign — Three User Tiers

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Profile landing page redesign, tier-based tab visibility, inline preview panels

## Overview

The current profile shows all 23 tabs equally to every user. A brand-new user sees the same interface as an operator running federated nodes. This redesign introduces an adaptive landing page that presents different layouts based on the user's actual usage level, following the wireframes in `new_profile.html` (v2) and `aimeat_profile_ux_v3_inline.html` (v3).

**Key principle:** Nothing is removed. All 23 existing tabs remain. The change is how users discover and navigate to them.

## Design Decisions

1. **Tier detection:** Frontend heuristic in `computeTier()` — no backend changes
2. **Landing page:** New adaptive dashboard as default view (replaces direct-to-tab)
3. **Tab system:** Kept for complex views; inline preview panels for simple views
4. **Tab visibility:** Filtered by tier in the tab bar
5. **Existing tabs untouched:** No rewrite of the 23 tab components
6. **SPA continuity:** Landing page is a Preact component inside the existing SPA shell — no page reloads, same `profile.js` orchestrator, same routing
7. **Mobile-first responsive:** All landing page layouts designed mobile-first, scaling up to desktop
8. **Live reactivity:** Landing page listens to `aimeat-live-update` SSE events — stats, badges, app strip, and inline panels refresh automatically

## Part 1: User Tier Heuristic

### File: `public/views/profile.js`

Add a `computeTier(stats, session)` function that runs on every profile load using already-fetched stats data. Returns `'new' | 'active' | 'experienced'`.

```
function computeTier(stats, session) {
  const hasOperatorRole = session.roles?.includes('operator')
  const hasFederationPeers = stats.nodes > 0
  const hasAgents = stats.agents > 0
  const hasManyAgents = stats.agents >= 5
  const hasApps = stats.apps > 0
  const hasMemories = stats.memory > 0

  // Experienced: running infrastructure or operating a node
  if (hasOperatorRole || hasFederationPeers || hasManyAgents) return 'experienced'

  // Active: has used the platform meaningfully
  if (hasApps || hasMemories || hasAgents) return 'active'

  // New: just registered, nothing yet
  return 'new'
}
```

**No persistence.** The tier is computed fresh each load AND on every live-update event. As the user creates their first agent or installs their first app, the profile adapts immediately — no page reload needed.

**Stats source:** The profile already fetches counts for the stats bar (agents, chatSessions, balance, memory, services, work, apps, files, nodes). These are available before rendering.

**Live tier transitions:** When an SSE event triggers a stats refresh, `computeTier()` runs again. If the tier changes (e.g., new → active after first agent connects), the landing page re-renders with the new layout. This is a natural Preact state update — the `tier` value lives in the profile's state, and the landing page component receives it as a prop.

## Part 2: Adaptive Landing Page

### New file: `public/views/profile/landing-page.js`

A Preact + HTM component that renders a tier-specific dashboard. This becomes the default view when no tab is selected (or when the user clicks the "home" / profile icon).

### 2.1 New User Landing

Layout (top to bottom):

1. **Profile Card (minimal)**
   - Avatar, username, GHII address, node URL
   - Stats row: only morsel balance shown (the welcome bonus)
   - NO "edit profile" link (premature commitment — appears after user has content)

2. **Hero Onboarding Section**
   - Title: "Welcome! Start here" (i18n)
   - Subtitle explaining the 4 paths
   - 2x2 grid of onboarding cards:
     - **Install a service** (highlight, "easiest" tag) — navigates to packages tab
     - **Do something with AI Chat** — copies knowledge packager prompt
     - **Connect an AI agent** — navigates to agents tab
     - **Generate a full service** ("later" tag) — navigates to generator tab

3. **Knowledge Callout** (positioned AFTER hero per psychological analysis)
   - Icon + title + description about bringing AI research here
   - AI platform pills (Claude, ChatGPT, Grok, Copilot)
   - Clicking navigates to knowledge tab

4. **Ghost App Tiles**
   - Section title: "Popular services"
   - 4 ghost tiles showing popular packages with "install →" CTA
   - Tiles are dashed-border, dimmed, clickable → navigate to packages tab
   - Tile content fetched from package catalogue (or hardcoded initial set)

5. **Cortex Extensions Section**
   - Title: "Ready-made extensions — add to your AI Chat"
   - 2-column grid showing bundled extensions (Charts, Canvas)
   - Each card: icon, name, short description
   - Click → navigates to extensions tab

6. **Minimal Management Menu**
   - Title: "Management"
   - 4 menu items: Memory, Wallet, Access, Email
   - Expand trigger: "Show all settings" → reveals full tab list
   - Each item navigates to corresponding tab

### 2.2 Active User Landing

Layout:

1. **Profile Card (full)**
   - Avatar, username, GHII, node URL
   - "edit profile →" link
   - Stats row: apps, memories, morsels, capabilities

2. **App Strip**
   - Horizontal scrollable row of app chips (icon + name)
   - Shows user's installed apps (from apps/packages data)
   - "All →" link at top-right navigates to apps tab
   - If no apps: shows 2-3 ghost chips with "Install first app →"

3. **"Daily" Menu Section**
   - Menu items: Packages & Extensions, Notifications (badge), Agents (badge), Memory, Boards, Knowledge
   - Items with inline preview support show a preview panel on click
   - Items without preview navigate directly to their tab

4. **Knowledge Button** (after Daily section, per psychological analysis)
   - Actionable button with arrow: "Bring your AI research here"
   - Clicking opens knowledge tab (or inline preview)
   - **Disappears** once user has 1+ knowledge package (replaced by direct knowledge link in Daily menu)

5. **"Build & Share" Menu Section**
   - Menu items: Generator (primary/accent), Extensions, Portfolio

6. **"Management" Menu Section**
   - Menu items: Apps, MCP, Wallet, Email, Access
   - Expand trigger: "Services, Work, Sessions, Data Wallet, Organisms"

### 2.3 Experienced User Landing

Layout:

1. **Profile Card (full + federation)**
   - Avatar, username, GHII, node URL
   - "edit profile →" link
   - Federation badge: "X nodes in federation" (green dot)
   - Stats row: apps, memories, morsels, capabilities, agents

2. **App Strip**
   - Same as active but potentially more apps
   - Scrollable, "All →" link

3. **"Daily" Menu Section**
   - Same items as active, with higher badge counts
   - Badges reflect actual notification/agent/board counts

4. **"Build & Share" Menu Section**
   - Generator (primary), Extensions, Portfolio, Own Packages

5. **"Management" Section — Split into Subgroups**
   - **Technical:** Apps, MCP, Services, Work, Sessions
   - **Personal:** Wallet, Email, Access & Data Wallet, Organisms

6. **"Infrastructure" Section** (operator-only)
   - Annotation: "node operators only"
   - Menu items: Federation (accent/indigo), Nodes, Node Stats, Security

## Part 3: Inline Preview Panels

### New file: `public/views/profile/inline-panels.js`

Selected menu items on the landing page expand an inline preview panel below the menu section (like the v3 wireframe). Only one panel open at a time.

### Panel Behavior

- Click menu item → panel slides open below the menu section (CSS transition: max-height + opacity)
- Click same item again → panel closes
- Click different item → current panel closes, new one opens
- Each panel has: header (title + close button), body with preview content
- "View all →" link at bottom navigates to the full tab

### Panels to Implement

| Panel ID | Source Data | Preview Content |
|----------|-------------|-----------------|
| `notifications` | Fetch from notifications/events API | 5 most recent notifications (icon, title, description, timestamp) |
| `agents` | Fetch from agents API | Agent cards with status dot (online/offline), name, GAII. "Connect new agent" CTA |
| `memory` | Fetch from memory API | 3 most recent keys (icon, key name, description, visibility pill, size). Search bar. "View all →" |
| `boards` | Fetch from boards API | Board cards (title, post count, member count). "View all →" |
| `packages` | Fetch from packages API | Split: installed (top) + available (bottom, dimmed). "View all →" |
| `knowledge` | Fetch from knowledge API | Knowledge packager button + 2 most recent packages. "View all →" |

### Panel Component Structure

```
InlinePanel({ id, title, icon, isOpen, onClose, children })
```

- `isOpen` controlled by landing page state (single `openPanelId`)
- Transition: `max-height: 0 → 2000px`, `opacity: 0 → 1` over 0.4s
- Body content rendered only when open (lazy)

## Part 4: Tab Visibility by Tier

### Changes in: `public/views/profile.js`

The TABS array gets a `minTier` property per tab. The tab bar filters based on current tier.

```
Tier hierarchy: new < active < experienced
```

| Tab | minTier | Rationale |
|-----|---------|-----------|
| memory | new | Core functionality, even new users can explore |
| wallet | new | Morsel balance is immediately relevant |
| access | new | Session info, always useful |
| email | new | Email verification is an early action |
| agents | active | Needs understanding of the platform first |
| chatsessions | active | Subset of agents |
| mcp | active | AI integration, not beginner |
| knowledge | active | Needs content to be meaningful |
| boards | active | Social features |
| apps | active | App management |
| extensions | active | Extension management |
| packages | active | Package management |
| generator | active | Service generation |
| organisms | active | Group management |
| work | active | Work requests |
| actions (services) | active | Service catalogue |
| portfolio | active | Portfolio needs content |
| dataWallet | active | Privacy controls |
| notifications | active | Notification preferences |
| security | experienced | CORS, session management — advanced |
| federation | experienced | Multi-node infrastructure |
| nodes | experienced | Personal node management |
| nodeStats | experienced | Server metrics |

### Tab Bar Behavior

- Tabs filtered: only show tabs where `tierLevel(tab.minTier) <= tierLevel(currentTier)`
- Default tab: `'home'` (the landing page) for all tiers
- Tab saved to localStorage still works — if saved tab is hidden for current tier, falls back to home
- Direct URL `?tab=federation` still works even for lower tiers (deep links always accessible)

## Part 5: CSS Additions

### File: `public/css/views/profile.css`

New class prefixes for landing page elements. All under `.pf` scope:

```
/* Landing page layout */
.pf .pf-landing          — landing page container
.pf .pf-landing-section  — each major section wrapper

/* Hero onboarding (new user) */
.pf .pf-hero-onboard     — hero section container
.pf .pf-hero-title       — hero heading
.pf .pf-hero-subtitle    — hero description
.pf .pf-onboard-grid     — 2x2 grid of onboarding cards
.pf .pf-onboard-card     — individual path card
.pf .pf-onboard-card.highlight — highlighted card (coral border + soft bg)
.pf .pf-onboard-tag      — "easiest" / "later" tag badge

/* Knowledge callout */
.pf .pf-knowledge-callout — gradient callout box (indigo-soft)
.pf .pf-knowledge-btn    — actionable knowledge button (active user)
.pf .pf-ai-pills         — row of AI platform pills

/* Ghost tiles */
.pf .pf-ghost-grid       — grid for ghost app tiles
.pf .pf-ghost-tile       — dashed-border dimmed tile
.pf .pf-ghost-cta        — "install →" text

/* App strip */
.pf .pf-app-strip        — horizontal app launcher container
.pf .pf-app-row          — scrollable flex row
.pf .pf-app-chip         — individual app chip (icon + name)

/* Menu sections */
.pf .pf-menu-section     — card wrapper for menu group
.pf .pf-menu-title       — uppercase section title
.pf .pf-menu-grid        — flex-wrap grid of menu items
.pf .pf-menu-item        — individual menu button/link
.pf .pf-menu-item.primary — accent-colored primary item
.pf .pf-menu-badge       — notification count badge
.pf .pf-menu-subgroup    — subgroup within management section
.pf .pf-expand-trigger   — "show all" expand link

/* Inline preview panels */
.pf .pf-inline-panel         — collapsible panel container
.pf .pf-inline-panel.open    — expanded state (max-height transition)
.pf .pf-inline-panel-header  — panel header (title + close button)
.pf .pf-inline-panel-body    — panel content area
.pf .pf-inline-panel-close   — close button

/* Cortex extensions (new user) */
.pf .pf-cortex-grid      — 2-column extension grid
.pf .pf-cortex-card      — extension preview card

/* Federation badge */
.pf .pf-federation-badge  — green-dot federation indicator
```

### Responsive Design (Mobile-First)

All landing page CSS is written mobile-first: base styles target phones (`< 480px`), then scale up via `min-width` media queries.

**Breakpoints:**

| Breakpoint | Target | Key Changes |
|-----------|--------|-------------|
| Base (< 480px) | Phone | Single column everything. Full-width cards. App strip horizontal scroll. Menu items stack vertically. Inline panels full-width. |
| `min-width: 480px` | Large phone | Menu items 2-per-row. Ghost tiles 2-per-row. |
| `min-width: 640px` | Tablet | Onboarding grid 2x2. Cortex grid 2-column. Menu items flex-wrap naturally. |
| `min-width: 900px` | Desktop | Max-width container (900px centered). Full layouts as designed. |

**Mobile-specific patterns:**

- **App strip:** Always horizontal scroll with `-webkit-overflow-scrolling: touch`. Fade edges (CSS gradient mask on left/right) to hint scrollability. Touch-friendly chip size (min 44px tap target).
- **Onboarding cards:** Stack to single column on phones. "Easiest" tag repositions to not overlap text.
- **Inline panels:** Full-width, no margin. Panel body scrollable if content exceeds viewport height (`max-height: 60vh; overflow-y: auto`).
- **Ghost tiles:** 2-per-row on phones (not 4), larger tap targets.
- **Menu items:** Full-width on smallest phones, 2-per-row on larger phones, flex-wrap on tablet+.
- **Profile card:** Avatar + name stack vertically on phones. Stats row wraps naturally.
- **Knowledge callout/button:** Full-width, text wraps. AI pills wrap to second line.
- **Tab bar:** Horizontal scroll with same fade-edge pattern as app strip. Active tab scrolls into view.

**Touch considerations:**
- All clickable elements: minimum 44x44px tap target (WCAG 2.5.8)
- Menu items: `padding: 12px 16px` on mobile (larger than desktop's `8px 14px`)
- Ghost tiles: `min-height: 80px` on mobile
- Inline panel close button: 44x44px touch target

## Part 6: i18n Keys

### Files: `locales/en.json` + `locales/fi.json`

New keys under `"profile"` namespace:

```json
{
  "profile": {
    "landing": {
      "heroTitle": "Welcome! Start here",
      "heroSubtitle": "You have four paths forward. Start anywhere — all lead to something useful.",
      "onboardInstall": "Install a ready service",
      "onboardInstallDesc": "Browse packages. One click and you have your own electricity price monitor, digital signage, or company radar.",
      "onboardChat": "Do something with AI Chat",
      "onboardChatDesc": "Copy a prompt, paste it into your AI Chat. You get a working app that uses AIMEAT memory. No coding.",
      "onboardAgent": "Connect an AI agent",
      "onboardAgentDesc": "Give Claude/ChatGPT access here. It can bring data, remember things, and work on your behalf.",
      "onboardGenerator": "Generate a full service",
      "onboardGeneratorDesc": "Tell us what you need. The generator interviews you and creates everything: UI, backend, translations, data.",
      "tagEasiest": "easiest",
      "tagLater": "later",
      "knowledgeTitle": "Your research and conversations are valuable",
      "knowledgeDesc": "You've already done a lot of work with AI. Bring it here — structured, searchable, shareable. Copy the Knowledge Packager prompt, paste it into your AI Chat, and everything you've researched becomes structured knowledge.",
      "knowledgeBtnTitle": "Bring your AI research here",
      "knowledgeBtnDesc": "Copy Knowledge Packager, paste into your AI Chat — your conversations become structured knowledge.",
      "ghostSectionTitle": "Popular services",
      "ghostInstall": "install",
      "cortexSectionTitle": "Ready-made extensions — add to your AI Chat",
      "menuDaily": "Daily",
      "menuBuildShare": "Build & share",
      "menuManagement": "Management",
      "menuInfra": "Infrastructure",
      "menuInfraAnnotation": "node operators only",
      "menuTechnical": "Technical",
      "menuPersonal": "Personal",
      "expandAll": "Show all settings",
      "expandMore": "Show all",
      "myApps": "My apps",
      "allApps": "All",
      "viewAll": "View all",
      "editProfile": "edit profile",
      "federationBadge": "{count} node(s) in federation"
    }
  }
}
```

Finnish translations follow the same structure with Finnish text (matching the wireframe labels).

## Part 7: Data Flow & Live Reactivity

### SPA Architecture

The landing page is a Preact component rendered inside the existing SPA shell (`profile.js`). No page reloads occur during tier transitions, inline panel interactions, or data updates. All state is managed via Preact's `useState`/`useEffect` hooks.

```
SPA shell (spa.html)
  └── profile.js (orchestrator)
       ├── computeTier(stats, session) → tier state
       ├── landing-page.js (receives tier, stats, session as props)
       │    ├── ProfileCard
       │    ├── HeroOnboarding / AppStrip (tier-dependent)
       │    ├── MenuSections (tier-dependent)
       │    └── InlinePanels (lazy-loaded content)
       └── Tab components (23 existing, filtered by tier)
```

### Stats Fetching (already exists)

The profile already calls APIs to populate the stats bar. The landing page reuses these:

```
profile.js loads → fetches stats → computeTier(stats, session)
                                 → renders landing page with tier
                                 → filters tab bar by tier
```

### Live Reactivity via SSE

The landing page MUST react to server-side changes in real-time. This uses the existing `aimeat-live-update` SSE event system.

**What updates live:**

| Element | Trigger | Behavior |
|---------|---------|----------|
| Stats row (all tiers) | Any data change | Re-fetches stats → re-renders counts |
| Tier itself | Stats change crosses threshold | `computeTier()` re-runs → landing page switches layout if tier changed |
| Notification badges | New notification | Badge count increments |
| App strip (active/experienced) | App installed/removed | Strip re-fetches app list |
| Open inline panel | Any relevant data change | Panel content re-fetches |
| Federation badge | Peer connects/disconnects | Badge count updates |
| Knowledge button visibility | First knowledge package created | Button disappears, replaced by Knowledge link in Daily menu |

**Implementation pattern (same as existing tabs):**

```javascript
// In landing-page.js
const loadData = useCallback(async () => {
  const stats = await fetchStats(session)
  setStats(stats)
  setTier(computeTier(stats, session))
  // Also refresh app list, badge counts, etc.
}, [session])

// SSE listener — re-fetches everything on server change
const liveRef = useRef(loadData)
liveRef.current = loadData
useEffect(() => {
  const handler = () => liveRef.current()
  window.addEventListener('aimeat-live-update', handler)
  return () => window.removeEventListener('aimeat-live-update', handler)
}, [])
```

**Inline panel reactivity:** If a panel is open when an SSE event fires, its content re-fetches automatically. The panel stays open — only the data inside updates. This prevents jarring close/reopen behavior.

**Tier transition UX:** When the tier changes (e.g., new → active), the landing page re-renders smoothly. No flash or full re-mount — Preact diffs the component tree naturally. The transition feels like the dashboard "growing" as the user's profile expands.

### Landing Page Data

The landing page needs additional data beyond stats:

| Section | Data Source | API Call | Refresh on SSE? |
|---------|------------|----------|-----------------|
| App strip | Apps + packages | `GET /v1/apps` or reuse packages data | Yes |
| Ghost tiles | Package catalogue | `GET /v1/packages/catalogue` (top 4 popular) or hardcoded initial set | No (static) |
| Notification badges | Existing notification count | Already fetched for stats | Yes |
| Inline panels | Per-panel lazy fetch | Each panel fetches on open (not on page load) | Yes (if open) |
| Cortex extensions | Bundled extension list | Hardcoded (Charts, Canvas) — same as extensions tab | No (static) |
| Federation badge | Federation peers | `GET /v1/federation/peers` (already fetched if nodes > 0) | Yes |

### Inline Panel Data

Each panel fetches data lazily when opened, and re-fetches on SSE events while open:

- `notifications`: `GET /v1/events` (recent 5)
- `agents`: reuse already-fetched agents data from stats
- `memory`: `GET /v1/memory?limit=3` (most recent)
- `boards`: `GET /v1/boards` (user's boards)
- `packages`: `GET /v1/packages` (installed) + `GET /v1/packages/catalogue` (available, limit 3)
- `knowledge`: `GET /v1/knowledge` (user's packages, limit 2)

## Part 8: Implementation Steps

### Step 1: Tier Heuristic + Landing Page Shell
- Add `computeTier()` to `profile.js`
- Add `'home'` as default view (before all tabs)
- Create `landing-page.js` with basic structure (3 tier branches)
- Create CSS classes for landing page layout
- Wire up: profile loads → computes tier → renders landing page

### Step 2: New User Landing Content
- Implement profile card (minimal variant)
- Implement hero onboarding section (4 path cards)
- Implement knowledge callout (after hero)
- Implement ghost app tiles
- Implement cortex extensions section
- Implement minimal management menu
- Add i18n keys (en + fi)

### Step 3: Active User Landing Content
- Implement profile card (full variant with stats)
- Implement app strip (horizontal scrollable)
- Implement "Daily" menu section with badge counts
- Implement knowledge button (actionable)
- Implement "Build & Share" menu section
- Implement "Management" menu section with expand trigger
- Add i18n keys

### Step 4: Experienced User Landing Content
- Implement profile card with federation badge
- Implement management subgroups (Technical / Personal)
- Implement "Infrastructure" section (operator annotation)
- Add i18n keys

### Step 5: Inline Preview Panels
- Create `inline-panels.js` with `InlinePanel` container component
- Implement panel open/close logic (single panel at a time)
- Implement CSS transitions (max-height + opacity)
- Create panel content components:
  - NotificationsPanel
  - AgentsPanel
  - MemoryPanel
  - BoardsPanel
  - PackagesPanel
  - KnowledgePanel
- Wire menu items: click → toggle panel or navigate to tab

### Step 6: Tab Visibility
- Add `minTier` property to each tab definition in TABS array
- Add tier filtering logic to tab bar rendering
- Handle edge cases: saved tab hidden for tier → fallback to home
- Keep deep-link support (`?tab=X` always works)

### Step 7: Mobile Polish + Responsive Tuning
- Verify all breakpoints (base → 480px → 640px → 900px)
- Test touch targets (minimum 44x44px on all interactive elements)
- App strip: fade-edge scroll hints, smooth touch scrolling
- Inline panels: `max-height: 60vh` with scroll on mobile
- Tab bar: horizontal scroll with fade edges on mobile
- Ghost tile / onboarding card: single-column stacking on phones
- Scroll behavior: panel open → smooth scroll into view
- Transition timing refinement
- Test on real devices / Chrome DevTools device emulation

### Step 8: Testing
- Playwright tests for each tier (mock different stat levels)
- Test tier transitions (new → active when first app installed)
- Test inline panel open/close/switch
- Test tab visibility filtering
- Test deep links bypass tier filtering
- Test responsive layouts at each breakpoint (phone, tablet, desktop)
- Test live-update reactivity:
  - SSE event → stats bar updates
  - SSE event → open inline panel refreshes
  - SSE event → tier transition triggers layout change
  - SSE event → notification badge increments
- Test mobile touch interactions (panel open/close, app strip scroll, menu item tap)

## Part 9: Files Summary

| File | Action | Description |
|------|--------|-------------|
| `public/views/profile.js` | MODIFY | Add `computeTier()`, default to home view, filter tabs by tier |
| `public/views/profile/landing-page.js` | CREATE | Adaptive dashboard component (3 tier variants) |
| `public/views/profile/inline-panels.js` | CREATE | Inline preview panel components |
| `public/css/views/profile.css` | MODIFY | Add landing page + inline panel styles (~300 lines) |
| `locales/en.json` | MODIFY | Add `profile.landing.*` i18n keys |
| `locales/fi.json` | MODIFY | Add `profile.landing.*` i18n keys (Finnish) |
| `public/spa.html` | MODIFY | Add importmap entries if new shared modules needed |

**No backend changes. No new API endpoints. No database migrations.**

## Part 10: Psychological Design Notes (from wireframe analysis)

These design decisions are baked into the layout and must be preserved:

1. **Knowledge callout AFTER hero (new user):** Hero answers "what can I do?" first. Knowledge callout is a natural continuation, not a competing message. Sequential priming effect.

2. **No "edit profile" for new users:** Premature commitment request. Appears only when user has content (earned identity vs empty identity).

3. **Ghost tiles for new users:** Social proof ("others installed these") + goal gradient (endowed progress effect — profile will look like this).

4. **Knowledge as button not callout (active user):** Passive info element → actionable item. Fits Fitts's law better. Placed after "Daily" section for contextual relevance.

5. **Management subgroups (experienced):** 9 items in one group → 5+4 split. Reduces visual scanning load.

6. **Scroll rhythm:** New user: heavy (hero) → light (callout) → medium (ghost tiles). Natural eye rest pattern.
