# Environment Configuration by Node Type

## Node Types

AIMEAT supports four node types, each with different resource requirements and configuration profiles.

---

## Full Node (Production)

**Use case:** Multi-user production deployment, public-facing, federation-capable.

```bash
# .env for full node
AIMEAT_NODE_ID=my-node-production
AIMEAT_PORT=40050
AIMEAT_NODE_TYPE=full
AIMEAT_BASE_URL=https://my-node.example.com

# Storage: PostgreSQL required
AIMEAT_STORAGE=postgres-kysely
DATABASE_URL=postgresql://user:pass@localhost:5432/aimeat

# Auth
AIMEAT_ADMIN_PASSWORD=<strong-random-password>
AIMEAT_JWT_TTL=3600
# OTK / Tier-0.5 keyed-browse is deprecated (superseded by device auth + MCP); leave off.
AIMEAT_OTK_ENABLED=false

# Economy
AIMEAT_WELCOME_BONUS=100
AIMEAT_DAILY_ALLOWANCE=10
AIMEAT_BURN_RATE=0.01

# Federation
AIMEAT_GENESIS_URL=https://genesis.aimeat.network
AIMEAT_FEDERATION_ENABLED=true

# Rate limiting (production values)
AIMEAT_RL_GLOBAL=1000
AIMEAT_RL_AUTH=100
AIMEAT_RL_WORK=200
AIMEAT_RL_MEMORY=500
AIMEAT_RL_BOARDS=200

# Email (required for user verification)
AIMEAT_SMTP_HOST=smtp.example.com
AIMEAT_SMTP_PORT=587
AIMEAT_SMTP_USER=noreply@example.com
AIMEAT_SMTP_PASS=<smtp-password>
AIMEAT_SMTP_FROM=noreply@example.com

# Push notifications (optional)
AIMEAT_VAPID_PUBLIC_KEY=<generated-vapid-public>
AIMEAT_VAPID_PRIVATE_KEY=<generated-vapid-private>
AIMEAT_VAPID_SUBJECT=mailto:admin@example.com

# TOTP 2FA
AIMEAT_TOTP_ISSUER=MyNode
```

**Requirements:**
- PostgreSQL 16+ running
- Reverse proxy (nginx/caddy) with TLS termination
- Sufficient RAM for concurrent users (recommended: 2GB+)
- Persistent disk for PostgreSQL data

---

## Personal Node

**Use case:** Single-user, home/private deployment, IoT, forest cabin. Low resource requirements.

```bash
# .env for personal node
AIMEAT_NODE_ID=my-personal-node
AIMEAT_PORT=40050
AIMEAT_NODE_TYPE=personal
AIMEAT_BASE_URL=http://localhost:40050

# Storage: SQLite (lightweight, file-based)
AIMEAT_STORAGE=sqlite
AIMEAT_SQLITE_PATH=./data/aimeat.db

# Auth
AIMEAT_ADMIN_PASSWORD=<password>
AIMEAT_JWT_TTL=86400

# Economy (relaxed for personal use)
AIMEAT_WELCOME_BONUS=1000
AIMEAT_DAILY_ALLOWANCE=100

# Federation (connect to a parent node)
AIMEAT_GENESIS_URL=https://genesis.aimeat.network
AIMEAT_FEDERATION_ENABLED=true

# Personal node specific
AIMEAT_PERSONAL_MAILBOX_QUOTA=1000
AIMEAT_PERSONAL_HEARTBEAT_INTERVAL=60000
AIMEAT_PERSONAL_OFFLINE_TIMEOUT=86400000

# Rate limiting (relaxed for single user)
AIMEAT_RL_GLOBAL=10000
AIMEAT_RL_AUTH=1000
AIMEAT_RL_MEMORY=5000

# Email/Push typically not needed for personal nodes
```

**Requirements:**
- Minimal: Node.js 24, ~256MB RAM
- Runs on Raspberry Pi, NAS, laptop, or cloud micro instance
- SQLite data file in `./data/` directory
- No external database needed

---

## Relay Node

**Use case:** Message relay, routing between nodes. No user data storage.

```bash
# .env for relay node
AIMEAT_NODE_ID=relay-eu-west-001
AIMEAT_PORT=40050
AIMEAT_NODE_TYPE=relay
AIMEAT_BASE_URL=https://relay-eu.example.com

# Storage: ephemeral (relay holds no persistent user data) — SQLite :memory:
AIMEAT_STORAGE=sqlite
AIMEAT_DB_PATH=:memory:

# Auth
AIMEAT_ADMIN_PASSWORD=<password>

# Federation (core purpose)
AIMEAT_GENESIS_URL=https://genesis.aimeat.network
AIMEAT_FEDERATION_ENABLED=true
AIMEAT_RELAY_HOPS=3

# Rate limiting (higher for relay traffic)
AIMEAT_RL_GLOBAL=5000
AIMEAT_RL_FEDERATION=2000

# No email, push, economy, or user-facing features needed
```

**Requirements:**
- Minimal: Node.js 24, ~128MB RAM
- Good network connectivity
- No persistent storage needed
- Should be geographically distributed for latency

---

## Mirror Node

**Use case:** Read replica, data redundancy, offline access to a parent node's data.

