# CLAUDE.md — AI Assistant Instructions for JM001 / AIMEAT

## Project Overview

This is the **AIMEAT Protocol** (AI Memory Exchange and Action Transfer) — an open protocol for AI agent infrastructure. The repo contains:

1. **Protocol specification** (RFC v1.2) in `docs/` and `openapi.yaml`
2. **Reference implementation** in `aimeat/` — a Node.js/TypeScript server

## Architecture

- **Runtime:** Node.js 24.x, ESM (`"type": "module"`)
- **Framework:** Express 5.2.1 — note: `req.params` returns `string | string[]`, cast with `as string`
- **Language:** TypeScript 5.9.3, strict mode, ES2022 target, NodeNext module resolution
- **Crypto:** @noble/ed25519 3.0 for key generation/signing, jose 6.1 for EdDSA JWTs
- **Package manager:** pnpm
- **Port:** 40050

## Key Commands

```bash
# All commands from aimeat/ directory
cd aimeat

# Dev server (auto-reload)
pnpm dev

# Type-check (no emit)
npx tsc --noEmit

# Run E2E tests (server must be running on :40251)
npx tsx test/e2e-full.ts

# Build for production
pnpm build

# Start production
pnpm start

# Start with CLI bootstrap args
pnpm start -- --db mongodb --db-url mongodb://localhost:27017/aimeat
pnpm start -- --db sqlite --db-path ./data/aimeat.db
pnpm start -- --consul http://consul:8500

# Start with config file
pnpm start -- --config production.ini
```

## Code Conventions

### Response Envelope

Every response uses the AIMEAT envelope via `success()` / `error()` from `src/middleware/envelope.ts`:

```typescript
import { success, error } from '../middleware/envelope.js';

// Success with hints
res.json(success(config.nodeId, { data: 'here' }, [
  { description: 'Next action', method: 'GET', url: '/v1/endpoint' },
]));

// Error
res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
```

### Auth Middleware

```typescript
import { requireAuth, requireRole } from '../auth/middleware.js';

// Agent-only endpoint
router.post('/v1/endpoint', requireAuth(), requireRole('agent'), async (req, res) => {
  const gaii = req.auth!.sub;       // Agent GAII
  const owner = req.auth!.owner;    // Owner name
  const roles = req.auth!.roles;    // ['owner'] or ['agent'] or ['owner', 'operator']
});
```

### Route Registration

All routes are mounted in `src/server.ts`. New routers follow the pattern:

```typescript
export function myRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  router.get('/v1/myendpoint', ...);
  return router;
}
```

Then in server.ts: `app.use(myRouter(config, storage));`

### Storage Layer

All data access goes through the `Storage` interface (`src/storage/interface.ts`). Current implementation is in-memory (`src/storage/memory.ts`). When adding new data types:

1. Add the interface/record type to `interface.ts`
2. Add CRUD methods to the `Storage` interface
3. Implement in `memory.ts` with a new `Map`

### Import Extensions

Always use `.js` extensions in imports (ESM requirement):
```typescript
import { foo } from '../services/foo.js';  // ✅
import { foo } from '../services/foo';     // ❌
```

## File Organization

| Directory | Purpose |
|-----------|---------|
| `src/auth/` | JWT, keypair generation, auth middleware |
| `src/middleware/` | Response envelope, rate limiting |
| `src/routes/` | Express route handlers (one file per domain) |
| `src/services/` | Business logic (morsel economy, trust scoring) |
| `src/storage/` | Data layer abstraction + implementations |
| `src/cli/` | CLI wizards (init wizard) |
| `src/utils/` | GAII utilities, logger |
| `locales/` | i18n translations (en.json, fi.json) |
| `public/views/admin/` | Admin dashboard tab components (Preact + HTM) |
| `public/views/admin/shared.js` | Shared admin components (Badge, ExpandableHelp, etc.) |
| `public/js/services/admin.js` | Admin API service layer |
| `public/css/views/admin.css` | Admin dashboard styles (adm-* prefix) |
| `test/` | E2E test suite |

## Frontend

The frontend is a Preact + HTM SPA with no build step. See `docs/frontend-development-guide.md` for complete architecture, component library, admin dashboard tab conventions, and CSS patterns.

## Testing

The E2E test file (`test/e2e-full.ts`) runs 35 tests across 6 phases + GDPR. Tests run against a live server on port 40251. The test creates its own owner/agents and cleans up via cascade delete at the end.

**Always run `npx tsc --noEmit` after changes** to verify the build compiles cleanly.

## Spec Documents

- `openapi.yaml` — The canonical API contract (75 paths, 88 operations)
- `docs/aimeat-implementation-prompt.md` — Detailed implementation guidance
- `docs/01-core.md` through `docs/09-community.md` — RFC sections
- `docs/a-endpoints.md` — Quick endpoint reference
- `docs/b-config.md` — Node configuration schema
- `docs/c-platform-notes.md` — AI platform compatibility

## Backend Architecture Rule — NO Server-Side Rendering

**The AIMEAT backend is protocol-only.** Every route in `src/routes/` must provide a generic, reusable API endpoint. The backend NEVER renders HTML, builds UI, or serves page templates.

### Why

AIMEAT's architecture is: **CSM defines data shape + rules → Generic APIs handle storage/consent/validation → Clients (AI chats, portal SPAs, apps) render UI.** Any service (hobby directory, marketplace, dating, news) is just a client reading a CSM definition and talking to generic APIs. No per-service backend code.

### Rules

