# Architecture Guide

## What Is AIMEAT?

**AIMEAT** (AI Memory Exchange and Action Transfer) is an open protocol for AI agent infrastructure. As of the **v4.0 spec re-baseline**, it is understood as two layers:

- **Core** — a thin, generic, federatable protocol: three principals (human GHII, agent GAII, ecosystem-app GEAI), a consent-governed memory + storage, an authorization stack (consent + access-guard + IAM + scoped delegation), collaboration primitives (organisms + workspaces), an economy of *meters* (morsels + real-currency metering) behind a non-mandatory payment interface, and federation whose live use is cross-node identity/login.
- **Platform (aimeat.io)** — what's built on the Core: the app platform (app grants + H-2 origin isolation), the agent fleet operational plane, the sandboxed compute + metered-AI plane (extensions/cortex/scheduler/workflows), and skills/capabilities. This is where most real value lives, because AI-generated apps on generic APIs supplant purpose-built protocol features.

Canonical specs: `docs/AIMEAT-RFC-v4.0-Core-full.md` + `docs/AIMEAT-RFC-v4.0-Platform-full.md` (see `CLAUDE.md` → Spec Documents). This repository contains both the protocol specification and the **reference implementation** (Node.js/TypeScript server, ~130 route modules).

---

## Core Concepts

### Identity Model — GHII, GAII, and Owners

AIMEAT has three identity layers:

**Owner** — the account layer. Created during registration. Has a name, Ed25519 keypair, and roles (`owner`, `operator`). Owners can manage agents and access all their data.

**GHII (Global Human Intelligence Identifier)** — the human profile layer.
Format: `username@node-id` (e.g., `alice@aimeat-finland-001`)
Contains display name, bio, avatar, locale, password hash, TOTP settings. Links to an owner via `ownerName`. GHII is for display and human profile data — it is NOT used for authentication directly.

**GAII (Global AI Identifier)** — the agent identity layer.
Format: `agent#owner@node-id` (e.g., `claude#alice@aimeat-finland-001`)
Each agent has its own Ed25519 keypair, morsel balance, trust score, capabilities, and scopes. Agents belong to owners.

**Authentication rule:**
- **Human users (GHII)** authenticate as **owners**. The JWT has `sub: username`, `roles: ['owner']`, and bypasses scope checks entirely. Owner sessions use the owner's Ed25519 key for JWT refresh.
- **AI agents (GAII)** authenticate as **agents** via device auth (RFC 8628). The owner approves the agent and selects scopes. The JWT has `sub: agent#owner@node`, `roles: ['agent']`, and scopes are enforced.

**Agents are never created implicitly.** When a human registers or logs in, they get an owner session. Agents connect later through the device auth flow, where the owner explicitly approves each agent and its permissions.

```
Owner ("alice")
├── GHII profile (alice@node — display name, bio, avatar)
├── Owner JWT (sub: "alice", roles: ['owner'], scopes: ['*'])
└── Agents (connected via device auth)
    ├── claude#alice@node (roles: ['agent'], scopes: ['memory:*', 'work:*'])
    └── cursor#alice@node (roles: ['agent'], scopes: ['memory:read'])
```

**Agent mode** — every agent carries one of **five** modes that classifies how it is used and which Hello Integration steps apply:

- `autonomous` — runs continuously (Hermes, OpenClaw). Full 16-step Hello Integration (12 required + 4 optional).
- `interactive` — chat/IDE session (Claude Code, Cursor, Cline). Full 16-step Hello Integration. **Default for backward compatibility** when mode is omitted.
- `coordinator` — orchestrates other agents (Claude Desktop, LangGraph supervisor). Treated as `interactive` for onboarding.
- `task-runner` — triggered, runs one task, exits (CrewAI crews). **7-step** flow (authenticate, identify_platform, install_skill, report_capabilities, accept_test_task, complete_test_task, publish_config). No slash-command/message/telemetry steps — but the **test-task pair is KEPT**: a runner isn't "ready" until its subprocess has executed a real test task end-to-end (that IS its capability proof).
- `workstation` — a workstation tool visiting the node via MCP as one tool among many (VSCode, Claude Desktop), NOT node-resident. **4-step** flow (authenticate, identify_platform, report_capabilities, read_directives); the MCP round-trip is its smoke test, so no separate test task.

