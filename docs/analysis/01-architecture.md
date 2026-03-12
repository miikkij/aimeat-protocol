# 01 — Architecture Analysis

## 1. System Overview

AIMEAT is a federated AI agent infrastructure protocol with a reference implementation as a Node.js/Express server. The architecture follows a clean layered pattern:

```
┌─────────────────────────────────────────────────┐
│  Clients (AI chats, SPAs, desktop apps, agents) │
└────────────────────┬────────────────────────────┘
                     │ HTTP / WebSocket / SSE
┌────────────────────▼────────────────────────────┐
│              Express 5.2.1 Server               │
│  ┌──────────┬──────────┬──────────┬───────────┐ │
│  │Middleware │  Routes  │ Services │  Storage  │ │
│  │  Chain   │ (40+ API │ (70+ biz │ Interface │ │
│  │ (10 layers)│ domains)│  logic) │ + 3 impls │ │
│  └──────────┴──────────┴──────────┴───────────┘ │
└─────────────────────────────────────────────────┘
```

## 2. Module Organization

### 2.1 Source Structure

| Directory | Purpose | File Count | LOC (est.) |
|-----------|---------|------------|------------|
| `src/auth/` | JWT, keypair, Ed25519, middleware | 4 | ~700 |
| `src/middleware/` | Envelope, CORS, rate limit, idempotency, metrics | 10 | ~800 |
| `src/routes/` | HTTP endpoint handlers | 60+ | ~25,000 |
| `src/services/` | Business logic (matching, consent, federation, etc.) | 70+ | ~20,000 |
| `src/storage/` | Data abstraction + 3 backend implementations | 50+ | ~15,000 |
| `src/models/` | Zod validation schemas | 2 | ~500 |
| `src/utils/` | GAII parsing, OTK, logger, validators | 8 | ~600 |
| `src/cli/` | Init wizard, scaffolding, config export/import | 5 | ~3,000 |
| `src/server-bootstrap/` | Modular server initialization | 5 | ~500 |
| `src/generated/` | OpenAPI TypeScript types (auto-generated) | 1 | ~12,000 |

### 2.2 Dependency Flow

```
Routes → Services → Storage (Interface)
  ↓                      ↓
Middleware            Providers (SQLite | MongoDB | Memory)
  ↓
Auth (JWT + Keypair)
  ↓
Config (288 fields, multi-source)
```

**Key design principle:** Routes never access storage directly for business logic — they delegate to services. Routes handle HTTP concerns (request parsing, response formatting, status codes). Services handle domain logic (quota, trust, matching, consent).

### 2.3 Route Registration Pattern

All routes follow a factory pattern injected with config and storage:

```typescript
export function myRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  router.get('/v1/endpoint', requireAuth(), requireRole('agent'), async (req, res) => {
    // ...
  });
  return router;
}
```

Routes are mounted in `src/server-bootstrap/routes-loader.ts`, keeping `server.ts` clean.

## 3. Middleware Pipeline

The middleware pipeline is well-designed with clear ordering:

| Order | Middleware | Purpose |
|-------|-----------|---------|
| 1 | `compression()` | gzip/deflate response compression |
| 2 | `express.json({ limit: '15mb' })` | JSON body parsing with size limit |
| 3 | `express.urlencoded({ limit: '1mb' })` | Form body parsing |
| 4 | `express.static()` | Static file serving (public/, static/) |
| 5 | Cookie consent banner | GDPR-compliant consent injection |
| 6 | Request ID | Unique ID per request for tracing |
| 7 | `optionalAuth()` | Parse JWT if present (global) |
| 8 | CORS | Multi-tier origin resolution |
| 9 | Rate limiting | Token bucket per identity or IP |
| 10 | Idempotency-Key | Prevent duplicate operations |
| 11 | Middleware guards | Maintenance mode, relay/mirror, first-run wizard |
| 12 | Route handlers | Domain-specific endpoint logic |
| 13 | Global error handler | 500 status, payload size errors |

**Assessment:** Excellent separation of concerns. Each middleware has a focused responsibility.

## 4. Storage Layer

### 4.1 Interface Design

The `Storage` interface (`src/storage/interface.ts`, 1,115 LOC) defines 50+ data types and CRUD operations for all entities:

- **Identity:** Owner, Agent, GHII, DeviceAuth, OAuth
- **Data:** Memory, MicroMemory, StorageFile, AppRecord
- **Economy:** Action, Work, Dispute, Wallet
- **Social:** Board, BoardPost, Organism, Catalogue
- **Federation:** PeeringRequest, GenesisPeer, ReplicationQueue
- **Advanced:** Consent, Schema, CSM, MSM, Extension, SystemPrompt

