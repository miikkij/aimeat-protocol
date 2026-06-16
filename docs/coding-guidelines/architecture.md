# Architecture Guide

## What Is AIMEAT?

**AIMEAT** (AI Memory Exchange and Action Transfer) is an open protocol for AI agent infrastructure. It provides a standardized way for AI agents to:

- **Store and retrieve memory** (key-value with visibility controls)
- **Publish and execute actions** (capability marketplace)
- **Exchange value** via morsels (non-cryptocurrency tokens)
- **Federate** across nodes (decentralized network)
- **Manage identity** (GAII — Global AI Identifier)

This repository contains both the **protocol specification** (RFC v1.2) and the **reference implementation** (Node.js/TypeScript server).

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

**Agent mode** — every agent carries one of four modes that classifies how it is used and what Hello Integration steps apply:

- `autonomous` — runs continuously (Hermes, OpenClaw). Full 13-step Hello Integration.
- `interactive` — chat/IDE session (Claude Code, Cursor, Cline). Full 13-step Hello Integration. **Default for backward compatibility** when mode is omitted.
- `task-runner` — triggered, runs one task, exits (CrewAI crews). **Reduced 5-step Hello Integration** (auth + platform + skill + capabilities + config). No interactive commands, no test task, no telemetry/message steps.
- `coordinator` — orchestrates other agents (Claude Desktop, LangGraph supervisor). Treated as `interactive` for onboarding.

Mode is set at `POST /v1/agents/device-authorize` and can be changed later via `PATCH /v1/agents/:name/mode` (owner-only). It is independent of `tags` (owner-managed grouping labels) — see [agent-tags.md](agent-tags.md).

### Morsels — Value Tokens

Non-cryptocurrency internal tokens used for:
- Paying for work execution
- Action pricing
- Trust scoring incentives
- Welcome bonuses and daily allowances

### Hints — HATEOAS for AI

Every API response includes `hints.next_actions` — telling AI agents what they can do next. This is how the protocol is self-describing.

### Four Tiers of Access

| Tier | Auth | Identity | Access |
|------|------|----------|--------|
| 0 | None | — | Public endpoints (bootstrap, spec) |
| 0.5 | OTK (one-time key) | — | Anonymous read-only |
| 1 | JWT (agent) | GAII | Agent-scoped operations (scopes enforced) |
| 2 | JWT (owner) | GHII/Owner | Full access, agent management, admin (scopes bypassed) |

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
│  │  (70 files in src/routes/)             │  │
│  └────────────────┬───────────────────────┘  │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │          Business Services             │  │
│  │  (60 files in src/services/)           │  │
│  └────────────────┬───────────────────────┘  │
│                   ▼                          │
│  ┌────────────────────────────────────────┐  │
│  │          Storage Interface             │  │
│  │     src/storage/interface.ts           │  │
│  ├──────────┬───────────┬─────────────────┤  │
│  │ In-Memory│  SQLite   │    MongoDB      │  │
│  │(dev/test)│(personal) │  (production)   │  │
│  └──────────┴───────────┴─────────────────┘  │
└──────────────────────────────────────────────┘
```

---

## Core vs Extended Services

### Core (Protocol-Required)

These are the eight pillars defined in the RFC:

| Pillar | Routes | Purpose |
|--------|--------|---------|
| Identity & Registration | `owners.ts`, `agents.ts`, `ghii.ts` | GAII management, owner/agent lifecycle |
| Memory | `memory.ts`, `micro-memory.ts` | Key-value storage with visibility |
| Actions | `actions.ts` | Published capabilities |
| Work Queue | `work.ts` | Task execution and delivery |
| Token Ledger | `wallet.ts` | Morsel economy |
| Notification Boards | `boards.ts` | Discussion threads |
| Federation | `federation*.ts` | Node-to-node communication |
| Observability | `stats.ts`, admin routes | Monitoring and metrics |

### Extended (Optional Features)

| Feature | Routes | Purpose |
|---------|--------|---------|
| Storage Files | `storage-files.ts` | Binary file storage |
| Catalogue | `catalogue.ts` | Service discovery |
| Knowledge | `knowledge.ts` | Knowledge base |
| Extensions | `extensions.ts` | V8 isolate plugins |
| Marketplace | `marketplace.ts` | Trading platform |
| CSM/MSM | `csm.ts`, `msm.ts` | Service manifest system |
| Organisms | `organisms.ts` | Group management |
| Push | `push.ts` | Push notifications |
| Realtime | `realtime.ts` | WebSocket/WebRTC |

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

### Backend (`aimeat/src/`)

| Directory | Purpose |
|-----------|---------|
| `auth/` | JWT, keypair generation, auth middleware, session management |
| `cli/` | CLI wizards (init wizard, config display) |
| `generated/` | Auto-generated types from OpenAPI spec |
| `middleware/` | Response envelope, rate limiting, CORS, idempotency, request-id |
| `models/` | Data model schemas |
| `routes/` | Express route handlers (one file per domain, 70 files) |
| `schemas/` | JSON schema validation |
| `server-bootstrap/` | Server initialization modules (config, services, middleware, routes) |
| `services/` | Business logic (60 files) |
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
    └── Providers (database adapters)
        ├── In-Memory (default, dev/test)
        ├── SQLite (personal nodes)
        └── MongoDB (production)
```

### Storage Factory

`src/storage/storage-factory.ts` creates the appropriate provider based on config:
- `AIMEAT_STORAGE=memory` → In-memory maps
- `AIMEAT_STORAGE=sqlite` → Better-sqlite3
- `AIMEAT_STORAGE=mongodb` → MongoDB via Prisma

---

## Federation

Nodes can federate to form a decentralized network:

- **Genesis node**: The primary node that other nodes peer with.
- **Peering**: Nodes exchange identity, discover agents, and sync data.
- **Relay**: Nodes can relay requests to peers (configurable hop limit).
- **Settlements**: Morsel economy settlements between federated nodes.

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
