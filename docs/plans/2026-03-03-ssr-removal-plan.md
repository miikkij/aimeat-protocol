# SSR Removal & Backend Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove ~9,000 lines of redundant server-side rendered HTML from backend routes, replacing them with static HTML files that call generic APIs client-side. Backend becomes protocol-only.

**Architecture:** Each SSR backend file (TypeScript that builds HTML strings) gets converted to a static `.html` file in `aimeat/public/`. The HTML files use `fetch()` to call existing generic APIs. The backend enforces data quality via CSM-driven schema validation. `personal.ts` is kept — it's a pure JSON API, not SSR.

**Tech Stack:** Plain HTML/CSS/JS (no build step), existing AIMEAT client libraries (`/v1/libs/aimeat-*.js`), existing generic APIs

---

## Task 1: Extract POST /v1/portal/try-memory from portal-human.ts

**Files:**
- Modify: `aimeat/src/routes/boards.ts` — add the try-memory endpoint
- Read: `aimeat/src/routes/portal-human.ts:2507-2546` — the endpoint to extract

**Step 1: Read the try-memory endpoint**

Read `portal-human.ts` line 2507 onward. This endpoint:
- Requires auth (`requireAuth()`)
- Reads GAII from `req.auth!.sub`
- Appends a message to `board.public` memory entry
- Keeps last 20 messages with 72h TTL
- Returns JSON via `success()` envelope

**Step 2: Copy endpoint to boards.ts**

Add the `POST /v1/portal/try-memory` route to `boards.ts` (or create a small `portal-api.ts` if boards.ts is not the right fit). Preserve exact behavior — same auth, same storage calls, same response.

**Step 3: Verify type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add aimeat/src/routes/boards.ts
git commit -m "refactor: extract POST /v1/portal/try-memory from portal-human.ts to boards.ts"
```

---

## Task 2: Convert guides.ts to static HTML

**Files:**
- Create: `aimeat/public/guides.html`
- Delete (later): `aimeat/src/routes/guides.ts` (1,793 lines)

**Step 1: Create static HTML guide page**

Read `aimeat/src/routes/guides.ts` to extract:
- The guide content (hardcoded text in GUIDES map)
- The CSS styling
- The layout HTML

Create `aimeat/public/guides.html` that:
- Contains all guide content as static HTML sections
- Uses the same AIMEAT dark theme CSS (extract from the TS template literals)
- Has client-side JS for slug-based navigation (show/hide sections based on hash)
- Supports locale switching via `?lang=fi` query param with embedded translations
- Is a self-contained single HTML file

**Step 2: Verify the HTML loads**

Open `http://localhost:40050/guides.html` in browser — should render guide content.

**Step 3: Commit**

```bash
git add aimeat/public/guides.html
git commit -m "feat: convert guides to static HTML"
```

---

## Task 3: Convert profile.ts to static HTML

**Files:**
- Create: `aimeat/public/profile.html`
- Delete (later): `aimeat/src/routes/profile.ts` (2,048 lines)

**Step 1: Create static HTML profile page**

Read `aimeat/src/routes/profile.ts`. This is already 99% client-side — it renders a static template with i18n translations and loads `aimeat-auth.js`. The only server logic is locale resolution.

Create `aimeat/public/profile.html` that:
- Contains the same HTML/CSS (extract from template literals)
- Embeds both en/fi translations as JS objects, switches client-side based on `navigator.language` or `?lang=` param
- Loads `/v1/libs/aimeat-auth.js` for auth
- All form submissions already use `fetch()` client-side

**Step 2: Verify the HTML loads**

Open `http://localhost:40050/profile.html` — should render profile builder UI.

**Step 3: Commit**

```bash
git add aimeat/public/profile.html
git commit -m "feat: convert profile builder to static HTML"
```

---

## Task 4: Convert aimeat-os.ts to static HTML

