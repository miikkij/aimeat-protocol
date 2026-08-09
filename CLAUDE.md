# CLAUDE.md — AIMEAT Protocol

The AIMEAT protocol (AI Memory Exchange and Action Transfer) and its reference implementation. Three parts:

- **The spec.** `openapi.yaml` is the canonical API contract. `docs/AIMEAT-RFC-v4.0-Core-full.md` (generic federatable Core) + `docs/AIMEAT-RFC-v4.0-Platform-full.md` (the aimeat.io platform on top of it). v4.0 reframes the economy as meters rather than currencies and deprecates micro-memory, OTK/Tier 0.5, legacy Ed25519 challenge-response and boards. It is a conceptual reframe, not an API break.
- **The node** in `aimeat/`: Node 24, TypeScript, Express 5, port 40050, pnpm. Frontend is a Preact + HTM SPA with no build step (the app-catalog is the one exception, an esbuild build).
- **`python/aimeat-crewai/`**, a pip-installable CrewAI integration. Part of this repo, with its own version line. When agent-facing capabilities change (offers, workflow signals, onboarding, MCP surface), keep it in sync. The node schema wins on any mismatch.

**Prompt-driven workflow** is the product's core pattern: the app composes ready-made prompts, the user runs them in their own AI chat and brings results back, earlier results feed later prompts. When adding to such a flow, the work is in the prompt text, not in UI buttons or backend logic.

## Two ways of working, and where each one's knowledge lives

**Platform work** is this repo: the node core and the libs it serves. **Application work** builds *on* the platform: apps live in `aimeat-apps/` and are published to the node. An app may add its own libs, extensions or cortex packs; it does not edit core.

Know which one you are doing, because the knowledge sits in different places and mixing them wastes a session:

- **Platform work** reads `docs/pitfalls.md` (traps by symptom), `docs/known_gaps.md` (deferred, developer-approved only) and `docs/coding-guidelines/`.
- **Application work** reads the node, which is shared by every session and is the source of truth: `aimeat_appdev_overview` for what already exists, `aimeat_skill_list` + `aimeat_skill_get` for a named app's operating guide, the **App Development Notes** workspace in the dev organism (`fbb51de5-…` / `ws-mslr8u99kzk`, one document per app) for how it was built, and `aimeat_appdev_pitfall_list` for app-building traps. Start there, per the `aimeat-app-building` skill.

Nothing in this repo describes an individual application, and nothing should. A durable lesson about one has three possible homes, and they are not interchangeable:

| What you learned | Where it goes |
|---|---|
| How to **use or operate** the app | its own skill — public, bound to the app with `metadata.binding` |
| How it was **built**: locked decisions, prod ids, traps hit, open questions | a document in **App Development Notes** (developer-facing, not public) |
| A trap that would bite **anyone building an app** here | the appdev KB, via `aimeat_appdev_pitfall_report` |

Development notes never go in a skill: skills are published and app-bound, written for whoever uses the app. They also never go in a repo file or a local memory, where only this repo or this session can see them.

## Working with Jouni

Enterprise architect, ex-CTO, thirty years in. Do not explain fundamentals and do not perform confidence; he sees through it. Answer in Finnish when he writes Finnish, and write Finnish that reads as Finnish rather than translated English. No em-dashes, no decorative emoji (✓ ✗ → ↩ only), no "not X but Y" constructions. Prompts and code comments stay English. No effort or time estimates.

- **Ask before:** spending money or changing AI settings, importing data automatically, touching infrastructure (wsl/docker are off limits), building something not yet agreed.
- **A locked plan gets finished**, not sliced, and not followed by "next we could".
- **Name the exact scope of a deletion** before deleting.
- **Evidence before assertions.** Name the pass-criterion, then verify against it. Verify with real content, not fixtures. Clean up test data fully. A test must fail first.
- **Reuse what exists** rather than inventing a parallel list, surface or page type.
- **Do not rewrite prompts that work** — additive changes only, and only when asked.

Tooling that has bitten before: the dev server does not watch backend `src/` (restart for a new route) · Playwright MCP needs `--isolated` and cannot use `file://` · `rm -rf` follows a junction · `cd x && python` can fail silently, so check the exit status · backticks vanish inside `python -c`, use Write instead · a curl argument mangles UTF-8 on Windows, use `--data-binary @file` · Python text mode rewrites a whole file to CRLF.