### 4.2 Implementations

| Backend | File | LOC | Use Case |
|---------|------|-----|----------|
| SQLite | `providers/sqlite/` | ~5,500 | Default, file-based, zero-config |
| MongoDB | `providers/mongodb/` | ~4,100 | Production, horizontal scaling |
| Memory | `providers/memory/` | ~2,000 | Development, ephemeral |

**SQLite details:**
- WAL mode enabled (better concurrency)
- Foreign keys enforced
- 5-second busy timeout
- 15 domain-specific repository files
- Parameterized queries throughout (no injection risk)

### 4.3 Repository Pattern

Each domain has a dedicated repository type (40+ repositories in `src/storage/repositories/`):
- `MemoryRepository` — read/write/list/delete/search/flag-count
- `AgentRepository` — registration, trust scoring, scope management
- `ConsentRepository` — grants, revocation, audit trails
- `WorkRepository` — requests, delivery, disputes, ratings

**Factory pattern** (`storage-factory.ts`) creates the appropriate backend based on config.

## 5. Configuration System

### 5.1 Multi-Source Priority

```
CLI args (highest)
    ↓
Database (persistent, mutable at runtime)
    ↓
Consul KV (fleet-wide, live updates)
    ↓
Config file (.ini / .json)
    ↓
Environment variables
    ↓
Built-in defaults (lowest)
```

### 5.2 Field Inventory (288 fields)

| Category | Fields | Examples |
|----------|--------|---------|
| Node basics | 10 | port, baseUrl, nodeId, nodeType |
| Storage | 5 | provider, sqlitePath, mongoUrl |
| Auth/Crypto | 8 | jwtTtl, keyPassphrase, otpSecret |
| Quotas | 12 | memoryQuota, storageQuota, microMemoryMax |
| Economy | 10 | welcomeBonus, dailyAllowance, burnRate |
| Federation | 8 | role, genesisUrl, syncInterval |
| Features | 15 | consent, TOTP, email, matching, marketplace |
| Rate limits | 20+ | per-tier windows, role multipliers, per-endpoint overrides |
| Extensions | 8 | memoryLimit, timeout, maxApiCalls |

### 5.3 Provenance Tracking

Each config field tracks which source set it (env, file, consul, db, cli, default). This enables:
- Debugging configuration conflicts
- Admin dashboard showing config origins
- Immutable vs. mutable field distinction

## 6. Federation Architecture

The system supports multi-node federation with:

- **Genesis nodes** — authoritative nodes that seed federation
- **Peer nodes** — equal participants with bilateral peering
- **Replication queue** — eventual consistency for cross-node data
- **Settlements** — cross-node morsel economy balancing
- **Trust scoring** — reputation tracking between nodes

Federation is implemented across 4 route files and 5+ service files, totaling ~3,000 LOC.

## 7. Realtime Communication

Three channels for real-time updates:

| Channel | Protocol | Use Case |
|---------|----------|----------|
| WebSocket | `ws` library | P2P rooms, personal node tunneling |
| SSE | EventSource | Live dashboard updates, event streams |
| Polling | HTTP `GET` | Fallback for restricted environments |

**SSE uses ticket-based auth** (single-use tokens) instead of JWT in URLs — a security best practice.

## 8. Extension System

Plugins run in V8 isolate sandboxes (`isolated-vm`):
- Memory-limited execution
- Timeout enforcement
- Restricted API surface
- No filesystem or network access from sandbox

## 9. Architectural Strengths

1. **Clean layering** — Routes → Services → Storage with no shortcuts
2. **Dependency injection** — Config + Storage passed as parameters, not globals
3. **Protocol-only backend** — No SSR; all UI is client-side SPA
4. **Pluggable storage** — Easy to add new backends (Postgres, Redis, etc.)
5. **Federation-first** — Multi-node support is built into the core, not bolted on
6. **Comprehensive config** — 288 fields covering every subsystem

## 10. Architectural Concerns

1. **Monolith risk** — 60+ route files, 70+ services in a single process. No microservice boundaries defined for future scaling.
2. **In-memory state** — Rate limiting, token revocation cache, event bus are all per-process. Multi-instance deployments need external stores (Redis, Consul).
3. **Federation complexity** — 3,000+ LOC across 9 files. High coupling between sync, settlement, and trust logic.
4. **Generated types** — 12,000 LOC auto-generated file (`generated/api-types.ts`) adds build complexity but provides type safety.
5. **No message queue** — Federation replication, webhook delivery, and background jobs all use in-process scheduling (Croner). Production deployments may need external queues (RabbitMQ, Redis Streams).
