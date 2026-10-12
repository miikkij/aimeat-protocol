# Testing Requirements & E2E Testing Guide

## MANDATORY RULES (HIGH PRIORITY)

### Rule 1: E2E tests pass on both backends before work is done

The rule itself is in [CLAUDE.md](../../CLAUDE.md), section "Gates": E2E on both backends, targeted suites rather than the full sweep, new features ship with tests, and a failure in an area you touched means the work is not done. In practice:

- **Both backends must pass.** PostgreSQL + Kysely (`.env.test.postgres-kysely`) is the production backend; SQLite (`.env.test.sqlite`) is the fast local one. There is no other test backend: the Prisma providers were removed on 2026-07-16 and the in-memory test commands on 2026-10-11.
- **Run the suites your change can plausibly affect**, one or several at a time, on both backends:
  ```bash
  cd aimeat
  pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding
  pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=agent-onboarding --test=agent-skill-bundle
  ```
  For a change scoped to one layer (CLI only, one route, one view), say which suites you ran and why the others were not needed.
- **Finish with `pnpm gate --postgres`, once.** The full E2E sweep (`pnpm test:e2e:sqlite`, `pnpm test:e2e:postgres-kysely`, `pnpm test:e2e:all-backends`) takes about two hours and is never a routine step. In this repository it runs only when the maintainer asks for it.
- **A failure in a suite you did not touch:** confirm it fails on `main` too, in a separate clean worktree with its own test port and database, report it as pre-existing, and leave it.
- **Each worktree has its own test environment.** Run `pnpm test:env:init` from `aimeat/`. It writes `.env.test.sqlite` and `.env.test.postgres-kysely` from the committed `*.example` files with a port and a Postgres database derived from the worktree's name, and creates the database. Never copy `.env.test.*` from another checkout: the runner empties its database between suites, so two checkouts sharing one database wipe each other. `AIMEAT_E2E_PORT=<port> pnpm test:env:init --force` takes a port you choose (the script accepts 40251 to 40499). Maintainer sessions take that port from their Lifecycle Central claim. The runner refuses a port that a selected suite hard-codes; choose another free port when that happens.

### Rule 1b: The guard tier is the part CI refuses to merge without

Both E2E steps in `.github/workflows/ci.yml` carried `continue-on-error: true` from the day they were added, so until 2026-08-15 a red suite had never stopped a merge. The full sweep still cannot be that gate: two hours, and the cleanup race in `docs/pitfalls.md` §18 makes it occasionally wrong about suites nobody touched.

So a named tier blocks instead. `GUARD_SUITES` in `test/run-e2e-ci.ts`, run with `--guards`:

```bash
pnpm test:e2e:guards:sqlite
pnpm test:e2e:guards:postgres-kysely
```

The current suite list is `GUARD_SUITES` in the runner. It prints both suite and assertion totals. The suite count is stated in `.claude/rules/testing.md` and in `ci.yml`, and `pnpm check:doc-counts` holds both to the runner. The guard scripts use two lanes (`--workers=2`: two nodes, two ports, two databases, every suite alone on an empty node). Membership is one question: **does a failure here mean a principal can reach money, an identity, or another account's data that they must not?** Everything in it asserts a refusal or an isolation boundary.

- **Run it once, when the work is finished**, through `pnpm gate`, which runs the tier only when the change touched `src/routes/`, `src/auth/`, `src/services/`, `src/storage/`, `src/mcp/`, `src/middleware/`, `src/utils/`, `src/commerce/`, `src/server-bootstrap/`, `src/config.ts` or `src/config-types.ts` (`--postgres` adds the production backend; `pnpm gate:full` runs static checks, all unit tests, changed E2E suites and the guard tier on both backends; it does not run the full E2E sweep). A change elsewhere gets the static gates and the unit tests it reaches, and the tier is skipped for cause, which the plan says out loud. Not on every commit and not on every push: a day of iterative work is twenty commits, and a tier on each of them is a day lost. The pre-push hook does not run it. CI runs it on every push as well, but a green `pnpm gate` is what "done" needs; do not wait for CI.
- **A suite you fixed can be promoted into the tier after three consecutive identical green runs on each backend**, alone on a freshly cleaned test database. That is how the advisory sweep shrinks.
- **A suite cannot be in the tier if its result depends on what ran before it.** `e2e-money-audit` and `e2e-zip-security` were held out for a day on that basis and are in now: the dependency turned out to be a defect, not a property. See the rule below.
- **A suite that boots its own node must say where that node's data goes.** Some suites call `createServer()` themselves, and `config.ts` defaults `sqlitePath` to `./data/aimeat.db`, the developer's working node. `e2e-money-audit` had been registering its accounts there for months (242 owners measured on 2026-08-15, 241 of them its own), and because the first owner on a node is promoted to operator and nobody else ever is, its first run took that role permanently and every run after it failed the same 18 assertions. The runner pins `AIMEAT_SQLITE_PATH` now, so a suite has to opt OUT of the test database rather than opt in; a suite running a SECOND node beside the runner's should still name a file of its own, because two nodes must not share one SQLite file.
- Removing an entry is a decision to stop guarding something. Say why in the commit.