Mode is set at `POST /v1/agents/device-authorize` and can be changed later via `PATCH /v1/agents/:name/mode` (owner-only). It is independent of `tags` (owner-managed grouping labels) — see [agent-tags.md](agent-tags.md).

### Economy — Meters, Not Currencies

v4.0 reframes the economy as **meters for different kinds of consumption**, not competing currencies:
- **Morsels** — non-cryptocurrency internal token; the quality gate / steering unit (work pricing, board posts, storage overage, offer settlement, welcome bonus + daily allowance).
- **Usage ledger** — real-currency (USD) accounting of actual LLM/model spend (`ledger.ts`, fed by agent telemetry).
- **AI budget** — a USD cap on an owner's own LLM draw through the node's key (`ai-usage.*`).

They meter different things and coexist. The Core provides a **pluggable, non-mandatory payment interface** (intended direction: an HTTP 402 index); the operator decides whether/how to charge and owns KYC.

### Hints — HATEOAS for AI

Every API response includes `hints.next_actions` — telling AI agents what they can do next. This is how the protocol is self-describing.

### Four Tiers of Access

| Tier | Auth | Identity | Access |
|------|------|----------|--------|
| 0 | None | — | Public endpoints (bootstrap, spec, catalogue) |
| 1 | JWT (agent) | GAII | Agent-scoped operations (scopes enforced) |
| 1 | JWT (ecosystem app) | GEAI | App-scoped operations (scopes + data-area allowlist) |
| 2 | JWT (owner) | GHII/Owner | Full access, agent management, admin (scopes bypassed) |

> Tier 0.5 (OTK / keyed-browse) is **deprecated** — a flaky early workaround for AI↔system access, superseded by device auth + MCP. Do not build on it.

---

## System Architecture

```
┌─────────────────────────────────────────────┐
│                  Clients                     │
│  (AI agents, SPA portal, admin dashboard)    │
└──────────────┬──────────────────────────────┘
               │ HTTP/WS
┌──────────────▼──────────────────────────────┐
│              Express 5 Server                │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│  │  Auth   │ │ Envelope │ │ Rate Limiter │  │
│  │Middleware│ │Middleware│ │  Middleware   │  │
│  └────┬────┘ └────┬─────┘ └──────┬───────┘  │
│       └───────────┼──────────────┘           │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │           Route Handlers               │  │
│  │  (~132 files in src/routes/)           │  │
│  └────────────────┬───────────────────────┘  │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │          Business Services             │  │
│  │  (~184 files in src/services/)         │  │
│  └────────────────┬───────────────────────┘  │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │          Storage Interface             │  │
│  │     src/storage/interface.ts           │  │
│  ├──────────┬─────────────┬─────────────────┤  │
│  │  SQLite  │  MongoDB    │  PostgreSQL     │  │
│  │(personal)│ (Prisma)    │  (Prisma)       │  │
│  └──────────┴─────────────┴─────────────────┘  │
└──────────────────────────────────────────────┘
                                                
Valid backends: SQLite, MongoDB, PostgreSQL (all persistent). SQLite =
better-sqlite3; MongoDB + PostgreSQL = Prisma (separate schemas +
generated clients). "In-memory" = SQLite with AIMEAT_DB_PATH=:memory:
(same code path); the old pure in-memory provider is deprecated.
```

---

## Core vs Platform (v4.0 two-layer)

The old "eight pillars" framing is superseded by the v4.0 Core/Platform split. Boundary test: *"would a second, different service also use this?"* → Core; aimeat.io-only → Platform. Full detail in the v4.0 spec docs.

### Core (generic, federatable protocol)

