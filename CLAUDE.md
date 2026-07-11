# CLAUDE.md — AI Assistant Instructions for AIMEAT

## MANDATORY RULES (HIGHEST PRIORITY)

These rules MUST be followed at all times. They override any conflicting default behavior. Each links to its full guide — read it before working in that area.

### Rule 1: E2E Tests Must Pass After Major Changes

**Valid backends: SQLite and MongoDB ONLY.** The in-memory backend (`pnpm test:e2e`, `pnpm test:e2e:memory`) is deprecated — do not use it for verification or report its failures.

1. **Run only the suites your change can plausibly affect**, not the whole sweep. Filter runner (must `cd aimeat` first — relative paths):
   ```bash
   cd aimeat
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding [--test=...]
   ```
   For CLI-only changes (`src/cli/`), server suites don't exercise CLI code — say so instead of running them to fill a report.
2. **End of a multi-step plan: full sweep on both persistent backends** (from root): `pnpm test:e2e:sqlite` then `pnpm test:e2e:mongodb`.
3. **Target: 0 failures in suites you ran.** Failure in an area you touched → not done, fix it. Failure in an unrelated suite → confirm it pre-exists on `main` (check `git status`/`git log -1`); mention but don't "fix" it. Ambiguous → ask.
4. **New features must include E2E tests** (happy path + at least one failure mode).
5. **Never claim work is done without running tests.** Evidence before assertions.

Full guide: `docs/coding-guidelines/testing-requirements.md`

### Rule 1b: Frontend Changes Verified by Driving the Browser via Playwright MCP

**Do NOT write or run the `.spec.ts` Playwright suite (`pnpm test:playwright:*`)** — it's unreliable. Instead drive a real browser through the **Playwright MCP server** (`.mcp.json`).

When a frontend change is **finished** (a view/component/feature is done, not mid-development): against the running dev server (`pnpm dev`, port 40050), navigate to the page, reach the authenticated state, perform the real interactions (click/type/submit), and confirm the expected result actually happens (elements appear, data persists, edits/deletes take effect) — not just that the page didn't crash. Screenshot as evidence when useful.

**Trigger:** any completed change to `public/views/`, `public/components/`, `public/js/`, `public/css/`, `public/locales/`, or `*.html`. **Report what you actually observed**; if you couldn't drive the browser (MCP unavailable, server down, no creds), say so rather than claiming it works.

### Rule 2: Source File Headers Required

Every source file (`.ts`, `.js`, `.css`) needs a header comment: `@file`, `@description`, plus recommended `@structure`, `@usage`, `@version-history` (`v{major}.{minor}.{patch} — {date} — {reason}`). **Campsite rule:** add/update headers on files you touch. Full format: `docs/coding-guidelines/file-headers.md`

### Rule 3: OpenAPI Spec Must Stay In Sync

`openapi.yaml` is the canonical API contract. Add/modify/remove routes there in the **same commit** as the code; campsite rule applies to undocumented routes you pass. Run `pnpm generate:types` after spec changes. Full plan: `docs/plans/openapi-sync-plan.md`

### Rule 4: i18n Files Must Stay In Sync

`locales/en.json` and `locales/fi.json` (and `public/locales/` if present) are updated **together** — never add a key to one without the other. If unsure of the Finnish, use the English text with a `[TODO:fi]` prefix. Verify both files share the same key structure.

### Rule 5: Dependency Management

Before adding any npm package: check license (MIT/Apache-2.0/ISC/BSD OK; GPL/AGPL need user approval), prefer small actively-maintained libs, run `pnpm audit` after and fix high/critical, and never add without justification (can an existing dep or Node built-in do it?). Full guide: `docs/coding-guidelines/dependency-management.md`

### Rule 6: Always Use Opus for Subagents

All Agent tool calls MUST use `model: "opus"` or omit the model param (inherits parent). NEVER `sonnet`/`haiku` — they don't follow complex format instructions reliably.

### Rule 7: ESLint Must Pass

