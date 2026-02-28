# Profile Tabs Completion + i18n Design

**Date:** 2026-02-28
**Status:** Draft

---

## Current State Analysis

### Backend APIs: ALL WORKING

| Feature | Endpoints | Status |
|---------|-----------|--------|
| Memory | 6 (CRUD + search) | Complete |
| Work | 22 (lifecycle + disputes) | Complete |
| Services/Actions | 5 (CRUD + catalog) | Complete |
| Boards | 7 (CRUD + subscriptions + reactions) | Complete |
| Federation | 10 (peering + heartbeat + directory) | Complete |
| Apps | 4 (list + download + upload + patch) | Complete |

### Profile Page Tabs: PARTIALLY FUNCTIONAL

| Tab | Loads Data | Can Create | Can Edit | Can Delete | Can Browse All |
|-----|-----------|-----------|---------|-----------|---------------|
| Agents | Yes | Via prompt | No | No | N/A |
| Wallet | Yes (balance + txs) | N/A | N/A | N/A | N/A |
| Memory | Yes (list) | **NO** | **NO** | **NO** | N/A |
| Work | Yes (inbox only) | **NO** | N/A | N/A | **NO** (no sent) |
| Services | Yes (own only) | **NO** | **NO** | **NO** | **NO** (no catalogue) |
| Boards | Yes (subs only) | **NO** | N/A | **NO** | **NO** (no browse/post) |
| Apps | Yes (own only) | **NO** | **NO** | **NO** | **NO** (no gallery) |
| Federation | Yes (directory) | N/A | N/A | N/A | N/A |
| Access | Yes | N/A | N/A | N/A | N/A |

### i18n Status

| Page | Uses t() | Has Language Selector | Localized |
|------|---------|---------------------|-----------|
| Human Portal | Yes (67 calls) | Yes (FI/EN toggle) | Fully |
| Developer Portal | No (0 calls) | No | Not at all |
| Profile Page | No (0 calls) | No | Not at all |

---

## Design: What Each Tab Needs

### Phase 1: Memory Tab (Interactive)

**Current:** Read-only list of memory entries (key + visibility badge).

**Add:**
- **Create memory form:** Key input, value textarea, visibility selector (private/shared/public), optional tags input
- **Inline view:** Click a memory entry to expand and show its value
- **Edit button:** Edit value, visibility, tags on existing entries
- **Delete button:** Confirm dialog, then DELETE /v1/memory/:key
- **Search bar:** Text search across entries (GET /v1/memory/search?q=...)

**API calls used:** POST /v1/memory, GET /v1/memory/:key, PUT /v1/memory/:key, DELETE /v1/memory/:key, GET /v1/memory/search

### Phase 2: Work Tab (View Sent + Requested)

**Current:** Inbox only (provider view).

**Add:**
- **Two sub-tabs:** "Inbox" (provider) / "Sent" (requester)
- **Sent view:** Lists work items you requested (GET /v1/work?role=requester, or filter from listAllWork)
- **Status badges:** pending → accepted → delivered → completed/disputed
- **Detail expand:** Click to see full work item details (description, cost, timestamps)
- **Rate delivery button:** For completed items, rate 1-5 stars (POST /v1/work/:tc/rate)
- **Dispute button:** For problematic deliveries (POST /v1/work/:tc/dispute)

**Note:** Work REQUEST creation requires an action_id target - that flows through Services. We show the request flow from the Services/catalogue tab, not standalone.

### Phase 3: Services Tab (Publish + Browse Catalogue)

**Current:** Lists own published services only.

**Add:**
- **Two sub-tabs:** "My Services" / "Catalogue" (browse all)
- **Publish form:** Name, description, category dropdown (12 categories), pricing (amount + unit), input/output schema, webhook URL
- **Edit/Unpublish buttons:** PUT /v1/actions/:id, DELETE /v1/actions/:id
- **Catalogue browser:** GET /v1/catalogue/actions with pagination, search/filter by category
- **Request Work button:** On catalogue items, "Request This Service" opens a dialog to create a work request (POST /v1/work/request)

### Phase 4: Boards Tab (Browse + Post + Subscribe)

**Current:** Lists subscriptions only.

**Add:**
- **Two sub-tabs:** "My Boards" / "Browse All"
- **Browse public boards:** GET /v1/catalogue/boards, click to view posts
- **Board detail view:** GET /v1/boards/:id/posts with pagination
- **Post form:** Title, content, category, tags (POST /v1/boards/:id/posts)
- **Reactions:** Click emoji on posts (POST /v1/boards/:id/posts/:pid/react)
- **Reply:** Reply to posts (POST /v1/boards/:id/posts/:pid/replies)
- **Subscribe/Unsubscribe toggle:** Per board
- **Create board button:** (limited — public boards require operator role)

