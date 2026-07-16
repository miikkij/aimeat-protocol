# Testing Requirements & E2E Testing Guide

## MANDATORY RULES (HIGH PRIORITY)

### Rule 1: E2E Tests Must Pass After Major Changes

**Backend priority (post Phase 5 — the Postgres+Kysely cutover; prod runs Kysely):**
- **PostgreSQL + Kysely** (`postgres-kysely`, `.env.test.postgres-kysely`, `src/storage/providers/postgres-kysely/`, no Prisma) — **the PRIMARY production backend; it MUST always pass.**
- **SQLite** (better-sqlite3; `:memory:` via `AIMEAT_DB_PATH=:memory:` for the fast-iteration role on the real prod code path) — **first-class; it MUST always pass.**
- **MongoDB** (Prisma) — **DEPRECATED, removed before AIMEAT v2.0.** Run only when a change touches the shared Prisma path; treat failures as informational, not blocking.
- The Prisma-based **`postgres`** provider (`.env.test.postgres`, `pnpm test:e2e:postgresql`, `schema.postgres.prisma`) is **legacy** — superseded by Kysely; don't confuse it with `postgres-kysely`.

The in-memory backend is deprecated and produces stale failures — treat `pnpm test:e2e` and `pnpm test:e2e:memory` as deprecated; do not use them for verification, and do not report their failures as findings. **Default verification = PostgreSQL+Kysely + SQLite** (both green); Mongo only when the Prisma path is touched.

When a feature, bugfix, or structural change is completed:

1. **Iterate against only the suites your change can plausibly affect** — not the whole sweep. Use the filter runner:
   ```bash
   cd aimeat

   # Single suite, fastest backend:
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding

   # Multiple suites at once:
   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding --test=agent-skill-bundle
   ```
   For changes scoped to one layer (CLI-only, single route, single view), state explicitly which suites you ran and why others were not needed.

2. **End of a multi-step plan — full sweep on both PRIMARY backends (both must be green):**
   ```bash
   pnpm test:e2e:postgres-kysely   # PRIMARY / prod backend
   pnpm test:e2e:sqlite
   # MongoDB (deprecating, out before v2.0) only if you touched the Prisma path:
   # pnpm test:e2e:mongodb
   ```

3. **Target: 0 failures in the suites you ran.**
   - Failures in an area your change touches → change is NOT complete; fix it.
   - Failures in an unrelated suite → verify they pre-exist on `main` (e.g. `git stash && pnpm test:e2e:sqlite -- --test=<suite>` then `git stash pop`). Report as pre-existing; do not fix them as part of the current work.
   - Complicated or ambiguous → ask the user before continuing.

4. **Full test runs are required at the end of any multi-step plan execution.**

### Rule 2: New Features Must Have Tests

Every new feature or significant change should include E2E tests that verify it works correctly and won't break silently later. Quality over quantity — test the critical paths and edge cases.

### Rule 3: Test Before Claiming Done

Never claim a feature is "done" or "working" without running the relevant test suite. Evidence before assertions.

---

## Test Infrastructure Overview

### Test Runners

| Runner | Location | Pattern | When to Use |
|--------|----------|---------|-------------|
| E2E (standalone TSX) | `test/e2e-*.ts` | Custom `test()`/`assert()`, runs against live server on `:40251` | API integration tests |
| Unit (Vitest) | `test/unit/*.test.ts` | `describe`/`it`/`expect` | Pure functions, isolated logic |
| Type-check | `npx tsc --noEmit` | TypeScript compiler | After every code change |

### E2E Test Commands

```bash
# All commands from aimeat/ directory
cd aimeat

# Type-check (always run first)
npx tsc --noEmit

# Unit tests
pnpm test

# E2E with PostgreSQL+Kysely -- PRIMARY / prod backend, must pass
pnpm test:e2e:postgres-kysely

# E2E with SQLite backend -- fast iteration, must pass
pnpm test:e2e:sqlite

# E2E with MongoDB backend -- DEPRECATED (out before v2.0); only if the Prisma path was touched
pnpm test:e2e:mongodb

# DEPRECATED -- do not use:
#   pnpm test:e2e             (memory backend, not a valid environment)
#   pnpm test:e2e:memory      (same as above)
#   pnpm test:e2e:all-backends (includes the deprecated memory pass)

# Run a single suite (preferred during iteration -- much faster than the full sweep):
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-onboarding

# Or via the filter alias (uses whichever env-file is currently set):
pnpm test:e2e:ci:filter -- --test=security
```

