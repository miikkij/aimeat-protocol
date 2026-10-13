# Architecture Guide

## What Is AIMEAT?

**AIMEAT** (AI Memory Exchange and Action Transfer) is an open protocol for AI agent infrastructure. The v4.0 specification describes it as two layers:

- **Core**: a thin, generic protocol that nodes can federate. It has three principals (human GHII, agent GAII, ecosystem app GEAI), consent-governed memory and file storage, an authorization stack (consent, access guard, IAM and scoped delegation), collaboration primitives (organisms and workspaces), an economy of *meters* (morsels and real-currency metering) behind an optional payment interface, and federation, whose live use is cross-node identity and login.
- **Platform (aimeat.io)**: what is built on the Core. The app platform (app grants and H-2 origin isolation), the agent fleet plane, sandboxed compute with metered AI (extensions, cortex, scheduler, workflows), and skills and capabilities. Most of the value a person gets is here, because AI-generated apps on generic APIs replace purpose-built protocol features.

The specification is [AIMEAT Core 2026-11](../AIMEAT-Core-2026-11.md), normative from node 4.0.0, with its [conformance evidence](../AIMEAT-Core-2026-11-evidence.md); the [Platform reference](../AIMEAT-Platform-reference.md) describes what the node builds on it. Until 4.0.0, [Core v4.0](../AIMEAT-RFC-v4.0-Core-full.md) and [Platform v4.0](../AIMEAT-RFC-v4.0-Platform-full.md) stay as published, corrected by the [errata](../AIMEAT-RFC-v4.0-errata.md). The API contract is [openapi.yaml](../../openapi.yaml). This repository holds the specification and the reference implementation, a Node.js and TypeScript server under `aimeat/`.

---

## Core Concepts

### Current agent paths

Device authorization remains supported. Agent v2 adds daemon enrollment,
signed cards, short-lived token exchange, messages, task handles and migration.
See [the agent guide](../building-an-aimeat-compatible-agent.md) and
[agents-v2.ts](../../aimeat/src/routes/agents-v2.ts). Read an agent's identity
version before choosing its authentication or delivery path.

The identity-wallet verification path is blocked at startup. Its earlier design
is not a deployable verification feature. See [the current status](../aimeat-eudiw-integration.md).

### Identity Model: GHII, GAII, and Owners

AIMEAT has three identity layers:

**Owner**: the account layer. Created during registration. Has a name, an Ed25519 public key and roles (`owner`, `operator`). Owners manage agents and reach all their data.

**GHII (Global Human Intelligence Identifier)**: the human profile layer.
Format: `username@node-id` (for example `alice@aimeat-finland-001`).
Holds display name, bio, avatar, locale, password hash and TOTP settings. Links to an owner through `ownerName`. The GHII is also the identity a person's records are stored under (`resolveIdentity` turns the owner session's bare name into it); the session itself authenticates as the owner.

**GAII (Global AI Identifier)**: the agent identity layer.
Format: `agent#owner@node-id` (for example `claude#alice@aimeat-finland-001`).
Each agent has its own Ed25519 keypair, trust score, capabilities and scopes. The human owner's GHII holds the morsel balance; an agent's balance stays zero.

**Authentication:**
- **Human users (GHII)** authenticate as **owners**. The JWT has `sub: username` and `roles: ['owner']`, and scope checks pass for it. Owner refresh uses the session lifecycle in `routes/auth.ts`.
- **AI agents (GAII)** authenticate as **agents** through device authorization (RFC 8628). The owner approves the agent and selects its scopes. The JWT has `sub: agent#owner@node` and `roles: ['agent']`, and scopes are enforced.

In route code, ask the caller object for these facts instead of reading the token: see [identity-model.md](identity-model.md) and `.claude/rules/security.md`.

**Agents are never created implicitly.** When a human registers or signs in, they get an owner session. Agents connect later through device authorization, where the owner approves each agent and its permissions.

```
Owner ("alice")
├── GHII profile (alice@node: display name, bio, avatar)
├── Owner JWT (sub: "alice", roles: ['owner'], scopes: ['*'])
└── Agents (connected through device authorization)
    ├── claude#alice@node (roles: ['agent'], scopes: ['memory:*', 'work:*'])
    └── cursor#alice@node (roles: ['agent'], scopes: ['memory:read'])
```

