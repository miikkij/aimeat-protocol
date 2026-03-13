# Testing Requirements & E2E Testing Guide

## MANDATORY RULES (HIGH PRIORITY)

### Rule 1: E2E Tests Must Pass After Major Changes

When any major feature, bugfix, or structural change is completed and thought to be ready:

1. **Run E2E tests on both storage backends:**
   ```bash
   cd aimeat
   pnpm test:e2e:mongodb
   pnpm test:e2e:sqlite
   ```
2. **Target: 0 failures.** All tests must pass on both backends.
3. **If tests fail in areas affected by the change**, the change is NOT complete — fix the failures first.
4. **If failures are unrelated to the change**, investigate briefly. If complicated or ambiguous, ask the user how to proceed before continuing.
5. **Full test runs are required at the end of any multi-step plan execution.**

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

# Full E2E suite (in-memory, fastest)
pnpm test:e2e:memory

# E2E with SQLite backend
pnpm test:e2e:sqlite

# E2E with MongoDB backend (requires MongoDB running)
pnpm test:e2e:mongodb

# All three backends sequentially
pnpm test:e2e:all-backends

# Individual E2E suites
pnpm test:e2e:security
pnpm test:e2e:admin-features
pnpm test:e2e:federation
# ... see package.json for full list

# Run specific suite with CI runner
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

Tests must pass on all three storage backends:

| Backend | Env File | Command |
|---------|----------|---------|
| In-memory | `.env.test.memory` | `pnpm test:e2e:memory` |
| SQLite | `.env.test.sqlite` | `pnpm test:e2e:sqlite` |
| MongoDB | `.env.test.mongodb` | `pnpm test:e2e:mongodb` |

The CI runner (`test/run-e2e-ci.ts`) handles server lifecycle automatically — it starts the server, runs all suites, then shuts down.

---

## When to Run What

| Situation | What to Run |
|-----------|-------------|
| After any code change | `npx tsc --noEmit` |
| After changing a route/service | `pnpm test:e2e:memory` + relevant suite |
| After changing storage layer | `pnpm test:e2e:sqlite` + `pnpm test:e2e:mongodb` |
| Before claiming a feature is done | Full E2E on memory + at least one persistent backend |
| End of a multi-step plan | `pnpm test:e2e:mongodb` + `pnpm test:e2e:sqlite` |
| Before creating a PR | `pnpm test:e2e:all-backends` |

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
- Every storage operation should work on all three backends.