### E2E Test Suites (19 suites)

| Suite | File | Tests |
|-------|------|-------|
| Full API | `test/api-full.ts` | 35 tests across 6 phases + GDPR |
| Admin Features | `test/e2e-admin-features.ts` | Admin dashboard API endpoints |
| Anonymous | `test/e2e-anonymous.ts` | Anonymous access mode |
| Auth & Libraries | `test/e2e-auth-lib.ts` | Authentication flows |
| Board TTL | `test/e2e-board-ttl.ts` | Board post time-to-live |
| Concurrency | `test/e2e-concurrency.ts` | Concurrent access patterns |
| Disputes | `test/e2e-disputes.ts` | Dispute escalation flow |
| Extensions | `test/e2e-extensions.ts` | V8 isolate extensions |
| Federation | `test/e2e-federation.ts` | Node federation |
| Hooks | `test/e2e-hooks.ts` | Extension hooks |
| Knowledge | `test/e2e-knowledge.ts` | Knowledge base API |
| Libraries | `test/e2e-libs.ts` | Client SDK libraries |
| MCP | `test/e2e-mcp.ts` | Model Context Protocol |
| Micro-Memory | `test/e2e-micro-memory.ts` | Micro-memory operations |
| Personal Node | `test/e2e-personal-node.ts` | Personal node features |
| Phase 0 | `test/e2e-phase0.ts` | Core phase 0 operations |
| Portal | `test/e2e-portal.ts` | Portal rendering |
| Security | `test/e2e-security.ts` | Security hardening |
| Storage Visibility | `test/e2e-storage-visibility.ts` | Storage access control |

---

## Writing E2E Tests

### E2E Test Template

All E2E tests follow the same self-contained pattern:

```typescript
// Description of what this test suite covers
// Run: cd aimeat && pnpm exec tsx test/e2e-my-feature.ts
// Requires: server running on port 40251

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

// Ed25519 signing helper (if needed)
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.etc.sha512Sync = (...m: Uint8Array[]) =>
  new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const privKey = Buffer.from(privateKeyB64, 'base64');
  const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
  return Buffer.from(sig).toString('base64');
}

// ─── State ───
const ownerName = `test-owner-${Date.now()}`;
let ownerToken = '';
let ownerPrivKey = '';

// ─── Setup ───
async function setup() {
  console.log('\n📋 My Feature E2E Tests');
  console.log(`   Base: ${BASE}\n`);

  // Register owner
  const reg = await json('/v1/owners', {
    method: 'POST',
    body: JSON.stringify({ name: ownerName }),
  });
  assert(reg.status === 201, `Owner registration failed: ${reg.status}`);
  ownerToken = reg.body.data.token;
  ownerPrivKey = reg.body.data.keys.privateKey;
}

// ─── Tests ───
async function run() {
  await setup();

  await test('my feature works correctly', async () => {
    // Test implementation
  });

  // ─── Cleanup ───
  const sig = await signMsg(ownerPrivKey, ownerName);
  await json(`/v1/owners/${ownerName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}`, 'x-signature': sig },
  });

  // ─── Summary ───
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
```

### Conventions

1. **Self-contained**: Each test file registers its own owner/agents and cleans up via cascade delete at the end.
2. **Unique names**: Use `Date.now()` suffix for owner/agent names to avoid collisions.
3. **Sequential**: Tests run sequentially within a file (no parallel test execution).
4. **Fetch-based**: Use the `json()` helper for all HTTP calls.
5. **Timing**: For TTL tests, use short durations (milliseconds/seconds) to keep tests fast.
6. **Exit code**: `process.exit(failed > 0 ? 1 : 0)` — non-zero on any failure.

### Adding a New E2E Suite