**Files:**
- Create: `aimeat/public/aimeat-os.html`
- Delete (later): `aimeat/src/routes/aimeat-os.ts` (551 lines)

**Step 1: Create static HTML page**

Read `aimeat/src/routes/aimeat-os.ts`. It serves markdown content with the node URL injected.

Create `aimeat/public/aimeat-os.html` that:
- Contains the markdown content rendered as HTML
- Uses client-side JS to detect the current node URL: `window.location.origin`
- Replaces `${nodeUrl}` placeholders with the detected URL
- Same dark theme styling

**Step 2: Verify the HTML loads**

Open `http://localhost:40050/aimeat-os.html` — should render the AIMEAT OS guide with correct node URL.

**Step 3: Commit**

```bash
git add aimeat/public/aimeat-os.html
git commit -m "feat: convert aimeat-os to static HTML with client-side URL detection"
```

---

## Task 5: Convert portal-hobbies.ts to static HTML

**Files:**
- Create: `aimeat/public/hobbies.html`
- Delete (later): `aimeat/src/routes/portal-hobbies.ts` (1,153 lines)

**Step 1: Create static HTML hobby directory page**

Read `aimeat/src/routes/portal-hobbies.ts`. Extract HTML/CSS/JS from template literals.

Create `aimeat/public/hobbies.html` that:
- Uses the same AIMEAT design system CSS
- On load, fetches `GET /v1/catalogue/directory` for directory stats and entries
- Search form submits to `GET /v1/catalogue/directory?city=X&interest=Y&radiusKm=Z`
- Profile view fetches `GET /v1/ghii/:id` for GHII data
- Join form POSTs to memory/consent APIs (profile creation + consent grant)
- "My profile" section fetches user's own data via auth token
- All rendering done client-side from JSON API responses

**Step 2: Verify the HTML loads and search works**

Open `http://localhost:40050/hobbies.html` — should render hobby directory. Search should return results from directory API.

**Step 3: Commit**

```bash
git add aimeat/public/hobbies.html
git commit -m "feat: convert hobby directory to static HTML with client-side API calls"
```

---

## Task 6: Convert portal-marketplace.ts to static HTML

**Files:**
- Create: `aimeat/public/marketplace.html`
- Delete (later): `aimeat/src/routes/portal-marketplace.ts` (910 lines)

**Step 1: Create static HTML marketplace page**

Read `aimeat/src/routes/portal-marketplace.ts`. Extract HTML/CSS/JS.

Create `aimeat/public/marketplace.html` that:
- Browse listings via `GET /v1/catalogue` with marketplace filters
- Search/filter by category, city, price range — all client-side fetch
- Listing detail via API call
- Sell form POSTs to memory API with marketplace schema validation
- My listings / my purchases via authenticated API calls
- Same AIMEAT design system

**Step 2: Verify**

Open `http://localhost:40050/marketplace.html` — should render marketplace.

**Step 3: Commit**

```bash
git add aimeat/public/marketplace.html
git commit -m "feat: convert marketplace to static HTML with client-side API calls"
```

---

## Task 7: Convert portal-human.ts to static HTML

**Files:**
- Create: `aimeat/public/human.html`
- Modify: `aimeat/src/services/site.ts` — stop importing `humanPortalHtml()`, serve static file instead
- Delete (later): `aimeat/src/routes/portal-human.ts` (2,546 lines)

**Step 1: Create static HTML human portal page**

Read `aimeat/src/routes/portal-human.ts`. The `humanPortalHtml()` function exports the main "try it now" experience. Most of it is already client-side JS that makes API calls.

Create `aimeat/public/human.html` that:
- Contains the same HTML/CSS/JS (extract from template literals)
- Embeds en/fi translations, switches client-side
- Loads aimeat-auth.js for auth
- "Try memory" form calls `POST /v1/portal/try-memory` (moved to boards.ts in Task 1)
- All other interactions already use fetch() calls

**Step 2: Update site.ts**

