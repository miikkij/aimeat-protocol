# AIMEAT Reference Implementation — Build Prompt

## What You're Building

> **Note (updated 2026-07-16):** this is the *original from-scratch bootstrapping prompt*, kept for historical context. The reference implementation now exists. The current specification is **`AIMEAT-RFC-v4.0-Core-full.md` + `AIMEAT-RFC-v4.0-Platform-full.md`** and the canonical API contract is **`openapi.yaml`** — use those, not the removed v1.2 RFC. Valid storage backends are PostgreSQL (Kysely) and SQLite — the MongoDB/Prisma framing below is historical (those backends were removed in July 2026), as is the old in-memory-first framing.

Implement the AIMEAT Protocol (AI Memory, Economy, Actions, Trust) as a Node.js reference implementation. The complete protocol specification is in `AIMEAT-RFC-v4.0-Core-full.md` + `AIMEAT-RFC-v4.0-Platform-full.md` (with `openapi.yaml` as the canonical schema contract) — that is your source of truth. Read it fully before writing any code.

## The Goal

```bash
pnpm i -g aimeat    # install globally
aimeat               # launches with in-memory DB, zero config, ready to use
```

A single command starts a fully functional aimeat node that any AI agent can connect to via HTTP.

## Tech Stack (Locked)

- **Runtime:** Node.js 24.x (ESM modules)
- **Framework:** Express 5.2.x
- **Language:** TypeScript 5.9+ (strict mode)
- **Database:** MongoDB via Prisma 6.19+ (production) / in-memory fallback (default)
- **Cache:** Redis via ioredis (optional, for rate limiting + sessions)
- **Auth:** Ed25519 keypairs + JWT (EdDSA signed)
- **Validation:** Zod 4.x for all request/response schemas
- **Logging:** Winston with daily rotation
- **Package manager:** pnpm (publish to npm as `aimeat`)

## Architecture Requirements

### 1. Dual-Mode Database
- **Default (no config):** In-memory storage using Map/object stores. Data lost on restart. Perfect for dev/home/IoT.
- **Production (env: `AIMEAT_DB_URL`):** MongoDB via Prisma. Persistent. For real deployments.
- Abstract behind a storage interface so both modes share the same API internally.

### 2. Project Structure
```
aimeat/
├── package.json
├── tsconfig.json
├── openapi.yaml              # OpenAPI 3.1 spec (source of truth for schemas)
├── prisma/
│   └── schema.prisma          # MongoDB schema
├── src/
│   ├── index.ts               # CLI entry point
│   ├── server.ts              # Express app factory
│   ├── config.ts              # Configuration (env + CLI flags + config file)
│   ├── storage/
│   │   ├── interface.ts       # Storage abstraction interface
│   │   ├── memory.ts          # In-memory implementation
│   │   └── mongodb.ts         # Prisma/MongoDB implementation
│   ├── auth/
│   │   ├── keypair.ts         # Ed25519 key generation + management
│   │   ├── jwt.ts             # JWT issue/verify/refresh/revoke
│   │   └── middleware.ts      # Auth middleware (tier detection)
│   ├── routes/
│   │   ├── bootstrap.ts       # GET / — self-describing root
│   │   ├── wellknown.ts       # GET /.well-known/aimeat
│   │   ├── auth.ts            # /v1/auth/* — token, refresh, revoke, challenge
│   │   ├── agents.ts          # /v1/agents/* — registration, profiles
│   │   ├── owners.ts          # /v1/owners/* — owner management
│   │   ├── memory.ts          # /v1/memory/* — CRUD + search
│   │   ├── actions.ts         # /v1/actions/* — publish, update, remove
│   │   ├── catalogue.ts       # /v1/catalogue/* — discovery + search
│   │   ├── work.ts            # /v1/work/* — queue, accept, deliver, dispute
│   │   ├── wallet.ts          # /v1/wallet/* — balance, transfer, history
│   │   ├── boards.ts          # /v1/boards/* — notification boards
│   │   ├── storage-files.ts   # /v1/storage/* — binary file upload/download
│   │   ├── federation.ts      # /v1/federation/* — peering, directory
│   │   ├── admin.ts           # /v1/admin/* — dashboard, config, disputes
│   │   ├── prompts.ts         # /v1/prompts/* — AI system prompts per tier
│   │   ├── validate.ts        # /v1/validate — request schema validation
│   │   └── spec.ts            # /v1/spec (serves openapi.yaml), /v1/docs (Swagger UI)
│   ├── generated/
│   │   └── api-types.ts       # Auto-generated from openapi.yaml (pnpm generate:types)
│   ├── models/
│   │   └── schemas.ts         # All Zod schemas (request + response)
│   ├── services/
│   │   ├── morsel.ts          # Token economy logic (escrow, settlement, burn)
│   │   ├── trust.ts           # Trust score calculation
│   │   ├── work-queue.ts      # Work lifecycle management
│   │   └── federation.ts      # Peering + registry sync
│   ├── middleware/
│   │   ├── envelope.ts        # Standard MEAT response envelope wrapper
│   │   ├── hints.ts           # HATEOAS hints injection
│   │   ├── rate-limit.ts      # Per-agent rate limiting
│   │   ├── tier.ts            # Access tier enforcement
│   │   └── error-handler.ts   # Global error handler
│   └── utils/
│       ├── gaii.ts            # GAII parsing/validation (agent#owner@node)
│       ├── tracking-code.ts   # TC generation (tc-{timestamp}-{random})
│       └── otk.ts             # One-time key generation for Tier 0.5
├── bin/
│   └── aimeat.ts              # CLI binary (shebang, arg parsing)
└── test/
    └── ...                    # Tests per module
```

