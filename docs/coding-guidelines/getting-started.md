# Getting Started

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 24.x | Runtime |
| pnpm | 10.x | Package manager |
| Git | Latest | Version control |
| PostgreSQL | 16+ | Production storage (optional for dev) |

---

## Installation

```bash
# Clone the repository
git clone https://github.com/miikkij/aimeat-protocol.git
cd aimeat-protocol/aimeat

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Start development server
pnpm dev
```

The server starts on port 40050 by default. Visit `http://localhost:40050/v1/portal` to see the portal.

---

## Configuration

Configuration comes from (in priority order):
1. CLI arguments (`--db postgres-kysely`, `--port 40050`)
2. Config file (`--config production.ini`)
3. Environment variables (`AIMEAT_*`)
4. Consul (centralized config)
5. Defaults

### Minimum .env for Development

```bash
AIMEAT_NODE_ID=aimeat-local-001-dev
AIMEAT_PORT=40050
AIMEAT_STORAGE=sqlite
AIMEAT_DB_PATH=./data/aimeat.db
AIMEAT_ADMIN_PASSWORD=your-admin-password
```

### Storage Backends

Valid backends are **PostgreSQL+Kysely and SQLite.** The old pure in-memory provider is deprecated; use SQLite with `AIMEAT_DB_PATH=:memory:` for a fast, ephemeral store on the real code path. (The Prisma-era MongoDB and legacy Prisma-PG backends were removed 2026-07-16.)

| Backend | When to Use | Config |
|---------|------------|--------|
| `sqlite` | Dev, personal nodes, single-user, fast iteration | `AIMEAT_STORAGE=sqlite`, `AIMEAT_DB_PATH=./data/aimeat.db` (or `:memory:`) |
| `postgres-kysely` | Production, multi-user (aliases `postgres`, `postgresql`) | `AIMEAT_STORAGE=postgres-kysely`, `DATABASE_URL=postgresql://...` (schema migrates on boot) |

---

## Development Workflow

### Daily Commands

```bash
cd aimeat

# Start dev server (auto-reload)
pnpm dev

# Type-check after changes
npx tsc --noEmit

# Run linter
pnpm lint

# Run unit tests
pnpm test

# Run E2E tests (quick check)
pnpm test:e2e:memory
```

### Before Submitting Changes

```bash
# Type-check
npx tsc --noEmit

# Lint
pnpm lint

# E2E on multiple backends
pnpm test:e2e:sqlite
pnpm test:e2e:postgres-kysely

# Build to verify production compilation
pnpm build
```

---

## Project Structure Overview

```
aimeat-protocol/
├── CLAUDE.md                    # AI assistant instructions
├── openapi.yaml                 # API specification (75 paths, 88 operations)
├── docs/
│   ├── 01-core.md ... 09-community.md  # RFC specification
│   ├── coding-guidelines/       # Development standards (this folder)
│   ├── frontend-development-guide.md   # Frontend architecture
│   ├── testing/                 # Test plans
│   └── plans/                   # Implementation plans
└── aimeat/                      # Reference implementation
    ├── src/
    │   ├── auth/                # Authentication & keys
    │   ├── routes/              # API route handlers (70 files)
    │   ├── services/            # Business logic (60 files)
    │   ├── storage/             # Data layer + providers
    │   ├── middleware/          # Express middleware
    │   └── config.ts            # Configuration
    ├── public/                  # Frontend SPA
    │   ├── views/               # Lazy-loaded view modules
    │   ├── components/          # Shared Preact components
    │   └── locales/             # i18n (en.json, fi.json)
    ├── test/                    # E2E test suites
    ├── locales/                 # Backend i18n
    └── package.json             # 76 npm scripts
```

---

## Key Reference Documents

| Document | Location | Purpose |
|----------|----------|---------|
| API Specification | `openapi.yaml` | Canonical API contract (75 paths) |
| RFC Core | `docs/01-core.md` | Protocol overview, concepts, pillars |
| Endpoint Reference | `docs/a-endpoints.md` | Quick endpoint lookup |
| Config Reference | `docs/b-config.md` | All configuration options |
| Platform Notes | `docs/c-platform-notes.md` | AI platform compatibility |
| Implementation Guide | `docs/aimeat-implementation-prompt.md` | Detailed implementation guidance |
| Frontend Guide | `docs/frontend-development-guide.md` | Frontend architecture & conventions |

---

## Common Tasks

### Adding a New API Endpoint

1. Create route handler in `src/routes/my-feature.ts` (see [code-style.md](./code-style.md))
2. Add to `src/server.ts`: `app.use(myFeatureRouter(config, storage));`
3. Add storage methods if needed (see [architecture.md](./architecture.md))
4. Add E2E tests (see [testing-requirements.md](./testing-requirements.md))
5. Update `openapi.yaml`
6. Add i18n keys to `locales/en.json` and `locales/fi.json`
7. Run `npx tsc --noEmit` and E2E tests

### Adding a New Frontend View

See `docs/frontend-development-guide.md` — section "Adding a New View".

### Adding a New Admin Dashboard Tab

See `docs/frontend-development-guide.md` — section "Adding a New Admin Tab".

### Adding Configuration Options

See CLAUDE.md — section "Init Wizard Maintenance".

---

## Node Types

| Type | Use Case | Storage | Federation |
|------|----------|---------|------------|
| `full` | Production multi-user node | PostgreSQL | Full peering |
| `relay` | Message relay | Memory/SQLite | Relay only |
| `mirror` | Read replica | SQLite | Sync only |
| `personal` | Single-user personal node | SQLite | Limited |

---

## Deployment

### Production Build

```bash
cd aimeat
pnpm build
pnpm start
```

### Memory: run production under jemalloc

On a glibc host (Ubuntu/Debian bare metal), the default allocator keeps freed memory inside the
process forever, so RSS parks at the boot peak (~1.4 GB) no matter what the node actually uses.
jemalloc hands freed pages back to the OS within seconds; measured on aimeat.io 2026-08-17, steady
state fell to 250-450 MB with bursts unchanged. This is the production launch line:

```bash
sudo apt install libjemalloc2
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so.2 \
MALLOC_CONF="background_thread:true,dirty_decay_ms:10000,muzzy_decay_ms:10000" \
NODE_OPTIONS="--heapsnapshot-signal=SIGUSR2" pnpm start
```

`LD_PRELOAD` must be process environment (launch line or systemd unit), never a `.env` entry —
the dynamic linker consumes it before node starts, so a `.env` value arrives too late and is
silently ignored. The Docker image ships with jemalloc preloaded already.

### With PostgreSQL

```bash
pnpm start -- --db postgres-kysely --db-url postgresql://localhost:5432/aimeat
```

### With SQLite

```bash
pnpm start -- --db sqlite --db-path ./data/aimeat.db
```

### Docker

See `test/docker/` for containerized deployment examples.
