# SSR Removal & Backend Cleanup — Design

*2026-03-03 — Move service-specific UI from backend SSR to static HTML files*

---

## Problem

~9,300 lines of backend code in `src/routes/` render HTML server-side for specific services (hobby directory, marketplace, profile builder, etc.). This violates AIMEAT's architecture:

- **CSM defines data shape + rules** (YAML)
- **Backend validates and enforces** via schema locking + consent (generic APIs)
- **Clients render UI** and send data to generic APIs

The backend should never contain per-service HTML rendering. Every service (hobbies, marketplace, dating, news) uses the same generic APIs. The backend enforces data quality through CSM-driven schema validation — if a client sends invalid data, the API rejects it.

## Architecture

```
Client (HTML/app/AI chat)
  → Knows what it's building (form fields, layout)
  → Sends data to generic APIs (POST /v1/memory, etc.)
  → Gets error if data doesn't match registered CSM schema

Backend (generic only)
  → POST /v1/memory receives data
  → Schema Locking checks: does a schema exist for this key pattern?
  → CSM-registered schemas validate: required fields, types, enums, constraints
  → Rejects with 422 + validation errors if invalid
  → Stores if valid
  → Consent layer controls visibility
```

The client does NOT need to read CSM definitions at runtime. It just sends data. The backend is the gatekeeper.

## What Changes

### Keep (no changes)

- `admin.ts` + `admin-dashboard.ts` — operator tooling (exception)
- `portal.ts` — landing page entry point
- All core API routes (memory, consent, schemas, catalogue, flags, auth, etc.)

### Convert: Backend SSR → Static HTML

Each SSR file gets converted to a static `.html` file in `aimeat/public/`. The HTML file contains the same UI but calls APIs client-side via `fetch()` instead of server-side via `storage.*`.

| Backend SSR (delete) | Static HTML (create) | Lines removed |
|---------------------|---------------------|---------------|
| `portal-hobbies.ts` | `public/hobbies.html` | 1,153 |
| `portal-marketplace.ts` | `public/marketplace.html` | 910 |
| `profile.ts` | `public/profile.html` | 2,048 |
| `guides.ts` | `public/guides.html` | 1,793 |
| `aimeat-os.ts` | `public/aimeat-os.html` | 551 |
| `personal.ts` | `public/personal.html` | 283 |

### Refactor: Extract unique logic, delete SSR

| File | Keep | Delete |
|------|------|--------|
| `portal-human.ts` (2,546 lines) | `POST /v1/portal/try-memory` → move to `boards.ts` or `memory.ts` | Everything else (HTML template) |

### Server changes

- `server.ts`: Add `app.use(express.static('public'))` for serving static files
- `server.ts`: Remove imports + `app.use()` for deleted SSR routers
- Verify no other files import from deleted routes

### Static HTML pattern

Each HTML file follows this pattern:
- Self-contained HTML + CSS + JS (same AIMEAT design system)
- Uses `fetch('/v1/...')` for all data operations
- Auth via existing JWT token (stored in localStorage/cookie by portal login)
- No build step — plain HTML files served as static assets

## What Does NOT Change

- Core APIs (memory, consent, directory, flags, schemas, auth, stats, boards, organisms, wallet, CSM/MSM)
- Schema validation logic (backend enforces CSM rules on writes)
- Admin dashboard (kept as exception)
- Portal landing page (kept)
- Any test files

## Execution Order

1. Create `aimeat/public/` directory
2. Convert each SSR file to static HTML (extract HTML/CSS/JS, replace `storage.*` with `fetch()`)
3. Extract `POST /v1/portal/try-memory` from `portal-human.ts` into appropriate API route
4. Add `express.static('public')` to server.ts
5. Remove SSR routes from server.ts imports + mounts
6. Delete SSR backend files
7. Verify: `npx tsc --noEmit`, `npx vitest run`, manual check HTML files load

## Metrics

- **Lines removed:** ~9,284 backend TypeScript
- **Lines added:** ~equivalent HTML (but in static files, not backend)
- **Net architecture improvement:** Backend becomes protocol-only; no per-service code
