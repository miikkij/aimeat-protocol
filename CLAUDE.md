# CLAUDE.md — AI Assistant Instructions for AIMEAT

## MANDATORY RULES (HIGHEST PRIORITY)

These rules MUST be followed at all times. They override any conflicting default behavior. Each links to its full guide — read it before working in that area.

### Rule 1: E2E Tests Must Pass After Major Changes

**The two supported backends (post Phase 5 — the Postgres+Kysely cutover; prod runs Kysely):**
- **PostgreSQL + Kysely** — `postgres-kysely` (`.env.test.postgres-kysely`, `src/storage/providers/postgres-kysely/`, SQL migrations run on boot). **THE primary production backend. It MUST always pass** — every change verifies here.
- **SQLite** — better-sqlite3 (`.env.test.sqlite`, `src/storage/providers/sqlite/`). **Important**: the fast local-iteration backend and a first-class supported target. **It MUST always pass.**

**MongoDB and the legacy Prisma-based `postgres` provider were REMOVED on 2026-07-16** (providers, `prisma/` schemas, the prisma/@prisma/client dependencies, their test scripts and env examples). There is no Prisma anywhere in the codebase. Do not re-add Prisma or reference `schema.prisma`; the removed code lives in git history if ever needed.

The in-memory backend (`pnpm test:e2e`, `pnpm test:e2e:memory`) is deprecated — do not use it for verification or report its failures.

1. **Run only the suites your change can plausibly affect**, not the whole sweep. Filter runner (must `cd aimeat` first — relative paths):
   ```bash
   cd aimeat
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding [--test=...]
   ```
   For CLI-only changes (`src/cli/`), server suites don't exercise CLI code — say so instead of running them to fill a report.
2. **End of a multi-step plan: full sweep on both backends** — **PostgreSQL+Kysely and SQLite, both must be green**: `pnpm test:e2e:postgres-kysely` and `pnpm test:e2e:sqlite` (both proxied from root; the Kysely suite wants a fresh schema — recreate the `postgres-kysely` test DB before a full run, e.g. `pnpm db:reset`). `pnpm test:e2e:all-backends` runs both in one go.
3. **Target: 0 failures in suites you ran.** Failure in an area you touched → not done, fix it. Failure in an unrelated suite → confirm it pre-exists on `main` (check `git status`/`git log -1`); mention but don't "fix" it. Ambiguous → ask.
4. **New features must include E2E tests** (happy path + at least one failure mode).
5. **Never claim work is done without running tests.** Evidence before assertions.

Full guide: `docs/coding-guidelines/testing-requirements.md`

### Rule 1b: Frontend Changes Verified by Driving the Browser via Playwright MCP

**Do NOT write or run the `.spec.ts` Playwright suite (`pnpm test:playwright:*`)** — it's unreliable. Instead drive a real browser through the **Playwright MCP server** (`.mcp.json`).

When a frontend change is **finished** (a view/component/feature is done, not mid-development): against the running dev server (`pnpm dev`, port 40050), navigate to the page, reach the authenticated state, perform the real interactions (click/type/submit), and confirm the expected result actually happens (elements appear, data persists, edits/deletes take effect) — not just that the page didn't crash. Screenshot as evidence when useful.

**Trigger:** any completed change to `public/views/`, `public/components/`, `public/js/`, `public/css/`, `public/locales/`, or `*.html`, **or a published single-file AIMEAT app** (`aimeat_app_publish`). **Report what you actually observed**; if you couldn't drive the browser (MCP unavailable, server down, no creds), say so rather than claiming it works.

**Measure, don't glance — mandatory when the surface has a dialog/overlay or reads live data.** A clean console, compiling JS and one screenshot at one size are proxies, and proxies generalise badly: an overlay verified only at 390px shipped rendering below the footer on desktop, and an app reported as "0 console errors" was repainting its open dialog every second. Run all three and report the numbers:

1. **Three viewports, every interactive surface:** 390x844, 1280x900 and **1280x460**. The short viewport is the one that catches centring/overlay bugs (clipped top, unscrollable, rendered below the page). At each: `scrollWidth - clientWidth === 0`, dialog top edge >= 0, close control reachable.
2. **Live channel connected, dialog open, count repaints:** `MutationObserver` on the open panel's content node, 20s while other activity happens on the account. **Expected zero.** Above zero = a live event is repainting what the user is reading.
3. **Network log after 60 idle seconds:** a repeating full listing is a bug even when nothing visibly breaks — it's an unintended poll.

Then verify the **feature**, not the render: perform the real interaction and confirm the result appears and persists. "It didn't crash" is not a pass. Same gate is served to app builders in `build-app-prompt.ts` ("Before you call it done").

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

### Rule 11b: ODPS Provider Identity Is Known — Fill It In

When an EXCHANGE listing's ODPS descriptor asks for the provider's legal identity or jurisdiction and the
creator is **Jouni / `happydude500001`**, these are the values — use them, do not leave the fields blank
and do not ask:

```json
"dataHolder": { "legalName": "Overscale Solutions Oy", "businessID": "3323553-5",
                "URL": "https://www.overscalesolutions.com",
                "addressCountry": "FI", "addressLocality": "Espoo" },
"license":    { "geographicalArea": ["Worldwide"], "applicableLaws": "Finnish law" }
```

Same block as the PRH app-tools already use. With it a listing validates at 100% completeness; without it
the validator reports `dataHolder` + `applicableLaws` missing. Everything else in the descriptor
(valueProposition, SLA, dataQuality, provenance) is still stated from what you actually KNOW about the
capability — invent nothing there.

### Rule 12: Imagery Is Generated, Never Placeholder Junk

**No bland stock/clip-art/placeholder images — ever.** When a task needs an image (an app icon, a banner, a hero graphic, an illustration, an og-image), **generate a proper AIMEAT-quality one** with `scripts/gen_image.py` instead of shipping something generic.

```bash
python scripts/gen_image.py --out icons/agent-badge "a glowing AI agent badge, coral-red accent"
python scripts/gen_image.py --out banners/hero --size 1344x576 "wide hero banner for the CADENCE CRM app"
python scripts/gen_image.py --out app/logo --upload "the DROP app logo, minimal geometric mark"   # → public URL for in-app use
```

- Config is `scripts/.env` (copy `scripts/.env.example`): `OPENROUTER_API_KEY` + `IMAGE_MODEL`. The capability activates **only** when that key is set — if it isn't, tell the developer rather than falling back to a placeholder.
- Output lands in `genimages/<subfolder>/` (gitignored). Pick the subfolder by where it's headed. Then **either copy the chosen file into the project** (e.g. `public/`, an app bundle, `aimeat-desktop/.../icons`) **or `--upload`** it to AIMEAT storage for apps to reference by URL.
- Every `--upload` is logged to `genimages/uploads.json` (URL, storage key, account GHII, model, prompt) — **read it** before re-generating, so we reuse an already-uploaded image instead of paying for it twice.
- The house style (coral-red `#E8564A` + slate/near-black, premium/geometric) is applied automatically; pass `--no-style` only when a specific look demands it.

### Rule 13: Research First When Creating an AIMEAT Application

When creating an application to AIMEAT: **You have `aimeat_*` MCP tools — follow the research-first flow: load the skill `node:aimeat-app-builder` and call `aimeat_appdev_overview` first.**

This is a hard precondition of the build, not an optional preamble, and it comes **before** reading repo source: existing published apps and the KB show which libs/patterns are already proven, so reuse beats re-deriving from lib sources. Full non-negotiables (theme vars, `<meta name="aimeat-scopes">`, `/v1/libs/` vs `/lib/`, reuse over duplicate): see **App-building prompt system** below.

### Rule 14: When the Work Is Done, Ask About the Change Log