### 3. Every Response Uses the MEAT Envelope

```typescript
// ALWAYS this shape
interface MeatResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
  hints?: {
    next_actions: Array<{
      description: string;
      method: string;
      url: string;
      note?: string;
    }>;
  };
  meta?: {
    page?: number;
    per_page?: number;
    total?: number;
    request_id?: string;
    timestamp?: string;
  };
}
```

### 4. CLI Entry Point

```bash
aimeat                                    # start with defaults (in-memory, port 40050)
aimeat --port 8080                        # custom port
aimeat --db mongodb://localhost/aimeat     # persistent mode (override DATABASE_URL)
aimeat --admin-password secret123         # set admin password
aimeat --node-id aimeat-finland-001-genesis # set node identity
aimeat init                               # interactive setup wizard
aimeat backup --out backup.json           # export all data
aimeat restore --from backup.json         # import data
```

For development, create `.env`:
```properties
DATABASE_URL="mongodb://dbuser:dbpassword@localhost:27017/AIMEAT?replicaSet=myReplicaSet&authSource=admin"
AIMEAT_NODE_ID="aimeat-finland-001-genesis"
AIMEAT_PORT=40050
AIMEAT_ADMIN_PASSWORD=TestAdminPw123!
```

Default port: **40050** (MEAT on a phone keypad: M=6, E=3, A=2, T=8 → but let's use 40050 as the AIMEAT port).

### 5.5 Environment & Package Manager

**Use pnpm exclusively.** No npm, no yarn. All commands, scripts, lockfiles — pnpm only.

```bash
pnpm init
pnpm add express@5 zod@4 ...
pnpm i -g aimeat   # global install for CLI
```

**MongoDB is already available.** Use this connection URL in development:

```properties
DATABASE_URL="mongodb://dbuser:dbpassword@localhost:27017/AIMEAT?replicaSet=myReplicaSet&authSource=admin"
```

Set this in `.env` and reference in `prisma/schema.prisma`. Since MongoDB is available, you can develop against the real database from day one. Still implement the in-memory fallback for distribution (when users don't have MongoDB), but test primarily against Mongo.

The Prisma schema should use `mongodb` provider:

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}
```

### 5. Bootstrap Response (GET /)

This is the most important endpoint. When an AI hits the root URL, it must receive everything it needs to understand and use the node. Include the full `agent_guide.detect_your_tier` block from Section 5.7.7 of the RFC. This response IS the onboarding — no docs needed.

### 6. Access Tiers (Critical)

Implement all four tiers from RFC Section 5.7:

- **Tier 0 (Browse):** All GET endpoints, no auth, CORS open
- **Tier 0.5 (Keyed Browse):** GET-based writes via one-time keys
- **Tier 1 (Agent):** Full CRUD, JWT auth required
- **Tier 2 (Operator):** Admin endpoints, operator JWT required

The tier middleware should check the JWT role and enforce access.

### 7. Morsel Economy

Implement the internal token system from RFC Section 8:
- Welcome bonus on registration (configurable, default: 100 morsels)
- Daily allowance (configurable, default: 50 morsels, cap: 500)
- Escrow on work requests
- Settlement on delivery
- Network fee split (provider node 40%, requester node 20%, relay 20%, registry 20%)
- Configurable burn rate (default: 10% of network fee)

### 8. Trust Scores

Implement the exact formula from RFC Section 16.5:

```
trust_score = clamp(0, 100, floor(
  (success_rate × 0.30) +
  (positive_rating_ratio × 0.25) +
  (age_factor × 0.15) +
  (volume_factor × 0.15) +
  (dispute_penalty × 0.15)
))
```

Components:
- `success_rate`: (delivered / (delivered + failed + expired)) × 100
- `positive_rating_ratio`: (ratings_4_or_5 / total_ratings) × 100
- `age_factor`: min(100, log2(account_age_days + 1) × 15)
- `volume_factor`: min(100, log2(total_deliveries + 1) × 11)
- `dispute_penalty`: max(0, 100 - (disputes_lost × 33))

Modifiers: -1 per 30 days inactivity decay, trust freeze during active disputes, new agents capped at 65 for first 7 days. Recalculate on every transaction event and daily for decay.

### 9. Node Identity

On first launch, if no node-id is configured:
1. Generate Ed25519 keypair
2. Save to `~/.aimeat/node-key.json` (or configurable path)
3. Generate default node-id: `aimeat-local-001-{random}`
4. The operator sets proper node-id via `aimeat init` or config

### 10. What to Implement First (Priority Order)

Phase 1 — Core (make it work):
1. Server bootstrap + GET / with full self-describing response
2. Ed25519 keypair generation + JWT auth flow
3. Agent registration (POST /v1/agents)
4. Memory CRUD (all /v1/memory/* endpoints)
5. Standard response envelope with hints on every response
6. In-memory storage backend

Phase 2 — Economy:
7. Action registry (publish, list, search)
8. Catalogue (public discovery endpoint)
9. Work queue (request → accept → deliver → settle)
10. Wallet (balance, transfer, history)
11. Morsel economy (escrow, settlement, fees)

Phase 3 — Social:
12. Boards (notification board CRUD)
13. Trust score system
14. Agent profiles (public view)
15. Owner management + GDPR endpoints

Phase 4 — Infrastructure:
16. Tier 0.5 (one-time keys)
17. Admin endpoints (dashboard, config)
18. AI system prompts (GET /v1/prompts/{tier})
19. MongoDB/Prisma storage backend
20. Federation stub (peering, directory — structure only, full implementation later)

Phase 5 — Polish:
21. CLI with arg parsing (yargs or commander)
22. Config file support (aimeat.config.json)
23. Backup/restore
24. Rate limiting
25. OpenAPI spec generation (GET /v1/spec)
26. Docker + docker-compose files

## Important Design Decisions

1. **Every response must include hints.** Even error responses. The AI must always know what to do next.

2. **The bootstrap (GET /) is a conversation starter.** It should feel like the node is introducing itself to an AI. Include the tier detection guide, available endpoints, and example flows.

3. **GAII format is `agent#owner@node`.** Parse and validate this everywhere. The `#owner` part is required in the GAII.

4. **Tracking codes format:** `tc-{unix_ms}-{8char_random}` e.g. `tc-1740491400000-x8y9z0a1`

5. **Morsel is the internal token.** It's not a cryptocurrency — it's an accounting unit. One morsel = one morsel. No external value.

6. **CORS is open on Tier 0 endpoints only.** Tier 1+ endpoints require proper auth.

7. **The node generates its own keypair on first run.** This keypair signs all JWTs and is used for federation authentication.

8. **In-memory mode is the default for distribution.** But for development, we have MongoDB ready — set `DATABASE_URL` in `.env` and Prisma connects automatically. Both modes must pass the same test suite.

## Package Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc && tsc-alias",
    "start": "node dist/index.js",
    "generate:types": "openapi-typescript openapi.yaml -o src/generated/api-types.ts",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "test": "vitest",
    "lint": "eslint src/"
  }
}
```

Use `pnpm dev` during development for hot reload.

## Testing Strategy

After implementing each phase, verify by making actual HTTP calls:

```bash
# Phase 1 verification
curl http://localhost:40050/                          # should return full bootstrap JSON
curl http://localhost:40050/.well-known/aimeat         # discovery
curl http://localhost:40050/v1/catalogue               # empty catalogue

