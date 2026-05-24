# CLAUDE.md — AI Assistant Instructions for AIMEAT


Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

## MANDATORY RULES (HIGHEST PRIORITY)

These rules MUST be followed at all times during development. They override any conflicting default behavior.

### Rule 1: E2E Tests Must Pass After Major Changes

When any major feature, bugfix, or structural change is completed:

1. **Run E2E tests on both persistent backends** (from project root):
   ```bash
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

1. **Run Playwright browser tests** (from project root):
   ```bash
   # All Playwright tests (starts server automatically):
   pnpm test:playwright:mongodb

   # Single test file:
   pnpm test:playwright:mongodb -- profile-agents

   # Single test by name:
   pnpm test:playwright:mongodb -- --grep "shows agent cards"

   # Headed mode (see the browser):
   pnpm test:playwright:mongodb -- --headed

   # Other backends:
   pnpm test:playwright           # memory (fastest)
   pnpm test:playwright:sqlite
   pnpm test:playwright:mongodb   # most realistic
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

### Rule 6: Always Use Opus 4.6 for Subagents

All Agent tool calls MUST use `model: "opus"` or omit the model parameter (which inherits the parent model). NEVER set `model: "sonnet"` or `model: "haiku"` for any subagent. The quality difference matters — Sonnet does not follow complex format instructions reliably.

### Rule 7: ESLint Must Pass

All code changes must pass linting (from project root):

```bash
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
6. **Use existing button classes** (`.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-info`, `.btn-danger-solid`) — never set button colors via inline styles. **Never use `class="btn btn-*"`** — the design guide classes are self-contained, there is no `.btn` base class.
7. **Use existing component library** (`/components/`) and shared components (`views/profile/shared.js`, `views/admin/shared.js`) — don't reinvent.
8. **All user-visible text** must use `t()` i18n function — no hardcoded strings in any language.
9. **No `rgba(255,255,255,...)` in CSS** — these are dark-theme-only values. Use CSS variables: `var(--card)`, `var(--border)`, `var(--bg-dim)`, `var(--surface)`.

**Campsite rule:** If you encounter inline styles, `btn btn-*` classes, or `rgba(255,255,255)` values while working on a file, fix them.

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
| [MCP Uploads](docs/coding-guidelines/mcp-uploads.md) | Presigned upload URLs, adding upload-capable tools |
| [Frontend Guide](docs/frontend-development-guide.md) | Preact + HTM SPA, admin dashboard conventions |
| [Known Gaps](docs/known_gaps.md) | Deferred technical gaps with structured tracking |

### Rule 8: Known Gaps Must Be Developer-Approved

`docs/known_gaps.md` tracks deferred technical gaps. Rules:

1. **Never add entries on your own.** If you discover a gap during development, inform the developer. They decide whether to add it or fix it now.
2. **Every entry requires all fields:** ID, Discovered date, Related to, Description, Impact, Severity (with justification), What needs to be done, Why deferred, Revisit when. No partial entries.
3. **Remove entries when fixed.** If a gap is resolved, delete it from the file. Do not mark it as "done" -- just remove it.
4. **The "Why deferred" field must have a real reason** from the developer -- not "will do later" or "low priority."

---

## Project Overview

This is the **AIMEAT Protocol** (AI Memory Exchange and Action Transfer) — an open protocol for AI agent infrastructure. The repo contains:

1. **Protocol specification** (RFC v1.2) in `docs/` and `openapi.yaml`
2. **Reference implementation** in `aimeat/` — a Node.js/TypeScript server

### Prompt-Driven Workflow

AIMEAT uses a **prompt-driven workflow** (promptipohjainen työnkulku) as its core interaction pattern. The application generates ready-made prompts, the user copies them to their chosen AI chat, and brings the results back. Previous results feed into subsequent prompts.

This pattern is used because it is (1) **free** — users use their own AI chats, (2) **safe** — users see everything AI produces before submitting it to the system, and (3) **AI-agnostic** — any AI works (Claude, ChatGPT, Gemini, etc.).

**When adding features to the generator pipeline**, the work happens in the prompt text — not in UI buttons or backend logic. The app's job is to compose prompts, show them for copying, accept and validate responses, and thread relevant parts of previous responses into subsequent prompts.

## Architecture

- **Runtime:** Node.js 24.x, ESM (`"type": "module"`)
- **Framework:** Express 5.2.1 — note: `req.params` returns `string | string[]`, cast with `as string`
- **Language:** TypeScript 5.9.3, strict mode, ES2022 target, NodeNext module resolution
- **Crypto:** @noble/ed25519 3.0 for key generation/signing, jose 6.1 for EdDSA JWTs
- **Package manager:** pnpm
- **Port:** 40050

## Identity Model — GHII vs GAII (CRITICAL)

Two distinct identity types. **Never confuse them.**

| Identity | Format | Example | What it is |
|----------|--------|---------|------------|
| **GHII** | `owner@node-id` | `alice@aimeat-fi-001-genesis` | Human user. Owns everything. Has morsel balance, profile, trust score. |
| **GAII** | `agent#owner@node-id` | `claude#alice@aimeat-fi-001-genesis` | AI agent. Scoped permissions. Has its own morsel balance and trust score. |