`aimeat/public/changelog.json` is what the landing page shows visitors under "What's new on this node" — newest entry first, `{ date, kind: feature|fix|security|notice, title, body }`, where title/body is a string or `{ en, fi }`. **When a piece of work is finished, ask the developer whether to add an entry** and propose the wording; they decide. Never add one on your own, and never for internal refactors a visitor would not notice.

Write what a person gets, not what the code does. `pnpm check:changelog` (in the pre-commit gate) rejects a malformed file or a list that is not newest-first — a broken file makes the section vanish silently. **Scope: the changelog advertises PLATFORM-level work only** (node, SDKs, platform capabilities) — an individual application's features belong in that app's own description/gallery, so don't propose entries for them.

### Rule 15: Checkpoint Acceptance Needs an Explicit Pass-Criterion

Before accepting any checkpoint result (a screenshot, an import, a computed layout, a migration), **name the requirement you are checking against and a measurable pass-criterion derived from it** — then verify against that, not against overall impression. "Looks right" is not acceptance: alignment is proven with an asymmetric anchor element, size with a known reference dimension, behavior with the real interaction (Rules 1/1b give the test- and browser-specific forms of this).

1. **Result doesn't match the criterion → keep iterating.** Shipping "almost right" moves verification onto the developer's phone and costs a full feedback round per slip.
2. **Can't state a pass-criterion → the requirement is unclear.** Resolve it from the source material or ask the developer BEFORE the next iteration — iterating blind on a guessed target produces confident wrong "fixes" (careless acceptance once shrank a correctly-sized part because the reference dimension was never established).
2b. **The developer gave a source → OPEN IT before implementing.** A URL, file or spec in the request IS the requirement; fetch and read it first, and implement what it says — never substitute your own interpretation of its title or summary. (A linked grass tutorial was once "implemented" without opening the link; the result resembled the headline, not the technique, and the whole round was wasted.)
3. A verdict established under weak evidence stays suspect: re-verify it with a proper anchor before building on it.

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

AIMEAT's core interaction pattern: the app generates ready-made prompts, the user copies them to their chosen AI chat, and brings results back; previous results feed subsequent prompts. It's (1) free — users use their own AI chats, (2) safe — users see everything before submitting, (3) AI-agnostic. **When adding to a prompt-generation flow, the work is in the prompt text** — not UI buttons or backend logic. The app composes prompts, shows them, accepts/validates responses, threads previous responses into later prompts.

## AIMEAT Development Organism (dogfood) — session rituals

AIMEAT's development is tracked in an **AIMEAT organism** on aimeat.io (id `fbb51de5-56d5-4143-9871-b998a1187655`) via the **appdev MCP** (`mcp__claude_ai_AIMEAT_Appdev__*`) — source of truth for **coordination + working context** (and for new design specs / roadmaps — see **Rule 11**); the repo stays source of truth for **code + the canonical protocol contract** (`openapi.yaml`, RFC). Full design: `docs/internal/aimeat-dev-organism-plan.md`.

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
- **Language:** TypeScript 6.0.x, strict, ES2022, NodeNext
- **Crypto:** @noble/ed25519 3.1, jose 6.2 (EdDSA JWTs)
- **Package manager:** pnpm · **Port:** 40050

## Identity Model — GHII / GAII / GEAI (CRITICAL)

**Three** distinct principal types. **Never confuse them.** Full reference (auth paths, aggregation pattern, morsel economy, ownership checks): `docs/coding-guidelines/identity-model.md`. GEAI ecosystem-app reference: `docs/building-an-aimeat-compatible-ecosystem-app.md`.

| Identity | Format | Example | What it is |
|----------|--------|---------|------------|
| **GHII** | `owner@node-id` | `alice@aimeat-fi-001-genesis` | Human user. Owns everything (morsel balance, profile, trust). |
| **GAII** | `agent#owner@node-id` | `claude#alice@aimeat-fi-001-genesis` | AI agent. Scoped permissions. Own trust score. |
| **GEAI** | `eco:{app}#owner@node-id` | `eco:drum-news#alice@aimeat-fi-001-genesis` | Ecosystem app. Its own domain where external applications are systematically (AI-accelerated) connected to AIMEAT. Onboarded via hello→approve→token (device-auth clone) with TOFU key pinning + a scope + data-area allowlist; writes into its own `eco:` namespace; **consented like an agent** (same revocable, attributable guarantees). |

