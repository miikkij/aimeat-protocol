# Contributing to AIMEAT

Thank you for your interest in contributing to the AIMEAT Protocol. This page takes you from a
fresh clone to a pull request: set up, look at your change on a node of your own, run one test
suite, and pass the same gate the maintainers pass.

## What you need

- **Node.js 24 or later** and **pnpm 10** (`corepack enable` gives you the version that each
  `package.json` names in `packageManager`).
- **Git.** On Windows, run the commands below in Git Bash or PowerShell; both work.
- **PostgreSQL** only if your change touches storage or you want to run the production backend.
  SQLite needs no server, and it is the default for everything below.

## Set up

```bash
git clone https://github.com/<you>/aimeat-protocol.git
cd aimeat-protocol
pnpm install            # once, at the root: it turns on the git hooks in .githooks/
cd aimeat
pnpm install            # the node's dependencies
pnpm test:env:init      # writes .env.test.sqlite and .env.test.postgres-kysely for this checkout
pnpm codeql:install     # once per machine: pnpm gate needs CodeQL for one of its checks
```

`pnpm test:env:init` writes the test settings from the committed `*.example` files with a port
and a Postgres database name of this checkout's own. Do not copy the example files by hand: they
all name the same port and database, and the test runner empties that database between suites.
When no PostgreSQL server is running, the command says so and the SQLite file still works.

## See your change on a node of your own

```bash
cd aimeat
pnpm sandbox            # starts a node with its own port and SQLite file, and seeds it
```

The sandbox has three owners with passwords, an agent, two published apps and the content a fresh
node seeds by itself. It prints the address and every credential, and writes them to
`aimeat/.sandbox.json` (gitignored). Reload the browser or send one request to see a change.
`pnpm sandbox` again reuses the node and refreshes the tokens, `pnpm sandbox --reset` throws the
data away and seeds again, and `pnpm sandbox --stop` stops it.

To run a node as a normal installation instead, copy `aimeat/.env.example` to `aimeat/.env` and
run `pnpm dev`. See [Getting started](docs/coding-guidelines/getting-started.md).

## Test your change

Run the suites your change can reach, one at a time, from `aimeat/`:

```bash
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding
pnpm exec vitest run test/unit/<file>.test.ts
```

`--test=` takes a suite's file name from `aimeat/test/`, with or without the `e2e-` prefix. Use
`.env.test.postgres-kysely` instead to run the same suite on PostgreSQL. A new feature ships with
an E2E suite: the happy path and one failure. See
[Testing requirements](docs/coding-guidelines/testing-requirements.md).

Do not start the full E2E sweep (`pnpm test:e2e:sqlite`, `pnpm test:e2e:postgres-kysely`). It runs
every suite and takes about two hours. The maintainers run it before a release.

## Pass the gate

When the change is finished, run the gate once:

```bash
cd aimeat
pnpm gate               # add --postgres when the change touches storage or the identity layer
```

The gate reads what changed since `origin/main` and runs what that change can reach: the read-only
checks, the unit tests whose imports reach a changed file, any E2E suite you changed, and the
security guard tier when you changed backend code. It prints its plan and the reason for each step
before it runs. If your fork's `origin/main` is behind the upstream repository, pass
`--base=upstream/main`. A green gate is what the maintainers accept as done.

## What the git hooks check

`pnpm install` at the root points git at `.githooks/`:

- **pre-commit** runs lint and the three type checks (`pnpm lint`, `pnpm typecheck`,
  `pnpm typecheck:frontend`, `pnpm typecheck:sdk`), about twenty seconds.
- **commit-msg** refuses a `Co-Authored-By` trailer and a message that a shell mangled. Write a
  multi-line message to a file and commit with `bash scripts/git-commit.sh <file>`. See
  [Shell and Git](docs/coding-guidelines/shell-and-git.md).
- **pre-push** refuses a push when your branch is behind the remote's `main`, and a tree whose
  boot path does not load.

If you work with Claude Code, set `AIMEAT_SESSION` to a name of your choice in the shell that
commits (for example `export AIMEAT_SESSION=cc-yourname-fix`). The hook adds it to each commit as a
`Session:` trailer and refuses a Claude Code commit without it.

## Code standards

- [Code style](docs/coding-guidelines/code-style.md): TypeScript strict mode, `.js` extensions in
  ESM imports, the response envelope, route patterns.
- [File headers](docs/coding-guidelines/file-headers.md): every source file carries one.
- No source file over 800 lines. Split a large file by moving a coherent group to a sibling file
  and changing nothing else.
- A route change updates `openapi.yaml` in the same commit.
- A tool an agent can call has three surfaces: the node's MCP server, the connector's MCP server
  and the CLI dispatch. A parameter added to one is added to all three. See
  `.claude/rules/tool-surfaces.md`.
- Before adding a dependency, read [Dependency management](docs/coding-guidelines/dependency-management.md).
  A GPL or AGPL licence needs the maintainers' approval.

The rules the maintainers work by are in [CLAUDE.md](CLAUDE.md) and `.claude/rules/`. Most of
them apply to you as well. The parts about Lifecycle Central, claims and worktrees are for the
maintainers' own sessions.

## Text and languages

The interface is in English, Finnish and Spanish.

- Every user-visible string goes through `t()`.
- Add the key to `aimeat/locales/en.json`. It is the source of truth for what keys exist.
- Leave `fi.json` and `es.json` alone if you do not write the language. A missing key falls back
  to English. Do not add a placeholder such as `[TODO:fi]`: `pnpm check:locales` refuses it.
- If you do write Finnish or Spanish, use `pnpm locale:extract` and `pnpm locale:merge`. The
  skill `.claude/skills/aimeat-writing/SKILL.md` has the loop and the terms already settled for
  each language.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make the change, with its tests and its `openapi.yaml` update.
3. Run `pnpm gate` until it is green.
4. Open a pull request that says what the change does for a person and how you tested it.

## Reporting issues

Use [GitHub Issues](https://github.com/miikkij/aimeat-protocol/issues) to report bugs or request
features. Include:

- Steps to reproduce
- Expected and actual behaviour
- Node.js version and OS
- Storage backend (PostgreSQL with Kysely, or SQLite)

## Licence

By contributing, you agree that your contributions are licensed under the MIT License.