There is also a bare **Owner** name (`alice`) which is the account layer. It appears in `req.auth!.sub` for owner JWTs and `req.auth!.owner` for both.

### Authentication Paths

| Path | JWT `sub` | JWT `roles` | Scopes |
|------|-----------|-------------|--------|
| **GHII login** (password/TOTP) | `alice` (bare owner name) | `['owner']` or `['owner','operator']` | Bypassed — owners can do anything |
| **Agent device auth** (RFC 8628) | `claude#alice@node-id` (full GAII) | `['agent']` | Enforced per agent's scope list |

### Identity Resolution in Routes — `resolveIdentity()`

**MANDATORY:** Every route that stores or retrieves data by identity MUST use `resolveIdentity()` from `src/utils/gaii.ts`, not raw `req.auth!.sub`.

```typescript
import { resolveIdentity } from '../utils/gaii.js';

// Inside router function:
const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

// In route handler:
const gaii = resolve(req);  // Returns GHII for owners, GAII for agents
```

**What it does:**
- Owner session (`roles: ['owner']`, no `'agent'`) → converts bare username to GHII: `alice` → `alice@node-id`
- Agent session (`roles: ['agent']`) → returns `req.auth!.sub` as-is (already full GAII)

**Why this matters:** Owner JWT `sub` is a bare username (`alice`), not a valid storage identity. Without `resolveIdentity()`, data gets stored under `alice` instead of `alice@node-id`, making it invisible to list/search/update operations.

### Owner Sessions — Aggregation Pattern

For **list** endpoints where the owner should see all their data (GHII + all agents):

```typescript
const isOwnerSession = req.auth!.roles.includes('owner') && !req.auth!.roles.includes('agent');
if (isOwnerSession) {
  const ownerGhii = `${req.auth!.owner}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(req.auth!.owner);
  // ALWAYS include GHII's own data first
  results.push(...await storage.listMemory(ownerGhii));
  for (const agent of agents) {
    results.push(...await storage.listMemory(agent.gaii));
  }
}
```

For **single-key** operations (GET/PUT/DELETE by key), `resolveIdentity()` handles it — the owner's data is stored under GHII.

### Morsel Economy — Single Balance (GHII)

All morsels belong to the owner (GHII), not individual agents. Agents are tools — the human pays.

- **Balance location:** `GHIIRecord.morselBalance` — the only balance in the system
- **Agent balance field:** `AgentRecord.morselBalance` exists in schema for backward compat but is always 0. Never write to it.
- **Balance operations:** `storage.debitBalance(gaii, amount)` internally resolves any GAII/GHII/bare-name → owner → GHII record. Routes don't need dual-path logic.
- **`storage.creditBalance()`**, **`creditBalanceCapped()`**, **`transferBalance()`** — same internal resolution.
- **Transactions:** Keyed to GHII identity (`owner@nodeId`)
- **Wallet API:** Returns single GHII balance, no aggregation needed
- **Per-agent spending limits:** Optional `AgentRecord.dailySpendLimit` (not yet enforced, field ready)
- **Welcome bonus:** Granted to GHII during owner registration (`ghii.ts`), NOT during agent creation

### Ownership Checks

When comparing stored `ownerGaii` against the current user:
```typescript
// CORRECT — compare against resolved identity
if (record.ownerGaii !== resolve(req)) { ... }