A bare **Owner** name (`alice`) is the account layer — appears in `req.auth!.sub` for owner JWTs, `req.auth!.owner` for all principals. (Internal *hosted* apps are also identity-bearing, via scoped app grants that resolve `role:'app'` to the owner but fence to approved scopes — see `docs/coding-guidelines/security-development-dna.md` + H-2 app-origin isolation.)

**MANDATORY:** Every route that stores/retrieves data by identity MUST use `resolveIdentity(req.auth!, config.nodeId)` from `src/utils/gaii.ts`, **not** raw `req.auth!.sub`. Owner sessions → bare name becomes GHII (`alice` → `alice@node-id`); agent sessions → `sub` returned as-is (already full GAII); ecosystem sessions → the GEAI, returned as-is. Without it, owner data is stored under the bare `alice` and becomes invisible to list/search/update. Compare ownership against `resolve(req)`, never `req.auth!.sub`.

**Morsels:** one balance on `GHIIRecord.morselBalance` — the human pays, agent and ecosystem-app balances are always 0; `debit/credit/transferBalance` resolve any GAII/GEAI/GHII/bare-name → owner GHII. (Aggregation + economy detail: the guide above.)

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

**Common mistakes** (callExt path, `session.fetch` returns parsed JSON, cortex register/re-activate shapes, flat translation keys): see [`docs/pitfalls.md`](docs/pitfalls.md) §8 (+ §5 for translation keys).

## MCP Presigned Upload (File Transfer)

File-accepting MCP tools (`aimeat_app_publish`, `aimeat_storage_upload`, `aimeat_extension_install`, `aimeat_cortex_install`) support presigned upload: omit the content param → the tool returns an `upload_url` → PUT the raw file (App/Storage) or a ZIP with `manifest.yaml` + `scripts/`/`libs/` (Extension/Cortex). Inline still works. Full guide (token TTL, size caps): `docs/coding-guidelines/mcp-uploads.md`

**DEFAULT for any file over ~1 KB (apps AND storage): use presigned, never inline.** Omit the content param, then `curl -s -X PUT "<upload_url>" -H "Content-Type: <ct>" --data-binary @file`. **NEVER `Read`/`cat` a base64 (or large) file into context to inline it** — a ~60 KB single-line base64 bills ~2.5 tokens/char and reading it wastes tens of thousands of tokens; this is a repeat time-sink. Caveat: `aimeat_app_draft_save` (staging) is **inline-only** (no presigned) — for a large app publish live via `aimeat_app_publish` presigned rather than reading its base64 to feed the draft.

## Key Commands

All commands from **project root** (root `package.json` proxies to `aimeat/`).

```bash
pnpm dev                 # Dev server (auto-reload), port 40050
pnpm typecheck           # tsc --noEmit (backend: src/, bin/, scripts/)
pnpm typecheck:frontend  # tsc --noEmit -p tsconfig.frontend.json (checkJs over public/)
pnpm check:importmap     # verify spa.html importmap ↔ absolute /js|/components|/views imports
pnpm lint                # eslint src/ public/
pnpm test:e2e:postgres-kysely  # E2E, PostgreSQL+Kysely (PRIMARY / prod backend — must pass)
pnpm test:e2e:sqlite     # E2E, SQLite (fast local iteration — must pass)
pnpm build && pnpm start
pnpm start -- --db postgres-kysely --db-url postgresql://localhost:5432/aimeat
pnpm start -- --db sqlite --db-path ./data/aimeat.db
```

Single suite (preferred during iteration): `cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding`. Memory-backend test commands are **deprecated** — don't use them.

