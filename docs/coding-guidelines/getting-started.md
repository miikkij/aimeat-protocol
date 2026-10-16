# Developing AIMEAT

Use Node.js 24 or later and pnpm 10 (see [A new machine](#a-new-machine) for how to get them). SQLite
needs no database server.
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

## A new machine

`pnpm machine:check` (from `aimeat/`) lists what this machine lacks for the tests and the gates,
with the command for each. It changes nothing. It exits 1 only when something required is missing:
Node, pnpm, this checkout's test settings or the pinned CodeQL. What a machine needs:

- **Node 24 or later.** The root `.nvmrc` names it for `nvm use`.
- **pnpm.** Both `package.json` files pin the same version in `packageManager`, and
  `test/unit/toolchain-pins.test.ts` keeps them and the Dockerfile equal. `corepack enable` puts a
  `pnpm` on PATH that runs that version. On Windows it may need an administrator shell. Without
  it, put a script named `pnpm` that runs `corepack pnpm "$@"` on PATH, and a `pnpm.cmd` for
  Windows child processes. The git hooks and the package scripts call bare `pnpm`, so `corepack
  pnpm` alone is not enough.
- **The git hooks.** `pnpm install` at the root sets `core.hooksPath` to `.githooks`.
- **PostgreSQL 16 or 17**, only for the PostgreSQL suites. CI and `docker-compose.yml` run 16,
  which is the oldest version the node supports, and the node logs a warning at start on an older
  server. The test settings example carries the CI service's account (`appuser:devpassword123`).
  When your server has another account, write yours together with this checkout's database:

  ```bash
  AIMEAT_TEST_DATABASE_URL=postgresql://<user>:<password>@localhost:5432/x pnpm test:env:init --force
  ```

  A run over existing files creates the database that the file names when it is missing.
- **A port of the checkout's own.** `pnpm test:env:init` and `pnpm machine:check` warn when another
  checkout's test settings name the same port, or a process holds it. Take a free one with
  `AIMEAT_E2E_PORT=<port> pnpm test:env:init --force`.
- **CodeQL**, for `check:field-reach` in `pnpm check:fast`, which refuses without it.
  `pnpm codeql:install` downloads the pinned bundle from the public GitHub release over HTTPS
  (about 660 MB) and checks its sha256. It needs no GitHub CLI. `--from <codeql executable>`
  registers a CLI that is already on the machine.
- **Optional:** Playwright browsers for the browser checks (`pnpm exec playwright install
  chromium`), and the GitHub CLI for `pnpm ci:stats`.

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
`pnpm dev` (from the root or `aimeat/`) starts the node from source, and `pnpm start` starts the
built node (`pnpm build` first); both need this file. The node refuses to start on a value it does
not accept, and names the setting; `aimeat validate` checks the file without starting.

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

A node runs without a clone of the repository. The npm package is the same server:

```bash
npx aimeat init     # interactive setup, writes .env (storage, node id, keys)
npx aimeat start    # starts the server on port 40050
```

From a clone, build it and start it from `aimeat/`:

```bash
pnpm build
pnpm start
```

Or with Docker, one compose file per storage backend, run from `aimeat/`:

```bash
docker compose up --build                                  # PostgreSQL with Kysely, the production backend
docker compose -f docker-compose.sqlite.yml up --build     # SQLite, no external database
```

A fresh node with no owner serves its setup page (`/v1/setup/wizard`) for every page address. The
first owner created there gets the operator role.

The `aimeat` CLI carries the operator commands: `aimeat config` prints every setting and where its
value comes from (`config export` and `config import` move it), `aimeat validate` checks the
configuration for problems, `aimeat update` copies the installed package's asset files into the
working folder and skips any file you changed, `aimeat backup [file]` and `aimeat restore <file>`
export and import accounts and agents as one JSON file (see below: not a backup), and `aimeat maintenance on [message]`,
`aimeat maintenance off` and `aimeat maintenance` turn maintenance mode on, off, or show it. A fresh
node installs its bundled example packages by itself at start.

### What to back up

A node is three things together: the database (the SQLite file, or a `pg_dump`), the `.env` file,
and the node's key file, `~/.aimeat/nodes/<node id>/node-key.json` (`AIMEAT_NODE_KEY_PATH` moves
it). The `.env` holds the key every stored secret is encrypted with (`AIMEAT_ENCRYPTION_KEY`, or
`AIMEAT_TOTP_ENCRYPTION_KEY` when the first is not set) and the passphrase of the node's identity
key (`AIMEAT_KEY_PASSPHRASE`). Never change those values on a running node: a different data key
leaves AI keys, vault secrets and two-step sign-in secrets unreadable, and the database alone does
not restore the node's identity. If you set them outside `.env` (Docker, systemd), back them up from
there.

`aimeat backup` is a partial export, not a backup: it carries accounts, agents and agents' memory but
not the records people keep under their own accounts, organisms, apps or files, and no credential.
It needs a personal access token of an operator account (`--token <token>` or `AIMEAT_OP_TOKEN`),
and a refusal writes no file and exits 1. The procedure, the restore and its test:
[backup and restore](../operations/backup-and-restore.md).

### App thumbnails (optional)

`aimeat screenshot-worker` renders each published app and stores the thumbnail the app catalogue
and the front page show; `--watch <seconds>` keeps it running. It drives the machine's installed
Chrome or Edge through Playwright, so a desktop needs no browser download; a headless server
installs Chromium with the installer of its own `playwright-core`, which the worker's error message
prints (`node node_modules/playwright-core/cli.js install chromium` in `aimeat/`). `npx playwright
install` can fetch a newer Playwright, whose Chromium build the node does not start. It signs in
with a long-lived operator token, minted with `POST /v1/access/tokens` and `grant_operator: true`.
A node runs without it.

A node started with `AIMEAT_SCREENSHOT_AUTO=true` takes the thumbnails itself and needs no worker.
It checks its browser at start, downloads the Chromium build its `playwright-core` names when that
build is missing (after every `playwright-core` update), and opens an incident on the admin Security
page when the browser still does not start.

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