Git: parallel sessions work in a worktree · never `git add -A` (it sweeps another session's files) · the pre-commit hook reads the worktree, not the index, so an uncommitted fix greens it falsely · no scratch files in the repo root · no `Co-Authored-By` trailer.

## Ask the developer first

Release tags and CI builds. New entries in `docs/known_gaps.md`. Publishing an organism record or roadmap milestone. Entries in `aimeat/public/changelog.json` (platform-level work only, never an individual app's features; the file itself shows the shape, and `pnpm check:changelog` rejects a malformed or out-of-order list).

**Test accounts, logins and the browser-verification recipe: `docs/internal/TESTING.md`** (gitignored, so the credentials are not in this file). Four accounts: the prod owner, a second prod identity for anything cross-owner, a third-party prod member for a paying service's member path, and the local dev owner.

## Gates

- **E2E on both backends.** `postgres-kysely` is the production backend and `sqlite` is the fast local one; both must pass. Run only the suites your change can plausibly affect, then a full sweep (`pnpm test:e2e:postgres-kysely` and `pnpm test:e2e:sqlite`) at the end of a multi-step plan. A failure in an area you touched means not done. A failure elsewhere: confirm it pre-exists on `main`, mention it, leave it. New features ship with E2E tests (happy path plus a failure mode). Never report done without having run them. → `docs/coding-guidelines/testing-requirements.md`
- **Finished frontend changes are verified by driving a real browser** through the Playwright MCP server. The `.spec.ts` Playwright suite is unreliable: do not write or run it. → skill `aimeat-frontend-verify`
- **`openapi.yaml` changes in the same commit as the route**, then `pnpm generate:types`.
- **`locales/en.json` and `locales/fi.json` change together.** Unsure of the Finnish: English text with a `[TODO:fi]` prefix.
- **Security**, on any change to `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, federation, extensions or an AI path: authorize against `resolveIdentity(req.auth!, …)` and never a client-supplied id; keep server-trusted config and secrets out of principal-writable namespaces; route non-constant outbound HTTP through `safeFetch`; gate every mutation with `requireScope`/`requireRole`; verify federation Ed25519 signatures unconditionally. Anything whose safe value differs between localhost and the public internet goes in `.env.example` with a safe public default and a documented local override. Identity-touching features ship with cross-owner and cross-scope "→403" tests. → `docs/coding-guidelines/security-development-dna.md`
- **Pre-commit hook** (`.githooks/pre-commit`) runs lint, typecheck, typecheck:frontend, check:importmap, check:no-max-tokens, check:app-catalog, check:mcp-tools. It reads the worktree rather than the index, so an uncommitted fix can green it falsely. CI runs the same seven plus the vitest suite.
- **File headers** (`@file`, `@description`, `@version-history`) on the `.ts`/`.js`/`.css` files you touch. Any existing source file shows the format.
- **Subagents run on Opus.** `model: "opus"` or omit it.
- **Never `MEAT` as a standalone prefix.** `AimeatConfig`, `AIMEAT_*`, `aimeat-local-001-dev`.

## Accepting a result

Name the pass-criterion before accepting a checkpoint, then verify against that criterion rather than overall impression. Alignment is proven with an asymmetric anchor element, size with a known reference dimension, behaviour with the real interaction. If you cannot state a criterion, the requirement is unclear: resolve it or ask before iterating, because iterating on a guessed target produces confident wrong fixes. **A source named in the request (a URL, file or spec) is the requirement: open it before implementing.** A verdict reached on weak evidence stays suspect until re-verified.

## Identity: GHII / GAII / GEAI

Three distinct principal types. Full reference: `docs/coding-guidelines/identity-model.md`.

| Identity | Format | What it is |
|----------|--------|------------|
| **GHII** | `alice@node-id` | Human user. Owns everything: morsel balance, profile, trust. |
| **GAII** | `claude#alice@node-id` | AI agent. Scoped permissions, own trust score. |
| **GEAI** | `eco:drum-news#alice@node-id` | Ecosystem app. Onboarded hello→approve→token with TOFU key pinning plus a scope and data-area allowlist; writes into its own `eco:` namespace; consented like an agent. → `docs/building-an-aimeat-compatible-ecosystem-app.md` |

A bare owner name (`alice`) is the account layer: `req.auth!.sub` for owner JWTs, `req.auth!.owner` for all principals. Internal hosted apps are identity-bearing too, via scoped app grants that resolve `role:'app'` to the owner but fence to approved scopes.

**Every route that stores or retrieves by identity uses `resolveIdentity(req.auth!, config.nodeId)`** from `src/utils/gaii.ts`, never raw `req.auth!.sub`. Owner sessions turn the bare name into a GHII; agent and ecosystem sessions return `sub` as-is. Skip it and owner data lands under bare `alice`, invisible to list, search and update. Compare ownership against the resolved identity.

Morsels: one balance, on `GHIIRecord.morselBalance`. The human pays; agent and ecosystem balances are always 0, and `debit`/`credit`/`transferBalance` resolve any principal to the owner GHII.

Agents are never created implicitly. Registration creates the owner and GHII only; agents connect later via device authorization (RFC 8628), where the owner approves each one and picks scopes.

Key files: `src/utils/gaii.ts`, `src/routes/ghii.ts`, `src/routes/agents.ts`, `src/auth/middleware.ts`, `src/routes/libs.ts`.

## Extension, cortex and app namespaces

Full guide: `docs/coding-guidelines/extension-memory-architecture.md`.

| Namespace | Who writes | Who reads |
|-----------|-----------|-----------|
| **Owner** (`alice@node-id`) | the user via authenticated API | the user, and extensions via `ctx.memory.getPublic(gaii, key)` |
| **Extension** (`ext:{name}`) | only that extension, via `ctx.memory.set()` | anyone, no auth |

- **Extension** (WASM sandbox) owns `ext:{name}`, reads owner data via `ctx.memory.getPublic(ctx.caller.gaii, key)`, calls external APIs via `ctx.fetch()`.
- **Cortex** (browser IIFE) reads extension data via `AIMEAT.data.getPublic('ext:name', key)`, reads and writes user data via `AIMEAT.data.get/set()`, calls extension actions via `session.fetch('/v1/ext/name/actionId')`.
- **Translations and settings are user data.** Cortex reads them with `AIMEAT.data.get('service.i18n.fi')`, never from an `ext:` namespace.
- **Apps** call cortex public methods only. Never `callExt`, `readExtMemory`, `/v1/ext/` or `/v1/memory/ext:`.

The extension is sovereign: it decides storage, format and return shape. Cortex trusts the extension API, the app trusts cortex, and no layer bypasses the one below. Common mistakes: `docs/pitfalls.md` §8, plus §5 for translation keys.

## Backend

**Protocol only, no server-side rendering.** Routes in `src/routes/` are generic reusable API endpoints. Never `res.send('<html>...')` or build HTML in a handler. The test for a new route is "would a second, different service use this?"; if not, it does not belong, and no per-service backend files. UIs are client-side SPAs or static files. The admin dashboard is the single legacy exception. If data is already available through an existing API, do not wrap it.

- **Response envelope:** `success()` / `error()` from `src/middleware/envelope.ts`.
  ```typescript
  res.json(success(config.nodeId, { data: 'here' }, [{ description: 'Next', method: 'GET', url: '/v1/endpoint' }]));
  res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Resource not found'));
  ```
- **Auth middleware:** `requireAuth()`, `requireRole('owner'|'agent')`, `requireScope('memory:write')` from `src/auth/middleware.js`. Owner endpoints bypass scopes.
- **Routers** follow `export function myRouter(config, storage): Router`, mounted in `mountRoutes()` (`src/server-bootstrap/routes-loader.ts`).
- **Storage** goes through the `Storage` interface (`src/storage/interface.ts`). Two providers: `postgres-kysely` (pg + Kysely, SQL migrations under `providers/postgres-kysely/migrations/*.sql` run on boot) and `sqlite` (better-sqlite3, also the in-memory default via `:memory:`). **New data types and fields go into both.** → `docs/coding-guidelines/storage-sync.md`
- **ESM imports keep the `.js` extension:** `import { foo } from '../services/foo.js'`.
- **Express 5:** `req.params` returns `string | string[]`, cast with `as string`.

## Frontend

Full architecture, component library, cache-busting and SSE: `docs/frontend-development-guide.md`. Two mechanisms bite often:

- **A new shared JS module** on an absolute path (`/js/services/foo.js`) needs an identity entry in the importmap in `public/spa.html`. `portal.ts` stamps `?v=BUILD_ID` automatically. Relative imports, bare specifiers and CSS need no entry.
- **Every profile or admin tab showing server data** re-fetches on the `aimeat-live-update` window event (static-data, pure-nav and push-pref tabs excepted):
  ```javascript
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);
  ```

Styling, in short: no inline `style=""` and no CSS constants in JS; colours and spacing from `theme.css` variables; no `rgba(255,255,255,…)`; button classes are `.btn-primary`, `.btn-outline`, `.btn-ghost`, `.btn-danger` and friends, with no `.btn` base class; all user-visible text through `t()`. Full conventions and the browser verification protocol: skill `aimeat-frontend-verify`.

## Commands

From the project root; the root `package.json` proxies to `aimeat/`.

```bash
pnpm test:e2e:postgres-kysely    # E2E, production backend
pnpm test:e2e:sqlite             # E2E, fast local backend
pnpm check:importmap             # spa.html importmap vs absolute imports
pnpm start -- --db postgres-kysely --db-url postgresql://localhost:5432/aimeat
pnpm start -- --db sqlite --db-path ./data/aimeat.db
```

A single suite during iteration (relative paths, so `cd` first):

```bash
cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding
```

Memory-backend test commands are deprecated. There is no Prisma and no MongoDB in this codebase; do not re-add either.

## MCP file transfer

File-accepting MCP tools (`aimeat_app_publish`, `aimeat_storage_upload`, `aimeat_extension_install`, `aimeat_cortex_install`) support presigned upload: omit the content param, get back an `upload_url`, then PUT the file.

```bash
curl -s -X PUT "<upload_url>" -H "Content-Type: <ct>" --data-binary @file
```

**Use presigned for anything over ~1 KB.** Never `Read` or `cat` a base64 file into context to inline it: a 60 KB single-line base64 bills roughly 2.5 tokens per character. `aimeat_app_draft_save` is inline-only, so publish large apps live via `aimeat_app_publish` instead of feeding a draft. → `docs/coding-guidelines/mcp-uploads.md`

## Where things are

`docs/pitfalls.md` is the catalogue of traps we have actually hit, organised by kind of problem. Read it when something breaks in a way that feels like it should work, and add an entry when a bug turns out to be a repeatable trap.

| Guide | Purpose |
|-------|---------|
| [Testing Requirements](docs/coding-guidelines/testing-requirements.md) | E2E rules, multi-backend testing, writing tests |
| [Security DNA](docs/coding-guidelines/security-development-dna.md) | Trust model, ten invariants, per-change checklist |
| [Security](docs/coding-guidelines/security.md) | Auth, validation, XSS, rate limiting, GDPR |
| [Identity Model](docs/coding-guidelines/identity-model.md) | GHII/GAII reference, aggregation, morsel economy |
| [Storage Sync](docs/coding-guidelines/storage-sync.md) | Adding fields and tables across both providers |
| [Architecture](docs/coding-guidelines/architecture.md) | System design, storage layer, SSR-removal history |
| [Code Style](docs/coding-guidelines/code-style.md) | TS/JS conventions, route patterns, i18n |
| [Prompt Writing](docs/coding-guidelines/prompt-writing.md) | Positive framing; applies to every prompt string |
| [File Headers](docs/coding-guidelines/file-headers.md) | Header format, version history |
| [Dependency Management](docs/coding-guidelines/dependency-management.md) | Licenses (GPL/AGPL need approval), audits, justification |
| [Memory Contracts](docs/coding-guidelines/memory-contracts.md) | Self-describing memory records; prefer extending memory over new tables |
| [Environment Configs](docs/coding-guidelines/environment-configs.md) | Node type configs (full, personal, relay, mirror) |
| [Init Wizard](docs/coding-guidelines/init-wizard.md) | `aimeat init` maintenance checklist |
| [MCP Uploads](docs/coding-guidelines/mcp-uploads.md) | Presigned upload URLs, token TTL, size caps |
| [Frontend Guide](docs/frontend-development-guide.md) | Preact + HTM SPA, cache-busting, SSE, admin conventions |
| [Skills Registry](docs/skills-registry.md) | SKILL.md packs, scopes, semver pins, app-bound skills |
| [App Developer AI Guide](docs/app-developer-ai-guide.md) | Apps using the user's OpenRouter key via `AIMEAT.ai.complete()` |
| [Building an Agent](docs/building-an-aimeat-compatible-agent.md) | Offer descriptor, pricing, workflow signals |
| [Building an Ecosystem App](docs/building-an-aimeat-compatible-ecosystem-app.md) | GEAI, hello→approve→token flow |
| [Getting Started](docs/coding-guidelines/getting-started.md) | Install, setup, dev workflow |
| [Known Gaps](docs/known_gaps.md) | Deferred technical gaps (developer-approved entries only) |

Copy-pasteable agent connect instructions live in `public/views/profile/agents-tab.js` (`buildAgentPrompt()` and `PLATFORMS`). Machine-readable discovery is `src/routes/bootstrap.ts` at `GET /`; managed system prompts are in the DB, served by `src/routes/prompts.ts` at `/v1/prompts/:name`.

Project skills, loaded when the task calls for them: `aimeat-app-building`, `aimeat-frontend-verify`, `aimeat-organism-records`, `aimeat-imagery`.