**Pre-commit gate:** a committed hook (`.githooks/pre-commit`, activated by the root `prepare` script via `git config core.hooksPath .githooks`) blocks every commit unless `lint` + `typecheck` + `typecheck:frontend` + `check:importmap` + `check:no-max-tokens` + `check:app-catalog` + `check:mcp-tools` pass. The same seven run in CI (`.github/workflows/ci.yml`), which additionally runs the full `pnpm test` (vitest unit suite) after the static checks. E2E/Playwright are NOT in the hook or the fast CI path (too slow / need a DB) — run those per Rule 1. Bypass only in a genuine emergency with `git commit --no-verify`.

## Code Conventions

**Response envelope** — every response uses `success()` / `error()` from `src/middleware/envelope.ts`:
```typescript
res.json(success(config.nodeId, { data: 'here' }, [{ description: 'Next', method: 'GET', url: '/v1/endpoint' }]));
res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
```

**Auth middleware** — `requireAuth()`, `requireRole('owner'|'agent')`, `requireScope('memory:write')` from `src/auth/middleware.js`. Owner endpoints: `req.auth!.sub` is the bare owner name, scopes bypassed. Agent endpoints: `req.auth!.sub` is the full GAII, `req.auth!.owner` the owner name.

**Route registration** — routers follow `export function myRouter(config, storage): Router { ... }`, mounted via `app.use(myRouter(config, storage))` in `mountRoutes()` (`src/server-bootstrap/routes-loader.ts`).

**Storage** — all access through the `Storage` interface (`src/storage/interface.ts`); **two provider dirs**: **`postgres-kysely`** (pg + Kysely, SQL migrations in `providers/postgres-kysely/migrations/*.sql` run on boot — **the primary prod backend**) and **`sqlite`** (better-sqlite3 — first-class; also serves the in-memory default via `:memory:`). New data types/fields must be added to **both** — see `docs/coding-guidelines/storage-sync.md`. Providers share code by prototype-merge (`Object.assign`).

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

Preact + HTM SPA, no build step (the main SPA; the app-catalog is the one exception — an esbuild build, see [`docs/pitfalls.md`](docs/pitfalls.md) §1). Full architecture, component library, admin conventions, **ES-module cache-busting (importmap + BUILD_ID)**, and **SSE live updates**: `docs/frontend-development-guide.md`.

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

**Current spec (v4.0, two-layer):** `docs/AIMEAT-RFC-v4.0-Core-full.md` (generic federatable Core protocol) + `docs/AIMEAT-RFC-v4.0-Platform-full.md` (the aimeat.io platform built on the Core). The v4.0 split re-baselines the spec against the implementation: it promotes organisms/workspaces, the app platform (app grants + H-2 origin isolation), the agent fleet plane, extensions/cortex, skills/capabilities, GEAI ecosystem apps, and the metering ledger to first-class; reframes the economy as **meters, not currencies** (morsels + USD metering) behind a *pluggable, non-mandatory* payment interface; keeps federation first-class around its real use (cross-node identity/login); and marks **micro-memory, OTK/Tier 0.5, legacy Ed25519 challenge-response, and boards as deprecated** (the **Generator and Foundry are already removed** — replaced by the OpenHands app-builder, see below). v4.0 is a conceptual reframe, **not** an API break.

`openapi.yaml` remains the canonical API contract (keep in sync, Rule 3). Supporting: `docs/aimeat-implementation-prompt.md`; `docs/a-endpoints.md` (endpoint reference); `docs/b-config.md` (config schema); `docs/c-platform-notes.md` (AI platform compat).

**Historical (removed from the tree — recoverable from git history):** the superseded RFC versions (`AIMEAT-RFC-v1.2…v3.0-full.md`), the old implementation guides (`AIMEAT-IO-Implementation-Guide-v2.0/v3.0.md`), the modular `01-core.md`…`09-community.md` sections, and the Feb–Jun 2026 `plans/`, `analysis/`, `securityaudit/`, `testing/` etc. were cleaned out of `docs/` on 2026-07-12 (docs went 21 MB → 2.7 MB). They live in git history if ever needed. Do not recreate them; the v4.0 Core/Platform docs + `openapi.yaml` are canonical.

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

