# Environment examples

The configuration reference is [b-config.md](../b-config.md).
The full variable list ships in [aimeat/.env.example](../../aimeat/.env.example).
These examples choose a deployment shape. Configure operator identity,
authentication and other required settings for the actual node.

## Full node

```dotenv
AIMEAT_NODE_ID=my-production-node
AIMEAT_NODE_TYPE=full
AIMEAT_BASE_URL=https://node.example.com
AIMEAT_PORT=40050
AIMEAT_STORAGE=postgres-kysely
DATABASE_URL=postgresql://user:password@database.example.com:5432/aimeat
AIMEAT_SECURITY_PROFILE=public
```

SQLite is also supported. PostgreSQL is not required by the `full` node type.
The database URL above is a placeholder.

## Personal node

```dotenv
AIMEAT_NODE_ID=my-personal-node
AIMEAT_NODE_TYPE=personal
AIMEAT_BASE_URL=http://localhost:40050
AIMEAT_STORAGE=sqlite
AIMEAT_SQLITE_PATH=./data/aimeat.db
```

A personal node defaults to the local security profile. If you expose one publicly,
set and verify the public profile explicitly. Node type does not configure a firewall
or a listening address.

## Relay and mirror types

Configuration accepts `relay` and `mirror`. Runtime guards restrict relay hosting
and mirror writes. Those names alone do not establish working replication,
stateless operation or a tested resource budget.

Read [the Core specification](../AIMEAT-RFC-v4.0-Core-full.md) and
[the actual guards](../../aimeat/src/server-bootstrap/middleware-guards.ts)
before using either role. Verify the required routes on the intended deployment.

Use `AIMEAT_MAX_RELAY_HOPS` for the relay-hop setting. There is no general
`AIMEAT_FEDERATION_ENABLED` setting. See
[the federation guide](../aimeat-cross-federation.md).

## Local development and tests

Use `pnpm sandbox` for interactive work.
An ephemeral SQLite node uses `AIMEAT_STORAGE=sqlite` and
`AIMEAT_SQLITE_PATH=:memory:`. The old `AIMEAT_DB_PATH` examples did not
configure SQLite. The CLI equivalent is `--db-path`.

Claim a free port and initialize the worktree's test environments from `aimeat/`:

```powershell
$env:AIMEAT_E2E_PORT = '<port from your claim>'
pnpm test:env:init
```

This creates `.env.test.sqlite` and `.env.test.postgres-kysely`.
Each session uses its own database and port. Test runners empty their database;
copying another session's configuration can erase its test data.

## Personal-node hosting settings

The host side reads:

- `AIMEAT_PERSONAL_MAILBOX_QUOTA_MB`
- `AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS`
- `AIMEAT_PERSONAL_HEARTBEAT_MS`
- `AIMEAT_PERSONAL_OFFLINE_MS`
- `AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS`
- `AIMEAT_PERSONAL_NODE_MAX_SLOTS`

See [the personal-node guide](../personal-node-setup-guide.md) and
[config.ts](../../aimeat/src/config.ts) for meanings and defaults.

## Host-sealed settings

When the host and node operator are different parties, the host can make specific
settings read-only:

```dotenv
AIMEAT_SEALED_CONFIG_KEYS=quota.memory_mb,quota.storage_mb,rate_limits.global
AIMEAT_MEMORY_QUOTA_MB=1024
AIMEAT_STORAGE_QUOTA_MB=2048
AIMEAT_RL_GLOBAL=500
```

These are example limits. The seal lists dot paths; values still come from normal
configuration sources. Admin writes, stored overrides and Consul cannot change a
sealed path. Unknown paths refuse startup.

See [configuration precedence](../b-config.md) and
[the original design](../plans/sealed-config-plan.md).
