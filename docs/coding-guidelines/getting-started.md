# Developing AIMEAT

Use Node.js 24 or later and pnpm 10. SQLite needs no database server.
PostgreSQL with Kysely is the production storage provider, and you need a running PostgreSQL only
to test against it.

## Set up a checkout

From a fresh clone of the repository (or of your fork):

```bash
pnpm install            # at the root: turns on the git hooks in .githooks/
cd aimeat
pnpm install            # the node's dependencies (aimeat/pnpm-lock.yaml)
pnpm test:env:init      # this checkout's .env.test.sqlite and .env.test.postgres-kysely
pnpm codeql:install     # once per machine: one check in pnpm gate needs CodeQL
```

`pnpm test:env:init` writes the test settings from the committed `*.example` files, with a port
derived from the checkout's folder name and a Postgres database of its own, and creates that
database when PostgreSQL is running. Never copy the example files by hand: they all name one port
and one database, and the test runner empties that database between suites, so two checkouts
that share it wipe each other's runs. `AIMEAT_E2E_PORT=<port> pnpm test:env:init` takes an
explicit port (40251 to 40499); `--force` rewrites existing files.

[CONTRIBUTING.md](../../CONTRIBUTING.md) is the same path for an outside contributor, through to
the pull request.

## Maintainer sessions

The maintainers' Claude Code sessions add a coordination ritual on top of the setup above. It is
described in [CLAUDE.md](../../CLAUDE.md) and in the `aimeat-dev-session` skill on the node, and in
short:

- Every session works in its own worktree under `.worktrees/`, created by `claude --worktree
  cc-<owner>-<tag>` or the `EnterWorktree` tool. The `WorktreeCreate` hook
  (`.claude/hooks/worktree-create.sh`) runs the setup above in it. The main checkout belongs to the
  developer.
- The session sets `AIMEAT_SESSION` and `AIMEAT_PROJECT`, which the hooks stamp on each commit as
  `Session:` and `Project:` trailers.
- Before editing, the session reads the Lifecycle Central board and claims the paths and the E2E
  port it will use, and passes that port to `pnpm test:env:init` as `AIMEAT_E2E_PORT`.

## See a change locally

From `aimeat/`, run `pnpm sandbox`. The sandbox is a node with its own port (40600 upward), its own
SQLite file, three owners with passwords, an agent, two published apps and everything a fresh node
seeds. It prints its address and credentials and writes them to `aimeat/.sandbox.json`
(gitignored). Check the actual behaviour with a browser reload or one API request.
`pnpm sandbox --reset` seeds it again from nothing, and `pnpm sandbox:stop` stops it and keeps the
data.

The sandbox needs no `aimeat/.env`. A shared development server is not a test environment.

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
`pnpm dev` (from the root or `aimeat/`) starts the node from source and needs this file.

Read [the configuration reference](../b-config.md) for precedence and sealed settings.
`aimeat config` reports settings for the process that runs that command.
The server's admin API reports the running server's configuration.

## Verify a change

Define the expected result before testing. Then run the suites the change can reach, one at a
time:

```bash
# From aimeat/, after pnpm test:env:init:
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>
pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=<suite>
```

`<suite>` is a file name from `aimeat/test/` with or without the `e2e-` prefix, for example
`--test=agent-onboarding`. Without `--test=` the runner starts every suite.

Run `pnpm gate` once on the finished change. A green gate is what "done" needs; do not wait for
GitHub CI. `pnpm gate --postgres` adds the production backend when the change touches storage or
the identity layer. The full E2E sweep takes about two hours and runs only with the developer's
approval. See [testing requirements](testing-requirements.md).

## Find the implementation

| Path | Content |
|---|---|
| `openapi.yaml` | Canonical API contract |
| `aimeat/src/routes/` | REST routes |
| `aimeat/src/server-bootstrap/` | Startup and route registration |
| `aimeat/src/services/` | Shared behaviour |
| `aimeat/src/storage/` | Interfaces and both providers |
| `aimeat/src/mcp/` | MCP tool definitions and dispatch |
| `aimeat/public/` | Preact and HTM interface |
| `aimeat/src/static/sdk-libs/` | Served browser SDK source |
| `aimeat/locales/` | UI and server strings (en, fi, es) |
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
settings, including memory settings and restart behaviour. Adapt it to the actual
installation. `NODE_OPTIONS` controls the V8 heap ceiling. `LD_PRELOAD`, when
used for jemalloc, must be set before starting Node. A Node-loaded `.env` is too late.

An update of a running node is a stop, an install and a start. Every database change it brings runs
by itself at start, and the node always starts; what a change cannot place on evidence stays as it
is and becomes one incident on the admin Security page. Nobody runs a script by hand.

Read [the deployment checklist](../security/deployment-checklist.md) and
[observability guide](../../aimeat/docs/observability-guide.md).
Repository work does not authorize changing a running deployment or creating a release.
