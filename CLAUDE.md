# CLAUDE.md — AI Assistant Instructions for JM001 / AIMEAT

---

## MANDATORY RULES (HIGHEST PRIORITY)

These rules MUST be followed at all times during development. They override any conflicting default behavior.

### Rule 1: E2E Tests Must Pass After Major Changes

When any major feature, bugfix, or structural change is completed:

1. **Run E2E tests on both persistent backends:**
   ```bash
   cd aimeat
   pnpm test:e2e:mongodb
   pnpm test:e2e:sqlite
   ```
2. **Target: 0 failures.** All tests must pass.
3. **If tests fail in areas affected by the change**, the change is NOT complete — fix the failures first.
4. **If failures are complicated or need user input**, ask the user how to proceed before continuing.
5. **Full test runs are required at the end of any multi-step plan execution.**
6. **New features must include quality E2E tests** that verify correctness and prevent future regressions.
7. **Never claim work is done without running tests.** Evidence before assertions.

Full guide: `docs/coding-guidelines/testing-requirements.md`

### Rule 1b: Playwright Tests Must Pass After Frontend Changes

When frontend work is **finished** (a view, component, or feature is done — not mid-development):

1. **Run Playwright browser tests:**
   ```bash
   cd aimeat
   npx playwright test
   ```
2. **Target: 0 failures.** All browser tests must pass.
3. **Trigger:** Any completed change to `public/views/`, `public/components/`, `public/js/`, `public/css/`, `public/locales/`, or `*.html` files.
4. **New frontend features must include Playwright tests** that confirm the feature renders, navigates, and behaves correctly — not just that it loads without error.
5. **Run on MongoDB backend** for realistic behavior — Playwright tests hit a live server.
6. **Maintain test quality:** Playwright tests must verify that things actually happen (elements appear, data loads, interactions work), not just that the page doesn't crash.

### Rule 2: Source File Headers Required

Every source code file (`.ts`, `.js`, `.css`) must have a descriptive header comment:

- `@file` — filename
- `@description` — what the file does and its role in the system
- `@structure` — key exports/sections (recommended)
- `@usage` — import example or how it's consumed (recommended)
- `@version-history` — dated changelog: `v{major}.{minor}.{patch} — {date} — {reason}`

**Campsite rule:** Add headers to files as you touch them. Update version history when modifying files. Headers may be outdated — they reliably tell at minimum what the file is for.

Full format: `docs/coding-guidelines/file-headers.md`

### Rule 3: OpenAPI Spec Must Stay In Sync

`openapi.yaml` is the canonical API contract. It MUST reflect the actual implementation:

1. **When adding a new route**, add it to `openapi.yaml` in the same PR/commit.
2. **When modifying a route** (params, response shape, auth), update the spec immediately.
3. **When removing a route**, remove it from the spec.
4. **Campsite rule applies**: if you notice an undocumented route while working nearby, document it.
5. **Generate types after spec changes**: `pnpm generate:types`

Full sync plan: `docs/plans/openapi-sync-plan.md`

### Rule 4: i18n Files Must Stay In Sync

Both `locales/en.json` and `locales/fi.json` must be updated together:

1. **Every new translation key** must be added to BOTH files simultaneously.
2. **Never add a key to one file without the other.** If unsure of the Finnish translation, use the English text as a placeholder with a `[TODO:fi]` prefix.
3. **Frontend locale files** (`public/locales/`) follow the same rule if they exist.
4. **Verify sync** by checking both files have the same key structure.

### Rule 5: Dependency Management

Before adding any new npm package:

1. **Check license compatibility** — MIT, Apache-2.0, ISC, BSD are acceptable. GPL/AGPL require user approval.
2. **Prefer small, focused libraries** with active maintenance and good security track records.
3. **Run `pnpm audit`** after adding dependencies. Fix any high/critical vulnerabilities.
4. **If audit finds problems**, investigate, research alternatives, and present options to the user.
5. **Never add packages without justification** — check if existing dependencies or Node.js built-ins can do the job.

Full guide: `docs/coding-guidelines/dependency-management.md`

### Rule 6: ESLint Must Pass

All code changes must pass linting:

```bash
cd aimeat
pnpm lint
```

Lint rules enforce code quality, style consistency, and prevent common errors. See `docs/coding-guidelines/code-style.md`.

### Rule 7: Frontend Styling Must Follow the Frontend Development Guide

All frontend work (HTML, CSS, JS views/components) **must** follow `docs/frontend-development-guide.md`. Before writing or modifying any frontend code, review the relevant sections. Key mandatory rules:

1. **No inline `style=""` attributes** for layout, colors, spacing, or typography — use CSS classes instead.
2. **No inline CSS constants** in JS files — all CSS goes in external `.css` files.
3. **Use CSS variables** from `theme.css` for all colors, spacing, and typography — never hardcode values like `#E8564A` or `#6B7280` directly in JS.
4. **Prefix all view CSS classes** to avoid collisions (e.g., `pf-` for profile, `gn-` for portal, `adm-` for admin).
5. **Use the canonical section header pattern** in profile tabs: `.section-title` + `.section-desc` — not raw `<h3>` or `<p>` with inline styles.
6. **Use existing button classes** (`.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-info`) — never set button colors via inline styles.
7. **Use existing component library** (`/components/`) and shared components (`views/profile/shared.js`, `views/admin/shared.js`) — don't reinvent.
8. **All user-visible text** must use `t()` i18n function — no hardcoded strings in any language.

**Campsite rule:** If you encounter inline styles while working on a file, move them to the appropriate CSS file.

Full guide: `docs/frontend-development-guide.md`
Style analysis: `docs/design/style-analysis.md`

---

## Coding Guidelines Reference

All development standards are collected in `docs/coding-guidelines/`:

| Guide | Purpose |
|-------|---------|
| [Testing Requirements](docs/coding-guidelines/testing-requirements.md) | E2E testing rules, multi-backend testing, writing tests |
| [File Headers](docs/coding-guidelines/file-headers.md) | Source file header format, version history |
| [Code Style](docs/coding-guidelines/code-style.md) | TypeScript/JS conventions, route patterns, i18n |
| [Architecture](docs/coding-guidelines/architecture.md) | System design, core vs extended, directory structure, storage layer |
| [Security](docs/coding-guidelines/security.md) | Auth, input validation, XSS, rate limiting, GDPR |
| [Getting Started](docs/coding-guidelines/getting-started.md) | Installation, setup, development workflow |
| [Dependency Management](docs/coding-guidelines/dependency-management.md) | Adding packages, license checks, security audits |
| [Environment Configs](docs/coding-guidelines/environment-configs.md) | Node type configs (full, personal, relay, mirror) |
| [Storage Sync](docs/coding-guidelines/storage-sync.md) | Multi-backend sync process, adding fields/tables |
| [Frontend Guide](docs/frontend-development-guide.md) | Preact + HTM SPA, admin dashboard conventions |

---

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

## Identity Model — GHII vs GAII

Three identity layers, two authentication paths:

| Layer | Format | Purpose |
|-------|--------|---------|
| **Owner** | `alice` | Account layer — manages agents, has roles (`owner`, `operator`) |
| **GHII** | `alice@node-id` | Human profile — display name, bio, avatar, password, TOTP |
| **GAII** | `agent#owner@node-id` | Agent identity — scoped permissions, morsel balance, trust score |

**Authentication rule:**
- **Human users** log in via GHII (password/TOTP) → get an **owner JWT** (`sub: username`, `roles: ['owner']`). Owner JWTs bypass all scope checks.
- **AI agents** connect via **device auth** (RFC 8628) → owner approves → agent gets **agent JWT** (`sub: gaii`, `roles: ['agent']`). Agent JWTs have scopes enforced.

**Agents are never created implicitly.** Registration/login creates only the owner + GHII profile. Agents connect later through device auth, where the owner explicitly approves each agent and selects its scopes.

Key files: `src/routes/ghii.ts` (human auth), `src/routes/agents.ts` (device auth), `src/auth/middleware.ts` (scope enforcement), `src/routes/libs.ts` (browser auth library)

## Key Commands