| Domain | Routes | Purpose |
|--------|--------|---------|
| Identity (GHII/GAII/**GEAI**) | `owners.ts`, `agents.ts`, `ghii.ts`, `ecosystem-apps.ts` | Three principals; `resolveIdentity`; device auth + owner OAuth/TOTP |
| Verification | `verification.ts`, `totp.ts`, `oauth-login.ts` | EUDIW / DID / VC / FTN identity assurance |
| Memory & Storage | `memory.ts`, `storage-files.ts`, `schemas.ts` | Key-value + files, visibility tiers (private/owner/group/members/public/workspace), schema-lock |
| Authorization | `consent.ts`, `access-guard` (service), `sharing-groups.ts`, IAM (service) | Consent + runtime read-guard + capability model + scoped delegation |
| Collaboration | `organisms.ts` (+ workspaces within), `knowledge.ts`, `librarian.ts` | Organisms + **workspaces** (the shared living surface), knowledge + links |
| Economy & Metering | `wallet.ts`, `actions.ts`, `work.ts`, `disputes.ts`, `ledger.ts` | Morsels (quality gate) + USD usage ledger; actions = backing primitive |
| Federation | `federation*.ts`, `personal.ts`, `connect-tunnel.ts` | Peering + **cross-node identity/login** + personal/connector tunnels |
| Observability | `stats.ts`, `admin-*` routes | Monitoring, telemetry, config |

### Platform (built on the Core — see `AIMEAT-RFC-v4.0-Platform-full.md`)

| Cluster | Routes | Purpose |
|---------|--------|---------|
| App platform | `apps.ts`, `app-store.ts`, `app-grants.ts`, `subdomains.ts`, `libs.ts`/`lib-*.ts` | Hosted apps, scoped grants, H-2 origin isolation, served browser SDK |
| Agent fleet plane | `agent-onboarding.ts`, `agent-tasks.ts`, `agent-directives.ts`, `agent-telemetry.ts`, `presence.ts` | Onboard/task/direct/meter/observe real agents |
| Compute & metered AI | `extensions.ts` (QuickJS-WASM), `cortex.ts`, `ai.ts`, `openrouter.ts`, `schedules.ts`, `workflows.ts` | Sandboxed logic, owner-LLM proxy, clock, pipelines |
| Skills & capabilities | `skills.ts`, `capabilities.ts` | Installable competence; capability invoke + vouch |
| Ecosystem (GEAI) | `ecosystem-apps.ts`, `ecosystem-events.ts` | External apps + event plane |
| Realtime UX | `sse.ts`, `notifications.ts`, `push.ts`, `realtime.ts`, `public-events.ts` | Live updates, push, WebRTC |

**Deprecated / removal (do not build on):** `micro-memory.ts`, OTK / Tier 0.5 (in `auth.ts`), legacy Ed25519 challenge-response (`POST /v1/auth/token`), `boards.ts` (legacy — apps supplant it), `foundry.ts` (a fork of `generator.ts` — to be removed; `generator.ts` itself is a minimal legacy tool). `marketplace.ts` was already removed.

---

## Subsystem Reference

Short architectural notes on the subsystems that grew up since the original "eight pillars." Full normative detail in the v4.0 spec docs; this is the map. **The center of gravity of real usage is here, not in federation.**

### Collaboration — Organisms & Workspaces (Core)

The substrate for nearly all shared work, built entirely on the generic memory API (no per-object-type endpoints).
- **Organism** (`organisms.ts`) — a membership-gated group (team, club, cooperative, project); content keyed `organism.{id}.*` but owned by the contributing member's GHII.
- **Workspace** (inside `organisms.ts`; `organism.{id}.w.{ws}.*`) — a shared, **versioned, access-gated record space**: draft → publish → version, per-workspace member grants (viewer/contributor), manifest-driven aggregated read, engagements, activity, dangling-ref scan. This is the **"shared living surface"** — humans, agents, and apps mutating the same records concurrently, fanned out by live updates.

### Applications & the App Platform (Platform)

Hosted single-file apps that reach owner data **only** through the Core APIs under a scoped grant — never with ambient session authority.
- **Apps** (`apps.ts`, `app-store.ts`, `app-templates.ts`, `apps-backup.ts`) — catalog, versioning, drafts, fork+lineage, store purchase (morsel-settled), backup ZIP.
- **App grants** (`app-grants.ts`) — an OAuth/PKCE flow issuing short-lived, scoped `role:'app'` tokens that resolve to the owner's data identity but are fenced to the user-approved scopes (realizes Core "scoped delegation"). Apps are **identity-bearing principals**.
- **H-2 origin isolation** (`subdomains.ts`) — apps run on `*.apps.<apex>`, isolated from the portal session; depends on host-only auth cookies + CSP `frame-ancestors`.
- **Served browser SDK** (`libs.ts`, `lib-*.ts`) — the node serves `aimeat-auth/data/storage/social/wallet/organism/…` JS to apps and cortex; the de-facto AIMEAT SDK.

### Ecosystem Apps — GEAI (Platform)

External applications (`ecosystem-apps.ts`, `ecosystem-events.ts`) onboarded via a device-auth-style hello→approve→token with TOFU key pinning + a scope + data-area allowlist, writing into their own `eco:` namespace and **consented like agents**. The third principal type (`eco:{app}#owner@node`); an event plane feeds the workflow engine's `ecosystem.event` trigger. Canonical guide: `docs/building-an-aimeat-compatible-ecosystem-app.md`.

### Agent Fleet Plane (Platform)

Where "operate real AI agents" lives — the deepest-churned cluster. The owner→agent **task** lifecycle draft→queued→active→done/failed (`agent-tasks.ts`), directives incl. the optional Secretary (`agent-directives.ts`), telemetry→ledger (`agent-telemetry.ts`), agent↔agent DMs (`agent-messages.ts`), presence (`presence.ts`), and webhooks (`agent-webhook.ts`). Fleets attach via the connector tunnel or personal node.

#### Hello Integration (agent onboarding)

An agent connects via device auth, then walks a mode-keyed onboarding step machine (`agent-onboarding.ts`, `models/agent-onboarding-schemas.ts`). The full flow is **16 steps: 12 required + 4 optional** (for `autonomous`/`interactive`/`coordinator`). Reduced flows: **`task-runner` = 7 steps** (keeps the test-task pair — see mode list above), **`workstation` = 4 steps** (auth + platform + capabilities + directives; the MCP round-trip is its smoke test). The **12 required** steps of the full flow: `authenticate` → `identify_platform` → `install_skill` → `report_capabilities` → `read_directives` → `send_test_message` → `configure_delivery` → `report_telemetry` → `accept_test_task` → `complete_test_task` → `publish_commands` → `publish_config`. The **4 optional** steps: `declare_services` + the offers ladder `declare_offerings` / `make_workflow_compatible` / `price_offer`. Readiness completes when all required steps pass; the node drives each pending step deterministically via a `step_guide`. Agent-side counterpart: `docs/building-an-aimeat-compatible-agent.md`.

#### Capability measurement & verification (why this matters)

An agent doesn't just *claim* what it can do — it must *prove* it, which is essential for **interactive and externally-supplied agents**.
- **Declaration** — `PUT /v1/agents/:name/capabilities` (`agent-capabilities.ts`): technical (MCP servers, skills, tools), domain expertise, languages. **MCP-type capabilities are auto-verified** because an agent session implies a live MCP connection (`verified = isAgentSession && cap.type === 'mcp'`).
- **Proof** — the onboarding **test task** (`accept_test_task` → `complete_test_task`, steps 9–10) makes the agent actually run the real read→propose-todos→execute→complete loop over its own transport. This is the true gate. In practice this is where platforms diverge: **Grok has failed the interactive test-task proof, while Claude, CrewAI-driven agents, Hermes, and OpenClaw pass it.** Capability + trust (see Trust, above) together decide what work an agent is allowed to take.

### Agent Runtime & Desktop — crewaimeat / aimeat-agency (ecosystem)

The agents that connect through Hello Integration are produced and run by a companion runtime, partly in this repo and partly in a sibling repo:
- **`python/aimeat-crewai/`** (in THIS repo) — the pip-installable **liaison/connector**: a CrewAI integration mirroring the node contract (`liaison.py`, `mcp_client.py`, `daemon.py`, `offers.py` + `workflow_spec.py`, `cli.py`). It has its own version line (tag-triggered PyPI). The **node schema wins** on any mismatch (`offer-schemas.ts`, `workflow-schemas.ts`).
- **crewaimeat runtime** (separate repo `miikkij/crewaimeat`, local `e:/dev/GitHub/crewfive`) — the fleet runtime + a library of **crew templates** (`crews/` — app-builder, app-conductor, app-designer, extension-builder, realtime-builder, crew-forge, …) and the daemon that runs them.
- **aimeat-agency** (`crewfive/aimeat-agency`) — a **Tauri desktop appliance** (over a local Python FastAPI) that installs agents **directly to the user's desktop**, ships **40+ ready-to-use agent/crew templates**, and connects each to a node via Hello Integration. Shipped as the signed **aimeat-desktop installer** (Authenticode via `release-desktop.yml`).

Keep the Python liaison in sync when agent-facing contracts change (offers, workflow signals, onboarding, MCP surface) — the node schema is canonical.

### Programmable Compute & Metered AI (Platform)

- **Extensions** (`extensions.ts`) — server-side action scripts in a **QuickJS-WASM** sandbox with a scoped ctx (memory/fetch-through-SSRF-guard/wallet/consent), encrypted secrets, and cron. Own the `ext:{name}` namespace.
- **Cortex** (`cortex.ts`) — materializes a manifest's schemas/prompts/actions and serves browser IIFE lib bundles.
- **Metered AI proxy** (`ai.ts`, `openrouter.ts`) — the owner's encrypted LLM key exposed as a **metered, scoped, consent-gated resource** (`ai:use` scope, per-owner USD budget, provider allowlist).
- **Scheduler** (`schedules.ts`) — recurring jobs on a server-owned clock (extension / ai / agent_task / eco-capability).
- **Workflows** (`workflows.ts`) — declared, DAG-validated agent pipelines with per-step input/output **signals** ("did it produce"); deterministic engine with runs/cancel.

### Economy — Offerings, Work, Tasks, Ledger

The atomic primitive is an **action** (`actions.ts`, a callable unit of work); it is rarely invoked directly — everything else is a manifestation of it:
- **Offerings** (`models/offer-schemas.ts`) — the billable, discoverable face of a service (morsel-priced `callable`, workflow signals). The marketplace surface.
- **Work queue** (`work.ts`, `disputes.ts`) — escrow settlement-on-delivery + dispute state machine; live but low-traffic.
- **Agent tasks / engagements** — fleet assignment (above), **not** morsel-priced.
- **Trust** (`trust.ts`) — auto-computed 0–100 reputation, gates paid actions.
- **Ledger / metering** (`ledger.ts`) — real-currency (**USD**) accounting of actual LLM spend, fed by agent telemetry; a separate *meter*, not a competing currency (see "Economy — Meters, Not Currencies" above). Budgets + CSV billing export behind a *pluggable, non-mandatory* payment interface.

### Skills & Capabilities (Platform)

- **Skills** (`skills.ts`, `agent-skill-bundle.ts`) — a SKILL.md-pack registry (node + user scopes); agents link skills, connectors materialize them, per-runtime ZIP bundles download (incl. a claude.ai/`~/.claude/skills` form). One choke point `resolveSkillRef` (scopes/refs/`@semver`, app-bound skills). This is the "install competence into an AI in seconds" acceleration.
- **Capabilities** (`capabilities.ts`) — an agent capability registry with discovery, an **invoke proxy**, telemetry, and peer **vouch** (attestation) — an action exposed as a first-class, vouchable unit.

### Knowledge & Retrieval (Core + convenience)

- **Knowledge** (`knowledge.ts`) — importable packages + a graph of typed **links** with reputation/operator review.
- **Librarian** (`librarian.ts`) — one ranked natural-language search (FTS, not vector) across every organism + personal memory; app-grant-gated.

### Live Surface (Platform)

`sse.ts` (authenticated, typed, owner-scoped live updates — one shared connection, subscribe via `onLiveUpdate`, never poll), `public-events.ts` (unauthenticated landing feed), `notifications.ts` (bell inbox), `push.ts` (VAPID), `realtime.ts` (WebRTC/Yjs, flagged). These make the shared living surface actually *live*.

### Portal Product Surfaces (ecosystem — thin here by design)

Shipped user-facing surfaces in the portal that are *clients* of the generic APIs (hence not first-class protocol concepts), listed for completeness so the map isn't misleading:
- **Notebook** (`notebook-tab.js`, `services/notebook-*.ts`) — free-text capture → AI classify/enrich → distribute into organisms; a primary consumer of the librarian.
- **Living Docs** (`living.ts`) — AI author for plain-language → living-document templates.
- **Portfolio** (`portfolio.ts`, `lib-portfolio-standalone.ts`) — per-user public portfolio builder + content catalog + themes.
- **Matching** (`matches.ts`) — consent-gated shared-interest matching between owners (also an admin tab).
- **Packages & Instances** (`packages.ts`, `instances.ts`) — the **package marketplace** (versioned CRUD, export/import, reviews) + install-and-track running **instances**. Distinct from knowledge/skill packs; this is the v3-era package system.
- **Chat Sessions** (`chat-instances.ts`) — a persisted store of live chat-session registrations.
- **Calibrator** (`calibrator.ts`) — a prompt-calibration workbench (projects/versions/batches, LLM editor, charts).
- **Personal Access Tokens** (`access-tokens.ts`) — owner-minted PATs, a non-device-auth credential path for agents/scripts.
- **Moderation** (`flags.ts`, `appeals.ts`) — content flagging + appeal workflow (distinct from work disputes).
- **app-catalog** (`src/static/app-catalog/` + `app-catalog.html`) — a pre-built **esbuild** static catalog app shell, distinct from the DB-backed `apps.ts`/`app-store.ts` store; edit the sources under `src/static/app-catalog/`, not the built file.

### Operator Admin Dashboard (the one SSR exception)

A single operator control plane (`admin-*.ts`, ~17 routes; `public/views/admin/`, ~45 tabs) — the deliberate exception to the no-SSR rule. Tab groups:
- **Node** — Overview, Economy, Config, Security, CORS, Maintenance, Hooks, Portal, Subdomains, Statistics, Usage, System Prompts.
- **Identity** — Owners, Agents, GHII Users, Agent Integration.
- **Data** — Actions, Boards, Chat Instances, Realtime, Work, Direct Messages, Memory, Agent Tasks, Sharing Groups, All Capabilities, Applications.
- **Infrastructure** — Email, Push, Consul (centralized config), Scheduler, Generator Debug.
- **Services** — Directory, Matching, Services, Cortex Extensions, CSM Management, Knowledge, Skills, Packages.
- **Integrations / Federation** — MSM Management, Federation, Genesis Peers.

The dashboard is operator-only tooling (it does not define protocol); it exposes/curates the same generic APIs the rest of the system uses.

---

## Backend Design Principles

### NO Server-Side Rendering

The backend is **protocol-only**. Every route provides a generic, reusable API endpoint.

**Rules:**
1. No `res.send('<html>...')` in route handlers.
2. Every new route must be generic — "Would a second, different service also use this endpoint?"
3. No per-service backend files (e.g., no `portal-hobbies.ts`).
4. Admin dashboard is the ONE exception (operator tooling).
5. If data is available via an existing API, don't wrap it.

### Generic API Design

AIMEAT's architecture: **CSM defines data shape + rules → Generic APIs handle storage/consent/validation → Clients render UI.**

Any service (hobby directory, marketplace, dating, news) is just a client reading a CSM definition and talking to generic APIs. No per-service backend code.

---

## Directory Structure

### Monorepo layout (top level)

```
aimeat-protocol/                  pnpm workspace (root package.json proxies to aimeat/)
├── openapi.yaml                  canonical API contract (OpenAPI 3.1) — keep in sync (Rule 3)
├── CLAUDE.md                     AI-assistant instructions (mandatory rules)
├── startup.prompt.md             paste-to-AI repo bootstrapping prompt (README-linked)
├── .github/                      CI (ci.yml) + release workflows (release-desktop.yml)
├── .githooks/                    pre-commit gate: lint / typecheck / typecheck:frontend /
│                                 check:importmap / check:no-max-tokens / check:app-catalog
├── aimeat/                       ★ the reference implementation (Node 24 / TS / Express 5)
│   ├── src/                      backend (see tables below) — ~132 routes, ~184 services
│   ├── public/                   Preact + HTM SPA, no build step
│   ├── prisma/                   schema.prisma (Mongo) + schema.postgres.prisma
│   ├── locales/                  en.json / fi.json (Rule 4: keep in sync)
│   ├── test/                     E2E suites + run-e2e-ci.ts orchestrator
│   ├── tools/                    dev tools (synthtraces self-play harness)
│   ├── scripts/  bin/            build/ops scripts, `aimeat` CLI entry
│   ├── eslint-rules/             custom lint rules (file headers, no-max-tokens)
│   ├── Dockerfile  docker-compose.{,postgres,sqlite}.yml
│   └── docs/                     implementation-local docs (integrations/…)
├── python/aimeat-crewai/         ★ pip-installable CrewAI liaison/connector (own PyPI line)
│   └── src/aimeat_crewai/        liaison.py, mcp_client.py, daemon.py, offers.py, cli.py
├── aimeat-desktop/               ★ Tauri desktop app (Personal Node installer): src/ + src-tauri/
├── packages/                     hosted app SOURCE (agent-kanban, club-board, digital-signage…)
│                                 + build scripts (build-*.mjs); built .zip bundles are gitignored
├── assets/                       brand/design assets, logos, mockups, screenshots
└── docs/                         protocol spec (v4.0 Core/Platform) + coding-guidelines/ + guides
```

The agent **runtime** (fleet daemon + 40+ crew templates) is the sibling repo `miikkij/crewaimeat` (not vendored here); `python/aimeat-crewai/` is the in-repo connector it builds on, and `aimeat-desktop` ships those agents to the user's machine.

### Backend (`aimeat/src/`)

| Directory | Purpose |
|-----------|---------|
| `auth/` | JWT, keypair generation, auth middleware, session management |
| `cli/` | CLI wizards (init wizard, config display) |
| `generated/` | Auto-generated types from OpenAPI spec |
| `middleware/` | Response envelope, rate limiting, CORS, idempotency, request-id |
| `models/` | Data model schemas |
| `routes/` | Express route handlers (one file per domain, ~132 files) |
| `schemas/` | JSON schema validation |
| `server-bootstrap/` | Server initialization modules (config, services, middleware, routes) |
| `services/` | Business logic (~184 files) |
| `static/` | Static assets served directly |
| `storage/` | Data layer abstraction + implementations |
| `storage/providers/` | Database adapters (SQLite, MongoDB) |
| `storage/repositories/` | Record-specific data access (36 repositories) |
| `types/` | TypeScript type definitions |
| `utils/` | Utilities (logger, GAII, env config, env validator) |

### Frontend (`aimeat/public/`)

| Directory | Purpose |
|-----------|---------|
| `css/` | Theme + per-view scoped CSS |
| `components/` | Shared Preact components (Alert, Card, Modal, etc.) |
| `js/` | Shared modules (api.js, i18n.js, utils.js) |
| `js/services/` | API service layers (admin.js) |
| `lib/` | Self-hosted libraries (Preact, HTM, Three.js) |
| `views/` | Lazy-loaded view modules |
| `views/admin/` | Admin dashboard tab components |
| `locales/` | i18n translations (en.json, fi.json) |

### Documentation (`docs/`)

| Directory | Purpose |
|-----------|---------|
| `docs/01-core.md` through `docs/09-community.md` | RFC specification sections |
| `docs/coding-guidelines/` | Development standards (this folder) |
| `docs/frontend-development-guide.md` | Frontend architecture and conventions |
| `docs/testing/` | Test plans (T-1 through T-9) |
| `docs/plans/` | Implementation plans and roadmaps |
| `docs/msm-examples/` | Service manifest examples |
| `docs/mermaidjs/` | Sequence diagrams |
| `docs/hello-world/` | Getting started guides |

### Tests (`aimeat/test/`)

| Pattern | Purpose |
|---------|---------|
| `api-full.ts` | Core API integration tests (35 tests) |
| `e2e-*.ts` | Feature-specific E2E suites (18 suites) |
| `run-e2e-ci.ts` | CI test orchestrator |
| `docker/` | Containerized test runner |
| `playwright/` | Frontend E2E tests |

---

## Storage Architecture

### Repository Pattern

The storage layer uses a repository pattern with provider abstraction:

```
Storage Interface (interface.ts)
    ├── Repositories (36 domain-specific repos)
    │   ├── owner.repository.ts
    │   ├── agent.repository.ts
    │   ├── memory.repository.ts
    │   └── ... (33 more)
    └── Providers (database adapters, src/storage/providers/)
        ├── SQLite (better-sqlite3; personal + fast iteration, incl. :memory:)
        ├── MongoDB (Prisma; production)
        └── Postgres (Prisma; production — separate schema.postgres.prisma + generated client)
```

### Storage Factory

`src/storage/storage-factory.ts` creates the appropriate provider based on config:
- `AIMEAT_STORAGE=sqlite` → Better-sqlite3 (use `AIMEAT_DB_PATH=:memory:` for ephemeral, same code path)
- `AIMEAT_STORAGE=mongodb` → MongoDB via Prisma
- `AIMEAT_STORAGE=postgresql` (alias `postgres`) → PostgreSQL via Prisma, `DATABASE_URL=postgresql://…`

> The old pure in-memory provider is **deprecated** — SQLite `:memory:` covers the fast/ephemeral role using the real SQL code path. Valid backends: **SQLite, MongoDB, PostgreSQL**. Note MongoDB and PostgreSQL are distinct Prisma backends (`schema.prisma` vs `schema.postgres.prisma`) — a data-model change must update both schemas + regenerate both clients.

---

## Read-Cache Layer (`services/cache.ts`)

A few read endpoints recompute the same expensive result on every page load / poll (owner usage
summary, memory counts, catalogue scans). `services/cache.ts` is a tiny process-local TTL cache with
tag-based invalidation that those hot paths opt into with one call. The node is a single Express
process (federation/relay coordinate out-of-band, not via shared app cache), so a plain in-process
`Map` is coherent — **do not** add Redis/memcached/lru-cache.

**When to reach for it:** a read that (a) recurs on every load/poll and (b) is materially more
expensive than a `Map` lookup (full scans, byte-sums, multi-query aggregation). One-off reads, writes,
and anything not measurably hot don't need it.

```ts
import { cached, TTL } from '../services/cache.js';
const summary = await cached(`usage:${owner}`, TTL.dashboard,
  () => computeOwnerUsageSummary(config, storage, owner),
  [`owner:${owner}:memory`, `owner:${owner}:files`, `domain:memory`, `domain:files`]);
```

**Keying convention:** include the owner/GAII in the key for anything identity-scoped (one user must
never read another's cached value); include any filter params (prefix/visibility) so different filters
don't collide. Global (non-identity) data omits the owner segment.

**Tagging convention:** tag entries with `domain:<d>` (+ `owner:<owner>:<d>` when identity-scoped) for
each domain whose writes should drop the entry. The event bus is wired centrally in
`server-bootstrap/routes-loader.ts` to translate every `emitChange(domain, ownerGaii?)` into
`invalidateTag('domain:<d>')` (plus the owner-scoped tag when the write carries an owner). TTL is the
backstop; tags are the precise drop. Many write paths broadcast `emitChange(domain)` *without* an
owner, so the broad `domain:<d>` tag is the safety net — always include it. Cache health
(`entries`/`tags`/`evictions`) is exposed in `GET /v1/stats` gauges.

---

## Federation

Nodes can federate to form a decentralized network. The default config ships **peerless**; a federated deployment is established by peering explicitly (real topology: a home/personal node ↔ aimeat.io ↔ a peer's node).

- **Cross-node identity/login (the live use)**: once peered, owners are recognizable on a peer and can log into each other's systems with their own credentials, subject to each node's consent + access-guard.
- **Peering**: bilateral request → test → approve → activate → key exchange.
- **Sync/replication**: delta catalogue sync + push/pull memory replication for `public` + federation-consented data (built, exercised once peers exist).
- **Relay / genesis / trust broadcasts**: optional and, by default, dormant (relay is receive/settlement-side only; multi-hop not constructed). Treat as an advanced profile.
- **Personal node / connector tunnel**: a machine behind a home connection participates via a parent tunnel (`personal.ts`) or an outbound per-principal WebSocket (`connect-tunnel.ts`) that lets a local agent fleet act through the hosted node.

---

## Configuration

Configuration comes from multiple sources (in priority order):

1. CLI arguments (`--db mongodb`, `--port 40050`)
2. Config file (`--config production.ini`)
3. Environment variables (`AIMEAT_*`)
4. Consul (centralized config management)
5. Defaults in `src/config.ts`

See `.env.example` for all 80+ configuration options with documentation.

See `docs/b-config.md` for the complete configuration schema reference.

---

## Backend is protocol-only — SSR removal history

The AIMEAT backend never renders HTML (see the "NO Server-Side Rendering" rule in `CLAUDE.md`). This section records how the codebase reached that state.

### SSR removal — COMPLETED (2026-03-03)

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
- Static HTML files in `public/` are NOT directly accessible by filename.
- They are served inline at canonical `/v1/` URLs via backward-compatible routes in `portal.ts`.
- Direct access to e.g. `/human.html` returns 301 redirect to `/v1/portal`.
- Route map: `/v1/portal` → human.html, `/v1/profile` → profile.html, `/v1/guides` → guides.html, `/v1/aimeat-os` → aimeat-os.html, `/v1/hobbies` → hobbies.html, `/v1/marketplace` → marketplace.html

**Phase 1 gap closure (2026-03-04):**
- `setup.ts` + `public/wizard.html` — first-run web wizard (5-step node setup)
- Memory `flagCount` field + `max_flags` query filter — Phase 1.5 flag integration
- `profile.html` Data Wallet tab — consents list, audit report, GDPR export
- `hobbies.html` #matches view — shows people with shared interests
