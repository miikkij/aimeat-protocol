# Phase 1 Gap Closure — Design Document

*2026-03-04 — Close remaining 4 gaps to bring Phase 1 to ~95%+*

---

## Problem

Phase 1 is at ~76% completion. Four gaps remain:

| Gap | Sub-phase | Current % | Target % |
|-----|-----------|-----------|----------|
| A. Web Wizard | 1.2 | 30% | 90%+ |
| B. Data Wallet UI | 1.3 | 75% | 95%+ |
| C. Memory flag integration | 1.5 | 80% | 95%+ |
| D. Match view | 1.6 | 85% | 95%+ |

---

## Gap A: Web Wizard (1.2)

### Architecture

Follows the no-SSR rule: static HTML + generic API endpoint.

**New files:**
- `aimeat/public/wizard.html` — 5-step setup wizard (self-contained HTML/CSS/JS)
- `aimeat/src/routes/setup.ts` — `POST /v1/setup/init` API endpoint

**Modified files:**
- `aimeat/src/server.ts` — first-run detection middleware + route mount

### First-Run Detection

In `server.ts`, add middleware that checks if any owner exists in storage:
- If no owners exist AND request is not to `/v1/` API paths → redirect to `/wizard.html`
- If no owners exist AND request IS to `/v1/setup/*` → allow through
- Cache the "has owners" check so it only queries once per startup

### Wizard Flow (5 Steps)

1. **Welcome + Language** — Choose en/fi, brief explanation of AIMEAT
2. **Node Name + Type** — `AIMEAT_NODE_ID` (text input), type: personal/full
3. **GHII Identity** — Create first owner: username, display name, email (optional), password
4. **Anchor Operator** — Choose from known operators or enter custom genesis URL (`AIMEAT_GENESIS_URL`)
5. **Summary + Launch** — Review all settings, confirm, POST to `/v1/setup/init`

### API: POST /v1/setup/init

**Guard:** Only works when no owners exist (prevents re-running on configured node).

**Request body:**
```json
{
  "locale": "en",
  "nodeId": "my-node-001",
  "nodeType": "personal",
  "owner": {
    "username": "erkki",
    "displayName": "Erkki",
    "email": "erkki@example.com",
    "password": "securepass123"
  },
  "genesisUrl": "https://anchor.aimeat.org",
  "port": 40050
}
```

**Actions:**
1. Validate input
2. Create owner + GHII profile (reuse existing registration logic from `ghii.ts`)
3. Write/update `.env` file with config values
4. Return success with JWT token (auto-login)
5. Client-side: store token, redirect to portal

### Design System

Same AIMEAT dark theme as other public HTML files. Step indicator (1/5, 2/5...) at top. Back/Next buttons. Animated transitions between steps.

---

## Gap B: Data Wallet UI (1.3)

### Architecture

Add a new tab to `aimeat/public/profile.html` — purely client-side, calling existing APIs.

### New Tab: "Data Wallet" (Tietolompakko)

**Tab content sections:**

1. **Active Consents List**
   - Fetch: `GET /v1/consent` (auth required)
   - Display: table/cards with data_pattern, recipient, purpose, scope, granted date, expires
   - Each row has a "Revoke" button → `DELETE /v1/consent/:id`
   - Visual status: active (green), expired (gray)

2. **Audit Report**
   - Fetch: `GET /v1/consent/audit?days=30`
   - Display: timeline/list of data access events
   - Columns: who accessed, what key, when, purpose
   - Filter: date range selector (7/30/90 days)

3. **GDPR Export**
   - "Download all my data" button
   - Calls: `GET /v1/owners/:name/export`
   - Downloads as JSON file (uses `Blob` + download link)

### i18n

Add both en/fi translations for the new tab to the embedded TRANSLATIONS object.

---

## Gap C: Memory Flag Integration (1.5)

### Architecture

Add `flagCount` to memory records + filter parameter to memory search.

### Storage Changes

In `aimeat/src/storage/interface.ts`:
- Add `flagCount?: number` to `MemoryRecord`

In `aimeat/src/storage/memory.ts`:
- Initialize `flagCount: 0` on new records
- Add method: `incrementMemoryFlagCount(key: string, ownerGaii: string)`

### Flag Route Changes

In `aimeat/src/routes/flags.ts`:
- After creating a flag with `targetType: 'memory'`, call `storage.incrementMemoryFlagCount()` to bump the counter

### Memory Route Changes

In `aimeat/src/routes/memory.ts`:
- Add `max_flags` query param to `GET /v1/memory` and `GET /v1/memory/search`
- Filter: only return records where `flagCount <= max_flags`
- Include `flagCount` in response metadata

### OpenAPI

Update `openapi.yaml`:
- Add `flagCount` to MemoryEntry response schema
- Add `max_flags` query parameter to memory list/search endpoints

---

## Gap D: Match View in Hobbies (1.6)

### Architecture

Add a `#matches` hash route to `aimeat/public/hobbies.html`.

### New View: "Matches"

- **Requires auth** — show login prompt if not authenticated
- Fetch user's own interests from `GET /v1/memory/profile.{owner}.interests`
- For each interest, query `GET /v1/catalogue/directory?interest={interest}`
- Merge results, deduplicate, exclude self
- Sort by: number of shared interests (most shared first)
- Display: profile cards with shared interests highlighted (badge showing "3 shared interests")

### Navigation

Add "Matches" link to the nav bar (visible only when authenticated). Hash: `#matches`.

### i18n

Add match-related translations to both en/fi objects.

---

## Implementation Order

1. **Gap C (flags)** — smallest, backend-only, no dependencies
2. **Gap D (matches)** — small, client-side only
3. **Gap B (data wallet)** — medium, client-side only
4. **Gap A (wizard)** — largest, new route + HTML file
5. **Verification** — tsc + tests

Tasks 1-2 can run in parallel. Task 3 is independent. Task 4 is independent.