All changes must pass `pnpm lint` (from root). See `docs/coding-guidelines/code-style.md`.

### Rule 8: Frontend Styling Follows the Frontend Development Guide

All frontend work must follow `docs/frontend-development-guide.md`. Key mandatory rules:
1. No inline `style=""` for layout/colors/spacing/typography — use CSS classes.
2. No inline CSS constants in JS — all CSS in external `.css` files.
3. Use CSS variables from `theme.css` for all colors/spacing/typography — never hardcode `#E8564A` etc. in JS.
4. Prefix view CSS classes (`pf-` profile, `gn-` portal, `adm-` admin).
5. Canonical section header pattern in profile tabs: `.section-title` + `.section-desc`.
6. Use existing button classes (`.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger`, `.btn-success`, `.btn-info`, `.btn-danger-solid`) — **never `class="btn btn-*"`** (no `.btn` base class), never inline button colors.
7. Use the existing component library (`/components/`) + shared components (`views/profile/shared.js`, `views/admin/shared.js`).
8. All user-visible text uses `t()` — no hardcoded strings.
9. No `rgba(255,255,255,...)` in CSS (dark-theme-only) — use `var(--card)`, `var(--border)`, `var(--bg-dim)`, `var(--surface)`.

**Campsite rule:** fix inline styles, `btn btn-*`, and `rgba(255,255,255)` in files you touch.

### Rule 9: Known Gaps Must Be Developer-Approved

