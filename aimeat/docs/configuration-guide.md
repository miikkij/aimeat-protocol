# AIMEAT Configuration Guide

## Quick Start

```bash
# Interactive wizard creates your config file
aimeat init

# Check for problems
aimeat validate

# Start the node
aimeat start
```

## Config Sources

AIMEAT supports multiple configuration sources with a clear precedence hierarchy. Higher-priority sources override lower ones:

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | CLI args | `--port`, `--db`, `--consul`, etc. |
| 2 | Database | Admin dashboard changes (persisted) |
| 3 | Consul KV | Fleet management (live reload) |
| 4 | Config file | `aimeat.ini` or `aimeat.json` |
| 5 | Environment | `.env` file or shell environment |
| 6 (lowest) | Defaults | Built-in values |

### Immutable vs Mutable Fields

- **Immutable fields** (`node.id`, `node.port`, `storage.type`, etc.) can only be set via CLI args, config files, or environment variables. They cannot be changed at runtime.
- **Mutable fields** (morsel policy, features, quotas, etc.) can be changed via the admin dashboard, Consul, or `aimeat config import`.

## In-Memory vs Persistent Storage

| Feature | In-Memory | SQLite / MongoDB |
|---------|-----------|------------------|
| Config editing via dashboard | Read-only | Full read/write |
| Config persistence | Lost on restart | Persists across restarts |
| `aimeat config import` | Not supported | Supported |
| Consul live reload | Applied to runtime only | Applied + persisted |

If you're using in-memory storage, configure the node via `.env`, `aimeat.ini`, or CLI arguments.

## Admin Dashboard

For nodes with persistent storage (SQLite or MongoDB), the admin dashboard at `/v1/admin` is the primary way to manage configuration.

- **Source badges** show where each value comes from (default, env, file, consul, database)
- **Reset buttons** appear next to database-overridden values to revert to the next-lower source
- **In-memory banner** appears when config editing is disabled

## File Config

### aimeat.ini (INI format)

Human-friendly format with sections:

```ini
[node]
id = my-node-001
port = 40050
type = full

[storage]
type = sqlite

[morsel_policy]
welcome_bonus = 100
daily_allowance = 50
burn_rate = 0.10

[features]
keyed_browse_enabled = true
```

Auto-detected in the working directory. Or specify explicitly:

```bash
aimeat start --config /path/to/aimeat.ini
```

### aimeat.json (JSON format)

Machine-friendly format with nested structure:

```json
{
  "node": {
    "id": "my-node-001",
    "port": 40050,
    "type": "full"
  },
  "storage": {
    "type": "sqlite"
  },
  "morsel_policy": {
    "welcome_bonus": 100,
    "daily_allowance": 50,
    "burn_rate": 0.10
  }
}
```

Must be specified with `--config`:

```bash
aimeat start --config production.json
```

## Environment Variables

All AIMEAT settings can be configured via `AIMEAT_*` environment variables. See `.env.example` for the full reference.

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_NODE_ID` | `aimeat-local-001-dev` | Unique node identifier |
| `AIMEAT_PORT` | `40050` | HTTP listen port |
| `AIMEAT_STORAGE` | `memory` | Storage: mongodb, sqlite, memory |
| `AIMEAT_ADMIN_PASSWORD` | (none) | Operator admin password |
| `DATABASE_URL` | (none) | MongoDB connection URL |
| `AIMEAT_SQLITE_PATH` | `data/aimeat.db` | SQLite database file path |
| `AIMEAT_WELCOME_BONUS` | `100` | Morsels for new agents |
| `AIMEAT_DAILY_ALLOWANCE` | `50` | Daily morsel allowance |
| `AIMEAT_BURN_RATE` | `0.10` | Fraction of fees burned |

## CLI Arguments

### Start Options

```bash
aimeat start [options]

