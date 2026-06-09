# Changelog

All notable changes to AIMEAT are documented in this file.

## [Unreleased]

### Apps: one canonical record per owner across every identity form

An owner's apps no longer fragment by how they authenticate. Publishing the same app via the
**dashboard** (owner claim = bare name `happydude500001`) versus via **MCP / a Personal Access
Token** (owner claim = full GHII `happydude500001@aimeat-finland-001-genesis`) previously created
**two separate records** for the same filename, each with its own version counter — so an agent
acting for the owner could not update the owner's canonical app. Apps are now keyed on a single
canonical owner bucket regardless of identity form, and a startup migration merges pre-existing forks.

#### Fixed

- **App publish/patch/delete now canonicalise the owner before computing the storage bucket**
  (`src/routes/apps.ts`). A new `canonicalOwner()` helper strips any `@node` suffix from the
  authenticated `owner` claim to a single bare name, then resolves it to the owner's canonical GHII via
  `resolveGhii` — the **same `ghiis.ghii` key the migration consolidates onto**, so the route and the
  migration can never diverge. Every identity form of an owner (dashboard bare name, MCP/PAT full GHII,
  agent `agent#owner@node`) now maps to one `<owner>@<node>` bucket with a shared version counter, and
  `/v1/apps/<owner>/<filename>` resolves to a single record. The owner stays derived from the
  authenticated identity (never a client param), and the delete handler's `ownerName !== owner`
  defence-in-depth guard is retained, so an agent of owner A still cannot reach into owner B's namespace.
- **Presigned app uploads derive a bare owner name** (`src/routes/upload.ts`). `handleAppUpload` was
  using the GHII token subject verbatim as `ownerName` (`parseGAII` returns null for a GHII, which has
  no `#`), forking the presigned path off into a second bucket; it now strips the `@node` suffix so
  inline and presigned publishes land in the same canonical record.

#### Added

- **`storage.mergeForkedAppBuckets()`** (interface `src/storage/repositories/app.repository.ts`; SQLite
  + MongoDB providers) — a one-off, idempotent data-hygiene migration that consolidates app buckets an
  owner forked across identity forms. A plain re-key was impossible because the two forks share version
  numbers `1..N` and the primary key is `(ownerGaii, filename, versionNumber)`, so each stray bucket is
  folded into the owner's canonical GHII bucket with its versions **renumbered after the canonical
  max** — no collision, no history lost, newest content stays the served latest. The app's screenshot
  is moved and download counters are summed into the canonical row. Owners without a GHII record are
  left untouched. Wired to run at startup right after `normalizeAppOwnerNames()`
  (`src/server-bootstrap/service-init.ts`); logs `Merged N forked app bucket row(s)…` when it acts.
- **Tests** — `test/unit/app-owner-normalization.test.ts` extended with `mergeForkedAppBuckets()`
  coverage (fork renumbering, pure re-key on an empty canonical bucket, screenshot/download folding,
  unknown-owner skip, idempotency); `test/e2e-apps.ts` gains a cross-owner isolation phase; and
  `test/integration/app-bucket-merge-mongo.ts` exercises the Prisma data path against a live MongoDB
  (updating the compound-unique `ownerGaii`/`versionNumber`). All pass on SQLite and MongoDB.

### Profile Agents tab: custom groups, inline tag editing — and per-tab section memory

Three quality-of-life improvements for owners running many agents. The Agents tab gains a
**Custom groups** organising mode (drag agents into your own named sections), tags become
**editable inline** on the agent card instead of being buried in a sub-tab, and the profile's
"remember where I was on F5" now works **per browser tab** instead of globally.

#### Added

- **Custom agent groups** (`public/views/profile/agents-tab.js`, `public/js/services/agents.js`) — a
  new "Custom groups" option in the Agents tab "Group by" selector. Create named sections and **drag an
  agent by its grip handle onto a group** to file it there (mirrors the organism document-space section
  pattern); unassigned agents fall into an "Ungrouped" section that is also a drop target. Group
  **definitions are stored server-side** in the owner's memory (`agents.groups` via new
  `getAgentGroups`/`saveAgentGroups`), so the grouping follows the owner across devices, while the
  **collapse/expand state is per-browser** (localStorage, keyed by owner). The "Group by" selector is now
  always shown (it was hidden when an owner had no tags, which would have blocked access to custom groups).
  New EN/FI i18n keys (`profile.agents.filter.groupByCustom`, `profile.agents.groups.*`).
- **Inline agent tag editing** (`public/views/profile/agents/agent-card.js`) — the expanded card's tag
  strip is now editable: add via a "+ tag" input and remove per-chip with ×, writing through the existing
  `PATCH /v1/agents/:name/tags` route. Always rendered (even for an untagged agent, so the first tag can be
  added) and kept in sync with the list's tag filter / "Group by: Tag" via the live-update refresh. Reuses
  the existing Data Access tab's tag i18n keys.

#### Fixed

- **Profile section is now remembered per browser tab.** The landing page restores the last-opened section
  on F5 from the `aimeat-profile-tab` key, but it lived in `localStorage` — shared across all open tabs, so
  with several profile tabs open a refresh would jump to whatever section another tab last opened. The key
  moved to `sessionStorage` in both consumers (`landing-page.js`, `profile.js`), so each tab restores its
  own view and a fresh tab starts at home.

### PostgreSQL storage backend + per-backend Docker Compose

AIMEAT now supports **PostgreSQL** as a third first-class persistent backend, alongside SQLite and MongoDB.
PostgreSQL reuses the entire MongoDB Prisma provider (which uses only portable Prisma CRUD), so the two
share one code path and behave identically — the only differences are a relational schema and a second
generated client. Each backend also gets its own Docker Compose file.

#### Added

- **`PrismaStorage` base class** (`src/storage/providers/mongodb/index.ts`) — `MongoStorage` was generalised
  into a shared base with two overridable hooks (`schemaFileName()`, `prismaClientSpecifier()`); `MongoStorage`
  remains as a thin back-compat subclass. No query logic changed.
- **`PostgresStorage`** (`src/storage/providers/postgres/index.ts`) — a ~10-line subclass that loads
  `schema.postgres.prisma` + a custom-output Prisma client.
- **`prisma/schema.postgres.prisma`** — relational mirror of the MongoDB schema, derived deterministically by
  **`scripts/gen-postgres-schema.mjs`** (regenerate after any `schema.prisma` change). 50 Prisma-generated ids
  become `@default(cuid())`; 38 app-supplied ids drop only the `_id` mapping.
- **Config wiring** — `AIMEAT_STORAGE=postgresql` (with `postgres` accepted as an alias) threaded through the
  storage factory, config schema/validator, `aimeat config`, the `aimeat init` wizard (with EN/FI i18n), and
  `--db` help.
- **Build & scripts** — `pnpm build` now generates both Prisma clients; new `db:generate:postgres`,
  `db:push:postgres`, and `test:e2e:postgresql` scripts; PostgreSQL added to `test:e2e:all-backends`.
- **Docker Compose per backend** — `docker-compose.postgres.yml` (adds a `postgres:16` service) and
  `docker-compose.sqlite.yml` (no external DB), alongside the existing MongoDB `docker-compose.yml`.
- **E2E** — `run-e2e-ci.ts` gained a PostgreSQL branch (server `--db-url` + per-suite table-truncate
  resets); `.env.test.postgres.example` template added. The full E2E suite (1822/1823 — only the SMTP
  `email/test` fails, identically on all three backends) passes on PostgreSQL.

#### Fixed

- **Dockerfile** never copied `prisma/` (so `prisma generate` had no schema) and pulled `node_modules` from a
  prod-only stage (so the generated Prisma client was absent at runtime) — both pre-existing gaps that also
  affected MongoDB-in-Docker. The image now carries the schema, both generated clients, and the Prisma CLI.
- **`docker-compose.yml`** set `DATABASE_URL` but not `AIMEAT_STORAGE`, so it silently ran the in-memory
  backend instead of MongoDB. It now sets `AIMEAT_STORAGE=mongodb`.
- **E2E/Playwright runners no longer leak a stray `AIMEAT_BASE_URL` into the test run.** A bare
  `AIMEAT_BASE_URL` (commonly exported to point the CLI at a remote node like `https://aimeat.io`) used to
  cause two problems: (1) the runner silently tested that remote server instead of a local one — external
  mode now requires an explicit `AIMEAT_E2E_EXTERNAL=1`, else the runner warns and auto-starts locally
  (external `BASE_URL` also gets its trailing slash trimmed, fixing `//v1/...` 404s); and (2) it leaked via
  `...process.env` into the spawned **test server**, so it built presigned upload/download URLs pointing at
  the remote node — the local server signed the token but the `PUT`/`GET` hit the remote, which verified
  with a different key → `401 "signature verification failed"`. The runner now forces the spawned server's
  `AIMEAT_BASE_URL` to the local address.
- **Extension upsert idempotency on PostgreSQL.** `PUT /v1/extensions/{name}` with an identical manifest
  returned `action: "updated"` instead of the no-op `action: "unchanged"` on Postgres, because the
  change-detection used `JSON.stringify` over `Json` fields and Postgres `jsonb` does not preserve object
  key order. Now uses a canonical key-sorted serializer (`utils/stable-json.ts`), so the comparison is
  backend-agnostic. The same hardening was applied to the system-prompt locales change-check.
- **E2E runner PostgreSQL reset** now truncates all tables (fast, and not blocked by Prisma's AI-agent
  guard) instead of `prisma db push --force-reset` (which dropped + recreated all 88 tables between every
  suite).

### `startup.prompt.md` — hand the repo to an AI assistant and it sets itself up

A fresh clone now ships a paste-ready bootstrap prompt. Drop the contents of `startup.prompt.md` into
Claude Code, Copilot, or Cursor with the repo open and the assistant takes you from clone to a **live
AIMEAT node** (or a connection to a hosted node), **registers your AI agents** (CrewAI crews, Claude,
Cursor, …) via the device-auth flow, and explains the essentials of working with AIMEAT as it goes.

#### Added

- **`startup.prompt.md`** (repo root) — an assistant-facing setup checklist: determine the target
  (self-host vs `aimeat.io`, SQLite vs MongoDB, owner handle) → install → configure `.env` → start the node
  → create the operator owner → register + approve agents (`aimeat connect`) → teach the AIMEAT essentials
  (GHII/GAII identity, namespaced memory, single-balance morsel economy, agent modes + Hello Integration,
  MCP surfaces, prompt-driven workflow). Includes guardrails (never echo secrets, confirm destructive ops,
  never invent node URL/owner/keys) and a "do it now" closing step.
- **README "Fastest start" callout** — points new users to `startup.prompt.md` near the top of the README.

### App catalogue: version management, and agent-published apps now surface as yours

Apps published by an owner's agent (via MCP/API) were stranded in "Community Apps" with
only a View button — they couldn't be managed and didn't appear as the owner's own. The
catalogue also gained per-app version management (the data was always stored; only the UI
was missing).

#### Added

- **Versions modal** on owned published cards (`src/static/app-catalog.html`) — lists every
  stored version (View per version), **Restore** re-publishes an older version as the new
  latest (non-destructive; history kept), and **Fork** copies a version into a new app.
  Community cards gained a **Fork** button so any public app can be copied into your own
  catalogue.
- **`Storage.normalizeAppOwnerNames()`** (SQLite + MongoDB), run once at startup
  (`src/server-bootstrap/service-init.ts`) — rewrites legacy app `ownerName` values stored as
  a full GHII (`owner@node`) to the bare owner name, idempotently, so agent-published apps
  reunite under the owner's "Published Apps".
- **Tests** — `test/e2e-apps.ts` (version history, restore→new latest, fork, GHII-owner
  download fallback, missing-version `404`) and `test/unit/app-owner-normalization.test.ts`.

#### Fixed

- **"My apps" filter** now matches on the bare owner prefix, so apps stored under a full-GHII
  `ownerName` show as the user's own (manageable) instead of in "Community".
- **`/versions` and `/screenshot` routes** (`src/routes/apps.ts`) scanned per-agent GAII
  buckets, but apps and their screenshots live in the owner's GHII bucket — both `404`'d for
  every app published under the current scheme. They now resolve the row via
  `getAppByOwnerName()` and read that bucket directly.
- **`GET /v1/apps/:owner/:filename`** tolerates the legacy full-GHII owner segment (retries
  the bare prefix), so links shared before ownerName normalization still resolve.

### App catalogue: working dark theme, English/Finnish, header quick-toggles, interview-style prompt

UX overhaul of the standalone catalogue page (`src/static/app-catalog.html`).

#### Added

- **Dark theme that actually works** — the dark CSS had been removed (light was hardcoded),
  so the theme setting did nothing. Restored a full `[data-theme="dark"]` token set, converted
  ~75 hardcoded light colours to CSS variables, and added `color-scheme`, so every surface
  (cards, modals, context menu, inputs, the prompt preview) flips. A quick 🌙/☀️ light-dark
  toggle now sits in the header next to Settings.
- **English / Finnish** — a standalone i18n layer (en/fi) covering the visible chrome (header,
  section headers, card buttons, context menu, settings, every modal, empty states), an EN/FI
  picker in the header plus a Language row in Settings, persisted and re-rendered on switch.
- **Generate App Prompt — rewritten and brought up to date** — listed 6 client libraries; the
  node serves 13, and the central **aimeat-ai** (AI completions on the user's own key) was
  missing. The prompt now covers all libraries (grouped), an AI usage section, a realtime/rooms
  section, light+dark design guidance, and an **interview-first** structure (Step 1 asks app
  type / name / look & feel / shared-or-private / AI, Step 2 builds). The "Copy with AI Prompt"
  / share prompt was aligned to match. The live preview now shows the full prompt instead of a
  2000-character clip.

#### Fixed

- **Context menu no longer runs off the bottom of the screen** — it estimated a fixed height,
  so with many apps the lower actions (Publish/Delete) were pushed out of reach. It now measures
  the real menu height (`offsetHeight`, immune to the entry-animation transform) and clamps to
  the viewport, with `max-height`/scroll as a backstop.

### Agent tasks: delete any non-active task + clean its operational traces

The expanded task view (Profile → Agents → agent → Tasks) only offered **Delete** on
`draft`/`queued` tasks, so a `paused`, `stalled`, `done`, `failed`, or archived task could
not be removed and just lingered in the list. Delete now covers every non-active task and
clears the leftovers a stale task otherwise leaves behind for the runner daemon.

#### Changed

- **Delete works on any non-active task** — `DELETE /v1/agents/{name}/tasks/{id}` now removes
  a task in any state except `active` (was `draft`/`queued` only). An `active` task returns
  `409` ("cancel or pause the task first") and keeps the existing Cancel button; everything
  else (`draft`/`queued`/`revision_requested`/`paused`/`stalled`/`done`/`failed`) is
  deletable. Guard relaxed to `status != 'active'` in both storage backends and the route
  (`src/routes/agent-tasks.ts`, `src/storage/providers/{sqlite,mongodb}`).
- **Tasks tab shows Delete on every non-active task** — the expanded task card renders the
  Delete button for all deletable states, not just queued/draft/revision_requested
  (`public/views/profile/agents-tasks-subtab.js`).
- **OpenAPI** — `deleteAgentTask` description updated (non-active rule + trace cleanup) and a
  `409` response added (`openapi.yaml`).

#### Added

- **Operational-trace cleanup on delete** — deleting a task now also clears its event log
  (unchanged), the agent's live-status keys `agents.<agent>.tasks.<id>.*`, and the owner's
  cancel marker `agents.cancel.task.<id>` (which the CrewAI daemon scans on every poll), so a
  deleted task can't keep disturbing the runner. The agent's produced deliverable/output
  memory is deliberately preserved; cleanup is best-effort and never fails the delete.
- **E2E coverage** (`test/e2e-agent-tasks.ts`) — active→`409`, pause-then-delete→`200`, and a
  deleted task's live key + cancel marker verified gone afterward (SQLite + MongoDB).

### Scheduler "Run now": report the outcome + stop a set-aside task from blocking it

"Run now" on an `agent_task` schedule could silently create nothing: the scheduler's overlap
guard treated any non-terminal prior occurrence — including a `paused` or `archived` one the
owner had set aside — as "still in flight", skipped, and the route still returned success. The
owner saw a "started" toast but no task ever appeared.

#### Changed

- **Manual runs no longer blocked by a set-aside occurrence** — a manual "Run now" now only
  defers to an occurrence that is pending or running on its own (queued/draft/revision_requested/
  active/stalled); a `paused` occurrence — or any `archived`-triaged one — no longer blocks it.
  Cron/@activate keep the stricter guard (anything not done/failed defers the next fire), but an
  archived occurrence never blocks either path (`src/services/scheduler.ts`).
- **Skipped/limited runs no longer inflate stats** — an overlap skip is recorded as `skipped`
  in the run log and no longer bumps `runCount` or marks the schedule's last run `success`.

#### Added

- **"Run now" reports what happened** — `POST /v1/schedules/{id}/trigger` returns
  `data.outcome` (`created` | `ran` | `busy` | `limited` | `error`), with `data.task_id` on
  `created` and `data.reason` on `busy`/`limited`/`error` (`scheduler.ts` `triggerNow`/`JobOutcome`,
  `src/routes/schedules.ts`). The Scheduler UI maps it to a clear toast — e.g. a warning "No task
  created — a previous run is still active…" instead of a misleading success (`schedule-item.js`).
  New i18n keys `profile.scheduler.run{Created,Busy,Limited,Error}` (en + fi); OpenAPI updated.
- **E2E coverage** (`test/e2e-agent-schedules.ts`) — trigger returns `outcome=created` (+`task_id`);
  a queued occurrence yields `busy`; a `paused` occurrence and an `archived` occurrence each still
  produce a fresh run (SQLite + MongoDB).

## [1.19.0] - 2026-06-05

### Dify integration toolkit + MCP OAuth consent fixes

Connected AIMEAT to Dify end-to-end (both directions) and hardened the remote MCP OAuth
consent flow that the integration exercised. The takeaway: AIMEAT's already-built remote
OAuth 2.1 MCP server is the universal connector — paste the node's `/v1/mcp` (or a `/v2/mcp/:role`
surface) URL into Dify (or n8n / Open WebUI / Claude), authorize once, and an agent can even
self-run Hello Integration from the canonical instruction.

#### Added

- **Dify integration toolkit** (`aimeat/tools/dify-bridge/`) — a zero-dependency bridge shim
  (`src/shim.ts`) that turns a webhook-backed AIMEAT capability into a call to a Dify workflow
  (capability-invoke → Dify Service API → result, with `DIFY_MODE=mock` for local testing); a
  curated OpenAPI spec (`aimeat-dify-tools.openapi.yaml`, default server = the public node) for
  importing AIMEAT operations as Dify Custom Tools; and a one-time `connect-onboard.ts` that
  registers an agent via device auth and drives Hello Integration to completion. README covers
  the recommended **MCP** path and the self-onboarding pattern (canonical Hello Integration
  instruction + MCP connection = an agent that onboards itself).
- **Dify integration design doc** (`aimeat/docs/integrations/dify-hello-integration.md`) — the
  two integration directions, identity model (device-auth vs PAT), exact request/response
  contracts, and the hard constraints (10s capability timeout, SSRF, networking).

#### Fixed

- **MCP OAuth consent crashed on a non-absolute `redirect_uri`** — `POST /v1/mcp/authorize-consent`
  called `new URL(finalRedirect)` on a relative redirect_uri (e.g. a Dify instance with an unset
  `CONSOLE_API_URL` sends `/console/api/mcp/oauth/callback`), throwing an unhandled `TypeError`
  → `500 INTERNAL_ERROR`. It now fails fast with a clear `400 invalid_request` that names the bad
  value (`src/mcp/index.ts`).
- **OAuth consent page rendered errors as `[object Object]`** — the approve handler built
  `new Error(d.error_description || d.error || …)` where `d.error` can be an envelope object; it
  now surfaces the real message (`public/oauth-consent.html`).

### Portal: custom templates are actually served + embeddable site header

The custom portal template feature (admin **Portal** tab) was effectively dead for
human visitors and stored portal data in the wrong place. This makes it real: a custom
template now reaches browsers, its dynamic data resolves, the AI-assisted flow round-trips,
and any standalone template can pull in the exact same site header as the rest of AIMEAT.

#### Added

- **Embeddable site header** — new drop-in library `GET /v1/libs/aimeat-header.js`
  (`src/routes/lib-header.ts`) renders the canonical header (brand + live morsel balance,
  nav, language switcher, theme toggle, and the **real** gold login pill via the existing
  `aimeat-auth.js` `mountLoginButton`) into any page. A custom portal template adds three
  lines (`<link rel="stylesheet" href="/css/theme.css">`, `<div id="aimeat-header">`,
  `<script src="/v1/libs/aimeat-header.js">`) and gets a header identical to the SPA,
  including working login, theme, and EN/FI — sharing the same `aimeat-theme`/`aimeat-lang`
  state. Listed in the `/v1/libs` catalogue.
- **`POST /v1/site/memory` + `DELETE /v1/site/memory/:key`** (`src/routes/site.ts`,
  `SiteService.setPortalMemory`/`deletePortalMemory`) — operator endpoints that write a
  single portal memory key under the site (`__site__`) namespace so `{{memory:portal/*}}`
  tags resolve. New changelog actions `memory_set` / `memory_delete`. OpenAPI + E2E
  coverage added; the undocumented `GET /v1/site/memory-keys` is now in the spec too.
- **Template Editor: active-source status + "Load current page"** — the tab now shows
  whether a custom template or the built-in SPA is active, and a button seeds the editor
  with the live `/` HTML as a starting point.
- **AI-Assisted Editor: "Import AI Result"** — paste the JSON bundle the prompt produces
  and it imports via `/v1/site/import` (template + portal memory + KV in one shot).
- **CSP nonce for operator templates** — custom templates are now stamped with the
  per-request CSP nonce (`src/utils/csp-nonce.ts`, applied in `bootstrap.ts` + `site.ts`),
  so inline `<script>` blocks in a trusted operator template execute.
- **Portal editor prompt guidance** — the `site-portal` system prompt now tells the AI to
  ask whether to include the standard header (and use the drop-in library, not a hand-rolled
  nav), and to avoid CSP-blocked inline event handlers (`onclick="…"`) in favor of
  `addEventListener`. The prompt content now syncs from code on startup.

#### Fixed

- **Custom portal template was never shown to humans** — `GET /` (bootstrap router, mounted
  before the site router) unconditionally redirected `Accept: text/html` requests to the SPA,
  so the site router's template-serving `/` was dead code. Bootstrap now serves the resolved
  custom template when one is set (else redirects as before); the shared `SiteService` is
  created once and passed to both routers so the resolved-HTML cache stays coherent.
- **Portal Memory Keys wrote to the wrong namespace** — the admin "Portal Memory Keys"
  add/delete used the generic `/v1/memory` route, storing keys under the operator's own
  identity instead of `__site__`. They never appeared in the list and never resolved in
  templates. Now routed through the new site-memory endpoints.
- **AI-Assisted result 422'd** — the prompt emits a `/v1/site/import` JSON bundle, but the
  only place to paste it was the Template Editor, whose **Save** posts raw HTML to
  `/v1/site/template` (422 on `{`). Added the dedicated import box; **Save** now detects a
  pasted JSON bundle and points to it instead of failing.
- **Admin preview didn't refresh** — the Portal tab preview iframe and "Clear Cache" now
  reload the preview after every change (cache-busted), so edits are visible immediately.