# Register an agent (requires keypair generation helper)
# ... test auth flow
# ... test memory CRUD
```

## Read the RFC

The current spec (`AIMEAT-RFC-v4.0-Core-full.md` + `-Platform-full.md`, with `openapi.yaml`) contains:
- Complete endpoint definitions (75 paths, 88 operations across all tiers)
- Data models for all entities
- Sequence diagrams for auth, work queue, federation
- Response envelope format
- Morsel economy rules with legal positioning
- Trust score algorithm (exact formula)
- Access tier definitions and capability matrix
- MCP server specification (extended, implement stub only)
- Dispute resolution with tamper-evident audit log

Also attach `openapi.yaml` — the formal OpenAPI 3.1 spec with 41 schemas.

**Read the full RFC before starting.** The spec is the law. If something in this prompt conflicts with the RFC, the RFC wins.

**Also reference `openapi.yaml`** — the OpenAPI 3.1 spec (75 paths, 88 operations, 41 schemas). Use it for:
- Type generation: `pnpm openapi-typescript openapi.yaml -o src/generated/api-types.ts`
- Validation: Zod schemas should match the OpenAPI schemas
- The `/v1/validate` endpoint should validate requests against this spec
- The `/v1/spec` endpoint should serve this file
- The `/v1/docs` endpoint should render Swagger UI from this file

## One More Thing

The first node in the world will be `aimeat-finland-001-genesis`. Make the default welcome message reference this:

```
"Welcome to MEAT — AI Infrastructure: Memory, Economy, Actions, Trust.
 Protocol: AIMEAT v1.2 | License: MIT | The network starts here."
```

Now build it. ❤️