--db <type>              Storage type: mongodb, sqlite, memory
--db-url <url>           Database connection URL (MongoDB)
--db-path <path>         SQLite database file path
-p, --port <port>        HTTP port (default: 40050)
--node-id <id>           Node identity string
--admin-password <pw>    Operator admin secret
-c, --config <path>      Config file path
--consul <url>           Enable Consul and set URL
--consul-prefix <prefix> Consul KV prefix (default: aimeat/config)
--consul-token <token>   Consul ACL token
```

### Config Commands

```bash
# Show all settings and their sources
aimeat config

# Export config to various formats
aimeat config export --format env    # stdout: .env format
aimeat config export --format ini    # stdout: INI format
aimeat config export --format json   # stdout: JSON format
aimeat config export --format consul # push to Consul KV

# Import config into database
aimeat config import --file .env
aimeat config import --file aimeat.ini
aimeat config import --file config.json
aimeat config import --from consul
```

## Consul Integration

### Setup

1. **Start Consul:**
   ```bash
   docker run -d --name consul -p 8500:8500 hashicorp/consul
   ```

2. **Configure AIMEAT:**
   ```bash
   # Via environment
   export AIMEAT_CONSUL_ENABLED=true
   export AIMEAT_CONSUL_URL=http://localhost:8500

   # Or via CLI
   aimeat start --consul http://localhost:8500
   ```

3. **Export current config to Consul:**
   ```bash
   aimeat config export --format consul
   ```
   Or use the admin dashboard Consul tab "Export to Consul" button.

### How It Works

- AIMEAT loads mutable config values from Consul KV at startup
- A polling watcher checks for changes every 30 seconds (configurable via `AIMEAT_CONSUL_WATCH_INTERVAL_SECONDS`)
- Consul values have higher priority than file/env but lower than database
- Only mutable fields are read from Consul; immutable fields are ignored

### Fleet Management

Point multiple AIMEAT nodes to the same Consul KV prefix to share configuration:

```bash
# Node 1
aimeat start --consul http://consul:8500 --consul-prefix fleet/shared

# Node 2
aimeat start --consul http://consul:8500 --consul-prefix fleet/shared

# Node 3 (different prefix for different config)
aimeat start --consul http://consul:8500 --consul-prefix fleet/staging
```

### Consul KV Structure

Keys are stored under the prefix with slash-separated paths:

```
aimeat/config/morsel_policy/welcome_bonus = "100"
aimeat/config/morsel_policy/daily_allowance = "50"
aimeat/config/features/keyed_browse_enabled = "true"
```

### Admin Dashboard

The Consul tab in the admin dashboard shows:
- Connection status (healthy/unreachable)
- Number of keys loaded
- List of all Consul KV keys
- Export/Import buttons for bulk operations

## Migration: .env to Database

For operators upgrading from env-only setups:

```bash
# 1. Start with persistent storage
aimeat start --db mongodb --db-url mongodb://localhost:27017/aimeat

# 2. Import existing .env into the database
aimeat config import --file .env

# 3. Manage config via admin dashboard
# The .env can be trimmed to just bootstrap fields:
# DATABASE_URL, AIMEAT_STORAGE, AIMEAT_ADMIN_PASSWORD
```

The import is **additive**: it writes values to the database but doesn't modify the `.env` file. Since the database has higher precedence, imported values immediately take effect.

## Multiple Environments

Use named config files to manage multiple environments on one machine:

```bash
# Generate configs for each environment
aimeat init  # Choose JSON output, name it production.json
aimeat init  # Choose JSON output, name it staging.json

# Start with specific config
aimeat start --config production.json
aimeat start --config staging.json
```

## Config Source Provenance

Every config value tracks its origin. The admin dashboard shows colored badges:

| Badge | Source | Meaning |
|-------|--------|---------|
| **database** (green) | Admin dashboard | Highest priority, persisted |
| **consul** (yellow) | Consul KV | Fleet-managed, live reload |
| **file** (purple) | aimeat.ini/json | Static file config |
| **env** (blue) | .env / environment | Environment variable |
| **default** (gray) | Built-in | No override applied |

Database-overridden values show a "Reset" button to remove the override and revert to the next-lower source.