### App-building prompt system

**MANDATORY — research-first before building ANY AIMEAT application.** The moment the task is "build / make / publish an app (game/tool) on AIMEAT": *You have `aimeat_*` MCP tools — follow the research-first flow: load the skill `node:aimeat-app-builder` and call `aimeat_appdev_overview` first* (then fetch `GET /v1/prompts/build-app` + `/v1/app-templates` and start from a template). This is a hard precondition of the build, not an optional preamble. Skipping it once produced non-theming (hardcoded colors), meta-less, duplicate, low-polish apps (2026-07-20). Non-negotiables it enforces: never hardcode theme colors (light default + `:root[data-theme="dark"]` CSS vars, or model on `prh.html` with vendored Tailwind `/lib/tailwindcss@4.js` + daisyUI `/lib/daisyui@5.css` + `/lib/aimeat-daisyui-bridge.css`); include `<meta name="aimeat-scopes">`; **AIMEAT SDK libs load from `/v1/libs/`, vendored styling from `/lib/`** (do not mix them); morsels are plain integers, never the 🥩 emoji; check `aimeat_appdev_overview.apps` for an existing app/capability before building — reuse beats duplicate.

The canonical app-building prompt is **node-served** at `GET /v1/prompts/build-app` (source of truth: `src/services/build-app-prompt.ts`) — it builds single-file HTML apps. It has two consumers: the **app-catalog "Create new app"** flow fetches it (`src/static/app-catalog/js/cortex.js` keeps only an offline fallback), and the **OpenHands app-builder** (`tools/aimeat-openhands/`, via its `aimeat-app-builder` skill) fetches the same spec at runtime. Agent-facing discovery: `/llms.txt` + bootstrap `app_building` point to the build prompt and `/v1/app-templates`. **Improve app-building guidance in the NODE service (`build-app-prompt.ts`), never in the catalog fallback.** (See `docs/pitfalls.md` §1.)

> The old SPA **service generator** (`public/js/services/generator-prompts-*.js`) and **Foundry** were **removed** (Generator 2026-07-18, Foundry 2026-07-13) — do not revive them or reference `generator-*` files.

When editing the build-app prompt (or any app-building guidance): verify every API claim against the served browser SDK sources under `src/static/sdk-libs/<name>/` (+ `public/cortex-bundled/*.js`); extension data → `getPublic('ext:name', key)`; user data (translations/settings) → `AIMEAT.data.get(key)` (NEVER tell cortex to read translations from `ext:`); extension actions must `export default async function(ctx, input) { ... }`.

> **Served browser SDK libs (`/v1/libs/aimeat-*.js`) are authored as componentized, JSDoc-typed ESM under `src/static/sdk-libs/<name>/`** (DRY via `_core/`, < 800 lines/file), esbuild-bundled to a classic IIFE (`pnpm build:sdk`, guarded by `check:sdk` + `typecheck:sdk`), and served with a per-node config prelude by `src/routes/libs.ts`. **Never author a served lib as JavaScript inside a TypeScript template string** (the old `lib-*.ts` / `auth-lib-part*.ts` pattern — removed 2026-07-19); edit the ESM source and rebuild. Full plan: `docs/internal/sdk-libs-migration-plan.md`.

## Naming Convention — AIMEAT Only

**Never use `MEAT` as a standalone prefix.** Types `AimeatConfig`/`AimeatResponse`, env vars `AIMEAT_*`, default node id `aimeat-local-001-dev`. Rename any remaining `Meat`-prefixed identifiers to `Aimeat`.

## Init Wizard (`aimeat init`)

Lives in `src/cli/init-wizard.ts` (`@clack/prompts`). Adding a config option touches several layers (config.ts, both locale files, the wizard prompt + `CONFIG_DEFAULTS`, `.env.example`, `env-config.ts`, `env-validator.ts`) — full checklist: `docs/coding-guidelines/init-wizard.md`.