### Agents tab: fleet "running now" panel + task deep-link

A cross-agent **"Running now"** panel between the agent board and the agent list shows
every agent's currently-active tasks in one place; clicking a row jumps straight into
that agent's **Tasks** tab and opens the exact task.

#### Added

- **"Running now" panel** (Profile → Agents) — flattens every agent's `active` tasks
  into one newest-first list (agent · task · "time ago", live dot). Reuses the active
  tasks already fetched per-agent in `loadData()`, so it adds **no new requests**;
  refreshes on the existing `aimeat-live-update` signal. Capped at 50 rows with an
  explicit "+N more" overflow note (never silently truncated). en/fi i18n.
- **Click-to-open deep-link** — a new `preSelectedTab` / `openTaskId` / `openTaskNonce`
  prop chain (agents-tab → agent-card → tab-tasks → agents-tasks-subtab → TaskItem)
  expands the target agent, selects its Tasks tab, resets the task bucket to Recent so
  the task is visible, and auto-opens + scrolls to it. Nonce-gated so a fresh panel
  click re-fires while a plain manual re-expand still respects the default tab.

#### Fixed

- **Task "Scope" rendered `[object Object]`** — the task-detail Scope row stringified its
  structured provenance entries (e.g. the scheduler's `{ name, value, type, description }`)
  via a naive `join()`. It now formats each entry as `name: value — description`
  (e.g. `schedule: 0 9 * * * — Morning pipeline`), one per line.

### SynthTraces — synthetic agent-session traces (dev tool)

A self-play harness (`aimeat/tools/synthtraces/`, no backend changes) that generates
synthetic AIMEAT agent-session traces: a *persona* model plays the human owner and an
*agent* model drives a real node, producing task-driven traces for benchmarking and
fine-tuning models on the AIMEAT protocol. Inspired by Hugging Face's SynthTraces, but
the environment is the AIMEAT protocol itself rather than a code repo. Dev-only tool —
runs on top of the public APIs, the backend is untouched.

#### Added

- **Two-model self-play** over native owner↔agent messaging + the task lifecycle; the
  task's own immutable event timeline + telemetry form the trace backbone.
- **Providers** — OpenRouter (free `owl-alpha`), x.ai (Grok), Anthropic, **Ollama
  (local, no key)**, and a key-free `scripted` provider. Agent and persona can use
  **different** providers (e.g. free cloud agent + local user model — the SynthTraces
  "small local model plays the user" pattern).
- **Transports** — REST, MCP, and `hybrid` behind an `AgentDriver` boundary; each trace
  tool-call records which channel handled it (`via`).
- **Telemetry** — per-turn token/duration captured into `trace.usage` and pushed as a
  `task_event` `details.telemetry`, so the node's native `task.telemetry` accumulates
  real cost per session.
- **Eval** (`eval.ts`) — protocol-correctness checks (task reached done, no hallucinated
  tools, no failed calls, persisted something, valid memory keys/visibility, completed
  after real work) plus token-cost and transport-mix reporting. Verified over a
  30-session dataset: cloud `owl-alpha` mean 0.971, fully-local `qwen2.5:7b` mean 0.950,
  both with 0 hallucinated tools and 0 failed calls.
- **Docs** — `aimeat/tools/README.md` (rationale / what to observe / roadmap) and
  `aimeat/tools/synthtraces/README.md` (run guide).

#### Fixed

- **Stale doc** — the app-developer AI guide claimed `POST /v1/ai/complete` "caps at 4000
  tokens regardless"; no such cap exists in the code (the saved-default clamp is ≤128,000,
  and spend is bounded by the daily USD budget). Corrected the guide.

### Scheduled tasks for agents