**Agent mode**: every agent carries one of **five** modes. The mode says how the agent is used and which Hello Integration steps apply (`AgentMode` in `models/agent-onboarding-schemas.ts`):

- `autonomous`: runs continuously (Hermes, OpenClaw). Full 16-step Hello Integration (12 required, 4 optional).
- `interactive`: a chat or IDE session (Claude Code, Cursor, Cline). Full 16-step Hello Integration. **The default** when the mode is omitted.
- `coordinator`: orchestrates other agents (Claude Desktop, a LangGraph supervisor). Treated as `interactive` for onboarding.
- `task-runner`: triggered, runs one task, exits (CrewAI crews). **7 steps**: authenticate, identify_platform, install_skill, report_capabilities, accept_test_task, complete_test_task, publish_config. It has no slash-command, message or telemetry steps, but it **keeps the test-task pair**: a runner is not ready until its subprocess has run a real test task end to end, which is its capability proof.
- `workstation`: a tool on the person's own machine that visits the node over MCP as one tool among many (VS Code, Claude Desktop), and is not node-resident. **4 steps**: authenticate, identify_platform, report_capabilities, read_directives. The MCP round trip is its smoke test, so there is no separate test task.

The mode is set at `POST /v1/agents/device-authorize` and changed later with `PATCH /v1/agents/:name/mode`, by the owner or by an agent of the same owner that holds `agent:write` (a crew sets its own mode at startup this way). It is independent of `tags` (owner-managed grouping labels): see [agent-tags.md](agent-tags.md).

### Economy: Meters, Not Currencies

v4.0 describes the economy as **meters for different kinds of consumption**:
- **Morsels**: an internal pacing unit, not a cryptocurrency. They pace what agents push into the store (work pricing, board posts, storage overage, offer settlement, welcome bonus and daily allowance).
- **Usage ledger**: real-currency (USD) accounting of actual LLM and model spend (`ledger.ts`, fed by agent telemetry).
- **AI budget**: a USD cap on an owner's own LLM use through the node's key (memory under `ai-usage.*`).

They meter different things and coexist. The Core provides an **optional, pluggable payment interface** (intended direction: an HTTP 402 index); the operator decides whether and how to charge, and owns KYC.

### Hints: HATEOAS for AI

Every API response includes `hints.next_actions`, which tells an AI agent what it can do next. This is how the protocol describes itself.

### Four Tiers of Access

| Tier | Auth | Identity | Access |
|------|------|----------|--------|
| 0 | None | none | Public endpoints (bootstrap, spec, catalogue) |
| 1 | JWT (agent) | GAII | Agent-scoped operations (scopes enforced) |
| 1 | JWT (ecosystem app) | GEAI | App-scoped operations (scopes and data-area allowlist) |
| 2 | JWT (owner) | GHII/Owner | Full access, agent management, admin (scopes pass) |

> Tier 0.5 writes and micro-memory were removed on 2026-08-23. Boards are current and were reinstated on 2026-08-30.

---

## System Architecture

```
┌─────────────────────────────────────────────┐
│                  Clients                     │
│  (AI agents over REST and MCP, SPA portal)   │
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
│  │  src/routes/, one file per domain      │  │
│  └────────────────┬───────────────────────┘  │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │          Business Services             │  │
│  │  src/services/                         │  │
│  └────────────────┬───────────────────────┘  │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │          Storage Interface             │  │
│  │     src/storage/interface.ts           │  │
│  ├──────────────────┬─────────────────────┤  │
│  │  PostgreSQL      │  SQLite             │  │
│  │  (Kysely; prod)  │  (better-sqlite3)   │  │
│  └──────────────────┴─────────────────────┘  │
└──────────────────────────────────────────────┘
```

Two backends are valid: PostgreSQL with Kysely (production) and SQLite (personal nodes and fast iteration). An in-memory node is SQLite with `AIMEAT_SQLITE_PATH=:memory:`, on the same code path. The Prisma backends (MongoDB and legacy Prisma-PG) were removed on 2026-07-16.

`src/server.ts` (`createServer()`) builds the HTTP stack, and `mountRoutes()` in `src/server-bootstrap/routes-loader.ts` mounts every router in order. Two siblings hold groups moved out of it: `routes-loader-ai.ts` and `routes-loader-outbound.ts`.