`docs/known_gaps.md` tracks deferred gaps. **Never add entries on your own** — inform the developer, they decide. Every entry needs all fields (ID, Discovered, Related to, Description, Impact, Severity+justification, What needs doing, Why deferred, Revisit when). Remove entries when fixed (don't mark "done"). "Why deferred" must be a real reason, not "low priority."

### Rule 10: Security Is Part of the DNA

Every change to `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, federation, extensions, or an AI path MUST preserve the ten security invariants and use the per-change checklist in `docs/coding-guidelines/security-development-dna.md`. Non-negotiable core: (1) authorize against `resolveIdentity(req.auth!, …)`, never a client-supplied id; (2) never put server-trusted config/secrets in a principal-writable namespace; (3) all non-constant outbound HTTP goes through `safeFetch`; (4) every mutation has a `requireScope`/`requireRole` gate; (5) federation verifies an Ed25519 signature **unconditionally** from an approved peer. **Security is posture-driven config, not a code fork:** the same node runs wide-open on localhost and hardened on the public internet — anything whose safe value differs goes in `.env.example` with a safe *public* default and a documented local override (never hardcode permissive, never remove functionality). New identity-touching features ship with cross-owner and cross-scope "→403" E2E tests (Rule 1).

Full guide: `docs/coding-guidelines/security-development-dna.md`

### Rule 11: Design Specs & Roadmaps Live in AIMEAT, Not Repo Directories

Author **new design specs, plans, and roadmap items as documents/records in the relevant AIMEAT organism on aimeat.io** (appdev/AIMEAT MCP) — **not** in repo `docs/`. This is deliberate dogfooding: we run our own knowledge work on our own product, surface what works and what breaks, and keep the data in the service we own. Route to the organism where that product's roadmap is tracked (each MACHINE ROOM app → its own organism/FABRIC; the AIMEAT platform itself, incl. `app-catalog`, → the FABRIC roadmap hub). Publishing such a record is a **gate** — draft freely, publish only on the developer's explicit go-ahead in this session (dogfood rituals below; cf. Rule 9). **Canonical in the repo, unchanged:** `openapi.yaml`, the RFC sections + coding-guideline references under `docs/`, `CLAUDE.md`, and `docs/known_gaps.md`.

---

## Coding Guidelines Reference

All standards live in `docs/coding-guidelines/`:

| Guide | Purpose |
|-------|---------|
| [Testing Requirements](docs/coding-guidelines/testing-requirements.md) | E2E rules, multi-backend testing, writing tests |
| [File Headers](docs/coding-guidelines/file-headers.md) | Header format, version history |
| [Code Style](docs/coding-guidelines/code-style.md) | TS/JS conventions, route patterns, i18n |
| [Prompt Writing](docs/coding-guidelines/prompt-writing.md) | Positive framing (say what TO do) + prompt framework; applies to every prompt string |
| [Architecture](docs/coding-guidelines/architecture.md) | System design, storage layer, SSR-removal history |
| [Identity Model](docs/coding-guidelines/identity-model.md) | GHII/GAII full reference, aggregation pattern, morsel economy |
| [Security](docs/coding-guidelines/security.md) | Auth, validation, XSS, rate limiting, GDPR |
| [Security Development DNA](docs/coding-guidelines/security-development-dna.md) | **Rule 10** — trust model, 10 invariants, localhost-flexible/public-strict posture, per-change checklist |
| [Getting Started](docs/coding-guidelines/getting-started.md) | Install, setup, dev workflow |
| [Dependency Management](docs/coding-guidelines/dependency-management.md) | Adding packages, licenses, audits |
| [Environment Configs](docs/coding-guidelines/environment-configs.md) | Node type configs (full, personal, relay, mirror) |
| [Storage Sync](docs/coding-guidelines/storage-sync.md) | Multi-backend sync, adding fields/tables |
| [Memory Contracts](docs/coding-guidelines/memory-contracts.md) | Reactive self-describing memory records for automation/coordination — prefer extending the memory system over new tables/handlers |
| [Skills Registry](docs/skills-registry.md) | SKILL.md packs: scopes/refs/@semver pins, app-bound skills (metadata.binding), crewaimeat JSON crews + aimeat-agency consumption |
| [MCP Uploads](docs/coding-guidelines/mcp-uploads.md) | Presigned upload URLs |
| [Init Wizard](docs/coding-guidelines/init-wizard.md) | `aimeat init` maintenance checklist |
| [Frontend Guide](docs/frontend-development-guide.md) | Preact + HTM SPA, cache-busting, SSE, admin conventions |
| [App Developer AI Guide](docs/app-developer-ai-guide.md) | Apps using the user's OpenRouter key via `AIMEAT.ai.complete()` |
| [Building an AIMEAT-compatible Agent](docs/building-an-aimeat-compatible-agent.md) | Offer descriptor, pricing, workflow signals + setup prompt |
| [Building an AIMEAT-compatible Ecosystem App](docs/building-an-aimeat-compatible-ecosystem-app.md) | External apps (GEAI `eco:{app}#{owner}@{node}`), hello→approve→token flow |
| [Known Gaps](docs/known_gaps.md) | Deferred technical gaps |

---

## Project Overview

The **AIMEAT Protocol** (AI Memory Exchange and Action Transfer) — an open protocol for AI agent infrastructure. The repo contains:

1. **Protocol specification** (RFC) in `docs/` and `openapi.yaml`
2. **Reference implementation** in `aimeat/` — a Node.js/TypeScript server
3. **Python liaison + connector PyPI package** in `python/aimeat-crewai/` — `aimeat-crewai`, a pip-installable CrewAI integration. **Part of THIS project, not an external repo.** When agent-facing capabilities change (offers, workflow signals, onboarding, MCP surface), keep the Python side in sync. It has its own version line (tag-triggered PyPI release) independent of the Node version. Key modules: `liaison.py`, `mcp_client.py`, `daemon.py`, `offers.py` + `workflow_spec.py`, `cli.py`. Mirror the node contract (`aimeat/src/models/offer-schemas.ts`, `workflow-schemas.ts`); **the node schema wins on any mismatch.**

### Prompt-Driven Workflow

AIMEAT's core interaction pattern: the app generates ready-made prompts, the user copies them to their chosen AI chat, and brings results back; previous results feed subsequent prompts. It's (1) free — users use their own AI chats, (2) safe — users see everything before submitting, (3) AI-agnostic. **When adding to the generator pipeline, the work is in the prompt text** — not UI buttons or backend logic. The app composes prompts, shows them, accepts/validates responses, threads previous responses into later prompts.

## AIMEAT Development Organism (dogfood) — session rituals

AIMEAT's development is tracked in an **AIMEAT organism** on aimeat.io (id `fbb51de5-56d5-4143-9871-b998a1187655`) via the **appdev MCP** (`mcp__claude_ai_AIMEAT_APPDEV__*`) — source of truth for **coordination + working context** (and for new design specs / roadmaps — see **Rule 11**); the repo stays source of truth for **code + the canonical protocol contract** (`openapi.yaml`, RFC). Full design: `docs/internal/aimeat-dev-organism-plan.md`.

**These rituals apply ONLY when the appdev MCP is connected.** If not, skip silently.

Workspaces: **Development** (`ws-mq664uyfz21`), **Handbook** (`ws-mq6653ry24h`), **Protocol** (`ws-mq665ahqc6b`).

1. **Session start:** read the `context` doc **`main-context`** in Development + last few `decision`s + the activity feed delta. Don't ingest the whole organism.
2. **Planning a task:** read just-in-time — the area's Handbook page(s) + open `feature`/`bug` records + relevant `decision`/`invariant`.
3. **Finishing significant work:** update the `feature`/`bug`; log a `decision` or `known-gap` (both **gated** — publish held for human approval); update the `handbook` page + the sub-context `context` doc's current-state.
4. **Milestones (the gate):** a sub-context draft is the live current-state (edit freely); a **publish is a milestone** — perform it **ONLY after the developer's explicit go-ahead in this session**. Never auto-publish.
5. **Sync:** keep `docs/known_gaps.md` + the roadmap in two-way sync (`pnpm organism:sync`, once it exists).

Rule 9 still holds: never add a `known-gap` on your own.

### LOOM roadmap work (MACHINE ROOM WARP/FABRIC) — reference resolution

When creating/editing `room.target` records in the MACHINE ROOM workspace (org `e8617051-...`, ws `ws-mr48730nq0b`), LOOM's `resolveDocRef` resolves `born_from.docs` / event `refs` from ONLY three places: (1) the MACHINE ROOM **`room.design`** space (the YARN rule: design docs come only from there), (2) a librarian full-text search, (3) fallback: the dev organism's **Development** workspace (`ws-mq664uyfz21`). A doc anywhere else — DESIGN STUDIO (`ws-mr5mauol7vk`), `room.outbox`, any other workspace — renders as a red "ei saatavilla" chip.

**Rule: when a target is born from a DESIGN STUDIO session doc (SESSIO NNN), mirror that doc into `room.design` with the SAME doc id** (note the canonical location at the top of the mirror) before or when publishing the target. Same for any other referenced doc living outside the three resolvable places. FABRIC cards/releases follow the same ref rule. Also: `room.target_event` and `room.release` are **append-only** (a publish over an existing id is refused); `room.target` and `room.card` are updatable but require `expected_version`. Write proper Finnish (ä/ö) in every record field — the node is fully UTF-8; append-only namespaces make orthography mistakes permanent.

## Architecture

- **Runtime:** Node.js 24.x, ESM (`"type": "module"`)
- **Framework:** Express 5.2.1 — `req.params` returns `string | string[]`, cast with `as string`
- **Language:** TypeScript 5.9.3, strict, ES2022, NodeNext
- **Crypto:** @noble/ed25519 3.0, jose 6.1 (EdDSA JWTs)
- **Package manager:** pnpm · **Port:** 40050

## Identity Model — GHII vs GAII (CRITICAL)

Two distinct identity types. **Never confuse them.** Full reference (auth paths, aggregation pattern, morsel economy, ownership checks): `docs/coding-guidelines/identity-model.md`.

| Identity | Format | Example | What it is |
|----------|--------|---------|------------|
| **GHII** | `owner@node-id` | `alice@aimeat-fi-001-genesis` | Human user. Owns everything (morsel balance, profile, trust). |
| **GAII** | `agent#owner@node-id` | `claude#alice@aimeat-fi-001-genesis` | AI agent. Scoped permissions. Own trust score. |

A bare **Owner** name (`alice`) is the account layer — appears in `req.auth!.sub` for owner JWTs, `req.auth!.owner` for both.

**MANDATORY:** Every route that stores/retrieves data by identity MUST use `resolveIdentity(req.auth!, config.nodeId)` from `src/utils/gaii.ts`, **not** raw `req.auth!.sub`. Owner sessions → bare name becomes GHII (`alice` → `alice@node-id`); agent sessions → `sub` returned as-is (already full GAII). Without it, owner data is stored under the bare `alice` and becomes invisible to list/search/update. Compare ownership against `resolve(req)`, never `req.auth!.sub`.

**Morsels:** single balance on `GHIIRecord.morselBalance` (the human pays; `AgentRecord.morselBalance` is always 0). `debitBalance`/`creditBalance`/`transferBalance` resolve any GAII/GHII/bare-name → owner GHII internally.

**Agents are never created implicitly** — registration creates only the owner + GHII; agents connect later via device auth (RFC 8628) where the owner approves each and selects scopes.

Key files: `src/utils/gaii.ts`, `src/routes/ghii.ts`, `src/routes/agents.ts`, `src/auth/middleware.ts`, `src/routes/libs.ts`.

## Extension & Cortex Memory Architecture (CRITICAL)

Full guide: `docs/coding-guidelines/extension-memory-architecture.md`. Three namespaces — **never confuse them:**

| Namespace | Who writes | Who reads | Example |
|-----------|-----------|-----------|---------|
| **Owner** (`testuser@node-id`) | User via API (auth) | User (auth), extensions (`ctx.memory.getPublic(gaii, key)`) | `i18n.fi`, `settings.config` |
| **Extension** (`ext:{name}`) | Only the extension (`ctx.memory.set()`) | Anyone (public, no auth) | `ext:prh/watchlist.items` |

- **Extension** (WASM sandbox): owns `ext:{name}`; reads owner data via `ctx.memory.getPublic(ctx.caller.gaii, key)`; external APIs via `ctx.fetch()`.
- **Cortex** (browser IIFE): reads ext data via `AIMEAT.data.getPublic('ext:name', key)`; reads/writes user data via `AIMEAT.data.get/set()`; calls ext actions via `session.fetch('/v1/ext/name/actionId')`.
- **Translations and settings are USER data** — cortex reads them via `AIMEAT.data.get('service.i18n.fi')`, NEVER via `getPublic('ext:...')`.
- **App** (browser): calls cortex public methods ONLY — never `callExt`, `readExtMemory`, `/v1/ext/`, or `/v1/memory/ext:`.

**Trust principle:** the extension is sovereign (decides storage/format/return); cortex trusts the ext API; app trusts cortex. No layer bypasses the one below.

**Common mistakes:** (1) callExt path is `/v1/ext/name/action`, NOT `/v1/extensions/name/actions/action`. (2) `session.fetch` returns parsed JSON — use `resp.data`, don't call `resp.json()`. (3) Cortex register API: `{ libs: { "file.js": code } }`, NOT `{ lib: {...} }`. (4) Cortex re-activate: deactivate first, then activate. (5) Flat translation keys: generator produces `"tab.search": "Haku"` — `t()` must check flat key before nested path.

## MCP Presigned Upload (File Transfer)

MCP tools accepting file content (`aimeat_app_publish`, `aimeat_storage_upload`, `aimeat_extension_install`, `aimeat_cortex_install`) support presigned upload: omit content params → tool returns an `upload_url`; the agent PUTs the raw file (App/Storage) or a ZIP with `manifest.yaml` + `scripts/`/`libs/` (Extension/Cortex). Token is single-use, 60-min TTL, size-capped. Inline content still works (backward-compatible). Full guide: `docs/coding-guidelines/mcp-uploads.md`

## Key Commands

All commands from **project root** (root `package.json` proxies to `aimeat/`).

```bash
pnpm dev                 # Dev server (auto-reload), port 40050
pnpm typecheck           # tsc --noEmit (backend: src/, bin/, scripts/)
pnpm typecheck:frontend  # tsc --noEmit -p tsconfig.frontend.json (checkJs over public/)
pnpm check:importmap     # verify spa.html importmap ↔ absolute /js|/components|/views imports
pnpm lint                # eslint src/ public/
pnpm test:e2e:sqlite     # E2E, SQLite (fast iteration, default)
pnpm test:e2e:mongodb    # E2E, MongoDB (run before end-of-plan)
pnpm build && pnpm start
pnpm start -- --db sqlite --db-path ./data/aimeat.db
pnpm start -- --db mongodb --db-url mongodb://localhost:27017/aimeat
```

Single suite (preferred during iteration): `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding`. Memory-backend test commands are **deprecated** — don't use them.

**Pre-commit gate:** a committed hook (`.githooks/pre-commit`, activated by the root `prepare` script via `git config core.hooksPath .githooks`) blocks every commit unless `lint` + `typecheck` + `typecheck:frontend` + `check:importmap` pass. The same four run in CI (`.github/workflows/ci.yml`). E2E/Playwright are NOT in the hook (too slow / need a DB) — run those per Rule 1. Bypass only in a genuine emergency with `git commit --no-verify`.

## Code Conventions

**Response envelope** — every response uses `success()` / `error()` from `src/middleware/envelope.ts`:
```typescript
res.json(success(config.nodeId, { data: 'here' }, [{ description: 'Next', method: 'GET', url: '/v1/endpoint' }]));
res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
```

**Auth middleware** — `requireAuth()`, `requireRole('owner'|'agent')`, `requireScope('memory:write')` from `src/auth/middleware.js`. Owner endpoints: `req.auth!.sub` is the bare owner name, scopes bypassed. Agent endpoints: `req.auth!.sub` is the full GAII, `req.auth!.owner` the owner name.

**Route registration** — routers follow `export function myRouter(config, storage): Router { ... }`, mounted in `src/server.ts` via `app.use(myRouter(config, storage))`.

**Storage** — all access through the `Storage` interface (`src/storage/interface.ts`); two backends (SQLite better-sqlite3, MongoDB Prisma). New data types/fields must update ALL backends — see `docs/coding-guidelines/storage-sync.md`.

**Imports** — always use `.js` extensions (ESM): `import { foo } from '../services/foo.js';`

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
| `public/views/admin/` | Admin dashboard tabs (Preact + HTM); `shared.js` = shared components |
| `public/js/services/admin.js` | Admin API service layer |
| `public/css/views/admin.css` | Admin styles (adm-* prefix) |
| `test/` | E2E test suite |

## Frontend

Preact + HTM SPA, no build step. Full architecture, component library, admin conventions, **ES-module cache-busting (importmap + BUILD_ID)**, and **SSE live updates**: `docs/frontend-development-guide.md`.

Two rules from those mechanisms that bite often:
- **New shared JS module** (absolute path like `/js/services/foo.js`): add an identity entry to the importmap in `public/spa.html` (`"/js/services/foo.js": "/js/services/foo.js"`). `portal.ts` stamps `?v=BUILD_ID` automatically. Relative imports, bare specifiers, and CSS need no entry.
- **Every profile/admin tab showing server data** must re-fetch on the `aimeat-live-update` window event (except static-data, pure-nav, and push-pref tabs):
  ```javascript
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);
  ```

## Spec Documents

`openapi.yaml` (canonical API contract — keep in sync, Rule 3); `docs/aimeat-implementation-prompt.md`; `docs/01-core.md`…`docs/09-community.md` (RFC sections); `docs/a-endpoints.md` (endpoint reference); `docs/b-config.md` (config schema); `docs/c-platform-notes.md` (AI platform compat); `docs/AIMEAT-RFC-v3.0-full.md` + `docs/AIMEAT-IO-Implementation-Guide-v3.0.md` (v3.0).

## AI Agent Prompts — Where They Live

User-facing copy-pasteable connect instructions live in the frontend:

| Location | What it is |
|----------|-----------|
| `public/views/profile/agents-tab.js` → `buildAgentPrompt()` | "Connect a new agent" prompt (device-auth flow, RFC 8628) |
| `public/views/profile/agents-tab.js` → `PLATFORMS` | Platform-specific setup instructions |
| `aimeat/src/routes/bootstrap.ts` | Machine-readable getting-started guide at `GET /` (node discovery) |
| `aimeat/src/routes/prompts.ts` | Managed system prompts in DB, served at `/v1/prompts/:name` |

**Agent registration (current):** device authorization (RFC 8628) — agent calls `POST /v1/agents/device-authorize`, owner approves in the profile Agents tab, agent polls. The old connectivity-key flow was removed in v1.1.0.

## Backend Architecture Rule — NO Server-Side Rendering

**The AIMEAT backend is protocol-only.** Every route in `src/routes/` provides a generic, reusable API endpoint. The backend NEVER renders HTML, builds UI, or serves page templates.

**Why:** AIMEAT's architecture is **CSM defines data shape + rules → generic APIs handle storage/consent/validation → clients (AI chats, SPAs, apps) render UI.** Any service (hobby directory, marketplace, dating, news) is just a client reading a CSM definition and talking to generic APIs.

**Rules:** (1) No SSR — never `res.send('<html>...')` or build HTML in handlers; UIs are client-side SPAs or static files. (2) Every new route must be generic — "would a second, different service use this?" If no, it doesn't belong. (3) No per-service backend files (`portal-hobbies.ts` etc.). (4) Admin dashboard is the ONE exception (operator tooling; migrating to SPA). (5) If data is already available via an existing API, don't wrap it.

**Core generic APIs (the only backend you need):** Memory, Schema Locking, Consent, Directory/Catalogue, Flags, Auth/GHII, Stats, Boards, Organisms, Wallet, CSM/MSM.

SSR-removal history (6 files / ~9,000 lines removed 2026-03-03, static-HTML URL routing, Phase 1 gap closure): `docs/coding-guidelines/architecture.md`.

## Common Pitfalls

The catalogue of traps we've hit — organised by the KIND of problem (build/bundling, routing, frontend↔backend drift, identity/auth, storage, i18n, extensions/cortex, AI calls, crypto, organisms, deploy, concurrency, Windows tooling) — lives in **[`docs/pitfalls.md`](docs/pitfalls.md)**. Read it when something breaks in a way that feels like it "should work"; add an entry when a bug turns out to be a *repeatable* trap, not a one-off.

### Generator pipeline notes

When modifying generator prompt templates (`public/js/services/generator-prompts-*.js`): verify every API claim against `src/routes/lib-*.ts` + `public/cortex-bundled/*.js`; extension data → `getPublic('ext:name', key)`; user data (translations/settings) → `AIMEAT.data.get(key)` (NEVER tell cortex to read translations from `ext:`); extension actions must `export default async function(ctx, input) { ... }`.

Known Phase 4/5 bugs to fix before enabling component/app-domain cortex or app phases are documented in `docs/superpowers/plans/2026-04-02-phase3-cortex-checklist.md` (wrong test prompt for non-data cortex; app not tested).

## Naming Convention — AIMEAT Only

**Never use `MEAT` as a standalone prefix.** Types `AimeatConfig`/`AimeatResponse`, env vars `AIMEAT_*`, default node id `aimeat-local-001-dev`. Rename any remaining `Meat`-prefixed identifiers to `Aimeat`.

## Init Wizard (`aimeat init`)

Lives in `src/cli/init-wizard.ts` (`@clack/prompts`). Adding a config option touches several layers (config.ts, both locale files, the wizard prompt + `CONFIG_DEFAULTS`, `.env.example`, `env-config.ts`, `env-validator.ts`) — full checklist: `docs/coding-guidelines/init-wizard.md`.