### Rule 2: New Features Must Have Tests

Every new feature or significant change includes E2E tests: the happy path and at least one failure mode. Test the critical paths and the edge cases; quality over quantity.

### Rule 3: Test Before Claiming Done

Never claim a feature is "done" or "working" without running the relevant suites. Evidence before assertions.

---

## Test Infrastructure Overview

### Test Runners

| Runner | Location | Pattern | When to Use |
|--------|----------|---------|-------------|
| E2E (standalone TSX) | `test/e2e-*.ts`, run by `test/run-e2e-ci.ts` | Its own `test()`/`assert()`, against the node the runner starts at `E2E_BASE` | API integration tests |
| Unit (Vitest) | `test/unit/*.test.ts` | `describe`/`it`/`expect` | Pure functions, isolated logic |
| Type-check | `pnpm typecheck`, `pnpm typecheck:frontend`, `pnpm typecheck:sdk` | TypeScript compiler, one project each | After every code change |

### Commands

```bash
# All commands from the aimeat/ directory
cd aimeat

# Once per worktree: write .env.test.sqlite and .env.test.postgres-kysely
pnpm test:env:init

# Type-check (the backend, the browser code and the SDK libs are separate projects)
pnpm typecheck && pnpm typecheck:frontend && pnpm typecheck:sdk

# Unit tests
pnpm test

# One or more E2E suites (the normal check during iteration)
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding
pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=agent-onboarding

# The finish line for a piece of work
pnpm gate --postgres
```

`--test=<name>` matches a suite by its file name without `test/` and `.ts`, with or without the `e2e-` prefix (`--test=model-suite` runs `test/e2e-model-suite.ts`). An exact name wins over a substring, and a substring that matches more than one suite is an error.

### E2E Test Suites

`ALL_SUITES` in `aimeat/test/run-e2e-ci.ts` is the current runnable inventory; `GUARD_SUITES` is its blocking subset. The runner compares `ALL_SUITES` with the files in `test/`: a suite file on no list fails a full run and warns on a filtered one. A `.ts` file in `test/` that is not a suite is named in `NOT_SUITES` with the reason.

### Storage conformance

`pnpm exec vitest run test/unit/storage-conformance.test.ts` tests SQLite locally and PostgreSQL when `DATABASE_URL` is set. A configured but unavailable PostgreSQL database fails the suite. Set `AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true` to require a URL as well; CI does this in its PostgreSQL service job. A local SQLite-only pass is not PostgreSQL evidence.

---

## Writing E2E Tests

### The model suite

Copy **`test/e2e-model-suite.ts`**. It exists to be copied, and it shows every part a suite needs and nothing else:

- **the node**: the runner starts it and sets `E2E_BASE` to its address; the suite reads `E2E_BASE` and `E2E_NODE_ID` (the `localhost:40251` fallback is only for running the file by hand against a node you started yourself);
- its own `test()`, `assert()` and `json()` helpers;
- **register**: two owners with `POST /v1/ghii` (`username`, `display_name`, `password`), with a `Date.now()` suffix on each name;
- **sign in with the password**: `POST /v1/ghii/login` with `username` and `password` returns the session token in `data.token`;
- **act**: one write and its read-back, then the refusals: `401` without a token, and another owner cannot read a private record;
- **clean up**: each owner deletes itself with `DELETE /v1/owners/:name` and its own Bearer token (the route needs the account holder's local session);
- an exit code the runner reads: `process.exit(failed > 0 ? 1 : 0)`.

A suite that makes many owners uses **`test/helpers/owner-login.ts`** instead of writing the two calls again: `registerOwner(BASE, name)` registers with a password and signs in (it returns the token, the GHII and the key pair), `ownerSignIn(BASE, name, password)` answers `{ status, body }` like the suite's own `json()`, and `ownerToken(BASE, name, password)` returns the token. Until 2026-10-12 most suites signed an owner in with the owner key (a signature over `name + NODE_ID + timestamp` sent to `POST /v1/auth/token`). That sign-in is removed in 4.0.0, every suite now signs in with the password, and `test/unit/no-owner-key-sign-in.test.ts` refuses a file that brings it back. An agent still signs in with its own key on the same route. A suite that needs other helpers takes them from `test/helpers/` (for example `wait-for-server.ts`, `node-entry.ts`, `fake-ai-provider.ts`, `fake-smtp.ts`).

### Conventions

1. **Self-contained**: each suite registers its own owners and agents and deletes its owners at the end.
2. **Unique names**: a `Date.now()` suffix on owner and agent names avoids collisions.
3. **Sequential**: tests run in order within a file.
4. **Fetch-based**: all HTTP calls go through the suite's `json()` helper.
5. **Timing**: TTL tests use short durations (milliseconds or seconds).
6. **Exit code**: `process.exit(failed > 0 ? 1 : 0)`.

### Adding a New E2E Suite

1. Create `test/e2e-my-feature.ts` as a copy of `test/e2e-model-suite.ts`. Give it the standard file header with its `--test=` command under `@usage`.
2. Add `'test/e2e-my-feature.ts'` to `ALL_SUITES` in `test/run-e2e-ci.ts`, and add a version-history line to the runner's header. Do not add it to `GUARD_SUITES`; a suite earns that (Rule 1b).
3. Run it on both backends:
   ```bash
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=my-feature
   pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=my-feature
   ```

A suite needs no `package.json` script. `pnpm check:package-scripts` refuses a script that points at a missing file.

### Multi-Backend Testing

| Backend | Env file | Notes |
|---------|----------|-------|
| **PostgreSQL + Kysely** | `.env.test.postgres-kysely` | **Production backend; must always pass.** Migrations run on boot; the runner empties the database between suites. |
| **SQLite** | `.env.test.sqlite` | **First-class; must always pass.** Fast iteration on the same SQL code path. |

Both env files come from `pnpm test:env:init`. The runner (`test/run-e2e-ci.ts`) starts the node, runs the requested suites, and stops it.

---

## When to Run What

Default is **scoped, not exhaustive**: run the minimum that gives confidence in the change.

| Situation | What to Run |
|-----------|-------------|
| After any code change | `pnpm typecheck` (plus `typecheck:frontend` or `typecheck:sdk` for those areas) and `pnpm lint` |
| After changing a single route or service | `--test=<suite>` for the affected suites on SQLite |
| After changing a CLI subcommand | The CLI's own integration test, if any. Server suites do not exercise CLI code. |
| After changing the storage layer | The affected suites and storage conformance on both backends; finish with `pnpm gate --postgres` |
| Before claiming a feature is done | The affected suites on PostgreSQL + Kysely **and** SQLite, then `pnpm gate --postgres` once |
| The full E2E sweep | Only when the maintainer asks for it |

---

## Test Quality Guidelines

### What Makes a Good Test

- **Tests the contract**, not the implementation: verify API responses, status codes, and side effects.
- **Tests edge cases**: empty inputs, maximum values, unauthorized access, concurrent operations.
- **Tests error paths**: invalid inputs return proper error codes, not 500s.
- **Is deterministic**: no timing dependencies, no reliance on external state.
- **Cleans up after itself**: delete the suite's owners at the end.

### Test Grouping

Group tests within a file:
1. **Setup**: register owners and agents, create test data
2. **Happy path**: normal operations work
3. **Authorization**: the wrong role or token gets 401/403
4. **Edge cases**: boundary conditions, empty data, large payloads
5. **Cleanup**: delete test data

### Coverage Goals

- Every API endpoint is tested by at least one E2E suite.
- Every authorization boundary is tested (owner, agent, anonymous, operator).
- Every storage operation works on both backends (PostgreSQL + Kysely and SQLite).