---

## Core vs Platform (v4.0 two-layer)

The boundary test is *"would a second, different service also use this?"*. If yes, it is Core; if only aimeat.io uses it, it is Platform. The v4.0 specification has the full detail. File names below are under `aimeat/src/routes/` unless the row says otherwise; a large domain has a directory of the same name beside its file.

### Core (generic, federatable protocol)

| Domain | Routes | Purpose |
|--------|--------|---------|
| Identity (GHII/GAII/**GEAI**) | `owners.ts`, `agents.ts`, `ghii.ts`, `ecosystem-apps.ts` | Three principals; `resolveIdentity`; device authorization, owner OAuth and TOTP |
| Verification | `verification.ts`, `totp.ts`, `oauth-login.ts` | EUDIW, DID, VC and FTN identity assurance |
| Memory and storage | `memory.ts`, `storage-files.ts`, `schemas.ts` | Key-value records and files, visibility tiers (private/owner/group/members/public/workspace), schema lock |
| Authorization | `consent.ts`, `sharing-groups.ts`, the access guard and IAM services | Consent, runtime read guard, capability model, scoped delegation |
| Collaboration | `organisms.ts` (workspaces inside it), `knowledge.ts`, `librarian.ts` | Organisms and **workspaces** (the shared living surface), knowledge and links |
| Economy and metering | `wallet.ts`, `actions.ts`, `work.ts`, `disputes.ts`, `ledger.ts` | Morsels (pacing) and the USD usage ledger; actions are the backing primitive |
| Federation | `federation*.ts`, `personal.ts`, `connect-tunnel.ts` | Peering, **cross-node identity and login**, personal-node and connector tunnels |
| Observability | `stats.ts`, `admin-*.ts` | Monitoring, telemetry, configuration |

### Platform (built on the Core: see the Platform specification)

| Cluster | Routes | Purpose |
|---------|--------|---------|
| App platform | `apps.ts`, `app-store.ts`, `app-grants.ts`, `subdomains.ts`, `libs.ts` | Hosted apps, scoped grants, H-2 origin isolation, the served browser SDK |
| Agent fleet plane | `agent-onboarding.ts`, `agent-tasks.ts`, `agent-directives.ts`, `agent-telemetry.ts`, `presence.ts` | Onboard, task, direct, meter and observe real agents |
| Compute and metered AI | `extensions.ts` (QuickJS-WASM), `cortex.ts`, `ai.ts`, `openrouter.ts`, `schedules.ts`, `workflows.ts` | Sandboxed logic, owner LLM proxy, clock, pipelines |
| Skills and capabilities | `skills.ts`, `capabilities.ts` | Installable competence; capability invoke and vouch |
| Ecosystem (GEAI) | `ecosystem-apps.ts`, `ecosystem-events.ts` | External apps and their event plane |
| Realtime UX | `sse.ts`, `notifications.ts`, `push.ts`, `realtime.ts`, `public-events.ts` | Live updates, push, WebRTC |

**Removed:** micro-memory, the OTK write routes, the Generator and the Foundry. The legacy Ed25519 challenge (`GET /v1/auth/challenge`) is still mounted and is deprecated. **Boards are current Core functionality.** App builders start with `GET /v1/prompts/build-app`.

---

## Subsystem Reference

Short notes on the subsystems that carry most real use. The v4.0 specification has the normative detail; this section is the map.

### Collaboration: Organisms and Workspaces (Core)

The base for nearly all shared work, built on the generic memory API with no per-object-type endpoints.
- **Organism** (`organisms.ts`): a membership-gated group (team, club, cooperative, project). Content is keyed `organism.{id}.*` and owned by the contributing member's GHII.
- **Workspace** (inside `organisms.ts`; `organism.{id}.w.{ws}.*`): a shared, **versioned, access-gated record space**. Draft, publish and version; per-workspace member grants (viewer, contributor); manifest-driven aggregated read; engagements; activity; a dangling-reference scan. This is the **shared living surface**: humans, agents and apps change the same records at the same time, and live updates fan the changes out.

### Applications and the App Platform (Platform)

Hosted single-file apps reach owner data **only** through the Core APIs under a scoped grant, never with the portal session's authority.
- **Apps** (`apps.ts`, `app-store.ts`, `app-templates.ts`, `apps-backup.ts`): catalog, versioning, drafts, fork and lineage, store purchase, backup ZIP.
- **App grants** (`app-grants.ts`): an OAuth/PKCE flow that issues short-lived, scoped `role:'app'` tokens. They resolve to the owner's data identity but are fenced to the scopes the user approved (the Core's scoped delegation). Apps are **identity-bearing principals**.
- **H-2 origin isolation** (`subdomains.ts`): apps run on `*.apps.<apex>`, isolated from the portal session; this depends on host-only auth cookies and CSP `frame-ancestors`.
- **Served browser SDK** (`libs.ts`, `libs/sdk-serve.ts`): the node serves the `aimeat-auth`, `data`, `storage`, `social`, `wallet`, `organism` and other browser libraries to apps and cortex. Their source is under `src/static/sdk-libs/`, one folder per library; the build writes `src/static/sdk-libs/dist/`.

### Ecosystem Apps: GEAI (Platform)

External applications (`ecosystem-apps.ts`, `ecosystem-events.ts`) onboard through a hello, approve, token flow with TOFU key pinning and a scope and data-area allowlist. They write into their own `eco:` namespace and are **consented like agents**. This is the third principal type (`eco:{app}#owner@node`). An event plane feeds the workflow engine's `ecosystem.event` trigger. Guide: [building an ecosystem app](../building-an-aimeat-compatible-ecosystem-app.md).

### Agent Fleet Plane (Platform)

Where real AI agents are operated. The owner-to-agent **task** lifecycle draft, queued, active, done or failed (`agent-tasks.ts`); directives, including the optional Secretary (`agent-directives.ts`); telemetry into the ledger (`agent-telemetry.ts`); agent-to-agent messages (`agent-messages.ts`); presence (`presence.ts`); and webhooks (`agent-webhook.ts`). Fleets attach through the connector tunnel or a personal node.

#### Hello Integration (agent onboarding)

An agent connects through device authorization, then walks a mode-keyed onboarding step machine (`agent-onboarding.ts`, `models/agent-onboarding-schemas.ts`). The full flow is **16 steps: 12 required and 4 optional** (for `autonomous`, `interactive` and `coordinator`). Reduced flows: **`task-runner` has 7 steps** (it keeps the test-task pair; see the mode list above) and **`workstation` has 4** (authenticate, platform, capabilities, directives; the MCP round trip is its smoke test). The **12 required** steps of the full flow: `authenticate`, `identify_platform`, `install_skill`, `report_capabilities`, `read_directives`, `send_test_message`, `configure_delivery`, `report_telemetry`, `accept_test_task`, `complete_test_task`, `publish_commands`, `publish_config`. The **4 optional** steps: `declare_services` and the offers ladder `declare_offerings`, `make_workflow_compatible`, `price_offer`. Readiness completes when all required steps pass; the node drives each pending step with a `step_guide`. The agent-side counterpart is [the agent guide](../building-an-aimeat-compatible-agent.md).

#### Capability declaration and proof

An agent declares what it can do and then has to prove it. This matters most for interactive agents and agents supplied by other parties.
- **Declaration**: `PUT /v1/agents/:name/capabilities` (`agent-capabilities.ts`, written by `services/agent-profile-write.ts`): technical capabilities (MCP servers, skills, tools), domain expertise, languages. A capability of type `mcp` is marked verified when the caller is an agent session, because that session is a live MCP connection.
- **Proof**: the onboarding **test task** (`accept_test_task` then `complete_test_task`, steps 9 and 10) makes the agent run the real read, propose todos, execute, complete loop over its own transport. This is the gate that counts. Capability and trust together decide what work an agent may take.

### Agent Runtime: the Python liaison and the desktop app

- **`python/aimeat-crewai/`** (in this repository): the pip-installable **liaison and connector**, a CrewAI integration that mirrors the node contract (`liaison.py`, `mcp_client.py`, `daemon.py`, `offers.py`, `workflow_spec.py`, `cli.py`). It has its own version line and is published to PyPI from a tag. The **node schema wins** on any mismatch (`models/offer-schemas.ts`, `models/workflow-schemas.ts`), so keep the liaison in sync when an agent-facing contract changes (offers, workflow signals, onboarding, MCP surface).
- **`aimeat-desktop/`** (in this repository): a Tauri desktop app. It attaches AI tools on the person's computer to their AIMEAT and can run a local node with persistent SQLite. See its [README](../../aimeat-desktop/README.md).
- **The crew runtime** (the fleet daemon and its crew templates) lives in the sibling repository `miikkij/crewaimeat` and builds on the Python liaison.

### Programmable Compute and Metered AI (Platform)

- **Extensions** (`extensions.ts`): server-side action scripts in a **QuickJS-WASM** sandbox with a scoped context (memory, fetch through the SSRF guard, wallet, consent), encrypted secrets and cron. They own the `ext:{name}` namespace.
- **Cortex** (`cortex.ts`): materializes a manifest's schemas, prompts and actions, and serves browser IIFE library bundles.
- **Metered AI proxy** (`ai.ts`, `openrouter.ts`): the owner's encrypted LLM key exposed as a **metered, scoped, consent-gated resource** (`ai:use` scope, per-owner USD budget, provider allowlist).
- **Scheduler** (`schedules.ts`): recurring jobs on a server-owned clock (extension, AI, agent task, ecosystem capability).
- **Workflows** (`workflows.ts`): declared, DAG-validated agent pipelines with per-step input and output **signals** ("did it produce"); a deterministic engine with runs and cancel.

### Economy: Offerings, Work, Tasks, Ledger

The atomic primitive is an **action** (`actions.ts`, a callable unit of work). It is rarely invoked directly; the rest is built on it:
- **Offerings** (`models/offer-schemas.ts`): the billable, discoverable face of a service (morsel-priced `callable`, workflow signals). The marketplace surface.
- **Work queue** (`work.ts`, `disputes.ts`): escrow with settlement on delivery and a dispute state machine. Live, with little traffic.
- **Agent tasks and engagements**: fleet assignment (above), **not** morsel-priced.
- **Trust** (`services/trust.ts`): an automatically computed 0 to 100 reputation that gates paid actions.
- **Ledger and metering** (`ledger.ts`): real-currency (**USD**) accounting of actual LLM spend, fed by agent telemetry. A separate *meter*, not a second currency (see "Economy: Meters, Not Currencies" above). Budgets and CSV billing export, behind the optional payment interface.

### Skills and Capabilities (Platform)

- **Skills** (`skills.ts`, `agent-skill-bundle.ts`): a SKILL.md pack registry (node and user scopes). Agents link skills, connectors materialize them, and per-runtime ZIP bundles download (including a claude.ai and `~/.claude/skills` form). One function, `resolveSkillRef` in `services/skills.ts`, checks access and resolves scopes, references, `@semver` pins and app-bound skills. See the [skills registry](../skills-registry.md).
- **Capabilities** (`capabilities.ts`): an agent capability registry with discovery, an **invoke proxy**, telemetry and peer **vouch** (attestation). An action exposed as a unit others can vouch for.

### Knowledge and Retrieval (Core and convenience)

- **Knowledge** (`knowledge.ts`): importable packages and a graph of typed **links** with reputation and operator review.
- **Librarian** (`librarian.ts`): one ranked natural-language search (full-text, not vector) across every organism and personal memory; gated by app grant.

### Live Surface (Platform)

`sse.ts` (authenticated, typed, owner-scoped live updates: one shared connection, subscribe with `onLiveUpdate`, never poll), `public-events.ts` (the unauthenticated landing feed), `notifications.ts` (the bell inbox), `push.ts` (VAPID) and `realtime.ts` (WebRTC and Yjs, behind a flag). These make the shared living surface live.

### Portal Product Surfaces

User-facing surfaces in the portal that are *clients* of the generic APIs, and so not protocol concepts:
- **Notebook** (`public/views/profile/notebook-tab.js`, `services/notebook-*.ts`): free-text capture, AI classification and enrichment, then distribution into organisms. A main consumer of the librarian.
- **Living Docs** (`living.ts`): an AI author for plain-language living-document templates.
- **Portfolio** (`portfolio.ts`, the browser library in `src/static/sdk-libs/portfolio-standalone/`): a per-user public portfolio builder with a content catalog and themes.
- **Packages and Instances** (`packages.ts`, `instances.ts`): the **package marketplace** (versioned CRUD, export and import, reviews) and install-and-track running **instances**. Separate from knowledge packs and skill packs.
- **Chat Sessions** (`chat-instances.ts`): a stored list of live chat-session registrations.
- **Calibrator** (`calibrator.ts`): a prompt-calibration workbench (projects, versions, batches, LLM editor, charts).
- **Personal Access Tokens** (`access-tokens.ts`): owner-minted PATs, a credential path for agents and scripts outside device authorization.
- **Moderation** (`flags.ts`, `appeals.ts`): content flagging and an appeal workflow, separate from work disputes.
- **App catalog** (`src/static/app-catalog/` and `app-catalog.html`): a static catalog app shell built with **esbuild**, separate from the database-backed `apps.ts` and `app-store.ts`. Edit the sources under `src/static/app-catalog/`, not the built file.

### Operator Admin

The admin dashboard is SPA views under `public/views/admin/`, served by `admin.ts`, the `admin-*.ts` route files and `routes/admin/`, which answer JSON like every other route. The admin sign-in and first-run setup page is one static HTML string (`routes/admin/setup-html.ts`) that `admin.ts` sends. The admin is operator tooling and defines no protocol; it uses the same generic APIs as the rest of the system.

---

## Backend Design Principles

The backend is protocol-only: no server-side rendering, every route a generic API that a second, different service could use, no per-service backend files, and no wrapper around data an existing API already returns. One capability has one implementation, whatever the interface (REST, MCP, CLI). The rules and their gates are in `.claude/rules/backend.md`.

---

## Directory Structure

### Repository layout (top level)

```
aimeat-protocol/                  pnpm workspace (root package.json proxies to aimeat/)
├── openapi.yaml                  canonical API contract (OpenAPI 3.1), changed with the route
├── CLAUDE.md, AGENTS.md          instructions for AI coding assistants
├── startup.prompt.md             a prompt that bootstraps an AI assistant in this repository
├── .github/workflows/            CI (ci.yml), CodeQL, release and publish workflows
├── .githooks/                    pre-commit, pre-push, commit-msg, prepare-commit-msg
├── aimeat/                       the reference implementation (Node 24, TypeScript, Express 5)
│   ├── src/                      backend (table below)
│   ├── public/                   Preact + HTM SPA, no build step (table below)
│   ├── locales/                  en.json (source of truth), fi.json, es.json
│   ├── test/                     E2E suites, unit tests, the run-e2e-ci.ts runner
│   ├── scripts/                  gates, build and operations scripts
│   ├── bin/                      the `aimeat` CLI entry
│   ├── eslint-rules/             custom lint rules (file header, file length, layer rules)
│   ├── security/                 ratchet ledgers the gates read
│   ├── tools/                    developer tools (synthtraces and others)
│   ├── docs/                     implementation-local guides
│   └── Dockerfile, docker-compose.yml (Postgres + Kysely), docker-compose.sqlite.yml
├── python/aimeat-crewai/         pip-installable CrewAI liaison (own version line)
├── aimeat-desktop/               Tauri desktop app (src/ and src-tauri/)
├── packages/                     hosted app and package SOURCE, plus build-*.mjs; built .zip files are gitignored
├── scripts/                      repository-level scripts (git-commit.sh, gen_image.py, eval-skill.mjs)
├── security/                     the semantic security audit rules
├── tools/                        kits for outside tools (OpenHands, local decision models)
├── assets/                       brand and design assets
└── docs/                         specification, guides, coding-guidelines/
```

The pre-commit hook (`.githooks/pre-commit`) runs `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm typecheck:sdk` and `pnpm check:silent-catch -- --strict --staged`, plus `pnpm check:notices` when `THIRD-PARTY-NOTICES.md` is staged. Everything slower runs in `pnpm gate`, once, when a piece of work is finished.

### Backend (`aimeat/src/`)

| Path | Purpose |
|------|---------|
| `index.ts`, `index-*.ts` | CLI entry: node commands, `start`, connector dispatch |
| `server.ts` | `createServer()`: the Express application and its middleware |
| `config.ts`, `config-*.ts` | Configuration loading and the config type, split by area |
| `i18n.ts` | Server-side translation and the `LOCALES` list |
| `auth/` | JWT, keys, auth middleware, account security |
| `cli/` | CLI wizards and commands (init wizard, config export and import, connect) |
| `commerce/` | Payments and payouts: purchase limits, beneficiaries, order intake |
| `data/` | Built-in data: skills, app templates, agent definitions, the appdev pitfall list |
| `mcp/` | The node's MCP server: transport, OAuth 2.1, tool groups |
| `middleware/` | Response envelope, the caller object, rate limiting, CORS, request id |
| `models/` | Request and record schemas, most of them Zod |
| `routes/` | Express route handlers, one file per domain, with a directory beside a file that grew |
| `schemas/` | JSON Schema definitions (knowledge package manifests and entries) |
| `server-bootstrap/` | Start-up modules: config init, service init, middleware guards, route mounting |
| `services/` | Business logic; a service takes no Express request |
| `static/` | Files served as they are, the app catalog sources and the browser SDK sources (`sdk-libs/`) |
| `storage/` | The `Storage` interface (`interface.ts`) and `storage-factory.ts` |
| `storage/types/` | Record and value types, one file per domain, re-exported by `interface.ts` |
| `storage/repositories/` | Repository interfaces, one per record kind |
| `storage/providers/` | The two backends: `postgres-kysely/` and `sqlite/` |
| `tool-catalog/` | Tool names, descriptions and input schemas shared by every tool surface |
| `tool-dispatch/` | Shared REST tool dispatch for node invoke, the connector MCP server and the CLI |
| `types/` | Shared TypeScript declarations |
| `utils/` | Utilities (logger, GAII helpers, env config) |

`src/generated/` holds `api-types.ts`, written by `pnpm generate:types` from `openapi.yaml`. It is gitignored.

### Frontend (`aimeat/public/`)

| Path | Purpose |
|------|---------|
| `spa.html` | The SPA shell and its importmap |
| `components/` | Shared Preact components |
| `css/` | Theme tokens and per-view CSS |
| `js/` | Shared modules (`api.js`, `i18n.js`, `utils.js`) and `js/services/` (API service layers) |
| `views/` | Lazy-loaded view modules, with `views/admin/` for the operator dashboard |
| `lib/` | Self-hosted third-party libraries (Preact, HTM and others; see `lib/VENDORED.md`) |
| `cortex-bundled/` | Cortex packs that ship with the node |

Translations are in `aimeat/locales/`, not under `public/`. See the [frontend guide](../frontend-development-guide.md).

### Documentation (`docs/`)

[docs/README.md](../README.md) says which document answers which question, and [docs/catalog.md](../catalog.md) lists every file with its purpose. The ones a platform developer opens most:

| Path | Purpose |
|------|---------|
| `docs/AIMEAT-Core-2026-11.md`, `docs/AIMEAT-Core-2026-11-evidence.md` | The specification and its conformance evidence |
| `docs/AIMEAT-Platform-reference.md` | The architecture note of the platform on top of Core |
| `docs/AIMEAT-RFC-v4.0-*.md` | The v4.0 specification (Core, Platform, errata), superseded since node 4.0.0 and kept as history |
| `docs/a-endpoints.md`, `docs/b-config.md` | API reference and configuration reference |
| `docs/coding-guidelines/` | Development standards (this folder) |
| `docs/frontend-development-guide.md` | Frontend architecture and conventions |
| `docs/pitfalls.md` | Traps already hit, by symptom |
| `docs/known_gaps.md` | Deferred technical gaps |

### Tests (`aimeat/test/`)

| Path | Purpose |
|------|---------|
| `e2e-*.ts` | E2E suites, one feature each |
| `run-e2e-ci.ts` | The E2E runner; `--test=<suite>` runs one suite |
| `api-full.ts` | Core API integration test |
| `unit/` | Unit tests (Vitest; more sit in `src/**/__tests__/`) |
| `helpers/`, `fixtures/` | Shared test code and data |
| `playwright/` | Browser tests |
| `docker/` | Containerized test runner |

How to run them: [testing-requirements.md](testing-requirements.md).

---

## Storage Architecture

### Repository Pattern

The storage layer uses a repository pattern with a provider abstraction:

```
Storage interface (src/storage/interface.ts)
    ├── Record types (src/storage/types/*.ts, re-exported by interface.ts)
    ├── Repositories (src/storage/repositories/*.repository.ts, one per record kind)
    └── Providers (src/storage/providers/)
        ├── postgres-kysely: pg + Kysely; production; SQL migrations run on boot
        └── sqlite: better-sqlite3; personal nodes and fast iteration, including :memory:
```

### Storage Factory

`src/storage/storage-factory.ts` creates the provider the configuration names:
- `AIMEAT_STORAGE=sqlite`: better-sqlite3. `AIMEAT_SQLITE_PATH=:memory:` gives an ephemeral node on the same code path.
- `AIMEAT_STORAGE=postgres-kysely` (aliases `postgres`, `postgresql`): PostgreSQL through Kysely, `DATABASE_URL=postgresql://…`. SQL migrations run on boot.

`AIMEAT_STORAGE=mongodb` fails at start with migration guidance. A data-model change updates both backends in the same commit: see [storage-sync.md](storage-sync.md).

---

## Read-Cache Layer (`services/cache.ts`)

A few read endpoints recompute the same expensive result on every page load or poll (owner usage
summary, memory counts, catalogue scans). `services/cache.ts` is a small process-local TTL cache with
tag-based invalidation that those hot paths opt into with one call. The node is a single Express
process (federation and relay coordinate out of band, not through a shared app cache), so a plain
in-process `Map` is coherent. **Do not** add Redis, memcached or lru-cache.

**When to use it:** a read that (a) recurs on every load or poll and (b) costs much more than a `Map`
lookup (full scans, byte sums, multi-query aggregation). One-off reads, writes, and anything not
measurably hot do not need it.

```ts
import { cached, TTL } from '../services/cache.js';
const summary = await cached(`usage:${owner}`, TTL.dashboard,
  () => computeOwnerUsageSummary(config, storage, owner),
  [`owner:${owner}:memory`, `owner:${owner}:files`, `domain:memory`, `domain:files`]);
```

**Keys:** include the owner or GAII in the key for anything identity-scoped (one user must never read
another's cached value), and include every filter parameter (prefix, visibility) so different filters
do not collide. Global data omits the owner segment.

**Tags:** tag entries with `domain:<d>` (and `owner:<owner>:<d>` when identity-scoped) for each domain
whose writes should drop the entry. `initProcessBuffers()` in `server-bootstrap/process-buffers.ts`
subscribes to the event bus and turns every `emitChange(domain, ownerGaii?)` into
`invalidateTag('domain:<d>')`, plus the owner-scoped tag when the write carries an owner. The TTL is
the backstop and the tags are the precise drop. Many write paths call `emitChange(domain)` *without*
an owner, so always include the broad `domain:<d>` tag. Cache health (entries, tags, evictions) is
in the `GET /v1/stats` gauges.

---

## Federation

Nodes can federate into a decentralized network. The default configuration ships **without peers**; a federated deployment peers explicitly (in practice: a home or personal node, aimeat.io, and another person's node).

- **Cross-node identity and login (the live use)**: once peered, owners are recognized on a peer and can sign in to each other's systems with their own credentials, subject to each node's consent and access guard.
- **Peering**: bilateral request, test, approve, activate, key exchange.
- **Sync and replication**: delta catalogue sync and push or pull memory replication for `public` and federation-consented data (built, and exercised once peers exist).
- **Relay, genesis and trust broadcasts**: optional and off by default. Treat them as an advanced profile.
- **Personal node and connector tunnel**: a machine behind a home connection takes part through a parent tunnel (`personal.ts`) or an outbound per-principal WebSocket (`connect-tunnel.ts`) that lets a local agent fleet act through the hosted node.

---

## Configuration

A value can come from a built-in default, a config file, an environment variable, a CLI flag, Consul or the database (what an operator saved in the admin dashboard). The order in which they override each other, and the immutable and sealed fields that stand outside that order, are in [b-config.md, "Where a value comes from"](../b-config.md#where-a-value-comes-from).

`aimeat/.env.example` documents every environment variable. [b-config.md](../b-config.md) is the configuration reference.
