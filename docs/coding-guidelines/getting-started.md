# Developing AIMEAT

Use Node.js 24 or later and pnpm 10 or later. SQLite needs no database server.
PostgreSQL with Kysely is the other supported storage provider.

## Start a session

Read [CLAUDE.md](../../CLAUDE.md) and [README.md](../../README.md) first.
Load the live `node:aimeat-dev-session` skill, read the Lifecycle Central board,
and claim the paths and test port before editing.

Use a dedicated worktree from `origin/main`. The main checkout belongs to the
developer. This manual setup is equivalent to the repository's worktree hook.
Run it from the main checkout after opening your claim:

```powershell
$env:AIMEAT_SESSION = 'cc-owner-unique-tag'
$env:AIMEAT_PROJECT = 'aimeat-protocol'
$env:AIMEAT_E2E_PORT = '<port from your claim>'
git fetch origin
git worktree add --detach ".worktrees/$env:AIMEAT_SESSION" origin/main
Set-Location ".worktrees/$env:AIMEAT_SESSION/aimeat"
pnpm install
pnpm test:env:init
```

Each worktree installs its own dependencies. Set the session and project in each
shell that commits. Read current incidents before pulls, runs and pushes.

## See a change locally

From your worktree, run `pnpm sandbox`. The sandbox has its own port, SQLite file,
owners, agents and sample data. It prints its connection details and writes them to
a gitignored file. Verify the actual behavior with a browser or an API request.
Use `pnpm sandbox:stop` when finished.

A shared development server is not a session's test environment.

## Configure a standalone node

Copy `aimeat/.env.example` to `aimeat/.env`, then choose the settings you need:

```dotenv
AIMEAT_NODE_ID=my-local-node
AIMEAT_PORT=40050
AIMEAT_STORAGE=sqlite
AIMEAT_SQLITE_PATH=./data/aimeat.db
```

Use `AIMEAT_SQLITE_PATH=:memory:` for ephemeral SQLite storage.
For PostgreSQL, set `AIMEAT_STORAGE=postgres-kysely` and `DATABASE_URL`.

Read [the configuration reference](../b-config.md) for precedence and sealed settings.
`aimeat config` reports settings for the process that runs that command.
The server's admin API reports the running server's configuration.

## Verify a change

Define the expected result before testing.

```bash
# From aimeat/, with this worktree's test environment initialized:
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>
```

Use the matching PostgreSQL environment when the change needs both providers.
Run `pnpm gate` once on the finished change and confirm CI on the pushed commit.
Full E2E sweeps require developer approval.
See [testing requirements](testing-requirements.md).

## Find the implementation

| Path | Content |
|---|---|
| `openapi.yaml` | Canonical API contract |
| `aimeat/src/routes/` | REST routes |
| `aimeat/src/server-bootstrap/` | Startup and route registration |
| `aimeat/src/services/` | Shared behavior |
| `aimeat/src/storage/` | Interfaces and both providers |
| `aimeat/src/mcp/` | MCP tool definitions and dispatch |
| `aimeat/public/` | Preact and HTM interface |
| `aimeat/src/static/sdk-libs/` | Served browser SDK source |
| `aimeat/locales/` | UI and server strings |
| `aimeat/test/` | Executable tests |
| `python/aimeat-crewai/` | Python liaison |
| `aimeat-desktop/` | Desktop node installer |

See [architecture](architecture.md) for the subsystem map.

## Build and operate a node

```bash
pnpm build
pnpm start
```

[The deployment unit](../../aimeat/deploy/aimeat.service) records the Linux service
settings, including memory settings and restart behavior. Adapt it to the actual
installation. `NODE_OPTIONS` controls the V8 heap ceiling. `LD_PRELOAD`, when
used for jemalloc, must be set before starting Node. A Node-loaded `.env` is too late.

Read [the deployment checklist](../security/deployment-checklist.md) and
[observability guide](../../aimeat/docs/observability-guide.md).
Repository work does not authorize changing a running deployment or creating a release.