// WRONG — bare username won't match stored GHII/GAII
if (record.ownerGaii !== req.auth!.sub) { ... }
```

### Key Files

| File | Purpose |
|------|---------|
| `src/utils/gaii.ts` | `resolveIdentity()`, GAII parsing/validation |
| `src/routes/ghii.ts` | Human auth (password/TOTP login) |
| `src/routes/agents.ts` | Agent device auth (RFC 8628) |
| `src/auth/middleware.ts` | Role hierarchy, scope enforcement |
| `src/routes/libs.ts` | Browser auth library |

**Agents are never created implicitly.** Registration/login creates only the owner + GHII profile. Agents connect later through device auth, where the owner explicitly approves each agent and selects its scopes.

## Extension & Cortex Memory Architecture (CRITICAL)

Full guide: `docs/coding-guidelines/extension-memory-architecture.md`

Three namespaces exist. **Never confuse them.**

| Namespace | Who writes | Who reads | Example |
|-----------|-----------|-----------|---------|
| **Owner** (`testuser@node-id`) | User via API (auth) | User (auth), extensions (`ctx.memory.getPublic(gaii, key)`) | `i18n.fi`, `settings.config` |
| **Extension** (`ext:{name}`) | Only the extension (`ctx.memory.set()`) | Anyone (public, no auth) | `ext:prh/watchlist.items` |

### Layer access rules

- **Extension** (WASM sandbox): owns `ext:{name}`. Reads owner data via `ctx.memory.getPublic(ctx.caller.gaii, key)`. Fetches external APIs via `ctx.fetch()`.
- **Cortex** (browser IIFE): reads ext data via `AIMEAT.data.getPublic('ext:name', key)`. Reads/writes user data via `AIMEAT.data.get/set()`. Calls extension actions via `session.fetch('/v1/ext/name/actionId')`.
- **CRITICAL: Translations and settings are USER data** — cortex reads them via `AIMEAT.data.get('service.i18n.fi')`, NEVER via `getPublic('ext:...')`. The extension init action does NOT need to copy them.
- **App** (browser): calls cortex public methods ONLY. NEVER calls `callExt`, `readExtMemory`, `/v1/ext/`, or `/v1/memory/ext:` directly.

### Trust principle

The extension is sovereign — it decides what to store, in what format, and what to return. Cortex trusts the extension's API contract. App trusts cortex. No layer bypasses the one below it.

### Common mistakes (prevent these)

1. **Wrong callExt path**: `/v1/ext/name/action` (correct), NOT `/v1/extensions/name/actions/action`
2. **session.fetch returns parsed JSON**: use `resp.data` directly, do NOT call `resp.json()`
3. **Cortex register API**: `{ libs: { "file.js": code } }`, NOT `{ lib: { filename, code } }`
4. **Cortex re-activate**: must deactivate first, then activate (idempotent skip if already active)
5. **Flat translation keys**: generator produces `"tab.search": "Haku"` — `t()` must check flat key before nested path

## MCP Presigned Upload (File Transfer)

MCP tools that accept file content (`aimeat_app_publish`, `aimeat_storage_upload`,
`aimeat_extension_install`, `aimeat_cortex_install`) support a presigned upload mode.
When content parameters are omitted, the tool returns an `upload_url`. The agent PUTs
the raw file to that URL -- the file goes directly from disk to server without passing
through the AI context window.

- **App/Storage:** PUT the raw file (HTML, binary, etc.)
- **Extension/Cortex:** PUT a ZIP containing `manifest.yaml` + `scripts/` or `libs/`
- **Token:** Single-use, 60 min TTL, size-capped
- **Inline fallback:** Providing content inline still works (backward-compatible)

Full guide: `docs/coding-guidelines/mcp-uploads.md`

## Key Commands

```bash
# All commands from PROJECT ROOT (not aimeat/ subfolder)
# Root package.json proxies all scripts to aimeat/