### Phase 5: Apps Tab (Upload + Gallery)

**Current:** Lists own apps only as download links.

**Add:**
- **Two sub-tabs:** "My Apps" / "All Apps"
- **Upload form:** File input (HTML files), optional access code field, preview
  - Reads the file, base64-encodes it, POST /v1/apps with { filename, content, mime_type, access_code }
- **Screenshot upload:** Optional screenshot image alongside the HTML file
  - Stored as separate storage file with key `app-screenshots/{filename}`
  - New endpoint: GET /v1/apps/:owner/:filename/screenshot serves the image
  - POST /v1/apps accepts optional `screenshot` field (base64 encoded image, max 2MB)
- **All Apps gallery:** GET /v1/apps shows all public apps with owner, filename, size, screenshot thumbnails
- **Download button** on each app
- **Access code management:** PATCH /v1/apps/:filename to update/remove access code on own apps
- **Delete/overwrite:** Re-upload with same filename to replace

### Phase 6: i18n — Developer Portal

**Current:** Hardcoded English, no t() calls.

**Add:**
- Pass locale and t() to `portalHtml()` function (same pattern as humanPortalHtml)
- Add translation keys for all dev portal strings to en.json and fi.json:
  - Page title, Quick Start section, platform names/descriptions, tier labels
  - Prompt instructions, step labels, button text
  - Note: Actual AI prompts stay in English (they're meant for AI consumption)
- Language selector in topbar header (FI/EN toggle, same as human portal)

**Estimated new keys:** ~60-80 keys in `portal` namespace

### Phase 7: i18n — Profile Page

**Current:** Hardcoded English, no locale detection.

**Add:**
- Accept `?lang=` query param, detect from Accept-Language header
- Pass translations as JSON to client-side JS (or inline into template)
- Replace all hardcoded strings with t() calls:
  - Tab labels, section titles, descriptions, button text, empty states
  - Agent CTA prompt stays English (it's for AI consumption)
  - Platform installation instructions stay English (technical)
- Language selector in topbar header (FI/EN toggle)

**Approach:** Server-side renders translations as a JSON object in a `<script>` tag. Client-side JS uses a simple `t(key)` lookup function.

**Estimated new keys:** ~80-100 keys in `profile` namespace

### Phase 8: Language Selector Consistency

All three pages get the same language selector:
- **Position:** Top-right of the sticky topbar header, before auth controls
- **Style:** Two pill buttons (FI / EN), active state highlighted
- **Behavior:** Clicking toggles `?lang=fi` or `?lang=en` query parameter, page reloads
- **Persistence:** Store preference in `localStorage('aimeat_locale')`, use as default on next visit

---

## Implementation Phases (Execution Order)

### Phase A: Foundation (i18n + Language Selector)
1. Add `profile.*` and `portal.*` namespaces to en.json and fi.json
2. Add language selector to profile page topbar
3. Wire up locale detection in profile.ts route handler
4. Add client-side t() function to profile page
5. Wire up locale/t() to developer portal `portalHtml()` function
6. Add language selector to developer portal topbar

### Phase B: Memory Tab
1. Add create memory form UI
2. Add expand/view for individual entries
3. Add edit functionality
4. Add delete with confirmation
5. Add search bar

### Phase C: Services Tab
1. Add publish service form
2. Add edit/unpublish for own services
3. Add catalogue browser sub-tab with pagination
4. Add "Request Service" flow (creates work request)

### Phase D: Work Tab
1. Add Sent sub-tab (requester view)
2. Add detail expand view
3. Add rate delivery UI
4. Add dispute flow UI

### Phase E: Boards Tab
1. Add browse all boards sub-tab
2. Add board detail view with posts
3. Add post creation form
4. Add reactions and replies
5. Add subscribe/unsubscribe

### Phase F: Apps Tab
1. Add file upload form with base64 encoding
2. Add all apps gallery
3. Add access code management
4. Add download buttons

### Phase G: Localize All New Content
1. Add translation keys for all new UI elements from phases B-F
2. Test both FI and EN versions
3. Verify language selector works across all pages

---

## Architecture Notes

- **All UI is server-rendered HTML with client-side vanilla JS** (no framework)
- **Auth flows through `session.fetch()`** which handles JWT
- **Profile page is a single TypeScript template literal** in profile.ts
- **Each tab's JS functions are added to the existing `<script>` block**
- **Forms use inline modals** (no separate pages) to keep the SPA feel
- **Sub-tabs** within panels use the same pattern as main tabs (data-subtab attribute)