Owners — and agents on their behalf — can now schedule **recurring jobs** ("get the
morning news every day", "translate the shared-memory news every morning"). The
**AIMEAT server owns the clock** (reusing the existing `croner` scheduler), so jobs
survive an agent disconnect and the owner can **pause or cancel anything instantly —
including schedules an agent created**. Execution is hybrid: zero-token sandboxed
extension runs, server-side AI on the owner's OpenRouter key, or dispatch into an
agent's task queue. Surfaced in a new **Profile → Scheduler** master view and a
per-agent **Schedules** sub-tab. Full design:
`aimeat/docs/plans/2026-06-03-agent-scheduler-and-scheduled-tasks-plan.md`.

#### Added

- **Three schedule kinds on one server-owned clock** — `extension` (run an installed
  extension action in the sandbox, zero tokens), `ai` (server-side OpenRouter
  completion that reads predefined input memory keys, applies a prompt, and stores the
  result to an output key — runs even while the agent is offline), and `agent_task`
  (materialises an `AgentTaskRecord` into the agent's queue on each fire and wakes it
  via the existing webhook/MCP/poll fan-out). IANA-timezone/DST aware; overlap guard;
  per-run `ExecutionLogEntry`; failure push notifications.
- **Owner REST API** — `GET/POST /v1/schedules`, `GET/PATCH/DELETE /v1/schedules/{id}`,
  `POST /v1/schedules/{id}/trigger`, plus `GET/POST /v1/agents/{name}/schedules`. The
  master `GET /v1/schedules` aggregates AIMEAT-managed schedules, the owner's extension
  cron jobs, and each agent's self-reported internal scheduler.
- **MCP tools (agent self-service)** — `aimeat_schedule_create` / `_list` / `_update`
  (pause/resume/edit) / `_delete`, plus `aimeat_schedule_report_internal` for an agent
  to publish its own out-of-AIMEAT cron into the `agents.<name>.scheduler` mirror.
  Registered in the catalog, annotations, and the `agent` v2 surface.
- **Server-side AI completion service** — `services/ai-completion.ts`, extracted so both
  `POST /v1/ai/complete` and the scheduler's `ai` jobs share one budget/key/usage path.
- **Extensible, opt-in budget guards** — `services/schedule-constraints.ts`: `max_runs`
  (auto-disable after N fires) and `daily_limit` (cap daily AI spend), off by default,
  set per-schedule or as per-agent defaults in the **Agent Config** tab (finally wiring
  the previously-declared `AgentRecord.dailySpendLimit`). New guard types are one
  registry entry — no schema change.
- **Frontend** — Profile → Scheduler master view (managed / extension-cron /
  agent-internal groups, with create form, pause/resume, run-now, cancel) and a
  per-agent Schedules sub-tab (AIMEAT-dispatched vs Agent-internal), `sch-*` styles,
  `js/services/schedules.js`, and en/fi i18n.
- **Storage** — extended `ScheduledJobRecord` (`ai`/`agent_task` types, `ownerScope`,
  `agentName`/`agentGaii`, `displayName`/`purpose`, `timezone`, `constraints`,
  `runCount`), `ExecutionLogEntry.taskId`, and `AgentRecord.scheduleConstraintDefaults`
  across SQLite + MongoDB/Prisma (additive migration).
- **Editable schedules + readable timing** — every managed schedule renders as an
  inline-editable card (shared `schedule-item.js`, used by both the master view and the
  per-agent sub-tab): edit cron, timezone, display name, purpose, and the kind-specific
  **dispatch payload** (the agent_task title/description or the AI prompt + input/output
  keys — i.e. *what the run actually produces*, shown on its own row). "Next run" is a
  human "time until" (e.g. `20h 46min`) instead of a raw/negative timestamp, including in
  the extension-cron table.
- **Cross-agent scheduling** — one agent can schedule a **sibling** (same owner) via
  `POST /v1/agents/{name}/schedules`; the target is the path, resolved under the caller's
  owner, so no token-borrowing is needed. The root `POST /v1/schedules` accepts
  `target_agent`/`agent` as aliases for `agent_name` and flat `task_title` /
  `task_description` (mirroring the MCP tool). `createdByAgent` is now recorded correctly
  (agent tokens don't carry a literal `agent` role), so the creating agent can manage its
  own schedules. Agent guide: `aimeat/docs/agent-scheduler-guide.md` (FI), incl. the
  headless/deterministic REST path.
- **Tests + spec** — `test/e2e-agent-schedules.ts` (22 cases: CRUD, cross-owner authz,
  agent_task dispatch → task materialisation, overlap skip, max_runs auto-disable, AI
  failure mode, owner cancels agent-created, **cross-agent targeting via path + aliases,
  sibling self-management, cross-owner reject**); OpenAPI documents all new endpoints +
  schemas.

#### Changed

- **`POST /v1/ai/complete` refactored onto the shared `ai-completion` service** — no
  behaviour change; the route is now a thin wrapper.

### Profile navigation: persistent sidebar

The profile page's navigation is now a **persistent, grouped sidebar** with every tab
always visible, replacing the new/active/experienced **tier-adaptive menu** that hid
and reordered items by activity level — unpredictable for both humans and agentic
developers.

#### Added

- **Persistent grouped sidebar** (Daily / Build & Share / Technical / Personal /
  Network & Admin) + a content column showing either the open tab or the home dashboard
  (ProfileCard + tier-based onboarding + app strip). On mobile it becomes an off-canvas
  drawer. The new **Scheduler** tab lives in the Daily group.

#### Changed

- **`computeTier()` now gates only the home onboarding content, not the menu** — the
  tier-branched `MenuSection` layout in `landing-page.js` was removed in favour of the
  always-visible sidebar.

### Mobile header (responsive top bar)

The global shell header now works on narrow widths: the **gold logged-in pill (and
Logout) stays reachable on mobile**, the site-nav links collapse into a **hamburger
dropdown**, and content uses the screen width.

#### Added

- **Hamburger nav + compact pill** — at ≤1180px the header nav links + theme/language
  toggles collapse into a dropdown, while the gold pill stays in the bar and goes
  compact (green dot + Logout). Auth-pill hook classes added in `aimeat-auth.js`.

#### Fixed

- **Logged-in pill overflowed the viewport** in the ~900–1180px band (full inline nav +
  wide pill, wider still for operators) — the collapse breakpoint was raised to 1180px,
  the GHII is ellipsis-truncated in the pill, the morsel chip is hidden on mobile (still
  shown in the dashboard), and mobile content side margins were reduced.

### Owner session refresh tokens

Human (owner) login sessions now stay alive reliably and no longer log you out
mid-task after ~an hour. Sessions are backed by a rotating, server-side **refresh
token delivered as an httpOnly cookie** instead of re-signing with the owner key, so
session continuity is decoupled from the owner keypair — logging in on one device no
longer breaks another device's session. Full design:
`aimeat/docs/plans/2026-06-03-owner-session-refresh-tokens-plan.md`.

#### Added

- **Rotating refresh-token sessions** — login establishes a per-device session (one
  row per device) with a short access JWT (`AIMEAT_ACCESS_TTL`, default 15 min) and an
  httpOnly `aimeat_rt` refresh cookie (`SameSite=Strict`, `Path=/v1/auth`).
  `POST /v1/auth/refresh` rotates the token one-time-use with **reuse detection**
  (replaying a consumed token revokes the whole device session) and a short grace
  window for in-flight concurrency. Sliding **30-day idle / 90-day absolute** lifetime.
  Extends `SessionRecord` across SQLite + MongoDB/Prisma.
- **Refresh on tab focus / visibility** — `aimeat-auth.js` re-checks the token when the
  tab regains focus or becomes visible and refreshes if it is within 5 min of expiry.
  The previous proactive `setTimeout` never fired while the machine was asleep or the
  tab was frozen — the root cause of the ~60-min logout.
- **Device session list** — `GET /v1/auth/sessions` now returns `device_label` and
  `last_used_at`; logout / `DELETE /v1/auth/sessions[/{id}]` revoke the session and
  clear the cookie.
- **New config:** `AIMEAT_ACCESS_TTL` (900), `AIMEAT_REFRESH_IDLE_DAYS` (30),
  `AIMEAT_REFRESH_ABSOLUTE_DAYS` (90), `AIMEAT_REFRESH_GRACE_MS` (60000) — wired into
  `.env.example`, `aimeat config`, the env validator, and the init wizard.

#### Changed

- **Owner sessions refresh via the cookie, not the owner key** — `session.refresh()`
  calls `POST /v1/auth/refresh` (single-flight); boot restores from the cookie; the
  short access token lives in memory (only non-secret metadata in localStorage). Agent
  and federated paths are unchanged.
- **`/v1/ghii/login` no longer rotates the owner keypair on every login** — it mints a
  fresh key only when the device holds none (`request_owner_key`), so logging in on a
  new device no longer invalidates other devices' refresh.

#### Fixed

- **~60-minute logout while away from the machine** — the only refresh trigger was an
  in-page `setTimeout` that does not fire during OS sleep / tab suspension; combined
  with owner-key rotation on every login, returning users were logged out. Both causes
  are removed.

### Agent access tokens

Owners can create, in **profile → Access**, a reusable, revocable token an AI agent
uses (as an `Authorization: Bearer` header) to authenticate transparently — like a
logged-in user — and verify a web app it built. The auth middleware recognises the
token on every request, so there is **no app-side login step**. Full design:
`aimeat/docs/plans/2026-06-03-agent-access-tokens-plan.md`.

#### Added

- **Personal Access Tokens** — `POST` / `GET /v1/access/tokens` and
  `DELETE /v1/access/tokens/{id}` (owner-only). A token grants either selected agent
  scopes (a scoped, sandboxed test GAII) or, when chosen, **full owner** or **operator**
  access (operator only mintable by an operator; roles re-derived from the owner's
  current roles so a token never grants more than the owner holds). Opaque 256-bit
  token (`aimeat_pat_…`), stored as a SHA-256 hash only, shown once. Optional expiry;
  revocation takes effect immediately. New `PatRecord` + `personal_access_tokens` table
  across SQLite + MongoDB/Prisma.
- **Header-based recognition** — the auth middleware accepts a PAT directly as
  `Authorization: Bearer`, so every authenticated endpoint works with no client
  changes. Optional `POST /v1/auth/token/exchange` swaps the token for a short
  stateless JWT.
- **Browser "logged in" via cookie** — when an owner/operator token reaches the server
  on a browser request, the server sets the httpOnly `aimeat_rt` cookie to the token;
  `aimeat-auth.js` boot restores a session from the cookie alone, so the web app shows
  as genuinely logged in. The cookie is validated on every refresh, so revoking the
  token logs the browser out immediately. (Scoped tokens: header only, no cookie.)
- **Access tab UI** — a new "Agent Access Tokens" section: create form (agent scope
  checklist + **Full (owner)** / **Operator** + optional expiry), the raw token shown
  once with a ready-made copy-paste agent prompt, and a list with level badge,
  last-used / expiry and one-click revoke. Bilingual (en + fi).

## [1.17.0] - 2026-06-01

Agent **Tasks** tab triage — long task lists are split into three buckets so the
working set stays small without pagination, plus on-demand search and a per-task
view of the memory entries a task produced. Full design:
`docs/plans/agent-tasks-triage-plan.md`.

### Added

- **Triage buckets** — the Tasks tab now has **Recent** (non-terminal + recently
  finished), **Keep** (manually pinned), and **Archive** (manually archived +
  auto-archived old terminal tasks), each with a live count. Per-task **Keep /
  Archive / Restore** actions. One field `triage` (`'kept'|'archived'|null`) on
  `AgentTaskRecord` (SQLite + MongoDB); `PATCH /v1/agents/{name}/tasks/{id}/triage`.
- **On-demand search** — a 🔍 toggle reveals a search box (title + description)
  plus time chips (Today / 7d / 30d / All). `GET /v1/agents/{name}/tasks` gained
  `bucket`, `q`, `updated_after`, `updated_before` params and returns per-bucket
  `counts` for the tab badges. No pagination — buckets + search handle length.
- **Auto-archive node config** (admin Config tab) — `tasks.auto_archive`
  (default on) and `tasks.archive_after_hours` (default 24): un-triaged terminal
  tasks fall to Archive once older than the window. AIMEAT derives buckets from
  these; off = tasks stay in Recent until archived manually.
- **Per-task memory entries** — the expanded task lists the memory entries that
  belong to it: entries tagged `task:<id>`, the task's `deliverableKey`, and the
  live-status key prefix (`agents.<name>.tasks.<id>.`), deduped by key. Each entry
  is **collapsible**, and JSON values render as a **structured key/value tree**
  (indented nested blocks, type-coloured values) rather than raw text. (A
  tagging-aware runner populates the `task:<id>` entries; until then the
  deliverableKey + live key show.)

### Changed

- **Blur-title eye is hover-only** in the Tasks list — the per-task "hide title"
  toggle now appears on row hover/focus instead of always being visible,
  de-cluttering long lists; rows whose title is already hidden keep their eye.

### Fixed

- **No more empty flash on live updates** — tabs that refetch on the live-update
  signal no longer blank-then-repaint; they swap fresh data in place (first mount
  still shows the loading state, via a `showSpinner` option on the loaders).
  Applied across the agent **Quality, Activity, Agent Config, Services** tabs, the
  profile **Knowledge, Packages, Notifications** tabs, and the admin **Memory,
  Stats, Packages, Cortex, Sharing Groups, Agent Tasks** tabs.

### Companion

- **`aimeat-crewai` 0.3.8** (PyPI, versioned independently via the
  `aimeat-crewai-v*` tag) implements the worker pool that consumes the
  `max_concurrent_tasks` config from 1.16.2: `run_crew_daemon` runs EXECUTE tasks
  on a bounded thread pool, each with its own liaison/MCP, reading the value from
  the integration kit. Default 1 = serial (unchanged).

## [1.16.2] - 2026-06-01

Follow-on to the Quality tab (1.16.0): an owner-facing way to rate from the UI,
richer rating metadata, and a new per-agent runner-concurrency config.

### Added

- **`max_concurrent_tasks` per-agent runner config** — `PATCH
  /v1/agents/{name}/max-concurrent-tasks` (1–20, default 1) and an editable
  number field at the top of the agent **Tasks** tab. Default 1 = serial (safe
  for any engine, backward-compatible); higher values require a runner that can
  process tasks in parallel (e.g. a CrewAI daemon with a per-task liaison/worker
  pool). AIMEAT only stores and exposes the number — it does **not** enforce
  concurrency server-side. The runner reads it from the integration kit's
  `watchdog_spec.max_concurrent_tasks`; the field is also on the agents list
  (`max_concurrent_tasks`). Persisted on `AgentRecord` (SQLite + MongoDB).
- **Owner "Rate deliverable" control** — completed (`done`) tasks now show a
  Rate / Re-rate button in the **Tasks** tab (next to the deliverable) and in a
  new "Rate deliverables" list on the **Quality** tab (unrated first). Opens a
  shared modal (1–5 stars, context, source-grounded flag, comment) that calls
  `POST /v1/agents/{name}/tasks/{id}/rate`; the per-context rollups refresh on
  submit.
- **Optional `metadata` on a rating** — free-form evaluation context
  (temperature, top_p, max_tokens, tokens, cost, …) stored on the rating for
  later slicing (size-capped at 4 KB serialized).

### Fixed

- **Quality tab custom metrics** are now read from the agent's GAII namespace
  (where an agent's own memory writes land) instead of the owner GHII, so
  agent-published `agents.<name>.statistics.custom.*` entries actually surface.

## [1.16.0] - 2026-05-31

Agent **Quality** tab — per-context peer/owner reviews of task deliverables,
turned into a quality picture alongside recomputed performance statistics.
Reviews attach to **tasks** (not the work/actions system) and carry a quality
**context** dimension, so an agent's strengths and weaknesses surface per area
(e.g. `creative: 4.5★ / factual: 2.1★`). Full design and rationale:
`docs/plans/agent-quality-tab-plan.md`.

### Added

- **`POST /v1/agents/{name}/tasks/{id}/rate`** — review a completed (`done`)
  task's deliverable with a 1–5 star rating and a `context`
  (`factual`/`creative`/`code`/`planning`/`summarization`/`research`/`communication`/`other`).
  Authorization: the task's owner, or a same-owner agent (e.g. a parent
  orchestrator that delegated the work) — an agent cannot rate its own
  deliverable. Logged as a `rating` task event.
- **Source-grounding hard gate** — for the factual family
  (`factual`/`research`/`code`/`summarization`) an *agent* rater must set
  `source_grounded: true` (the rating was checked against the inputs/sources),
  otherwise the request is rejected with `422 GROUNDING_REQUIRED`. Human owners
  are exempt; `creative` accepts an output-alone craft rating. Stops stars from
  rewarding confabulation over faithfulness.
- **`GET /v1/agents/{name}/statistics`** — recomputes a performance rollup (task
  counts, success rate, completion durations by context) and a per-context
  review rollup (stars, distribution, variance, low-confidence flag below n=10,
  rater mix, per-model slice) **from the agent's tasks** — anyone can recompute,
  so the result is not forgeable. Written to the owner's public cache keys
  `agents.<name>.statistics.performance` / `.reviews`, and surfaces any custom
  metrics published under `agents.<name>.statistics.custom.*`.
- **Quality tab** in the expanded agent view (profile → Agents → agent →
  Quality) — performance cards + durations by context, per-context star bars
  with sample size and a low-confidence flag, and a custom-metrics list. Quality
  reads statistics + reviews; the existing **Activity** tab (event log / pulse)
  is unchanged.
- **Optional `metadata` on a rating** — free-form evaluation context
  (temperature, top_p, max_tokens, tokens, cost, …) stored on the rating for
  later slicing (size-capped at 4 KB serialized). `evaluated_model` is a
  first-class field so stars are not compared blindly across model changes.
- **`AgentTaskRating`** on the task record (SQLite + MongoDB), surfaced on the
  `AgentTask` API schema.

### Notes

- New E2E suite `test/e2e-agent-quality.ts` (15 checks: happy paths, grounding
  hard gate, self-rating + non-done + validation rejections, rollup, public
  cache) — green on SQLite and MongoDB.

## [1.15.1] - 2026-05-31

### Added

- **Cooperative task cancellation** — owners can **Cancel** an active/stalled
  task from the Tasks tab. It writes an owner-scoped `agents.cancel.task.<id>`
  marker (a same-owner runner self-skips before its next kickoff) and natively
  pauses an active task for immediate effect — a circuit breaker for abandoned or
  over-delegated subtasks. (The `aimeat-crewai` daemon honours the marker as of
  its 0.3.7 release.)
- **`aimeat-agents.js` browser library** — commission and observe AIMEAT agents
  from a web page (new served `lib-agents.js` helper + demo HTML).

### Fixed

- **Integration tab no longer flashes** on live updates — a `showSpinner` option
  on its loader stops the tab from re-rendering its loading state every time
  server-side data changes (first mount still shows it). (Extended to the rest of
  the tabs in 1.17.0.)

## [1.15.0] - 2026-05-31

MCP overhaul from the tool-design audit (`docs/mcp_audit/`): the `/v1/mcp` tool
surface was reviewed against MCP/Anthropic best practices, made consistent and
safer, and a new set of purpose-scoped surfaces (`/v2/mcp/<role>`) was added so
agents load only the tools that fit their job. `/v1/mcp` is unchanged and frozen
for existing consumers.

### Added

- **v2 purpose-scoped MCP surfaces** — `POST /v2/mcp/{appdev|agent|service|admin}`,
  each exposing only the tools relevant to that role (a projection of the same
  canonical catalog — no forked handlers). `agent` ~45 tools, `appdev` ~20,
  `service` ~52, `admin` ~15, vs ~100 on the full surface. Fewer, focused tools
  = less context and fewer wrong-tool mistakes. The same surfaces are available
  locally via `aimeat connect serve --surface <role>`.
- **Per-agent scope enforcement on MCP (F1)** — the tool surface is now filtered
  by the agent's granted scopes (mirroring the REST `requireScope` gates), so an
  agent no longer sees/uses tools it isn't scoped for. `AIMEAT_MCP_ENFORCE_SCOPES`
  (default true) toggles a warn-only rollout. Owner-attached agents with a `*`
  scope still get the full surface.
- **`response_format` (`concise` | `detailed`)** on read-heavy tools — concise
  returns only high-signal fields for fewer tokens.
- **`structuredContent` + `outputSchema`** on core read tools (memory read/list,
  wallet, work inbox, agents list, agent profile) — machine-readable output
  alongside the text content.
- **Binary download handle** — `aimeat_storage_download` returns a `resource_link`
  + a presigned, TTL-limited `GET /v1/download/:token` URL instead of base64, so
  binaries never flow through the model context. `inline:true` only for small text.
- **Output-size backstop** — tool results are bounded (~25k tokens) to protect the
  context window; `aimeat_memory_list` gained a `limit` + capped owner-scope.
- **Per-role operating handbooks** — separate handbook per surface, fetchable via
  `aimeat_handbook_get(surface:"<role>")` or `GET /v1/agents/me/handbook/surface/:role`.
- **`aimeat_message_history`** tool (full thread context, oldest-first).
- **Tool-surface tooling** — `pnpm audit:mcp-schemas` (server↔connector↔catalog
  schema-parity audit with a `--strict` drift ratchet + v2 surface coverage) and
  `pnpm eval:mcp-surface` (context-cost report).
- **Editable Stored Memory Keys** in the agent Data Access tab — inline value
  editor, delete, and **+ Add key**. New entries are created under the **agent's
  GAII** (not the owner's GHII) via a new `agent` parameter on `POST /v1/memory`,
  so they belong to the agent being viewed. Rows now show per-key created /
  last-updated timestamps and a sort control (updated/created, newest/oldest).
- **Editable agent Memory Areas** (key prefix / description / read vs read+write)
  with delete, in the Data Access tab.
- **Drag-to-reorder agent bars** in the profile Agents tab — per-browser order
  saved to `localStorage` (ungrouped, unfiltered list).
- **Pop-out agent window** — a ⤢ button opens a single agent in its own window
  (`/v1/profile?solo=<name>`) so several agents can sit side by side; each window
  keeps its own SSE connection.
- **Editable array config in the admin dashboard** — array-of-strings fields such
  as **`agent.system_principles`** (the system-wide directive principles) are now
  edited one-item-per-line in the Config tab and persisted via `PUT /v1/admin/config`.
- **Task deliverable link** — agents may pass `deliverable_key` on
  `POST .../tasks/{id}/complete`; it is stored on the task (`deliverableKey`, both
  backends) and the owner's Tasks tab links to that agent-memory entry, showing
  the value on demand or "no longer exists" if it was deleted.

### Changed

- **Canonical tool catalog** (`src/mcp/catalog/`) is now the single source for tool
  descriptions on both MCP surfaces (was: inline strings duplicated per surface).
  Descriptions rewritten to "new teammate" quality.
- **Reconciled server↔connector input schemas** — 43 tools whose two surfaces
  disagreed on parameter names now match the REST contract (e.g. `consent_grant`,
  `group_get`, `catalogue_*`); fixed a connector `storage_upload` bug (sent
  `content`, REST reads `data`). Remaining known divergences are tracked/baselined.
- **MCP audit + CLI guidance** — `aimeat help` / `aimeat connect` and the bootstrap
  `GET /` discovery doc now document the v2 surfaces.
- **`DELETE /v1/memory/:key` mirrors the PUT owner-session cross-agent lookup** —
  an owner can now delete a key stored under one of their agents (previously 404).
- **`PUT /v1/agents/:name/directives` now merges** instead of full-replacing —
  fields omitted from the request body are preserved, so the Directives and Data
  Access tabs no longer wipe each other's sections.
- **Collapsed agent bar is now two rows** (identity/badges on top, a faint-divider
  second line for delivery/status/last-seen) so the status text stops overflowing.

### Fixed

- **SSE live updates were globally broken.** The global `compression()` middleware
  buffered the `GET /v1/events` stream, so change events never reached the browser —
  the UI only appeared to refresh via polling (the Memory tab, agent task event log,
  and 13 other tabs all stayed stale until reload). `text/event-stream` is now
  excluded from compression and the stream is flushed per event; live updates work
  again everywhere.
- **Behavioral directives silently vanished on save.** The Directives tab sent a
  `content` field the API/storage doesn't have (so it was stripped); behavioral
  directives are now stored as the agent-level `rules` and reconstructed on load.
- **Admin Config fields looked un-editable.** Inputs were bound to the saved value
  instead of the pending edit, so toggling a checkbox / typing snapped straight
  back on re-render. All inputs now reflect `pending[path]`.

- Stale agent handbook guidance: removed a phantom `aimeat_memory_delete` tool
  reference, corrected the "18 built-in tools" wording, and added a missing
  `aimeat_message_history` tool annotation that was breaking MCP registration.

### Removed

- `aimeat_instance_*` tools are not exposed on the v2 surfaces (auto-created
  session metadata, not an agent capability). They remain on `/v1/mcp`.

## aimeat-crewai 0.3.7 - 2026-05-31

Cooperative subtask cancellation for the daemon (benefits every crew using
`run_crew_daemon`, no per-crew code). Before each blocking EXECUTE
`crew.kickoff()`, the daemon re-checks whether the subtask is still wanted and
**skips + fails** it if not — stopping abandoned/speculative subtasks from ever
starting (circuit breaker for the "coordinator over-delegated to one crew, then
gave up at the collect timeout" case).

### Added

- **Cancel marker convention.** A subtask is treated as cancelled if its id is
  listed in any memory entry with key prefix `agents.cancel.` (value = array of
  task ids, `visibility: owner`), read across the owner namespace
  (`owner_scope=true`). A coordinator agent can write `agents.cancel.run.<run>`
  for a batch; the owner UI writes `agents.cancel.task.<id>`. This is what lets
  one agent cancel work it delegated to another (the marker is visible to all
  the owner's agents).
- **Pre-kickoff guard** in the EXECUTE loop: `_is_cancelled()` checks (1) the
  task status is still `active`/`stalled` (catches an owner-side pause/delete)
  and (2) the cancel markers; on a hit it `POST .../fail`s the task and skips.
  Running kickoffs are not interrupted — cancellation is cooperative, applying
  to not-yet-started subtasks.



Fix inbox message dispatch — message-triggered crews never ran. A daemon started
with `listen_for=(..., "messages")` polled fine and logged listening, but inbox
messages were never dispatched to a crew (tasks were unaffected). Three bugs in
`daemon.py`, all now fixed:

### Fixed

- **Wrong JSON key (the blocker).** `_poll_messages()` read `data.messages`,
  which the node never returns. The `GET /v1/agents/<agent>/inbox` response
  carries inbox items under `data.pending_messages` (and a unified `data.items`),
  so the poll returned `[]` every cycle and no message crew ever ran. Now reads
  `pending_messages` (fallback `items`).
- **Truncated content.** Inbox items carry only a ~100-char `preview`, not the
  full body, so even after the key fix the crew would have received a clipped
  request (or `"(empty)"`). New `_fetch_message_content()` resolves the full
  message body via `GET /v1/agents/<agent>/messages?thread_id=`.
- **Infinite re-dispatch.** The message loop never marked messages handled, so a
  still-pending message re-ran the crew on every poll cycle. New
  `_mark_message_delivered()` (`PATCH /v1/agents/<agent>/messages/<id>` →
  `status: delivered`) is called after a successful kickoff, plus a process-local
  `done_ids` guard against re-dispatch within a daemon lifetime.

Diagnosed from a field report against `aimeat-finland-001-genesis` (connector
CLI v1.14.3). Drop-in replacement for 0.3.5; no API changes.

## [1.14.6] - 2026-05-30

Agent detail view live-refresh fixes. Both fixes are in tabs that
already listened to the global `aimeat-live-update` SSE event but
weren't refreshing the right state when the tick fired -- the user
had to switch tabs and come back to see fresh data.

### Fixed

- **Data Access tab** (`tab-data-access.js`): the currently expanded
  memory entry's value is now re-fetched on every live-update tick,
  not just the list of keys. Before, the key list refreshed
  correctly but the entry body the user had open stayed frozen until
  they closed + re-opened it. If the entry was deleted server-side,
  the panel now also auto-collapses it.
- **Data Access tab** (`tab-data-access.js`): the full-tab
  "Loading..." overlay no longer flashes on every live-update tick.
  Only the initial mount shows the spinner; background refreshes are
  silent. Previously, any unrelated server change made the whole
  panel blank for ~500ms.
- **Tasks tab** (`agents-tasks-subtab.js` `TaskItem`): the event log
  of an expanded task now re-fetches on live-update ticks while the
  card is open. Before, the task object refreshed via the parent's
  `loadTasks()` (todos + status updated in-place), but the event
  list underneath stayed stale because it was fetched separately on
  expand and never re-run.

## [1.14.5] - 2026-05-29

Task revision lifecycle for the proposed-todos -> owner-review loop, plus
small UX cleanup on the task view. Paired with aimeat-crewai 0.3.5.

### Added

- **New task status `revision_requested`** and new todo status `outdated`.
  When the owner reviews an agent's proposed TODO plan and wants a
  different one, they can send a free-text change request. The server
  marks the existing pending todos as `outdated` (kept for history) and
  flips the task to `revision_requested`. The agent reads the change
  request and re-proposes; the server appends the new pending todos
  alongside the outdated history and flips the task back to `queued`
  for owner review.
- **`POST /v1/agents/:name/tasks/:id/request-changes`** (owner-session
  only, route-level explicit gate -- `requireRole('owner')` alone is
  insufficient because agent JWTs inherit the owner role). Body:
  `{ message: string }`. Validates that the task is `queued` AND has
  at least one non-outdated todo. Stores the message both as a task
  event of type `revision_requested` and as a linked inbound agent
  message in the agent's inbox so the agent can pick it up via
  `aimeat_message_inbox` without separately polling task events.
- **`POST /v1/agents/:name/tasks/:id/propose-todos`** -- merge-aware
  companion to PATCH `/tasks/:id`. Replaces the raw-PATCH approach the
  connector's `aimeat_task_propose_todos` MCP tool used before: a raw
  PATCH would clobber the outdated history, while this endpoint
  preserves outdated todos and handles the
  `queued -> revision_requested -> queued` state transitions. The
  public MCP `aimeat_task_propose_todos` tool now does the same merge
  in-place; both share semantics.
- **`aimeat_task_request_changes` MCP tool** on the connector surface
  (server-side public MCP gets the REST route only -- public MCP tools
  don't have a clean way to gate on owner-session vs agent-session, so
  the connector + REST cover the owner-driven flow).
- **Task event type `revision_requested`** carries the owner's message
  in the event's `message` field and the count of retired todos in
  `details.outdated_count`.
- **OpenAPI**: documented both new endpoints and the extended
  `TaskStatus` enum.

### Changed

- **Task detail view**: the "Requirements" and "Technical" tabs were
  dropped from the proposal panel. Field tests showed
  `verification.userExpects` and `technicalChecks` stayed empty for
  every real task, so the panel had three tabs to inspect for one
  thing that mattered. The verification fields stay in the schema for
  callers that want to set them via `aimeat_task_create`; the
  dashboard simply doesn't surface them as separate tabs anymore. The
  remaining single proposal view shows the TODO plan directly.
- **Task delete now requires explicit confirmation** via `useConfirm()`
  (matching the dashboard pattern used by memory, agents, knowledge,
  capabilities) -- previously delete went through with one click.
- **Owner can `request-changes` from the task card** -- new button
  shows up beside Start when the task is `queued` and has todos. The
  modal accepts free-text guidance for the agent.
- **Outdated todos render below the active plan** under a collapsible
  "Previously proposed (outdated)" section, so the owner can see what
  the agent had proposed before the revision round-trip without it
  cluttering the current plan.
- **Persona / SKILL.md updates** (generic + hermes adapter, Python
  liaison SLIM + FULL templates): document the
  `propose -> (revise if asked) -> wait-for-active -> mark-todos-done
  -> task_complete` lifecycle and how to react to
  `revision_requested` (read the linked inbox message, propose again,
  trust the success response).

### Notes

- Webhook v1 is locked, so revision events ride on the existing
  `task.updated` envelope (with `status: 'revision_requested'`) and a
  paired `message.inbound` envelope for the linked agent message.
  External subscribers already filter on these.
- The `revision_requested` filter pill is intentionally NOT a new
  pill in the dashboard -- it lives under the existing "queued" pill
  because conceptually it's still "awaiting action before run".

## [1.14.4] - 2026-05-29

End-to-end fixes that unblock the CrewAI daemon path (crewfive's
`research-crew` field test). Pairs with aimeat-crewai 0.3.4. See the
implementation brief from the 2026-05-29 diagnosis session for full
context.

### Added

- **Auto-active tasks for `task-runner` agents (C3).** In
  `POST /v1/agents/:name/tasks`, when the target agent's `mode` is
  `task-runner`, a task created with `status='queued'` is flipped to
  `'active'` immediately and a synthetic `started` task event is
  appended. This unlocks autonomous operation for daemon-style agents:
  the owner pre-authorises the agent by setting mode=task-runner once
  (during `aimeat connect add --mode task-runner` or via Profile ->
  Agents), and subsequent tasks bypass the per-task `queued -> /start`
  owner gate. `interactive`, `autonomous`, and `coordinator` mode
  agents still go through the standard owner approval. The webhook
  fires as `task.approved` (same name as a manual /start), so existing
  subscribers see a uniform "task is now runnable" signal regardless
  of which gate flipped it.
- **`agentNotFoundResponse` helper in `src/auth/middleware.ts` (C1).**
  Routes that look up an agent record and return 404 can call this
  helper to distinguish two cases: the caller is an agent whose own
  record is missing (signed token outlived a server-side delete) vs.
  any other not-found lookup. The first case returns
  `AGENT_NOT_REGISTERED` with a concrete `aimeat connect add ...`
  recovery command; the second stays `NOT_FOUND`. Wired into
  `GET /v1/agents/:name/onboarding` and `POST /v1/agents/:name/tasks`
  so connectors see a single, actionable error instead of staring at
  generic NOT_FOUND while their token validates everywhere else.
- **`aimeat connect status` desync detection (C1).** When the inbox
  smoke check fails, the CLI now distinguishes "token invalid" from
  "token valid but agent record missing" and prints the exact
  `aimeat connect add` command to re-register. Saves a debugging
  round for the most common failure mode after a server-side agent
  deletion.
- **`handbook_get` module alias (C4).** `/v1/agents/me/handbook/onboarding`
  now resolves to the `tasks` handbook module instead of returning
  `Unknown module: onboarding`. Backstop for agents that guess
  "onboarding" as a module name after calling
  `aimeat_onboarding_status`; Hello Integration culminates in the
  task lifecycle, so `tasks` is the closest valid drill-down.

### Fixed

- **MCP `aimeat_onboarding_status` error envelope (C2).** The MCP tool
  in `src/mcp/agent-onboarding.ts` previously returned bare text
  ("Agent not found") on the error path; downstream Python clients
  (crewai-tools, the daemon's tool wrapper) called `json.loads()` on
  the result and crashed with
  `Expecting value: line 1 column 1 (char 0)` before any retry logic
  could engage. `asError()` now JSON-wraps the message and includes
  the `AGENT_NOT_REGISTERED` code so clients can parse + branch
  uniformly across success and error paths.

## [1.14.3] - 2026-05-29

### Changed (skill bundle persona — positive-framework rewrite)

Field tests of the demo-crew daemon showed the liaison occasionally
looping on the onboarding test task: it called `aimeat_task_complete`,
got a `{ ok: true, ... }` response, but the negation-heavy persona
("Do NOT re-call status to confirm", "Never...") pushed the LLM toward
defensive re-verification. The "trust the success response" rule was
also scoped only to `aimeat_onboarding_*` -- it did not name
`aimeat_task_*` or `aimeat_memory_*`, so the LLM did not generalise.

This release rewrites the canonical SKILL.md body in both runtime
adapters in positive framework:

- `aimeat/src/services/skill-bundle/generic-adapter.ts` -- the generic
  bundle written for `crewai`, `langgraph`, `autogen`, and any
  hand-rolled MCP-capable agent.
- `aimeat/src/services/skill-bundle/hermes-adapter.ts` -- the hermes
  bundle used by the Hermes runtime.

Concrete changes in both adapters:

- "Trust every success response" rule now explicitly covers
  `aimeat_onboarding_*`, `aimeat_task_*`, AND `aimeat_memory_*` -- one
  success response is final across the entire onboarding + task
  lifecycle.
- Negations replaced with positive phrasing ("Pass only the parameters
  you actually need" instead of "Do NOT pass null", "that step is
  outside your flow -- treat as no-op and advance" instead of "Never
  retry").
- New explicit section "Completing the onboarding test task (canonical
  task lifecycle)" documents the 3-step
  propose_todos -> mark-todos-done -> task_complete flow and states
  that `aimeat_task_complete` is the final action satisfying both the
  `complete_test_task` onboarding step AND any
  "task status is completed" TODO verification.

Net effect: new skill bundles generated by `aimeat connect add` will
ship the corrected persona. Existing connectors do not need to
regenerate -- the bundle is regenerated on next `aimeat connect add`
or when the agent is re-onboarded.

## aimeat-crewai 0.3.5 - 2026-05-29

Persona update to match AIMEAT 1.14.5's task revision lifecycle. No API
changes; drop-in replacement for 0.3.4.

### Changed

- `SLIM_BACKSTORY_TEMPLATE` and `FULL_BACKSTORY_TEMPLATE` updated with
  a new "When a task comes back in status 'revision_requested'"
  section. The lifecycle is now documented as
  `propose -> (revise if asked) -> wait-for-active -> mark-todos-done
  -> task_complete`. The persona instructs the liaison to read the
  linked inbox message (or the latest `revision_requested` task
  event) and call `aimeat_task_propose_todos` again with the revised
  plan, trusting the success response.

## aimeat-crewai 0.3.4 - 2026-05-29

End-to-end fixes from the 2026-05-29 crewfive `research-crew` daemon
field test. Pairs with AIMEAT 1.14.4.

### Fixed

- **CrewAI tool result caching defeats time-varying AIMEAT tools (A1).**
  `_strip_none_kwargs` in `liaison.py` now also disables CrewAI's
  default `cache_function` on every wrapped AIMEAT tool. CrewAI caches
  every tool result by `(tool_name, args)` and returns the cached
  output on repeat calls -- correct for pure calculators, catastrophic
  for `aimeat_onboarding_status` / `aimeat_task_list` /
  `aimeat_memory_list` / `aimeat_message_inbox`, all of which return
  different data on identical args as the world progresses. Before the
  fix the liaison would call `aimeat_onboarding_status`, see "all
  pending", mark a step passed server-side, call status again, get
  the CACHED "all pending" back, and loop until `Maximum iterations
  reached`. Write tools (`aimeat_memory_write`, `aimeat_task_complete`,
  `aimeat_*_set`) were also being cached, so a second identical write
  silently became a no-op. Cache is now off for every AIMEAT tool.

### Added

- **`llm` parameter on `run_crew_daemon` (A2).** The daemon previously
  built the liaison with no `llm`, so CrewAI fell back to its default
  OpenAI native provider and crashed the finalize step with
  `OPENAI_API_KEY is required` on every non-OpenAI runtime. The
  parameter forwards directly to `create_liaison_agent(llm=...)`. Pass
  e.g. `crewai.LLM(model="openrouter/...", api_key=...)` to use any
  non-OpenAI provider. Backward-compatible: omitting `llm` keeps
  CrewAI's default resolution (still useful when OPENAI_API_KEY is
  set or the runtime is fully native-OpenAI).

### Changed

- **Two-phase poll loop with idempotency tracking (A3).** The daemon
  now respects AIMEAT's task lifecycle `queued -> active -> done`
  explicitly. Per poll cycle:
    PROPOSE: pick up `status=queued` tasks the daemon has not yet
      proposed, run the propose-phase crew (default: liaison-only crew
      that calls `aimeat_task_propose_todos` once and stops).
    EXECUTE: pick up `status=active` (and `stalled`) tasks the daemon
      has not yet completed, run the caller's `build_crew` for the
      real work.
  Tracked via process-local `proposed_ids` and `done_ids` sets so a
  single task is never re-proposed or re-executed within one daemon
  lifetime. For `task-runner` mode agents (see AIMEAT 1.14.4 C3),
  AIMEAT auto-activates tasks on create, so the PROPOSE phase still
  runs (idempotent propose of todos) and EXECUTE picks up the same
  task in the same cycle or the next one -- no owner approval
  required. For `interactive` mode agents PROPOSE proposes a plan and
  waits for owner approval to flip the task to `active` before
  EXECUTE runs.
- **New optional `build_propose_crew` callback.** Override the default
  propose-phase crew if you want a richer plan (e.g. domain agents
  running in "plan only" mode instead of just the liaison).
- **Removed `_mark_task_active` self-start call.** Agents are no
  longer permitted to self-start tasks (C3 owner-approval gate); the
  daemon now waits for the gate to flip the task to `active`
  externally (owner approval or task-runner auto-activation).
- **`examples/crew_daemon.py` documents the new lifecycle.** The
  liaison's final task now reads the current task with
  `aimeat_task_get`, marks each propose-phase TODO done with
  `aimeat_task_todo`, writes the deliverable to memory, then calls
  `aimeat_task_complete` once. Matches the positive-framework persona
  shipped in 0.3.3.

## aimeat-crewai 0.3.3 - 2026-05-29

### Changed (liaison persona — positive-framework rewrite)

Companion change to AIMEAT 1.14.3. The daemon's liaison agent uses
the package's `SLIM_BACKSTORY_TEMPLATE` or `FULL_BACKSTORY_TEMPLATE`
(when the skill bundle is or is not loaded as a CrewAI Skill,
respectively), so the negation-heavy phrasing was duplicated in the
Python package and needed the same rewrite.

- `DEFAULT_GOAL`: scope statement rephrased from "Do NOT do the
  crew's domain work" to "Your scope is AIMEAT coordination -- the
  other crew members handle the domain work."
- `SLIM_BACKSTORY_TEMPLATE` and `FULL_BACKSTORY_TEMPLATE`:
  "Trust every success response" now explicitly covers
  `aimeat_onboarding_*`, `aimeat_task_*`, AND `aimeat_memory_*`. All
  "Do NOT" / "Never" patterns replaced with positive phrasing.
  Added explicit 3-step task-lifecycle section
  (propose_todos -> mark-todos-done -> task_complete) so the LLM has
  one canonical recipe for finishing the onboarding test task and
  any future tasks.

No API changes. Drop-in replacement for 0.3.2.

## [1.14.2] - 2026-05-29

### Fixed (MCP public/connector parity)

Closed pre-existing drift between public MCP (/v1/mcp) and connector MCP
(aimeat connect serve). The audit script pnpm audit:mcp-tools is now
required-pre-commit per the MCP Tool Unification Plan
(aimeat/docs/plans/2026-05-28-mcp-tool-unification-plan.md):

- aimeat_agents_list — added to public MCP (was connector-only since 6043fdc)
- aimeat_task_create — added to public MCP (was connector-only since 1.14.0)
- aimeat_agent_mode_set — added to public MCP (was connector-only since 1.12.1)
- aimeat_agent_tags_set — added to public MCP (was connector-only since 1.12.1)

After 1.14.2 the audit reports zero drift across all surfaces
(audit-mcp-tools, exit 0). aimeat_admin_mint remains intentionally
server-only (operator-gated administration).

Net effect: Claude Desktop and other public-MCP clients now have parity
with what aimeat-crewai liaisons see via the local connector.

## aimeat-crewai 0.3.2 - 2026-05-29

### Added

- **`tool_filter` parameter on `run_crew_daemon`** with a curated default. 0.3.0/0.3.1 loaded all ~95 AIMEAT MCP tools into the daemon's liaison, which is too much schema for many LLM adapters (litellm + smaller models choke on the full package; field test showed liaison crashing in the daemon's finalize phase). 0.3.2 defaults to `DAEMON_DEFAULT_TOOL_FILTER` (~25 tools) covering Hello Integration, capability reporting, task lifecycle (read/create/propose/update/complete/fail), memory + knowledge deliverables, telemetry, and messages. Wallet, admin, consent, cortex, extension, organism, board, app, and group tools are excluded -- a default liaison doesn't need them.
- `DAEMON_DEFAULT_TOOL_FILTER` exported from `aimeat_crewai` for inspection. Pass `tool_filter=DAEMON_DEFAULT_TOOL_FILTER + ("aimeat_extra_tool",)` to extend, or `tool_filter=["only-these"]` to override entirely, or `tool_filter=None` to disable filtering and load the full ~95-tool set.

### Changed

- `examples/crew_daemon.py` documents the default + override semantics with an inline comment.
- Added a regression test verifying the default list size + presence of essential liaison tools + absence of wallet/admin/etc.

## aimeat-crewai 0.3.1 - 2026-05-29

### Fixed

- **`run_crew_daemon` crashed immediately on startup with `AimeatLiaisonError: No token at ~/.aimeat/<agent>/.token`.** The 0.3.0 `_read_token()` helper assumed tokens were stored in the skill-bundle directory (`~/.aimeat/<agent>/.token`), but the connector (`aimeat connect add` >= 1.10.0) uses a keychain layout: tokens at `~/.aimeat/tokens/<agent>@<owner>.token` and per-agent config at `~/.aimeat/agents/<agent>/config.yaml`. The daemon path therefore never worked on a real connector install; the one-shot `create_liaison_agent` path was unaffected because `stdio_params` delegates to the connector which reads the keychain itself.
- Rewrote `_read_token(agent_name, owner=None)` to use the correct layout: globs `~/.aimeat/tokens/<agent>@*.token` when `owner` is omitted, errors clearly when zero or multiple owners match, reads `node_url` from `~/.aimeat/agents/<agent>/config.yaml`.
- `run_crew_daemon` gained an optional `owner` kwarg, threaded through to `_read_token`. Single-owner installs can omit it; multi-owner installs pass it to disambiguate.
- Added regression tests covering correct keychain layout, owner auto-detect, ambiguous-owner error, and missing-token error.

## [1.14.0] - 2026-05-29

### Added (the missing piece for cross-agent task delegation)

- **`aimeat_task_create` MCP tool** + same-owner authorization on `POST /v1/agents/:name/tasks`. The REST endpoint was previously owner-JWT-only, which meant a CrewAI-Claude or Hermes-like agent could not queue work for a same-owner crew (like `demo-crew`) without the human owner being in the loop. Now any agent JWT is accepted **provided the calling agent's owner === the target agent's owner**. This unblocks the canonical AIMEAT story: "owner sits in Claude Desktop → asks for research → Claude Desktop calls `aimeat_task_create` for demo-crew → demo-crew's daemon picks it up → result lands in AIMEAT memory under the owner's account". The created task's `ownerGaii` is always the OWNER's GHII regardless of which agent queued it, so the task surfaces in the owner's dashboard exactly the same way.
- **Tool registered in 3 surfaces:** MCP `aimeat_task_create` (via `agent-tasks.ts`), CLI fallback via `aimeat connect call aimeat_task_create`, and central catalog `mcp/catalog/definitions.ts`. Annotated as non-read-only, non-destructive, non-idempotent, closed-world.
- **Profile -> Agents -> "Connect a CrewAI crew" paste prompt** updated to mention the new `aimeat_task_create` MCP tool as one of the three ways to queue work for a daemon-mode crew (alongside the browser and direct REST). The paste also gained Step 4b (`run_crew_daemon`) explaining the daemon pattern alongside the one-shot Step 4a.

### Why this matters

Before this, AIMEAT's MCP surface could **read** the entire task lifecycle but could not **create** tasks. The only way to queue work was the browser or a hand-crafted REST call with an owner token. That meant the canonical "Claude Desktop orchestrates a CrewAI crew" flow was technically impossible -- the bridge agent had no way to actually delegate. 1.14.0 closes that gap. Setup AI (Claude Code, Codex, etc.) can now wire up a crew daemon, and the operator's Claude Desktop can drive it via MCP from then on.

## aimeat-crewai 0.3.0 - 2026-05-29

### Added

- **`run_crew_daemon`** — long-running supervisor that keeps the liaison alive and polls AIMEAT for queued tasks (and optionally inbox messages). For each arrival, calls a user-supplied `build_crew(task, liaison)` callback, runs the resulting Crew, and lets the liaison report results back via its tools. This is what turns a CrewAI crew from "a one-shot script you `python crew_runner.py` manually" into "a reachable agent that picks up tasks from across the AIMEAT network". Requires AIMEAT 1.14.0+ on the node side for `aimeat_task_create` to be available to remote callers.
- Signal handling: SIGINT/SIGTERM trigger clean shutdown with the liaison's MCP connection properly closed.
- Error containment: poll-cycle exceptions are logged and surfaced via the optional `on_error` callback, but do not crash the daemon -- it stays alive so the OS-level supervisor's crash-loop detector doesn't get spurious restarts. Tasks that crash mid-run are explicitly marked `failed` on AIMEAT so they don't stay stuck.
- Optional `one_shot=True` for testing without a long-running process.

### Added examples

- **`examples/crew_daemon.py`** — runnable starter for a 3-agent crew (Researcher + Writer + Liaison) wrapped in `run_crew_daemon`. Polls AIMEAT every 30s for queued tasks, builds the crew on demand, writes deliverables to `deliverables.<agent>.<task_id>` memory key, marks the task complete.
- **`examples/watchdog.sh`** (Bash) and **`examples/watchdog.ps1`** (PowerShell) — supervisor wrappers with crash-loop protection (default: gives up after 5 fast crashes in <30s each, exponential backoff between restarts). For production prefer systemd / launchd / pm2; the examples are for local dev and as a reference for what supervisor semantics should look like.

### Changed

- **`requests` added to dependencies** (used by daemon to poll the REST API directly without going through MCP for the polling path).
- **README and examples README rewritten** to position `run_crew_daemon` as the recommended pattern and `create_liaison_agent` as the "one-shot test" pattern.

## [1.13.7] - 2026-05-29

### Fixed (profile "Connect a CrewAI crew" paste taught the wrong pattern)

The profile -> Agents -> "Connect a task-runner agent" collapsible was rewritten to teach the **Liaison Agent pattern** (the `aimeat-crewai` Python package + `create_liaison_agent` factory + drop-in CrewAI Agent member). Previously it taught the older subprocess-based task-runner pattern (config.yaml `runner:` block + `connect serve` spawns subprocess). For LLM-driven crews (CrewAI, LangGraph, AutoGen) the subprocess pattern needs an LLM to drive Hello Integration but the subprocess HAS no LLM -- so the paste promised steps the runtime literally could not execute, and the test-task pair never completed. Users got stuck mid-onboarding with no diagnostic path.

The rewritten paste now mirrors `docs/integrations/crewai.md`: 4 steps total -- `connect add`, `pip install aimeat-crewai`, drop the liaison into the crew, run. No config.yaml editing, no separate `aimeat connect serve`, no subprocess. The liaison's persona + the AIMEAT skill bundle handle every Hello Integration step automatically via MCP tool calls.

The subprocess task-runner pattern is preserved in code (still works for LLM-less workers like cron-style ETL scripts) but no longer the recommended path in the profile UI. Docs cross-link it from the integrations page for the rare cases that need it.

i18n keys `profile.agents.taskRunner.{title,whatIs,whenToUse,exampleDesc,copyButton}` updated in both `en.json` and `fi.json` to reflect the new framing ("Connect a CrewAI crew (Liaison Agent pattern)").

## [1.13.6] - 2026-05-29

### Fixed (skill bundle SKILL.md body lacked exact onboarding values)

When CrewAI Claude's 0.2.1 verification ran the slim-persona flow against the full skill bundle, the LLM got the mechanics right (skill bound, persona slim, MCP calls clean) but two onboarding steps did not advance because the SKILL.md body left two values implicit:

- **`identify_platform` / `confirm_skill_installed`**: the LLM read `aimeat_runtime: generic` from the frontmatter metadata and passed `platform="generic"` to the onboarding tools. The server's step validator expects the actual RUNTIME name (`crewai`, `langgraph`, `hermes`, `claude`...) -- "generic" is the AIMEAT skill-bundle ADAPTER name, not a runtime. The body never said this, so the LLM made the wrong inference.
- **`publish_config`**: the LLM wrote memory key `agents.config.runtime` (no agent-name segment). The validator checks for `agents.config.<agent_name>.runtime` specifically. The slim persona didn't carry this and the body's "After Onboarding" section used a generic `agents.config.<name>` placeholder that the LLM didn't substitute correctly.
- **Retry spiral on eventual consistency**: the LLM saw a step still as `pending` in `aimeat_onboarding_status` after the POST returned success and re-ran the step, doubling tool calls. The body had no instruction to trust the per-step response.

1.13.6 adds an explicit **Hello Integration -- exact parameter values** section to the bundle body of both `generic-adapter` and `hermes-adapter`. It states the platform-name rule plainly (use your runtime name, NOT "generic"), the publish_config key with the agent name pre-substituted (`agents.config.<actual_agent_name>.runtime`), and a calling-conventions block that includes "trust per-step API responses; do not re-call onboarding_status to confirm" plus the same `agent_name` / null-omission / STEP_NOT_IN_FLOW guidance the Python liaison carries.

The body is now precise enough that an LLM-only onboarding run (no out-of-band Python persona) reaches 7/7 completion without retry spirals.

## aimeat-crewai 0.2.2 - 2026-05-29

### Changed

- **SLIM_BACKSTORY_TEMPLATE expanded** with the same precision guidance the AIMEAT 1.13.6 SKILL.md body added (use `platform="crewai"` not `"generic"`, full `agents.config.<agent_name>.runtime` memory key, trust per-step API responses). Belt-and-suspenders: the bundle already carries the canonical version, but mirroring it in the slim persona means the LLM sees the same exact values whether it reads the persona or activates the skill.

## aimeat-crewai 0.2.1 - 2026-05-29

### Fixed

- **`agent.skills` was None despite a valid skill bundle on disk.** 0.2.0 passed the bundle directory as a string: `agent_args["skills"] = [str(resolved_skill_path)]`. CrewAI's `Agent` constructor interprets a string skills entry as a **discovery parent** -- it scans the directory for `*/SKILL.md` subdirectories. Our bundle has `SKILL.md` AT the directory root (the per-agent dir IS the skill), so the discovery scan finds nothing and the agent ends up with `skills=None`. The agent then runs on the SLIM persona without the Skill behind it -- LESS context than 0.1.x because we trimmed the manual out of the persona expecting it to come from the Skill.
- Fix: pre-load the bundle into a Skill object via `crewai.skills.parser.load_skill_metadata(path)` and pass that. Verified by CrewAI Claude with the same fix applied locally -- `Agent.skills` now contains the loaded skill (`['<agent_name>']`) and the LLM reads it through CrewAI's normal Skills mechanism.
- Import of `load_skill_metadata` is lazy (inside the if-skill_path-block) so the package still loads cleanly on CrewAI versions that don't have Skills support. Those callers should pass `skill_path=None` to skip the Skill path entirely and fall back to the FULL persona.

## aimeat-crewai 0.2.0 - 2026-05-29

### Added (CrewAI Skills support)

- **The liaison now loads the AIMEAT skill bundle as a first-class CrewAI Skill.** Auto-detect path: `~/.aimeat/<agent_name>/SKILL.md` (the same location the connector extracts the bundle into). When found, the factory passes `skills=[<bundle_dir>]` to `crewai.Agent`, so the LLM sees the bundle through CrewAI's progressive-disclosure mechanism: description first, body on demand. The bundle is the canonical operational manual; the Python package no longer duplicates it.
- **New `skill_path` parameter on `create_liaison_agent`:**
  - Default (`_AUTO_DETECT`): look in `$AIMEAT_HOME/<agent_name>/` (defaults to `~/.aimeat`)
  - Explicit `Path` or `str`: use that directory; raises `AimeatLiaisonError` if no SKILL.md found
  - `None`: explicitly disable skill loading (use the full persona as the manual)
- **Two-mode persona template:** when a skill bundle is loaded, the factory uses `SLIM_BACKSTORY_TEMPLATE` (~30 lines: identity + calling conventions + "consult the Skill for details"). When no bundle is loaded, the factory uses `FULL_BACKSTORY_TEMPLATE` (~60 lines: the previous 0.1.x manual carried in the persona). Both expose `{agent_name}` as a format placeholder; the factory chooses automatically based on whether `skill_path` resolved to a real file.
- **`_resolve_skill_path(agent_name)` helper exported from `liaison`** for testing and custom integrations.

### Changed

- **`DEFAULT_BACKSTORY_TEMPLATE` retained as an alias for `FULL_BACKSTORY_TEMPLATE`** so 0.1.x code that imported it still works. New code should let the factory choose, or import `SLIM_*` / `FULL_*` directly.
- **README compatibility table updated:** 0.2.x requires AIMEAT 1.13.5+ (for CrewAI-strict frontmatter on skill bundles) and CrewAI 1.14+ for native Skills support. If you can't bump CrewAI, pass `skill_path=None` and you get 0.1.x behavior.

### Why this matters

The AIMEAT skill bundle is now the single source of truth for "how do I operate against an AIMEAT node from a CrewAI crew". Bundle updates flow through `aimeat connect refresh --agent <name>` (also fixed in 1.13.5 to actually honour `--agent`) without requiring a `pip install -U`. Same pattern will port to LangGraph and AutoGen in `aimeat-langgraph` / `aimeat-autogen` packages.

## [1.13.5] - 2026-05-29

### Fixed

- **`metadata.tags` is now a comma-separated string, not a YAML list.** CrewAI's `SkillFrontmatter` declares `metadata` as `dict[str, str]` and rejects any value that isn't a string -- so `tags: [aimeat, agent-orchestration, mcp]` failed validation with `Input should be a valid string`. 1.13.5 emits `tags: "aimeat, agent-orchestration, mcp"` instead. This was the last frontmatter blocker for `aimeat-crewai 0.2.0`. Confirmed by CrewAI Claude's verification: locally patching this single character made `load_skill_metadata` succeed and `discover_skills()` return a usable Skill.
- **`aimeat connect refresh --agent <name>` silently routed through the primary agent regardless of `--agent`.** Same bug shape as the `runToolCall` issue fixed in 1.13.1, but on the refresh command. In multi-agent installs, `aimeat connect refresh --agent demo-crew` re-downloaded the PRIMARY agent's bundle and overwrote it into the primary's directory, never touching demo-crew. Net effect: per-agent bundle updates didn't happen, so post-1.13.x server upgrades didn't propagate to all locally-registered agents without a workaround (re-`connect add`). Now uses `loadAgentByName(flags.agent, flags.owner)` so the per-agent token + node URL + agent name flow through correctly. Without `--agent`, behavior is unchanged.

### Operator note

If you have agents registered on a pre-1.13.5 connector with frontmatter that contains `tags: [...]` (list), one of two things will happen with CrewAI: (a) `load_skill_metadata` will reject the skill silently and `discover_skills()` will skip it, or (b) older CrewAI versions may accept the list and stringify it badly. After upgrading both the connector AND the AIMEAT node to 1.13.5+, run `aimeat connect refresh --agent <name>` for each agent to re-download with the fixed frontmatter.

## [1.13.4] - 2026-05-29

### Fixed (SKILL.md frontmatter rejected by CrewAI's strict validator)

CrewAI Claude's first end-to-end Skills test against 1.13.3's bundles revealed two CrewAI-strict-validator violations:

- **Directory name must equal frontmatter `name`.** 1.13.3 set `name: aimeat-agent` for every agent, but the bundle is extracted into `~/.aimeat/agents/<agent_name>/`. CrewAI's `load_skill_metadata` rejected it with `Directory name 'falcon' does not match skill name 'aimeat-agent'`. 1.13.4 sets `name: <agent_name>` so each agent's bundle is its own CrewAI Skill (e.g. a `demo-crew` Skill, a `company-crew` Skill). Crews with multiple AIMEAT identities get distinct skill namespaces, which is the correct semantics.
- **`trigger` and `tags` are not CrewAI-recognised top-level frontmatter keys.** CrewAI's `SkillFrontmatter` recognises `name` (required), `description` (required), `license`, `compatibility`, `metadata: dict`, `allowed_tools: list`. It ignored `trigger` and `tags` silently in 1.13.3, but they were also lost from the loaded Skill object's introspectable surface. 1.13.4 moves them into `metadata: {...}` so they survive into the loaded Skill while remaining present in the raw markdown for non-CrewAI consumers (LLMs reading SKILL.md directly).
- **Added richer `metadata`** alongside `trigger` / `tags`: `aimeat_node_id`, `aimeat_node_url`, `aimeat_agent_gaii`, `aimeat_runtime`. Lets a CrewAI-driven LLM (or any other Skills consumer) inspect which AIMEAT node / agent / runtime a Skill represents without re-parsing the markdown body.

Both `generic-adapter` and `hermes-adapter` updated to the same shape. Bundle body below the frontmatter is unchanged.

### Operator note

Existing bundles cached in `~/.aimeat/agents/*/SKILL.md` from pre-1.13.4 nodes will not auto-update without an explicit `aimeat connect refresh --agent <name>` against an upgraded node. If `discover_skills()` returns `found: 0`, check that (a) the node is on 1.13.4+, (b) `aimeat connect refresh` has been run, and (c) `discover_skills()` is pointed at `~/.aimeat/agents` (the parent of per-agent directories) rather than `~/.aimeat` (which only contains the global config, no SKILL.md at its top level).

## [1.13.3] - 2026-05-29

### Changed (skill bundle SKILL.md frontmatter)

- **`generic-adapter` SKILL.md now ships Anthropic Agent-Skill style YAML frontmatter** (`name`, `description`, `trigger`, `tags`) at the top of the file. Previously it started directly with the `# AIMEAT Agent Integration` heading and was just free-form markdown. The frontmatter lets frameworks that natively auto-discover skills register the bundle as a first-class skill instead of reading it as opaque text -- specifically CrewAI >= 1.14's `discover_skills()` (and `Agent(skills=[path])`), Anthropic's own Claude Agent Skills, and future LangGraph/AutoGen adapters that adopt the same convention. The bundle body below the frontmatter is unchanged, so existing LLM-driven flows that parse the body as text continue to work. `aimeat-hermes` adapter already shipped with frontmatter since v1.0; this brings the generic (CrewAI / LangGraph / AutoGen / generic MCP) adapter to parity.
- **`hermes-adapter` SKILL.md frontmatter expanded** with a fuller `description`, the same standardised `trigger`, and a `tags` block (`aimeat`, `agent-orchestration`, `mcp`, `hermes`). The old shorter form ("AIMEAT node integration for {nodeId}") was too terse for token-aware skill discovery -- LLMs read the description before deciding to activate the skill, so describing what activation enables matters.

### Why this matters

The next architectural step on the CrewAI integration side is `aimeat-crewai 0.2.0`, which will load the AIMEAT skill bundle as a CrewAI Skill (`Agent(skills=[skill_path])`) instead of carrying the entire operational manual inside the Python package's persona template. With this change in place, the bundle that AIMEAT already distributes IS the canonical operational manual -- the Python package shrinks to just identity + calling-conventions, and skill updates flow naturally through `aimeat connect refresh` without requiring a `pip install -U`.

## aimeat-crewai 0.1.2 - 2026-05-29

### Fixed

- **Optional MCP parameters leaked through as JSON `null`.** Persona instructions to "omit instead of null" were ignored not by the LLM but by the layer below it: `crewai-tools` / `mcpadapt` builds a Pydantic args model for each MCP tool, fills missing optional fields with `None`, and serialises to JSON where `None` becomes `null`. AIMEAT server-side zod `.optional()` then rejected those calls with "expected string, received null". 0.1.2 wraps each tool's `_run` to filter kwargs where the value is `None` before forwarding to the MCP transport, so the request payload omits the field entirely (which `.optional()` accepts). Fixes were observed in `aimeat_memory_write` (tags/ttl_hours/group_id), `aimeat_handbook_get` (module), and any other tool with optional params.
- Internal helper `_strip_none_kwargs(tool)` applied to every tool returned by both `create_liaison_agent` and `liaison_tools`. Persona's earlier "omit instead of null" guidance stays in place as a redundancy.

## [1.13.2] - 2026-05-29

### Fixed (stalled task recovery)

- **Tasks that were marked `stalled` by the stall detector had no recovery path: `aimeat_task_complete`, `aimeat_task_event`, `aimeat_task_todo`, and `aimeat_task_fail` all returned `INVALID_STATE` ("Only active tasks can be ...").** The stall detector was originally designed as a one-way signal -- once stalled, the task was effectively orphaned. In practice this hits during normal onboarding flow whenever an agent's subprocess briefly crashes, the operator kills it to fix something, or there's a network glitch: the onboarding test task gets stalled, the agent restarts, the agent has the correct deliverable -- and AIMEAT refuses to accept it. Now all four endpoints handle stalled tasks gracefully:
  - `POST /v1/agents/:name/tasks/:id/event` -- if the task is stalled when an event arrives, the task is auto-resumed (`stalled` → `active`) and a `started` event is appended ("Task auto-resumed from stalled"). The original event is then appended normally. Rationale: an event from the agent IS evidence that the agent is back.
  - `PATCH /v1/agents/:name/tasks/:id/todos/:todoId` -- same auto-resume semantics.
  - `POST /v1/agents/:name/tasks/:id/complete` -- accepts `stalled` directly without requiring re-activation. A late deliverable is more useful than rejecting it.
  - `POST /v1/agents/:name/tasks/:id/fail` -- accepts `stalled` so the agent can explicitly mark the task failed instead of leaving it lingering.
  - `POST /v1/agents/:name/tasks/:id/start` (owner-only) -- `queued | paused | stalled` → `active`, so the owner has an explicit re-start path too.
- The stall detector itself is unchanged: it still marks quiet active tasks as stalled. What changed is that stalled is now a recoverable state.

## [1.13.1] - 2026-05-29

### Fixed (multi-agent `aimeat connect serve` routing)

- **`aimeat_memory_*`, `aimeat_handbook_get`, `aimeat_storage_*`, `aimeat_wallet_balance`, `aimeat_action_execute`, `aimeat_work_*`, `aimeat_catalogue_search`, `aimeat_agent_profile`, `aimeat_board_*`, `aimeat_admin_*` all silently routed through the connector's primary-agent token regardless of which `agent_name` the caller passed.** The pattern from `core.ts` and `handbook.ts` was `const { client } = registry.resolve()` at MODULE scope -- once -- which captured a single client and reused it across every tool call. So in a multi-agent install (e.g. one user has `assistant`, `falcon`, `hermes`, `company-crew` all locally), a CrewAI liaison agent calling `aimeat_memory_write --agent company-crew "..."` would write to whoever the connector picked as primary at startup (often `falcon` or `assistant`, NOT `company-crew`), and worse: if the primary's token didn't have valid scopes on the target node, the result was `AUTH_REQUIRED` -- baffling because the same connection's onboarding tools worked fine (those used per-call `pickAgent()`). Fix: every tool in `core.ts` and `handbook.ts` now accepts an `agent_name` parameter and calls `pickAgent(registry, agent_name)` PER CALL. Single-agent installs are unaffected: `agent_name` is optional and defaults to the only loaded agent.
- **Note:** This patch covers the 17 tools that CrewAI liaison agents typically reach for (memory CRUD, handbook, storage, wallet, work queue, catalogue, agent profile, boards, admin). The remaining 15 tool files (apps, capabilities, cortex, extensions, flags, groups, instances, knowledge, organisms, etc.) still use module-scope client resolution and will be migrated in 1.14.0. They affect fewer typical liaison flows so the patch is staged rather than blocked on a full sweep.

### Changed (onboarding error semantics)

- **`POST /v1/agents/:name/onboarding/step/:id`** now distinguishes two failure modes that previously both returned `INVALID_STEP`: (a) the step ID is not in the canonical step catalog at all -- still `INVALID_STEP` (typo / bad request), and (b) the step ID IS canonical but is not part of THIS agent's onboarding flow (task-runner mode skips interactive-only steps like `read_directives`) -- now `STEP_NOT_IN_FLOW`. The error message explicitly tells LLM-driven liaison agents to treat the second case as "no-op, skip and continue" rather than retrying. The `aimeat-crewai 0.1.1` persona reads this and handles it gracefully; the canonical interactive-mode `INVALID_STEP` behaviour is unchanged.

### Related work in `aimeat-crewai` 0.1.1

The above server-side fixes pair with `aimeat-crewai 0.1.1` (published the same day) which (a) fixes the Windows `.cmd` shim crash in `stdio_params`, (b) injects the agent_name into the liaison persona so the LLM stops guessing it, and (c) tells the liaison to OMIT optional MCP parameters instead of passing null (which the MCP schema rejected). Together these resolve the four blockers observed in the first end-to-end CrewAI field test against aimeat.io. See `python/aimeat-crewai/CHANGELOG`-section above (independent versioning).

## aimeat-crewai 0.1.1 - 2026-05-29

(Independent versioning for the Python package; see `python/aimeat-crewai/`.)

### Fixed

- **Windows `stdio_params` crashed with WinError 193.** `aimeat` on Windows is an npm-installed `.cmd` shim that `CreateProcess` (used by the stdio MCP client) cannot execute directly. `stdio_params()` now detects Windows + `.cmd`/`.bat` shims on PATH and auto-wraps the invocation via `cmd.exe /c <command>`. No-op on Linux/Mac. No-op when the user passed an absolute path to a real `.exe`. Internal helper: `_resolve_windows_command()`.
- **Liaison persona did not know its own agent name** → the LLM guessed (`"assistant"`, `"crewai"`, the CrewAI role name) and wasted retries on AIMEAT tools that take an `agent_name` parameter. `create_liaison_agent()` now accepts an `agent_name=` keyword that gets injected verbatim into the persona's `backstory`. When omitted, the factory tries to extract it from the `--agent` flag in `stdio_params()` automatically. HTTP/SSE transport users must pass `agent_name` explicitly because there's no `--agent` flag to read.
- **Persona did not tell the LLM how to handle optional MCP parameters.** Added explicit calling-conventions section: "for OPTIONAL parameters, OMIT them entirely instead of passing null. MCP schema validation rejects explicit null." Also covered: enum params, AUTH_REQUIRED handling, INVALID_STEP handling (so the liaison gracefully skips steps that don't exist in reduced task-runner onboarding flow).

### Changed

- **`DEFAULT_BACKSTORY` → `DEFAULT_BACKSTORY_TEMPLATE`.** The template contains a `{agent_name}` placeholder that the factory formats. The old `DEFAULT_BACKSTORY` constant is kept as a backwards-compat alias that resolves the placeholder to a generic string.
- **Persona now mentions** the 3 calling conventions before the responsibilities list -- LLMs read top-of-prompt content more reliably than buried mid-text instructions.

## [1.13.0] - 2026-05-29

### Changed (task-runner Hello Integration)

- **Task-runner reduced flow is now 7 steps, not 5. `accept_test_task` and `complete_test_task` are kept.** The original 1.12.0 rationale ("task-runners have no interactive surface, skip the test task") was wrong on inspection: a task-runner agent's ENTIRE purpose is to execute queued tasks. The onboarding test task is the natural, server-driven smoke test that proves the operator's `runner:` block in `config.yaml` is wired correctly, the subprocess starts, and stdout round-trips back as the deliverable. Onboarding now does not flip to `completed` until the agent's subprocess has actually executed a real task end-to-end. The previously documented "Step 4 smoke test" disappears as a manual step -- it is built into onboarding. New skipped set for task-runner: `send_test_message`, `configure_delivery`, `report_telemetry`, `publish_commands`, `declare_services`, `read_directives` (the truly interactive-only steps).

### Changed (paste prompt + CLI hint)

- **Profile -> Agents -> "Connect a task-runner agent" paste rewritten.** Step 4 (manual smoke test through the browser) is removed. Verification at the end now lists the expected 7-step progression and explains that `complete_test_task` staying pending after `accept_test_task` passes is the canonical "your subprocess didn't run" signal -- with the actual diagnostic command (`aimeat_task_list`) to inspect the server-side task state.
- **`aimeat connect add --mode task-runner`** post-auth hint now says "reduced 7-step flow (the test-task pair is kept so onboarding doubles as a smoke test for your subprocess)" instead of the misleading "5-step".

### Updated tests

- **`e2e-agent-onboarding` test 40** asserts exactly 7 steps for task-runner (was 5), and verifies the expected ID set includes `accept_test_task` + `complete_test_task`.
- **Test 41** renamed from "auto-completes when all 5 steps pass" to "non-test-task steps pass; test-task pair stays pending until subprocess runs" -- it now asserts the 5 non-test-task steps reach `passed`, the test-task pair stays `pending`, and overall onboarding stays `in_progress`. This is the correct shape: the E2E cannot simulate a real subprocess, and the new design is explicit that onboarding waits for a real task round-trip before flipping to `completed`. 44/44 onboarding tests passing on SQLite.

### Migration

- **Existing task-runner agents under 1.12.4 have only 5 onboarding steps.** They show `completed` once those 5 pass, which under the new shape would correspond to "5/7 done, subprocess never verified". The cleanest path is to delete + recreate the agent under 1.13.0 so onboarding adopts the new shape. Alternatively, leave them alone -- the onboarding record is immutable for completed agents and the new step list only affects newly-onboarded agents.

## [1.12.5] - 2026-05-29

### Fixed (documentation)

- **Profile -> Agents -> "Connect a task-runner agent" paste prompt Step 4 (smoke test) recommended a CLI call that cannot work.** The paste told the agent to invoke `aimeat_task_propose_todos --json '{"target_agent":"...","title":"Smoke test","prompt":"..."}'` to queue a test task. This was wrong on two counts: (1) `aimeat_task_propose_todos` is for adding TODOs to an EXISTING task (it requires `task_id`), not for creating new ones; the schema rejects `target_agent`, `title`, and `prompt` outright. (2) Task creation goes through `POST /v1/agents/:name/tasks` which requires the `owner` role, so even a correct create-tool would 403 from an agent token. The CLI fallback has no task-creation tool at all. Updated paste Step 4 to direct the operator to create the smoke task from the browser (Profile -> Agents -> expand card -> Tasks tab -> "+ New task"), which uses the owner's session JWT and works. The verification side (listing the completed task via `aimeat_task_list`) is still done from the agent's CLI session and is correct.

## [1.12.4] - 2026-05-29

### Fixed

- **CRITICAL: `--mode task-runner` was silently dropped during device-auth registration.** The mode field was added to `DeviceAuthorizationRecord` in 1.12.0 but the SQLite + MongoDB storage layers never persisted it. SQLite `createDeviceAuth` INSERT statement omitted the column; MongoDB `createDeviceAuth` omitted it from the Prisma `data` block; both `deserializeDeviceAuth` / `toDeviceAuthRecord` returned `mode: undefined` no matter what the route stored. Net effect: every `aimeat connect add --mode task-runner` request looked successful (server returned `ok: true`, agent got approved, token issued), but the verify-route's `request.mode` was `undefined`, so `createAgent` defaulted to `'interactive'` and `createDefaultSteps()` produced the full 13-step Hello Integration. Operators saw `INTERACTIVE` badges and 13-step onboarding for agents they had explicitly registered as `task-runner` -- the entire mode field was a no-op for device-auth registrations from 1.12.0 through 1.12.3. Fix: SQLite `device_auth` table gets a `mode` column via `safeAddColumn` migration (auto-applied on server start); MongoDB Prisma `DeviceAuth` model gets a `mode String?` field (run `prisma generate` + redeploy); both `createDeviceAuth` and the deserializers now round-trip the field. The owner-only `PATCH /v1/agents/:name/mode` route was unaffected and worked all along -- it just was not a viable single-call path because of the runToolCall agent-routing bug (also in 1.12.3).
- **Operator migration:** Any agent created with 1.12.0-1.12.3 and registered as `task-runner` is actually `interactive` on the server. The clean fix is to delete + recreate with 1.12.4. Alternatively, the owner can use the browser DevTools console workaround (`fetch('/v1/agents/<name>/mode', { method: 'PATCH', ... })` with their own owner JWT) to re-classify in place -- the storage layer reads/writes the agent table's `mode` column correctly (only the device-auth pathway was broken).

### Changed

- **`device_auth` table gains a `mode` column** (SQLite + MongoDB). Existing pending device-auth requests created before 1.12.4 default to `'interactive'`; if the operator wants a pending request to become task-runner, they should cancel + re-register.

## [1.12.3] - 2026-05-29

### Fixed

- **`aimeat connect call --agent <name>` silently routed through the primary agent.** `runToolCall` always loaded the global config (`loadConfig()`) and called `Client.fromConfig()` no matter what `--agent` was passed, then put `config.agent` in the REST URL. Net effect: in any multi-agent install, every `connect call --agent foo` ran as whichever agent `~/.aimeat/config.yaml` happened to point at (the primary). For users whose primary was a remote agent (e.g. `falcon@aimeat.io`) but who had local task-runner agents, every call returned the WRONG agent's data — `aimeat_onboarding_status --agent company-crew` returned falcon's completed 13-step onboarding, masking that company-crew's onboarding was actually fine. Fix: `runToolCall` now resolves `--agent` (and optional `--owner` disambiguator) via the new `loadAgentByName()` helper, builds an `AimeatClient` from that agent's stored token + per-agent `node_url`, and uses the right agent name in REST paths. Without `--agent`, behavior is unchanged (falls back to primary).
- **`aimeat connect list` showed `[interactive]` for agents registered with `--mode task-runner`.** The label only flipped to `[task-runner]` when the local config.yaml had a `runner:` block, ignoring the server-side `mode` field entirely. Now reads `pa.mode` from per-agent config (written by `connect add --mode`) first, falling back to `runner:` presence for agents predating the field. Also adds a `[missing runner: block]` warning next to task-runner agents whose subprocess command has not been configured yet — a frequent stuck point ("agent is registered but nothing happens when I queue a task").

### Changed

- **`AimeatPerAgentConfig.mode` field** added to `~/.aimeat/agents/<name>/config.yaml`. Written by `aimeat connect add --mode <mode>` so the connector knows what the server thinks this agent is, without an extra REST call. Independent of the `runner:` block (which configures the local subprocess); both are needed for a working task-runner.
- **`aimeat connect add --mode <mode>` is now idempotent on the local label.** If the agent already has a valid token, rerunning `connect add --mode task-runner` updates only the local `mode` field in per-agent config — no second device-auth round, no server-side change. Use this to retroactively label agents registered with 1.12.2's CLI (which set the server-side mode but did not persist a local label) so they show `[task-runner]` in `connect list`.

## [1.12.2] - 2026-05-29

### Fixed

- **Task-runner agents could not be created from the CLI without a manual owner-role REST call.** `aimeat connect add` registered every agent as `mode: interactive`, then required the owner to switch it to `task-runner` via `PATCH /v1/agents/:name/mode` (owner-only). But the connector only holds agent tokens, so `aimeat connect call aimeat_agent_mode_set` from the new agent's session returned `Role "owner" required`. The only path was DevTools console / curl, which was a workaround, not a flow. Fix: `aimeat connect [add] --mode <mode>` now propagates the mode all the way to `POST /v1/agents/device-authorize` so the agent is created with the right mode from the start -- the reduced 5-step Hello Integration kicks in immediately, no second call needed.

### Changed

- **Profile -> Agents -> "Connect a task-runner agent" paste prompt** rewritten to use `--mode task-runner` on `connect add` as Step 1, dropping the old broken Step 2 (`aimeat_agent_mode_set`). Steps renumbered 1-4 (was 1-5).
- **`aimeat connect --help`** updated: `connect add` now documents `--mode <mode>` with the four valid values and a note that `mode` alone does not configure the subprocess -- `~/.aimeat/agents/<name>/config.yaml` still needs a `runner:` block. Example invocation in the help text now shows `--mode task-runner`.

### Migration

If you registered a task-runner-style agent under 1.12.0 / 1.12.1 (it will show `INTERACTIVE` badge in Profile -> Agents and have 13 onboarding steps), the cleanest path is to delete + recreate it with `--mode task-runner`. The `PATCH /v1/agents/:name/mode` endpoint still exists for owner-driven re-classification of existing agents.

## [1.12.1] - 2026-05-29

### Fixed

- **`aimeat connect call aimeat_agent_mode_set` / `aimeat_agent_tags_set` returned `Unknown CLI-callable tool`** -- the two new owner-only tools added in 1.12.0 were defined in `cli/connect/tool-call.ts` (handler side) but not in the central `mcp/catalog/definitions.ts` registry, so `runToolCall` rejected them via the `getCliToolMetadata` check that requires `visibility.cliFallback === true`. They also showed up in zero `aimeat connect tools` listings. This blocked task-runner agents from being switched to `mode: task-runner` via the CLI fallback, leaving them stuck on the 13-step interactive Hello Integration. Catalog + annotation entries added; both tools now visible in `aimeat connect tools` and callable.

### Added (Profile UI)

- **"Connect a task-runner agent (CrewAI, custom workers)" collapsible** on Profile -> Agents -> + Connect agent. Includes a what-is/when-to-use explanation, a CrewAI-shaped example, an editable agent-name input that re-templates the paste live, and a "Copy task-runner instruction" button. The paste covers all 5 steps (connect add, `aimeat_agent_mode_set`, runner-block `config.yaml`, `connect serve`, smoke test) with the owner-handle and node URL pre-filled. Distinct from the generic interactive-agent prompt because task-runners never go through the 13-step flow.

## [1.12.0] - 2026-05-29

Headline: agents are now classified by **operational mode** and can carry
**owner-managed tags**. Mode picks the Hello Integration flow -- a
**task-runner** agent (CrewAI crew, triggered worker) gets a reduced
5-step onboarding instead of the full 13, because it has no interactive
command surface, never sends messages, and never runs a test task. Tags
drive a new filter bar + group-by selector on the Your Agents tab so a
fleet of 2-20 mixed agents stays navigable.

### Added

#### Agent Mode Classification (`autonomous` / `interactive` / `task-runner` / `coordinator`)
- **`AgentRecord.mode` field** -- new strict union persisted on every agent record. `autonomous` runs continuously (Hermes, OpenClaw). `interactive` (default) responds to user requests (Claude Code, Cursor, Cline). `task-runner` is triggered, runs one task, exits (CrewAI crews, Inngest-style workers). `coordinator` orchestrates other agents (Claude Desktop, LangGraph supervisor) and shares the interactive onboarding. SQLite gets a `mode TEXT DEFAULT 'interactive'` column via `safeAddColumn`; MongoDB gets `mode String?` on the Prisma `Agent` model. Existing agents fall back to `interactive` on read (they already completed the full flow).
- **Mode wired through registration + management** -- `POST /v1/agents/device-authorize`, legacy `POST /v1/agents`, and the new `PATCH /v1/agents/:name/mode` route (owner-only) all accept and validate against the closed `VALID_MODES` set. `AgentRegistrationSchema` enforces the enum at the zod layer. `GET /v1/agents` returns `mode` for every listed agent.
- **Mode-aware Hello Integration** -- `createDefaultSteps(mode)` in `agent-onboarding-schemas.ts` filters the 13-step canonical list down to 5 for `task-runner` (`authenticate`, `identify_platform`, `install_skill`, `report_capabilities`, `publish_config`). Omitted steps are absent from the record -- not pending, not skipped, just not there. `agent-onboarding.ts` switched array-indexed step access to `.find()` so missing steps no longer crash test-task creation; the test task is only created when `accept_test_task` exists.

#### Owner-Managed Tags Surfaced in UI (Your Agents tab)
- **Tag chip strip on every expanded agent card** -- `agent-card.js` renders `agent.tags` as small rounded chips above the capabilities row. Replaces the previous text-only "Shared tags: [x]" line in zone2.
- **Mode badge on every agent card** (collapsed + expanded) -- four distinct colors (violet / blue / orange / green) corresponding to autonomous / interactive / task-runner / coordinator. CSS classes `.pf-agd-badge--mode-*` defined in `agents-detail.css`.
- **Tag filter bar** -- multi-select chip row at the top of the agent list. Selecting multiple tags applies an AND filter (agent must carry all selected tags). A "Clear" link appears when any filter is active.
- **Group-by selector** with three options: `none` (flat list, default), `tag` (one section per tag with an "Untagged" catch-all), `mode` (one section per mode in canonical order). Filtering applies before grouping, so e.g. tag=`crew:marketing-001` + groupBy=mode shows the mode breakdown of just that crew.

#### MCP Tools (owner-only)
- **`aimeat_agent_tags_set`** -- replaces an agent's tag list (max 20). Wraps `PATCH /v1/agents/:name/tags`.
- **`aimeat_agent_mode_set`** -- sets an agent's operational mode. Wraps `PATCH /v1/agents/:name/mode`.
- Both registered in a new `mcp/tools/agent-management.ts` module + mirrored in the `aimeat connect call` shell-fallback tool list.

#### Documentation
- **`docs/coding-guidelines/agent-tags.md`** -- new file documenting the mode union, the recommended tag conventions (`crew:`, `source:`, `role:`, `project:`), how to set both via UI/MCP/REST, and the UI grouping behaviour. Closes with explicit "Don't" rules (don't gate scopes by tag, don't reuse mode for grouping things tags should handle).
- **`docs/coding-guidelines/architecture.md`** -- Identity Model section now includes the four-mode table and points to `agent-tags.md`.
- **README.md** -- Connect AI agents section now mentions modes, the reduced task-runner Hello Integration, and tag conventions.

#### E2E Coverage
- **4 new `e2e-agent-onboarding.ts` tests** -- create a `mode: 'task-runner'` agent, verify mode persists across reads, verify exactly 5 steps appear (with the correct IDs and the right omissions), and verify the onboarding auto-completes when all 5 task-runner steps pass. 44/44 passing on both SQLite and MongoDB.

### Changed

- **`AgentRegistrationSchema`** -- now accepts an optional `mode` enum field; rejects values outside the strict union.
- **`createDefaultSteps()`** -- signature changed from `()` to `(mode?: AgentMode)`. Callers in `agents.ts` and `agent-onboarding.ts` updated to pass the agent's mode.
- **`renderZone2()` production/idle path** -- no longer renders an inline `Shared tags: [x]` text line; tags are now rendered above the zone via the dedicated `renderTagStrip()` so they don't fight with the delivery/stats row.

### i18n
- **EN + FI updated together** -- new `profile.agents.mode.{autonomous,interactive,task-runner,coordinator,tooltip}` and `profile.agents.filter.{byTag,groupBy,groupByNone,groupByTag,groupByMode,clear,untagged,noMatches}` keys added to both `locales/en.json` and `locales/fi.json`.

## [1.11.0] - 2026-05-29

Headline: submission-ready for the **Anthropic Connectors Directory**. Every
registered MCP tool now carries the `title` + read-only/destructive/idempotent/open-world
annotations the directory requires. Privacy policy and `/v1/connect` attach
page are operator-configurable so every self-hosted AIMEAT node can identify
itself as the GDPR controller without forking the HTML. Default `/v1/privacy`
behaviour is **fail-loud (HTTP 503)** when the operator has not filled in the
required identity fields -- no AIMEAT node should ever silently ship the
upstream author's information.

### Added

#### Connectors Directory Submission Package
- **94-tool MCP annotation registry** -- new `aimeat/src/mcp/annotations.ts` exports `TOOL_ANNOTATIONS` (single source of truth) and `annotationsFor(name)` (throws on missing entry so new tools cannot ship without classification). Every `mcp.tool(...)` call across the 21 public server files and 21 local connector files now passes `annotationsFor(name)` as the 5th SDK argument (verified in `@modelcontextprotocol/sdk@1.27.1`). 0 unannotated tools confirmed by extended `pnpm audit:mcp-tools`. The directory's #1 rejection cause (~30% per public review-criteria analysis) is closed.
- **`audit:mcp-tools` script extension** -- the existing surface-parity audit now also reports `registeredWithoutAnnotation` and `annotationWithoutRegistration` so future drift is visible in CI. Current report: 94 entries, 0 missing, 0 orphan, with `aimeat_admin_mint` correctly flagged as server-only operator endpoint.
- **Submission plan + classification table** -- `docs/plans/2026-05-29-connectors-directory-submission.md` documents all 27 form fields, the per-tool annotation decisions (readOnly / destructive / idempotent / openWorld with reasoning), 8 file-level pre-submission checks, and the nginx fix for `.well-known/*`.

#### Privacy Policy (operator-configurable, fail-loud)
- **`AIMEAT_OPERATOR_*` env-var family** -- 13 fields in `src/config.ts` (name, type, address, country, email, security email, hosting name/url/location, supervisory authority name/url, effective date, policy version). Loaded into `config.operator`. Helpers `missingOperatorConfig()` and `operatorTypeLabel(type, locale)`. Required fields documented in `.env.example` as a clearly labelled REQUIRED/OPTIONAL block.
- **`/v1/privacy` template substitution** -- `aimeat/public/privacy.html` (EN) and `privacy.fi.html` (FI) are templates with `{{placeholder}}` tokens. `serveStaticPage()` in `src/routes/portal.ts` substitutes them per-request using `config.operator` + the locale-resolved operator-type label ("a natural person" / "luonnollinen henkilö"). Each self-hosted node renders its own policy with no source-tree changes.
- **Fail-loud guard** -- if any required `AIMEAT_OPERATOR_*` is missing, `/v1/privacy` returns **HTTP 503** with an operator-facing fallback page that lists exactly which env vars to set + links to `.env.example`. Prevents silent shipping of half-configured policies and shifts the responsibility to the right person (the operator, not the upstream author).
- **14-section policy content** -- TL;DR with "you own your data" framing, genesis-network callout (protocol-level, applies to every node), controller info, data categories (direct / generated / automatic), legal bases table, recipients, single-row sub-processors table (Scaleway only on aimeat.io -- self-hosters fill their own), international transfers, retention table, cookies (no analytics, no trackers, no advertising, no fingerprinting), GDPR rights with Data Wallet links, security, children (EU GDPR 16 default), self-hosting, changes, contact. Neutral third-person voice ("the operator") throughout so the template works for any operator.
- **BYOK clarification in section 4** -- "AIMEAT does not automatically send your data to third-party AI inference providers" but the *generator* feature is explicitly bring-your-own-key: if the user provides their own OpenRouter / OpenAI key, the server calls that provider under THE USER's contract with that provider. If no key, no outbound calls.

#### `/v1/terms` Terms of Service (EN + FI)
- **20-section ToS template** at `aimeat/public/terms.html` + `terms.fi.html`, served at `/v1/terms` and `/v1/terms/fi`. Uses the same `{{placeholder}}` substitution as the privacy policy; every `AIMEAT_OPERATOR_*` field that names the operator as a party to the agreement (legal name, type, postal address, country, email, effective date) is filled in per-node at render time. The same `missingOperatorConfig()` guard 503s the page if any required field is missing, with an operator-facing fallback. Covers: parties, the Service, eligibility/account, acceptable use, your content + necessary licences, connected AI agents, BYOK responsibility, sandboxed-extension responsibility, morsels (not money / not crypto), federation (peer operator's terms apply), service availability (no SLA), warranty disclaimer, limitation of liability, indemnification (user indemnifies operator for misuse / their content / their keys / their agents), termination, changes, open-source clarification (MIT licence governs software; ToS governs the operator's deployment), governing law (operator's country), miscellaneous (entire agreement, severability, no waiver, assignment, notices), contact.
- **Privacy policy footer cross-links to the ToS** in both languages for discovery.
- **`/terms.html` and `/terms.fi.html` 301-redirect** to canonical `/v1/` routes -- added to `STATIC_HTML_REDIRECTS` in `server-bootstrap/static-files.ts`, same pattern as `/privacy.html` and `/connect.html`. Direct access to the raw template files is never served.
- **Submission impact**: closes the last remaining Documentation Requirements checkbox on the Anthropic Connectors Directory submission form ("Terms of service are published and accessible").

#### `/v1/connect` MCP Attach Page (EN + FI)
- **6 client cards with attach instructions** -- Cursor (1-click `cursor://anysphere.cursor-deeplink/mcp/install?...` URL with server-rendered base64 config), Claude Code CLI (`claude mcp add aimeat --transport http <mcpUrl>`), VS Code Copilot (`code --add-mcp '{...}'`), Claude Desktop (4-step Settings → Connectors), claude.ai web (4-step + plan-tier note), ChatGPT generic custom-connector flow.
- **4 worked example prompts** -- each exercises real AIMEAT tools end-to-end: memory write, memory list+read in a fresh chat (cross-AI persistence), people directory search, organism + boards browsing.
- **"What you get" + collapsible tech details** -- 94-tool count, persistent GAII identity, GDPR-tooling-as-core-protocol-feature, federation. Collapsible sections for protocol/transport spec, reference manifest pointing at `annotations.ts` and the submission plan, self-host CLI walkthrough, data-handling summary cross-linking the privacy page.
- **Template substitution** -- `templateVars()` in `portal.ts` was generalised to cover both privacy and connect pages: emits `nodeName`, `nodeUrl`, `nodeId`, `mcpUrl = baseUrl + '/v1/mcp'`, `cursorDeeplinkConfig = base64({url:mcpUrl})`. Self-hosters get their own URLs everywhere on the connect page; aimeat.io's existing setup behaviour is unchanged.

#### Init Wizard Operator Prompts (`aimeat init`)
- **`askOperatorSettings()` function** -- 13 prompts gather the same fields documented in `.env.example`. Skipped entirely for `dev` use case (privacy 503 is fine in dev); ask-with-confirm for `personal`; required for `public`/`custom`. Reasonable placeholders shown (Scaleway, France, tietosuoja.fi) so new self-hosters see plausible examples; required fields refuse to advance with empty input.
- **27 new `init.operator*` translation keys** -- localised prompts, validation errors, and the intro note explaining why the wizard is collecting these fields. Both `locales/en.json` and `locales/fi.json` updated.
- **`CONFIG_DEFAULTS` extended** -- so the wizard's change summary correctly flags operator fields as "Changed from default" when the operator fills them in.

#### Public Research Reports
- **MCP rich rendering report** (`docs/research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md`) -- ~2200 words on the MCP 2025-11-25 spec's five content types (text / image / audio / resource_link / embedded resource) + `structuredContent` field, MCP Apps extension 2026-01-26 client matrix (8 supporting clients), per-client rendering capability matrix (Claude Desktop / Cursor / Claude Code / Cline / Continue / Zed), copy-paste config snippets, and AIMEAT-specific recommendations for adopting `structuredContent` + first-class MCP Resources.
- **Agent visibility reframe report** (`docs/research/2026-05-29-agent-visibility-reframe-REPORT.md`) -- ~3000 words taking a defensible contrarian position on the Manus-style "computer window" pattern. Recommendation: build a **structured execution view** (Camunda-Cockpit-shaped: BPMN diagram + activity tree + tabbed detail) as AIMEAT's front door, NOT live screen replay. Evidence: 8 mature categories (Temporal, Airflow, Camunda, Rundeck, AWX, GitHub Actions, Jenkins, GitLab CI) independently converged on graph-and-state views, never video.

### Changed

#### Privacy / Connect Plumbing
- **`servePrivacyPage` -> `serveStaticPage`** -- the helper in `portal.ts` was renamed and generalised. It now handles both privacy and connect pages, detects the locale from the filename (`.fi.html` -> Finnish operator-type label), runs the fail-loud guard only for privacy pages, and substitutes `{{var}}` tokens for any templatable page.
- **Genesis-network framing moved out of operator-specific voice** -- the privacy policy's section 12 was rewritten from first-person aimeat.io-specific ("I run this to promote AIMEAT...") into third-person protocol-level prose ("AIMEAT is an open, federated network... the aimeat.io node is the public 'genesis' reference deployment..."). Works for every operator; aimeat.io's marketing message stays accurate.

#### CORS Architecture Clarification
- **`AIMEAT_CORS_ALLOWED_ORIGINS=*` documented as intentional** -- `.env.example` now explains the architectural reason: AIMEAT is Bearer-token-only with no cookies, so CORS is not the protection layer; apps published via `aimeat_app_publish` can attach from arbitrary browser origins. Prevents future contributors from "tightening" the default and breaking the platform model.

### Fixed

#### Production OAuth Discovery
- **nginx `/.well-known/*` blocked by dotfile-deny rule** -- production nginx config was rejecting `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` with 403 because the standard `location ~ /\. { deny all; }` rule matched. The Express MCP handlers were returning correct JSON on `localhost:40050` but reviewers and clients could not auto-discover OAuth on prod. Fixed on the operator side (nginx config) with an explicit `location ^~ /.well-known/` allow block. End-to-end OAuth chain (`401` -> `WWW-Authenticate: Bearer resource_metadata="..."` -> `/.well-known/oauth-protected-resource` -> `/.well-known/oauth-authorization-server` -> authorize/token endpoints) now traversable by any conforming MCP client.

#### Templated Pages Served Raw via Static Middleware
- **`/privacy.html` and `/connect.html` showed unresolved `{{placeholder}}` tokens** -- the templated HTML files live in `public/`, which Express's `express.static` serves directly. Direct access to `https://aimeat.io/privacy.html` returned the raw template (`{{nodeName}}`, `{{operatorName}}`, etc.) instead of the substituted content available at `/v1/privacy`. Catastrophic if a search engine or reviewer landed on the legacy URL. Fixed by extending the redirect middleware in `server-bootstrap/static-files.ts` with a `STATIC_HTML_REDIRECTS` map: `/privacy.html`, `/privacy.fi.html`, `/connect.html`, `/connect.fi.html` now 301-redirect to their `/v1/` canonical routes. Pattern is now generalised so future templated pages can be added in one line.

#### Silent Base64 Corruption on Inline Uploads
- **`POST /v1/apps`, `POST /v1/memory/files`, `POST /v1/storage` (inline mode) accepted raw bytes as "base64" and stored a tiny garbage payload** -- Node's `Buffer.from(str, 'base64')` is permissive and silently drops characters outside the base64 alphabet. A caller that POSTed raw HTML (or JSON, or binary) as `content` therefore got a successful publish with whichever few characters of their input happened to be base64-legal -- typically 10-20 bytes of garbage out of a multi-KB upload. The server returned 2xx, the storage layer happily persisted it, and downloaders later hit gibberish at the canonical URL with no diagnostic anywhere. Discovered while seeding the directory-submission reviewer account on aimeat.io: a 1.2 KB HTML app published via `POST /v1/apps` with raw HTML in `content` saved as 14 bytes and served as binary noise. Fixed by introducing a strict `decodeStrictBase64()` helper at `aimeat/src/utils/base64.ts` (rejects empty input; rejects any character outside `[A-Za-z0-9+/_-]` with optional 0-2 `=` padding) and applying it at every inline-upload site: `apps.ts` (`content` + `screenshot`), `memory.ts` (`/v1/memory/files`), `storage-files.ts` (`/v1/storage` inline mode). Three regression tests added in `test/e2e-upload.ts` Phase 3.5 pin the boundary: raw HTML and malformed input now return 400 INVALID_INPUT with a remediation hint pointing to `Buffer.from(html).toString("base64")` and the presigned-upload alternative; valid base64 round-trips to the exact original byte length. Existing presigned-upload mode is unaffected (it uses raw PUT, not base64). e2e-upload: 16/16 passing on SQLite.

### Documentation
- **Connectors Directory submission plan** -- single source of truth for every form field, all 94 tools' annotation classifications with hint reasoning, pre-submission technical pre-flight verified against live aimeat.io, nginx fix snippet, reviewer-test-account seeding instructions deferred to Section E.
- **Plan doc Section F audit** -- documented that CORS=* is intentional (Bearer-token model), MCP spec 2025-11-25 supported, rate limiting + HSTS + CSP + nonce all verified live on prod, `AIMEAT_BASE_URL` correctly set in prod.
- **CLAUDE.md still valid** -- no rules changed; this release reinforces Rule 2 (file headers updated on every touched file) and Rule 1 (37/37 MCP e2e passing on SQLite after the bulk migration).

## [1.10.0] - 2026-05-28

Headline: a single `aimeat connect` CLI that any AI runtime can use to attach
to a node in seconds, plus onboarding that no longer lets agents lie about
being "done" -- they must publish commands and config before the system agrees
they are finished.

### Added

#### AIMEAT Connect CLI + MCP Server
- **`aimeat connect` subcommand in the main CLI** -- previously a separate `@aimeat/connect` package, now merged into the canonical `aimeat` binary so a global `aimeat` install gives every AI runtime the same toolset (`6bb7b06`, `46fecd5`, `322163e`).
- **RFC 8628 device-authorization flow** -- non-interactive `aimeat connect --url <node> --owner <name> [--agent <name>]` requests a device code, polls for owner approval, stores the issued token, downloads the runtime-specific skill bundle, and prints a paste-ready Hello Integration instruction.
- **`aimeat connect serve` MCP server** -- stdio-attached MCP server registering ~41 AIMEAT tools (handbook, onboarding, capabilities, tasks, telemetry, messages, memory, work queue, wallet, boards, knowledge, storage, admin) with background poller that wakes the agent via shell command or webhook when new tasks/messages arrive.
- **Shell fallback for non-MCP runtimes** -- `aimeat connect tools` lists every tool, `aimeat connect schema <tool>` returns its input schema, `aimeat connect call <tool> --json '<input>'` invokes it. For CLI-only or shell-driven agents where MCP stdio cannot attach, every Hello Integration step is reachable via one-shot commands.
- **Token keychain** -- file-based credential store at `~/.aimeat/tokens/{agent}@{owner}.token` with `mode 0600`; config at `~/.aimeat/config.yaml`; skill bundle extracted to `~/.aimeat/{agent}/` with proper Zip-Slip defenses (100 file cap, 20 MB total cap, 5 MB per-file cap, path-traversal rejection).
- **Runtime-specific skill bundles** -- generic adapter (default) and Hermes adapter ship a `SKILL.md` + `BUNDLE.md` + `references/` tree appropriate for each platform. Post-connect output documents both the MCP stdio path (Option A) and the shell fallback path (Option B), so agents that cannot do stdio still know how to onboard.
- **`aimeat connect status`, `inbox`, `tasks`, `send`, `docs`, `refresh`** -- one-shot operational subcommands for diagnosing the connection, polling inbox, listing tasks, sending messages, fetching docs, and refreshing the skill bundle.

#### Hello Integration Tightening (post-onboarding gating)
- **`publish_commands` onboarding step (required)** -- onboarding stays `in_progress` until the agent writes a non-empty `agents.{name}.commands` memory entry shaped as `[{ name, description, category }, ...]`. The validator rejects empty arrays and missing-field entries, so agents cannot stub out the SKILL.md "After Onboarding" instruction.
- **`publish_config` onboarding step (required)** -- same gating for runtime/config descriptors: at least one `agents.config.{name}.*` memory entry must exist (e.g. `agents.config.{name}.connector`). Agents that only run `aimeat connect serve` describe that accurately; no invented watchdog files.
- **`post_onboarding_checklist` in `GET /onboarding`** -- response now includes `{ commands_registered, config_published, shared_tags_in_use, knowledge_packages_published }`. `shared_tags_in_use` is `null` when the owner has not assigned shared tag areas (not applicable); the other three are booleans. Stays visible after `status` flips to `completed` so the signal does not disappear once Hello Integration finishes.
- **Auto-validation on POST step** -- POSTing the last manual step now also re-runs `checkAutoSteps()` against all auto-validatable steps before evaluating `allRequiredPassed`. Previously the agent had to do an extra `GET /onboarding` to trigger memory-backed step validation; POST and GET now behave symmetrically.
- **Post-Onboarding Setup panel in Integration tab** -- new UI section between Readiness and Identity showing the four checklist items as labeled rows with status dots, so the owner can see at a glance that commands are registered and config is published.

#### `/v1/agents/me/*` Universal Alias
- **Path rewriter middleware** -- `agentMeAliasMiddleware` resolves `/v1/agents/me/...` to `/v1/agents/{agentName}/...` based on the authenticated agent's JWT (handbook routes are excluded because they intentionally serve the literal `me`). The tier-1 handbook tells agents "all agent URLs use /v1/agents/me/ which resolves to your name", and that promise is now true for every route, not only handbook.

#### Agent Languages Capability
- **`languages: string[]` as a first-class agent field** -- BCP-47 short codes stored separately from `domainCapabilities` instead of being concatenated as `"Language: xx"` strings. Persisted in SQLite (`languages` column) and MongoDB (`languages Json?` column on `agent`). PUT/GET capabilities responses return `languages` as its own array. UI renders language chips from this field, with backward compatibility for older agents whose languages still live inside `domainCapabilities`.

#### Tier-1 Module Expansion
- **Three new tier-1 modules** -- `appdev`, `collaboration`, `mcp` added to the loadable module catalogue. Agents can now fetch operational knowledge for app development, multi-agent coordination, and MCP attachment incrementally instead of via the monolithic tier-1 prompt.
- **`appdev` module best practices** -- iterated from real agent feedback during early-access pilots; starter template embedded directly in the module instead of fetched separately.

#### Public Knowledge Viewer
- **Browser-side public knowledge browser** -- new view for browsing, searching, and rendering knowledge entries with no auth required, so visitors can read public packages before signing up.

### Fixed

#### Hello Integration Friction Points
- **Telemetry counted in Activity stats** -- POST `/v1/agents/:name/telemetry` now calls `recordTelemetryEvent()` which bumps the daily `telemetry_events` counter and (for `llm_call` events with `tokens_in`/`tokens_out`/`tokens_used` data) accumulates into `tokensUsed30d` and `aiCalls30d`. Activity tab no longer shows zeros when telemetry is actively being reported.
- **Telemetry UI field name** -- profile activity tab read `telResp.data.entries` but the route returns `telResp.data.events`; the `entries` lookup always came up empty so "Telemetry events today" was permanently `0`. Fixed to read `events` (with `entries` fallback for older deployments).
- **Telemetry token extraction** -- UI now reads tokens from `event.data.tokens_used` (or `tokens_in + tokens_out`) instead of `event.tokens_used`, matching the actual telemetry storage shape.
- **Capabilities `type` enum exposed in MCP schema** -- `aimeat_agent_capabilities_report` MCP tool now declares `technical[].type` as `z.enum(['mcp', 'skill', 'tool'])` instead of `z.string()`. Agents that previously had to guess and retry on `INVALID_INPUT` now see the constraint in the schema.
- **Languages no longer mutated into domain capabilities** -- PUT capabilities used to concatenate `["en", "fi"]` as `"Language: en"`, `"Language: fi"` strings into `domainCapabilities`. The languages array is now preserved verbatim in a dedicated field, returned as `languages` by GET, and rendered as a separate language chip group by the UI.
- **Handbook response deduplication** -- `GET /v1/agents/me/handbook` no longer returns both `content` and `system_prompt` with identical text. Only `system_prompt` is returned now; agents and clients that read `content` should switch to `system_prompt`.
- **Optional steps marked `skipped` on auto-complete** -- when onboarding auto-completes via "all required passed", untouched optional steps (like `declare_services`) now transition from `pending` to `skipped`, so a completed onboarding does not visually still show pending work.
- **`/v1/agents/me/tasks/*` actually works** -- previously only `/v1/agents/me/handbook` resolved the `me` alias; task PATCH/POST routes 404'd. The new path rewriter middleware makes the alias universal (handbook excluded as a literal).
- **Onboarding hint uses real agent name** -- `agentOnboarding.routeHint` now says `PATCH /v1/agents/{actualName}/tasks/{id}` instead of the broken `/me/` reference. (Both work post-rewriter, but the hint is now accurate for owner sessions too.)

#### Connector / CLI Robustness
- **Poller tracks task and message IDs, not counts** -- background poller in `aimeat connect serve` now diffs ID sets between polls; an interleaved task complete + new task arrival in the same window no longer goes silent (was missed by the old `tasks.length > lastTaskCount` heuristic).
- **Poller uses recursive `setTimeout` instead of `setInterval`** -- prevents overlapping polls if a single round trip slows.
- **Poller stops on stale token** -- `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `FORBIDDEN` envelope codes now stop the poller with a clear `Run: aimeat connect` instruction instead of spinning silently.
- **Wake command security warning** -- `wake.command` in `config.yaml` is executed via `child_process.exec`. The CLI's connector now documents this loudly in both the type definition and the runtime adapter so users do not paste untrusted configs.

#### Storage & Data
- **MongoDB `toAgentRecord()` deserializes `languages`** -- field was being written by Prisma but stripped from the read path, so PUT capabilities looked like a no-op for languages on MongoDB until the deserializer was fixed.
- **SQLite cascade delete table name** -- corrected `webhook_delivery_logs` (was `webhookDeliveryLog`); orphaned rows on agent deletion are gone.
- **Storage chunked base64 conversion** -- 64 KB file uploads via `lib-storage.ts` no longer overflow the JavaScript stack; conversion now chunks the binary instead of `String.fromCharCode(...spread)`-ing the whole buffer.
- **Body parsing limit for `/v1/storage`** -- middleware extended to accept larger payloads for direct file uploads via the storage endpoint.

#### UI
- **Delivery method label honest about polling** -- Integration tab's "Delivery method" row used to show "● Webhook" with a green dot whenever a webhook record existed, even if `webhook.url` was empty. It now checks the URL and shows "● Polling" (gray dot) when no URL is configured. The Edit/Test webhook buttons remain so the owner can still add a URL.
- **Today's Governance counts task lifecycle events** -- Activity tab's tasks-today filter used to require the event `type` to contain the substring `"task"` or `"todo"`, but task lifecycle events emit types like `"completed"` and `"progress"` that have neither. The categorizer now keys off `event.taskId` instead, so completed tasks count.
- **Agent card language chips render from `languages` field** -- previously the `Language: xx` chips came from the polluted `domainCapabilities` array; now they read from the dedicated `languages` array with a fallback for legacy entries.

#### Data Access / Generator
- **`data.get()` public fallback** -- the lib's `data.get(key)` now falls back to a public read from the app's creator when the caller has no private entry, with the bare-username case appending `nodeId` correctly and the empty-`{}` value also triggering fallback (was failing silently).
- **`GET /v1/memory/:key` no longer auto-creates** -- previously a 404 on read would side-effect a new empty entry; the auto-create was removed so missing keys stay missing.
- **App-builder starter template embedded in `appdev` module** -- no more external fetch at module load.

### Changed

#### Testing Policy (CLAUDE.md Rule 1 and 1b rewrite)
- **In-memory backend deprecated** -- `pnpm test:e2e` and `pnpm test:e2e:memory` are no longer the recommended verification path. SQLite (with `AIMEAT_DB_PATH=:memory:` for true in-RAM speed) covers the fast-iteration role using the real production code path. The `.env.test.memory` env file may not even exist in the repo.
- **Scoped suites by default** -- documented in CLAUDE.md and `docs/coding-guidelines/testing-requirements.md`: run only the suites the change can plausibly affect via `pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>`. Full sweep on both persistent backends only at the end of a multi-step plan or before a PR.
- **Pre-existing failure protocol** -- when an unrelated suite fails, verify it pre-exists on `main` (e.g. `git stash`) and report as pre-existing; do not fix as part of the current work.

#### Skill Bundle Documentation
- **Onboarding instruction extracted to a shared module** -- the long Hello Integration paste-into-agent text used to be duplicated across `cli/connect/auth.ts` and `cli/connect/skill-bundle.ts`. Now lives in `cli/connect/onboarding-prompt.ts` as a single source of truth that both consumers import.
- **Post-connect output documents both MCP and shell paths** -- the terminal output after a successful `aimeat connect` now explains Option A (MCP stdio, for runtimes that can attach) and Option B (shell fallback via `aimeat connect call`, for runtimes that cannot). Eliminates the "agent stares at `aimeat connect serve` blocking forever" failure mode.
- **BUNDLE.md compatibility guide uses the canonical tool sequence** -- the fallback BUNDLE.md generator now pulls the Hello Integration MCP tool list from `HELLO_INTEGRATION_TOOL_SEQUENCE`, so drift between the generated bundle and the auth-time instruction is impossible.

#### Agent Sessions
- **Auth lib `session.identity`** -- unified field returns GAII for agents and GHII for owners, so libs do not need to handle `session.gaii` vs `session.ghii` separately.
- **Cortex `myGaii()` falls through identity sources** -- returns `s.gaii ?? s.ghii ?? s.identity ?? null` so owner sessions get a usable identifier.

### Documentation
- **Audit report on Connect work** -- internal audit of the GPT-5.5-built Connect system documented findings F1-F7 and the A+C onboarding-gating proposal; all findings closed in this release.
- **Three end-to-end simulation runs** -- assistant, scout, and ranger agent simulations verified Hello Integration end-to-end through the CLI shell fallback; final ranger run validated the publish-gating works (onboarding stayed `in_progress` until the agent wrote `agents.{name}.commands` and `agents.config.{name}.*` memory entries).
- **CLAUDE.md updates** -- Rule 1 and Rule 1b rewritten for SQLite-default + scoped-suites testing policy; testing-requirements.md updated to match.

## [1.9.0] - 2026-05-25

### Added

#### Agent Integration Architecture (Plans 1-5)
- **Push Layer (Plan 1)** -- webhook infrastructure with HMAC-SHA256 signing, 3x retry with backoff, auto-disable after 10 failures, SSRF validation, delivery log (last 50 per agent), telemetry endpoints (POST/GET), cursor-based inbox polling with composite timestamp@id cursors, 7 webhook event schemas with Zod validation.
- **Skill Bundle Generator (Plan 2)** -- runtime-specific skill bundles (Hermes + Generic adapters), SHA-256 versioned ZIP downloads, 6 reference documents (api-overview, task-lifecycle, message-protocol, telemetry-protocol, capability-report, error-protocol), auto-selects adapter based on agent platform.
- **Hello Integration (Plan 3)** -- 11-step onboarding flow with platform detection, readiness scoring (baseline + operational health), auto-check on GET, auto-start test task, device auth auto-creates onboarding + test task.
- **Agent Detail Tab-View (Plan 4)** -- 8-tab UI (Integration, Tasks, Messages, Data Access, Directives, Agent Config, Activity, Services), state detector (5 states), two-zone card header, shared agent board, step pills with i18n, expandable memory key preview.
- **Governance + Admin (Plan 5)** -- budget limits on directives, owner-only task pause, readiness gate middleware, stall detection (unreachable + webhook_down), 5 admin fleet endpoints, admin Agent Integration dashboard tab.

#### Agent Onboarding UX
- **Device auth next_steps** -- device-token response includes step-by-step instructions for skill bundle download, system prompt, and Hello Integration with exact URLs.
- **Device auth user_instructions** -- tells the agent where the owner approves (AIMEAT profile Agents tab) so the agent can relay this to the user.
- **Copy prompt for agent** -- button in Integration tab copies a ready-made prompt with auth, skill bundle download, and onboarding instructions.
- **Polling instructions in prompt** -- exact curl command + python3 parse example for device-token polling, with "poll IMMEDIATELY" instruction.
- **Test task auto-start** -- onboarding validator auto-starts the test task when agent proposes todos, removing the need for owner to click Start.
- **Test task auto-creation** -- device auth approval creates the test task automatically so agents can complete steps 9-10 without owner intervention.
- **access_token alias** -- device-token response includes both `token` and `access_token` (RFC 8628 standard) for compatibility.

#### Agent Dashboard Features
- **Capabilities badges** -- technical (green) and domain (blue) capability badges displayed on agent card below the name.
- **Agent Commands palette** -- Messages tab shows agent-registered commands with `/` autocomplete.
- **Stored Memory Keys** -- Data Access tab shows agent's actual memory keys with click-to-expand JSON preview.
- **Agent Config tab** -- shows config files pushed by the agent (watchdog, skill_bundle metadata).
- **Activity onboarding events** -- Activity tab includes Hello Integration step-pass events alongside task events.
- **TODAY'S GOVERNANCE section** -- token budget, tasks today, policy issues, delivery health always visible in Activity tab.
- **10s polling fallback** -- agents-tab and messages-tab poll every 10 seconds as SSE fallback.

#### Agent Prompt Improvements
- **Positive framing** -- 60 negations in prompt-defaults.ts rewritten to positive language (e.g., "wait for approval" instead of "DO NOT start working").
- **Boot sequence reordered** -- directives, CORE modules (tasks, messages), Hello Integration, EXTEND modules, watchdog. Agents learn task operations before onboarding.
- **Each onboarding step documented** -- tier1 prompt lists what triggers validation for every step (PUT capabilities, POST message, POST telemetry, etc.).
- **Watchdog uses skill bundle script** -- tier1 prompt says "install scripts/poll-inbox.sh from your skill bundle" instead of 40 lines of "build your own".
- **Commands/config in SKILL.md** -- "After Onboarding" section with exact POST /v1/memory examples moved from references/ to SKILL.md where agents actually read it.
- **Agent API Quick Reference in llms.txt** -- copypaste-ready examples for capabilities PUT, todos PATCH, telemetry POST, onboarding step POST, memory write.

### Fixed

#### Critical Data Safety
- **Dev-mode no longer destroys agent data** -- re-registration in dev mode now resets password only, preserving all agents, memory, and data. New `AIMEAT_TEST_MODE` flag for E2E test isolation (full wipe behavior).
- **Agent cascade delete** -- deleting an agent now cleans up messages, telemetry, webhook logs, onboarding records, sharing groups (were missing from cascade).

#### Prisma/Storage
- **TelemetryEvent 500 fix** -- Prisma schema used `@db.ObjectId` but code generated UUIDs. Removed ObjectId constraint.
- **WebhookDeliveryLog 500 fix** -- same ObjectId issue.
- **Webhook DELETE fix** -- used `undefined` instead of `null` for Prisma nullable fields, so webhook URL was never actually cleared.
- **Step 10 testTaskId lost** -- validateAcceptTestTask overwrote step details without preserving testTaskId, causing validateCompleteTestTask to always fail "No test task created".
- **read_directives auto-validation** -- added to auto-check list (always passes but was missing, requiring manual POST).
- **Memory route owner access** -- removed `requireRole('agent')` from GET /v1/memory and search routes so owner sessions can view agent memory with `?agent=GAII`.
- **Memory `?agent=` parameter** -- when agent GAII is specified, bypasses ownerScope aggregation and queries only that agent's keys.

#### UI Fixes
- **Zone 2 "NEXT: undefined"** -- used `nextStep.name` but steps have `title`. Fixed to `nextStep.title || nextStep.id`.
- **Onboarding step names translated** -- UI now uses `t('agentOnboarding.steps.' + step.id)` instead of raw step IDs.
- **Data Access empty state** -- shows all 3 action buttons (tag, area, package) and corrected text from "above" to "below".
- **TabMessages missing agent prop** -- commands always showed (0) because `agent.gaii` was undefined.
- **Approve/Deny removes request immediately** -- no more 5-second wait for polling to clear it.
- **Deny button styled** -- changed from invisible `btn-danger` (text only) to visible `btn-danger-solid`.
- **Messages textarea full width** -- input field stretches to fill available space.
- **SSE ticket retry** -- SSE connection now retries with backoff when ticket request fails instead of silently giving up.

#### Webhook/Schema
- **onboarding.step webhook payload** -- field names now match Zod schema (step_order, step_title, action, onboarding_progress, onboarding_total).
- **directive.updated Zod enum** -- added `budget_limits` to changed_sections enum.
- **MCP notification for task.updated** -- added missing `emitResourceUpdated()` in PATCH task handler.

#### Security
- **SSRF blocklist** -- added RFC 5737 TEST-NET ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

### Changed
- **Hermes skill bundle** -- SKILL.md "On First Run" includes exact cron install commands for poll-inbox.sh and telemetry hook.
- **Skill bundle adapter selection** -- auto-selects Hermes adapter based on agent's platform field instead of requiring `?runtime=hermes` query parameter.
- **i18n** -- service visibility values translated (Public/Private/Internal), admin platform form placeholders translated, onboarding step names translated in both en.json and fi.json.
- **E2E webhook test** -- unreachable URL changed from RFC 5737 blocked IP to httpbin.org:12345.

### Documentation
- **Hello Integration demo video** -- added to README with YouTube thumbnail link.
- **AIMEAT_TEST_MODE** -- documented in .env.example, config-schema.ts, env-config.ts.

## [1.8.0] - 2026-05-22

### Added

#### Tier 1 Multi-Module Prompt System
- **Bootloader rewrite** -- tier-1 prompt rewritten as a lightweight bootloader that loads capability-specific modules on demand instead of one monolithic prompt. Reduces initial payload and lets agents load only what they need.
- **7 module prompt seeds** -- `memory`, `tasks`, `messaging`, `knowledge`, `wallet`, `work-exchange`, `extensions` as separate loadable modules stored in the prompt system.
- **Modular route** -- `GET /v1/prompts/tier1/:module` serves individual modules so agents can fetch capabilities incrementally.
- **Bootloader watchdog** -- enforces propose-first workflow where agents must propose actions before executing them.
- **E2E test suite** -- dedicated test suite for the tier1 module system.

#### Federation Enhancements
- **Schema-based auth policy** -- federation tab and peer routes updated to support structured auth policy configuration with federated auth scopes.
- **Peer re-introduction** -- depeered or offline nodes can be re-introduced without re-creating the peering from scratch.
- **Key exchange improvements** -- peer public key included in exchange process, streamlined join functions.
- **Federated memory UI** -- enhanced browsing and interaction for federated memory across peers.
- **Peering request management** -- confirmation and deletion flows for peering requests.

#### Memory Discovery
- **Discover and copy public memory** -- new endpoints for discovering public memory entries across identities and copying them to the caller's own namespace.

#### Agent Capabilities Schema
- **`modulesLoaded` field** -- tracks which tier1 modules an agent has loaded, visible in capabilities reporting and admin views.
- **`agentLimitations` field** -- agents can self-report operational limitations (context window, rate limits, etc.).

#### Generator Autopilot Improvements
- **Contract verification** -- autopilot now runs `verifyContract()` after code validation, checking generated output against blueprint actions, exported methods, and cortex references. Attempts one fix round on mismatch.
- **Blocking spec validation** -- spec validation failures now trigger a retry with error context instead of silently proceeding with a broken spec. Blueprint action coverage is enforced as part of validation.
- **Smoke test after registration** -- quick accessibility check (extension activates, cortex lib loads, app HTML serves) runs immediately after registration to catch deployment failures early.
- **App spec validator** -- new `validateAppSpec()` function validates app-type specs (name, title, appDomainLib, cortexDependencies) instead of falling through to the wrong validator.

### Fixed
- **Message timestamps and ordering** -- messages now show timestamps and sort oldest-first (chat-style chronological order).
- **Task telemetry accumulation** -- telemetry counters now accumulate across task events instead of being overwritten on each event.
- **Propose-first task workflow** -- agents must propose tasks before the owner approves them; todo UI rendering corrected for this flow.
- **Agent PATCH on queued tasks** -- agents can now update todos on tasks that are still in queued status.
- **Tier1 module field corrections** -- 39 field name and schema errors corrected across all 7 module prompts (3 audit passes).
- **Spec UI prompt refresh** -- saving a spec now immediately rebuilds the code generation prompt so it includes the spec. Previously required clicking "Copy Prompt" twice.

### Changed
- **Sharing group member resolution** -- member identifiers in sharing groups now resolve correctly against GHII/GAII identity formats.
- **Sharing group default permissions** -- groups support editing default read/write permissions for new members.
- **Agent instructions** -- updated operational clarity in agent prompts, added llms.txt reference to bootloader.
- **Wallet UI** -- ownership clarification text added to wallet display.
- **Memory browsing errors** -- user-facing error messages added for memory browsing failures.

### i18n
- New translation keys in both `en.json` and `fi.json` for federation peering, memory browsing errors, wallet ownership, and agent limitations.

## [1.7.0] - 2026-05-22

### Added -- Agent Dashboard (3 phases, 7 features, ~15,000 lines across 113 files)

Complete per-agent management dashboard with task queues, directives, sharing groups, capabilities, activity monitoring, offered services, and messaging -- all accessible from the profile Agents tab.

#### Agent Tasks (Phase 1)
- **Task queue per agent** -- create, assign, start, complete, fail tasks with full lifecycle management. Each task tracks status (`queued`/`active`/`completed`/`failed`), priority, deadline, and event log.
- **Task creation builder** -- frontend form with title, description, priority, and deadline fields.
- **Task stall detection** -- background job flags active tasks with no events past a configurable threshold (`AIMEAT_TASK_STALL_THRESHOLD_MINUTES`).
- **Work-to-task bridge** -- automatically creates an `AgentTask` when an agent accepts a work exchange item, linking the two systems.
- **Task event logging** -- every lifecycle transition (start, complete, fail, stall) is recorded as a timestamped event with optional metadata.
- **7 MCP tools** -- `agent_task_create`, `agent_task_list`, `agent_task_get`, `agent_task_start`, `agent_task_complete`, `agent_task_fail`, `agent_task_event`.
- **Admin agent tasks tab** -- operator view of all tasks across all agents with status badges.

#### Agent Directives (Phase 1)
- **Three-layer directive inheritance** -- System (operator-set via admin dashboard), Owner (user-set via access tab), and Agent (per-agent in detail view). Merged view shows effective directives with source labels.
- **System configuration fields** -- `agentSystemPrinciples`, `agentMaxTokensPerTask`, `agentMandatoryLogging`, `agentAimeatFirstEnabled` configurable via admin dashboard and `.env`.
- **Tier1 prompt extended** -- downloaded agent instructions now include directives and task handling sections.

#### Sharing Groups (Phase 1)
- **Group-based memory visibility** -- new `group` visibility level extends `private|owner|public`. Memory entries with `visibility: 'group'` are readable only by group members.
- **Group CRUD** -- create, update, delete groups with per-member GAII/GHII read/write permissions.
- **Consent integration** -- `checkConsentForRead()` extended with group visibility branch.
- **Memory tab group picker** -- visibility cycle extended to 4 states; popup for selecting target group.
- **Access tab sections** -- sharing groups management and agent directive defaults in the access tab.
- **Admin sharing groups tab** -- operator view of all groups across all owners.
- **5 MCP tools** -- `sharing_group_create`, `sharing_group_list`, `sharing_group_get`, `sharing_group_update`, `sharing_group_delete`.

#### Agent Capabilities (Phase 2)
- **Technical + domain capabilities** -- agents report their technical capabilities (languages, frameworks, APIs) and domain skills via `PUT /v1/agents/:name/capabilities`.
- **MCP-type verification** -- capabilities reported by agent sessions are verified against actual MCP tool availability.
- **Capabilities sub-tab** -- displays technical skills, domain skills, and action queue in the agent detail view.
- **2 MCP tools** -- `capabilities_report`, `agent_activity`.

#### Activity Monitoring (Phase 2)
- **Embedded activity counters** -- `tasksCompleted`, `tasksFailed`, `messagesProcessed`, `lastActiveAt` on AgentRecord, updated on every task lifecycle event.
- **Time-series activity table** -- `agent_activity` stores metric/value/timestamp rows for historical charts.
- **Activity recorder service** -- records task events to the time-series table automatically.
- **Activity sub-tab** -- stats cards, CSS bar chart (no external charting library), scheduled jobs list, and scrollable event log.
- **REST endpoints** -- `GET /v1/agents/:name/activity/stats`, `/activity/history`, `/activity/log`.

#### Offered Services (Phase 3)
- **Services sub-tab** -- displays published actions (services) offered by the agent on the work exchange, with name, description, cost, visibility, call count, success rate, and average response time.
- **Unpublish button** -- remove a service from the exchange directly from the dashboard.

#### Agent Messages (Phase 3)
- **Message CRUD with thread support** -- `POST/GET /v1/agents/:name/messages` with optional `threadId` for conversation threading.
- **Chat UI** -- message bubbles (inbound/outbound), auto-scroll, textarea with Enter-to-send.
- **Proposed task handling** -- inbound messages with `metadata.proposedTask` render inline with "Create Task" and "Adjust" buttons.
- **Status bar** -- online/offline indicator, inbox/delivered/error counters.
- **Thread selector** -- horizontal thread navigation buttons.
- **Inbox integration** -- pending messages included in the agent integration kit inbox endpoint.
- **2 MCP tools** -- `message_inbox`, `message_send`.
- **Tier1 prompt extended** -- message handling instructions added to downloadable agent specs.

#### Agent Detail View (cross-phase)
- **6 sub-tabs** -- Tasks, Directives, Capabilities, Activity, Services, Messages. Tab navigation within agent detail.
- **Shortened connection prompt** -- buildAgentPrompt() reduced to 10 lines (Telegram-safe). Full instructions available via Download/Copy buttons.
- **Agent Integration Kit** -- consolidated inbox endpoint (`GET /v1/agents/:name/inbox`) returns pending tasks, messages, and directives in one call. Long-poll support for real-time agents.
- **Live updates** -- all sub-tabs listen for SSE `aimeat-live-update` events and refresh automatically.

#### Admin Integration
- **Peer management in admin monitoring** -- admin monitoring tab extended with peer status tracking and routing controls.

### Storage
- **7 new SQLite tables** -- `agent_tasks`, `agent_task_events`, `agent_directives`, `owner_agent_defaults`, `sharing_groups`, `agent_activity`, `agent_messages`.
- **7 new Prisma models** -- matching MongoDB implementations for all tables.
- **6 new repository interfaces** -- `AgentTaskRepository`, `AgentDirectivesRepository`, `SharingGroupRepository`, `AgentActivityRepository`, `AgentMessageRepository`, plus capability extensions on `AgentRepository`.
- **Storage interface extended** -- `AgentTaskRecord`, `AgentDirectivesRecord`, `SharingGroupRecord`, `AgentMessageRecord`, `AgentActivityRecord`, `AgentActivityStats`, `AgentTechnicalCapability` types added.

### Tests
- **8 new E2E test suites, 109+ tests** covering all features on both SQLite and MongoDB:
  - `e2e-agent-tasks.ts` (19 tests) -- task CRUD, lifecycle, stall detection, events
  - `e2e-agent-directives.ts` (12 tests) -- three-layer inheritance, merge view
  - `e2e-sharing-groups.ts` (23 tests) -- group CRUD, member permissions, memory visibility
  - `e2e-integration-kit.ts` (15 tests) -- inbox, task lifecycle, kit endpoint, long-poll
  - `e2e-agent-capabilities.ts` (8 tests) -- capability reporting, MCP verification
  - `e2e-agent-activity.ts` (10 tests) -- stats, history, log, recorder
  - `e2e-agent-messages.ts` (14 tests) -- message CRUD, threads, inbox integration
  - `e2e-agent-services.ts` (22 tests) -- service listing, stats, unpublish

### i18n
- **228 new translation keys** in both `en.json` and `fi.json` covering all 7 features, admin tabs, status badges, form labels, and empty states.

### OpenAPI
- **~1,700 lines added to `openapi.yaml`** -- all new endpoints documented with request/response schemas, including agent tasks, directives, sharing groups, capabilities, activity, messages, and integration kit.

## [1.6.1] - 2026-05-21

### Security

Full security audit covering authentication, authorization, input validation, dependencies, storage, GDPR, extensions, federation, and infrastructure. 33 findings addressed across 7 phases.

#### Critical & High Fixes
- **Extension SSRF protection** -- `ctx.fetch()` in extension sandbox now validates URLs via `validateOutboundUrl()`, blocking private/reserved IPs and cloud metadata endpoints (169.254.169.254). Applied to both QuickJS runtime and route-level fetch.
- **GDPR cascade delete completion** -- `DELETE /v1/owners/:name` now deletes all data categories: GHII-level memory, consents, organism memberships, matches (by GHII), sessions, capabilities, scheduled jobs, device auth records, apps, extension instances, knowledge links, and knowledge reviews. Previously only agents, their memories, actions, and transactions were deleted.
- **Admin password removed from logs** -- no longer logged via `logger.info()`. Auto-generated secrets written to stderr only.
- **Login brute-force protection** -- per-route rate limit + per-account progressive lockout after configurable N failed attempts (default: 5 failures, 15-minute lockout).
- **Extension script content gated** -- `GET /v1/extensions/:name?full=true` now requires authenticated owner/operator. Unauthenticated callers get metadata only. Does not affect cortex-to-extension calls (which use action invocation, not script reading).
- **Extension email authorization** -- three-tier model: Tier 0 (default) allows emailing only the caller's own verified email. Tier 1 allows consented recipients via `purpose: 'extension_email'`. Tier 2 (operator-granted `emailPolicy: 'unrestricted'`) allows arbitrary recipients.
- **Token refresh role revalidation** -- `POST /v1/auth/refresh` now re-reads roles from storage instead of copying from the old token, preventing stale privilege persistence after role changes.
- **Unauthenticated federation auth refresh deleted** -- `POST /v1/federation/auth/refresh` removed entirely (no consumers existed; client library explicitly refuses federated refresh).

#### Federation Auth Scope Configuration (new feature)
- **Node-level federation auth policy** -- `federationAuthPolicy` config: `disabled` (default), `all_peers`, or `specific_peers`. Controls whether users from other nodes can log in.
- **Per-peer auth settings** -- `allowFederatedAuth` and `federationAuthScopes` fields on each peer record, configurable from admin dashboard.
- **Receiving node determines scopes** -- home node attestation no longer dictates scopes. The receiving node applies its own per-peer or default scope policy.
- **Attestation signature verification** -- federated login now verifies the home node's Ed25519 signature on the attestation against the peer's known public key.
- **Admin dashboard UI** -- federation tab gains auth policy dropdown (disabled/all_peers/specific_peers), default scopes checkboxes, and per-peer "Allow Federated Login" toggle.

#### Medium Fixes
- **Registration rate limiting** -- `POST /v1/ghii` and `/v1/ghii/register-web` rate-limited (default: 5/min).
- **Admin setup rate limiting** -- `/v1/admin/setup/auth`, `/setup/register`, `/setup/token`, `/setup/initial-otk` all rate-limited (default: 5/min).
- **Timing-safe admin password** -- all admin password comparisons use `crypto.timingSafeEqual()`.
- **Strong admin passwords** -- setup wizard now enforces same password strength rules as regular registration (8+ chars, uppercase, lowercase, number, no common passwords).
- **Extension limits capped** -- `Math.min()` instead of `Math.max()` ensures extensions cannot exceed admin-configured memory/timeout/API-call limits.
- **Extension wallet spending cap** -- configurable per-call debit limit (default: 100 morsels, env: `AIMEAT_EXT_MAX_DEBIT`).
- **Consent expiry sweep** -- `expireConsents()` now performs actual bulk expiration query instead of being a no-op.
- **Unhandled rejection handler** -- `process.on('unhandledRejection')` prevents silent crashes from background services.
- **scrypt v2 parameters** -- new password hashes use N=32768 (up from 16384). Versioned hash format (`v2:salt:key`) with transparent upgrade on login. Old hashes work forever.
- **Relaxed CSP for test pages** -- generator/foundry test pages use `script-src 'unsafe-eval' 'unsafe-inline' https:` instead of removing CSP entirely.
- **Zod schema validation** -- added to `POST /v1/ghii`, `/v1/ghii/register-web`, `/v1/ghii/login`, `/v1/consent`, `/v1/flags`, `/v1/extensions` with field type/size constraints.

#### Low Fixes
- **Content-Disposition sanitization** -- filename quotes/backslashes escaped in download headers.
- **Interest storage identity** -- registration interests stored under owner GHII (was fabricated non-existent agent GAII). Directory service uses GHII-first lookup with agent GAII fallback for backward compatibility.
- **Extension notification identity** -- `notify()` uses `resolveIdentity()` instead of raw `req.auth!.sub`.
- **TOTP backup code entropy** -- increased from 4 bytes (8 hex chars) to 6 bytes (12 hex chars).
- **Transaction IDs** -- all 23 sites migrated from `Math.random()` to `crypto.randomUUID()`.
- **Rate limiter fallback** -- added `req.socket.remoteAddress` to key chain + stats counter for unknown key fallback.
- **Security headers on all responses** -- X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS applied globally (was only when public directory existed).
- **Generic upload error** -- internal error details no longer leaked to clients.
- **JSON body limit** -- reduced default from 15MB to 5MB. Apps/extensions/cortex routes keep 15MB.
- **Startup warnings** -- TOTP encryption key missing, dev mode on non-local config, Windows node key unencrypted.

#### Configurable Security Settings (all via .env + admin dashboard)
All security limits are runtime-configurable via environment variables and the admin dashboard Config tab under the "Security" group:
- `AIMEAT_LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 15 / 60000)
- `AIMEAT_REGISTRATION_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 5 / 60000)
- `AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 5 / 60000)
- `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` / `_MINUTES` (default: 5 / 15)
- `AIMEAT_JSON_BODY_LIMIT_MB` / `_LARGE_MB` (default: 5 / 15)
- `AIMEAT_EXT_MAX_DEBIT` (default: 100)
- `AIMEAT_FEDERATION_AUTH_POLICY` (default: disabled)
- `AIMEAT_FEDERATION_DEFAULT_SCOPES` (default: memory:read,catalogue:read)

### Changed
- **Password validation** extracted to shared `src/utils/password-validation.ts` (was private in ghii.ts).
- **ConsentCreateSchema** scope enum now includes `'auth'` (was missing, needed for federation auth consents).
- **Federation auth verify** rate limit increased from 10/min to configurable (default: 15/min).

## [1.6.0] - 2026-05-21

### Added
- **Notification Statistics** -- email, push, and mailbox notification counters with type-level breakdown for operational visibility and abuse detection.
  - **Email counters** -- `email_sent`, `email_failed`, `email_retried` tracked per type (verification, magic_link, notification, match_suggestion, group_send).
  - **Push counters** -- `push_sent`, `push_failed`, `push_expired_subs` tracked per type.
  - **Mailbox notification counters** -- `mailbox_notif_sent`, `mailbox_notif_failed` per channel (push, email), `mailbox_notif_blocked` per reason (cooldown, quiet_hours, disabled).
  - **`incrementTyped(name, type)` API** -- new `StatsCollector` method stores typed counters as `name:type`, with automatic grouping in `snapshot()` into `{base}` totals and `{base}_by_type` breakdowns.
- **Stats Persistence** -- all counters survive server restarts via periodic flush (every 60s) to storage.
  - **`StatsRepository` interface** -- `flushStats`, `loadStats`, `flushDailyHistory`, `loadDailyHistory` methods added to the storage layer.
  - **SQLite backend** -- `stats_counters` and `stats_daily_history` tables with upsert and 90-day pruning.
  - **MongoDB backend** -- `StatsCounter` and `StatsDailyHistory` Prisma models with composite unique constraints.
  - **Graceful shutdown** -- `stats.shutdown()` flushes final counter state on SIGTERM/SIGINT.
- **Time-Range Filtered Stats API** -- `GET /v1/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` returns summed counters and per-day breakdown for the selected range. Backward compatible (no params = lifetime totals).
  - **Gauges** -- `tunnel_connections_active`, `mailbox_items_total`, `mailbox_bytes_total`, `mailbox_oldest_item_age_seconds` always return current values regardless of time range.
- **Stats Tab UI** -- admin dashboard Stats tab gains three new sections and a time range selector.
  - **Time range selector** -- preset buttons (Today, This Week, 7 Days, 30 Days, All) plus custom date range. Default: 7 Days. Re-fetches data on change.
  - **Email Delivery section** -- 4 stat cards (Sent, Failed, Retried, Success Rate), breakdown table by type, per-day bar chart.
  - **Push Notification section** -- 4 stat cards (Sent, Failed, Expired Subs, Success Rate), breakdown table by type, per-day bar chart.
  - **Mailbox Notifications section** -- 3 stat cards (Sent, Failed, Blocked), inline breakdowns by blocked reason and channel.
  - **Live badge** -- gauge values show a "live" indicator badge.
- **i18n** -- 51 new translation keys added to both `en.json` and `fi.json` (section headers, stat cards, type labels, time range presets, weekday abbreviations).

### Tests
- **12 new unit tests** -- typed counter grouping (5 tests), persistence init/flush/shutdown (7 tests) including prefixed counter deserialization, error recovery, and timer cleanup.
- **5 new Playwright tests** -- admin stats tab: time range selector rendering, button switching, email/push/mailbox section rendering with stat card verification.
- **E2E stats tests** -- time-range-filtered `GET /v1/stats` with `totals`, `daily`, `gauges` key verification, empty range handling.

## [1.5.0] - 2026-05-21

### Added
- **Federation Mesh Network** -- complete mesh networking across AIMEAT nodes with 4 layers of functionality:

#### Per-Peer Policy + Federate Flags (Phase 1)
- **Per-peer policy controls** -- each federation peer connection has configurable `shareCatalogue`, `replicateMemory`, `allowRouting` flags and a `peerMode` (federation/private). Private P2P peers are excluded from the public federation directory.
- **Federate flag on all catalogue types** -- `ActionRecord`, `AgentRecord`, `BoardRecord`, `StorageFileRecord` each have a `federate` boolean. Only items explicitly marked for federation are shared across the network. `CsmRecord` and `MsmRecord` already had this.
- **Policy enforcement** -- catalogue sync, memory replication, and multi-hop routing check peer policies before proceeding. Returns 403 `POLICY_DENIED` when blocked.
- **Admin UI peer policy toggles** -- Live Peers table in the federation tab has per-peer checkboxes and mode selector.
- **Profile UI federate badges** -- agents, boards, and knowledge tabs show interactive federate toggle badges.

#### Network Directory (Phase 2)
- **Service summary endpoint** -- `GET /v1/federation/service-summary` returns a compact catalogue of all federated items on a node, with a SHA-256 hash for change detection.
- **Heartbeat-driven discovery** -- hub nodes detect service summary hash changes during heartbeat and automatically fetch updated summaries from peers. Summaries stored in-memory, cleaned up when peers go offline.
- **Cross-catalogue network source** -- `GET /v1/federation/cross-catalogue` extended with `source_type: 'network'` entries aggregated from all peer summaries.
- **Admin UI network directory browser** -- searchable table in the federation tab showing all services/data available across the federation.

#### Federated Login (Phase 3)
- **`POST /v1/federation/auth/verify`** -- home node verifies credentials for a remote node. Checks password (scrypt) and requires an active auth consent (`scope: 'auth'`) for the requesting node. Returns a signed Ed25519 attestation.
- **`POST /v1/federation/auth/refresh`** -- re-verify a federated session without password. Checks user exists and auth consent still active.
- **Auth consent isolation** -- `scope: 'auth'` is distinct from `scope: 'federation'`. Sharing data with a node does NOT grant login access. New `ConsentRecord.scope` value added to the type.
- **Federated JWT claims** -- JWT extended with `federated`, `homeNode`, `homeUrl` claims. Short TTL (max 1 hour).
- **Restricted federated sessions** -- federated users cannot perform operator actions, create agents, or manage consents. `requireLocalSession()` middleware added.
- **Server-side federated login flow** -- `POST /v1/ghii/login` detects `@remote-node` in username, routes verification to the home node, and issues a local federated JWT on success.
- **Client-side federated login** -- login modal sends full `user@node` to server. Shows "Connecting to home node..." during federation. "Federated" badge on logged-in state. Session stores federation info.
- **Access tab Federation Access section** -- manage which nodes can authenticate you. Add/remove per-node auth consents. "Allow all federation nodes" wildcard toggle with warning.

#### Cross-Node Data Access (Phase 4)
- **`POST /v1/memory/pull`** -- copy a memory entry from the home node to the current (remote) node. Stores locally with `visibility: private` and `pulled-from:` tag.
- **`POST /v1/memory/push-home`** -- save a local memory entry back to the home node via the federation replication protocol.
- **Federation proxy utility** -- `middleware/federation-proxy.ts` routes requests from federated sessions to the home node with SSRF protection.
- **Memory tab pull/push UI** -- federated sessions see a banner and per-entry "Copy from home" / "Save to home" buttons.

#### Additional UI Enhancements
- **Knowledge tab** -- interactive federate toggle creates/revokes federation consent per package.
- **Data Wallet tab** -- distinct badges for federation (blue) and auth/login (purple) consent scopes. Scope filter buttons (All / Federation / Login Access).
- **Memory tab** -- "Synced" badge on entries with active federation consent. Share/Unshare buttons for all sessions.
- **Profile card** -- federation status indicator shows "Connected to X nodes" or "Standalone".

### Fixed
- **Multi-hop relay didn't forward auth headers** -- `POST /v1/federation/route` now includes the `Authorization` header when relaying through intermediate nodes, enabling B->A->C routing.
- **Private peers visible in public directory** -- `GET /v1/federation/directory` now excludes peers with `peerMode: 'private'`.
- **Federation sidebar count inflated by history** -- sidebar showed peering request history count when no live peers existed. Now shows only live peer count.
- **Peering request history not deletable** -- added `DELETE /v1/admin/peering/requests/:id` endpoint and delete buttons in the admin federation tab.

### Tests
- **129 federation tests** -- 44 single-node E2E (peer policies, federate flags, service summary, auth verify, data access), 45 multi-node integration (3 nodes: hub + 2 contributors), 40 original federation tests.
- **Multi-node integration suite** -- `test/federation-multinode.ts` boots 3 AIMEAT servers and tests service discovery through hub, cross-node routing (direct + multi-hop), federated login with consent isolation, private peer filtering, and routing fee verification.

## [1.4.8] - 2026-05-20

### Fixed
- **Owners tab showed wrong list and counts** -- the admin dashboard built the owners list by extracting unique names from agents, so owners with zero agents were invisible. Sidebar count (from `listOwners()`) didn't match the tab data. Added `GET /v1/admin/owners` endpoint that returns all owners directly from storage with roles and agent counts. Sidebar count now updates from the same source.
- **Owner roles missing from API response** -- `GET /v1/owners/:name` did not include the `roles` field, so the admin owners tab always showed "--" for roles and the "Grant Operator" button appeared even for existing operators.
- **Federation login showed "wrong password" instead of proper error** -- entering `user@remote-node` in the login form stripped the `@node-id` client-side before the server could check, so the server tried local auth and failed with a misleading error. Now checks the node-id client-side and shows "Federated login is not yet supported" with both node IDs.
- **Federation peers lost on server restart** -- the `peers` Map was in-memory only. Added `federation_peers` table (SQLite) and `FederationPeer` Prisma model (MongoDB). Peers are persisted on every mutation (add, activate, update, remove, heartbeat status change) and loaded on startup.
- **Federation peering was one-directional** -- when genesis node A approved peering with node B, only A recorded B as a peer. B never added A back. Fixed by: (1) including `node_url` in key exchange payload, (2) auto-adding the sender as a peer during key exchange if they match our genesis config or an approved peering request, (3) storing a local peering request when joining a genesis network so the returning key exchange is recognized.
- **MongoDB replication queue lost on restart** -- the MongoDB storage used an in-memory `Map` for the replication queue instead of persisting to the database (SQLite already used a proper table). Replaced with Prisma-backed `ReplicationQueue` model. Federation sync state now survives restarts on both backends.

## [1.4.7] - 2026-05-20

### Added
- **Edit Profile modal** -- "edit profile" link in the profile card now opens a modal to update display name, bio, avatar, and language. Calls `PUT /v1/ghii` and updates the session immediately.
- **Change Password modal** -- "change password" link next to edit profile opens a separate modal with current/new/confirm password fields. New `POST /v1/ghii/password/change` endpoint validates the current password and enforces strength requirements.
- **`displayName` in session** -- the login and register flows now include `displayName` in the session object and localStorage, so the profile card shows the real name instead of falling back to the username.
- **Profile API service functions** -- `getProfile()`, `updateProfile()`, `changePassword()` added to the frontend auth service (`public/js/services/auth.js`).
- **`GET /v1/ghii/me` endpoint** -- authenticated endpoint that returns the user's own profile including private fields (`notification_email`, `email_verified_at`). Used by edit profile modal and email tab.
- **Email shown in profile** -- email-tab now displays the verified email address (was only showing "Email verified" without the address). Edit profile modal shows email as read-only with a hint to change it in the Email tab.

### Fixed
- **Login with full GHII corrupted session** -- entering `user@node-id` in the login form leaked the full GHII into JWT claims (`sub`, `owner`), the session `owner` field, and all downstream operations (owner lookup, key update, token refresh). Root cause: `POST /v1/ghii/login` stripped `@node-id` into `loginName` for the GHII lookup but used the raw `username` from req.body for JWT issuance, storage updates, and the API response. Now all 8 occurrences use `loginName`. Registration endpoints also strip `@node-id` from both `username` and `display_name`. Frontend strips `@node-id` and skips the register-first flow when a GHII is detected.
- **Password reset never sent email (MongoDB)** -- `notificationEmail` field was missing from the Prisma schema and MongoDB storage mapping. The email verification flow set `emailVerifiedAt` but silently failed to store the email address, so password reset always skipped sending because `notificationEmail` was null. Added the field to `schema.prisma`, `createGHII`, and `toGHIIRecord`. Users who previously verified their email on MongoDB need to re-verify once for the address to be stored.

### Improved
- **Password reset logging** -- `POST /v1/ghii/password/reset-request` now logs whether the email was sent, failed, or skipped (and why), making it possible to diagnose "forgot password" issues from server logs.

## [1.4.4] - 2026-05-20

### Fixed
- **Setup wizard still broken after 1.4.3** -- the root cause was in `middleware-guards.ts`: the first-run guard served `wizard.html` directly without injecting the CSP nonce into `<script>`/`<style>` tags. The 1.4.3 onclick fix was necessary but insufficient because the nonce was never reaching the HTML. Now uses the same `res.locals.cspNonce` injection pattern as all other HTML-serving routes.
- **`aimeat --version` showed hardcoded `v1.2.0`** -- now reads version from `package.json` at runtime.
- **Crash on Mac ARM (Apple Silicon) with memory backend** -- `better-sqlite3` native bindings may not have prebuilts for newer Node.js versions on `darwin/arm64`. Previously crashed with an opaque bindings error. Now catches the failure and shows clear fix instructions (rebuild, use MongoDB, or reinstall).
- **Login rejects full GHII identity** -- entering `username@node-id` in the sign-in form failed because the `@` character was rejected by registration validation, and the backend constructed a double-suffixed key. Both frontend and backend now parse the `@node-id` suffix: the username portion is extracted for login, and if the node-id doesn't match the local node, a clear "federated login not yet supported" error is returned. Full GHII input also skips the register-first flow and goes straight to login.

## [1.4.3] - 2026-05-20

### Fixed
- **Setup wizard inline onclick handlers blocked by CSP** -- replaced all 17 inline `onclick` event handlers in `wizard.html` with `addEventListener` calls inside the nonce-protected `<script>` block. Inline event handlers require `unsafe-inline` regardless of nonce.

## [1.4.2] - 2026-05-16

### Fixed
- **Owner cannot modify agent-created knowledge packages** -- PATCH sharing/visibility endpoints used `resolve(req)` which returns GHII for owner sessions, but packages created by agents are stored under their GAII. Added `findOwnerScopeMemory()` helper that searches GHII + all same-owner agents. Also fixed GET /v1/knowledge/:id to search GHII namespaces for public packages.
- **Unknown content type shows raw i18n key** -- content type badge fell back to `KNOWLEDGE.CONTENTTYPES.GUIDE` for types not in the translation file. Badge now falls back to uppercase raw value for unknown types.

### Added
- **`guide` content type** for knowledge packages -- added to schema, English and Finnish locale files.

## [1.4.1] - 2026-05-16

### Fixed
- **Knowledge packages invisible to agents** -- catalogue endpoint only searched agent GAIIs, missing packages stored under owner GHII (web UI imports). Now searches both GHII and GAII namespaces.
- **MCP `aimeat_knowledge_list` returned empty** -- tool only queried the calling agent's own memory. Now aggregates owner scope (GHII + all same-owner agents), matching the REST API behavior.
- **Knowledge package import rejected `null` URLs** -- AI chats produce `"url": null` for offline references (books, local files). Schema kept strict (string required) as a prompt quality forcing function; the packager prompt now instructs LLMs to use descriptive prefixes (`offline:`, `local:`, `email:`) instead of null.
- **`KNOWLEDGE.VISIBILITY.SHARED` shown as raw i18n key** -- frontend preview rendered AI-generated `"visibility": "shared"` before server normalization. Preview now normalizes `shared` to `owner` before rendering. Added `shared` fallback key to both locale files.
- **Misleading "Shared/Jaettu" label for `owner` visibility** -- renamed to "My Agents/Omat agentit" across all locale files to clarify that `owner` means same-owner agent access, not cross-user sharing.

### Added
- **REST API mapping in bootstrap** (`GET /`) -- new `rest_api_without_mcp` section maps all 17 MCP tool names to their REST equivalents, with notes on `owner_scope`, catalogue vs memory endpoints, and the `/v1/packages` (app store) vs `/v1/catalogue/knowledge` distinction. Agents without MCP support now discover correct endpoints automatically.
- **Knowledge packager prompt improvements** -- visibility descriptions expanded (PUBLIC/OWNER/PRIVATE with scope explanations), `"shared"` explicitly forbidden, new rule #8 for offline reference URL format.

## [1.4.0] - 2026-05-06

### Added
- **"Create Package with AI" prompt** in the Packages tab -- copy-pasteable prompt for Claude Code, VS Code Copilot, or any AI chat that interviews the user, builds and tests components on a live node, and packages the result as a distributable ZIP
- **Package update flow** -- "Check Update" now shows a confirm dialog to apply updates, preserving user data (memory, settings) while replacing apps, extensions, and schemas
- **Packages tab intro section** with title and description (matching all other profile tabs)
- **i18n for package categories** and featured badge in template gallery
- **Auto-activation** of cortex and server extensions on package install (no manual activation needed)
- **Rotation settings** for digital signage -- toggle auto-rotation on/off, configurable speed in seconds

### Fixed
- **Broken `packages.gallery` translation** -- duplicate key in locale files caused "packages.gallery" to render as literal text
- **Instance status renamed** from "active" to "installed" -- avoids confusion with cortex/extension activation status (updated across types, storage, API, OpenAPI spec, CSS, tests, docs)
- **Instance removal now cleans up all components** -- apps, cortex (including lib files, prompts, seed data), CSM, memory, translations are deleted. Previously `removeComponents` was sent as query param but backend read from body; now supports both. Frontend defaults to `true`.
- **ownerGaii mismatch** in package install/delete/migration -- was using bare username instead of full GHII, causing component lookups to fail. Fixed across install, delete, status check, and migration flows.
- **App delete backward compat** -- DELETE/PATCH endpoints fall back to bare owner name for apps created before the GAII fix
- **Admin panel syntax error** in digital signage seed -- `\n` in template literal produced actual newlines breaking inline JS strings
- **App catalog shows empty on first visit** -- `aimeatUrl` defaulted to empty string, now defaults to `window.location.origin` so server apps load without localStorage
- **Upload ZIP button** didn't trigger file picker (HTM template literal handler binding issue)
- **ZIP import auto-publishes** -- uploaded packages now get status `published` instead of `draft`
- **Browse Packages** shows all user's packages, not just published
- **Prompt seeder** now syncs content for both `generator` and `builders` groups on restart

### Improved
- **Digital signage cortex manifest** rewritten with proper `components:` array, `.js` lib filenames, tags, exports, and `api_surface` metadata -- "What's included" section now shows library details
- **Component registrar** preserves lib component fields (filename, exports, api_surface) in cortex registration; passes package metadata (category, tags, description) through to app manifests
- **Cortex component delete** now cleans up lib files, prompts, ontologies, and seed data (previously only deleted the record)

## [1.3.4] - 2026-05-03

### Fixed
- App REST handlers (POST, PATCH, DELETE) now use `resolveIdentity()` to convert bare owner username to full GHII -- fixes 404 on delete for MCP-published apps
- Extension GET endpoint supports `?full=true` for operator export (includes scriptContent)

## [1.3.3] - 2026-05-02

### Added
- **Presigned upload URLs for MCP tools** -- files transfer directly from agent's filesystem to server over HTTPS without passing through the AI context window
  - `aimeat_app_publish`: omit `content_base64` to get upload URL (PUT raw HTML)
  - `aimeat_storage_upload`: omit `data_base64` to get upload URL (PUT raw file)
  - `aimeat_extension_install`: omit manifest/scripts to get upload URL (PUT ZIP)
  - `aimeat_cortex_install`: omit manifest/libs to get upload URL (PUT ZIP)
  - Single-use tokens with 60-minute TTL, size-capped, Ed25519 signed
  - Inline fallback preserved for backward compatibility
- REST routes `POST /v1/apps` and `POST /v1/storage` support `mode: "presigned"` for same flow
- New endpoint: `PUT /v1/upload/:token` -- generic presigned upload receiver
- ZIP format for extension/cortex uploads (manifest.yaml + scripts/ or libs/)
- E2E test suite: 13 tests covering full presigned upload flow
- Developer guide: `docs/coding-guidelines/mcp-uploads.md`

## [1.3.2] - 2026-05-02

### Fixed
- App catalog delete used anonymous token instead of owner JWT -- DELETE always returned 404. Now uses logged-in user's session token for both PORTAL and MCP app removal.

## [1.3.1] - 2026-05-02

### Fixed
- App catalog Published Apps section now shows Remove button for MCP-published apps
- Renamed source badges: "local/server" -> "PORTAL/MCP" (clearer -- both are on server, badge shows where it was published from)
- App publish via MCP uses owner GHII for correct catalog visibility

## [1.3.0] - 2026-05-02

### Added
- **Capability Layer** -- unified abstraction over extensions, cortex, and actions
  - REST API: CRUD, discovery, invoke proxy, telemetry, vouch, test endpoints
  - Storage: SQLite + MongoDB with 38 E2E tests passing on both backends
  - Aggregator: auto-creates capabilities from active extensions/cortex (runs at startup + every 5 min)
  - SDK library: `aimeat-capabilities.js` for browser apps
  - 3 MCP tools: `aimeat_capabilities_list`, `aimeat_capabilities_get`, `aimeat_capabilities_invoke`
  - Admin dashboard tab with detail view, override panel, stats
  - Profile tab with node capabilities listing, source filter, policy display
  - 130+ capabilities auto-aggregated on aimeat.io from 21 extensions + 15 cortex modules

- **19 new MCP tools** (52 -> 72 total)
  - Extension lifecycle: `install`, `get`, `activate`, `deactivate`, `delete` (5)
  - Cortex lifecycle: `list`, `install`, `activate`, `deactivate`, `delete` (5)
  - Capability CRUD: `create`, `update`, `delete`, `vouch` (4)
  - App management: `publish`, `list`, `get`, `delete`, `versions` (5)

- **App catalog server integration** -- Published Apps section now fetches from server, shows apps published via MCP or other devices with source badges (local/server/both)

### Fixed
- `ctx.log` in extension sandbox now callable as function (was object-only, caused "not a function" for scripts using `ctx.log("msg")`)
- Stale closure in extensions-tab.js `onSrvManifestChange` (script code lost when manifest edited)
- YAML quote stripping for auto-extracted script filenames
- Capability aggregator errors now logged instead of silently swallowed
- Capability aggregation runs at startup, not just on cron schedule
- App publish via MCP uses owner GHII (not agent GAII) for correct catalog visibility

### Changed
- Capabilities tab redesigned: shows all node capabilities with source filter, policy settings, how-created explanation (was bare CRUD form)
- Capabilities MenuItem added to profile landing page (new + active/experienced tiers)
- GET /v1/capabilities response includes `policy` object (publishing, publishers, webhooks settings)

## [1.2.6] - 2026-04-30

Previous release.