Modify `src/services/site.ts` to stop importing `humanPortalHtml()`. Instead, redirect or serve the static `human.html` file. Check how the root `/` page works and update accordingly.

**Step 3: Verify**

Open `http://localhost:40050/human.html` — should render the interactive portal.

**Step 4: Commit**

```bash
git add aimeat/public/human.html aimeat/src/services/site.ts
git commit -m "feat: convert human portal to static HTML"
```

---

## Task 8: Remove SSR routes from server.ts and delete files

**Files:**
- Modify: `aimeat/src/server.ts` — remove imports + app.use() for deleted routers
- Delete: `aimeat/src/routes/portal-hobbies.ts`
- Delete: `aimeat/src/routes/portal-marketplace.ts`
- Delete: `aimeat/src/routes/portal-human.ts`
- Delete: `aimeat/src/routes/profile.ts`
- Delete: `aimeat/src/routes/guides.ts`
- Delete: `aimeat/src/routes/aimeat-os.ts`

**DO NOT delete:** `personal.ts` (it's a pure JSON API, not SSR)

**Step 1: Remove imports from server.ts**

Remove these import lines from `src/server.ts`:
- `import { humanPortalRouter } from './routes/portal-human.js'` (line 37)
- `import { profileRouter } from './routes/profile.js'` (line 38)
- `import { aimeatOsRouter } from './routes/aimeat-os.js'` (line 46)
- `import { guidesRouter } from './routes/guides.js'` (line 47)
- `import { portalMarketplaceRouter } from './routes/portal-marketplace.js'` (line 53)
- `import { portalHobbiesRouter } from './routes/portal-hobbies.js'` (line 72)

**Step 2: Remove app.use() mounts from server.ts**

Remove these mount lines:
- `app.use(humanPortalRouter(config, storage))` (line 404)
- `app.use(portalHobbiesRouter(config, storage, directoryService))` (line 405)
- `app.use(portalMarketplaceRouter(config, storage))` (line 406)
- `app.use(profileRouter(config, storage))` (line 407)
- `app.use(aimeatOsRouter(config))` (line 445)
- `app.use(guidesRouter(config))` (line 446)

**Step 3: Check for other imports**

Search for any other files importing from the deleted routes. Known: `site.ts` imports `humanPortalHtml` — should already be fixed in Task 7.

**Step 4: Delete the SSR route files**

```bash
cd aimeat
rm src/routes/portal-hobbies.ts
rm src/routes/portal-marketplace.ts
rm src/routes/portal-human.ts
rm src/routes/profile.ts
rm src/routes/guides.ts
rm src/routes/aimeat-os.ts
```

**Step 5: Type check + tests**

Run: `cd aimeat && npx tsc --noEmit`
Expected: No errors (all references to deleted files removed)

Run: `cd aimeat && npx vitest run`
Expected: All tests pass (SSR routes have no unit tests)

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove 6 SSR backend files (~9,000 lines), backend is now protocol-only"
```

---

## Task 9: Update CLAUDE.md legacy list

**Files:**
- Modify: `CLAUDE.md` — update the legacy SSR files section

**Step 1: Update CLAUDE.md**

Change the "Legacy SSR files" section to reflect completed cleanup. Mark removed files as done, note that `admin-dashboard.ts` and `portal.ts` remain as exceptions.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — SSR removal complete"
```

---

## Execution Order

```
Task 1 (extract try-memory endpoint) — must be first (before deleting portal-human.ts)
Tasks 2-7 (convert to static HTML) — can run in parallel
Task 8 (remove SSR routes + delete files) — must be after Tasks 1-7
Task 9 (update CLAUDE.md) — last
```

## Verification

After all tasks complete:
1. `cd aimeat && npx tsc --noEmit` — zero errors
2. `cd aimeat && npx vitest run` — all tests pass
3. Open static HTML files in browser — verify they load and API calls work
4. Verify admin dashboard still works (not touched)
5. Verify portal landing page still works (not touched)