```bash
# .env for mirror node
AIMEAT_NODE_ID=mirror-backup-001
AIMEAT_PORT=40050
AIMEAT_NODE_TYPE=mirror
AIMEAT_BASE_URL=https://mirror.example.com

# Storage: SQLite (sync'd from parent)
AIMEAT_STORAGE=sqlite
AIMEAT_SQLITE_PATH=./data/mirror.db

# Auth
AIMEAT_ADMIN_PASSWORD=<password>

# Federation (sync from parent)
AIMEAT_GENESIS_URL=https://parent-node.example.com
AIMEAT_FEDERATION_ENABLED=true

# Read-only settings
AIMEAT_RL_GLOBAL=2000
```

**Requirements:**
- Node.js 24, ~512MB RAM
- Persistent disk for SQLite data
- Network access to parent node for sync

---

## Development Environment

**Use case:** Local development, debugging, testing.

```bash
# .env for development (copy from .env.example)
AIMEAT_NODE_ID=aimeat-local-001-dev
AIMEAT_PORT=40050
AIMEAT_NODE_TYPE=full
AIMEAT_BASE_URL=http://localhost:40050

# Storage: SQLite :memory: (fast, no cleanup, real SQL code path)
AIMEAT_STORAGE=sqlite
AIMEAT_DB_PATH=:memory:

# Auth (simple password for dev)
AIMEAT_ADMIN_PASSWORD=devpass123

# Extended features enabled for testing
AIMEAT_EXTENDED_FEATURES=true

# Relaxed rate limits for testing
AIMEAT_RL_GLOBAL=10000
AIMEAT_RL_AUTH=1000
AIMEAT_RL_WORK=1000
AIMEAT_RL_MEMORY=1000
AIMEAT_RL_BOARDS=1000

# Default agent scopes (permissive for dev)
AIMEAT_DEFAULT_AGENT_SCOPES=*
```

---

## Testing Environments

Two supported test configs exist for E2E testing:

| File | Backend | Usage |
|------|---------|-------|
| `.env.test.sqlite` | SQLite (disk or `:memory:`) | Fast-iteration default (`pnpm test:e2e:sqlite`) |
| `.env.test.postgres-kysely` | PostgreSQL + Kysely | Primary / prod backend (`pnpm test:e2e:postgres-kysely`) |

> `.env.test.memory` / `pnpm test:e2e:memory` (pure in-memory) is **deprecated** — do not use it for verification.

All test environments use port 40251 and relaxed rate limits.

---

## Configuration Reference

Full list of all 80+ environment variables: see `.env.example` in the `aimeat/` directory.

Complete schema documentation: see `docs/b-config.md`.

Configuration priority (highest to lowest):
1. **Values persisted in the node's own database** (`PUT /v1/admin/config`), re-applied at every
   boot by `applyConfigOverrides()`. This is the layer that decides what a node actually runs on,
   and the one most often forgotten: a value set here beats the environment, permanently, across a
   restart and an image swap.
2. Consul KV, where it is enabled: loaded at boot and re-applied by a watch loop on every change
3. CLI arguments (`--db postgres-kysely`)
4. Config file (`--config production.ini`)
5. Environment variables (`AIMEAT_*`)
6. Defaults in `src/config.ts`

Two classes sit above all of it: fields marked `immutable: true` in `CONFIG_FIELDS`, and the paths
a node's host sealed at boot (next section).

---

## Running nodes for other people

Everything above assumes the person who runs the machine and the person who operates the node are
the same person, which is true of every self-hosted node. When they are not — a hosting provider, a
university running one node per department, a company running one per team — there is a set of
settings the operator must be able to READ and must not be able to CHANGE: resource quotas, rate
limits, whether metrics are collected, how far a federated request may relay.

Putting those in the container environment does not hold on its own, because of priority 1 above.
Nominate them instead:

```bash
# Set by whoever STARTS the node. Names paths, not values.
AIMEAT_SEALED_CONFIG_KEYS=quota.memory_mb,quota.storage_mb,rate_limits.global,metrics.enabled

# The values still come from the ordinary variables.
AIMEAT_MEMORY_QUOTA_MB=1024
AIMEAT_STORAGE_QUOTA_MB=2048
AIMEAT_RL_GLOBAL=500
AIMEAT_METRICS_ENABLED=true
```

What that buys, and what it deliberately does not:

- The operator **sees** every sealed value on `GET /v1/admin/config`, marked `sealed: true` with
  `source: "sealed"`, and on the admin Config tab with a badge and a line saying who set it. Sealing
  is not hiding.
- `PUT /v1/admin/config` and `DELETE /v1/admin/config/:path` refuse a sealed path with 403
  `SEALED_CONFIG`, and a `PUT` carrying one sealed path applies **none** of its other changes.
- A value already persisted in the node's database on a sealed path is ignored at boot and logged
  by name. Consul does not move one either, on any of its three roads in (boot, watch loop,
  `POST /v1/admin/consul/import`), and `aimeat config import` reports it rather than writing it.
- **An unknown path refuses the boot.** A typo would otherwise produce a node that looks sealed and
  is not, which nothing would report.
- Unset — the default, and the right value for every self-hosted node — nothing changes. The
  operator owns all of these settings, as they should.

There is no new role and no new credential: the seal is a property of how the process was started,
which is the trust boundary the deployment already has. Design and the reasoning against the
alternative: `docs/plans/sealed-config-plan.md`. Implementation: `src/services/config-sealing.ts`.