1. Create `test/e2e-my-feature.ts` following the template above.
2. Add to `ALL_SUITES` array in `test/run-e2e-ci.ts`.
3. Add npm scripts to `package.json`:
   ```json
   "test:e2e:my-feature": "tsx test/e2e-my-feature.ts",
   "test:e2e:docker:my-feature": "bash test/docker/e2e-runner.sh test/e2e-my-feature.ts"
   ```
4. Run on all backends to verify.

### Multi-Backend Testing

Tests must pass on the **persistent** storage backends:

| Backend | Env File | Command | Notes |
|---------|----------|---------|-------|
| **PostgreSQL + Kysely** | `.env.test.postgres-kysely` | `pnpm test:e2e:postgres-kysely` | **PRIMARY / prod backend (no Prisma) — must always pass.** Recreate the test DB before a full run (schema drops + migrations re-run on boot). |
| **SQLite** | `.env.test.sqlite` | `pnpm test:e2e:sqlite` | **First-class — must always pass.** Fast iteration; set `AIMEAT_DB_PATH=:memory:` for in-memory speed on the real SQL code path. |
| MongoDB | `.env.test.mongodb` | `pnpm test:e2e:mongodb` | **DEPRECATED — removed before v2.0.** Run only when a change touches the shared Prisma path; failures informational, not blocking. |
| PostgreSQL (Prisma) | `.env.test.postgres` | `pnpm test:e2e:postgresql` | **Legacy** Prisma-PG — superseded by Kysely. Don't confuse with `postgres-kysely`. |

The in-memory backend (`pnpm test:e2e:memory`, the unsuffixed `pnpm test:e2e`) is **deprecated** and not a supported environment — its `.env.test.memory` file may not even exist in the repo. AIMEAT outgrew the pure-in-memory storage path long ago; SQLite `:memory:` covers that role using the production code path.

The CI runner (`test/run-e2e-ci.ts`) handles server lifecycle automatically — it starts the server, runs the requested suites, then shuts down.

---

## When to Run What

Default is **scoped, not exhaustive** — run the minimum that gives confidence in the change. Full sweeps belong at the end of a plan, not during iteration.

| Situation | What to Run |
|-----------|-------------|
| After any code change | `npx tsc --noEmit` + `pnpm lint` |
| After changing a single route/service | `--test=<suite>` for the affected suite(s) on SQLite |
| After changing a CLI subcommand | The CLI's own integration test, if any. Server suites do not exercise CLI code. |
| After changing storage layer | `pnpm test:e2e:postgres-kysely` + `pnpm test:e2e:sqlite` (both must pass) |
| Before claiming a feature is done | The affected suites on PostgreSQL+Kysely **and** SQLite (+ MongoDB only if the Prisma path was touched) |
| End of a multi-step plan | `pnpm test:e2e:postgres-kysely` + `pnpm test:e2e:sqlite` (both, full sweep) |
| Before creating a PR | Both primary backends (PostgreSQL+Kysely + SQLite), full sweep |

---

## Test Quality Guidelines

### What Makes a Good Test

- **Tests the contract**, not the implementation — verify API responses, status codes, and side effects.
- **Tests edge cases** — empty inputs, maximum values, unauthorized access, concurrent operations.
- **Tests error paths** — invalid inputs should return proper error codes, not 500s.
- **Is deterministic** — no flaky timing dependencies, no reliance on external state.
- **Cleans up after itself** — cascade delete owners at the end.

### Test Grouping

Group tests logically within a file:
1. **Setup phase** — register owners, agents, create test data
2. **Happy path tests** — normal operations work correctly
3. **Authorization tests** — wrong role/token gets 401/403
4. **Edge case tests** — boundary conditions, empty data, large payloads
5. **Cleanup phase** — delete test data

### Coverage Goals

- Every API endpoint should be tested by at least one E2E suite.
- Every authorization boundary should be tested (owner vs agent vs anonymous vs operator).
- Every storage operation must work on the two primary backends (PostgreSQL+Kysely + SQLite); keep it working on the legacy Prisma backends (MongoDB, Prisma-PG) only while they still exist (MongoDB is out before v2.0).