```bash
# All commands from aimeat/ directory
cd aimeat

# Dev server (auto-reload)
pnpm dev

# Type-check (no emit)
npx tsc --noEmit

# Run API integration tests (server must be running on :40251)
npx tsx test/api-full.ts

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
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';

// Owner-only endpoint (human users — scopes bypassed)
router.get('/v1/endpoint', requireAuth(), requireRole('owner'), async (req, res) => {
  const owner = req.auth!.sub;      // Owner name (e.g., "alice")
  const roles = req.auth!.roles;    // ['owner'] or ['owner', 'operator']
});

// Agent endpoint with scope enforcement
router.post('/v1/endpoint', requireAuth(), requireRole('agent'), requireScope('memory:write'), async (req, res) => {
  const gaii = req.auth!.sub;       // Agent GAII (e.g., "claude#alice@node")
  const owner = req.auth!.owner;    // Owner name
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

All data access goes through the `Storage` interface (`src/storage/interface.ts`). Two backend implementations:

- **SQLite** (better-sqlite3) — for memory mode (`:memory:`), dev, and personal nodes
- **MongoDB** (Prisma) — for production deployments

When adding new data types or fields, ALL backends must be updated. See `docs/coding-guidelines/storage-sync.md` for the complete checklist.

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

### ES Module Cache Busting (Importmap + BUILD_ID)

**Problem:** ES modules stay in the browser's module registry for the entire SPA session. HTTP `no-cache` + ETag is insufficient — once a module is loaded, the browser reuses it without re-fetching, even after a server restart deploys new code.

**Solution:** `portal.ts` generates a `BUILD_ID` (timestamp) on every server restart and stamps all importmap values with `?v=BUILD_ID`. The importmap in `spa.html` maps module paths to themselves (identity mapping), and `serveSpa()` rewrites the values with the version suffix using a generic regex.

**How it works:**
1. `spa.html` has an importmap with entries like `"/js/services/foo.js": "/js/services/foo.js"`
2. `portal.ts` `serveSpa()` rewrites ALL importmap values starting with `/` to append `?v=BUILD_ID`
3. Dynamic route imports use `+ window.__B` suffix (also injected by `serveSpa()`)
4. Result: every module gets a unique URL per server restart → fresh fetch guaranteed

**Rule: When adding a new shared JS module** (absolute import path like `/js/services/foo.js`, `/components/Bar.js`, `/lib/baz.js`):
1. Add an identity entry to the importmap in `public/spa.html`: `"/js/services/foo.js": "/js/services/foo.js"`
2. That's it — `portal.ts` stamps it automatically via generic regex. No manual `.replace()` needed.

**What does NOT need importmap entries:**
- Relative imports (`./profile/some-tab.js`) — resolved relative to parent module which is already cache-busted
- Bare specifiers already in the map (`preact`, `htm`) — already handled
- CSS files — stamped by a separate generic regex in `serveSpa()`

**Key files:**
- `public/spa.html` — importmap definition
- `src/routes/portal.ts` — `serveSpa()` with BUILD_ID stamping

### SSE Live Updates (Real-Time UI Refresh)

**Problem:** When data changes on the server (another user, an API call, a scheduled job), the UI must reflect it without manual page reload.

**Solution:** Singleton SSE (Server-Sent Events) connection with debounced `CustomEvent` broadcasting.

**How it works:**
1. `public/lib/live-updates.js` — singleton EventSource connection with reference counting
   - `connect(getJwt)` — opens SSE via `POST /v1/events/ticket` → `GET /v1/events?ticket=...`
   - `onUpdate(callback)` — registers listener (debounced 2s to batch rapid changes)
   - `disconnect()` — decrements refcount, closes when 0
2. `public/views/profile.js` — connects on mount, dispatches `aimeat-live-update` CustomEvent
3. Tab components listen for the event and re-fetch their data

**Rule: Every profile/admin tab that displays server data MUST listen for live updates:**
```javascript
useEffect(() => {
  const handler = () => { loadData(); };
  window.addEventListener('aimeat-live-update', handler);
  return () => window.removeEventListener('aimeat-live-update', handler);
}, []);
```

**Exceptions (no live updates needed):**
- Tabs showing only static/local data (e.g., access-tab with session keys)
- Tabs that are pure navigation (e.g., portfolio-tab redirect)
- Push notification preference tabs (user-initiated only)

**Currently listening (13 tabs):** agents, boards, chat-sessions, data-wallet, extensions, federation, knowledge, mcp, memory, node-stats, nodes, organisms, wallet.

**Key files:**
- `public/lib/live-updates.js` — SSE connection singleton
- `public/views/profile.js` — event dispatcher

## Testing

The API integration test file (`test/api-full.ts`) runs 35 tests across 6 phases + GDPR. Tests run against a live server on port 40251. The test creates its own owner/agents and cleans up via cascade delete at the end. There are 19 E2E test suites covering security, federation, concurrency, storage visibility, and more.

**Always run `npx tsc --noEmit` after changes** to verify the build compiles cleanly.

**After major changes, run `pnpm test:e2e:mongodb` and `pnpm test:e2e:sqlite`** — see Mandatory Rule 1 above.

Full testing guide: `docs/coding-guidelines/testing-requirements.md`

## Spec Documents

- `openapi.yaml` — The canonical API contract (MUST be kept in sync — see Mandatory Rule 3)
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