1. **No SSR in routes.** Never `res.send('<html>...')` or build HTML strings in route handlers. If you need a UI, it's a client-side SPA or a static file.
2. **Every new route must be generic.** Ask: "Would a second, different service also use this endpoint?" If no, it doesn't belong in the backend.
3. **No per-service backend files.** Never create `portal-hobbies.ts`, `portal-marketplace.ts`, etc. The CSM format + generic APIs (memory, consent, directory, flags, schemas) cover all service types.
4. **Admin dashboard is the ONE exception** — operator tooling may render HTML, but should migrate toward client-side SPA over time.
5. **If data is available via an existing API, don't wrap it.** A route that calls `storage.getMemory()` and renders HTML is redundant — the client should call `GET /v1/memory` directly.

### Core Generic APIs (the only backend you need)

| API | Purpose |
|-----|---------|
| Memory | Store/read any key-value data |
| Schema Locking | Validate data shape (CSM-defined rules) |
| Consent | Control who sees what + audit trail |
| Directory/Catalogue | Search by city/interest/geo |
| Flags | Content moderation |
| Auth/GHII | Identity + login + TOTP |
| Stats | Usage counters |
| Boards | Social discussion |
| Organisms | Group management |
| Wallet | Morsel economy |
| CSM/MSM | Service manifest registration |

### SSR Removal — COMPLETED (2026-03-03)

6 SSR backend files (~9,000 lines) were removed and replaced with static HTML files in `aimeat/public/`:

| Deleted backend file | Replaced by | Lines removed |
|---------------------|-------------|---------------|
| `portal-hobbies.ts` | `public/hobbies.html` | 1,153 |
| `portal-marketplace.ts` | `public/marketplace.html` | 910 |
| `portal-human.ts` | `public/human.html` | 2,546 |
| `profile.ts` | `public/profile.html` | 2,048 |
| `guides.ts` | `public/guides.html` | 1,793 |
| `aimeat-os.ts` | `public/aimeat-os.html` | 551 |

**Remaining exceptions (kept intentionally):**
- `admin-dashboard.ts` — operator tooling (will migrate to SPA later)
- `portal.ts` — landing page entry point (serves static HTML inline at `/v1/portal`) + dev portal SSR (`?view=dev`)
- `personal.ts` — pure JSON API, NOT SSR
- `portal-api.ts` — pure JSON API (extracted from portal-human.ts)
- `setup.ts` — pure JSON API for first-run node initialization

**Static HTML URL routing (2026-03-04):**
- Static HTML files in `public/` are NOT directly accessible by filename
- They are served inline at canonical `/v1/` URLs via backward-compatible routes in `portal.ts`
- Direct access to e.g. `/human.html` returns 301 redirect to `/v1/portal`
- Route map: `/v1/portal` → human.html, `/v1/profile` → profile.html, `/v1/guides` → guides.html, `/v1/aimeat-os` → aimeat-os.html, `/v1/hobbies` → hobbies.html, `/v1/marketplace` → marketplace.html

**Phase 1 gap closure (2026-03-04):**
- `setup.ts` + `public/wizard.html` — first-run web wizard (5-step node setup)
- Memory `flagCount` field + `max_flags` query filter — Phase 1.5 flag integration
- `profile.html` Data Wallet tab — consents list, audit report, GDPR export
- `hobbies.html` #matches view — shows people with shared interests

## Common Pitfalls

- **Express 5 params:** `req.params.foo` is `string | string[]`. Always cast: `req.params.foo as string`
- **Route ordering:** Static routes (e.g., `/v1/memory/search`) must be registered before parameterized routes (e.g., `/v1/memory/:key`)
- **Ed25519 sha512Sync:** Must set `ed.etc.sha512Sync` using `node:crypto` for synchronous operations
- **MultiDiGraph:** If two nodes can have multiple edges (e.g., goal_reached + goal_not_reached), use `MultiDiGraph`, not `DiGraph`
- **First owner is operator:** The first registered owner automatically gets the `operator` role

## Naming Convention — AIMEAT Only

**Never use `MEAT` as a standalone prefix.** The project has been fully renamed to `AIMEAT`:

- Type names: `AimeatConfig`, `AimeatResponse` (not ~~MeatConfig~~, ~~MeatResponse~~)
- Env vars: `AIMEAT_*` prefix (not ~~MEAT_*~~)
- Default node ID: `aimeat-local-001-dev` (not ~~meat-local-001-dev~~)

If you find any remaining `Meat`-prefixed identifiers, rename them to `Aimeat`.

## Init Wizard Maintenance (`aimeat init`)

The interactive setup wizard lives in `src/cli/init-wizard.ts` and uses `@clack/prompts` for the UI. When adding new config options:

1. **Add the env var to `src/config.ts`** in the `AimeatConfig` interface and `loadConfig()`
2. **Add translations** to both `locales/en.json` and `locales/fi.json` under the `"init"` section — field label, hint text, validation error message
3. **Add the prompt** to the wizard in `src/cli/init-wizard.ts`:
   - Decide which use cases need it (public / personal / dev / custom)
   - Add to `askCoreSettings()` or `askEconomySettings()` or `askAllAdvancedSettings()`
   - Add the env var key to `CONFIG_DEFAULTS` for summary comparison
4. **Update `.env.example`** with the new variable, default, and comment
5. **Update `src/utils/env-config.ts`** to display the setting in `aimeat config`
6. **Update `src/utils/env-validator.ts`** if the setting needs validation rules
7. Run `npx tsc --noEmit` and `pnpm build` to verify