# Dev server (auto-reload)
pnpm dev

# Type-check (no emit)
pnpm typecheck           # or: npx tsc --noEmit

# Lint
pnpm lint

# ── E2E API tests (starts server automatically) ──
pnpm test:e2e            # memory backend (fastest)
pnpm test:e2e:sqlite     # SQLite backend
pnpm test:e2e:mongodb    # MongoDB backend (most realistic)

# ── Playwright browser tests (starts server automatically) ──
pnpm test:playwright              # memory backend (fastest)
pnpm test:playwright:mongodb      # MongoDB backend (most realistic)

# Single test file:
pnpm test:playwright -- profile-agents

# Single test by name:
pnpm test:playwright -- --grep "shows agent cards"

# Headed mode (see the browser):
pnpm test:playwright -- --headed

# ── Build & start ──
pnpm build
pnpm start
pnpm start -- --db mongodb --db-url mongodb://localhost:27017/aimeat
pnpm start -- --db sqlite --db-path ./data/aimeat.db
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
- `docs/AIMEAT-RFC-v3.0-full.md` — Full protocol specification v3.0
- `docs/AIMEAT-IO-Implementation-Guide-v3.0.md` — Reference implementation guide v3.0

## AI Agent Prompts — Where They Live

User-facing prompt texts (the copy-pasteable instructions shown to users for connecting AI agents) live in the frontend:

| Location | What it is |
|----------|-----------|
| `public/views/profile/agents-tab.js` → `buildAgentPrompt()` | "Connect a new agent" prompt shown in the profile Agents tab — uses device-auth flow (RFC 8628) |
| `public/views/profile/agents-tab.js` → `PLATFORMS` object | Platform-specific setup instructions (Windows/Mac/Linux, OpenClaw, Claude, etc.) |
| `aimeat/src/routes/bootstrap.ts` | Machine-readable getting-started guide returned at `GET /` — used by AI agents discovering the node |
| `aimeat/src/routes/prompts.ts` | Managed system prompts stored in DB, served at `/v1/prompts/:name` (tier1, tier2, etc.) |

**Agent registration flow (current):** Device authorization (RFC 8628) — agent calls `POST /v1/agents/device-authorize`, owner approves in the profile Agents tab, agent polls for approval. The old connectivity key flow was removed in v1.1.0.

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
- **BUILD_ID cache busting:** Public JS changes require `pnpm dev` restart — browser caches modules by BUILD_ID
- **`buildComponentPrompt()` is async** — all call sites must `await` it (generator-detail.js, use-autopilot.js, use-test-execution.js)
- **Platform UI APIs:** Tabs uses `onChange` (not `onSelect`), DataTable has no `onRowClick`, Input/Select return `{el, getValue()}` objects

### Generator Prompt Template Rules

When modifying generator prompt templates (`public/js/services/generator-prompts-*.js`):
1. **Verify every API claim** against actual source code in `src/routes/lib-*.ts` and `public/cortex-bundled/*.js`
2. **Extension data** (watchlist, cache, changes) → `getPublic('ext:name', key)` — correct
3. **User data** (translations, settings) → `AIMEAT.data.get(key)` — correct
4. **NEVER tell cortex to read translations from ext: namespace** — they live in owner namespace
5. **Extension actions must use** `export default async function(ctx, input) { ... }` — the sandbox requires ES module default export

### Generator Pipeline — Known Phase 4/5 Bugs

Before enabling component cortex, app-domain cortex, or app phases, fix these bugs documented in `docs/superpowers/plans/2026-04-02-phase3-cortex-checklist.md`:
- **Component/app-domain cortex test uses wrong prompt** — `generator-autopilot.ts` line ~618 checks `wrapsExtension` (only data cortex has it), so component and app-domain cortexes fall through to the extension test prompt (server-side, wrong environment). Fix: check `compType === 'cortex'` instead.
- **App not tested** — `generator-autopilot.ts` line ~609 only tests extension and cortex, app is skipped entirely. Fix: add `'app'` to the test gate.

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
